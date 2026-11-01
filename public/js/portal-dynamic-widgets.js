/**
 * 🍱 JG 포털 동적 위젯 렌더링 엔진 (portal-dynamic-widgets.js)
 * - 오픈소스 서비스(Uptime Kuma, Glances 등) 및 커스텀 위젯을 메인 홈 그리드에 실시간 주입
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    /**
     * 메인 그리드에 동적 커스텀 위젯들을 로드하여 렌더링
     */
    async function loadDynamicWidgets() {
        const grid = document.getElementById('portalHomarrGrid');
        if (!grid) return;

        try {
            const res = await fetch('/api/modules/custom-widgets');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !Array.isArray(data.widgets)) return;

            data.widgets.forEach(w => {
                if (w.enabled === false) return;
                renderSingleCustomWidget(w, grid);
            });
        } catch (e) {
            console.warn('[DynamicWidgets] 커스텀 위젯 로드 실패:', e);
        }
    }

    /**
     * 단일 커스텀 위젯 카드 DOM 생성 및 주입
     */
    function renderSingleCustomWidget(w, grid) {
        let card = document.getElementById(w.id);
        if (!card) {
            card = document.createElement('div');
            card.id = w.id;
            card.className = 'homarr-card custom-dynamic-widget-card';
            card.setAttribute('data-custom-widget', '1');
            grid.appendChild(card);
        }

        // 너비 적용
        if (w.colSpan === 2) {
            card.style.gridColumn = '1 / -1';
        } else {
            card.style.gridColumn = 'span 1';
        }

        if (w.type === 'embed') {
            renderEmbedWidget(card, w);
        } else if (w.type === 'metric') {
            renderMetricWidget(card, w);
        } else {
            renderGenericWidget(card, w);
        }
    }

    /**
     * 1. 웹 임베드 (iFrame) 위젯 렌더러
     */
    function renderEmbedWidget(card, w) {
        const safeTitle = escapeHtml(w.title);
        const safeUrl = encodeURI(w.embedUrl || '');
        const height = Math.min(Math.max(w.embedHeight || 280, 160), 600);

        card.innerHTML = `
            <div class="homarr-card-header">
                <div class="homarr-card-title-group">
                    <span class="homarr-card-icon">${w.icon || '🌐'}</span>
                    <h3 class="homarr-card-title">${safeTitle}</h3>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="homarr-card-link" title="새 탭으로 열기">
                        외부 열기 ↗
                    </a>
                </div>
            </div>
            <div class="custom-embed-container" style="position:relative; width:100%; height:${height}px; border-radius:10px; overflow:hidden; border:1px solid var(--hm-border, #e2e8f0); background:var(--hm-bg-subtle, #f8fafc);">
                <iframe src="${safeUrl}" 
                    style="width:100%; height:100%; border:none; display:block;" 
                    loading="lazy" 
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    title="${safeTitle}">
                </iframe>
            </div>
        `;
    }

    /**
     * 2. REST API / 실시간 수치 위젯 렌더러
     */
    function renderMetricWidget(card, w) {
        const safeTitle = escapeHtml(w.title);

        card.innerHTML = `
            <div class="homarr-card-header">
                <div class="homarr-card-title-group">
                    <span class="homarr-card-icon">${w.icon || '📊'}</span>
                    <h3 class="homarr-card-title">${safeTitle}</h3>
                </div>
                <button type="button" class="btn-refresh-metric" style="background:transparent; border:none; color:var(--hm-text-muted); cursor:pointer; font-size:0.78rem;">
                    🔄 새로고침
                </button>
            </div>
            <div class="custom-metric-body" id="metricBody_${w.id}" style="padding:0.75rem 0;">
                <div style="font-size:0.85rem; color:var(--hm-text-muted); text-align:center;">데이터를 불러오는 중...</div>
            </div>
        `;

        const refreshBtn = card.querySelector('.btn-refresh-metric');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => fetchMetricData(w));
        }

        fetchMetricData(w);
    }

    /**
     * 3. 일반 안내 위젯 렌더러
     */
    function renderGenericWidget(card, w) {
        card.innerHTML = `
            <div class="homarr-card-header">
                <div class="homarr-card-title-group">
                    <span class="homarr-card-icon">${w.icon || '📦'}</span>
                    <h3 class="homarr-card-title">${escapeHtml(w.title)}</h3>
                </div>
            </div>
            <div style="padding:1rem; font-size:0.85rem; color:var(--hm-text-muted);">
                ${escapeHtml(w.desc || '등록된 위젯 내용이 없습니다.')}
            </div>
        `;
    }

    /**
     * 메트릭 데이터 가져오기
     */
    async function fetchMetricData(w) {
        const bodyEl = document.getElementById(`metricBody_${w.id}`);
        if (!bodyEl) return;

        if (w.renderType === 'system_gauge') {
            try {
                const res = await fetch('/api/summary');
                const data = await res.json();
                if (!data.success || !data.system) return;

                const primary = data.system.primary || {};
                bodyEl.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
                            <span style="font-weight:600; color:var(--hm-text-body);">CPU 사용률</span>
                            <span class="font-mono" style="font-weight:700; color:#2563eb;">${primary.cpu || '0%'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
                            <span style="font-weight:600; color:var(--hm-text-body);">메모리 (RAM)</span>
                            <span class="font-mono" style="font-weight:700; color:#10b981;">${primary.ram || '0%'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
                            <span style="font-weight:600; color:var(--hm-text-body);">저장 공간 (디스크)</span>
                            <span class="font-mono" style="font-weight:700; color:#f59e0b;">${primary.disk || '0%'}</span>
                        </div>
                    </div>
                `;
            } catch (e) {
                bodyEl.innerHTML = '<div style="color:#ef4444; font-size:0.8rem;">자원 정보 로드 실패</div>';
            }
            return;
        }

        if (w.endpoint) {
            try {
                const res = await fetch(w.endpoint);
                const data = await res.json();
                bodyEl.innerHTML = `
                    <div style="background:var(--hm-bg-subtle); padding:0.65rem; border-radius:8px; font-family:monospace; font-size:0.75rem; max-height:120px; overflow-y:auto;">
                        <pre style="margin:0;">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
                    </div>
                `;
            } catch (e) {
                bodyEl.innerHTML = '<div style="color:#ef4444; font-size:0.8rem;">API 호출 실패</div>';
            }
        }
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

    // 초기 로드
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDynamicWidgets);
    } else {
        loadDynamicWidgets();
    }

    window.reloadDynamicWidgets = loadDynamicWidgets;

})();
