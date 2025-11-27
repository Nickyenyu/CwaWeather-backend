require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 修正 1：這裡應該是網址，不是 Key
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
// 如果你的 .env 沒設定，這裡請暫時先填入你的 Key，但建議還是放在 .env
const CWA_API_KEY = process.env.CWA_API_KEY || "CWA-5148ABEE-8536-4509-935F-886A4AC68F25";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 修正 2：把對照表拿出來，放在全域變數比較整齊
const CITY_MAP = {
  // 六都
  taipei: "臺北市",
  new_taipei: "新北市",
  taoyuan: "桃園市",
  taichung: "臺中市", 
  tainan: "臺南市",
  kaohsiung: "高雄市",
  
  // 北部
  keelung: "基隆市",
  hsinchu_city: "新竹市",
  hsinchu_county: "新竹縣",
  yilan: "宜蘭縣",
  
  // 中部
  miaoli: "苗栗縣",
  changhua: "彰化縣",
  nantou: "南投縣",
  yunlin: "雲林縣",
  
  // 南部
  chiayi_city: "嘉義市",
  chiayi_county: "嘉義縣",
  pingtung: "屏東縣",
  
  // 東部 & 外島
  hualien: "花蓮縣",
  taitung: "臺東縣",
  penghu: "澎湖縣",
  kinmen: "金門縣",
  lienchiang: "連江縣"
};

/**
 * 取得指定縣市天氣預報 (已改名為 getCityWeather)
 */
const getCityWeather = async (req, res) => {
  try {
    // 修正 3：從網址參數抓取城市代碼 (例如 taipei)
    const cityCode = req.params.city;
    // 查表找中文
    const targetLocation = CITY_MAP[cityCode];

    // 如果找不到這個城市
    if (!targetLocation) {
      return res.status(400).json({
        error: "不支援的城市",
        message: `找不到城市代碼: ${cityCode}`,
        supportedCities: Object.keys(CITY_MAP)
      });
    }

    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請設定 CWA_API_KEY",
      });
    }

    // 修正 4：補上原本遺失的 axios 請求，並使用動態地點
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: targetLocation, // 這裡變成動態的中文名
        },
      }
    );

    const locationData = response.data.records.location[0];

    if (!locationData) {
      return res.status(404).json({
        error: "查無資料",
        message: `無法取得 ${targetLocation} 天氣資料`,
      });
    }

    // 整理天氣資料
    const weatherData = {
      city: locationData.locationName,
      cityCode: cityCode,
      updateTime: response.data.records.datasetDescription,
      forecasts: [],
    };

    // 解析天氣要素
    const weatherElements = locationData.weatherElement;
    const timeCount = weatherElements[0].time.length;

    for (let i = 0; i < timeCount; i++) {
      const forecast = {
        startTime: weatherElements[0].time[i].startTime,
        endTime: weatherElements[0].time[i].endTime,
        weather: "",
        rain: "",
        minTemp: "",
        maxTemp: "",
        comfort: "",
        windSpeed: "",
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx":
            forecast.weather = value.parameterName;
            break;
          case "PoP":
            forecast.rain = value.parameterName + "%";
            break;
          case "MinT":
            // 這裡改成只傳數字，方便前端顯示
            forecast.minTemp = value.parameterName;
            break;
          case "MaxT":
            forecast.maxTemp = value.parameterName;
            break;
          case "CI":
            forecast.comfort = value.parameterName;
            break;
          case "WS":
            forecast.windSpeed = value.parameterName;
            break;
        }
      });

      weatherData.forecasts.push(forecast);
    }

    res.json({
      success: true,
      data: weatherData,
    });
  } catch (error) {
    console.error("取得天氣資料失敗:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API (全台版)",
    endpoints: {
      cityWeather: "/api/weather/:city", // 提示使用者要加參數
      health: "/api/health",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 修正 5：路由變成動態的 :city
app.get("/api/weather/:city", getCityWeather);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器運行已運作 on port ${PORT}`);
  console.log(`📍 支援全台 22 縣市`);
});