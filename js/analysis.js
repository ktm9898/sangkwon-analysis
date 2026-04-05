/**
 * 상권분석 앱 — Turf.js 기반 중첩도 분석
 */
const AnalysisManager = (() => {

  /**
   * 상권 중첩 분석 실행
   * @param {Object} center - { lat, lng } 기준점
   * @param {Array} competitors - 경쟁업체 배열
   * @param {string} businessType - 업종 키
   * @param {Array|null} isochroneFeatures - 기준점 등시선 GeoJSON
   * @returns {{ avgOverlap, gridData, topLocations }}
   */
  function analyze(center, competitors, businessType, isochroneFeatures) {
    const bt = CONFIG.BUSINESS_TYPES[businessType];
    const radius = bt.competitorRadius;

    // 1) 경쟁업체 원형 상권을 Turf.js 폴리곤으로 생성
    const competitorPolygons = competitors.map(comp => {
      return turf.circle([comp.lng, comp.lat], radius / 1000, {
        steps: 32,
        units: 'kilometers'
      });
    });

    // 2) 분석 범위 결정 (등시선 2차 상권 또는 기준점 중심 1km 사각형)
    let analysisArea;
    if (isochroneFeatures && isochroneFeatures.length >= 2) {
      // 2차 상권 등시선의 바운딩 박스를 분석 영역으로 사용
      const secondaryFeature = isochroneFeatures[1]; // 2차 상권
      analysisArea = turf.bbox(secondaryFeature);
    } else {
      // 폴백: 기준점 중심 ±1km
      const offset = 0.01; // ~1.1km
      analysisArea = [
        center.lng - offset,
        center.lat - offset,
        center.lng + offset,
        center.lat + offset
      ];
    }

    // 3) 격자 생성 (50m × 50m)
    const gridSizeKm = CONFIG.GRID_SIZE / 1000;
    const grid = turf.squareGrid(analysisArea, gridSizeKm, { units: 'kilometers' });

    // 4) 각 격자 셀의 중첩도 계산
    const gridData = [];
    let totalOverlap = 0;

    grid.features.forEach(cell => {
      const cellCenter = turf.center(cell);
      const centerCoords = cellCenter.geometry.coordinates;

      let overlapCount = 0;

      competitorPolygons.forEach(poly => {
        if (turf.booleanPointInPolygon(cellCenter, poly)) {
          overlapCount++;
        }
      });

      // 격자의 SW, NE 좌표 추출
      const coords = cell.geometry.coordinates[0];
      const lats = coords.map(c => c[1]);
      const lngs = coords.map(c => c[0]);

      gridData.push({
        count: overlapCount,
        center: { lat: centerCoords[1], lng: centerCoords[0] },
        sw: { lat: Math.min(...lats), lng: Math.min(...lngs) },
        ne: { lat: Math.max(...lats), lng: Math.max(...lngs) }
      });

      totalOverlap += overlapCount;
    });

    const avgOverlap = gridData.length > 0 ? totalOverlap / gridData.length : 0;

    // 5) 최적 입지 추출 (경쟁 중첩이 0인 격자 중 기준점과 가까운 순)
    const topLocations = findTopLocations(gridData, center, competitors);

    console.log(`[분석] 격자 ${gridData.length}개, 평균 중첩 ${avgOverlap.toFixed(2)}`);

    return { avgOverlap, gridData, topLocations };
  }

  /**
   * 최적 입지 Top 3 추출
   */
  function findTopLocations(gridData, center, competitors) {
    // 중첩이 0인 셀 필터
    const opportunityCells = gridData.filter(cell => cell.count === 0);

    if (opportunityCells.length === 0) {
      // 모든 격자가 경쟁 중이면, 가장 낮은 중첩도 격자
      const minOverlap = Math.min(...gridData.map(c => c.count));
      const lowCells = gridData.filter(c => c.count === minOverlap);
      return scoreAndRank(lowCells, center, competitors, minOverlap);
    }

    return scoreAndRank(opportunityCells, center, competitors, 0);
  }

  /**
   * 격자 셀에 점수를 매기고 Top 3 반환
   */
  function scoreAndRank(cells, center, competitors, baseDensity) {
    // 점수 = (기준점과의 접근성) + (경쟁업체와의 적절한 거리)
    const scored = cells.map(cell => {
      const distToCenter = getDistance(center.lat, center.lng, cell.center.lat, cell.center.lng);

      // 경쟁업체들과의 최소 거리 (멀수록 좋음)
      let minCompDist = Infinity;
      competitors.forEach(comp => {
        const d = getDistance(cell.center.lat, cell.center.lng, comp.lat, comp.lng);
        if (d < minCompDist) minCompDist = d;
      });

      // 점수 계산: 경쟁업체와 멀고(+), 기준점과 가까운(+) 곳이 좋음
      // 정규화: 거리를 0~50 범위로 변환
      const accessScore = Math.max(0, 50 - (distToCenter / 1000) * 25); // 가까울수록 높음
      const competScore = Math.min(50, (minCompDist / 500) * 25);       // 멀수록 높음

      const totalScore = Math.round(accessScore + competScore);

      return {
        lat: cell.center.lat,
        lng: cell.center.lng,
        density: baseDensity,
        score: totalScore,
        distToCenter: Math.round(distToCenter),
        label: `기준점에서 ${Math.round(distToCenter)}m`
      };
    });

    // 점수 높은 순으로 정렬하여 Top 3
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3);
  }

  /**
   * Haversine 거리 계산 (미터)
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

  return { analyze };
})();
