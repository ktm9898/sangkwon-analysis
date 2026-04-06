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
    const apiResults = await searchByAPI(lat, lng, bt);

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

    console.log(`[검색] 최종 경쟁업체: ${merged.length}개 (API:${apiResults.length}, AI:${aiResults.length})`);
    if (onProgress) onProgress(`✅ 총 ${merged.length}개의 경쟁업체를 찾았습니다.`);

    return merged;
  }

  /**
   * 네이버 지역검색 API 기반 자동 탐색
   */
  async function searchByAPI(lat, lng, bt) {
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
    const searchPromises = [];

    keywordsToSearch.forEach((subKey) => {
      const exactQuery = regionName ? `${regionName} ${subKey}` : subKey;
      searchPromises.push(executeNaverSearch(exactQuery, allItems));

      if (regionName && regionName.match(/[0-9]+가$/)) {
        const broadRegion = regionName.replace(/[0-9]+가$/, '');
        searchPromises.push(executeNaverSearch(`${broadRegion} ${subKey}`, allItems));
      }
    });

    await Promise.all(searchPromises);

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
  async function scanMapWithAI(lat, lng, bt) {
    const mapState = MapManager.getMapState();
    const zoom = Math.max(mapState ? mapState.zoom : CONFIG.AI_SCAN_ZOOM, 16);

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
      throw new Error(err.error || 'AI 스캔 API 오류');
    }

    const data = await response.json();
    const storeNames = data.storeNames || [];

    if (storeNames.length === 0) return [];

    console.log(`[AI스캔] ${storeNames.length}개 점포명 추출:`, storeNames);

    // 각 점포명을 네이버 지역검색으로 좌표 확보 (병렬, 최대 50개)
    const searchTargets = storeNames.slice(0, 50);
    const aiItems = [];

    await Promise.all(searchTargets.map(async (name) => {
      try {
        const resp = await fetch(
          `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(name)}&display=1&start=1`
        );
        if (!resp.ok) return;
        const d = await resp.json();
        if (d.items && d.items.length > 0) {
          const converted = convertNaverItem(d.items[0]);
          if (converted) {
            converted.dist = getDistance(lat, lng, converted.lat, converted.lng);
            converted.source = 'ai';
            aiItems.push(converted);
          }
        }
      } catch (e) {
        // 개별 검색 실패 무시
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

  async function executeNaverSearch(query, allItems) {
    const PAGES = 15; // 키워드당 15페이지 수집 (15 * 10 = 150개)
    const DISPLAY = 10; // 네이버 로컬 API 한도

    for (let i = 0; i < PAGES; i++) {
      const start = (i * DISPLAY) + 1;
      const cacheBuster = `&_cb=${Date.now()}`;
      try {
        const response = await fetch(
          `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(query)}&display=${DISPLAY}&start=${start}${cacheBuster}`
        );
        if (!response.ok) break;
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          allItems.push(...data.items);
          if (data.items.length < DISPLAY) break; // 결과가 10개 미만이면 다음 페이지 없음
        } else {
          break;
        }
      } catch (e) {
        console.warn(`[검색] "${query}" 페이징(${start}) 권한 오류 또는 네트워크 실패:`, e.message);
        break;
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
