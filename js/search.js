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

    // --- 2) Gemini AI 지도 스캔 ---
    let aiResults = [];
    try {
      if (onProgress) onProgress('🤖 AI 지도 스캔 중...');
      aiResults = await scanMapWithAI(lat, lng, bt);
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
      const exactQuery = regionName ? `${regionName} ${subKey}` : subKey;
      await executeNaverSearch(exactQuery, allItems, onProgress);
      await wait(50); // 아주 짧은 지연 (네이버 차단 방지)

      if (regionName && regionName.match(/[0-9]+가$/)) {
        const broadRegion = regionName.replace(/[0-9]+가$/, '');
        await executeNaverSearch(`${broadRegion} ${subKey}`, allItems, onProgress);
        await wait(50);
      }
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
  async function scanMapWithAI(lat, lng, bt, onProgress) {
    const mapState = MapManager.getMapState();
    const zoom = Math.max(mapState ? mapState.zoom : CONFIG.AI_SCAN_ZOOM, 16);

    let storeNames = [];
    try {
      if (onProgress) onProgress(`🔍 AI 지도 정밀 스캔 중... (${bt.keyword})`);
      
      const response = await fetch(`${CONFIG.PROXY_URL}/api/ai-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat, lng,
          businessType: bt.keyword,
          keyword: bt.keyword,
          zoom
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      storeNames = data.storeNames || [];
      if (onProgress) onProgress(`✅ AI 스캔 완료 (${storeNames.length}개 추가 발견)`);
    } catch (e) {
      console.warn('[AI스캔] 실패:', e.message);
      if (onProgress) onProgress(`⚠️ AI 스캔 실패: ${e.message}`);
      return [];
    }

    if (storeNames.length === 0) return [];

    console.log(`[AI스캔] ${storeNames.length}개 점포명 추출:`, storeNames);

    // 각 점포명을 네이버 지역검색으로 좌표 확보 (병렬, 최대 30개)
    const searchTargets = storeNames.slice(0, 30);
    const aiItems = [];

    await Promise.all(searchTargets.map(async (name) => {
      try {
        // AI가 찾은 이름 그대로 검색 (정확도를 위해 display=5로 넉넉히 수집 후 거리순 필터링)
        const url = `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(name)}&display=5&start=1&_cb=${Date.now()}`;
        const resp = await fetch(url);
        if (!resp.ok) return;
        const d = await resp.json();
        
        if (d.items && d.items.length > 0) {
          // AI가 찾은 이름과 가장 유사하거나 가까운 첫 번째 결과 채택
          const converted = convertNaverItem(d.items[0]);
          if (converted) {
            converted.dist = getDistance(lat, lng, converted.lat, converted.lng);
            converted.source = 'ai';
            aiItems.push(converted);
          }
        } else {
          console.log(`[AI스캔] "${name}"의 좌표를 찾지 못했습니다.`);
        }
      } catch (e) {
        console.error(`[AI스캔] "${name}" 변환 에러:`, e.message);
      }
    }));

    // 2km 이내만
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

    return data.items
      .map(item => convertNaverItem(item))
      .filter(c => c !== null)
      .map(c => {
        if (baseLat && baseLng) {
          c.dist = getDistance(baseLat, baseLng, c.lat, c.lng);
        }
        c.source = 'manual';
        return c;
      });
  }

  // ============================================================
  // 내부 헬퍼 함수들
  // ============================================================

  // 지연 함수 (429 방지용)
  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  async function executeNaverSearch(keyword, allItems, onProgress) {
    const queries = [keyword, `근처 ${keyword}`, `주변 ${keyword}`];
    if (onProgress) onProgress(`🔍 네이버 API 정밀 수색 중...`);

    for (const q of queries) {
      const DISPLAY = 5; 
      const PAGES = 10;  // 15에서 10으로 조정하여 속도 조절
      
      for (let i = 0; i < PAGES; i++) {
        const start = (i * DISPLAY) + 1;
        const url = `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(q)}&display=${DISPLAY}&start=${start}&sort=sim&_cb=${Date.now()}`;
        
        try {
          // 429 방지를 위해 요청 당 250ms 대기 (더욱 안전하게)
          await wait(250);
          
          const response = await fetch(url);
          
          if (response.status === 429) {
            if (onProgress) onProgress(`⏳ API 속도 제한 발생, 잠시 대기 중...`);
            await wait(1000); // 1초 대기 후 재시도 없음(다음 쿼리로)
            break;
          }

          if (!response.ok) break;
          const data = await response.json();
          if (data.items && data.items.length > 0) {
            allItems.push(...data.items);
            if (onProgress) onProgress(`🔍 탐색 중... (${allItems.length}개 발견)`);
            if (data.items.length < DISPLAY) break; 
          } else {
            break;
          }
        } catch (e) {
          console.error('[Naver API] 오류:', e);
          break;
        }
      }
    }
  }

  /**
   * API 결과 + AI 결과 병합 및 중복 제거
   */
  function mergeAndDeduplicate(apiResults, aiResults, baseLat, baseLng) {
    // API 결과 우선, AI 결과로 보완
    const combined = [...apiResults];

    aiResults.forEach(aiItem => {
      // API 결과에 이미 같은 위치/이름이 있으면 스킵
      const isDuplicate = combined.some(existing => {
        const dist = getDistance(existing.lat, existing.lng, aiItem.lat, aiItem.lng);
        // 이름이 같고 5m 이내인 경우만 중복으로 간주
        return (existing.name === aiItem.name) && (dist < 5);
      });

      if (!isDuplicate) {
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
    scanMapWithAI: (lat, lng, bt) => scanMapWithAI(lat, lng, CONFIG.BUSINESS_TYPES[bt] || { keyword: bt })
  };
})();
