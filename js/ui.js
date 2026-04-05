/**
 * 상권분석 앱 — UI 관리
 */
const UiManager = (() => {
  let selectedBusinessType = null;
  let onAnalyzeCallback = null;

  function init(analyzeCallback) {
    onAnalyzeCallback = analyzeCallback;
    renderBusinessButtons();
    setupAnalyzeButton();
    showEmptyState();
  }

  /**
   * 업종 선택 버튼 렌더링
   */
  function renderBusinessButtons() {
    const container = document.getElementById('business-selector');
    if (!container) return;

    for (const [key, bt] of Object.entries(CONFIG.BUSINESS_TYPES)) {
      const btn = document.createElement('button');
      btn.className = 'business-btn';
      btn.dataset.type = key;
      btn.innerHTML = `<span class="icon">${bt.icon}</span>${bt.label}`;

      btn.addEventListener('click', () => {
        document.querySelectorAll('.business-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedBusinessType = key;
        updateAnalyzeButtonState();
        showToast(`${bt.icon} ${bt.label} 업종이 선택되었습니다`);
      });

      container.appendChild(btn);
    }
  }

  /**
   * 분석 버튼 설정
   */
  function setupAnalyzeButton() {
    const btn = document.getElementById('analyze-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (onAnalyzeCallback && selectedBusinessType && MapManager.getBasePosition()) {
        onAnalyzeCallback(selectedBusinessType, MapManager.getBasePosition());
      }
    });
  }

  /**
   * 분석 버튼 활성화 상태 업데이트
   */
  function updateAnalyzeButtonState() {
    const btn = document.getElementById('analyze-btn');
    if (!btn) return;
    btn.disabled = !(selectedBusinessType && MapManager.getBasePosition());
  }

  function enableAnalyzeButton() {
    updateAnalyzeButtonState();
  }

  /**
   * 좌표 표시 업데이트
   */
  function updateCoordinates(lat, lng) {
    const el = document.getElementById('coord-display');
    if (!el) return;

    el.classList.remove('empty');
    el.innerHTML = `
      <span class="dot"></span>
      <span>${lat.toFixed(6)}, ${lng.toFixed(6)}</span>
    `;
    updateAnalyzeButtonState();
  }

  /**
   * 초기 빈 상태
   */
  function showEmptyState() {
    const body = document.getElementById('sidebar-body');
    if (!body) return;

    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗺️</div>
        <h3>분석 결과가 여기에 표시됩니다</h3>
        <p>
          1. 업종을 선택하세요<br>
          2. 지도에서 분석 기준점을 클릭하세요<br>
          3. 분석 시작을 눌러주세요
        </p>
      </div>
    `;
  }

  /**
   * 로딩 상태
   */
  function showLoading(message) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.querySelector('h3').textContent = message || '분석 중...';
      overlay.querySelector('p').textContent = '잠시만 기다려주세요';
      overlay.classList.add('active');
    }

    const btn = document.getElementById('analyze-btn');
    if (btn) btn.classList.add('loading');
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('active');

    const btn = document.getElementById('analyze-btn');
    if (btn) btn.classList.remove('loading');
  }

  /**
   * 분석 결과 렌더링
   */
  function renderResults(data) {
    const body = document.getElementById('sidebar-body');
    if (!body) return;

    const bt = CONFIG.BUSINESS_TYPES[data.businessType];

    let html = `
      <!-- 분석 요약 -->
      <div class="section-title">분석 결과</div>

      <div class="result-card">
        <div class="card-header">
          <span class="card-title">${bt.icon} 선택 업종</span>
        </div>
        <div class="card-value" style="color: var(--accent-light)">${bt.label}</div>
        <div class="card-desc">기준점 좌표: ${data.center.lat.toFixed(4)}, ${data.center.lng.toFixed(4)}</div>
      </div>

      <div class="result-card">
        <div class="card-header">
          <span class="card-title">주변 경쟁업체</span>
        </div>
        <div class="card-value ${data.competitors.length > 5 ? 'danger' : data.competitors.length > 2 ? 'warning' : 'success'}">${data.competitors.length}개</div>
        <div class="card-desc">반경 ${bt.competitorRadius}m 이내</div>
      </div>

      <div class="result-card">
        <div class="card-header">
          <span class="card-title">평균 경쟁 밀도</span>
        </div>
        <div class="card-value ${data.avgOverlap > 2 ? 'danger' : data.avgOverlap > 1 ? 'warning' : 'success'}">${data.avgOverlap.toFixed(1)}</div>
        <div class="card-desc">격자당 평균 경쟁 업체 수</div>
      </div>
    `;

    // 최적 입지 Top 3
    if (data.topLocations && data.topLocations.length > 0) {
      html += `<div class="section-title" style="margin-top: var(--sp-lg)">최적 입지 추천</div>`;

      const rankClasses = ['gold', 'silver', 'bronze'];

      data.topLocations.forEach((loc, idx) => {
        if (idx >= 3) return;
        html += `
          <div class="top-location" data-lat="${loc.lat}" data-lng="${loc.lng}">
            <div class="rank ${rankClasses[idx]}">${idx + 1}</div>
            <div class="loc-info">
              <div class="loc-title">${loc.label || `추천 위치 ${idx + 1}`}</div>
              <div class="loc-desc">경쟁 밀도: ${loc.density.toFixed(1)}</div>
            </div>
            <div class="loc-score">${loc.score}점</div>
          </div>
        `;
      });
    }

    // 범례
    html += `
      <div class="legend">
        <div class="legend-item">
          <div class="legend-dot" style="background: ${CONFIG.HEATMAP.opportunity}"></div>
          기회
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background: ${CONFIG.HEATMAP.moderate}"></div>
          보통
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background: ${CONFIG.HEATMAP.saturated}"></div>
          과밀
        </div>
      </div>
    `;

    body.innerHTML = html;

    // 최적 입지 클릭 이벤트
    body.querySelectorAll('.top-location').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lng = parseFloat(el.dataset.lng);
        MapManager.panTo(lat, lng, 17);
      });
    });
  }

  /**
   * 토스트 메시지
   */
  function showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  function getSelectedBusinessType() {
    return selectedBusinessType;
  }

  return {
    init,
    updateCoordinates,
    enableAnalyzeButton,
    showEmptyState,
    showLoading,
    hideLoading,
    renderResults,
    showToast,
    getSelectedBusinessType
  };
})();
