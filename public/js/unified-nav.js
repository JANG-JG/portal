/**
 * 🌐 JG 통합 상단 내비게이션 바 동적 컴포넌트 로더 & 인터랙션 스크립트
 * - 전 사이트(j-jg.cc, blood.j-jg.cc, asset.j-jg.cc, news.j-jg.cc) 반응형 내비게이션 및 공통 알림 센터 연동
 * - https://j-jg.cc/components/unified-nav.html 단일 컴포넌트 자동 주입 및 현재 페이지 하이라이트
 */
(function() {
    // 1. 공통 CSS 스타일시트 자동 주입 확인
    function ensureUnifiedNavCss() {
        if (!document.querySelector('link[href*="unified-nav.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            const isLocal = window.location.hostname === 'localhost';
            link.href = (isLocal ? '/css/unified-nav.css' : 'https://j-jg.cc/css/unified-nav.css') + '?v=' + Date.now();
            document.head.appendChild(link);
        }
    }

    // 2. 상단 내비게이션 HTML 컴포넌트 비동기 로드 및 마운트
    async function mountUnifiedNav() {
        ensureUnifiedNavCss();

        try {
            const isLocal = window.location.hostname === 'localhost';
            const compUrl = (isLocal ? '/components/unified-nav.html' : 'https://j-jg.cc/components/unified-nav.html') + '?v=' + Date.now();
            const res = await fetch(compUrl);
            if (res.ok) {
                const html = await res.text();
                let target = document.getElementById('unified-nav-root') || 
                             document.getElementById('unavRoot') || 
                             document.querySelector('header.unav-header');

                if (target) {
                    // 구버전 외부 독립 드로어가 있을 경우 중복 방지 제거
                    const oldDrawer = document.getElementById('unavDrawer');
                    if (oldDrawer && oldDrawer.parentNode !== target) {
                        oldDrawer.remove();
                    }
                    target.outerHTML = html;
                } else if (document.body) {
                    document.body.insertAdjacentHTML('afterbegin', html);
                }
            }
        } catch (err) {
            console.warn('[UnifiedNav] 동적 컴포넌트 로드 실패, 기존 마크업 유지:', err);
        }

        // 현재 서비스/경로에 따른 활성 탭 자동 하이라이트
        highlightActiveMenu();

        // 햄버거 메뉴, 드로어, 알림 연동 초기화
        initUnifiedNav();
    }

    // 3. 현재 접속 페이지에 따른 메뉴 하이라이트 및 모바일 아코디언 자동 열림
    function highlightActiveMenu() {
        const host = window.location.hostname;
        const path = window.location.pathname;
        let activeKey = 'home';

        if (host.includes('blood') || path.includes('/go/blood') || path.includes('hospital') || path.includes('report')) {
            activeKey = 'blood';
        } else if (host.includes('asset') || path.includes('/go/asset')) {
            activeKey = 'asset';
        } else if (host.includes('news') || path.includes('/go/news') || path.includes('weather') || path.includes('breaking')) {
            activeKey = 'news';
        } else if (path.includes('admin')) {
            activeKey = 'admin';
        } else if (host === 'j-jg.cc' || host === 'localhost') {
            activeKey = 'home';
        }

        // 데스크톱 링크 활성화
        document.querySelectorAll('.unav-link[data-nav]').forEach(el => {
            if (el.getAttribute('data-nav') === activeKey) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        // 모바일 드로어 그룹 활성화 및 아코디언 자동 열림
        document.querySelectorAll('.unav-m-group[data-nav]').forEach(group => {
            const btn = group.querySelector('.unav-m-title');
            if (group.getAttribute('data-nav') === activeKey) {
                group.classList.add('expanded');
                if (btn) btn.classList.add('active');
            } else {
                group.classList.remove('expanded');
                if (btn) btn.classList.remove('active');
            }
        });
    }

    // 4. 내비게이션 바 인터랙션 및 알림 연동
    function initUnifiedNav() {
        const btn = document.getElementById('unavHamburgerBtn');
        const drawer = document.getElementById('unavDrawer');

        // 알림 버튼 확인 및 보정
        ensureNotificationNavItems();

        // 미확인 알림 뱃지 카운트 비동기 조회 및 60초 주기 갱신
        fetchUnreadNotificationBadge();
        if (!window.__unavBadgeTimer) {
            window.__unavBadgeTimer = setInterval(fetchUnreadNotificationBadge, 60000);
        }

        // URL에 ?notif_id=...가 포함되어 있으면 즉시 읽음 처리 및 쿼리 파라미터 정리
        handleNotifIdFromUrl();

        if (!btn || !drawer) return;

        // 햄버거 버튼 클릭 이벤트 바인딩 (중복 등록 방지)
        btn.onclick = function(e) {
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
        };

        // 외부 영역 클릭 시 드로어 닫기
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.unav-header') && drawer.classList.contains('open')) {
                window.closeUnavDrawer();
            }
        });

        // ESC 키 입력 시 드로어 닫기
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && drawer.classList.contains('open')) {
                window.closeUnavDrawer();
            }
        });

        // 모바일 드로어 내부 링크 클릭 시 자동 닫힘
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

    // 내비게이션 바에 알림 항목이 없을 경우 자동 주입 (fallback)
    function ensureNotificationNavItems() {
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

    // URL 쿼리스트링에 notif_id가 있을 경우 즉시 읽음 처리 및 주소창 정리
    function handleNotifIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const notifId = urlParams.get('notif_id');
        if (notifId) {
            const isLocal = window.location.hostname === 'localhost';
            const apiUrl = isLocal 
                ? `/api/notification/history/${notifId}/read` 
                : `https://j-jg.cc/api/notification/history/${notifId}/read`;

            fetch(apiUrl, {
                method: 'POST',
                credentials: 'include',
                keepalive: true
            }).then(() => {
                urlParams.delete('notif_id');
                const newQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
                const newUrl = window.location.pathname + newQuery + window.location.hash;
                window.history.replaceState({}, document.title, newUrl);
                fetchUnreadNotificationBadge();
            }).catch(() => {});
        }
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

    // DOM 준비 시 마운트 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountUnifiedNav);
    } else {
        mountUnifiedNav();
    }
})();
