/**
 * 🎨 JG 포털 라이브 대시보드 비주얼 화면 구성기 (portal-dashboard-editor.js)
 * - Home Assistant Sections View + Homarr 스타일 실시간 섹션 · 카드 · 크기(1/3·1/2·2/3·전폭) 편집기
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    const SPAN_CYCLE = ['third', 'half', 'wide', 'full'];
    const SPAN_META = {
        third: { label: '◧ 1/3', name: '1/3 폭' },
        half:  { label: '▫️ 1/2', name: '반폭(1/2)' },
        wide:  { label: '◨ 2/3', name: '2/3 폭' },
        full:  { label: '↔️ 전폭', name: '전폭(전체)' }
    };

    let isEditMode = false;
    let workingWidgets = [];
    let workingSections = [];

    function getSpanMode(w) {
        if (w && SPAN_CYCLE.includes(w.spanMode)) return w.spanMode;
        return Number(w && w.colSpan) === 2 ? 'full' : 'half';
    }

    function getFallbackSections() {
        return typeof window.getDashboardDefaultSections === 'function'
            ? window.getDashboardDefaultSections()
            : [
                { id: 'today', title: '오늘의 요약 · 빠른 실행', icon: '🌅', order: 10 },
                { id: 'life', title: '우리 가족 생활 · 기록', icon: '🏡', order: 20 },
                { id: 'info', title: '자산 · 뉴스 · 서버 관리', icon: '📊', order: 30 }
            ];
    }

    /**
     * 편집 모드 토글 (진입/종료)
     */
    window.toggleDashboardEditMode = async function(forceState) {
        const nextState = typeof forceState === 'boolean' ? forceState : !isEditMode;
        if (nextState === isEditMode) return;
        if (nextState) await enterDashboardEditMode();
        else exitDashboardEditMode();
    };

    async function enterDashboardEditMode() {
        isEditMode = true;
        document.documentElement.classList.add('bento-editing-active');

        try {
            const res = await fetch('/api/modules/dashboard/config');
            const data = await res.json();
            if (data.success && Array.isArray(data.widgets)) {
                workingWidgets = JSON.parse(JSON.stringify(data.widgets));
                workingSections = Array.isArray(data.sections) && data.sections.length > 0
                    ? JSON.parse(JSON.stringify(data.sections))
                    : getFallbackSections();
            }
        } catch (e) {
            workingWidgets = [];
            workingSections = getFallbackSections();
        }

        renderFloatingToolbar();
        commitWorkingLayout({ animate: false, refreshToolbar: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function exitDashboardEditMode() {
        isEditMode = false;
        document.documentElement.classList.remove('bento-editing-active', 'bento-dnd-dragging');

        const tb = document.getElementById('dashboardLiveEditorToolbar');
        if (tb) tb.remove();

        if (typeof window.cleanupSectionEditUI === 'function') {
            window.cleanupSectionEditUI();
        }

        document.querySelectorAll('.bento-section[data-section-drop]').forEach(el => {
            el.removeAttribute('data-section-drop');
        });
        document.querySelectorAll('.bento-edit-overlay').forEach(el => el.remove());
        document.querySelectorAll('.bento-card-editing').forEach(el => {
            el.classList.remove('bento-card-editing', 'is-dnd-source');
            el.removeAttribute('data-drop-pos');
            el.removeAttribute('data-drop-axis');
            el.style.border = '';
            el.style.position = '';
            el.style.transform = '';
        });

        if (typeof window.refreshBentoSectionStates === 'function') {
            window.refreshBentoSectionStates();
        }
    }

    function announceEditorStatus(msg) {
        const statusEl = document.getElementById('liveEditorAriaStatus');
        if (statusEl) statusEl.textContent = msg;
    }

    function bindToolbarKeyboardFallback(toolbar) {
        if (!toolbar || ('focusGroup' in HTMLElement.prototype)) return;
        const items = Array.from(toolbar.querySelectorAll('button'));
        if (items.length === 0) return;
        items.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
        toolbar.addEventListener('focusin', (e) => {
            if (items.includes(e.target)) {
                items.forEach(b => { b.tabIndex = (b === e.target) ? 0 : -1; });
            }
        });
        toolbar.addEventListener('keydown', (e) => {
            const rtl = getComputedStyle(toolbar).direction === 'rtl';
            const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : (e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0);
            const cur = items.indexOf(document.activeElement);
            if (cur === -1) return;
            let next = -1;
            if (step !== 0) next = (cur + step + items.length) % items.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = items.length - 1;
            if (next !== -1) {
                e.preventDefault();
                items[next].focus();
            }
        });
    }

    function renderFloatingToolbar() {
        if (document.getElementById('dashboardLiveEditorToolbar')) return;
        const tb = document.createElement('div');
        tb.id = 'dashboardLiveEditorToolbar';
        updateToolbarContent(tb);
        document.body.prepend(tb);
    }

    function updateToolbarContent(tbElement) {
        const tb = tbElement || document.getElementById('dashboardLiveEditorToolbar');
        if (!tb) return;

        const hiddenWidgets = workingWidgets.filter(w => w.enabled === false);

        tb.innerHTML = `
            <div class="jg-editor-dock-info">
                <div class="jg-editor-dock-badge" aria-hidden="true">🎨</div>
                <div style="min-width:0;">
                    <div class="jg-editor-dock-title">대시보드 화면 편집</div>
                    <div class="jg-editor-dock-sub">⋮⋮ 드래그해 섹션·순서를 옮기고, 카드 너비(1/3·1/2·2/3·전폭)를 조절하세요</div>
                </div>
            </div>

            <div class="jg-editor-dock-actions" role="toolbar" focusgroup="toolbar wrap" aria-label="대시보드 화면 편집 도구 모음">
                <div class="jg-dock-group" role="group" aria-label="섹션 및 위젯 관리" style="position:relative;">
                    <button type="button" id="btnAddDashboardSection" class="jg-chip-btn jg-chip-slate"
                        title="새 대시보드 섹션 추가" onclick="openAddDashboardSection()">
                        <span aria-hidden="true">＋</span><span>섹션</span>
                    </button>
                    <button type="button" id="btnHiddenWidgetsToggle" class="jg-chip-btn jg-chip-slate"
                        aria-haspopup="menu" aria-expanded="false" aria-controls="hiddenWidgetsDropdown"
                        onclick="toggleHiddenWidgetsDropdown(event)">
                        <span aria-hidden="true">🧩</span>
                        <span>숨긴 위젯</span>
                        <span class="jg-chip-count">${hiddenWidgets.length}</span>
                    </button>
                    <div id="hiddenWidgetsDropdown" class="jg-hidden-dropdown">
                        ${hiddenWidgets.length === 0 ? '<div style="font-size:0.78rem; color:#64748b; padding:0.65rem; text-align:center;">숨겨진 위젯이 없습니다.</div>' : hiddenWidgets.map(hw => `
                            <button type="button" class="jg-hidden-restore-btn" onclick="restoreWidget('${hw.id}')">
                                <span>${hw.icon || '📦'} ${hw.title}</span>
                                <span class="jg-hidden-restore-pill">복원</span>
                            </button>
                        `).join('')}
                    </div>
                    <button type="button" id="btnResetDashboardLayout" class="jg-chip-btn jg-chip-slate"
                        title="섹션·위젯 순서와 크기를 기본 구성으로 초기화합니다"
                        onclick="resetDashboardEditLayout()">
                        <span aria-hidden="true">↺</span>
                        <span>초기화</span>
                    </button>
                </div>

                <span class="jg-dock-sep" role="separator" aria-orientation="vertical"></span>

                <div class="jg-dock-group" role="group" aria-label="편집 종료">
                    <button type="button" class="jg-chip-btn jg-chip-rose" onclick="cancelDashboardEdit()">
                        <span aria-hidden="true">✕</span><span>취소</span>
                    </button>
                    <button type="button" class="jg-chip-btn jg-chip-sky" onclick="saveLiveDashboardLayout()">
                        <span aria-hidden="true">💾</span><span>저장 완료</span>
                    </button>
                </div>
            </div>
            <p id="liveEditorAriaStatus" class="jg-sr-only" role="status"></p>
        `;

        bindToolbarKeyboardFallback(tb.querySelector('[role="toolbar"]'));
    }

    function injectCardEditOverlays() {
        workingWidgets.forEach(w => {
            if (w.enabled === false) return;
            const el = (w.selector && document.querySelector(w.selector)) || document.getElementById(w.id);
            if (!el) return;

            el.classList.add('bento-card-editing');
            el.style.border = '2px dashed #3b82f6';
            el.style.position = 'relative';

            const oldOverlay = el.querySelector('.bento-edit-overlay');
            if (oldOverlay) oldOverlay.remove();

            const spanMode = getSpanMode(w);
            const meta = SPAN_META[spanMode] || SPAN_META.half;

            const overlay = document.createElement('div');
            overlay.className = 'bento-edit-overlay';

            overlay.innerHTML = `
                <button type="button" class="jg-overlay-chip jg-drag-handle" data-widget-id="${w.id}"
                    onclick="event.stopPropagation();" title="드래그하여 섹션·순서 이동" aria-label="${w.title} 드래그하여 이동">
                    <span aria-hidden="true">⋮⋮</span>
                </button>
                <button type="button" class="jg-overlay-chip" onclick="event.stopPropagation(); moveWidgetOrder('${w.id}', 'up')"
                    title="앞 / 위 섹션으로 이동" aria-label="${w.title} 앞으로 이동">
                    <span aria-hidden="true">▲</span>
                </button>
                <button type="button" class="jg-overlay-chip" onclick="event.stopPropagation(); moveWidgetOrder('${w.id}', 'down')"
                    title="뒤 / 아래 섹션으로 이동" aria-label="${w.title} 뒤로 이동">
                    <span aria-hidden="true">▼</span>
                </button>
                <button type="button" class="jg-overlay-chip ${spanMode === 'full' ? 'is-active' : ''}"
                    onclick="event.stopPropagation(); toggleWidgetWidth('${w.id}')"
                    title="카드 너비 순환 (1/3 → 1/2 → 2/3 → 전폭)" aria-label="${w.title} 너비 현재 ${meta.name}, 클릭하여 변경">
                    ${meta.label}
                </button>
                <button type="button" class="jg-overlay-chip is-danger" onclick="event.stopPropagation(); hideWidget('${w.id}')"
                    title="이 위젯 숨기기" aria-label="${w.title} 숨기기">
                    <span aria-hidden="true">✕</span>
                </button>
            `;

            el.appendChild(overlay);
        });
    }

    function isWidgetVisibleInDOM(w) {
        if (!w || w.enabled === false) return false;
        const el = (w.selector && document.querySelector(w.selector)) || document.getElementById(w.id);
        return Boolean(el && window.getComputedStyle(el).display !== 'none');
    }

    function commitWorkingLayout(options) {
        const opts = options || {};
        workingSections.forEach((s, idx) => { s.order = (idx + 1) * 10; });

        const bySection = new Map();
        workingSections.forEach(s => bySection.set(s.id, []));
        const fallbackSecId = workingSections[0] ? workingSections[0].id : 'today';
        workingWidgets.forEach(w => {
            const secId = bySection.has(w.sectionId) ? w.sectionId : fallbackSecId;
            w.sectionId = secId;
            bySection.get(secId).push(w);
        });

        const normalizedList = [];
        workingSections.forEach(s => bySection.get(s.id).forEach(w => normalizedList.push(w)));
        workingWidgets = normalizedList;
        workingWidgets.forEach((w, i) => { w.order = (i + 1) * 10; });

        syncSectionEditorBridge();

        const finalizeOverlays = () => {
            if (opts.refreshToolbar) updateToolbarContent();
            if (typeof window.injectSectionEditControls === 'function') {
                window.injectSectionEditControls(workingSections);
            }
            injectCardEditOverlays();
            if (opts.focusWidgetId && opts.focusSelector) {
                const el = document.querySelector(`[data-widget-id="${opts.focusWidgetId}"]`) || document.getElementById(opts.focusWidgetId);
                const btn = el && el.querySelector(opts.focusSelector);
                if (btn) btn.focus({ preventScroll: true });
            }
        };

        if (typeof window.applyDashboardWidgetsToDOM === 'function') {
            window.applyDashboardWidgetsToDOM(workingWidgets, { animate: opts.animate !== false, afterUpdate: finalizeOverlays }, workingSections);
        } else {
            finalizeOverlays();
        }
    }

    /**
     * 위젯 순서 이동 (▲/▼ — 섹션 경계 도달 시 인접 섹션으로 자연스럽게 이동)
     */
    window.moveWidgetOrder = function(widgetId, direction) {
        const targetPool = workingWidgets.filter(isWidgetVisibleInDOM);
        const pool = targetPool.some(w => w.id === widgetId)
            ? targetPool
            : workingWidgets.filter(w => w.enabled !== false);
        const activeIdx = pool.findIndex(w => w.id === widgetId);
        if (activeIdx === -1) return;

        const movedWidget = pool[activeIdx];
        const neighborIdx = direction === 'up' ? activeIdx - 1 : activeIdx + 1;
        const secIdx = workingSections.findIndex(s => s.id === movedWidget.sectionId);

        if (neighborIdx >= 0 && neighborIdx < pool.length && pool[neighborIdx].sectionId === movedWidget.sectionId) {
            const swapWidget = pool[neighborIdx];
            const origA = workingWidgets.indexOf(movedWidget);
            const origB = workingWidgets.indexOf(swapWidget);
            workingWidgets[origA] = swapWidget;
            workingWidgets[origB] = movedWidget;
        } else if (direction === 'up' && secIdx > 0) {
            movedWidget.sectionId = workingSections[secIdx - 1].id;
            const orig = workingWidgets.indexOf(movedWidget);
            workingWidgets.splice(orig, 1);
            workingWidgets.push(movedWidget);
        } else if (direction === 'down' && secIdx >= 0 && secIdx < workingSections.length - 1) {
            movedWidget.sectionId = workingSections[secIdx + 1].id;
            const orig = workingWidgets.indexOf(movedWidget);
            workingWidgets.splice(orig, 1);
            workingWidgets.unshift(movedWidget);
        } else {
            return;
        }

        commitWorkingLayout({
            animate: true,
            focusWidgetId: widgetId,
            focusSelector: direction === 'up'
                ? '.bento-edit-overlay button[onclick*="\'up\'"]'
                : '.bento-edit-overlay button[onclick*="\'down\'"]'
        });
        announceEditorStatus(`${movedWidget.title || movedWidget.id} 카드가 이동되었습니다.`);
    };

    /**
     * 드래그 앤 드롭 결과 기반 특정 카드 앞/뒤 또는 빈 섹션으로 배치
     */
    window.reorderDashboardWidgetTo = function(sourceId, targetId, position, targetSectionId) {
        const sourceIdx = workingWidgets.findIndex(w => w.id === sourceId);
        if (sourceIdx === -1) return false;

        if (targetId && sourceId !== targetId) {
            const targetIdx = workingWidgets.findIndex(w => w.id === targetId);
            if (targetIdx === -1) return false;
            const [moved] = workingWidgets.splice(sourceIdx, 1);
            const targetWidget = workingWidgets.find(w => w.id === targetId);
            moved.sectionId = (targetWidget && targetWidget.sectionId) || targetSectionId || moved.sectionId;
            const newTargetIdx = workingWidgets.findIndex(w => w.id === targetId);
            const insertIdx = position === 'after' ? newTargetIdx + 1 : newTargetIdx;
            workingWidgets.splice(insertIdx, 0, moved);
            commitWorkingLayout({ animate: true });
            announceEditorStatus(`${moved.title || moved.id} 카드 위치가 변경되었습니다.`);
            return true;
        }

        if (targetSectionId && workingSections.some(s => s.id === targetSectionId)) {
            const [moved] = workingWidgets.splice(sourceIdx, 1);
            moved.sectionId = targetSectionId;
            workingWidgets.push(moved);
            commitWorkingLayout({ animate: true });
            announceEditorStatus(`${moved.title || moved.id} 카드가 섹션으로 이동되었습니다.`);
            return true;
        }

        return false;
    };

    /**
     * 위젯 너비 순환 전환 (1/3 → 1/2 → 2/3 → 전폭)
     */
    window.toggleWidgetWidth = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        const curMode = getSpanMode(item);
        const nextMode = SPAN_CYCLE[(SPAN_CYCLE.indexOf(curMode) + 1) % SPAN_CYCLE.length];
        item.spanMode = nextMode;
        item.colSpan = nextMode === 'full' ? 2 : 1;

        commitWorkingLayout({
            animate: true,
            focusWidgetId: widgetId,
            focusSelector: '.bento-edit-overlay button[onclick*="toggleWidgetWidth"]'
        });
        announceEditorStatus(`${item.title || item.id} 너비가 ${(SPAN_META[nextMode] || {}).name}로 변경되었습니다.`);
    };

    window.hideWidget = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;
        item.enabled = false;
        commitWorkingLayout({ animate: true, refreshToolbar: true });
        announceEditorStatus(`${item.title || item.id} 위젯이 숨겨졌습니다.`);
    };

    window.restoreWidget = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;
        item.enabled = true;
        const drop = document.getElementById('hiddenWidgetsDropdown');
        if (drop) drop.style.display = 'none';
        commitWorkingLayout({ animate: true, refreshToolbar: true });
        setTimeout(() => {
            const restoredEl = (item.selector && document.querySelector(item.selector)) || document.getElementById(item.id);
            if (restoredEl) restoredEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
        announceEditorStatus(`${item.title || item.id} 위젯이 복원되었습니다.`);
    };

    function syncSectionEditorBridge() {
        if (typeof window.bindDashboardSectionEditor === 'function') {
            window.bindDashboardSectionEditor({
                getSections: () => workingSections,
                getWidgets: () => workingWidgets,
                commit: commitWorkingLayout,
                announce: announceEditorStatus
            });
        }
    }

    window.resetDashboardEditLayout = async function() {
        if (!confirm('섹션과 카드 순서·크기를 기본 구성으로 초기화하시겠습니까?')) return;
        try {
            const res = await fetch('/api/modules/dashboard/reset', { method: 'POST' });
            const data = await res.json();
            if (data.success && Array.isArray(data.widgets)) {
                workingWidgets = JSON.parse(JSON.stringify(data.widgets));
                workingSections = Array.isArray(data.sections) && data.sections.length > 0
                    ? JSON.parse(JSON.stringify(data.sections))
                    : getFallbackSections();
                try {
                    localStorage.setItem('jg_dashboard_config_cache', JSON.stringify({ sections: workingSections, widgets: workingWidgets }));
                } catch (e) {}
                commitWorkingLayout({ animate: true, refreshToolbar: true });
                announceEditorStatus('대시보드 배치가 기본값으로 복원되었습니다.');
                if (typeof showToast === 'function') showToast('↺ 대시보드 기본 배치로 초기화되었습니다.');
            } else {
                alert(data.message || '초기화 실패');
            }
        } catch (e) {
            alert('초기화 중 통신 오류가 발생했습니다.');
        }
    };

    window.toggleHiddenWidgetsDropdown = function(e) {
        e.stopPropagation();
        const drop = document.getElementById('hiddenWidgetsDropdown');
        const toggleBtn = document.getElementById('btnHiddenWidgetsToggle');
        if (!drop) return;
        const willOpen = drop.style.display !== 'block';
        drop.style.display = willOpen ? 'block' : 'none';
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(willOpen));
    };

    document.addEventListener('click', () => {
        const drop = document.getElementById('hiddenWidgetsDropdown');
        const toggleBtn = document.getElementById('btnHiddenWidgetsToggle');
        if (drop) drop.style.display = 'none';
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    });

    window.cancelDashboardEdit = function() {
        if (!confirm('화면 편집을 취소하시겠습니까? 변경된 내용은 저장되지 않습니다.')) return;
        exitDashboardEditMode();
        if (typeof window.refreshDashboardLayout === 'function') window.refreshDashboardLayout();
    };

    window.saveLiveDashboardLayout = async function() {
        try {
            const res = await fetch('/api/modules/dashboard/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: workingWidgets, sections: workingSections })
            });
            const data = await res.json();
            if (data.success) {
                const savedWidgets = data.widgets || workingWidgets;
                const savedSections = data.sections || workingSections;
                try {
                    localStorage.setItem('jg_dashboard_config_cache', JSON.stringify({ sections: savedSections, widgets: savedWidgets }));
                } catch (e) {}
                exitDashboardEditMode();
                if (typeof showToast === 'function') showToast('🎉 대시보드 섹션·화면 구성이 저장되었습니다!');
                else alert('대시보드 화면 구성이 성공적으로 저장되었습니다!');
            } else {
                alert(data.message || '저장 실패');
            }
        } catch (e) {
            alert('저장 중 통신 오류가 발생했습니다.');
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('edit_mode') === '1' && document.documentElement.classList.contains('role-admin')) {
            setTimeout(() => toggleDashboardEditMode(true), 300);
        }
    });
})();
