require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// === 設定 ===
// 使用最穩定的 F-C0032-001 (一般天氣預報-今明 36 小時)
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 全台 22 縣市對照表 ===
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
  taitung: "臺東縣",
  penghu: "澎湖縣",
  kinmen: "金門縣",
  lienchiang: "連江縣"
};

const getCityWeather = async (req, res) => {
  try {
    const cityCode = req.params.city;
    const targetLocation = CITY_MAP[cityCode];

    if (!targetLocation) {
      return res.status(400).json({ error: "不支援的城市", message: `代碼錯誤: ${cityCode}` });
    }
    if (!CWA_API_KEY) {
      return res.status(500).json({ error: "設定錯誤", message: "缺少 CWA_API_KEY" });
    }

    // 呼叫 36小時預報 API
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: targetLocation,
        },
      }
    );

    const locationData = response.data.records.location[0];
    if (!locationData) {
      throw new Error(`找不到 ${targetLocation} 的資料`);
    }

    const weatherData = {
      city: locationData.locationName,
      cityCode: cityCode,
      forecasts: [],
    };

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
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx": forecast.weather = value.parameterName; break;
          case "PoP": forecast.rain = value.parameterName + "%"; break;
          case "MinT": forecast.minTemp = value.parameterName; break;
          case "MaxT": forecast.maxTemp = value.parameterName; break;
        }
      });
      weatherData.forecasts.push(forecast);
    }

    res.json({ success: true, data: weatherData });

  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ error: "Server Error", message: error.message });
  }
};

app.get("/", (req, res) => res.json({ message: "Zootopia Weather API (36H Stable)" }));
app.get("/api/health", (req, res) => res.json({ status: "OK" }));
app.get("/api/weather/:city", getCityWeather);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (Mode: 36H Stable)`);
});