/**
 * 상권분석 앱 — Vercel Serverless Function (Express API)
 * 네이버 검색 API + OpenRouteService API 프록시
 * + in-memory 캐시
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// CORS 허용 (모든 도메인 또는 배포 도메인)
app.use(cors());
app.use(express.json());

// ================================================================
// In-memory 캐시 (Serverless 환경 특성상 인스턴스별 한시 유지됨)
// ================================================================
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30분

function getCacheKey(prefix, params) {
  return prefix + ':' + JSON.stringify(params);
}

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
  // 캐시 최대 크기 제한
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// 환경변수에서 키 읽기
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || 'KOMV43YztpF2nsWry0Xz';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || 'VEZ_zQJkj8';
const ORS_API_KEY = process.env.ORS_API_KEY || '';

/**
 * [GET] 네이버 지역검색 API 프록시
 */
app.get('/api/search', async (req, res) => {
  try {
    const { query, display = 5, start = 1 } = req.query;
    if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다' });

    const cacheKey = getCacheKey('search', { query, display, start });
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=${display}&start=${start}&sort=random`;
    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      }
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    setCache(cacheKey, data);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * [POST] OpenRouteService Isochrone API 프록시
 */
app.post('/api/isochrone', async (req, res) => {
  try {
    const { lng, lat, range, profile = 'foot-walking' } = req.body;
    if (!lng || !lat || !range) return res.status(400).json({ error: '파라미터 누락(lng, lat, range)' });
    if (!ORS_API_KEY) return res.status(500).json({ error: 'ORS API Key가 설정되지 않았습니다' });

    const cacheKey = getCacheKey('isochrone', { lng: +lng.toFixed(5), lat: +lat.toFixed(5), range, profile });
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    const url = 'https://api.openrouteservice.org/v2/isochrones/' + profile;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        locations: [[lng, lat]],
        range: range,
        range_type: 'time',
        smoothing: 25
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    setCache(cacheKey, data);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vercel Serverless Function을 위해 express app을 export 합니다.
module.exports = app;

// 로컬 테스트를 위해 직접 실행된 경우에만 서버 시작
if (require.main === module) {
  const PORT = process.env.PORT || 3500;
  app.listen(PORT, () => console.log(`🚀 (Local) Proxy server running on http://localhost:${PORT}`));
}
