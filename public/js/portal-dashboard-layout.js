/**
 * 🍱 JG 포털 메인 대시보드 동적 레이아웃 엔진 (portal-dashboard-layout.js)
 * - /api/modules/dashboard/config 설정을 읽어 메인 홈의 위젯 순서(order), 노출(display), 너비(gridColumn) 동적 적용
 * - 기존 DOM ID, 이벤트 바인딩, 실시간 차트/소켓 로직 100% 무결성 보존 ([규칙 3], [규칙 5])
 * - [규칙 2] 한국어 인터페이스 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    /**
     * 대시보드 위젯 배치 설정 적용
     */
    async function applyDashboardLayoutConfig() {
        try {
            const res = await fetch('/api/modules/dashboard/config');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !Array.isArray(data.widgets)) return;

            // 커스텀/오픈소스 동적 위젯 DOM 사전 보장
            if (typeof window.reloadDynamicWidgets === 'function') {
                await window.reloadDynamicWidgets();
            }

            const isRoleAdmin = document.documentElement.classList.contains('role-admin');
            const isHideBlood = document.documentElement.classList.contains('hide-blood');
            const isHideOps = document.documentElement.classList.contains('hide-ops');
            const isHideAsset = document.documentElement.classList.contains('hide-asset');

            data.widgets.forEach(w => {
                let el = null;
                if (w.selector) {
                    try { el = document.querySelector(w.selector); } catch (e) {}
                }
                if (!el && w.id) {
                    el = document.getElementById(w.id);
                }
                if (!el) return;

                // 1. 권한 기반 은폐 상태인 경우 우선 존중
                if (w.id === 'homarrHeroCard' || w.id === 'bento-blood') {
                    if (isHideBlood) return;
                }
                if (w.id === 'bento-ops' && isHideOps) {
                    return;
                }
                if (w.id === 'bento-asset' && isHideAsset) {
                    return;
                }

                // 2. 관리자 설정에 따른 On/Off
                if (w.enabled === false) {
                    el.style.setProperty('display', 'none', 'important');
                    // 연결된 상단 탭 버튼도 함께 숨김
                    const tabKey = w.id.replace('bento-', '').replace('card-', '');
                    document.querySelectorAll(`.portal-tab-btn[data-tab="${tabKey}"]`).forEach(btn => {
                        btn.style.display = 'none';
                    });
                    return;
                }

                // 3. 노출 복원 (기존 스타일이 display:none으로 강제되지 않은 경우)
                if (el.style.display === 'none' && !el.getAttribute('data-hidden-by-auth')) {
                    el.style.display = '';
                }

                // 4. 순서 (CSS Flex/Grid order)
                if (typeof w.order === 'number') {
                    el.style.order = String(w.order);
                }

                // 5. 그리드 너비 (colSpan)
                // homarr-grid 내부 카드들에 대해서만 컬럼 span 적용
                if (el.parentElement && el.parentElement.id === 'portalHomarrGrid') {
                    if (w.colSpan === 2) {
                        el.style.gridColumn = '1 / -1';
                    } else if (w.colSpan === 1) {
                        el.style.gridColumn = 'span 1';
                    }
                }
            });

            // 관리자인 경우 빠른 위젯 설정 바로가기 플로팅/헤더 칩 표시
            if (isRoleAdmin) {
                renderAdminWidgetQuickLink();
            }
        } catch (e) {
            console.warn('[DashboardLayout] 대시보드 레이아웃 설정 적용 실패:', e);
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
        document.addEventListener('DOMContentLoaded', applyDashboardLayoutConfig);
    } else {
        applyDashboardLayoutConfig();
    }

    window.refreshDashboardLayout = applyDashboardLayoutConfig;
})();
