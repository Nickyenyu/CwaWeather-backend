require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// === 核心設定 ===
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 縣市對照表 ===
const CITY_MAP = {
  taipei: "臺北市",
  new_taipei: "新北市",
  keelung: "基隆市",
  taoyuan: "桃園市",
  hsinchu_city: "新竹市",
  hsinchu_county: "新竹縣",
  miaoli: "苗栗縣",
  taichung: "臺中市",
  changhua: "彰化縣",
  nantou: "南投縣",
  yunlin: "雲林縣",
  chiayi_city: "嘉義市",
  chiayi_county: "嘉義縣",
  tainan: "臺南市",
  kaohsiung: "高雄市",
  pingtung: "屏東縣",
  yilan: "宜蘭縣",
  hualien: "花蓮縣",
  taitung: { name: "臺東縣" }, 
  penghu: "澎湖縣",
  kinmen: "金門縣",
  lienchiang: "連江縣"
};

/**
 * 取得一週天氣預報 (7-Day Forecast - County Level)
 */
const getWeeklyWeather = async (req, res) => {
  try {
    const cityCode = req.params.city;
    let cityName = CITY_MAP[cityCode];
    if (typeof cityName === 'object') cityName = cityName.name;

    if (!cityName) {
      return res.status(400).json({ error: "不支援的城市", message: `代碼錯誤: ${cityCode}` });
    }
    if (!CWA_API_KEY) {
      return res.status(500).json({ error: "設定錯誤", message: "缺少 CWA_API_KEY" });
    }

    // 呼叫 API (F-D0047-093 縣市版 7 天預報)
    // ⚠️ 修正：改抓 MinT, MaxT (因為 7 天預報沒有平均溫度 T)
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-D0047-093`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: cityName,
          elementName: "Wx,MinT,MaxT,PoP12h" 
        },
      }
    );

    if (!response.data.records || !response.data.records.locations || response.data.records.locations.length === 0) {
       throw new Error("API 回傳空資料，請檢查 API Key");
    }

    const dataset = response.data.records.locations[0]; 
    const locationData = dataset.location[0];

    if (!locationData) {
      throw new Error(`找不到 ${cityName} 的資料`);
    }

    const weatherElements = locationData.weatherElement;
    
    // 安全地取得資料陣列 (防呆)
    const getEl = (code) => {
        const found = weatherElements.find(e => e.elementName === code);
        return found ? found.time : [];
    };
    
    const wxList = getEl("Wx");
    const minTList = getEl("MinT"); // 最低溫
    const maxTList = getEl("MaxT"); // 最高溫
    const popList = getEl("PoP12h");

    const dailyForecasts = [];
    const processedDates = new Set();

    // 遍歷資料
    wxList.forEach((item, index) => {
        const startTime = item.startTime;
        const dateStr = startTime.split("T")[0]; 

        if (!processedDates.has(dateStr)) {
            processedDates.add(dateStr);
            
            // 安全取值 (使用 Optional Chaining ?.)
            const minVal = minTList[index]?.elementValue[0].value;
            const maxVal = maxTList[index]?.elementValue[0].value;
            const rainVal = popList[index]?.elementValue[0].value || "0";
            
            // ⚠️ 修正：手動計算平均溫度給前端
            let avgTemp = "--";
            if (minVal && maxVal) {
                avgTemp = Math.round((parseInt(minVal) + parseInt(maxVal)) / 2).toString();
            }

            const safeRain = rainVal === " " ? "0" : rainVal;

            dailyForecasts.push({
                date: dateStr,
                weather: item.elementValue[0].value,
                temp: avgTemp, // 前端依舊讀取這個 temp 欄位
                rain: safeRain
            });
        }
    });

    const current = dailyForecasts[0];
    const future = dailyForecasts.slice(1, 8); 

    res.json({
      success: true,
      data: {
        city: cityName,
        district: "", 
        current: current,
        forecasts: future
      }
    });

  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ 
        error: "Server Error", 
        message: error.message,
        detail: error.response?.data || "無法取得外部資料"
    });
  }
};

app.get("/", (req, res) => res.json({ message: "Zootopia Weather API (7-Day County Edition)" }));
app.get("/api/health", (req, res) => res.json({ status: "OK", time: new Date() }));
app.get("/api/weather/:city", getWeeklyWeather);
app.use((req, res) => res.status(404).json({ error: "Path Not Found" }));

app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});