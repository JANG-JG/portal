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
     * 위젯 ID로부터 상단 탭 키 도출
     */
    function getTabKeyFromWidget(w) {
        if (!w || !w.id) return null;
        if (w.tabKey) return w.tabKey;
        if (w.id === 'homarrHeroCard' || w.id === 'bento-blood') return 'blood';
        if (w.id.startsWith('bento-')) {
            return w.id.replace('bento-', '');
        }
        return null;
    }

    function prefersReducedMotion() {
        return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function runWithViewTransition(mutator) {
        if (typeof mutator !== 'function') return;
        if (!prefersReducedMotion() && typeof document.startViewTransition === 'function') {
            try {
                document.startViewTransition(mutator);
                return;
            } catch (e) {}
        }
        mutator();
    }

    function toSafeVtToken(raw) {
        return String(raw || 'item').replace(/[^a-zA-Z0-9_-]/g, '-');
    }

    /**
     * 위젯 순서에 맞춰 상단 탭 메뉴(데스크톱 및 모바일) 버튼 순서 동기화
     */
    function syncNavTabsOrder(sortedWidgets) {
        if (!Array.isArray(sortedWidgets) || sortedWidgets.length === 0) return;

        const navContainers = [
            { el: document.getElementById('portal-tab-nav'), scope: 'desk' },
            { el: document.querySelector('.cmd-nav-mobile-strip'), scope: 'mob' }
        ].filter(item => Boolean(item.el));

        if (navContainers.length === 0) return;

        // 1. 실제 노출/활성 위젯 순서에서 탭 키 배열 추출 (중복 제거)
        const orderedTabKeys = [];
        sortedWidgets.forEach(w => {
            if (w.enabled === false) return;
            const tabKey = getTabKeyFromWidget(w);
            if (tabKey && !orderedTabKeys.includes(tabKey)) {
                orderedTabKeys.push(tabKey);
            }
        });

        // 2. 각 컨테이너(데스크톱, 모바일)의 탭 버튼들을 위젯 순서와 동일하게 재배치
        navContainers.forEach(({ el: container, scope }) => {
            const btns = Array.from(container.querySelectorAll('.portal-tab-btn'));
            if (btns.length === 0) return;

            const setTabVt = (btn, tabKey) => {
                btn.classList.add('bento-vt-tab');
                btn.style.viewTransitionName = btn.style.display === 'none'
                    ? ''
                    : `bento-nav-${scope}-${toSafeVtToken(tabKey)}`;
            };

            // 1) 'home'(대시보드 홈) 탭은 언제나 최상단 맨 앞 고정
            const homeBtn = btns.find(b => b.getAttribute('data-tab') === 'home');
            if (homeBtn) {
                setTabVt(homeBtn, 'home');
                moveNodeBefore(container, homeBtn, null);
            }

            // 2) 위젯 순서에 매핑된 탭 버튼들을 순서대로 재배치
            orderedTabKeys.forEach(tabKey => {
                const btn = btns.find(b => b.getAttribute('data-tab') === tabKey);
                if (btn) {
                    setTabVt(btn, tabKey);
                    moveNodeBefore(container, btn, null);
                }
            });

            // 3) 위젯 목록에 포함되지 않거나 비활성 상태인 기타 탭 버튼들 맨 뒤에 유지
            btns.forEach(btn => {
                const tabKey = btn.getAttribute('data-tab');
                if (tabKey !== 'home' && !orderedTabKeys.includes(tabKey)) {
                    setTabVt(btn, tabKey);
                    moveNodeBefore(container, btn, null);
                }
            });
        });
    }

    const DEFAULT_FULL_WIDTH_IDS = new Set([
        'smartDailyBriefingCard',
        'homarrHeroCard',
        'cmd-strip',
        'portalStudyBuddyStrip',
        'breakingBannerBar',
        'bento-ops'
    ]);
    const supportsMoveBefore = typeof Element !== 'undefined' && Object.hasOwn(Element.prototype, 'moveBefore');

    function resolveWidgetElement(w) {
        if (!w) return null;
        if (w.selector) {
            try {
                const found = document.querySelector(w.selector);
                if (found) return found;
            } catch (e) {}
        }
        return w.id ? document.getElementById(w.id) : null;
    }

    function moveNodeBefore(parent, node, refNode) {
        if (!parent || !node || refNode === node) return;
        const targetRef = refNode || null;
        if (node.parentElement === parent && node.nextElementSibling === targetRef) return;
        if (supportsMoveBefore) {
            try {
                parent.moveBefore(node, targetRef);
                return;
            } catch (e) {}
        }
        parent.insertBefore(node, targetRef);
    }

    /**
     * DOM에 위젯 레이아웃(단일 통합 그리드 순서, 반폭/전폭, 노출, 상단 탭) 적용
     */
    function applyWidgetsConfig(widgets, options) {
        if (!Array.isArray(widgets) || widgets.length === 0) return;

        const opts = options && typeof options === 'object' ? options : {};

        const applyDOM = () => {
            const isRoleAdmin = document.documentElement.classList.contains('role-admin');
            const isHideBlood = document.documentElement.classList.contains('hide-blood');
            const isHideOps = document.documentElement.classList.contains('hide-ops');
            const isHideAsset = document.documentElement.classList.contains('hide-asset');

            const homarrGrid = document.getElementById('portalHomarrGrid');

            // 순서 기준 정렬
            const sortedWidgets = [...widgets].sort((a, b) => (a.order || 0) - (b.order || 0));

            // 1. 개별 위젯 노출 상태 및 권한 가드 적용
            sortedWidgets.forEach(w => {
                const el = resolveWidgetElement(w);
                if (!el) return;

                // 권한 기반 은폐 우선 존중
                if ((w.id === 'homarrHeroCard' || w.id === 'bento-blood') && isHideBlood) return;
                if (w.id === 'bento-ops' && isHideOps) return;
                if (w.id === 'bento-asset' && isHideAsset) return;

                const tabKey = getTabKeyFromWidget(w);
                if (w.enabled === false) {
                    el.dataset.dashboardHidden = '1';
                    el.style.setProperty('display', 'none', 'important');
                    if (tabKey) {
                        document.querySelectorAll(`.portal-tab-btn[data-tab="${tabKey}"]`).forEach(btn => {
                            btn.style.display = 'none';
                        });
                    }
                    return;
                }

                delete el.dataset.dashboardHidden;

                // 노출 복원 (비동기 학습 위젯은 데이터가 있을 때만 노출)
                if (el.id === 'portalStudyBuddyStrip') {
                    el.style.display = el.classList.contains('has-study-buddies') ? '' : 'none';
                } else if (el.style.display === 'none' && !el.getAttribute('data-hidden-by-auth')) {
                    el.style.display = '';
                }

                if (tabKey) {
                    let canShow = true;
                    if (tabKey === 'blood' && isHideBlood) canShow = false;
                    if (tabKey === 'ops' && isHideOps) canShow = false;
                    if (tabKey === 'asset' && isHideAsset) canShow = false;
                    if (canShow) {
                        document.querySelectorAll(`.portal-tab-btn[data-tab="${tabKey}"]`).forEach(btn => {
                            if (btn.style.display === 'none' && !btn.getAttribute('data-hidden-by-auth')) {
                                btn.style.display = '';
                            }
                        });
                    }
                }
            });

            // 2. 단일 통합 그리드(#portalHomarrGrid) 내 모든 위젯 물리적 DOM 재배치 및 반폭/전폭 통일
            sortedWidgets.forEach(w => {
                const el = resolveWidgetElement(w);
                if (!el) return;

                if (homarrGrid) {
                    moveNodeBefore(homarrGrid, el, null);
                }

                const span = [1, 2].includes(Number(w.colSpan))
                    ? Number(w.colSpan)
                    : (DEFAULT_FULL_WIDTH_IDS.has(w.id) ? 2 : 1);

                el.style.gridColumn = span === 2 ? '1 / -1' : 'span 1';
                el.dataset.colSpan = String(span);
                el.dataset.widgetId = w.id;

                const isHidden = w.enabled === false || window.getComputedStyle(el).display === 'none';
                el.classList.add('bento-vt-card');
                el.style.viewTransitionName = isHidden ? '' : `bento-card-${toSafeVtToken(w.id)}`;
            });

            // 3. 상단 탭 메뉴(데스크톱 및 모바일) 순서 실시간 동기화
            syncNavTabsOrder(sortedWidgets);

            // 관리자인 경우 빠른 위젯 설정 바로가기 링크 유지
            if (isRoleAdmin) {
                renderAdminWidgetQuickLink();
            }

            if (typeof opts.afterUpdate === 'function') {
                opts.afterUpdate();
            }
        };

        if (opts.animate === true) {
            runWithViewTransition(applyDOM);
        } else {
            applyDOM();
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
                style="font-size:0.76rem; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; display:inline-flex; align-items:center; gap:5px; font-weight:700; min-height:28px; padding:4px 12px; border-radius:9999px; cursor:pointer; box-shadow:0 1px 3px rgba(37,99,235,0.08); transition:background-color 0.15s ease, border-color 0.15s ease;">
                <span aria-hidden="true">🎨</span><span>화면 편집</span>
            </button>
            <a href="/admin#tab-modules:subpane-modules-widgets" id="adminWidgetQuickConfigBtn" 
                title="관리자 센터 대시보드 위젯 설정으로 이동"
                style="font-size:0.75rem; color:#475569; text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight:600; min-height:28px; padding:4px 10px; border-radius:9999px; background:#f8fafc; border:1px solid #e2e8f0; transition:background-color 0.15s ease, border-color 0.15s ease;">
                <span aria-hidden="true">⚙️</span><span>설정</span>
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
    window.runBentoViewTransition = runWithViewTransition;
})();
