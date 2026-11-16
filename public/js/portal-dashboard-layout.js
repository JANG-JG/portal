/**
 * 🍱 JG 포털 메인 대시보드 동적 섹션·레이아웃 엔진 (portal-dashboard-layout.js)
 * - Home Assistant Sections View + Homarr 스타일 다중 섹션 Bento Grid 오케스트레이션
 * - SWR(Stale-While-Revalidate) 로컬 캐시로 페이지 새로고침 시 깜빡임 차단
 * - 기존 DOM ID, 이벤트 바인딩, 실시간 차트/소켓 로직 100% 무결성 보존 ([규칙 3], [규칙 5])
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    const CACHE_KEY = 'jg_dashboard_config_cache';
    const COLLAPSE_KEY = 'jg_dashboard_collapsed_sections';
    const VALID_SPAN_MODES = ['third', 'half', 'wide', 'full'];

    const DEFAULT_SECTIONS = [
        { id: 'today', title: '오늘의 요약 · 빠른 실행', icon: '🌅', order: 10 },
        { id: 'life', title: '우리 가족 생활 · 기록', icon: '🏡', order: 20 },
        { id: 'info', title: '자산 · 뉴스 · 서버 관리', icon: '📊', order: 30 }
    ];

    const DEFAULT_SECTION_BY_WIDGET = {
        smartDailyBriefingCard: 'today', homarrHeroCard: 'today', 'cmd-strip': 'today',
        portalStudyBuddyStrip: 'today', breakingBannerBar: 'today',
        'bento-wiki': 'life', 'card-dday': 'life', 'bento-calendar': 'life', 'bento-album': 'life',
        'bento-asset': 'info', 'bento-news': 'info', 'bento-ops': 'info'
    };

    const DEFAULT_FULL_WIDTH_IDS = new Set([
        'smartDailyBriefingCard', 'homarrHeroCard', 'cmd-strip', 'portalStudyBuddyStrip', 'breakingBannerBar', 'bento-ops'
    ]);

    const supportsMoveBefore = typeof Element !== 'undefined' && Object.hasOwn(Element.prototype, 'moveBefore');

    function getCollapsedMap() {
        try {
            const raw = localStorage.getItem(COLLAPSE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveCollapsedState(sectionId, isCollapsed) {
        if (!sectionId) return;
        try {
            const map = getCollapsedMap();
            if (isCollapsed) map[sectionId] = true;
            else delete map[sectionId];
            localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map));
        } catch (e) {}
    }

    function normalizeSpanMode(w) {
        if (w && VALID_SPAN_MODES.includes(w.spanMode)) return w.spanMode;
        if (w && Number(w.colSpan) === 2) return 'full';
        if (w && Number(w.colSpan) === 1) return 'half';
        return w && DEFAULT_FULL_WIDTH_IDS.has(w.id) ? 'full' : 'half';
    }

    function getTabKeyFromWidget(w) {
        if (!w || !w.id) return null;
        if (w.tabKey) return w.tabKey;
        if (w.id === 'homarrHeroCard' || w.id === 'bento-blood') return 'blood';
        if (w.id.startsWith('bento-')) return w.id.replace('bento-', '');
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

    function normalizeSectionsList(sectionsInput) {
        const base = Array.isArray(sectionsInput) && sectionsInput.length > 0
            ? sectionsInput
            : DEFAULT_SECTIONS;
        return [...base]
            .filter(s => s && s.id)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((s, idx) => ({
                id: String(s.id),
                title: String(s.title || '섹션'),
                icon: String(s.icon || '📁'),
                order: Number(s.order || (idx + 1) * 10)
            }));
    }

    function ensureSectionsStack(root, homarrGrid) {
        let stack = document.getElementById('portalSectionsStack');
        if (!stack && root) {
            stack = document.createElement('div');
            stack.id = 'portalSectionsStack';
            stack.className = 'bento-sections-stack';
            if (homarrGrid && homarrGrid.parentElement === root) {
                root.insertBefore(stack, homarrGrid);
            } else {
                root.appendChild(stack);
            }
        }
        return stack;
    }

    function ensureSectionNode(stack, sec, collapsedMap) {
        let sectionEl = stack.querySelector(`:scope > .bento-section[data-section-id="${CSS.escape(sec.id)}"]`);
        if (!sectionEl) {
            sectionEl = document.createElement('div');
            sectionEl.className = 'bento-section';
            sectionEl.dataset.sectionId = sec.id;
            sectionEl.innerHTML = `
                <details class="bento-section-details"${collapsedMap[sec.id] ? '' : ' open'}>
                    <summary class="bento-section-summary">
                        <span class="bento-section-heading-group">
                            <span class="bento-section-icon" aria-hidden="true"></span>
                            <span class="bento-section-title"></span>
                            <span class="bento-section-count"></span>
                        </span>
                        <span class="bento-section-controls"></span>
                    </summary>
                    <div class="homarr-grid bento-section-grid" data-section-id="${String(sec.id).replace(/"/g, '&quot;')}">
                        <div class="bento-section-empty-hint">이 섹션으로 카드를 드래그해 배치하세요</div>
                    </div>
                </details>`;
            sectionEl.querySelector('.bento-section-controls').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            const details = sectionEl.querySelector('.bento-section-details');
            details.addEventListener('toggle', () => saveCollapsedState(sec.id, !details.open));
            stack.appendChild(sectionEl);
        }
        sectionEl.querySelector('.bento-section-icon').textContent = sec.icon || '📁';
        sectionEl.querySelector('.bento-section-title').textContent = sec.title || sec.id;
        return sectionEl;
    }

    /**
     * 섹션 순서 + 위젯 순서에 맞춰 상단 탭 메뉴(데스크톱 및 모바일) 버튼 순서 동기화
     */
    function syncNavTabsOrder(orderedWidgets) {
        if (!Array.isArray(orderedWidgets) || orderedWidgets.length === 0) return;

        const navContainers = [
            { el: document.getElementById('portal-tab-nav'), scope: 'desk' },
            { el: document.querySelector('.cmd-nav-mobile-strip'), scope: 'mob' }
        ].filter(item => Boolean(item.el));

        if (navContainers.length === 0) return;

        const orderedTabKeys = [];
        orderedWidgets.forEach(w => {
            if (w.enabled === false) return;
            const tabKey = getTabKeyFromWidget(w);
            if (tabKey && !orderedTabKeys.includes(tabKey)) {
                orderedTabKeys.push(tabKey);
            }
        });

        navContainers.forEach(({ el: container, scope }) => {
            const btns = Array.from(container.querySelectorAll('.portal-tab-btn'));
            if (btns.length === 0) return;

            const setTabVt = (btn, tabKey) => {
                btn.classList.add('bento-vt-tab');
                btn.style.viewTransitionName = btn.style.display === 'none'
                    ? ''
                    : `bento-nav-${scope}-${toSafeVtToken(tabKey)}`;
            };

            const homeBtn = btns.find(b => b.getAttribute('data-tab') === 'home');
            if (homeBtn) {
                setTabVt(homeBtn, 'home');
                moveNodeBefore(container, homeBtn, null);
            }

            orderedTabKeys.forEach(tabKey => {
                const btn = btns.find(b => b.getAttribute('data-tab') === tabKey);
                if (btn) {
                    setTabVt(btn, tabKey);
                    moveNodeBefore(container, btn, null);
                }
            });

            btns.forEach(btn => {
                const tabKey = btn.getAttribute('data-tab');
                if (tabKey !== 'home' && !orderedTabKeys.includes(tabKey)) {
                    setTabVt(btn, tabKey);
                    moveNodeBefore(container, btn, null);
                }
            });
        });
    }

    function refreshSectionCountsAndVisibility(stack, isEditing) {
        if (!stack) return;
        stack.querySelectorAll(':scope > .bento-section').forEach(sectionEl => {
            const grid = sectionEl.querySelector('.bento-section-grid');
            const countEl = sectionEl.querySelector('.bento-section-count');
            if (!grid) return;

            const activeCards = Array.from(grid.children).filter(child =>
                !child.classList.contains('bento-section-empty-hint') &&
                child.dataset.dashboardHidden !== '1' &&
                !child.getAttribute('data-hidden-by-auth')
            );
            const visibleCards = activeCards.filter(child =>
                window.getComputedStyle(child).display !== 'none'
            );

            const count = isEditing ? activeCards.length : visibleCards.length;
            if (countEl) countEl.textContent = `${count}개`;

            const isEmpty = count === 0;
            sectionEl.classList.toggle('is-empty-section', isEmpty);
            sectionEl.style.display = (isEmpty && !isEditing) ? 'none' : '';
        });
    }

    /**
     * DOM에 섹션 + 위젯 레이아웃 적용
     */
    function applyWidgetsConfig(widgets, options, sectionsInput) {
        if (!Array.isArray(widgets) || widgets.length === 0) return;

        const opts = options && typeof options === 'object' ? options : {};
        const sections = normalizeSectionsList(sectionsInput || opts.sections);

        const applyDOM = () => {
            const isRoleAdmin = document.documentElement.classList.contains('role-admin');
            const isHideBlood = document.documentElement.classList.contains('hide-blood');
            const isHideOps = document.documentElement.classList.contains('hide-ops');
            const isHideAsset = document.documentElement.classList.contains('hide-asset');
            const isEditing = document.documentElement.classList.contains('bento-editing-active');

            const root = document.getElementById('portal-bento-root');
            const homarrGrid = document.getElementById('portalHomarrGrid');
            const stack = ensureSectionsStack(root, homarrGrid);
            const collapsedMap = getCollapsedMap();

            // 1. 섹션 노드 생성·정렬 및 불필요 섹션 제거
            const sectionGridMap = new Map();
            const activeSectionIds = new Set(sections.map(s => s.id));
            if (stack) {
                Array.from(stack.querySelectorAll(':scope > .bento-section')).forEach(existing => {
                    if (!activeSectionIds.has(existing.dataset.sectionId)) {
                        existing.remove();
                    }
                });
                sections.forEach(sec => {
                    const secNode = ensureSectionNode(stack, sec, collapsedMap);
                    moveNodeBefore(stack, secNode, null);
                    const secGrid = secNode.querySelector('.bento-section-grid');
                    if (secGrid) sectionGridMap.set(sec.id, secGrid);
                });
            }

            const defaultSectionId = sections[0] ? sections[0].id : 'today';
            const sortedWidgets = [...widgets].sort((a, b) => (a.order || 0) - (b.order || 0));

            // 2. 개별 위젯 노출 상태 및 권한 가드 적용
            sortedWidgets.forEach(w => {
                const el = resolveWidgetElement(w);
                if (!el) return;

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

            // 3. 각 위젯을 소속 섹션 그리드로 이동 & 4단계 크기(spanMode) 적용
            const sectionBuckets = new Map();
            sections.forEach(sec => sectionBuckets.set(sec.id, []));

            sortedWidgets.forEach(w => {
                const el = resolveWidgetElement(w);
                if (!el) return;

                const targetSecId = activeSectionIds.has(w.sectionId)
                    ? w.sectionId
                    : (activeSectionIds.has(DEFAULT_SECTION_BY_WIDGET[w.id]) ? DEFAULT_SECTION_BY_WIDGET[w.id] : defaultSectionId);

                const targetGrid = sectionGridMap.get(targetSecId) || homarrGrid;
                if (targetGrid) {
                    const emptyHint = targetGrid.querySelector(':scope > .bento-section-empty-hint');
                    moveNodeBefore(targetGrid, el, emptyHint || null);
                }
                if (sectionBuckets.has(targetSecId)) {
                    sectionBuckets.get(targetSecId).push(w);
                }

                const spanMode = normalizeSpanMode(w);
                el.style.gridColumn = '';
                el.dataset.spanMode = spanMode;
                el.dataset.colSpan = spanMode === 'full' ? '2' : '1';
                el.dataset.sectionId = targetSecId;
                el.dataset.widgetId = w.id;

                const isHidden = w.enabled === false || window.getComputedStyle(el).display === 'none';
                el.classList.add('bento-vt-card');
                el.style.viewTransitionName = isHidden ? '' : `bento-card-${toSafeVtToken(w.id)}`;
            });

            refreshSectionCountsAndVisibility(stack, isEditing);

            // 4. 화면에 배치된 섹션 순서 -> 위젯 순서 기준으로 상단 탭 동기화
            const flattenedOrdered = [];
            sections.forEach(sec => {
                const list = sectionBuckets.get(sec.id) || [];
                list.forEach(w => flattenedOrdered.push(w));
            });
            syncNavTabsOrder(flattenedOrdered.length > 0 ? flattenedOrdered : sortedWidgets);

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

    function readCachedBundle() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) return null;
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) {
                return { widgets: parsed, sections: DEFAULT_SECTIONS };
            }
            if (parsed && Array.isArray(parsed.widgets)) {
                return {
                    widgets: parsed.widgets,
                    sections: Array.isArray(parsed.sections) ? parsed.sections : DEFAULT_SECTIONS
                };
            }
        } catch (e) {}
        return null;
    }

    /**
     * 서버 설정 조회 및 캐시 갱신 (SWR 패턴)
     */
    async function loadAndApplyDashboardConfig() {
        const cached = readCachedBundle();
        if (cached && cached.widgets.length > 0) {
            applyWidgetsConfig(cached.widgets, null, cached.sections);
        }

        try {
            const res = await fetch('/api/modules/dashboard/config');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && Array.isArray(data.widgets)) {
                const sections = Array.isArray(data.sections) && data.sections.length > 0
                    ? data.sections
                    : DEFAULT_SECTIONS;
                applyWidgetsConfig(data.widgets, null, sections);
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ sections, widgets: data.widgets }));
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
                title="메인 화면에서 섹션과 카드를 직접 배치하고 조절합니다"
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

    window.applyDashboardWidgetsToDOM = applyWidgetsConfig;
    window.refreshDashboardLayout = loadAndApplyDashboardConfig;
    window.runBentoViewTransition = runWithViewTransition;
    window.getDashboardDefaultSections = () => DEFAULT_SECTIONS.map(s => ({ ...s }));
    window.refreshBentoSectionStates = () => {
        const stack = document.getElementById('portalSectionsStack');
        const isEditing = document.documentElement.classList.contains('bento-editing-active');
        refreshSectionCountsAndVisibility(stack, isEditing);
    };
})();
