/**
 * 상권분석 앱 — 등시선 분석 (OpenRouteService)
 */
const IsochroneManager = (() => {
  // localStorage 캐시
  const CACHE_PREFIX = 'isochrone_';

  function getCacheKey(lat, lng, businessType) {
    return CACHE_PREFIX + `${lat.toFixed(5)}_${lng.toFixed(5)}_${businessType}`;
  }

  function getFromLocalCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.timestamp > CONFIG.CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  function setLocalCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      // localStorage 용량 초과 시 이전 캐시 정리
      clearOldCache();
    }
  }

  function clearOldCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    // 절반 삭제
    keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
  }

  /**
   * 등시선 데이터 요청
   * @returns {Array} GeoJSON Feature 배열 [3차, 2차, 1차] (큰 것부터)
   */
  async function getIsochrone(lat, lng, businessType) {
    const bt = CONFIG.BUSINESS_TYPES[businessType];
    if (!bt) throw new Error('알 수 없는 업종: ' + businessType);

    // 캐시 확인
    const cacheKey = getCacheKey(lat, lng, businessType);
    const cached = getFromLocalCache(cacheKey);
    if (cached) {
      console.log('[등시선] 로컬 캐시 HIT');
      return cached;
    }

    const range = [bt.isochrone.primary, bt.isochrone.secondary, bt.isochrone.tertiary];

    const response = await fetch(`${CONFIG.PROXY_URL}/api/isochrone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, range })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '등시선 API 요청 실패');
    }

    const data = await response.json();

    // ORS는 features를 range 역순(큰것→작은것)으로 반환
    // 지도에 그릴 때도 큰 것 먼저 그려야 작은 것이 위에 표시됨
    const features = data.features || [];

    // 캐시 저장
    setLocalCache(cacheKey, features);
    console.log(`[등시선] ${features.length}개 범위 수신`);

    return features;
  }

  return { getIsochrone };
})();
