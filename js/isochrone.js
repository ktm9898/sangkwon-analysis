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
   * @param {number} lat
   * @param {number} lng
   * @param {string} businessType
   * @param {{ primary, secondary, tertiary } | null} isoOverride - 슬라이더로 조정된 값(초 단위), 없으면 config 기본값
   * @returns {Array} GeoJSON Feature 배열
   */
  async function getIsochrone(lat, lng, businessType, isoOverride) {
    const bt = CONFIG.BUSINESS_TYPES[businessType];
    if (!bt) throw new Error('알 수 없는 업종: ' + businessType);

    const iso = isoOverride || bt.isochrone;
    const range = [iso.primary, iso.secondary, iso.tertiary];

    // 캐시 키에 range 포함 (슬라이더 값이 다르면 다른 캐시)
    const cacheKey = getCacheKey(lat, lng, businessType) + `_${range.join('_')}`;
    const cached = getFromLocalCache(cacheKey);
    if (cached) {
      console.log('[등시선] 로컬 캐시 HIT');
      return cached;
    }

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
    const features = data.features || [];

    // 캐시 저장
    setLocalCache(cacheKey, features);
    console.log(`[등시선] ${features.length}개 범위 수신 (${range.map(r => Math.round(r/60)+'분').join('/')})`);

    return features;
  }

  return { getIsochrone };
})();
