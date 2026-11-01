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
        document.documentElement.classList.remove('bento-editing-active');

        // 툴바 제거
        const tb = document.getElementById('dashboardLiveEditorToolbar');
        if (tb) tb.remove();

        // 오버레이 및 임시 스타일 제거
        document.querySelectorAll('.bento-edit-overlay').forEach(el => el.remove());
        document.querySelectorAll('.bento-card-editing').forEach(el => {
            el.classList.remove('bento-card-editing');
            el.style.border = '';
            el.style.position = '';
        });
    }

    /**
     * 상단 고정 플로팅 편집 툴바 생성
     */
    function renderFloatingToolbar() {
        if (document.getElementById('dashboardLiveEditorToolbar')) return;

        const tb = document.createElement('div');
        tb.id = 'dashboardLiveEditorToolbar';
        tb.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 99999;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(12px);
            color: #fff;
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
            border-bottom: 2px solid #3b82f6;
            flex-wrap: wrap;
            gap: 0.5rem;
            animation: slideDown 0.2s ease-out;
        `;

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
            <div style="display:flex; align-items:center; gap:0.6rem;">
                <span style="font-size:1.1rem;">🎨</span>
                <div>
                    <div style="font-weight:700; font-size:0.92rem; color:#60a5fa;">실시간 대시보드 화면 구성 모드</div>
                    <div style="font-size:0.75rem; color:#94a3b8;">각 카드의 버튼으로 순서·너비·노출을 자유롭게 조절하세요.</div>
                </div>
            </div>

            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <div style="position:relative;">
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" 
                        onclick="toggleHiddenWidgetsDropdown(event)" 
                        style="color:#e2e8f0; border-color:#475569; background:#1e293b; padding:4px 10px; font-size:0.8rem;">
                        ➕ 숨긴 위젯 (${hiddenWidgets.length})
                    </button>
                    <div id="hiddenWidgetsDropdown" style="display:none; position:absolute; right:0; top:calc(100% + 6px); background:#1e293b; border:1px solid #475569; border-radius:0.5rem; padding:0.5rem; min-width:210px; box-shadow:0 10px 25px rgba(0,0,0,0.5); z-index:100000;">
                        ${hiddenWidgets.length === 0 ? '<div style="font-size:0.78rem; color:#94a3b8; padding:0.5rem; text-align:center;">숨겨진 위젯이 없습니다.</div>' : hiddenWidgets.map(hw => `
                            <button type="button" onclick="restoreWidget('${hw.id}')" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:0.45rem 0.6rem; border:none; background:transparent; color:#f8fafc; font-size:0.8rem; text-align:left; border-radius:4px; cursor:pointer; gap:6px;">
                                <span>${hw.icon || '📦'} ${hw.title}</span>
                                <span style="font-size:0.7rem; color:#38bdf8; background:rgba(56,189,248,0.15); padding:1px 5px; border-radius:3px;">복원</span>
                            </button>
                        `).join('')}
                    </div>
                </div>

                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="cancelDashboardEdit()" style="color:#cbd5e1; border-color:#475569; padding:4px 10px; font-size:0.8rem;">
                    ✕ 취소
                </button>
                <button type="button" class="btn-admin btn-admin-primary btn-admin-sm" onclick="saveLiveDashboardLayout()" style="background:#2563eb; color:#fff; font-weight:700; padding:4px 14px; font-size:0.82rem; box-shadow:0 2px 8px rgba(37,99,235,0.4);">
                    💾 화면 저장 완료
                </button>
            </div>
        `;
    }

    /**
     * 각 Bento 카드에 라이브 편집 컨트롤 오버레이 부착
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
            const isHomarrChild = el.parentElement && el.parentElement.id === 'portalHomarrGrid';

            const overlay = document.createElement('div');
            overlay.className = 'bento-edit-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 8px;
                right: 8px;
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 4px;
                background: rgba(15, 23, 42, 0.88);
                backdrop-filter: blur(8px);
                padding: 3px 6px;
                border-radius: 6px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.25);
            `;

            overlay.innerHTML = `
                <button type="button" onclick="event.stopPropagation(); moveWidgetOrder('${w.id}', 'up')" title="순서 위로 / 앞으로" 
                    style="background:#334155; color:#fff; border:none; border-radius:4px; padding:2px 7px; font-size:0.75rem; cursor:pointer;">
                    ▲
                </button>
                <button type="button" onclick="event.stopPropagation(); moveWidgetOrder('${w.id}', 'down')" title="순서 아래로 / 뒤로" 
                    style="background:#334155; color:#fff; border:none; border-radius:4px; padding:2px 7px; font-size:0.75rem; cursor:pointer;">
                    ▼
                </button>
                ${isHomarrChild ? `
                    <button type="button" onclick="event.stopPropagation(); toggleWidgetWidth('${w.id}')" title="카드 너비 전환 (반폭 ↔ 전폭)" 
                        style="background:${isFull ? '#2563eb' : '#334155'}; color:#fff; border:none; border-radius:4px; padding:2px 7px; font-size:0.75rem; cursor:pointer; font-weight:600;">
                        ${isFull ? '↔️ 전폭' : '▫️ 반폭'}
                    </button>
                ` : ''}
                <button type="button" onclick="event.stopPropagation(); hideWidget('${w.id}')" title="이 위젯 숨기기" 
                    style="background:#dc2626; color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:0.75rem; cursor:pointer;">
                    ✕
                </button>
            `;

            el.appendChild(overlay);
        });
    }

    /**
     * 위젯 순서 이동 (▲/▼)
     */
    window.moveWidgetOrder = function(widgetId, direction) {
        const activeWidgets = workingWidgets.filter(w => w.enabled !== false);
        const idx = activeWidgets.findIndex(w => w.id === widgetId);
        if (idx === -1) return;

        if (direction === 'up' && idx > 0) {
            const target = activeWidgets[idx];
            const prev = activeWidgets[idx - 1];
            const tempOrder = target.order;
            target.order = prev.order - 1;
        } else if (direction === 'down' && idx < activeWidgets.length - 1) {
            const target = activeWidgets[idx];
            const next = activeWidgets[idx + 1];
            target.order = next.order + 1;
        }

        // 전체 order 재정렬 및 실시간 DOM 스타일 동기화
        workingWidgets.sort((a, b) => (a.order || 0) - (b.order || 0));
        workingWidgets.forEach((w, i) => {
            w.order = (i + 1) * 10;
            const el = document.querySelector(w.selector) || document.getElementById(w.id);
            if (el) el.style.order = String(w.order);
        });

        injectCardEditOverlays();
    };

    /**
     * 위젯 너비 토글 (1열 반폭 ↔ 2열 전폭)
     */
    window.toggleWidgetWidth = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        item.colSpan = (item.colSpan === 2) ? 1 : 2;
        const el = document.querySelector(item.selector) || document.getElementById(item.id);
        if (el && el.parentElement && el.parentElement.id === 'portalHomarrGrid') {
            el.style.gridColumn = item.colSpan === 2 ? '1 / -1' : 'span 1';
        }

        injectCardEditOverlays();
    };

    /**
     * 위젯 숨기기 (화면에서 감춤)
     */
    window.hideWidget = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        item.enabled = false;
        const el = document.querySelector(item.selector) || document.getElementById(item.id);
        if (el) {
            el.style.setProperty('display', 'none', 'important');
        }

        updateToolbarContent();
        injectCardEditOverlays();
    };

    /**
     * 숨겨진 위젯 복원 (다시 켜기)
     */
    window.restoreWidget = function(widgetId) {
        const item = workingWidgets.find(w => w.id === widgetId);
        if (!item) return;

        item.enabled = true;
        const el = document.querySelector(item.selector) || document.getElementById(item.id);
        if (el) {
            el.style.display = '';
            if (el.parentElement && el.parentElement.id === 'portalHomarrGrid') {
                el.style.gridColumn = item.colSpan === 2 ? '1 / -1' : 'span 1';
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        const drop = document.getElementById('hiddenWidgetsDropdown');
        if (drop) drop.style.display = 'none';

        updateToolbarContent();
        injectCardEditOverlays();
    };

    /**
     * 숨긴 위젯 드롭다운 토글
     */
    window.toggleHiddenWidgetsDropdown = function(e) {
        e.stopPropagation();
        const drop = document.getElementById('hiddenWidgetsDropdown');
        if (!drop) return;
        drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
    };

    // 문서 클릭 시 드롭다운 닫기
    document.addEventListener('click', () => {
        const drop = document.getElementById('hiddenWidgetsDropdown');
        if (drop) drop.style.display = 'none';
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
