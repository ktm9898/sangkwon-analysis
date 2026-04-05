/**
 * 상권분석 앱 — 앱 진입점
 */
const App = (() => {
  function init() {
    console.log('🏪 상권분석 앱 초기화');

    // 지도 초기화
    MapManager.init();

    // UI 초기화 (분석 콜백 전달)
    UiManager.init(handleAnalyze);

    console.log('✅ 초기화 완료');
  }

  /**
   * 분석 실행 핸들러
   */
  async function handleAnalyze(businessType, position) {
    console.log(`📊 분석 시작: ${businessType}`, position);

    const bt = CONFIG.BUSINESS_TYPES[businessType];
    UiManager.showLoading(`${bt.icon} ${bt.label} 상권 분석 중...`);

    try {
      // 기존 레이어 제거
      MapManager.clearAll();

      // Phase 2: 등시선 분석
      let isochroneFeatures = null;
      if (typeof IsochroneManager !== 'undefined') {
        UiManager.showLoading('등시선 분석 중...');
        isochroneFeatures = await IsochroneManager.getIsochrone(
          position.lat, position.lng, businessType
        );

        if (isochroneFeatures) {
          MapManager.drawIsochrone(isochroneFeatures, [
            bt.color.primary,
            bt.color.secondary,
            bt.color.tertiary
          ]);
        }
      }

      // Phase 2: 경쟁업체 검색
      let competitors = [];
      if (typeof SearchManager !== 'undefined') {
        UiManager.showLoading('경쟁업체 검색 중...');
        competitors = await SearchManager.searchCompetitors(
          position.lat, position.lng, businessType
        );

        // 마커 + 원형 상권 표시
        MapManager.drawCompetitorMarkers(competitors, businessType);
        MapManager.drawCompetitorCircles(competitors, businessType);
      }

      // Phase 4: 중첩도 분석
      let analysisResult = { avgOverlap: 0, topLocations: [] };
      if (typeof AnalysisManager !== 'undefined' && competitors.length > 0) {
        UiManager.showLoading('상권 중첩 분석 중...');
        analysisResult = AnalysisManager.analyze(
          position, competitors, businessType, isochroneFeatures
        );

        MapManager.drawHeatmap(analysisResult.gridData);
        MapManager.drawTopLocations(analysisResult.topLocations);
      }

      // 결과 렌더링
      UiManager.renderResults({
        businessType,
        center: position,
        competitors,
        avgOverlap: analysisResult.avgOverlap,
        topLocations: analysisResult.topLocations
      });

      UiManager.showToast(`✅ ${bt.label} 상권 분석 완료`);

    } catch (error) {
      console.error('분석 중 오류:', error);
      UiManager.showToast(`❌ 분석 중 오류가 발생했습니다: ${error.message}`, 4000);
    } finally {
      UiManager.hideLoading();
    }
  }

  return { init };
})();
