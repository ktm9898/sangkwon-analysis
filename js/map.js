/**
 * 상권분석 앱 — 네이버 지도 관리
 */
const MapManager = (() => {
  let map = null;
  let baseMarker = null;
  let competitorMarkers = [];   // { marker, infoWindow }
  let isochronePolygons = [];
  let competitorCircles = [];   // { circle, visible }
  let heatmapRects = [];
  let topLocationMarkers = [];

  // 외부에서 등록할 콜백
  let onBasePositionChange = null;
  let mapClickEnabled = true;

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
      if (mapClickEnabled) {
        setBaseMarker(e.coord);
      }
    });
  }

  /**
   * 지도 클릭으로 기준점 선택 활성화/비활성화
   */
  function setMapClickEnabled(enabled) {
    mapClickEnabled = enabled;
  }

  /**
   * 기준점 위치 변경 콜백 등록
   */
  function setOnBasePositionChange(callback) {
    onBasePositionChange = callback;
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

    const lat = latlng.lat();
    const lng = latlng.lng();

    // 콜백 실행
    if (onBasePositionChange) {
      onBasePositionChange(lat, lng);
    }
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
   * 지도 현재 중심 및 줌 반환 (AI 스캔용)
   */
  function getMapState() {
    if (!map) return null;
    const center = map.getCenter();
    return {
      lat: center.lat(),
      lng: center.lng(),
      zoom: map.getZoom()
    };
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
   * 경쟁업체 마커 표시 (클릭 시 반경 원 토글)
   * @param {Array} competitors
   * @param {string} businessType
   * @param {number[]} circleStates - 인덱스별 원 표시 여부 (기본: 모두 false)
   */
  function drawCompetitorMarkers(competitors, businessType, circleStates) {
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
            <div style="color: #8b90a8; font-size: 10px; margin-top:4px;">${Math.round(comp.dist || 0)}m · ${comp.source || 'API'}</div>
          </div>
        `,
        borderWidth: 0,
        backgroundColor: 'transparent',
        disableAnchor: true,
        pixelOffset: new naver.maps.Point(0, -20)
      });

      naver.maps.Event.addListener(marker, 'click', () => {
        infoWindow.open(map, marker);
        // 반경 원 토글 → UiManager에 위임
        if (typeof UiManager !== 'undefined') {
          UiManager.toggleCompetitorCircleByIndex(idx);
        }
      });

      competitorMarkers.push({ marker, infoWindow });
    });
  }

  /**
   * 경쟁업체 반경 원 그리기 (초기 상태: 모두 숨김)
   * @param {Array} competitors
   * @param {string} businessType
   * @param {number} radiusOverride - 슬라이더 반경 (미터), 없으면 config 기본값
   */
  function drawCompetitorCircles(competitors, businessType, radiusOverride) {
    clearCompetitorCircles();

    const config = CONFIG.BUSINESS_TYPES[businessType];
    const radius = radiusOverride || config.competitorRadius;

    competitors.forEach(comp => {
      const circle = new naver.maps.Circle({
        map: null,   // 초기에는 지도에 표시 안 함
        center: new naver.maps.LatLng(comp.lat, comp.lng),
        radius: radius,
        strokeColor: config.color.primary,
        strokeWeight: 1.5,
        strokeOpacity: 0.6,
        fillColor: config.color.primary,
        fillOpacity: 0.08,
        zIndex: 5
      });

      competitorCircles.push({ circle, visible: false });
    });
  }

  /**
   * 특정 인덱스 경쟁업체 반경 원 토글
   * @returns {boolean} 토글 후 visible 상태
   */
  function toggleCompetitorCircle(index) {
    const entry = competitorCircles[index];
    if (!entry) return false;

    entry.visible = !entry.visible;
    entry.circle.setMap(entry.visible ? map : null);
    return entry.visible;
  }

  /**
   * 특정 인덱스 경쟁업체 반경 원 강제 설정
   */
  function setCompetitorCircleVisible(index, visible) {
    const entry = competitorCircles[index];
    if (!entry) return;
    entry.visible = visible;
    entry.circle.setMap(visible ? map : null);
  }

  /**
   * 전체 경쟁업체 반경 원 표시/숨김
   */
  function setAllCompetitorCirclesVisible(visible) {
    competitorCircles.forEach(entry => {
      entry.visible = visible;
      entry.circle.setMap(visible ? map : null);
    });
  }

  /**
   * 전체 경쟁업체 반경 원 크기 변경
   * @param {number} newRadius - 미터 단위
   */
  function updateAllCircleRadius(newRadius) {
    competitorCircles.forEach(entry => {
      entry.circle.setRadius(newRadius);
    });
  }

  /**
   * 경쟁업체 원의 visible 상태 배열 반환
   */
  function getCircleStates() {
    return competitorCircles.map(e => e.visible);
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

  /**
   * 역지오코딩 (LatLng → 주소)
   */
  function reverseGeocode(lat, lng, callback) {
    if (typeof naver === 'undefined' || !naver.maps) return callback(null);

    naver.maps.Service.reverseGeocode({
      coords: new naver.maps.LatLng(lat, lng),
      orders: 'addr'
    }, (status, response) => {
      if (status !== naver.maps.Service.Status.OK) return callback(null);

      const results = response.v2?.results;
      if (results && results.length > 0) {
        const r = results[0];
        const land = r.land;
        const region = r.region;

        // 도로명 주소 조합
        const si = region?.area1?.name || '';
        const gu = region?.area2?.name || '';
        const dong = region?.area3?.name || '';
        const road = land?.name || '';
        const number = land?.number1 ? `${land.number1}${land.number2 ? '-' + land.number2 : ''}` : '';

        const address = road
          ? `${si} ${gu} ${road} ${number}`.trim()
          : `${si} ${gu} ${dong}`.trim();

        callback(address || null);
      } else {
        callback(null);
      }
    });
  }

  /**
   * 주소 지오코딩 (address → LatLng)
   */
  function geocodeAddress(address, callback) {
    if (typeof naver === 'undefined' || !naver.maps) return callback(null);

    naver.maps.Service.geocode({ query: address }, (status, response) => {
      if (status !== naver.maps.Service.Status.OK) return callback(null);

      const addresses = response.v2?.addresses;
      if (addresses && addresses.length > 0) {
        const results = addresses.map(a => ({
          name: a.roadAddress || a.jibunAddress || address,
          address: a.roadAddress || a.jibunAddress || '',
          lat: parseFloat(a.y),
          lng: parseFloat(a.x)
        }));
        callback(results);
      } else {
        callback(null);
      }
    });
  }

  // --- Clear 함수들 ---
  function clearIsochrones() {
    isochronePolygons.forEach(p => p.setMap(null));
    isochronePolygons = [];
  }

  function clearCompetitorMarkers() {
    competitorMarkers.forEach(({ marker, infoWindow }) => {
      infoWindow.close();
      marker.setMap(null);
    });
    competitorMarkers = [];
  }

  function clearCompetitorCircles() {
    competitorCircles.forEach(({ circle }) => circle.setMap(null));
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

  function getMap() { return map; }

  return {
    init,
    setMapClickEnabled,
    setOnBasePositionChange,
    setBaseMarker,
    getBasePosition,
    getMapState,
    drawIsochrone,
    drawCompetitorMarkers,
    drawCompetitorCircles,
    toggleCompetitorCircle,
    setCompetitorCircleVisible,
    setAllCompetitorCirclesVisible,
    updateAllCircleRadius,
    getCircleStates,
    drawHeatmap,
    drawTopLocations,
    reverseGeocode,
    geocodeAddress,
    panTo,
    clearAll,
    clearIsochrones,
    clearCompetitorMarkers,
    clearCompetitorCircles,
    clearHeatmap,
    getMap
  };
})();
