/**
 * 상권분석 앱 — CORS 프록시 서버
 * 네이버 검색 API + OpenRouteService API 프록시
 * + in-memory 캐시
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3500;

// CORS 허용
app.use(cors());
app.use(express.json());

// ================================================================
// In-memory 캐시
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

  // 캐시 크기 제한 (최대 500개)
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// ================================================================
// 네이버 검색 API — 환경변수에서 키 읽기
// ================================================================
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

/**
 * GET /api/search?query=강남역+카페&display=5&start=1
 */
app.get('/api/search', async (req, res) => {
  try {
    const { query, display = 5, start = 1 } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'query 파라미터가 필요합니다' });
    }

    // 캐시 확인
    const cacheKey = getCacheKey('search', { query, display, start });
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[캐시 HIT] 검색: ${query}`);
      return res.json(cached);
    }

    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=${display}&start=${start}&sort=random`;

    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[네이버 API 오류]', data);
      return res.status(response.status).json(data);
    }

    // 캐시 저장
    setCache(cacheKey, data);
    console.log(`[검색] "${query}" → ${data.items?.length || 0}건`);

    res.json(data);
  } catch (error) {
    console.error('[검색 프록시 오류]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// OpenRouteService Isochrone API
// ================================================================
const ORS_API_KEY = process.env.ORS_API_KEY || '';

/**
 * POST /api/isochrone
 * Body: { lng, lat, range: [180, 420, 720], profile: "foot-walking" }
 */
app.post('/api/isochrone', async (req, res) => {
  try {
    const { lng, lat, range, profile = 'foot-walking' } = req.body;

    if (!lng || !lat || !range) {
      return res.status(400).json({ error: 'lng, lat, range 파라미터가 필요합니다' });
    }

    // 캐시 확인
    const cacheKey = getCacheKey('isochrone', { lng: +lng.toFixed(5), lat: +lat.toFixed(5), range, profile });
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[캐시 HIT] 등시선: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      return res.json(cached);
    }

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

    if (!response.ok) {
      console.error('[ORS API 오류]', data);
      return res.status(response.status).json(data);
    }

    // 캐시 저장
    setCache(cacheKey, data);
    console.log(`[등시선] ${lat.toFixed(4)}, ${lng.toFixed(4)} → ${range.length}개 범위`);

    res.json(data);
  } catch (error) {
    console.error('[등시선 프록시 오류]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// 캐시 상태 확인
// ================================================================
app.get('/api/cache-stats', (req, res) => {
  res.json({
    entries: cache.size,
    maxEntries: 500,
    ttlMinutes: CACHE_TTL / 60000
  });
});

// ================================================================
// 서버 시작
// ================================================================
app.listen(PORT, () => {
  console.log(`\n🚀 상권분석 프록시 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   네이버 Client ID: ${NAVER_CLIENT_ID === 'YOUR_NAVER_CLIENT_ID' ? '❌ 미설정' : '✅ 설정됨'}`);
  console.log(`   ORS API Key:      ${ORS_API_KEY === 'YOUR_ORS_API_KEY' ? '❌ 미설정' : '✅ 설정됨'}`);
  console.log(`\n환경변수로 API 키 설정:`);
  console.log(`   set NAVER_CLIENT_ID=your_id`);
  console.log(`   set NAVER_CLIENT_SECRET=your_secret`);
  console.log(`   set ORS_API_KEY=your_key\n`);
});
