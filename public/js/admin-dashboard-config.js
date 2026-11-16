/**
 * 🍱 JG 관리자 센터 - 메인 대시보드 위젯 배치 및 레이아웃 제어 스크립트
 * admin-dashboard-config.js
 * - 메인 포털 홈 화면의 위젯 순서, 노출 여부, 너비(반폭/전폭)를 GUI에서 실시간 제어
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    const SPAN_CYCLE = ['third', 'half', 'wide', 'full'];
    const SPAN_LABELS = {
        third: '◧ 1/3 폭',
        half:  '▫️ 반폭 (1/2)',
        wide:  '◨ 2/3 폭',
        full:  '↔️ 전폭 (100%)'
    };

    let currentWidgets = [];
    let currentSections = [];
    let isSaving = false;

    function getSpanMode(w) {
        if (w && SPAN_CYCLE.includes(w.spanMode)) return w.spanMode;
        return Number(w && w.colSpan) === 2 ? 'full' : 'half';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * 모듈 관리자 내 2단 서브탭 전환 (모듈 목록 <-> 대시보드 위젯)
     */
    window.switchModulesSubtab = function(subtabKey) {
        const paneList = document.getElementById('paneModulesList');
        const paneWidgets = document.getElementById('paneDashboardWidgets');
        const btnList = document.getElementById('btnSubtabModulesList');
        const btnWidgets = document.getElementById('btnSubtabDashboardWidgets');

        if (subtabKey === 'widgets') {
            if (paneList) paneList.style.display = 'none';
            if (paneWidgets) paneWidgets.style.display = 'block';
            if (btnList) btnList.classList.remove('active');
            if (btnWidgets) btnWidgets.classList.add('active');
            loadDashboardWidgetsList();
        } else {
            if (paneList) paneList.style.display = 'block';
            if (paneWidgets) paneWidgets.style.display = 'none';
            if (btnList) btnList.classList.add('active');
            if (btnWidgets) btnWidgets.classList.remove('active');
        }
    };

    /**
     * 대시보드 위젯 설정 불러오기
     */
    window.loadDashboardWidgetsList = async function() {
        const tbody = document.getElementById('dashboardWidgetsTableBody');
        if (!tbody) return;

        try {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">위젯 배치 설정을 불러오는 중입니다...</td></tr>';
            const res = await fetch('/api/modules/dashboard/config');
            const data = await res.json();

            if (!data.success || !Array.isArray(data.widgets)) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">${escapeHtml(data.message || '설정 불러오기 실패')}</td></tr>`;
                return;
            }

            currentWidgets = data.widgets;
            currentSections = Array.isArray(data.sections) ? data.sections : [];
            renderWidgetsTable(currentWidgets);
            updateWidgetSummaryStats(currentWidgets);
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">서버와 통신할 수 없습니다.</td></tr>';
        }
    };

    /**
     * 위젯 요약 지표 업데이트
     */
    function updateWidgetSummaryStats(widgets) {
        const total = widgets.length;
        const active = widgets.filter(w => w.enabled !== false).length;
        const fullWidth = widgets.filter(w => getSpanMode(w) === 'full').length;

        const elTotal = document.getElementById('widgetStatTotal');
        const elActive = document.getElementById('widgetStatActive');
        const elFull = document.getElementById('widgetStatFull');

        if (elTotal) elTotal.textContent = `${total}개`;
        if (elActive) elActive.textContent = `${active}개`;
        if (elFull) elFull.textContent = `${fullWidth}개`;
    }

    /**
     * 위젯 설정 테이블 렌더링
     */
    function renderWidgetsTable(widgets) {
        const tbody = document.getElementById('dashboardWidgetsTableBody');
        if (!tbody) return;

        if (widgets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem; color:#64748b;">설정 가능한 대시보드 위젯이 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = widgets.map((w, idx) => {
            const isEnabled = w.enabled !== false;
            const isFirst = idx === 0;
            const isLast = idx === widgets.length - 1;
            const orderNum = idx + 1;
            const spanMode = getSpanMode(w);
            const isFullWidth = spanMode === 'full';

            const toggleBtn = isEnabled ? `
                <button type="button" class="btn-admin btn-admin-success btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleWidgetItemEnabled(${idx})">
                    🟢 노출 중
                </button>
            ` : `
                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 8px; font-size:0.75rem; color:#94a3b8;" onclick="toggleWidgetItemEnabled(${idx})">
                    ⚪ 숨김
                </button>
            `;

            const colSpanBtn = `
                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm"
                    style="${isFullWidth ? 'background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:700;' : ''} padding:2px 8px; font-size:0.75rem;"
                    onclick="toggleWidgetItemColSpan(${idx})" title="클릭하여 너비 순환 (1/3 → 1/2 → 2/3 → 전폭)">
                    ${SPAN_LABELS[spanMode] || SPAN_LABELS.half}
                </button>
            `;

            const sectionSelect = currentSections.length > 0 ? `
                <select aria-label="소속 섹션 선택" onchange="changeWidgetItemSection(${idx}, this.value)"
                    style="width:100%; font-size:0.76rem; padding:4px 6px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; color:#0f172a;">
                    ${currentSections.map(s => `
                        <option value="${escapeHtml(s.id)}" ${w.sectionId === s.id ? 'selected' : ''}>
                            ${escapeHtml((s.icon || '📁') + ' ' + s.title)}
                        </option>
                    `).join('')}
                </select>
            ` : `<span style="font-size:0.75rem; color:#64748b;">${escapeHtml(w.sectionId || '기본')}</span>`;

            const badgeModule = w.isModuleWidget ? `
                <span class="badge" style="background:#f3e8ff; color:#7e22ce; font-size:0.7rem; padding:1px 5px;">신규 모듈</span>
            ` : `
                <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; padding:1px 5px;">기본 위젯</span>
            `;

            return `
                <tr style="${isEnabled ? '' : 'opacity:0.55; background:#fafafa;'}">
                    <td style="text-align:center; vertical-align:middle; white-space:nowrap; width:65px;">
                        <div style="display:inline-flex; align-items:center; justify-content:center; gap:4px;">
                            <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.78rem; padding:2px 6px; border-radius:4px; min-width:20px;">
                                ${orderNum}
                            </span>
                            <div style="display:inline-flex; flex-direction:column; gap:2px;">
                                <button type="button" class="btn-admin btn-admin-outline" 
                                    style="padding:0 4px; height:15px; line-height:13px; font-size:0.6rem; border-radius:3px; ${isFirst ? 'opacity:0.2; cursor:not-allowed;' : ''}" 
                                    ${isFirst ? 'disabled' : ''} 
                                    onclick="moveWidgetItem(${idx}, 'up')" title="위로 이동">▲</button>
                                <button type="button" class="btn-admin btn-admin-outline" 
                                    style="padding:0 4px; height:15px; line-height:13px; font-size:0.6rem; border-radius:3px; ${isLast ? 'opacity:0.2; cursor:not-allowed;' : ''}" 
                                    ${isLast ? 'disabled' : ''} 
                                    onclick="moveWidgetItem(${idx}, 'down')" title="아래로 이동">▼</button>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="font-weight:700; font-size:0.9rem; color:#0f172a; display:flex; align-items:center; gap:6px;">
                            <span>${w.icon || '📦'}</span>
                            <span>${escapeHtml(w.title)}</span>
                            ${badgeModule}
                        </div>
                        <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                            ${escapeHtml(w.desc || '')}
                        </div>
                    </td>
                    <td>
                        ${sectionSelect}
                    </td>
                    <td style="font-family:monospace; font-size:0.75rem; color:#64748b;">
                        <code>${escapeHtml(w.selector || '#' + w.id)}</code>
                    </td>
                    <td style="text-align:center;">
                        ${colSpanBtn}
                    </td>
                    <td style="text-align:center;">
                        ${toggleBtn}
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.changeWidgetItemSection = function(idx, sectionId) {
        if (!currentWidgets[idx] || !sectionId) return;
        currentWidgets[idx].sectionId = sectionId;
    };

    window.toggleWidgetItemEnabled = function(idx) {
        if (!currentWidgets[idx]) return;
        currentWidgets[idx].enabled = !currentWidgets[idx].enabled;
        renderWidgetsTable(currentWidgets);
        updateWidgetSummaryStats(currentWidgets);
    };

    window.toggleWidgetItemColSpan = function(idx) {
        if (!currentWidgets[idx]) return;
        const curMode = getSpanMode(currentWidgets[idx]);
        const nextMode = SPAN_CYCLE[(SPAN_CYCLE.indexOf(curMode) + 1) % SPAN_CYCLE.length];
        currentWidgets[idx].spanMode = nextMode;
        currentWidgets[idx].colSpan = nextMode === 'full' ? 2 : 1;
        renderWidgetsTable(currentWidgets);
        updateWidgetSummaryStats(currentWidgets);
    };

    window.moveWidgetItem = function(idx, direction) {
        if (direction === 'up' && idx > 0) {
            const temp = currentWidgets[idx];
            currentWidgets[idx] = currentWidgets[idx - 1];
            currentWidgets[idx - 1] = temp;
        } else if (direction === 'down' && idx < currentWidgets.length - 1) {
            const temp = currentWidgets[idx];
            currentWidgets[idx] = currentWidgets[idx + 1];
            currentWidgets[idx + 1] = temp;
        }
        renderWidgetsTable(currentWidgets);
    };

    window.saveDashboardWidgetsConfig = async function() {
        if (isSaving) return;
        isSaving = true;

        const saveBtn = document.getElementById('btnSaveDashboardWidgets');
        const origText = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) saveBtn.innerHTML = '⏳ 저장 중...';

        try {
            const res = await fetch('/api/modules/dashboard/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: currentWidgets, sections: currentSections })
            });
            const data = await res.json();

            if (data.success) {
                currentWidgets = data.widgets || currentWidgets;
                currentSections = data.sections || currentSections;
                try {
                    localStorage.setItem('jg_dashboard_config_cache', JSON.stringify({ sections: currentSections, widgets: currentWidgets }));
                } catch (e) {}

                if (typeof showToast === 'function') {
                    showToast(data.message || '대시보드 위젯 배치가 저장되었습니다.');
                } else {
                    alert(data.message || '저장되었습니다.');
                }
                renderWidgetsTable(currentWidgets);
                updateWidgetSummaryStats(currentWidgets);
            } else {
                alert(data.message || '저장에 실패했습니다.');
            }
        } catch (e) {
            alert('저장 중 통신 오류가 발생했습니다.');
        } finally {
            isSaving = false;
            if (saveBtn) saveBtn.innerHTML = origText;
        }
    };

    window.resetDashboardWidgetsConfig = async function() {
        if (!confirm('대시보드 섹션·위젯 배치를 시스템 기본값으로 초기화하시겠습니까?')) {
            return;
        }

        try {
            const res = await fetch('/api/modules/dashboard/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();

            if (data.success) {
                try {
                    localStorage.removeItem('jg_dashboard_config_cache');
                } catch (e) {}
                if (typeof showToast === 'function') {
                    showToast(data.message || '기본값으로 복원되었습니다.');
                } else {
                    alert(data.message || '기본값으로 복원되었습니다.');
                }
                currentWidgets = data.widgets || [];
                currentSections = data.sections || [];
                renderWidgetsTable(currentWidgets);
                updateWidgetSummaryStats(currentWidgets);
            } else {
                alert(data.message || '초기화 실패');
            }
        } catch (e) {
            alert('초기화 중 오류가 발생했습니다.');
        }
    };
})();
