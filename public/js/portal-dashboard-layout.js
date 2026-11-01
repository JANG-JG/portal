/**
 * 🍱 JG 포털 메인 대시보드 동적 레이아웃 엔진 (portal-dashboard-layout.js)
 * - /api/modules/dashboard/config 설정을 읽어 메인 홈의 위젯 순서(물리적 DOM 재배치 + CSS order), 노출(display), 너비(gridColumn) 동적 적용
 * - SWR(Stale-While-Revalidate) 로컬 캐시로 페이지 새로고침 시 깜빡임(0ms 즉시 렌더링) 차단
 * - 기존 DOM ID, 이벤트 바인딩, 실시간 차트/소켓 로직 100% 무결성 보존 ([규칙 3], [규칙 5])
 * - [규칙 2] 한국어 인터페이스 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    const CACHE_KEY = 'jg_dashboard_config_cache';

    /**
     * DOM에 위젯 레이아웃(순서, 너비, 노출) 실제 물리적 적용
     */
    function applyWidgetsConfig(widgets) {
        if (!Array.isArray(widgets) || widgets.length === 0) return;

        const isRoleAdmin = document.documentElement.classList.contains('role-admin');
        const isHideBlood = document.documentElement.classList.contains('hide-blood');
        const isHideOps = document.documentElement.classList.contains('hide-ops');
        const isHideAsset = document.documentElement.classList.contains('hide-asset');

        const homarrGrid = document.getElementById('portalHomarrGrid');
        const bentoRoot = document.getElementById('portal-bento-root');

        // 순서 기준 정렬
        const sortedWidgets = [...widgets].sort((a, b) => (a.order || 0) - (b.order || 0));

        // 1. 개별 위젯 상태(노출, 너비, order) 적용
        sortedWidgets.forEach(w => {
            let el = null;
            if (w.selector) {
                try { el = document.querySelector(w.selector); } catch (e) {}
            }
            if (!el && w.id) {
                el = document.getElementById(w.id);
            }
            if (!el) return;

            // 권한 기반 은폐 우선 존중
            if (w.id === 'homarrHeroCard' || w.id === 'bento-blood') {
                if (isHideBlood) return;
            }
            if (w.id === 'bento-ops' && isHideOps) {
                return;
            }
            if (w.id === 'bento-asset' && isHideAsset) {
                return;
            }

            // 노출 On/Off
            if (w.enabled === false) {
                el.style.setProperty('display', 'none', 'important');
                const tabKey = w.id.replace('bento-', '').replace('card-', '');
                document.querySelectorAll(`.portal-tab-btn[data-tab="${tabKey}"]`).forEach(btn => {
                    btn.style.display = 'none';
                });
                return;
            }

            // 노출 복원
            if (el.style.display === 'none' && !el.getAttribute('data-hidden-by-auth')) {
                el.style.display = '';
            }

            // CSS Flex/Grid order 부여
            if (typeof w.order === 'number') {
                el.style.order = String(w.order);
            }

            // 그리드 너비 (colSpan)
            if (el.parentElement && el.parentElement.id === 'portalHomarrGrid') {
                if (w.colSpan === 2) {
                    el.style.gridColumn = '1 / -1';
                } else if (w.colSpan === 1) {
                    el.style.gridColumn = 'span 1';
                }
            }
        });

        // 2. 물리적 DOM 재배치 (CSS order 미지원 또는 브라우저 엔진 불일치 원천 해결)
        // A) portalHomarrGrid 내부 위젯 물리적 순서 재배치
        if (homarrGrid) {
            sortedWidgets.forEach(w => {
                let el = null;
                if (w.selector) {
                    try { el = document.querySelector(w.selector); } catch (e) {}
                }
                if (!el && w.id) {
                    el = document.getElementById(w.id);
                }
                if (el && el.parentElement === homarrGrid) {
                    homarrGrid.appendChild(el);
                }
            });
        }

        // B) portal-bento-root 직계 자식 위젯 물리적 순서 재배치
        if (bentoRoot) {
            sortedWidgets.forEach(w => {
                let el = null;
                if (w.selector) {
                    try { el = document.querySelector(w.selector); } catch (e) {}
                }
                if (!el && w.id) {
                    el = document.getElementById(w.id);
                }
                // homarrGrid 직계 자식은 제외하고 bentoRoot 직계인 경우만
                if (el && el.parentElement === bentoRoot && el !== homarrGrid) {
                    // homarrGrid보다 앞에 순서대로 삽입
                    bentoRoot.insertBefore(el, homarrGrid);
                }
            });
        }

        // 관리자인 경우 빠른 위젯 설정 바로가기 링크 유지
        if (isRoleAdmin) {
            renderAdminWidgetQuickLink();
        }
    }

    /**
     * 서버 설정 조회 및 캐시 갱신 (SWR 패턴)
     */
    async function loadAndApplyDashboardConfig() {
        // 1단계: 로컬 캐시가 있으면 즉시 0ms 적용 (새로고침 깜빡임 방지)
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    applyWidgetsConfig(parsed);
                }
            }
        } catch (e) {}

        // 2단계: 서버 최신 설정 비동기 조회 후 재적용 및 캐시 동기화
        try {
            const res = await fetch('/api/modules/dashboard/config');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && Array.isArray(data.widgets)) {
                applyWidgetsConfig(data.widgets);
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify(data.widgets));
                } catch (e) {}
            }
        } catch (e) {
            console.warn('[DashboardLayout] 서버 설정 동기화 실패 (캐시 유지):', e);
        }
    }

    /**
     * 관리자용 대시보드 화면 편집 및 위젯 설정 바로가기 링크
     */
    function renderAdminWidgetQuickLink() {
        if (document.getElementById('adminWidgetQuickConfigGroup')) return;
        const targetContainer = document.querySelector('.cmd-strip-header');
        if (!targetContainer) return;

        const group = document.createElement('div');
        group.id = 'adminWidgetQuickConfigGroup';
        group.style.cssText = 'display:inline-flex; align-items:center; gap:6px; margin-left:auto;';

        group.innerHTML = `
            <button type="button" id="btnLiveDashboardEdit" onclick="if(typeof toggleDashboardEditMode==='function')toggleDashboardEditMode(true)" 
                title="메인 화면에서 카드를 직접 배치하고 조절합니다"
                style="font-size:0.75rem; color:#fff; background:#2563eb; border:none; display:inline-flex; align-items:center; gap:4px; font-weight:700; padding:2px 9px; border-radius:4px; cursor:pointer; box-shadow:0 1px 4px rgba(37,99,235,0.3);">
                <span>🎨</span><span>화면 편집</span>
            </button>
            <a href="/admin#tab-modules:subpane-modules-widgets" id="adminWidgetQuickConfigBtn" 
                title="관리자 센터 대시보드 위젯 설정으로 이동"
                style="font-size:0.72rem; color:#64748b; text-decoration:none; display:inline-flex; align-items:center; gap:2px; font-weight:500; padding:2px 6px; border-radius:4px; background:#f1f5f9; border:1px solid #e2e8f0;">
                <span>⚙️</span><span>설정</span>
            </a>
        `;

        targetContainer.appendChild(group);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAndApplyDashboardConfig);
    } else {
        loadAndApplyDashboardConfig();
    }

    // 전역 함수 노출
    window.applyDashboardWidgetsToDOM = applyWidgetsConfig;
    window.refreshDashboardLayout = loadAndApplyDashboardConfig;
})();
