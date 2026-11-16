/**
 * 🎨 JG 포털 라이브 대시보드 비주얼 화면 구성기 (portal-dashboard-editor.js)
 * - 관리자 페이지에 들어갈 필요 없이 메인 화면에서 실시간으로 위젯 순서, 너비, 노출 여부를 직접 조절
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    let isEditMode = false;
    let originalConfig = [];
    let workingWidgets = [];

    /**
     * 편집 모드 토글 (진입/종료)
     */
    window.toggleDashboardEditMode = async function(forceState) {
        const nextState = typeof forceState === 'boolean' ? forceState : !isEditMode;
        if (nextState === isEditMode) return;

        if (nextState) {
            await enterDashboardEditMode();
        } else {
            exitDashboardEditMode();
        }
    };

    /**
     * 편집 모드 진입
     */
    async function enterDashboardEditMode() {
        isEditMode = true;
        document.documentElement.classList.add('bento-editing-active');

        // 최신 위젯 설정 불러오기
        try {
            const res = await fetch('/api/modules/dashboard/config');
            const data = await res.json();
            if (data.success && Array.isArray(data.widgets)) {
                originalConfig = JSON.parse(JSON.stringify(data.widgets));
                workingWidgets = JSON.parse(JSON.stringify(data.widgets));
            }
        } catch (e) {
            workingWidgets = [];
        }

        renderFloatingToolbar();
        injectCardEditOverlays();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * 편집 모드 종료 (취소 또는 저장 후)
     */
    function exitDashboardEditMode() {
        isEditMode = false;
        document.documentElement.classList.remove('bento-editing-active', 'bento-dnd-dragging');

        const tb = document.getElementById('dashboardLiveEditorToolbar');
        if (tb) tb.remove();

        document.querySelectorAll('.bento-edit-overlay').forEach(el => el.remove());
        document.querySelectorAll('.bento-card-editing').forEach(el => {
            el.classList.remove('bento-card-editing', 'is-dnd-source');
            el.removeAttribute('data-drop-pos');
            el.style.border = '';
            el.style.position = '';
            el.style.transform = '';
        });
    }

    function announceEditorStatus(msg) {
        const statusEl = document.getElementById('liveEditorAriaStatus');
        if (statusEl) statusEl.textContent = msg;
    }

    function bindToolbarKeyboardFallback(toolbar) {
        if (!toolbar || ('focusGroup' in HTMLElement.prototype)) return;
        const items = Array.from(toolbar.querySelectorAll(':scope > button, :scope > .jg-dock-group > button'));
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

    /**
     * 상단 고정 플로팅 편집 툴바 생성
     */
    function renderFloatingToolbar() {
        if (document.getElementById('dashboardLiveEditorToolbar')) return;

        const tb = document.createElement('div');
        tb.id = 'dashboardLiveEditorToolbar';

        updateToolbarContent(tb);
        document.body.prepend(tb);
    }

    /**
     * 툴바 내용 갱신 (숨긴 위젯 카운트 등)
     */
    function updateToolbarContent(tbElement) {
        const tb = tbElement || document.getElementById('dashboardLiveEditorToolbar');
        if (!tb) return;

        const hiddenWidgets = workingWidgets.filter(w => w.enabled === false);

        tb.innerHTML = `
            <div class="jg-editor-dock-info">
                <div class="jg-editor-dock-badge" aria-hidden="true">🎨</div>
                <div style="min-width:0;">
                    <div class="jg-editor-dock-title">대시보드 화면 편집</div>
                    <div class="jg-editor-dock-sub">⋮⋮ 드래그하거나 칩으로 순서·반폭/전폭·노출을 조절하세요</div>
                </div>
            </div>

            <div class="jg-editor-dock-actions" role="toolbar" focusgroup="toolbar wrap" aria-label="대시보드 화면 편집 도구 모음">
                <div class="jg-dock-group" role="group" aria-label="위젯 관리" style="position:relative;">
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
                        title="위젯 순서와 크기를 기본 구성으로 초기화합니다"
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

        const toolbarEl = tb.querySelector('[role="toolbar"]');
        bindToolbarKeyboardFallback(toolbarEl);
    }

    /**
     * 각 Bento 카드에 라이브 편집 컨트롤 오버레이 부착 (전 카드 반폭/전폭 + 드래그 핸들 지원)
     */
    function injectCardEditOverlays() {
        workingWidgets.forEach(w => {
            if (w.enabled === false) return;
            const el = document.querySelector(w.selector) || document.getElementById(w.id);
            if (!el) return;

            el.classList.add('bento-card-editing');
            el.style.border = '2px dashed #3b82f6';
            el.style.position = 'relative';

            // 기존 오버레이 제거 후 재부착
            const oldOverlay = el.querySelector('.bento-edit-overlay');
            if (oldOverlay) oldOverlay.remove();

            const isFull = w.colSpan === 2;

            const overlay = document.createElement('div');
            overlay.className = 'bento-edit-overlay';

            overlay.innerHTML = `
                <button type="button" class="jg-overlay-chip jg-drag-handle" data-widget-id="${w.id}" onclick="event.stopPropagation();" title="드래그하여 카드 순서 이동" aria-label="${w.title} 드래그하여 순서 이동">
                    <span aria-hidden="true">⋮⋮</span>
                </button>
                <button type="button" class="jg-overlay-chip" onclick="event.stopPropagation(); moveWidgetOrder('${w.id}', 'up')" title="순서 위로 / 앞으로" aria-label="${w.title} 위로 이동">
                    <span aria-hidden="true">▲</span>
                </button>
                <button type="button" class="jg-overlay-chip" onclick="event.stopPropagation(); moveWidgetOrder('${w.id}', 'down')" title="순서 아래로 / 뒤로" aria-label="${w.title} 아래로 이동">
                    <span aria-hidden="true">▼</span>
                </button>
                <button type="button" class="jg-overlay-chip ${isFull ? 'is-active' : ''}" aria-pressed="${isFull}" onclick="event.stopPropagation(); toggleWidgetWidth('${w.id}')" title="카드 너비 전환 (반폭 ↔ 전폭)">
                    ${isFull ? '↔️ 전폭' : '▫️ 반폭'}
                </button>
                <button type="button" class="jg-overlay-chip is-danger" onclick="event.stopPropagation(); hideWidget('${w.id}')" title="이 위젯 숨기기" aria-label="${w.title} 숨기기">
                    <span aria-hidden="true">✕</span>
                </button>
            `;

            el.appendChild(overlay);
        });
    }

    function isWidgetVisibleInDOM(w) {
        if (!w || w.enabled === false) return false;
        const el = (w.selector && document.querySelector(w.selector)) || document.getElementById(w.id);
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
    }

    function commitWorkingLayout(options) {
        const opts = options || {};
        workingWidgets.forEach((w, i) => {
            w.order = (i + 1) * 10;
        });

        const finalizeOverlays = () => {
            if (opts.refreshToolbar) updateToolbarContent();
            injectCardEditOverlays();
            if (opts.focusWidgetId && opts.focusSelector) {
                const el = document.querySelector(`[data-widget-id="${opts.focusWidgetId}"]`) || document.getElementById(opts.focusWidgetId);
                const btn = el && el.querySelector(opts.focusSelector);
                if (btn) btn.focus({ preventScroll: true });
            }
        };

        if (typeof window.applyDashboardWidgetsToDOM === 'function') {
            window.applyDashboardWidgetsToDOM(workingWidgets, {
                animate: opts.animate !== false,
                afterUpdate: finalizeOverlays
            });
        } else {
            finalizeOverlays();
        }
    }

    /**
     * 위젯 순서 이동 (▲/▼)
     */
    window.moveWidgetOrder = function(widgetId, direction) {
        const visibleWidgets = workingWidgets.filter(isWidgetVisibleInDOM);
        const targetPool = visibleWidgets.some(w => w.id === widgetId)
            ? visibleWidgets
            : workingWidgets.filter(w => w.enabled !== false);
        const activeIdx = targetPool.findIndex(w => w.id === widgetId);
        if (activeIdx === -1) return;

        let movedWidget = null;
        if (direction === 'up' && activeIdx > 0) {
            movedWidget = targetPool[activeIdx];
            const prevWidget = targetPool[activeIdx - 1];
            const origIdx = workingWidgets.indexOf(movedWidget);
            const prevOrigIdx = workingWidgets.indexOf(prevWidget);
            workingWidgets[origIdx] = prevWidget;
            workingWidgets[prevOrigIdx] = movedWidget;
        } else if (direction === 'down' && activeIdx < targetPool.length - 1) {
            movedWidget = targetPool[activeIdx];
            const nextWidget = targetPool[activeIdx + 1];
            const origIdx = workingWidgets.indexOf(movedWidget);
            const nextOrigIdx = workingWidgets.indexOf(nextWidget);
            workingWidgets[origIdx] = nextWidget;
            workingWidgets[nextOrigIdx] = movedWidget;
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
        announceEditorStatus(`${movedWidget.title || movedWidget.id} 카드가 ${direction === 'up' ? '위로' : '아래로'} 이동되었습니다.`);
    };

    /**
     * 드래그 앤 드롭 결과 기반 특정 위젯 앞/뒤 배치
     */
    window.reorderDashboardWidgetTo = function(sourceId, targetId, position) {
        if (!sourceId || !targetId || sourceId === targetId) return false;
        const sourceIdx = workingWidgets.findIndex(w => w.id === sourceId);
        const targetIdx = workingWidgets.findIndex(w => w.id === targetId);
        if (sourceIdx === -1 || targetIdx === -1) return false;

        const [moved] = workingWidgets.splice(sourceIdx, 1);
        const newTargetIdx = workingWidgets.findIndex(w => w.id === targetId);
        const insertIdx = position === 'after' ? newTargetIdx + 1 : newTargetIdx;
        workingWidgets.splice(insertIdx, 0, moved);

        commitWorkingLayout({ animate: true });
        announceEditorStatus(`${moved.title || moved.id} 카드 위치가 변경되었습니다.`);
        return true;
    };

    /**
     * 위젯 너비 토글 (1열 반폭 ↔ 2열 전폭, 전 카드 공통 지원)
     */
    window.toggleWidgetWidth = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        item.colSpan = (item.colSpan === 2) ? 1 : 2;
        commitWorkingLayout({
            animate: true,
            focusWidgetId: widgetId,
            focusSelector: '.bento-edit-overlay button[onclick*="toggleWidgetWidth"]'
        });
        announceEditorStatus(`${item.title || item.id} 너비가 ${item.colSpan === 2 ? '전폭' : '반폭'}으로 전환되었습니다.`);
    };

    /**
     * 위젯 숨기기 (화면에서 감춤)
     */
    window.hideWidget = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        item.enabled = false;
        commitWorkingLayout({ animate: true, refreshToolbar: true });
        announceEditorStatus(`${item.title || item.id} 위젯이 숨겨졌습니다.`);
    };

    /**
     * 숨겨진 위젯 복원 (다시 켜기)
     */
    window.restoreWidget = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        item.enabled = true;
        const drop = document.getElementById('hiddenWidgetsDropdown');
        if (drop) drop.style.display = 'none';

        commitWorkingLayout({ animate: true, refreshToolbar: true });

        setTimeout(() => {
            const restoredEl = document.querySelector(item.selector) || document.getElementById(item.id);
            if (restoredEl) {
                restoredEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 60);

        announceEditorStatus(`${item.title || item.id} 위젯이 복원되었습니다.`);
    };

    /**
     * 기본 위젯 배치로 초기화 (서버 기본값 복원 + 즉시 동기화)
     */
    window.resetDashboardEditLayout = async function() {
        if (!confirm('대시보드 카드 순서와 반폭/전폭 구성을 기본값으로 초기화하시겠습니까?')) {
            return;
        }
        try {
            const res = await fetch('/api/modules/dashboard/reset', { method: 'POST' });
            const data = await res.json();
            if (data.success && Array.isArray(data.widgets)) {
                originalConfig = JSON.parse(JSON.stringify(data.widgets));
                workingWidgets = JSON.parse(JSON.stringify(data.widgets));
                try {
                    localStorage.setItem('jg_dashboard_config_cache', JSON.stringify(data.widgets));
                } catch (e) {}

                commitWorkingLayout({ animate: true, refreshToolbar: true });
                announceEditorStatus('대시보드 배치가 기본값으로 복원되었습니다.');
                if (typeof showToast === 'function') {
                    showToast('↺ 대시보드 기본 배치로 초기화되었습니다.');
                }
            } else {
                alert(data.message || '초기화 실패');
            }
        } catch (e) {
            alert('초기화 중 통신 오류가 발생했습니다.');
        }
    };

    /**
     * 숨긴 위젯 드롭다운 토글
     */
    window.toggleHiddenWidgetsDropdown = function(e) {
        e.stopPropagation();
        const drop = document.getElementById('hiddenWidgetsDropdown');
        const toggleBtn = document.getElementById('btnHiddenWidgetsToggle');
        if (!drop) return;
        const willOpen = drop.style.display !== 'block';
        drop.style.display = willOpen ? 'block' : 'none';
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(willOpen));
    };

    // 문서 클릭 시 드롭다운 닫기
    document.addEventListener('click', () => {
        const drop = document.getElementById('hiddenWidgetsDropdown');
        const toggleBtn = document.getElementById('btnHiddenWidgetsToggle');
        if (drop) drop.style.display = 'none';
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    });

    /**
     * 편집 취소 (원상 복구)
     */
    window.cancelDashboardEdit = function() {
        if (!confirm('화면 편집을 취소하시겠습니까? 변경된 내용은 저장되지 않습니다.')) {
            return;
        }
        exitDashboardEditMode();
        if (typeof window.refreshDashboardLayout === 'function') {
            window.refreshDashboardLayout();
        }
    };

    /**
     * 실시간 대시보드 레이아웃 서버 저장
     */
    window.saveLiveDashboardLayout = async function() {
        try {
            const res = await fetch('/api/modules/dashboard/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: workingWidgets })
            });
            const data = await res.json();

            if (data.success) {
                // 로컬 캐시 즉시 업데이트 (새로고침 깜빡임 원천 차단)
                try {
                    localStorage.setItem('jg_dashboard_config_cache', JSON.stringify(data.widgets || workingWidgets));
                } catch (e) {}

                exitDashboardEditMode();
                if (typeof showToast === 'function') {
                    showToast('🎉 대시보드 화면 구성이 저장되었습니다!');
                } else {
                    alert('대시보드 화면 구성이 성공적으로 저장되었습니다!');
                }
            } else {
                alert(data.message || '저장 실패');
            }
        } catch (e) {
            alert('저장 중 통신 오류가 발생했습니다.');
        }
    };

    // URL 파라미터(?edit_mode=1)가 있으면 자동 진입
    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('edit_mode') === '1' && document.documentElement.classList.contains('role-admin')) {
            setTimeout(() => {
                toggleDashboardEditMode(true);
            }, 300);
        }
    });
})();
