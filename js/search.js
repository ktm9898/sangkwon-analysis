/**
 * 상권분석 앱 — 경쟁업체 검색 (네이버 지역검색 API)
 * KATECH→WGS84 좌표 변환 포함
 */
const SearchManager = (() => {

  /**
   * 경쟁업체 검색
   * @returns {Array<{name, address, lat, lng, category, tel}>}
   */
  async function searchCompetitors(lat, lng, businessType) {
    const bt = CONFIG.BUSINESS_TYPES[businessType];
    if (!bt) throw new Error('알 수 없는 업종: ' + businessType);

    // 기준점 주변 지역명을 얻기 위해 역지오코딩 시도
    let regionName = '';
    try {
      regionName = await getRegionName(lat, lng);
    } catch (e) {
      console.warn('[검색] 역지오코딩 실패, 키워드만으로 검색:', e.message);
    }

    // 검색 쿼리: "지역명 + 업종키워드"
    const query = regionName ? `${regionName} ${bt.keyword}` : bt.keyword;

    // 네이버 검색 API는 한 번에 최대 5건, start 파라미터로 여러 번 호출
    const allItems = [];
    const maxPages = 5; // 최대 25건

    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await fetch(
          `${CONFIG.PROXY_URL}/api/search?query=${encodeURIComponent(query)}&display=5&start=${page}`
        );

        if (!response.ok) break;

        const data = await response.json();
        if (!data.items || data.items.length === 0) break;

        allItems.push(...data.items);
      } catch (e) {
        console.warn(`[검색] page ${page} 실패:`, e.message);
        break;
      }
    }

    console.log(`[검색] "${query}" → 총 ${allItems.length}건`);

    // 좌표 변환 + 필터링
    const competitors = allItems
      .map(item => convertNaverItem(item))
      .filter(c => c !== null)
      .filter(c => {
        // 기준점에서 너무 먼 업체 제외 (반경 2km)
        const dist = getDistance(lat, lng, c.lat, c.lng);
        return dist <= 2000;
      });

    // 중복 제거 (같은 이름 + 유사 좌표)
    const unique = deduplicateCompetitors(competitors);

    console.log(`[검색] 유효 경쟁업체: ${unique.length}개`);
    return unique;
  }

  /**
   * 네이버 검색 결과 아이템 → 경쟁업체 객체로 변환
   * KATECH → WGS84 좌표 변환 포함
   */
  function convertNaverItem(item) {
    try {
      const mapx = parseInt(item.mapx);
      const mapy = parseInt(item.mapy);

      if (!mapx || !mapy) return null;

      // 네이버 검색 API의 mapx, mapy는 WGS84 좌표에 10^7을 곱한 값
      const lat = mapy / 10000000;
      const lng = mapx / 10000000;

      // 유효 좌표 범위 체크 (한국 범위)
      if (lat < 33 || lat > 43 || lng < 124 || lng > 132) {
        return null;
      }

      return {
        name: stripHtml(item.title),
        address: item.roadAddress || item.address || '',
        lat,
        lng,
        category: item.category || '',
        tel: item.telephone || ''
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * HTML 태그 제거
   */
  function stripHtml(str) {
    return str ? str.replace(/<[^>]*>/g, '') : '';
  }

  /**
   * 역지오코딩 (네이버 지도 API)
   */
  async function getRegionName(lat, lng) {
    if (typeof naver === 'undefined' || !naver.maps) return '';

    return new Promise((resolve) => {
      naver.maps.Service.reverseGeocode({
        coords: new naver.maps.LatLng(lat, lng),
        orders: 'addr'
      }, (status, response) => {
        if (status !== naver.maps.Service.Status.OK) {
          resolve('');
          return;
        }

        const result = response.v2?.address;
        if (result) {
          // "서울특별시 강남구 역삼동" → "강남구 역삼동"
          const parts = [result.jibunAddress || ''].join(' ').split(' ');
          const region = parts.slice(1, 3).join(' '); // 구 + 동
          resolve(region);
        } else {
          resolve('');
        }
      });
    });
  }

  /**
   * 두 좌표 간 거리 (미터) — Haversine
   */
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

  /**
   * 중복 업체 제거
   */
  function deduplicateCompetitors(competitors) {
    const seen = new Map();

    for (const comp of competitors) {
      const key = comp.name;
      if (seen.has(key)) {
        const existing = seen.get(key);
        const dist = getDistance(comp.lat, comp.lng, existing.lat, existing.lng);
        if (dist < 50) continue; // 50m 이내 동일 이름 → 중복
      }
      seen.set(key, comp);
    }

    return Array.from(seen.values());
  }

  return { searchCompetitors };
})();
