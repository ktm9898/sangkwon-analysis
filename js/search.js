/**
 * 상권분석 앱 — 경쟁업체 검색 (네이버 지역검색 API + Gemini AI 스캔 병행)
 */
const SearchManager = (() => {

  /**
   * 경쟁업체 자동 탐색 (API + AI 스캔 병행)
   * @param {number} lat
   * @param {number} lng
   * @param {string} businessType
   * @param {Function} onProgress - 진행상황 콜백(message)
   * @returns {Array<{name, address, lat, lng, category, tel, dist, source}>}
   */
  async function searchCompetitors(lat, lng, businessType, onProgress) {
    const bt = CONFIG.BUSINESS_TYPES[businessType];
    if (!bt) throw new Error('알 수 없는 업종: ' + businessType);

    if (onProgress) onProgress('📡 API 검색 중...');

    // --- 1) 네이버 지역검색 API ---
    const apiResults = await searchByAPI(lat, lng, bt, onProgress);

    // --- 2) Gemini AI 지도 스캔 (지역명 정보를 넘겨서 더 정확한 매칭 도모)
    let aiResults = [];
    try {
      if (onProgress) onProgress('🤖 AI 지도 스캔 중...');
      const regionName = apiResults.regionName || '';
      aiResults = await scanMapWithAI(lat, lng, bt, onProgress, regionName);
    } catch (e) {
      console.warn('[AI스캔] 실패, API 결과만 사용:', e.message);
      if (onProgress) onProgress('⚠️ AI 스캔 실패, API 결과 사용');
    }

    // --- 3) 병합 + 중복 제거 ---
    const merged = mergeAndDeduplicate(apiResults, aiResults, lat, lng);
    merged.regionName = apiResults.regionName || '';

    const rawTotal = apiResults.length + aiResults.length;
    console.log(`[검색] 최종 경쟁업체: ${merged.length}개 (AI포함 수집: ${rawTotal}, 중복제거/반경필터 후: ${merged.length})`);
    
    if (onProgress) {
      onProgress(`✅ ${rawTotal}건의 후보지 중 중복/오차 제거 후 최적의 **${merged.length}개**를 찾았습니다.`);
    }

    return merged;
  }

  /**
   * 네이버 지역검색 API 기반 자동 탐색
   */
  async function searchByAPI(lat, lng, bt, onProgress) {
    let regionName = '';
    try {
      regionName = await getRegionName(lat, lng);
    } catch (e) {
      console.warn('[검색] 역지오코딩 실패:', e.message);
    }

    const keywordsToSearch = bt.subKeywords && bt.subKeywords.length > 0
      ? bt.subKeywords
      : [bt.keyword];

    const allItems = [];
    
    // 속도와 429 방어를 동시에 잡기 위해 50ms 짧은 대기시간을 둔 순차 검색 수행
    for (const subKey of keywordsToSearch) {
      await executeNaverSearch(subKey, allItems, onProgress);
      await wait(50); // 아주 짧은 지연 (네이버 차단 방지)
    }

    const competitors = allItems
      .map(item => convertNaverItem(item))
      .filter(c => c !== null)
      .map(c => {
        c.dist = getDistance(lat, lng, c.lat, c.lng);
        c.source = 'api';
        return c;
      })
      .filter(c => c.dist <= 2000);

    const unique = deduplicateByNameAndCoord(competitors);
    console.log(`[API검색] 유효 경쟁업체: ${unique.length}개 (지역: ${regionName})`);
    unique.regionName = regionName;
    return unique;
  }

  /**
   * Gemini Vision AI 지도 스캔 → 점포명 추출 → 좌표 변환
   */
  async function scanMapWithAI(lat, lng, bt, onProgress, regionName = '') {
    const scanZoom = 17; // 고정된 줌 레벨 (반경 500m 수색 최적화)

    let storeNames = [];
    let aiStores = [];
    try {
      if (onProgress) onProgress(`🔍 AI 지도 정밀 스캔 중... (${bt.keyword})`);
      
      const response = await fetch(`${CONFIG.PROXY_URL}/api/ai-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat, lng,
          businessType: bt.keyword,
          keyword: bt.keyword,
          zoom: scanZoom, // 고정된 줌 레벨 전달
          referer: window.location.href // 현재 도메인 정보 전달
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      aiStores = data.stores || [];
      if (data.rawText) {
        console.log('[AI스캔] AI 응답 원문:', data.rawText);
      }
      if (onProgress) onProgress(`✅ AI 스캔 완료 (${aiStores.length}개 위치 특정)`);
    } catch (e) {
      console.warn('[AI스캔] 실패:', e.message);
      if (onProgress) onProgress(`⚠️ AI 스캔 실패: ${e.message}`);
      return [];
    }

    if (aiStores.length === 0) {
      console.log('[AI스캔] AI가 이미지에서 상점을 발견하지 못했습니다. (0개)');
      return [];
    }

    console.log(`[AI스캔] AI 데이터 수신 성공! ${aiStores.length}개 업체를 발견함.`);
    console.table(aiStores);

    // 각 점포 정보를 기반으로 상세 데이터 보완 (병렬)
    const aiItems = [];
    await Promise.all(aiStores.map(async (store) => {
      const name = store.name;
      try {
        // 1순위: AI가 찾은 이름으로 네이버 지역검색 시도
        const regionContext = regionName || '';
        const searchQuery = `${regionContext} ${name}`.trim();
        const url = `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(searchQuery)}&display=5&start=1&_cb=${Date.now()}`;
        const resp = await fetch(url);
        
        let bestMatch = null;
        if (resp.ok) {
          const d = await resp.json();
          if (d.items && d.items.length > 0) {
            let minOffset = Infinity;
            for (const item of d.items) {
              const converted = convertNaverItem(item);
              if (!converted) continue;
              const offset = getDistance(store.lat, store.lng, converted.lat, converted.lng);
              // 100m 이내 매칭 성공 시 보정 데이터로 활용
              if (offset < 100 && offset < minOffset) {
                minOffset = offset;
                bestMatch = converted;
              }
            }
          }
        }

        if (bestMatch) {
          // [중요] 캘리브레이션을 위해 API 공식 좌표와 AI 시각 좌표를 함께 보관
          aiItems.push({
            ...bestMatch,
            visualLat: store.lat, 
            visualLng: store.lng,
            apiLat: bestMatch.lat,
            apiLng: bestMatch.lng,
            lat: store.lat, // 임시로 시각적 위치 사용
            lng: store.lng,
            source: 'ai'
          });
        } else {
          // 검색 결과 없음: AI가 추출한 시각적 좌표 사용
          aiItems.push({
            name: name,
            address: '주소 정보 없음 (AI 스캔)',
            lat: store.lat,
            lng: store.lng,
            visualLat: store.lat,
            visualLng: store.lng,
            category: bt.keyword,
            tel: '',
            dist: getDistance(lat, lng, store.lat, store.lng),
            source: 'ai'
          });
        }
      } catch (e) {
        console.error(`[AI스캔] "${name}" 처리 에러:`, e.message);
      }
    }));

    // --- 전역 영점 조정 (Global Calibration) ---
    // 매칭된 샘플들을 통해 "현재 AI가 평균적으로 얼마나 삐뚤게 보고 있는지" 계산합니다.
    const samples = aiItems.filter(item => item.apiLat && item.visualLat);
    if (samples.length > 0) {
      let sumDLat = 0, sumDLng = 0;
      samples.forEach(s => {
        sumDLat += (s.apiLat - s.visualLat);
        sumDLng += (s.apiLng - s.visualLng);
      });
      
      const avgDLat = sumDLat / samples.length;
      const avgDLng = sumDLng / samples.length;
      
      console.log(`[AI스캔] 전역 영점 조정 적용: 위도 ${avgDLat.toFixed(6)}, 경도 ${avgDLng.toFixed(6)}`);
      
      // 검색 결과가 없는 '순수 AI 발견 매장'들에게 이 공통 오차를 적용하여 위치 보정
      aiItems.forEach(item => {
        if (!item.apiLat) {
          item.lat += avgDLat;
          item.lng += avgDLng;
          item.dist = getDistance(lat, lng, item.lat, item.lng);
        } else {
          // 이미 매칭된 곳은 검증된 API 좌표를 사용 (가장 정확함)
          item.lat = item.apiLat;
          item.lng = item.apiLng;
        }
      });
    }

    // 2km 이내만 수집
    return aiItems.filter(c => c.dist <= 2000);
  }

  /**
   * 사용자 수동 키워드 검색 (탭3 검색창)
   * @returns {Array<{name, address, lat, lng, category, tel, dist}>}
   */
  async function searchByKeyword(keyword, baseLat, baseLng) {
    if (!keyword || keyword.trim().length === 0) return [];

    const response = await fetch(
      `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(keyword.trim())}&display=20&start=1`
    );
    if (!response.ok) return [];

    const data = await response.json();
    if (!data.items || data.items.length === 0) return [];

    const results = data.items
      .map(item => convertNaverItem(item))
      .filter(c => c !== null)
      .map(c => {
        if (baseLat && baseLng) {
          c.dist = getDistance(baseLat, baseLng, c.lat, c.lng);
        }
        c.source = 'manual';
        return c;
      });

    // 기준점 거리순으로 정렬하여 반환
    if (baseLat && baseLng) {
      results.sort((a, b) => a.dist - b.dist);
    }
    return results;
  }

  // ============================================================
  // 내부 헬퍼 함수들
  // ============================================================

  // 지연 함수 (429 방지용)
  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  async function executeNaverSearch(keyword, allItems, onProgress) {
    const queries = [keyword, `주변 ${keyword}`];
    
    // 쿼리별 병렬 실행
    await Promise.all(queries.map(async (q) => {
      const DISPLAY = 5; // 네이버 지역검색 API의 최대 한도는 5입니다.
      const PAGES = 6;   // 총 30개 수집
      
      const pageIndexes = Array.from({ length: PAGES }, (_, i) => i);
      
      // 페이지별 병렬 실행
      await Promise.all(pageIndexes.map(async (i) => {
        const start = (i * DISPLAY) + 1;
        const url = `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(q)}&display=${DISPLAY}&start=${start}&sort=sim&_cb=${Date.now()}`;
        
        try {
          // 너무 동시에 요청하면 429 오류가 날 수 있으므로 아주 짧은 랜덤 대기 부여
          await wait(Math.random() * 200);
          
          const response = await fetch(url);
          if (!response.ok) return;

          const data = await response.json();
          if (data.items && data.items.length > 0) {
            allItems.push(...data.items);
            if (onProgress) onProgress(`🔍 탐색 중... (${allItems.length}개 발견)`);
          }
        } catch (e) {
          console.error('[Naver API] 오류:', e);
        }
      }));
    }));
  }

  /**
   * API 결과 + AI 결과 병합 및 중복 제거
   */
  function mergeAndDeduplicate(apiResults, aiResults, baseLat, baseLng) {
    // API 결과 우선
    const combined = [...apiResults];

    aiResults.forEach(aiItem => {
      // API 결과 중 가장 가까운 항목 찾기 (위치 기반)
      let minDistance = Infinity;
      let closestItem = null;

      combined.forEach(existing => {
        const d = getDistance(existing.lat, existing.lng, aiItem.lat, aiItem.lng);
        if (d < minDistance) {
          minDistance = d;
          closestItem = existing;
        }
      });

      // 반경 15m 이내에 이미 같은 상호명이 있거나, 아주 가까운(10m 이내) 마커가 있으면 중복 처리
      const isSpatialDuplicate = (minDistance < 10);
      const isNameAndNearMatch = (minDistance < 25 && closestItem && closestItem.name === aiItem.name);

      if (!isSpatialDuplicate && !isNameAndNearMatch) {
         // 중복이 아니면 추가
         combined.push(aiItem);
      }
    });

    // 거리 재계산 후 정렬
    combined.forEach(c => {
      if (!c.dist) c.dist = getDistance(baseLat, baseLng, c.lat, c.lng);
    });

    combined.sort((a, b) => a.dist - b.dist);
    return combined;
  }

  /**
   * 네이버 검색 결과 아이템 → 경쟁업체 객체
   */
  function convertNaverItem(item) {
    try {
      const mapx = parseInt(item.mapx);
      const mapy = parseInt(item.mapy);
      if (!mapx || !mapy) return null;

      const lat = mapy / 10000000;
      const lng = mapx / 10000000;

      if (lat < 33 || lat > 43 || lng < 124 || lng > 132) return null;

      return {
        name: stripHtml(item.title),
        address: item.roadAddress || item.address || '',
        lat,
        lng,
        category: item.category || '',
        tel: item.telephone || '',
        source: 'api'
      };
    } catch (e) {
      return null;
    }
  }

  function stripHtml(str) {
    return str ? str.replace(/<[^>]*>/g, '') : '';
  }

  function requestReverseGeocode(lat, lng, orders) {
    return new Promise((resolve) => {
      naver.maps.Service.reverseGeocode({
        coords: new naver.maps.LatLng(lat, lng),
        orders: orders
      }, (status, response) => {
        if (status !== naver.maps.Service.Status.OK) { resolve(null); return; }
        const results = response.v2?.results;
        if (results && results.length > 0) {
          const r = results[0].region;
          const gu = r?.area2?.name || '';
          const dong = r?.area3?.name || '';
          resolve(`${gu} ${dong}`.trim() || null);
        } else {
          resolve(null);
        }
      });
    });
  }

  async function getRegionName(lat, lng) {
    let regionStr = null;

    if (typeof naver !== 'undefined' && naver.maps) {
      regionStr = await requestReverseGeocode(lat, lng, 'addr');
      if (!regionStr) regionStr = await requestReverseGeocode(lat, lng, 'legalcode');
    }

    if (!regionStr) {
      try {
        const osmRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        if (osmRes.ok) {
          const osmData = await osmRes.json();
          if (osmData?.address) {
            const gu = osmData.address.borough || osmData.address.city || '';
            const dong = osmData.address.suburb || osmData.address.quarter || '';
            regionStr = `${gu} ${dong}`.trim();
          }
        }
      } catch (e) {
        console.warn('[검색] OSM 폴백 실패:', e.message);
      }
    }

    return regionStr || '';
  }

  function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function deduplicateByNameAndCoord(competitors) {
    const uniqueList = [];
    for (const comp of competitors) {
      const isDuplicate = uniqueList.some(existing => {
        const isSameName = existing.name === comp.name;
        const dist = getDistance(comp.lat, comp.lng, existing.lat, existing.lng);
        // 이름이 완전히 같으면서 거리가 5m 이내인 것만 중복 제거
        return isSameName && dist < 5;
      });
      
      if (!isDuplicate) {
        uniqueList.push(comp);
      }
    }
    return uniqueList;
  }

  return {
    searchCompetitors,
    searchByKeyword,
    scanMapWithAI: (lat, lng, bt, onProgress, region) => 
      scanMapWithAI(lat, lng, CONFIG.BUSINESS_TYPES[bt] || { keyword: bt }, onProgress, region)
  };
})();
