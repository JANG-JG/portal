/**
 * 🌐 JG 통합 상단 내비게이션 바 인터랙션 스크립트
 */
(function() {
    function initUnifiedNav() {
        const btn = document.getElementById('unavHamburgerBtn');
        const drawer = document.getElementById('unavDrawer');
        if (!btn || !drawer) return;

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = drawer.classList.contains('open');
            if (isOpen) {
                drawer.classList.remove('open');
                btn.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            } else {
                drawer.classList.add('open');
                btn.classList.add('open');
                btn.setAttribute('aria-expanded', 'true');
            }
        });

        // 외부 영역 클릭 시 드로어 닫기
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.unav-header')) {
                if (drawer.classList.contains('open')) {
                    drawer.classList.remove('open');
                    btn.classList.remove('open');
                    btn.setAttribute('aria-expanded', 'false');
                }
            }
        });

        // ESC 키 입력 시 드로어 닫기
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && drawer.classList.contains('open')) {
                drawer.classList.remove('open');
                btn.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // 모바일 아코디언 서브메뉴 토글 함수 (전역 노출)
    window.toggleUnavAccordion = function(button) {
        const group = button.closest('.unav-m-group');
        if (!group) return;
        const isExpanded = group.classList.contains('expanded');
        
        // 다른 열린 아코디언 닫기
        document.querySelectorAll('.unav-m-group').forEach(function(g) {
            if (g !== group) {
                g.classList.remove('expanded');
            }
        });

        if (isExpanded) {
            group.classList.remove('expanded');
        } else {
            group.classList.add('expanded');
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUnifiedNav);
    } else {
        initUnifiedNav();
    }
})();

