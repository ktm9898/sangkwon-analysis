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

// 환경변수에서 키 읽기 (NCP 콘솔 명칭과 100% 일치시킴)
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

// Naver Maps (NCP) 서비스용 키
const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID || process.env.NAVER_CLIENT_ID || '';
const NAVER_MAP_CLIENT_SECRET = process.env.NAVER_MAP_CLIENT_SECRET || process.env.NAVER_MAP_SECRET || '';

const ORS_API_KEY = process.env.ORS_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

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

    // Step 1: 네이버 Static Map API로 지도 이미지 요청 (복수 줌 레벨)
    const mapWidth = 640;
    const mapHeight = 640;

    // Static Map URL (네이버 지도 Static API) - 마커를 제거하여 순수 글자 가독성 극대화 (scale=2)
    const staticMapUrl = `https://naveropenapi.apigw.ntruss.com/map-static/v2/raster?center=${lng},${lat}&level=${zoom}&w=${mapWidth}&h=${mapHeight}&format=jpg&maptype=basic&scale=2`;
    
    console.log('[AI스캔] 이미지 요청 URL:', staticMapUrl);

    let imageBase64 = null;
    try {
      const currentOrigin = 'https://sangkwon-analysis.vercel.app';
      const mapResp = await fetch(staticMapUrl, {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': NAVER_MAP_CLIENT_ID,
          'X-NCP-APIGW-API-KEY': NAVER_MAP_CLIENT_SECRET,
          'Referer': currentOrigin,
          'User-Agent': 'Mozilla/5.0 (Vercel Node.js Serverless)'
        }
      });

      if (mapResp.ok) {
        const mapBuffer = await mapResp.buffer();
        imageBase64 = mapBuffer.toString('base64');
        console.log(`[AI스캔] Static Map 이미지 획득 (${mapBuffer.length} bytes)`);
      } else {
        const errText = await mapResp.text();
        const checkID = NAVER_MAP_CLIENT_ID ? `${NAVER_MAP_CLIENT_ID.substring(0,3)}...${NAVER_MAP_CLIENT_ID.slice(-3)}` : '비어있음';
        const checkSecret = NAVER_MAP_CLIENT_SECRET ? `${NAVER_MAP_CLIENT_SECRET.substring(0,3)}...${NAVER_MAP_CLIENT_SECRET.slice(-3)}` : '비어있음';
        
        let customError = `NCP 인증 거절 (HTTP ${mapResp.status}). `;
        if (mapResp.status === 401) {
          customError += `\n\n--- [진단 가이드] ---\n1. NCP 콘솔의 키와 대조하세요:\n   ID: ${checkID}\n   Secret: ${checkSecret}\n2. NCP 콘솔 [Web 설정]에 등록된 도메인이\n   "${currentOrigin}" 인지 확인하세요!`;
        } else if (errText.includes('NotAllowedLocation')) {
          customError += `도메인("${currentOrigin}")이 등록되지 않았습니다.`;
        }
        
        return res.status(502).json({ error: customError });
      }
    } catch (e) {
      console.error('[AI스캔] Static Map 요청 중 치명적 오류:', e.message);
      return res.status(500).json({ error: '이미지 서버 연결 실패: ' + e.message });
    }

    if (!imageBase64) return; // 위에서 이미 리턴됨
    } catch (e) {
      console.error('[AI스캔] Static Map 요청 중 치명적 오류:', e.message);
      return res.status(500).json({ error: '이미지 서버 연결 실패: ' + e.message });
    }

    if (!imageBase64) return; 

    // Step 2: Gemini Vision API로 점포명 추출
    const brands = BRAND_CONTEXT[keyword] || '';
    const prompt = `당신은 대한민국 상권 분석 전문가입니다. 
제공된 지도 이미지에서 "${keyword}" 업종에 해당하는 모든 상점/점포 이름을 추출하세요.

**분석 지침:**
1. **타켓 업종**: "${keyword}" (주요 브랜드: ${brands})
2. **미션**: 지도에 텍스트로 표시된 모든 "${keyword}" 매장명을 찾아내세요. (예: "CU", "스타벅스", "김밥천국" 등)
3. **정기성**: 글자가 작아도 선명하다면 반드시 포함하세요.
4. **출력 형식**: 오직 JSON 배열로만 응답하세요. 예: ["매장A", "매장B", ...]
5. **금지**: 설명이나 인삿말 없이 오직 JSON만 출력하세요.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;

    const geminiPayload = {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        response_mime_type: "application/json"
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

    // JSON 파싱 (Gemini가 ```json ... ``` 형태로 반환할 수 있음)
    let storeNames = [];
    try {
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      storeNames = JSON.parse(cleanJson);
    } catch (e) {
      console.warn('[AI스캔] JSON 파싱 실패:', rawText);
    }

    // 유효성 검사 (문자열 배열)
    storeNames = storeNames.filter(s => typeof s === 'string' && s.trim().length > 0);

    console.log(`[AI스캔] Gemini 추출 점포명 ${storeNames.length}개:`, storeNames);

    const result = { storeNames, zoom };
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
