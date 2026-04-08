/**
 * 상권분석 앱 — Vercel Serverless Function (Express API)
 * 네이버 검색 API + OpenRouteService API 프록시 + Gemini Vision AI 스캔
 * + in-memory 캐시
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// CORS 허용 (모든 도메인 또는 배포 도메인)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ================================================================
// API Endpoint: /api/config (네이버 지도 SDK 설정용)
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

// 환경변수에서 키 읽기 (공백 제거 로직 추가)
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || '').trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || '').trim();

// Naver Maps (NCP) 서비스용 키
const NAVER_MAP_CLIENT_ID = (process.env.NAVER_MAP_CLIENT_ID || process.env.NAVER_CLIENT_ID || '').trim();
const NAVER_MAP_CLIENT_SECRET = (process.env.NAVER_MAP_CLIENT_SECRET || process.env.NAVER_MAP_SECRET || '').trim();

const ORS_API_KEY = (process.env.ORS_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();


console.log('--- [인증 진단 리포트] ---');
console.log('✅ 검색 API ID:', !!NAVER_CLIENT_ID ? '로드됨' : '미로드');
console.log('✅ 지도 API ID:', !!NAVER_MAP_CLIENT_ID ? '로드됨' : '미로드');
console.log('✅ 지도 API Secret:', !!NAVER_MAP_CLIENT_SECRET ? '로드됨' : '미로드');
if (!NAVER_MAP_CLIENT_SECRET) {
  console.warn('⚠️ 경고: NAVER_MAP_CLIENT_SECRET이 없습니다. AI 지도를 읽을 수 없습니다.');
}
console.log('------------------------');

// 상권별 대표 브랜드 (Gemini가 업종명만 보고 브랜드를 놓치지 않게 가이드)
const BRAND_CONTEXT = {
  '편의점': 'CU, GS25, 세븐일레븐, 이마트24, 미니스톱',
  '카페': '스타벅스, 투썸플레이스, 메가커피, 컴포즈커피, 이디야, 빽다방',
  '음식점': '맥도날드, 롯데리아, 버거킹, 서브웨이, BBQ, BHC',
  '미용실': '리안헤어, 준오헤어, 박승철헤어스투디오',
  '세탁소': '크린토피아, 월드크리닝',
  '학원': '보습학원, 코딩학원, 보습학원, 태권도장, 피아노학원'
};

// 서버 시작 시 환경변수 로딩 상태 확인 (보안상 일부만 노출)
if (NAVER_MAP_CLIENT_ID) {
  console.log('✅ NAVER_MAP_CLIENT_ID 감지됨:', NAVER_MAP_CLIENT_ID.substring(0, 3) + '***');
} else {
  console.warn('⚠️ NAVER_MAP_CLIENT_ID가 설정되지 않았습니다 (NCP Maps)');
}

/**
 * [GET] 네이버 지역검색 API 프록시
 */
