/**
 * 상권분석 앱 — UI 관리 (3탭 패널 구조)
 */
const UiManager = (() => {
  // 상태
  let selectedBusinessType = null;
  let onAnalyzeCallback = null;

  // 경쟁점포 상태 (탭3에서 관리)
  let competitors = [];              // 탐색된 모든 경쟁점포
  let circleStates = [];            // 인덱스별 반경 원 표시 여부
  let currentRadius = 300;          // 현재 반경(m)
  let currentBusinessType = null;   // 현재 분석 업종

  // 등시선 슬라이더 값 (분 단위 오버라이드)
  let isochroneOverride = null;     // { primary, secondary, tertiary } — null이면 config 기본값

  // ============================================================
  // 초기화
  // ============================================================
  function init(analyzeCallback) {
    onAnalyzeCallback = analyzeCallback;
    setupPanelToggle();
    setupTabs();
    setupBusinessButtons();
    setupLocationTab();
    setupCompetitorTab();
    setupAnalyzeButton();
    showEmptyState();
  }

  // ============================================================
  // 패널 접기/펼치기
  // ============================================================
  function setupPanelToggle() {
    const btn = document.getElementById('panel-toggle');
    const panel = document.getElementById('control-panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      btn.textContent = panel.classList.contains('collapsed') ? '▼' : '▲';
    });
  }

  // ============================================================
  // 탭 네비게이션
  // ============================================================
  function setupTabs() {
    const navItems = document.querySelectorAll('.tab-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        switchTab(item.dataset.tab);
      });
    });
  }

  function switchTab(tabId) {
    // nav 업데이트
    document.querySelectorAll('.tab-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });
    // 패널 업데이트
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
  }

  // ============================================================
  // 탭1: 업종 선택
  // ============================================================
  function setupBusinessButtons() {
    const container = document.getElementById('business-selector');
    if (!container) return;

    for (const [key, bt] of Object.entries(CONFIG.BUSINESS_TYPES)) {
      const btn = document.createElement('button');
      btn.className = 'business-btn';
      btn.id = `business-btn-${key}`;
      btn.dataset.type = key;
      btn.innerHTML = `<span class="icon">${bt.icon}</span>${bt.label}`;

      btn.addEventListener('click', () => {
        document.querySelectorAll('.business-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedBusinessType = key;
        currentBusinessType = key;
        currentRadius = bt.competitorRadius;

        // 선택 business 정보 표시
        const infoEl = document.getElementById('selected-business-info');
        const badgeEl = document.getElementById('selected-business-badge');
        const textEl = document.getElementById('selected-business-text');
        if (infoEl) {
          infoEl.style.display = 'flex';
          badgeEl.textContent = bt.icon;
          textEl.textContent = `${bt.label} 선택됨`;
        }

        // 등시선 슬라이더 기본값 업데이트
        updateIsochroneSliderDefaults(bt);

        // 경쟁점포 탭 반경 슬라이더 업데이트
        const radiusSlider = document.getElementById('competitor-radius-slider');
        const radiusVal = document.getElementById('competitor-radius-val');
        if (radiusSlider) {
          radiusSlider.value = bt.competitorRadius;
          currentRadius = bt.competitorRadius;
        }
        if (radiusVal) radiusVal.textContent = `${bt.competitorRadius}m`;

        // 스캔 버튼 활성화 (위치도 선택된 경우)
        updateScanButtonState();
        updateAnalyzeButtonState();

        showToast(`${bt.icon} ${bt.label} 업종이 선택되었습니다`);
      });

      container.appendChild(btn);
    }
  }

  function updateIsochroneSliderDefaults(bt) {
    const primary = Math.round(bt.isochrone.primary / 60);
    const secondary = Math.round(bt.isochrone.secondary / 60);
    const tertiary = Math.round(bt.isochrone.tertiary / 60);

    const priSlider = document.getElementById('iso-primary');
    const secSlider = document.getElementById('iso-secondary');
    const terSlider = document.getElementById('iso-tertiary');

    const priChk = document.getElementById('iso-primary-chk');
    const secChk = document.getElementById('iso-secondary-chk');
    const terChk = document.getElementById('iso-tertiary-chk');

    if (priSlider) { priSlider.value = primary; document.getElementById('iso-primary-val').textContent = `${primary}분`; }
    if (secSlider) { secSlider.value = secondary; document.getElementById('iso-secondary-val').textContent = `${secondary}분`; }
    if (terSlider) { terSlider.value = tertiary; document.getElementById('iso-tertiary-val').textContent = `${tertiary}분`; }

    // 기본적으로 모두 켠 상태로 초기화 (또는 사용자 이전 설정 유지 가능하나 여기선 초기화)
    if (secChk) { secChk.checked = true; secSlider.disabled = false; }
    if (terChk) { terChk.checked = true; terSlider.disabled = false; }

    isochroneOverride = { primary: primary * 60, secondary: secondary * 60, tertiary: tertiary * 60 };
  }

  // ============================================================
  // 탭2: 분석 기준점
  // ============================================================
  function setupLocationTab() {
    setupAddressSearch();
    setupMapClickToggle();
    setupIsochroneSliders();

    // MapManager 콜백 등록 — 지도 클릭 시 탭2 UI 업데이트
    MapManager.setOnBasePositionChange((lat, lng) => {
      updateLocationDisplay(lat, lng);
      updateScanButtonState();
      updateAnalyzeButtonState();
    });
  }

  function setupAddressSearch() {
    const input = document.getElementById('address-input');
    const btn = document.getElementById('address-search-btn');
    const results = document.getElementById('address-results');
    if (!input || !btn) return;

    const doSearch = async () => {
      const query = input.value.trim();
      if (!query) return;

      results.style.display = 'none';
      results.innerHTML = '';

      try {
        MapManager.geocodeAddress(query, (found) => {
          if (!found || found.length === 0) {
            showToast('❌ 검색 결과가 없습니다');
            return;
          }

          results.innerHTML = found.map((item, i) => `
            <div class="address-result-item" data-idx="${i}">
              <div class="result-name">${item.name}</div>
              <div class="result-addr">${item.address}</div>
            </div>
          `).join('');
          results.style.display = 'block';

          results.querySelectorAll('.address-result-item').forEach(el => {
            el.addEventListener('click', () => {
              const idx = parseInt(el.dataset.idx);
              const item = found[idx];
              MapManager.setBaseMarker(new naver.maps.LatLng(item.lat, item.lng));
              MapManager.panTo(item.lat, item.lng, 17);
              input.value = item.address || item.name;
              results.style.display = 'none';
            });
          });
        });
      } catch (e) {
        showToast('❌ 주소 검색 중 오류 발생');
      }
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // 외부 클릭 시 결과 닫기
    document.addEventListener('click', e => {
      if (!e.target.closest('.address-search-wrap')) {
        results.style.display = 'none';
      }
    });
  }

  function setupMapClickToggle() {
    const toggle = document.getElementById('map-click-toggle');
    if (!toggle) return;

    // 기본: 활성화
    toggle.classList.add('active');
    MapManager.setMapClickEnabled(true);

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      const enabled = toggle.classList.contains('active');
      MapManager.setMapClickEnabled(enabled);
      showToast(enabled ? '🗺️ 지도 클릭 선택 활성화' : '🚫 지도 클릭 선택 비활성화');
    });
  }

  function setupIsochroneSliders() {
    [
      { id: 'iso-primary',   chkId: 'iso-primary-chk',   valId: 'iso-primary-val',   key: 'primary' },
      { id: 'iso-secondary', chkId: 'iso-secondary-chk', valId: 'iso-secondary-val', key: 'secondary' },
      { id: 'iso-tertiary',  chkId: 'iso-tertiary-chk',  valId: 'iso-tertiary-val',  key: 'tertiary' }
    ].forEach(({ id, chkId, valId, key }) => {
      const slider = document.getElementById(id);
      const chk = document.getElementById(chkId);
      const valEl = document.getElementById(valId);
      if (!slider || !valEl) return;

      slider.addEventListener('input', () => {
        const val = parseInt(slider.value);
        valEl.textContent = `${val}분`;
        if (!isochroneOverride) isochroneOverride = {};
        isochroneOverride[key] = val * 60;
      });

      if (chk) {
        chk.addEventListener('change', () => {
          slider.disabled = !chk.checked;
          if (chk.checked) {
            if (!isochroneOverride) isochroneOverride = {};
            isochroneOverride[key] = parseInt(slider.value) * 60;
          } else {
            if (isochroneOverride) delete isochroneOverride[key];
          }
        });
      }
    });
  }

  /**
   * 기준점 UI 업데이트 (좌표 + 역지오코딩 주소)
   */
  function updateLocationDisplay(lat, lng) {
    const inner = document.getElementById('location-display-inner');
    const textEl = document.getElementById('location-text');
    const addrEl = document.getElementById('location-address');
    if (!inner || !textEl) return;

    inner.classList.remove('empty');
    inner.classList.add('active');
    textEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    // 역지오코딩
    MapManager.reverseGeocode(lat, lng, (address) => {
      if (address && addrEl) {
        addrEl.textContent = address;
        addrEl.style.display = 'block';
      }
    });
  }

  /**
   * 외부에서 좌표 업데이트 호출 (기존 호환성)
   */
  function updateCoordinates(lat, lng) {
    updateLocationDisplay(lat, lng);
  }

  // ============================================================
  // 탭3: 경쟁점포
  // ============================================================
  function setupCompetitorTab() {
    setupScanButton();
    setupManualSearch();
    setupCompetitorRadiusSlider();
    setupCircleToggleButtons();
  }

  function setupScanButton() {
    const btn = document.getElementById('scan-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const pos = MapManager.getBasePosition();
      if (!pos) { showToast('❌ 먼저 분석 기준점을 선택하세요'); return; }
      if (!selectedBusinessType) { showToast('❌ 먼저 업종을 선택하세요'); return; }

      btn.classList.add('loading');
      btn.disabled = true;
      updateScanStatus('시작 중...');

      try {
        MapManager.clearCompetitorMarkers();
        MapManager.clearCompetitorCircles();

        const found = await SearchManager.searchCompetitors(
          pos.lat, pos.lng, selectedBusinessType,
          (msg) => {
            updateScanStatus(msg);
            if (msg.startsWith('⚠️')) showToast(msg, 3500); 
          }
        );

        setCompetitors(found, selectedBusinessType);
        showToast(`✅ ${found.length}개 경쟁점포 탐색 완료`);
        updateScanStatus(`${found.length}개 탐색됨`);
        updateAnalyzeButtonState();
      } catch (e) {
        showToast(`❌ 탐색 실패: ${e.message}`);
        updateScanStatus('탐색 실패');
        console.error('[탐색] 오류:', e);
      } finally {
        btn.classList.remove('loading');
        updateScanButtonState();
      }
    });
  }

  function setupManualSearch() {
    const input = document.getElementById('manual-search-input');
    const btn = document.getElementById('manual-search-btn');
    const results = document.getElementById('manual-search-results');
    if (!input || !btn) return;

    const doSearch = async () => {
      const keyword = input.value.trim();
      if (!keyword) return;

      results.style.display = 'none';
      results.innerHTML = '';

      try {
        const pos = MapManager.getBasePosition();
        const found = await SearchManager.searchByKeyword(
          keyword,
          pos ? pos.lat : null,
          pos ? pos.lng : null
        );

        if (!found || found.length === 0) {
          showToast('❌ 검색 결과가 없습니다');
          return;
        }

        results.innerHTML = found.map((item, i) => {
          const alreadyAdded = competitors.some(
            c => c.name === item.name &&
                 Math.abs(c.lat - item.lat) < 0.0001 &&
                 Math.abs(c.lng - item.lng) < 0.0001
          );
          const distStr = item.dist ? `${Math.round(item.dist)}m` : '';
          return `
            <div class="competitor-result-item" data-idx="${i}">
              <div class="competitor-result-info">
                <div class="result-name">${item.name}</div>
                <div class="result-addr">${item.address} ${distStr ? `· ${distStr}` : ''}</div>
              </div>
              <button class="add-competitor-btn" data-idx="${i}" ${alreadyAdded ? 'disabled' : ''}>
                ${alreadyAdded ? '추가됨' : '+ 추가'}
              </button>
            </div>
          `;
        }).join('');
        results.style.display = 'block';

        results.querySelectorAll('.add-competitor-btn:not(:disabled)').forEach(addBtn => {
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(addBtn.dataset.idx);
            addManualCompetitor(found[idx]);
            addBtn.disabled = true;
            addBtn.textContent = '추가됨';
          });
        });
      } catch (e) {
        showToast('❌ 검색 중 오류가 발생했습니다');
        console.error('[수동검색] 오류:', e);
      }
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    document.addEventListener('click', e => {
      if (!e.target.closest('#manual-search-input') && !e.target.closest('#manual-search-results')) {
        results.style.display = 'none';
      }
    });
  }

  function setupCompetitorRadiusSlider() {
    const slider = document.getElementById('competitor-radius-slider');
    const valEl  = document.getElementById('competitor-radius-val');
    if (!slider || !valEl) return;

    slider.addEventListener('input', () => {
      const radius = parseInt(slider.value);
      currentRadius = radius;
      valEl.textContent = `${radius}m`;
      MapManager.updateAllCircleRadius(radius);
    });
  }

  function setupCircleToggleButtons() {
    const showAllBtn = document.getElementById('circle-show-all');
    const hideAllBtn = document.getElementById('circle-hide-all');

    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        MapManager.setAllCompetitorCirclesVisible(true);
        circleStates = circleStates.map(() => true);
        refreshCompetitorList();
      });
    }

    if (hideAllBtn) {
      hideAllBtn.addEventListener('click', () => {
        MapManager.setAllCompetitorCirclesVisible(false);
        circleStates = circleStates.map(() => false);
        refreshCompetitorList();
      });
    }
  }

  /**
   * 경쟁점포 전체 세팅 (탐색 결과 반영)
   */
  function setCompetitors(found, businessType) {
    competitors = found;
    circleStates = new Array(found.length).fill(false);
    currentBusinessType = businessType;

    if (businessType && CONFIG.BUSINESS_TYPES[businessType]) {
      currentRadius = parseInt(document.getElementById('competitor-radius-slider')?.value)
        || CONFIG.BUSINESS_TYPES[businessType].competitorRadius;
    }

    // 지도에 마커 + 원 그리기
    MapManager.drawCompetitorMarkers(competitors, businessType);
    MapManager.drawCompetitorCircles(competitors, businessType, currentRadius);

    // UI 업데이트
    refreshCompetitorList();
    updateCompetitorCountBadge();
    updateCircleToggleBar();
  }

  /**
   * 수동으로 경쟁점포 추가
   */
  function addManualCompetitor(competitor) {
    competitors.push(competitor);
    circleStates.push(false);

    // 지도에 마커 추가를 위해 전체 재드로우
    if (currentBusinessType) {
      MapManager.drawCompetitorMarkers(competitors, currentBusinessType);
      MapManager.drawCompetitorCircles(competitors, currentBusinessType, currentRadius);
      // 기존 circle visible 상태 복원
      circleStates.forEach((visible, i) => {
        MapManager.setCompetitorCircleVisible(i, visible);
      });
    }

    refreshCompetitorList();
    updateCompetitorCountBadge();
    updateCircleToggleBar();
    updateAnalyzeButtonState();
    showToast(`✅ ${competitor.name} 추가됨`);
    MapManager.panTo(competitor.lat, competitor.lng, 17);
  }

  /**
   * 경쟁점포 삭제
   */
  function removeCompetitor(index) {
    const removed = competitors.splice(index, 1)[0];
    circleStates.splice(index, 1);

    if (currentBusinessType) {
      MapManager.drawCompetitorMarkers(competitors, currentBusinessType);
      MapManager.drawCompetitorCircles(competitors, currentBusinessType, currentRadius);
      circleStates.forEach((visible, i) => {
        MapManager.setCompetitorCircleVisible(i, visible);
      });
    }

    refreshCompetitorList();
    updateCompetitorCountBadge();
    updateCircleToggleBar();
    if (removed) showToast(`🗑️ ${removed.name} 삭제됨`);
  }

  /**
   * 특정 인덱스 경쟁점포 반경 원 토글 (지도 마커 클릭에서 호출됨)
   */
  function toggleCompetitorCircleByIndex(index) {
    const newVisible = MapManager.toggleCompetitorCircle(index);
    if (index < circleStates.length) {
      circleStates[index] = newVisible;
    }
    refreshCompetitorList();
  }

  /**
   * 경쟁점포 리스트 UI 갱신
   */
  function refreshCompetitorList() {
    const listEl = document.getElementById('competitor-list');
    if (!listEl) return;

    if (competitors.length === 0) {
      listEl.innerHTML = `
        <div class="competitor-empty">
          <span>🏬</span>
          <p>아직 탐색된 점포가 없습니다.<br>자동 탐색 또는 수동 검색으로 추가하세요.</p>
        </div>
      `;
      return;
    }

    const apiCount = competitors.filter(c => c.source === 'api').length;
    const aiCount  = competitors.filter(c => c.source === 'ai').length;
    const manualCount = competitors.filter(c => c.source === 'manual').length;

    listEl.innerHTML = `
      <div class="competitor-list-summary">
        <span>총 <strong>${competitors.length}</strong>개</span>
        <div class="summary-badges">
          <span class="s-badge api">API ${apiCount}</span>
          <span class="s-badge ai">AI ${aiCount}</span>
          <span class="s-badge manual">수동 ${manualCount}</span>
        </div>
      </div>
    ` + competitors.map((comp, i) => {
      const isCircleActive = circleStates[i] || false;
      const sourceClass = comp.source || 'api';
      const sourceLabel = comp.source === 'ai' ? 'AI' : comp.source === 'manual' ? '수동' : 'API';
      const distStr = comp.dist ? `${Math.round(comp.dist)}m` : '';

      return `
        <div class="competitor-item ${isCircleActive ? 'circle-active' : ''}" data-idx="${i}" id="comp-item-${i}">
          <div class="competitor-item-info">
            <div class="competitor-item-name" title="${comp.name}">${comp.name}</div>
            <div class="competitor-item-meta">${distStr}${comp.address ? ` · ${comp.address.substring(0, 20)}` : ''}</div>
          </div>
          <span class="competitor-source-badge ${sourceClass}">${sourceLabel}</span>
          <button class="competitor-circle-btn ${isCircleActive ? 'active' : ''}"
            data-idx="${i}" title="반경 원 표시 토글">
            ${isCircleActive ? '🔵' : '⚪'}
          </button>
          <button class="competitor-remove-btn" data-idx="${i}" title="삭제">✕</button>
        </div>
      `;
    }).join('');

    // 이벤트 바인딩
    listEl.querySelectorAll('.competitor-circle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        toggleCompetitorCircleByIndex(idx);
      });
    });

    listEl.querySelectorAll('.competitor-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        removeCompetitor(idx);
      });
    });

    // 클릭 시 지도 이동
    listEl.querySelectorAll('.competitor-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const idx = parseInt(item.dataset.idx);
        const comp = competitors[idx];
        if (comp) MapManager.panTo(comp.lat, comp.lng, 17);
      });
    });
  }

  function updateCompetitorCountBadge() {
    const badge = document.getElementById('competitor-count-badge');
    if (badge) badge.textContent = `${competitors.length}개`;
  }

  function updateCircleToggleBar() {
    const bar = document.getElementById('circle-toggle-bar');
    if (bar) bar.style.display = competitors.length > 0 ? 'flex' : 'none';
  }

  function updateScanStatus(message) {
    const el = document.getElementById('scan-status');
    if (el) el.textContent = message;
  }

  /** 스캔 버튼 활성화 조건: 업종 + 기준점 모두 선택 */
  function updateScanButtonState() {
    const btn = document.getElementById('scan-btn');
    if (!btn) return;
    const canScan = !!(selectedBusinessType && MapManager.getBasePosition());
    btn.disabled = btn.classList.contains('loading') || !canScan;
  }

  // ============================================================
  // 분석 버튼
  // ============================================================
  function setupAnalyzeButton() {
    const btn = document.getElementById('analyze-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (!onAnalyzeCallback) return;
      const pos = MapManager.getBasePosition();
      if (!pos || !selectedBusinessType) return;

      // 현재 등시선 오버라이드 반영
      const isoConfig = getIsochroneConfig();
      onAnalyzeCallback(selectedBusinessType, pos, competitors, isoConfig);
    });
  }

  function updateAnalyzeButtonState() {
    const btn = document.getElementById('analyze-btn');
    if (!btn) return;
    btn.disabled = !(selectedBusinessType && MapManager.getBasePosition());
  }

  /** 현재 선택된 등시선 설정 반환 (초 단위) - 체크박스에 의해 필터링됨 */
  function getIsochroneConfig() {
    const config = {};
    const priChk = document.getElementById('iso-primary-chk');
    const secChk = document.getElementById('iso-secondary-chk');
    const terChk = document.getElementById('iso-tertiary-chk');

    if (priChk && priChk.checked) {
      config.primary = parseInt(document.getElementById('iso-primary').value) * 60;
    }
    if (secChk && secChk.checked) {
      config.secondary = parseInt(document.getElementById('iso-secondary').value) * 60;
    }
    if (terChk && terChk.checked) {
      config.tertiary = parseInt(document.getElementById('iso-tertiary').value) * 60;
    }

    return Object.keys(config).length > 0 ? config : null;
  }

  // ============================================================
  // 사이드바 렌더링
  // ============================================================
  function showEmptyState() {
    const body = document.getElementById('sidebar-body');
    if (!body) return;

    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗺️</div>
        <h3>분석 결과가 여기에 표시됩니다</h3>
        <p>
          1. 업종을 선택하세요<br>
          2. 기준점 탭에서 위치를 설정하세요<br>
          3. 경쟁점포 탭에서 탐색 후<br>
          4. 분석 시작을 눌러주세요
        </p>
      </div>
    `;
  }

  function renderResults(data) {
    const body = document.getElementById('sidebar-body');
    if (!body) return;

    const bt = CONFIG.BUSINESS_TYPES[data.businessType];
    const allCompetitors = data.competitors || [];
    const closeCompetitors = allCompetitors.filter(c => c.dist <= currentRadius).length;

    const apiCount = allCompetitors.filter(c => c.source === 'api').length;
    const aiCount  = allCompetitors.filter(c => c.source === 'ai').length;
    const manualCount = allCompetitors.filter(c => c.source === 'manual').length;

    body.innerHTML = `
      <div class="section-title">분석 결과</div>

      <!-- 지도 범례 -->
      <div class="result-card" style="background:#f0f4f8; border:1px solid #d9e2ec; margin-bottom: 20px;">
        <div class="card-header">
          <span class="card-title">📖 지도 범례</span>
        </div>
        <div style="font-size: 12px; color: #4a4e6a; line-height: 1.7; margin-top: 8px;">
          <div>
            <span style="display:inline-block; width:12px; height:12px; background:rgba(255,107,107,0.2); border:2px solid ${bt.color.primary}; vertical-align:middle; margin-right:4px;"></span>
            <strong>다각형:</strong> 도보 <strong>${Math.round((data.isoConfig?.primary || bt.isochrone.primary) / 60)}분</strong> 내 핵심 상권
          </div>
          <div style="margin-top:4px;">
            <span style="display:inline-block; width:12px; height:12px; background:rgba(160,163,184,0.2); border:1px dashed #a0a3b8; border-radius:50%; vertical-align:middle; margin-right:4px;"></span>
            <strong>원형:</strong> 경쟁업체 상권력 (반경 ${currentRadius}m)
          </div>
        </div>
      </div>

      <!-- 업종 정보 -->
      <div class="result-card">
        <div class="card-header">
          <span class="card-title">${bt.icon} 선택 업종</span>
        </div>
        <div class="card-value" style="color: var(--accent-light)">${bt.label}</div>
        <div class="card-desc">
          기준점: ${data.center.lat.toFixed(4)}, ${data.center.lng.toFixed(4)}
        </div>
      </div>

      <!-- 경쟁업체 현황 -->
      <div class="result-card">
        <div class="card-header">
          <span class="card-title">🏬 경쟁업체 현황</span>
        </div>
        <div class="card-value ${closeCompetitors > 5 ? 'danger' : closeCompetitors > 2 ? 'warning' : 'success'}">
          ${closeCompetitors}개
        </div>
        <div class="card-desc">반경 ${currentRadius}m 이내 (총 ${allCompetitors.length}개 탐색)</div>
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          ${apiCount > 0 ? `<span style="font-size:10px; padding:2px 8px; border-radius:20px; background:rgba(9,132,227,0.1); color:#0984e3; font-weight:600;">API ${apiCount}개</span>` : ''}
          ${aiCount > 0 ? `<span style="font-size:10px; padding:2px 8px; border-radius:20px; background:rgba(108,92,231,0.1); color:#6c5ce7; font-weight:600;">AI ${aiCount}개</span>` : ''}
          ${manualCount > 0 ? `<span style="font-size:10px; padding:2px 8px; border-radius:20px; background:rgba(0,184,148,0.1); color:#00b894; font-weight:600;">수동 ${manualCount}개</span>` : ''}
        </div>
      </div>
    `;
  }

  // ============================================================
  // 로딩 / 토스트
  // ============================================================
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

  function showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ============================================================
  // 공개 인터페이스
  // ============================================================
  function getSelectedBusinessType() { return selectedBusinessType; }
  function getCompetitors() { return competitors; }
  function getCurrentRadius() { return currentRadius; }
  function enableAnalyzeButton() { updateAnalyzeButtonState(); }

  return {
    init,
    updateCoordinates,
    enableAnalyzeButton,
    showEmptyState,
    showLoading,
    hideLoading,
    renderResults,
    showToast,
    getSelectedBusinessType,
    getCompetitors,
    getCurrentRadius,
    getIsochroneConfig,
    setCompetitors,
    addManualCompetitor,
    removeCompetitor,
    toggleCompetitorCircleByIndex,
    switchTab
  };
})();
