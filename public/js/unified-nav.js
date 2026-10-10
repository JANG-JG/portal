/**
 * 🌐 JG 통합 상단 내비게이션 바 인터랙션 스크립트
 * - 전 사이트(j-jg.cc, blood.j-jg.cc, asset.j-jg.cc, news.j-jg.cc) 반응형 내비게이션 및 공통 알림 센터 연동
 */
(function() {
    function initUnifiedNav() {
        const btn = document.getElementById('unavHamburgerBtn');
        const drawer = document.getElementById('unavDrawer');

        // 1. 내비게이션 바에 알림 센터(🔔) 메뉴 동적 주입 및 연동
        ensureNotificationNavItems();

        // 2. 미확인 알림 뱃지 카운트 비동기 조회
        fetchUnreadNotificationBadge();
        // 60초 주기 뱃지 갱신
        setInterval(fetchUnreadNotificationBadge, 60000);

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

        // 모바일 드로어 내부 링크 클릭 시 드로어 자동 닫힘
        drawer.querySelectorAll('a').forEach(function(a) {
            a.addEventListener('click', function() {
                window.closeUnavDrawer();
            });
        });
    }

    // 🔔 전 사이트 공통 알림 클릭 핸들러 (전역 노출)
    window.handleUnifiedNotifClick = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        window.closeUnavDrawer();
        if (typeof window.openNotificationModal === 'function') {
            window.openNotificationModal();
        } else {
            window.location.href = 'https://j-jg.cc/?open=notification';
        }
    };

    // 내비게이션 바에 알림 항목이 없을 경우 자동 주입
    function ensureNotificationNavItems() {
        // 1) 데스크톱 메뉴
        const menu = document.querySelector('.unav-menu');
        if (menu && !document.querySelector('.unav-notif-btn')) {
            const logoutItem = menu.querySelector('.unav-logout-btn')?.closest('.unav-item') || menu.lastElementChild;
            const notifItem = document.createElement('div');
            notifItem.className = 'unav-item';
            notifItem.innerHTML = `
                <button type="button" class="unav-link unav-notif-btn" onclick="handleUnifiedNotifClick(event)" title="통합 알림 센터" style="background: none; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; font-family: inherit; font-size: inherit; color: inherit;">
                    <span style="font-size: 1.15rem; line-height: 1;">🔔</span>
                    <span>알림</span>
                    <span class="unav-notif-badge" style="display: none; background: #ef4444; color: white; border-radius: 10px; padding: 1px 6px; font-size: 0.72rem; font-weight: bold; line-height: 1.2;">0</span>
                </button>
            `;
            if (logoutItem) {
                menu.insertBefore(notifItem, logoutItem);
            } else {
                menu.appendChild(notifItem);
            }
        }

        // 2) 모바일 드로어 메뉴
        const mList = document.querySelector('.unav-m-list');
        if (mList && !document.querySelector('.unav-m-notif-btn')) {
            const notifMGroup = document.createElement('div');
            notifMGroup.className = 'unav-m-group';
            notifMGroup.innerHTML = `
                <button type="button" class="unav-m-title unav-m-notif-btn" onclick="handleUnifiedNotifClick(event)" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span>🔔 통합 알림 센터</span>
                    <span class="unav-notif-badge" style="display: none; background: #ef4444; color: white; border-radius: 10px; padding: 1px 6px; font-size: 0.72rem; font-weight: bold;">0</span>
                </button>
            `;
            mList.appendChild(notifMGroup);
        }
    }

    // 미확인 알림 뱃지 카운트 조회
    function fetchUnreadNotificationBadge() {
        const isLocal = window.location.hostname === 'localhost';
        const apiUrl = isLocal ? '/api/notification/history?limit=1' : 'https://j-jg.cc/api/notification/history?limit=1';

        fetch(apiUrl, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data && typeof data.unreadCount === 'number') {
                    const cnt = data.unreadCount;
                    const badges = document.querySelectorAll('#unavNotifBadge, #unavMNotifBadge, .unav-notif-badge');
                    badges.forEach(b => {
                        b.textContent = cnt;
                        b.style.display = cnt > 0 ? 'inline-block' : 'none';
                    });
                }
            })
            .catch(() => {});
    }

    // 전역 모바일 드로어 닫기 함수
    window.closeUnavDrawer = function() {
        const drawer = document.getElementById('unavDrawer');
        const btn = document.getElementById('unavHamburgerBtn');
        if (drawer) drawer.classList.remove('open');
        if (btn) {
            btn.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
    };

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