app.get('/api/search', async (req, res) => {
  try {
    const { query, display = 30, start = 1 } = req.query;
    if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다' });

    const cacheKey = getCacheKey('search', { query, display, start });
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=${display > 30 ? 30 : display}&start=${start}&sort=sim`;
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

/**
 * Mercator 도법 변환을 위한 헬퍼 함수 (EPSG:3857)
 */
function latLngToWorld(lat, lng) {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin(lat * Math.PI / 180);
  // Web Mercator (EPSG:3857) 정밀 공식
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

function worldToLatLng(x, y) {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function getLatLngFromPixel(centerLat, centerLng, zoom, px, py, size = 1024) {
  const worldCenter = latLngToWorld(centerLat, centerLng);
  // 네이버/구글 맵의 줌 레벨에 따른 월드맵 전체 픽셀 크기
  const worldPixelSize = Math.pow(2, zoom) * 512;
  
  // 이미지 중심에서부터의 픽셀 거리 (0.5 단위로 정밀하게)
  const dx = (px - size / 2) / worldPixelSize;
  const dy = (py - size / 2) / worldPixelSize;
  
  const targetWorld = {
    x: worldCenter.x + dx,
    y: worldCenter.y + dy // y축은 아래가 큰 값이므로 더해주는 것이 맞음
  };
  
  return worldToLatLng(targetWorld.x, targetWorld.y);
}

/**
 * [POST] AI 지도 스캔 — 네이버 Static Map + Gemini Vision
 * 기준점 좌표 + 업종 → 지도 이미지 → Gemini가 점포명 추출
 */
app.post('/api/ai-scan', async (req, res) => {
  try {
    const { lat, lng, businessType, keyword, zoom = 17 } = req.body;
    if (!lat || !lng || !keyword) {
      return res.status(400).json({ error: '파라미터 누락 (lat, lng, keyword)' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API Key가 설정되지 않았습니다' });
    }

    // 캐시 키 (좌표 소수점 4자리 = 약 11m 정밀도)
    const cacheKey = getCacheKey('ai-scan', {
      lat: +lat.toFixed(4), lng: +lng.toFixed(4), businessType, zoom
    });
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log('[AI스캔] 캐시 HIT');
      return res.json(cached);
    }

    // Step 1: 네이버 Static Map API로 지도 이미지 요청
    let imageBase64 = null;
    
    // 프론트엔드에서 보낸 referer 혹은 요청 헤더의 referer/origin 사용
    // 1순위: 프론트엔드가 body에 담아 보낸 referer
    // 2순위: HTTP 요청 헤더의 referer
    // 3순위: 기본 상용 주소
    const currentReferer = req.body.referer || req.headers.referer || req.headers.origin || 'https://sangkwon-analysis.vercel.app/';
    
    console.log(`[AI스캔] 요청 접수 (Referer: ${currentReferer})`);

    // NCP는 상품 종류에 따라 두 가지 도메인을 번갈아 써야 할 때가 있습니다. (210 에러 방지용)
    const mapWidth = 1024; 
    const mapHeight = 1024;
    const endpoints = [
      'https://maps.apigw.ntruss.com/map-static/v2/raster',
      'https://maps.apigw.ntruss.com/map-static/v2/raster-cors',
      'https://naveropenapi.apigw.ntruss.com/map-static/v2/raster'
    ];

    try {
      let lastErrorText = '';
      for (const baseUrl of endpoints) {
        // scale=1을 사용하여 1024x1024의 최대 가용 영역 확보 (반경 500m 커버)
        const fullUrl = `${baseUrl}?center=${lng},${lat}&level=${zoom}&w=${mapWidth}&h=${mapHeight}&format=jpg&maptype=basic&scale=1`;
        console.log(`[AI스캔] NCP 호출 시도: ${baseUrl} (Referer: ${currentReferer})`);

        const mapResp = await fetch(fullUrl, {
          headers: {
            'X-NCP-APIGW-API-KEY-ID': NAVER_MAP_CLIENT_ID,
            'X-NCP-APIGW-API-KEY': NAVER_MAP_CLIENT_SECRET,
            'Referer': currentReferer,
            'User-Agent': 'Mozilla/5.0'
          }
        });

        if (mapResp.ok) {
          const mapBuffer = await mapResp.buffer();
          imageBase64 = mapBuffer.toString('base64');
          console.log(`[AI스캔] Static Map 획득 성공 (${baseUrl})`);
          break; // 성공 시 루프 탈출
        } else {
          lastErrorText = await mapResp.text();
          console.warn(`[AI스캔] ${baseUrl} 실패: ${mapResp.status} ${lastErrorText}`);
        }
      }

      if (!imageBase64) {
        const checkID = NAVER_MAP_CLIENT_ID ? `${NAVER_MAP_CLIENT_ID.substring(0,3)}...` : 'N/A';
        const msg = `NCP 지도 호출 실패 (${lastErrorText})`;
        const lastAttemptedUrl = `${endpoints[endpoints.length-1]}?center=${lng},${lat}&level=${zoom}...`;
        
        return res.status(502).json({ 
          error: msg,
          details: {
            refererUsed: currentReferer,
            naverId: checkID,
            ncpError: lastErrorText,
            debugUrl: lastAttemptedUrl
          }
        });
      }
    } catch (e) {
      console.error('[AI스캔] Static Map 요청 중 치명적 오류:', e.message);
      return res.status(500).json({ error: '이미지 서버 연결 실패: ' + e.message });
    }

    if (!imageBase64) return;

    // Step 2: Gemini Vision API로 점포명 추출
    const brands = BRAND_CONTEXT[keyword] || '';
    const prompt = `지도에서 "${keyword}"(브랜드: ${brands}) 매장을 모두 찾아 JSON으로만 출력하세요. 
형식: [{"name":"이름","x":숫자,"y":숫자},...]
중요: 공백 없이 촘촘하게(Minified) 출력하고, 인삿말 없이 결과만 뱉으세요.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;

    const geminiPayload = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32768 // 32k 수준으로 화끈하게 상향
      }
    };

    const geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    if (!geminiResp.ok) {
      const errData = await geminiResp.json();
      console.error('[AI스캔] Gemini API 오류:', errData);
      return res.status(502).json({ error: 'Gemini API 오류: ' + (errData.error?.message || '알 수 없는 오류') });
    }

    const geminiData = await geminiResp.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // 정밀 파싱 (내용이 잘려도 정규식으로 유효한 객체만 추출)
    let foundStores = [];
    try {
      const storeRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"x"\s*:\s*(\d+)\s*,\s*"y"\s*:\s*(\d+)\s*\}/g;
      let match;
      while ((match = storeRegex.exec(rawText)) !== null) {
        const name = match[1];
        const x = parseInt(match[2]);
        const y = parseInt(match[3]);
        
        // 픽셀 좌표 변환 및 지리적 좌표 생성
        const px = (x / 1000) * 1024;
        const py = (y / 1000) * 1024;
        const geo = getLatLngFromPixel(lat, lng, zoom, px, py, 1024);
        
        foundStores.push({
          name,
          lat: geo.lat,
          lng: geo.lng,
          pixelX: x,
          pixelY: y
        });
      }
      
      // 혹시 정규식으로 안 되면 기존 JSON.parse 시도 (백업)
      if (foundStores.length === 0) {
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const rawStores = JSON.parse(cleanJson);
        if (Array.isArray(rawStores)) {
          foundStores = rawStores.map(s => {
            if (!s.name || s.x === undefined || s.y === undefined) return null;
            const px = (s.x / 1000) * 1024;
            const py = (s.y / 1000) * 1024;
            const geo = getLatLngFromPixel(lat, lng, zoom, px, py, 1024);
            return { name: s.name, lat: geo.lat, lng: geo.lng, pixelX: s.x, pixelY: s.y };
          }).filter(s => s !== null);
        }
      }
    } catch (e) {
      console.warn('[AI스캔] 파싱 오류 (일부 추출 시도):', e.message);
    }

    console.log(`[AI스캔] 분석 완료: ${foundStores.length}개 점포 위치 특정`);

    const result = { storeNames: foundStores.map(s => s.name), stores: foundStores, zoom, rawText };
    setCache(cacheKey, result);
    res.json(result);

  } catch (error) {
    console.error('[AI스캔] 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * [GET] 공개 설정값 (네이버 지도 Client ID 등)
 * 프론트엔드가 지도를 동적으로 로드할 때 사용
 */
app.get('/api/config', (req, res) => {
  res.json({
    naverMapClientId: NAVER_MAP_CLIENT_ID
  });
});

// Vercel Serverless Function을 위해 express app을 export 합니다.
module.exports = app;

// 로컬 테스트를 위해 직접 실행된 경우에만 서버 시작
if (require.main === module) {
  const PORT = process.env.PORT || 3500;
  app.listen(PORT, () => console.log(`🚀 (Local) Proxy server running on http://localhost:${PORT}`));
}
