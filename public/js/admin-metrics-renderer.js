/**
 * JG Portal 관리자 센터 - 표준 Bento KPI 메트릭 카드 렌더러
 * admin-metrics-renderer.js (Step C: Zero-Code Metrics Engine)
 */
(function() {
    'use strict';

    let currentKpiModuleId = null;

    /**
     * 개별 KPI 카드 HTML 렌더링
     */
    function renderSingleKpiCard(metric) {
        const colorClass = metric.color ? `color-${metric.color}` : 'color-primary';
        const icon = metric.icon || '📊';
        const label = escapeHtml(metric.label || '지표');
        const value = escapeHtml(String(metric.value ?? '-'));
        const subtext = metric.subtext ? `<div class="kpi-card-subtext">${escapeHtml(metric.subtext)}</div>` : '';
        const badge = metric.badge ? `<span class="badge" style="font-size:0.7rem; padding:1px 6px; background:#f1f5f9; color:#475569;">${escapeHtml(metric.badge)}</span>` : '';

        return `
            <div class="kpi-card ${colorClass}">
                <div class="kpi-card-header">
                    <span class="kpi-card-label">${label}</span>
                    <div class="kpi-card-icon-box">
                        <span>${icon}</span>
                    </div>
                </div>
                <div class="kpi-card-value">
                    <span>${value}</span>
                    ${badge}
                </div>
                ${subtext}
            </div>
        `;
    }

    /**
     * 메트릭 리스트를 받아 지정된 컨테이너에 Bento 그리드로 렌더링
     */
    function renderKpiGrid(containerEl, metricsList) {
        if (!containerEl) return;
        if (!Array.isArray(metricsList) || metricsList.length === 0) {
            containerEl.innerHTML = '<div style="text-align:center; padding:1.5rem; color:#94a3b8; font-size:0.85rem;">집계된 지표가 없습니다.</div>';
            return;
        }

        const cardsHtml = metricsList.map(m => renderSingleKpiCard(m)).join('');
        containerEl.innerHTML = `<div class="kpi-bento-grid">${cardsHtml}</div>`;
    }

    /**
     * 특정 모듈의 실시간 KPI 지표 로드
     */
    async function loadModuleMetrics(moduleId, containerEl) {
        if (!containerEl) return;
        containerEl.innerHTML = `
            <div style="text-align:center; padding:2rem; color:#64748b; font-size:0.88rem;">
                <div style="display:inline-block; animation:spin 1s linear infinite; font-size:1.4rem; margin-bottom:0.5rem;">🔄</div>
                <div>실시간 서비스 지표 및 DB 상태 분석 중...</div>
            </div>
        `;

        try {
            const res = await fetch(`/api/modules/${moduleId}/metrics`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            renderKpiGrid(containerEl, data.metrics || []);
            return data;
        } catch (err) {
            containerEl.innerHTML = `
                <div style="text-align:center; padding:1.5rem; color:#ef4444; font-size:0.85rem;">
                    ⚠️ 지표 로드 실패: ${escapeHtml(err.message)}
                </div>
            `;
            return null;
        }
    }

    /**
     * 서비스 모듈 실시간 KPI 팝업 모달 열기
     */
    window.openModuleKpiModal = async function(moduleId, moduleName) {
        currentKpiModuleId = moduleId;
        const modal = document.getElementById('moduleKpiModal');
        const titleEl = document.getElementById('moduleKpiModalTitle');
        const containerEl = document.getElementById('moduleKpiCardsContainer');
        const dbLinkBtn = document.getElementById('moduleKpiDbLinkBtn');
        const entryLinkBtn = document.getElementById('moduleKpiEntryLinkBtn');
        if (!modal || !containerEl) return;

        if (titleEl) {
            titleEl.textContent = `📊 [${moduleName || moduleId}] 실시간 핵심 지표 (Bento KPI)`;
        }

        modal.style.display = 'flex';
        modal.classList.add('active');
        document.documentElement.classList.add('modal-open');
        document.body.classList.add('modal-open');

        const data = await loadModuleMetrics(moduleId, containerEl);

        // 하단 액션 버튼 링크 연동
        if (data) {
            if (entryLinkBtn) {
                entryLinkBtn.href = data.entryUrl || '#';
                entryLinkBtn.style.display = data.entryUrl ? 'inline-flex' : 'none';
            }
            if (dbLinkBtn) {
                if (data.dbPath) {
                    dbLinkBtn.style.display = 'inline-flex';
                    dbLinkBtn.onclick = function() {
                        closeModuleKpiModal();
                        if (typeof switchAdminTab === 'function') {
                            switchAdminTab('tab-database');
                            if (window.DbManager) {
                                setTimeout(() => DbManager.switchDb(moduleId), 150);
                            }
                        }
                    };
                } else {
                    dbLinkBtn.style.display = 'none';
                }
            }
        }
    };

    /**
     * KPI 팝업 닫기
     */
    window.closeModuleKpiModal = function() {
        const modal = document.getElementById('moduleKpiModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
        const hasOpenModal = Array.from(document.querySelectorAll('.admin-modal-backdrop')).some(el => {
            return (el !== modal) && (el.style.display === 'flex' || el.classList.contains('active'));
        });
        if (!hasOpenModal) {
            document.documentElement.classList.remove('modal-open');
            document.body.classList.remove('modal-open');
        }
    };

    /**
     * 현재 열린 KPI 모달 새로고침
     */
    window.refreshCurrentModuleKpi = function() {
        if (!currentKpiModuleId) return;
        const containerEl = document.getElementById('moduleKpiCardsContainer');
        if (containerEl) {
            loadModuleMetrics(currentKpiModuleId, containerEl);
            if (typeof showToast === 'function') showToast('실시간 지표가 새로고침되었습니다.');
        }
    };

    // ESC 키로 KPI 모달 닫기
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('moduleKpiModal');
            if (modal && (modal.style.display === 'flex' || modal.classList.contains('active'))) {
                closeModuleKpiModal();
            }
        }
    });

    // 전역 공개
    window.renderKpiGrid = renderKpiGrid;
    window.loadModuleMetrics = loadModuleMetrics;
})();
