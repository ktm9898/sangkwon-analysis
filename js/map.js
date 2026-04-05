/**
 * 상권분석 앱 — 네이버 지도 관리
 */
const MapManager = (() => {
  let map = null;
  let baseMarker = null;
  let competitorMarkers = [];
  let isochronePolygons = [];
  let competitorCircles = [];
  let heatmapRects = [];
  let topLocationMarkers = [];

  /**
   * 지도 초기화
   */
  function init() {
    const mapOptions = {
      center: new naver.maps.LatLng(CONFIG.DEFAULT_CENTER.lat, CONFIG.DEFAULT_CENTER.lng),
      zoom: CONFIG.DEFAULT_ZOOM,
      mapTypeControl: false,
      scaleControl: true,
      zoomControl: true,
      zoomControlOptions: {
        position: naver.maps.Position.RIGHT_CENTER,
        style: naver.maps.ZoomControlStyle.SMALL
      },
      mapDataControl: false,
      logoControlOptions: {
        position: naver.maps.Position.BOTTOM_RIGHT
      }
    };

    map = new naver.maps.Map('map', mapOptions);

    // 지도 클릭 이벤트
    naver.maps.Event.addListener(map, 'click', (e) => {
      setBaseMarker(e.coord);
    });
  }

  /**
   * 기준점 마커 설정
   */
  function setBaseMarker(latlng) {
    if (baseMarker) {
      baseMarker.setPosition(latlng);
    } else {
      baseMarker = new naver.maps.Marker({
        position: latlng,
        map: map,
        icon: {
          content: `
            <div style="
              width: 40px; height: 40px;
              background: linear-gradient(135deg, #6c5ce7, #a29bfe);
              border: 3px solid #fff;
              border-radius: 50%;
              box-shadow: 0 2px 12px rgba(108,92,231,0.5);
              display: flex; align-items: center; justify-content: center;
              color: #fff; font-size: 18px;
            ">📍</div>
          `,
          size: new naver.maps.Size(40, 40),
          anchor: new naver.maps.Point(20, 20)
        },
        zIndex: 100
      });
    }

    // UI에 좌표 표시
    UiManager.updateCoordinates(latlng.lat(), latlng.lng());
    UiManager.enableAnalyzeButton();
  }

  /**
   * 기준점 좌표 반환
   */
  function getBasePosition() {
    if (!baseMarker) return null;
    const pos = baseMarker.getPosition();
    return { lat: pos.lat(), lng: pos.lng() };
  }

  /**
   * 등시선 다각형을 지도에 그리기 (GeoJSON)
   */
  function drawIsochrone(geojsonFeatures, colors) {
    clearIsochrones();

    geojsonFeatures.forEach((feature, index) => {
      if (!feature || !feature.geometry) return;

      const coords = feature.geometry.coordinates[0];
      const path = coords.map(c => new naver.maps.LatLng(c[1], c[0]));
      const color = colors[index] || '#6c5ce7';

      const polygon = new naver.maps.Polygon({
        map: map,
        paths: [path],
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.8,
        fillColor: color,
        fillOpacity: 0.12,
        zIndex: 10 - index
      });

      isochronePolygons.push(polygon);
    });
  }

  /**
   * 경쟁업체 마커 표시
   */
  function drawCompetitorMarkers(competitors, businessType) {
    clearCompetitorMarkers();

    const config = CONFIG.BUSINESS_TYPES[businessType];

    competitors.forEach((comp, idx) => {
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(comp.lat, comp.lng),
        map: map,
        icon: {
          content: `
            <div style="
              width: 28px; height: 28px;
              background: ${config.color.primary};
              border: 2px solid rgba(255,255,255,0.9);
              border-radius: 50%;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex; align-items: center; justify-content: center;
              font-size: 14px; cursor: pointer;
            ">${config.icon}</div>
          `,
          size: new naver.maps.Size(28, 28),
          anchor: new naver.maps.Point(14, 14)
        },
        zIndex: 50
      });

      // 인포윈도우
      const infoWindow = new naver.maps.InfoWindow({
        content: `
          <div style="
            padding: 12px 16px;
            background: #ffffff;
            color: #1a1d2e;
            border-radius: 8px;
            font-family: 'Inter', sans-serif;
            font-size: 13px;
            border: 1px solid rgba(0,0,0,0.08);
            box-shadow: 0 4px 16px rgba(0,0,0,0.1);
            min-width: 160px;
          ">
            <div style="font-weight: 600; margin-bottom: 4px;">${comp.name}</div>
            <div style="color: #4a4e6a; font-size: 11px;">${comp.address || ''}</div>
          </div>
        `,
        borderWidth: 0,
        backgroundColor: 'transparent',
        disableAnchor: true,
        pixelOffset: new naver.maps.Point(0, -20)
      });

      naver.maps.Event.addListener(marker, 'click', () => {
        infoWindow.open(map, marker);
      });

      competitorMarkers.push(marker);
    });
  }

  /**
   * 경쟁업체 원형 상권 표시
   */
  function drawCompetitorCircles(competitors, businessType) {
    clearCompetitorCircles();

    const config = CONFIG.BUSINESS_TYPES[businessType];
    const radius = config.competitorRadius;

    competitors.forEach(comp => {
      const circle = new naver.maps.Circle({
        map: map,
        center: new naver.maps.LatLng(comp.lat, comp.lng),
        radius: radius,
        strokeColor: config.color.primary,
        strokeWeight: 1.5,
        strokeOpacity: 0.5,
        fillColor: config.color.primary,
        fillOpacity: 0.08,
        zIndex: 5
      });

      competitorCircles.push(circle);
    });
  }

  /**
   * 히트맵 격자 표시 (중첩도)
   */
  function drawHeatmap(gridData) {
    clearHeatmap();

    gridData.forEach(cell => {
      let color;
      if (cell.count === 0) color = CONFIG.HEATMAP.opportunity;
      else if (cell.count <= 2) color = CONFIG.HEATMAP.moderate;
      else color = CONFIG.HEATMAP.saturated;

      const rect = new naver.maps.Rectangle({
        map: map,
        bounds: new naver.maps.LatLngBounds(
          new naver.maps.LatLng(cell.sw.lat, cell.sw.lng),
          new naver.maps.LatLng(cell.ne.lat, cell.ne.lng)
        ),
        strokeWeight: 0,
        fillColor: color,
        fillOpacity: 0.35,
        zIndex: 1
      });

      heatmapRects.push(rect);
    });
  }

  /**
   * 최적 입지 마커 표시
   */
  function drawTopLocations(locations) {
    clearTopLocationMarkers();

    const rankStyles = [
      { bg: 'linear-gradient(135deg, #f9a825, #ff8f00)', label: '1' },
      { bg: 'linear-gradient(135deg, #90a4ae, #607d8b)', label: '2' },
      { bg: 'linear-gradient(135deg, #8d6e63, #5d4037)', label: '3' }
    ];

    locations.forEach((loc, idx) => {
      if (idx >= 3) return;
      const style = rankStyles[idx];

      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(loc.lat, loc.lng),
        map: map,
        icon: {
          content: `
            <div style="
              width: 36px; height: 36px;
              background: ${style.bg};
              border: 3px solid #fff;
              border-radius: 50%;
              box-shadow: 0 2px 12px rgba(0,0,0,0.4);
              display: flex; align-items: center; justify-content: center;
              color: #fff; font-size: 16px; font-weight: 800;
              font-family: 'Inter', sans-serif;
            ">${style.label}</div>
          `,
          size: new naver.maps.Size(36, 36),
          anchor: new naver.maps.Point(18, 18)
        },
        zIndex: 200
      });

      topLocationMarkers.push(marker);
    });
  }

  /**
   * 특정 위치로 카메라 이동
   */
  function panTo(lat, lng, zoom) {
    map.setCenter(new naver.maps.LatLng(lat, lng));
    if (zoom) map.setZoom(zoom);
  }

  // --- Clear 함수들 ---
  function clearIsochrones() {
    isochronePolygons.forEach(p => p.setMap(null));
    isochronePolygons = [];
  }

  function clearCompetitorMarkers() {
    competitorMarkers.forEach(m => m.setMap(null));
    competitorMarkers = [];
  }

  function clearCompetitorCircles() {
    competitorCircles.forEach(c => c.setMap(null));
    competitorCircles = [];
  }

  function clearHeatmap() {
    heatmapRects.forEach(r => r.setMap(null));
    heatmapRects = [];
  }

  function clearTopLocationMarkers() {
    topLocationMarkers.forEach(m => m.setMap(null));
    topLocationMarkers = [];
  }

  function clearAll() {
    clearIsochrones();
    clearCompetitorMarkers();
    clearCompetitorCircles();
    clearHeatmap();
    clearTopLocationMarkers();
  }

  function getMap() {
    return map;
  }

  return {
    init,
    setBaseMarker,
    getBasePosition,
    drawIsochrone,
    drawCompetitorMarkers,
    drawCompetitorCircles,
    drawHeatmap,
    drawTopLocations,
    panTo,
    clearAll,
    clearIsochrones,
    clearCompetitorMarkers,
    clearCompetitorCircles,
    clearHeatmap,
    getMap
  };
})();
