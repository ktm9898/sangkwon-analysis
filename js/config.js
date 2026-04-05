/**
 * 상권분석 앱 — 설정 데이터
 */
const CONFIG = {
  // 프록시 서버 URL
  PROXY_URL: 'http://localhost:3500',

  // 네이버 Maps Client ID (네이버 클라우드 플랫폼에서 발급)
  NAVER_MAP_CLIENT_ID: 'YOUR_NAVER_MAP_CLIENT_ID',

  // 기본 지도 중심 (서울시청)
  DEFAULT_CENTER: { lat: 37.5666, lng: 126.9784 },
  DEFAULT_ZOOM: 15,

  // 업종 목록 및 상권 설정
  BUSINESS_TYPES: {
    convenience: {
      label: '편의점',
      icon: '🏪',
      keyword: '편의점',
      isochrone: { primary: 180, secondary: 420, tertiary: 720 },   // 초 단위
      competitorRadius: 300, // 미터
      color: { primary: '#4CAF50', secondary: '#81C784', tertiary: '#C8E6C9' }
    },
    hair_salon: {
      label: '미용실',
      icon: '💇',
      keyword: '미용실',
      isochrone: { primary: 300, secondary: 600, tertiary: 1200 },
      competitorRadius: 500,
      color: { primary: '#E91E63', secondary: '#F06292', tertiary: '#F8BBD0' }
    },
    laundry: {
      label: '세탁소',
      icon: '👔',
      keyword: '세탁소',
      isochrone: { primary: 300, secondary: 600, tertiary: 900 },
      competitorRadius: 400,
      color: { primary: '#2196F3', secondary: '#64B5F6', tertiary: '#BBDEFB' }
    },
    restaurant: {
      label: '음식점',
      icon: '🍽️',
      keyword: '음식점',
      isochrone: { primary: 420, secondary: 900, tertiary: 1800 },
      competitorRadius: 600,
      color: { primary: '#FF9800', secondary: '#FFB74D', tertiary: '#FFE0B2' }
    },
    cafe: {
      label: '카페',
      icon: '☕',
      keyword: '카페',
      isochrone: { primary: 300, secondary: 720, tertiary: 1800 },
      competitorRadius: 500,
      color: { primary: '#795548', secondary: '#A1887F', tertiary: '#D7CCC8' }
    },
    academy: {
      label: '학원',
      icon: '📚',
      keyword: '학원',
      isochrone: { primary: 600, secondary: 1200, tertiary: 2700 },
      competitorRadius: 800,
      color: { primary: '#9C27B0', secondary: '#BA68C8', tertiary: '#E1BEE7' }
    }
  },

  // 히트맵 색상
  HEATMAP: {
    opportunity: '#00E676',   // 0 경쟁 (기회)
    moderate: '#FFD600',      // 1~2 경쟁 (보통)
    saturated: '#FF1744'      // 3+ 경쟁 (과밀)
  },

  // 격자 크기 (미터)
  GRID_SIZE: 50,

  // 캐시 TTL (밀리초)
  CACHE_TTL: 30 * 60 * 1000  // 30분
};
