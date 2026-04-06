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
   * @param {string} businessType
   * @param {{ lat, lng }} position
   * @param {Array} competitors - 탭3에서 이미 탐색된 경쟁점포 (없으면 자동 탐색)
   * @param {{ primary, secondary, tertiary } | null} isoConfig - 등시선 설정 (초 단위)
   */
  async function handleAnalyze(businessType, position, competitors, isoConfig) {
    console.log(`📊 분석 시작: ${businessType}`, position);

    const bt = CONFIG.BUSINESS_TYPES[businessType];
    UiManager.showLoading(`${bt.icon} ${bt.label} 상권 분석 중...`);

    try {
      // 기존 등시선/히트맵 레이어 제거 (마커/원은 유지)
      MapManager.clearIsochrones();
      MapManager.clearHeatmap();

      // ── Phase 1: 등시선 분석 ──
      const iso = isoConfig || bt.isochrone;
      let isochroneFeatures = null;

      if (typeof IsochroneManager !== 'undefined') {
        UiManager.showLoading('📐 등시선 분석 중...');
        try {
          const isochroneFeatures = await IsochroneManager.getIsochrone(
            position.lat, position.lng, businessType, iso
          );

          if (isochroneFeatures && isochroneFeatures.length > 0) {
            // 선택된 범위(iso)의 키 개수에 맞춰 색상 배열 생성
            // CONFIG.BUSINESS_TYPES[businessType].color 를 참조
            const colors = [];
            if (iso.tertiary) colors.push(bt.color.tertiary || '#C8E6C9');
            if (iso.secondary) colors.push(bt.color.secondary || '#81C784');
            if (iso.primary) colors.push(bt.color.primary || '#4CAF50');
            
            // ORS 결과는 보통 큰 범위부터 오므로, 
            // 현재 요청한 range 배열 순서(primary, secondary, tertiary)와 
            // 응답 features의 순서를 확인하여 매칭
            MapManager.drawIsochrone(isochroneFeatures, colors);
          }
        } catch (e) {
          console.warn('[등시선] 실패 (ORS API 키 미설정일 수 있음):', e.message);
        }
      }

      // ── Phase 2: 경쟁업체 ──
      // 탭3에서 이미 경쟁점포를 탐색했으면 그 결과를 사용
      // 탐색 전에 분석 버튼을 누른 경우 자동 탐색
      let finalCompetitors = competitors;

      if (!finalCompetitors || finalCompetitors.length === 0) {
        if (typeof SearchManager !== 'undefined') {
          UiManager.showLoading('🔍 경쟁업체 자동 탐색 중...');
          finalCompetitors = await SearchManager.searchCompetitors(
            position.lat, position.lng, businessType,
            (msg) => UiManager.showLoading(msg)
          );

          // 탐색 결과를 탭3에 반영
          UiManager.setCompetitors(finalCompetitors, businessType);
        }
      } else {
        // 이미 지도에 마커/원이 그려져 있으므로, 원 상태만 복원
        // (setCompetitors 없이 현재 상태 유지)
        console.log(`[분석] 탭3 경쟁점포 ${finalCompetitors.length}개 사용`);
      }

      // ── 결과 렌더링 ──
      UiManager.renderResults({
        businessType,
        center: position,
        competitors: finalCompetitors,
        isoConfig: iso
      });

      UiManager.showToast(`✅ ${bt.label} 상권 분석 완료`);

    } catch (error) {
      console.error('분석 중 오류:', error);
      UiManager.showToast(`❌ 분석 중 오류: ${error.message}`, 4000);
    } finally {
      UiManager.hideLoading();
    }
  }

  return { init };
})();
