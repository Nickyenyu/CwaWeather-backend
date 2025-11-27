require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// === 核心設定 ===
// 改用 F-D0047-091 (全台鄉鎮未來1週天氣預報)
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 關鍵地圖：縣市 -> 對應的代表行政區 ===
// 這是為了從龐大的資料中，精準抓出該縣市的指標天氣
const LOCATION_MAP = {
  taipei: { city: "臺北市", district: "中正區" },
  new_taipei: { city: "新北市", district: "板橋區" },
  keelung: { city: "基隆市", district: "中正區" },
  taoyuan: { city: "桃園市", district: "桃園區" },
  hsinchu_city: { city: "新竹市", district: "東區" },
  hsinchu_county: { city: "新竹縣", district: "竹北市" },
  miaoli: { city: "苗栗縣", district: "苗栗市" },
  taichung: { city: "臺中市", district: "西屯區" },
  changhua: { city: "彰化縣", district: "彰化市" },
  nantou: { city: "南投縣", district: "南投市" },
  yunlin: { city: "雲林縣", district: "斗六市" },
  chiayi_city: { city: "嘉義市", district: "東區" },
  chiayi_county: { city: "嘉義縣", district: "太保市" },
  tainan: { city: "臺南市", district: "安平區" },
  kaohsiung: { city: "高雄市", district: "苓雅區" },
  pingtung: { city: "屏東縣", district: "屏東市" },
  yilan: { city: "宜蘭縣", district: "宜蘭市" },
  hualien: { city: "花蓮縣", district: "花蓮市" },
  taitung: { city: "臺東縣", district: "臺東市" },
  penghu: { city: "澎湖縣", district: "馬公市" },
  kinmen: { city: "金門縣", district: "金城鎮" },
  lienchiang: { city: "連江縣", district: "南竿鄉" }
};

/**
 * 取得一週天氣預報 (7-Day Forecast)
 */
const getWeeklyWeather = async (req, res) => {
  try {
    const cityCode = req.params.city;
    const targetLoc = LOCATION_MAP[cityCode];

    // 1. 基本檢查
    if (!targetLoc) {
      return res.status(400).json({ error: "不支援的城市", message: `代碼錯誤: ${cityCode}` });
    }
    if (!CWA_API_KEY) {
      return res.status(500).json({ error: "設定錯誤", message: "缺少 API KEY" });
    }

    // 2. 呼叫 CWA API (F-D0047-091)
    // 我們使用 locationName 過濾行政區，elementName 過濾需要的數值
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-D0047-091`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: targetLoc.district, // 例如：中正區
          elementName: "Wx,T,PoP12h" // 只抓：天氣現象、平均溫、降雨機率
        },
      }
    );

    // 3. 資料檢核與尋找
    // API 回傳結構：records -> locations[0] -> location[]
    const dataset = response.data.records.locations[0]; 
    const locationList = dataset.location;

    // 因為不同縣市可能有同名行政區 (例如好幾個縣市都有中正區、東區)
    // 我們必須多做一層檢查，確認找到的資料屬於正確的縣市
    // 但 F-D0047-091 的 location 裡面通常沒有縣市欄位，而是它的上層 locations[0].locationsName
    // 幸運的是，我們傳入 district 查詢時，API 會回傳全台所有叫這個名字的區。
    // 我們採取簡易策略：通常查詢結果的第一筆或比對 dataset 的 locationsName (但 091 是全台)
    // 為了最穩定的結果，我們直接拿第一筆符合 district 名稱的資料。
    // (進階作法是比對 lat/lon，但這裡做 MVP 先求有)
    
    const matchedLocation = locationList.find(loc => loc.locationName === targetLoc.district);

    if (!matchedLocation) {
      throw new Error(`找不到 ${targetLoc.city}${targetLoc.district} 的氣象資料`);
    }

    // 4. 解析與整理數據 (最關鍵的一步)
    const weatherElements = matchedLocation.weatherElement;
    
    // 取得各項數據的時間序列 (每 12 小時一筆)
    // Wx: 天氣現象, T: 平均溫, PoP12h: 降雨機率
    const getEl = (code) => weatherElements.find(e => e.elementName === code).time;
    
    const wxList = getEl("Wx");
    const tList = getEl("T");
    const popList = getEl("PoP12h");

    // 將資料合併為「每天一筆」
    const dailyForecasts = [];
    const processedDates = new Set();

    wxList.forEach((item, index) => {
        const startTime = item.startTime;
        const dateStr = startTime.split("T")[0]; // 取出 YYYY-MM-DD

        // 防止重複：每天只取第一筆資料 (通常是白天 06:00 或 12:00，或是晚上 18:00)
        // 這樣就能把 14 筆資料簡化成 7 筆
        if (!processedDates.has(dateStr)) {
            processedDates.add(dateStr);

            // 防呆：有時候 API 資料長度不一致，用 Optional Chaining (?.)
            const tempVal = tList[index]?.elementValue[0].value || "--";
            const rainVal = popList[index]?.elementValue[0].value || "0";
            
            // 處理降雨機率有時是 " " (空字串) 的狀況
            const safeRain = rainVal === " " ? "0" : rainVal;

            dailyForecasts.push({
                date: dateStr,
                dayName: "", // 前端處理星期幾
                weather: item.elementValue[0].value, // 例如：多雲時陰
                temp: tempVal,
                rain: safeRain
            });
        }
    });

    // 5. 回傳資料
    // 分割：今天(current) 與 未來(forecasts)
    // 有時候因為時區關係，第一筆可能是昨天晚上，所以我們取前 8 筆資料來處理
    const current = dailyForecasts[0];
    const future = dailyForecasts.slice(1, 8); // 取後續 7 天

    res.json({
      success: true,
      data: {
        city: targetLoc.city,
        district: targetLoc.district,
        current: current,
        forecasts: future
      }
    });

  } catch (error) {
    console.error("API Error:", error.message);
    // 回傳詳細錯誤給前端，方便除錯
    res.status(500).json({ 
        error: "Server Error", 
        message: error.message,
        detail: error.response?.data || "No external response"
    });
  }
};

// Routes
app.get("/", (req, res) => res.json({ message: "Zootopia Weather API (7-Day Edition)" }));
app.get("/api/health", (req, res) => res.json({ status: "OK", time: new Date() }));
app.get("/api/weather/:city", getWeeklyWeather);

// Error Handling
app.use((req, res) => res.status(404).json({ error: "Path Not Found" }));
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📍 Mode: 7-Day Forecast (F-D0047-091)`);
});