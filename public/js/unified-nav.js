/**
 * 🌐 JG 통합 상단 내비게이션 바 동적 컴포넌트 로더 & 인터랙션 스크립트
 * - 전 사이트(j-jg.cc, blood.j-jg.cc, asset.j-jg.cc, news.j-jg.cc) 반응형 내비게이션 및 공통 알림 센터 연동
 * - https://j-jg.cc/components/unified-nav.html 단일 컴포넌트 자동 주입 및 현재 페이지 하이라이트
 */
(function() {
    // 0. PWA 설치 프롬프트 전역 핸들러
    window.deferredInstallPrompt = window.deferredInstallPrompt || null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.deferredInstallPrompt = e;
        const mobileInstallBtn = document.getElementById('btnPwaInstallMobile');
        if (mobileInstallBtn) mobileInstallBtn.style.display = 'flex';
        const desktopInstallBtn = document.getElementById('btnPwaInstall');
        if (desktopInstallBtn) desktopInstallBtn.style.display = 'inline-flex';
    });
    window.triggerPwaInstall = async function() {
        if (window.deferredInstallPrompt) {
            window.deferredInstallPrompt.prompt();
            const { outcome } = await window.deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                localStorage.setItem('pwa_installed', 'true');
            }
            window.deferredInstallPrompt = null;
        } else {
            alert('스마트폰(Android/Chrome, iOS/Safari) 또는 브라우저의 [공유] 또는 [메뉴(⋮)] > [홈 화면에 추가] 또는 [앱 설치]를 선택해 설치할 수 있습니다.');
        }
    };

    const UNAV_VERSION = window.__JG_UI_VERSION__ || '20261024_115136';
    const CACHE_KEY_HTML = 'jg_unav_html';
    const CACHE_KEY_VER = 'jg_unav_ver';
    const CACHE_KEY_TIME = 'jg_unav_time';
    const STALE_CHECK_INTERVAL = 5 * 60 * 1000; // 5분 주기로 신속한 백그라운드 갱신

    // ========================================================
    // 🛡️ [Android WebAPK / App Links 가로채기 방지 가드]
    // 모바일/데스크톱 브라우저 환경에서 링크 클릭 시 OS Intent로 WebAPK가 강제 실행되어
    // 브라우저 주소창 URL이 변경되지 않고 외부 웹앱으로 튕기는 현상 원천 차단
    // ========================================================
    (function initBrowserLinkIntentGuard() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                             window.navigator.standalone === true || 
                             document.referrer.includes('android-app://');

        // PWA 독립 실행형 앱 창 안에서 실행 중이면 OS 기본 동작 유지
        if (isStandalone) return;

        // 일반 브라우저 탭(모바일/데스크톱 모드)에서 실행 중일 때 패밀리 사이트 링크 클릭 가로채기
        document.addEventListener('click', function(e) {
            const link = e.target && e.target.closest('a[href]');
            if (!link) return;

            // 다운로드, 새 탭(_blank) 열기 링크는 브라우저 기본 동작 유지
            if (link.target === '_blank' || link.hasAttribute('download')) return;

            const rawHref = link.getAttribute('href');
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

            let targetUrl;
            try {
                targetUrl = new URL(link.href, window.location.href);
            } catch (err) {
                return;
            }

            // JG 패밀리 사이트 도메인들
            const isFamilySite = targetUrl.hostname === 'j-jg.cc' || 
                                 targetUrl.hostname.endsWith('.j-jg.cc') || 
                                 targetUrl.hostname === 'localhost';

            if (!isFamilySite) return;

            // 동일 페이지 내 해시 이동(#)인 경우는 기본 앵커 스크롤 허용
            if (targetUrl.origin === window.location.origin && 
                targetUrl.pathname === window.location.pathname && 
                targetUrl.search === window.location.search && 
                targetUrl.hash) {
                return;
            }

            // 1) 안드로이드 OS에 ACTION_VIEW Intent를 전달하는 브라우저 기본 a태그 동작 취소
            e.preventDefault();

            // 2) 모바일 드로어가 열려있다면 닫기
            if (typeof window.closeUnavDrawer === 'function') {
                window.closeUnavDrawer();
            }

            // 3) 비동기 마크로태스크(setTimeout)로 User Gesture 컨텍스트를 분리하여 브라우저 내부 탐색 강제
            // Chrome 및 Android WebKit은 비동기 스크립트 실행 컨텍스트에서의 location 이동을
            // 사용자 제스처 기반 External App Launch로 취급하지 않고 안전하게 브라우저 탭 내에서 직접 로딩합니다.
            const dest = targetUrl.href;
            setTimeout(function() {
                window.location.href = dest;
            }, 10);
        }, true); // useCapture: true로 최상위에서 선점
    })();

    // 1. 공통 CSS 스타일시트 및 Pretendard 웹폰트 자동 주입 확인
    function ensureUnifiedNavCss() {
        const isLocal = window.location.hostname === 'localhost';
        if (!document.getElementById('jg-ui-critical-css')) {
            const style = document.createElement('style');
            style.id = 'jg-ui-critical-css';
            style.textContent = `
                #unified-nav-root, .unav-header { display: block !important; min-height: 54px !important; background-color: #ffffff !important; position: sticky !important; top: 0 !important; width: 100% !important; z-index: 99999 !important; box-sizing: border-box !important; }
                .unav-container { max-width: 1280px !important; margin: 0 auto !important; padding: 0.65rem 1.25rem !important; display: flex !important; align-items: center !important; justify-content: space-between !important; box-sizing: border-box !important; height: 54px !important; }
                .unav-brand { display: inline-flex !important; align-items: center !important; gap: 0.5rem !important; text-decoration: none !important; font-size: 1.2rem !important; font-weight: 800 !important; color: #0f172a !important; line-height: 1 !important; white-space: nowrap !important; }
                .unav-brand-icon-img { width: 24px !important; height: 24px !important; max-width: 24px !important; max-height: 24px !important; border-radius: 6px !important; display: inline-block !important; vertical-align: middle !important; object-fit: contain !important; flex-shrink: 0 !important; margin: 0 !important; padding: 0 !important; }
                .unav-dropdown { position: absolute !important; top: 100% !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
                .unav-drawer:not(.open) { display: none !important; }
                @media (max-width: 860px) { #unified-nav-root, .unav-header { min-height: 52px !important; } .unav-container { padding: 0.5rem 0.85rem !important; height: 52px !important; } .unav-menu { display: none !important; } }
            `;
            (document.head || document.documentElement).appendChild(style);
        }
        if (!document.querySelector('link[href*="pretendard.css"]')) {
            const fontLink = document.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.href = (isLocal ? '/css/pretendard.css' : 'https://j-jg.cc/css/pretendard.css') + '?v=' + UNAV_VERSION;
            document.head.appendChild(fontLink);
        }
        if (!document.querySelector('link[href*="unified-nav.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = (isLocal ? '/css/unified-nav.css' : 'https://j-jg.cc/css/unified-nav.css') + '?v=' + UNAV_VERSION;
            document.head.appendChild(link);
        }
    }

    // 포털 메인 페이지(index.html) 여부 판별 헬퍼
    function isPortalMainPage() {
        const host = window.location.hostname;
        const path = window.location.pathname;
        const isPortalHost = (host === 'j-jg.cc' || host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.'));
        const isMainPath = (path === '/' || path === '/index.html');
        return (isPortalHost && isMainPath) || !!document.getElementById('portal-tab-bar');
    }

    // 2. 상단 내비게이션 HTML 컴포넌트 비동기 로드 및 마운트 (localStorage SWR 캐싱)
    async function mountUnifiedNav() {
        ensureUnifiedNavCss();

        // 🛡️ 포털 메인(index.html)에서 접속한 경우 상단 통합 내비게이션 바를 표시하지 않음
        if (isPortalMainPage()) {
            const existingNav = document.getElementById('unified-nav-root') || document.getElementById('unavRoot') || document.querySelector('header.unav-header');
            if (existingNav) existingNav.remove();
            const existingDrawer = document.getElementById('unavDrawer');
            if (existingDrawer) existingDrawer.remove();
            initUnifiedNav();
            return;
        }

        let cachedHtml = null;
        let cachedVer = null;
        let cachedTime = 0;
        try {
            cachedHtml = localStorage.getItem(CACHE_KEY_HTML);
            cachedVer = localStorage.getItem(CACHE_KEY_VER);
            cachedTime = parseInt(localStorage.getItem(CACHE_KEY_TIME) || '0', 10);
            // 구버전 캐시, 카테고리 바 누락 또는 구형 서브메뉴/비SSO 링크 포함 시 즉시 캐시 강제 정리 (자가 치유)
            const isLegacyContent = cachedHtml && (
                !cachedHtml.includes('notif-category-bar') ||
                !cachedHtml.includes('/go/blood') ||
                cachedHtml.includes('병원 일정 상세 관리') ||
                cachedHtml.includes('혈압 관리 메인 페이지') ||
                cachedHtml.includes('실시간 뉴스 대시보드')
            );
            if (cachedVer !== UNAV_VERSION || isLegacyContent) {
                localStorage.removeItem(CACHE_KEY_HTML);
                localStorage.removeItem(CACHE_KEY_VER);
                localStorage.removeItem(CACHE_KEY_TIME);
                cachedHtml = null;
                cachedVer = null;
            }
            sessionStorage.removeItem('jg_unav_html_v20261013_v7');
        } catch (e) {}

        const applyHtml = (html) => {
            let target = document.getElementById('unified-nav-root') || 
                         document.getElementById('unavRoot') || 
                         document.querySelector('header.unav-header');

            if (target) {
                const oldDrawer = document.getElementById('unavDrawer');
                if (oldDrawer && oldDrawer.parentNode !== target) oldDrawer.remove();
                // 🛡️ 페이지 내 잔존하는 구버전 알림 모달 완전 정리
                document.querySelectorAll('#notificationModal').forEach(m => {
                    if (m.parentNode !== target) m.remove();
                });
                target.outerHTML = html;
            } else if (document.body) {
                document.querySelectorAll('#notificationModal').forEach(m => m.remove());
                document.body.insertAdjacentHTML('afterbegin', html);
            }
        };

        // 1) localStorage 캐시가 일치하면 즉시 렌더링 (0ms 레이턴시)
        const hasValidCache = cachedHtml && cachedVer === UNAV_VERSION;
        if (hasValidCache) {
            applyHtml(cachedHtml);
            optimizeInternalNavLinks();
            highlightActiveMenu();
            initUnifiedNav();
        }

        // 2) 캐시가 없거나, 버전이 변경되었거나, TTL이 만료된 경우에만 백그라운드 갱신
        const isStale = !hasValidCache || (Date.now() - cachedTime > STALE_CHECK_INTERVAL);
        if (isStale) {
            try {
                const isLocal = window.location.hostname === 'localhost';
                const compUrl = (isLocal ? '/components/unified-nav.html' : 'https://j-jg.cc/components/unified-nav.html') + '?v=' + UNAV_VERSION;
                const res = await fetch(compUrl);
                if (res.ok) {
                    const html = await res.text();
                    try {
                        localStorage.setItem(CACHE_KEY_HTML, html);
                        localStorage.setItem(CACHE_KEY_VER, UNAV_VERSION);
                        localStorage.setItem(CACHE_KEY_TIME, String(Date.now()));
                    } catch (e) {}

                    if (html !== cachedHtml || !cachedHtml) {
                        applyHtml(html);
                        optimizeInternalNavLinks();
                        highlightActiveMenu();
                        initUnifiedNav();
                    }
                }
            } catch (err) {
                console.warn('[UnifiedNav] 동적 컴포넌트 로드 실패:', err);
            }
        }

        // 스마트 컨텍스트 네비게이션 및 현재 서비스/경로에 따른 활성 탭 자동 하이라이트
        optimizeInternalNavLinks();
        highlightActiveMenu();

        // 햄버거 메뉴, 드로어, 알림 연동 초기화
        initUnifiedNav();
    }

    // 🌟 [스마트 컨텍스트 네비게이션 최적화]
    // 현재 접속 중인 서비스 내부 링크는 외부 게이트웨이(/go/...) 왕복 없이 상대 경로/해시로 즉시 전환 (0ms 딜레이 & 해시 보존)
    function optimizeInternalNavLinks() {
        const host = window.location.hostname;
        let currentService = '';
        if (host.includes('blood')) currentService = 'blood';
        else if (host.includes('asset')) currentService = 'asset';
        else if (host.includes('news')) currentService = 'news';

        if (!currentService) return;

        document.querySelectorAll(`.unav-header a[href*="/go/${currentService}"]`).forEach(link => {
            try {
                const u = new URL(link.href, window.location.origin);
                const targetPath = u.searchParams.get('path');
                if (targetPath) {
                    link.href = targetPath; // 예: /hospital.html 또는 #tab-analytics
                } else {
                    link.href = '/';
                }
            } catch (e) {}
        });
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
        } else if (host.includes('news') || path.includes('/go/news') || path.includes('weather') || path.includes('breaking') || path.includes('economy')) {
            activeKey = 'news';
        } else if (path.includes('admin')) {
            activeKey = 'admin';
        } else if (path.includes('calendar')) {
            activeKey = 'calendar';
        } else if (path.includes('memo')) {
            activeKey = 'memo';
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

        // URL에 ?notif_id=...가 포함되어 있으면 즉시 읽음 처리 및 쿼리 파라미터 주소창 노출 방지 정리
        handleNotifIdFromUrl();

        // 🌟 [자동 동기화] APK 앱, PWA(기본 웹앱), 데스크톱 PC 환경에서만 페이지 로드 시 백그라운드 자동 동기화
        // (모바일 일반 브라우저에서는 백그라운드 자동 구독을 수행하지 않아 중복 원천 방지)
        if ('Notification' in window) {
            const meta = getDevicePushMetadata();
            const isInstalledApp = meta.deviceType !== 'mobile' || meta.clientType === 'pwa' || meta.clientType === 'apk';
            if (isInstalledApp) {
                setTimeout(function() {
                    if (typeof window.registerWebPushSubscription === 'function') {
                        window.registerWebPushSubscription();
                    }
                }, 1000);
            }
        }

        if (!btn || !drawer) return;

        // 햄버거 버튼 클릭 이벤트 바인딩 (중복 등록 방지)
        btn.onclick = function(e) {
            e.stopPropagation();
            const isOpen = drawer.classList.contains('open');
            if (isOpen) {
                drawer.classList.remove('open');
                btn.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            } else {
                drawer.classList.add('open');
                btn.classList.add('open');
                btn.setAttribute('aria-expanded', 'true');
                document.body.style.overflow = 'hidden';
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

        // 🚪 로그아웃 버튼 클릭 시 확인 알림 (중복 바인딩 및 중복 호출 원천 차단)
        if (!window.__unavLogoutListenerBound) {
            window.__unavLogoutListenerBound = true;
            document.addEventListener('click', function(e) {
                if (e.__unavLogoutHandled) return;
                const logoutLink = e.target.closest('.unav-logout-btn, .unav-m-logout-btn');
                if (logoutLink) {
                    e.__unavLogoutHandled = true;
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof window.openLogoutModal === 'function' && document.getElementById('logoutModal')) {
                        window.openLogoutModal(e);
                    } else if (confirm('정말 로그아웃 할까요?')) {
                        window.location.href = logoutLink.href || '/logout';
                    }
                }
            }, true);
        }

        // 모달 배경 클릭 시 닫기 이벤트
        document.addEventListener('click', function(e) {
            if (e.target && e.target.id === 'notificationModal') {
                window.closeNotificationModal();
            }
        });

        // ESC 키 입력 시 알림 모달 닫기
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const modal = document.getElementById('notificationModal');
                if (modal && (modal.classList.contains('open') || modal.style.display === 'flex')) {
                    window.closeNotificationModal();
                }
            }
        });

        // ℹ️ 알림 보관 주기 안내 툴팁 토글 및 외부 클릭 시 닫기
        window.toggleNotifInfoTooltip = function(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            const wrapper = document.getElementById('notifInfoTooltipWrapper');
            if (wrapper) wrapper.classList.toggle('active');
        };

        document.addEventListener('click', function(e) {
            const wrapper = document.getElementById('notifInfoTooltipWrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                wrapper.classList.remove('active');
            }
            if (!e.target.closest('.notif-more-menu-wrapper')) {
                if (typeof window.closeAllNotifMenus === 'function') {
                    window.closeAllNotifMenus();
                }
            }
        });

        // URL 쿼리 또는 해시(?open=notification, #notification)로 유입 시 모달 자동 열기 및 주소창 즉시 정리
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('open') === 'notification' || window.location.hash === '#notification') {
            setTimeout(function() {
                window.openNotificationModal();
            }, 200);
            urlParams.delete('open');
            const cleanQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            const cleanHash = window.location.hash === '#notification' ? '' : window.location.hash;
            const cleanUrl = window.location.pathname + cleanQuery + cleanHash;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    }

    // ========================================================
    // 🔔 전 사이트 공통 통합 알림 센터 모달 컨트롤러 (크로스 도메인 연동)
    // ========================================================
    const NOTIF_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://j-jg.cc';

    let portalNotifSettings = {
        enabled: 1,
        hospital_push_enabled: 1,
        breaking_news_enabled: 1,
        weather_morning_enabled: 1,
        weather_morning_time: '07:00',
        asset_report_enabled: 1,
        bp_reminder_enabled: 1,
        bp_reminder_time: '21:00',
        system_alert_enabled: 1,
        telegram_briefing_times: ['07:30'],
        weekday_med_times: ['08:00', '19:00'],
        weekday_bp_times: ['07:30', '21:30'],
        weekend_med_times: ['09:00', '19:30'],
        weekend_bp_times: ['08:30', '22:00']
    };

    let notifHistoryOffset = 0;
    const NOTIF_HISTORY_LIMIT = 30;
    let notifHistoryTotal = 0;
    let notifHistoryListItems = [];

    // 🔔 알림 버튼 클릭 시 현재 페이지에서 모달 즉시 오픈
    window.handleUnifiedNotifClick = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        window.closeUnavDrawer();
        window.openNotificationModal();
    };

    // 알림 모달 열기 (미발견 또는 구버전 시 자동 마운트 Self-Healing 보장)
    window.openNotificationModal = async function() {
        let modal = document.getElementById('notificationModal');
        // 🛡️ 카테고리 바가 없는 구버전 모달이면 즉시 제거하고 최신 컴포넌트로 재마운트
        if (modal && !modal.querySelector('.notif-category-bar')) {
            modal.remove();
            modal = null;
        }

        if (!modal) {
            console.log('[UnifiedNav] notificationModal 미발견 또는 구버전 교체 -> 최신 컴포넌트 마운트 시도...');
            try {
                // 1) localStorage 캐시에서 먼저 복구 시도 (카테고리 바가 있는 최신 캐시인 경우만)
                const localHtml = localStorage.getItem(CACHE_KEY_HTML);
                if (localHtml && localHtml.includes('notif-category-bar')) {
                    const temp = document.createElement('div');
                    temp.innerHTML = localHtml;
                    const cachedModal = temp.querySelector('#notificationModal');
                    if (cachedModal) {
                        document.body.appendChild(cachedModal);
                        modal = cachedModal;
                    }
                }

                // 2) 최신 캐시가 없으면 네트워크에서 강제 로드
                if (!modal) {
                    const isLocal = window.location.hostname === 'localhost';
                    const compUrl = (isLocal ? '/components/unified-nav.html' : 'https://j-jg.cc/components/unified-nav.html') + '?v=' + UNAV_VERSION;
                    const res = await fetch(compUrl);
                    if (res.ok) {
                        const html = await res.text();
                        try {
                            localStorage.setItem(CACHE_KEY_HTML, html);
                            localStorage.setItem(CACHE_KEY_VER, UNAV_VERSION);
                            localStorage.setItem(CACHE_KEY_TIME, String(Date.now()));
                        } catch (e) {}
                        const temp = document.createElement('div');
                        temp.innerHTML = html;
                        const fetchedModal = temp.querySelector('#notificationModal');
                        if (fetchedModal) {
                            document.body.appendChild(fetchedModal);
                            modal = fetchedModal;
                        }
                    }
                }
            } catch (err) {
                console.warn('[UnifiedNav] 모달 동적 로드 실패:', err);
            }
        }
        modal = document.getElementById('notificationModal');
        if (!modal) {
            console.warn('[UnifiedNav] notificationModal 요소를 찾을 수 없습니다.');
            return;
        }
        modal.classList.add('open');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        window.switchNotifMainTab('history');
        window.updateBrowserPermissionUI();
        window.fetchNotificationSettings();
        window.fetchNotificationHistory(false);
    };

    // 알림 모달 닫기
    window.closeNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (modal) {
            modal.classList.remove('open');
            modal.style.display = 'none';
        }
        document.body.style.overflow = '';
    };

    // 메인 탭 전환 (설정 vs 수신 내역)
    window.switchNotifMainTab = function(tab) {
        const isSettings = tab === 'settings';
        const settingsView = document.getElementById('notifMainViewSettings');
        const historyView = document.getElementById('notifMainViewHistory');
        const settingsTabBtn = document.getElementById('notifMainTabSettings');
        const historyTabBtn = document.getElementById('notifMainTabHistory');

        if (settingsView) settingsView.style.display = isSettings ? 'block' : 'none';
        if (historyView) historyView.style.display = isSettings ? 'none' : 'block';
        if (settingsTabBtn) settingsTabBtn.classList.toggle('active', isSettings);
        if (historyTabBtn) historyTabBtn.classList.toggle('active', !isSettings);

        if (!isSettings) {
            window.fetchNotificationHistory(false);
        }
    };

    // 서브 탭 전환 (평일 vs 주말 시간표)
    window.switchNotifSubTab = function(type) {
        const isWeekday = type === 'weekday';
        const weekdayView = document.getElementById('notifSubTabWeekday');
        const weekendView = document.getElementById('notifSubTabWeekend');
        const weekdayTabBtn = document.getElementById('notifTabWeekday');
        const weekendTabBtn = document.getElementById('notifTabWeekend');

        if (weekdayView) weekdayView.style.display = isWeekday ? 'block' : 'none';
        if (weekendView) weekendView.style.display = isWeekday ? 'none' : 'block';
        if (weekdayTabBtn) weekdayTabBtn.classList.toggle('active', isWeekday);
        if (weekendTabBtn) weekendTabBtn.classList.toggle('active', !isWeekday);
    };

    // 브라우저 푸시 알림 권한 상태 표시
    window.updateBrowserPermissionUI = function() {
        const textEl = document.getElementById('notifPermissionStatusText');
        const btnEl = document.getElementById('btnRequestNotifPermission');
        if (!('Notification' in window)) {
            if (textEl) textEl.textContent = '❌ 이 브라우저는 웹 푸시를 지원하지 않습니다.';
            if (btnEl) btnEl.style.display = 'none';
            return;
        }
        if (Notification.permission === 'granted') {
            if (textEl) textEl.textContent = '✅ 브라우저 푸시 알림 수신이 활성화되어 있습니다.';
            if (btnEl) btnEl.style.display = 'none';
        } else if (Notification.permission === 'denied') {
            if (textEl) textEl.textContent = '🚫 브라우저에서 알림이 차단되었습니다. 사이트 설정에서 허용해 주세요.';
            if (btnEl) btnEl.style.display = 'none';
        } else {
            if (textEl) textEl.textContent = '⚠️ 푸시 알림 권한이 필요합니다. [권한 허용]을 눌러주세요.';
            if (btnEl) btnEl.style.display = 'inline-block';
        }
    };

    // 브라우저 알림 권한 요청
    window.requestBrowserNotificationPermission = async function() {
        if (!('Notification' in window)) {
            alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
            return;
        }
        try {
            const perm = await Notification.requestPermission();
            window.updateBrowserPermissionUI();
            if (perm === 'granted') {
                await window.registerWebPushSubscription();
                alert('🎉 알림 권한이 성공적으로 허용되었습니다!');
            } else {
                alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
            }
        } catch (e) {
            console.error('권한 요청 실패:', e);
        }
    };

    // 알림 설정 데이터 조회 (API)
    window.fetchNotificationSettings = async function() {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success && data.settings) {
                portalNotifSettings = data.settings;
                const setCheck = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.checked = Boolean(val !== 0);
                };
                setCheck('notifMasterEnabled', portalNotifSettings.enabled);
                setCheck('notifBreakingNewsEnabled', portalNotifSettings.breaking_news_enabled);
                setCheck('notifWeatherMorningEnabled', portalNotifSettings.weather_morning_enabled);
                setCheck('notifAssetReportEnabled', portalNotifSettings.asset_report_enabled);
                const isOpenOn = portalNotifSettings.asset_open_enabled !== undefined ? portalNotifSettings.asset_open_enabled : portalNotifSettings.asset_report_enabled;
                const isCloseOn = portalNotifSettings.asset_close_enabled !== undefined ? portalNotifSettings.asset_close_enabled : portalNotifSettings.asset_report_enabled;
                setCheck('notifAssetOpenEnabled', isOpenOn);
                setCheck('notifAssetCloseEnabled', isCloseOn);
                setCheck('notifBpReminderEnabled', portalNotifSettings.bp_reminder_enabled);
                setCheck('notifHospitalPushEnabled', portalNotifSettings.hospital_push_enabled);
                setCheck('notifSystemAlertEnabled', portalNotifSettings.system_alert_enabled);

                const setVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el && val) el.value = val;
                };
                setVal('inputWeatherTime', portalNotifSettings.weather_morning_time || '07:00');
                setVal('inputBpReminderTime', portalNotifSettings.bp_reminder_time || '21:00');

                window.renderNotifChips();
            }
        } catch (e) {
            console.error('[포털 알림 설정 조회 실패]:', e);
        }
    };

    // 증시/환율 상위 토글 시 하위 개장/마감 일괄 토글
    window.toggleAssetSubOptions = function(checked) {
        const openEl = document.getElementById('notifAssetOpenEnabled');
        const closeEl = document.getElementById('notifAssetCloseEnabled');
        if (openEl) openEl.checked = checked;
        if (closeEl) closeEl.checked = checked;
    };

    // 증시/환율 개장/마감 서브 옵션 개별 변경 시 상위 토글 동기화
    window.handleAssetSubOptionChange = function() {
        const openEl = document.getElementById('notifAssetOpenEnabled');
        const closeEl = document.getElementById('notifAssetCloseEnabled');
        const reportEl = document.getElementById('notifAssetReportEnabled');
        const hasAny = (openEl && openEl.checked) || (closeEl && closeEl.checked);
        if (reportEl) reportEl.checked = hasAny;
    };

    // 시간표 칩 렌더링
    window.renderNotifChips = function() {
        const renderBox = (containerId, arr, key) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (!arr || arr.length === 0) {
                container.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">등록된 알림 시간이 없습니다.</span>';
                return;
            }
            container.innerHTML = arr.map((t, idx) => `
                <span class="notif-time-chip">
                    <span>⏰ ${t}</span>
                    <button type="button" onclick="removeNotifTime('${key}', ${idx})" title="삭제">✕</button>
                </span>
            `).join('');
        };

        renderBox('containerTelegramBriefingTimes', portalNotifSettings.telegram_briefing_times, 'telegram_briefing_times');
        renderBox('containerWeekdayMedTimes', portalNotifSettings.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', portalNotifSettings.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', portalNotifSettings.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', portalNotifSettings.weekend_bp_times, 'weekend_bp_times');
    };

    // 텔레그램 뉴스 브리핑 시각 추가
    window.addTelegramBriefingTime = function() {
        const inputEl = document.getElementById('inputTelegramBriefingTime');
        if (!inputEl || !inputEl.value) {
            alert('추가할 브리핑 발송 시간을 먼저 선택해 주세요.');
            return;
        }
        const val = inputEl.value.trim();
        if (!val || !/^\d{2}:\d{2}$/.test(val)) {
            alert('올바른 시간(HH:MM)을 선택해 주세요.');
            return;
        }
        if (!portalNotifSettings.telegram_briefing_times) {
            portalNotifSettings.telegram_briefing_times = [];
        }
        if (portalNotifSettings.telegram_briefing_times.includes(val)) {
            alert('이미 등록된 브리핑 시간입니다: ' + val);
            return;
        }
        portalNotifSettings.telegram_briefing_times.push(val);
        portalNotifSettings.telegram_briefing_times.sort();
        inputEl.value = '';
        window.renderNotifChips();
    };

    // 알림 시간 추가
    window.addNotifTime = function(dayType, category) {
        const inputId = dayType === 'weekday'
            ? (category === 'med' ? 'inputWeekdayMedTime' : 'inputWeekdayBpTime')
            : (category === 'med' ? 'inputWeekendMedTime' : 'inputWeekendBpTime');

        const key = `${dayType}_${category}_times`;
        const inputEl = document.getElementById(inputId);
        if (!inputEl || !inputEl.value) {
            alert('추가할 알림 시간을 먼저 선택해 주세요.');
            return;
        }
        const val = inputEl.value;
        if (!portalNotifSettings[key]) portalNotifSettings[key] = [];
        if (portalNotifSettings[key].includes(val)) {
            alert('이미 등록된 시간입니다.');
            return;
        }
        portalNotifSettings[key].push(val);
        portalNotifSettings[key].sort();
        inputEl.value = '';
        window.renderNotifChips();
    };

    // 알림 시간 제거
    window.removeNotifTime = function(key, index) {
        if (portalNotifSettings[key]) {
            portalNotifSettings[key].splice(index, 1);
            window.renderNotifChips();
        }
    };

    // 알림 설정 저장 (API)
    window.saveNotificationSettings = async function() {
        const getCheck = (id) => {
            const el = document.getElementById(id);
            return el ? (el.checked ? 1 : 0) : 1;
        };
        const getVal = (id, fallback) => {
            const el = document.getElementById(id);
            return (el && el.value.trim()) ? el.value.trim() : fallback;
        };

        portalNotifSettings.enabled = getCheck('notifMasterEnabled');
        portalNotifSettings.breaking_news_enabled = getCheck('notifBreakingNewsEnabled');
        portalNotifSettings.weather_morning_enabled = getCheck('notifWeatherMorningEnabled');
        portalNotifSettings.weather_morning_time = getVal('inputWeatherTime', '07:00');
        
        portalNotifSettings.asset_open_enabled = getCheck('notifAssetOpenEnabled');
        portalNotifSettings.asset_close_enabled = getCheck('notifAssetCloseEnabled');
        portalNotifSettings.asset_report_enabled = (portalNotifSettings.asset_open_enabled || portalNotifSettings.asset_close_enabled) ? 1 : getCheck('notifAssetReportEnabled');
        
        portalNotifSettings.bp_reminder_enabled = getCheck('notifBpReminderEnabled');
        portalNotifSettings.bp_reminder_time = getVal('inputBpReminderTime', '21:00');
        portalNotifSettings.hospital_push_enabled = getCheck('notifHospitalPushEnabled');
        portalNotifSettings.system_alert_enabled = getCheck('notifSystemAlertEnabled');

        try {
            const saveRes = await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            const result = await saveRes.json();

            if (portalNotifSettings.enabled) {
                await window.registerWebPushSubscription();
            }

            window.updateBrowserPermissionUI();
            alert(result.message || '알림 설정이 성공적으로 저장되었습니다.');
            window.closeNotificationModal();
        } catch (err) {
            console.error('[알림 설정 저장 오류]:', err);
            alert('알림 설정 저장 중 오류가 발생했습니다.');
        }
    };

    // 📱 [알림 중복 방지] 디바이스 및 실행 환경 메타데이터 수집 헬퍼
    function getDevicePushMetadata() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                             window.matchMedia('(display-mode: fullscreen)').matches ||
                             window.matchMedia('(display-mode: minimal-ui)').matches ||
                             window.navigator.standalone === true ||
                             document.referrer.includes('android-app://');
        const clientType = isStandalone ? 'pwa' : 'browser';

        const ua = navigator.userAgent.toLowerCase();
        const isTouchMobile = (navigator.maxTouchPoints > 1 && /android|linux|macintosh|iphone|ipad/i.test(ua) && window.screen && Math.min(window.screen.width, window.screen.height) <= 900);
        let deviceType = 'desktop';
        if (/mobi|iphone|ipod|android|samsungbrowser|wv/i.test(ua) || isTouchMobile) {
            deviceType = 'mobile';
        } else if (/ipad|tablet|kindle|playbook|silk/i.test(ua)) {
            deviceType = 'mobile';
        }

        let deviceId = '';
        try {
            deviceId = localStorage.getItem('jg_device_id');
            if (!deviceId) {
                deviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
                localStorage.setItem('jg_device_id', deviceId);
            }
        } catch (e) {
            deviceId = 'unknown';
        }

        return {
            clientType,
            deviceType,
            deviceId,
            userAgent: navigator.userAgent
        };
    }

    // VAPID 키 및 푸시 매니저 구독 등록 (API)
    window.registerWebPushSubscription = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        try {
            const meta = getDevicePushMetadata();

            // 알림 권한 확인 및 요청 (default 상태면 사용자에게 요청)
            if (Notification.permission === 'default') {
                const requested = await Notification.requestPermission();
                if (requested !== 'granted') {
                    console.log('[WebPush] 알림 권한 미허용');
                    return;
                }
            } else if (Notification.permission !== 'granted') {
                return;
            }

            const keyRes = await fetch(`${NOTIF_BASE_URL}/api/notification/vapid-key`, {
                credentials: 'include'
            });
            const { publicKey } = await keyRes.json();
            if (!publicKey) return;

            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            const convertedKey = urlBase64ToUint8Array(publicKey);

            // 🔄 VAPID 키 교체 감지: 기존 구독의 키와 서버 공개키가 다르면 구독 갱신
            if (sub && sub.options && sub.options.applicationServerKey) {
                const currentKey = new Uint8Array(sub.options.applicationServerKey);
                let isMatch = currentKey.length === convertedKey.length;
                if (isMatch) {
                    for (let i = 0; i < currentKey.length; i++) {
                        if (currentKey[i] !== convertedKey[i]) {
                            isMatch = false;
                            break;
                        }
                    }
                }
                if (!isMatch) {
                    console.log('🔄 [VAPID Key Changed] 새 VAPID 키 감지: 기존 푸시 구독 취소 후 새 키로 자동 재구독합니다.');
                    try {
                        await sub.unsubscribe();
                    } catch (unsubErr) {
                        console.warn('[구독 해제 경고]:', unsubErr);
                    }
                    sub = null;
                }
            }

            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedKey
                });
            }

            const subRes = await fetch(`${NOTIF_BASE_URL}/api/notification/subscribe`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription: sub,
                    clientType: meta.clientType,
                    deviceType: meta.deviceType,
                    deviceId: meta.deviceId,
                    userAgent: meta.userAgent
                })
            });
            const subData = await subRes.json().catch(() => ({}));
            if (subData && subData.skippedBrowser && sub) {
                try { await sub.unsubscribe(); } catch (e) {}
                console.log('🧹 [WebPush Guard] 전용 웹앱(PWA) 구독이 활성화되어 있어 일반 브라우저 중복 구독을 자동 해제했습니다.');
                return;
            }
            console.log(`✅ 포털 웹 푸시 구독 등록 완료 (${meta.deviceType} / ${meta.clientType.toUpperCase()})`);
        } catch (e) {
            console.error('[푸시 구독 등록 실패]:', e);
        }
    };

    // 푸시 구독 해제 함수 (API)
    window.unsubscribeWebPushSubscription = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const ep = sub.endpoint;
                await sub.unsubscribe();
                await fetch(`${NOTIF_BASE_URL}/api/notification/unsubscribe`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: ep })
                }).catch(() => {});
                console.log('✅ 포털 웹 푸시 구독 해제 완료');
            }
        } catch (e) {
            console.warn('[푸시 구독 해제 실패]:', e);
        }
    };

    // 테스트 알림 발송 (API)
    window.sendTestNotification = async function() {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/test`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                alert('🎉 기기로 테스트 푸시 알림이 발송되었습니다!\n수신 내역 탭에서도 확인하실 수 있습니다.');
                setTimeout(() => window.fetchNotificationHistory(false), 500);
            } else {
                alert('테스트 알림 발송 실패: ' + (data.message || '서버 응답 오류'));
            }
        } catch (e) {
            alert('테스트 알림 요청 중 오류 발생: ' + e.message);
        }
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ⏱️ 알림 시간 상대 표기 (오늘 온 알림은 몇분 전, 몇시간 전, 몇시간 몇분 전)
    function formatNotificationTime(dateStr) {
        if (!dateStr) return '';
        // "YYYY-MM-DD HH:MM:SS" 또는 ISO 형식 정밀 파싱 (로컬 타임존 보장)
        const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
        let targetDate = null;
        if (m) {
            targetDate = new Date(
                parseInt(m[1], 10),
                parseInt(m[2], 10) - 1,
                parseInt(m[3], 10),
                parseInt(m[4], 10),
                parseInt(m[5], 10),
                parseInt(m[6] || '0', 10)
            );
        } else {
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) targetDate = parsed;
        }

        if (!targetDate) {
            return String(dateStr).replace('T', ' ').slice(5, 16);
        }

        const now = new Date();
        const diffMs = now.getTime() - targetDate.getTime();

        // 같은 날(오늘)인지 확인
        const isToday = (
            now.getFullYear() === targetDate.getFullYear() &&
            now.getMonth() === targetDate.getMonth() &&
            now.getDate() === targetDate.getDate()
        );

        if (isToday) {
            if (diffMs < 60 * 1000) {
                return '방금 전';
            }
            const diffMinutes = Math.floor(diffMs / (60 * 1000));
            if (diffMinutes < 60) {
                return `${diffMinutes}분 전`;
            }
            const diffHours = Math.floor(diffMinutes / 60);
            const remainMinutes = diffMinutes % 60;
            if (remainMinutes === 0) {
                return `${diffHours}시간 전`;
            }
            return `${diffHours}시간 ${remainMinutes}분 전`;
        }

        // 어제인지 확인
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = (
            yesterday.getFullYear() === targetDate.getFullYear() &&
            yesterday.getMonth() === targetDate.getMonth() &&
            yesterday.getDate() === targetDate.getDate()
        );

        const pad = n => String(n).padStart(2, '0');
        const hours = pad(targetDate.getHours());
        const minutes = pad(targetDate.getMinutes());
        const month = pad(targetDate.getMonth() + 1);
        const date = pad(targetDate.getDate());

        if (isYesterday) {
            return `어제 ${hours}:${minutes}`;
        }

        // 올해인 경우
        if (now.getFullYear() === targetDate.getFullYear()) {
            return `${month}-${date} ${hours}:${minutes}`;
        }

        // 이전 연도
        return `${targetDate.getFullYear()}-${month}-${date} ${hours}:${minutes}`;
    }

    // 🏷️ 알림 카테고리 메타 정의
    const NOTIF_CATEGORIES = [
        { key: 'all', label: '전체', icon: '🔔' },
        { key: 'breaking', label: '속보', icon: '🚨' },
        { key: 'calendar', label: '일정', icon: '📅' },
        { key: 'weather', label: '날씨', icon: '🌤️' },
        { key: 'finance', label: '금융', icon: '💰' },
        { key: 'health', label: '건강', icon: '🩸' },
        { key: 'system', label: '시스템', icon: '🖥️' }
    ];

    let notifSelectedCategory = 'all';

    function getNotificationCategory(item) {
        const type = (item.type || '').toLowerCase();
        const title = (item.title || '').toLowerCase();
        const body = (item.body || '').toLowerCase();
        const full = `${type} ${title} ${body}`;

        if (type === 'breaking' || full.includes('속보')) {
            return { key: 'breaking', label: '속보', icon: '🚨', colorClass: 'cat-breaking' };
        }
        if (type === 'calendar' || full.includes('일정') || full.includes('캘린더')) {
            return { key: 'calendar', label: '일정', icon: '📅', colorClass: 'cat-calendar' };
        }
        if (type === 'weather' || full.includes('날씨') || full.includes('기온') || full.includes('미세먼지') || full.includes('강수')) {
            return { key: 'weather', label: '날씨', icon: '🌤️', colorClass: 'cat-weather' };
        }
        if (['asset', 'economy', 'finance', 'stock'].includes(type) || full.includes('증시') || full.includes('환율') || full.includes('코스피') || full.includes('주가')) {
            return { key: 'finance', label: '금융', icon: '💰', colorClass: 'cat-finance' };
        }
        if (['blood_pressure', 'medication', 'hospital'].includes(type) || full.includes('혈압') || full.includes('복약') || full.includes('병원') || full.includes('약 복용')) {
            return { key: 'health', label: '건강', icon: '🩸', colorClass: 'cat-health' };
        }
        if (['system', 'backup', 'server'].includes(type) || full.includes('서버') || full.includes('백업') || full.includes('경보') || full.includes('다운')) {
            return { key: 'system', label: '시스템', icon: '🖥️', colorClass: 'cat-system' };
        }
        return { key: 'general', label: '일반', icon: '🔔', colorClass: 'cat-general' };
    }

    function renderCategoryChips() {
        const barEl = document.getElementById('notifCategoryBar');
        if (!barEl) return;

        const counts = { all: notifHistoryListItems.length };
        const unreads = { all: 0 };
        NOTIF_CATEGORIES.forEach(c => {
            if (c.key !== 'all') {
                counts[c.key] = 0;
                unreads[c.key] = 0;
            }
        });

        notifHistoryListItems.forEach(item => {
            const cat = getNotificationCategory(item);
            if (counts[cat.key] !== undefined) {
                counts[cat.key]++;
                if (item.is_read === 0) unreads[cat.key]++;
            }
            if (item.is_read === 0) unreads.all++;
        });

        barEl.innerHTML = NOTIF_CATEGORIES.map(cat => {
            const isActive = notifSelectedCategory === cat.key;
            const total = counts[cat.key] || 0;
            const unread = unreads[cat.key] || 0;
            const unreadDot = unread > 0 ? '<span class="notif-cat-unread-dot"></span>' : '';
            return `
                <button type="button" class="notif-cat-chip ${isActive ? 'active' : ''}" onclick="selectNotificationCategory('${cat.key}')">
                    <span>${cat.icon} ${cat.label}</span>
                    ${unreadDot}
                    <span class="notif-cat-badge">${total}</span>
                </button>
            `;
        }).join('');
    }

    window.selectNotificationCategory = function(catKey) {
        notifSelectedCategory = catKey;
        renderCategoryChips();
        renderFilteredNotificationList();
    };

    function renderFilteredNotificationList() {
        const listEl = document.getElementById('notifHistoryList');
        const countLabel = document.getElementById('notifHistoryCountLabel');
        const loadMoreBox = document.getElementById('notifLoadMoreBox');
        if (!listEl) return;

        const filteredItems = notifSelectedCategory === 'all'
            ? notifHistoryListItems
            : notifHistoryListItems.filter(item => getNotificationCategory(item).key === notifSelectedCategory);

        const filteredUnread = filteredItems.filter(i => i.is_read === 0).length;

        if (countLabel) {
            const catName = NOTIF_CATEGORIES.find(c => c.key === notifSelectedCategory)?.label || '전체';
            const unreadText = filteredUnread > 0 ? `, 미확인 ${filteredUnread}건` : '';
            if (notifSelectedCategory === 'all') {
                countLabel.textContent = `전체 알림 (총 ${notifHistoryTotal}건 중 ${filteredItems.length}건${unreadText})`;
            } else {
                countLabel.textContent = `${catName} 알림 (${filteredItems.length}건 / 전체 총 ${notifHistoryTotal}건${unreadText})`;
            }
        }

        if (filteredItems.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 3.5rem 1rem; font-size: 0.9rem;">해당 분류의 알림 내역이 없습니다.</div>';
            if (loadMoreBox) loadMoreBox.style.display = 'none';
            return;
        }

        const cardsHtml = filteredItems.map(item => {
            const cat = getNotificationCategory(item);
            const timeStr = formatNotificationTime(item.created_at);
            const linkUrl = item.url || '#';
            const isUnread = item.is_read === 0;
            const cardClass = isUnread ? 'notif-card-item is-unread' : 'notif-card-item is-read';
            const newBadge = isUnread ? '<span class="notif-badge-new">NEW</span>' : '';
            const safeUrl = linkUrl.replace(/'/g, "\\'");

            return `
                <div class="${cardClass}" id="notif-card-${item.id}" onclick="openAndReadNotification(${item.id}, '${safeUrl}')">
                    <div class="notif-card-header">
                        <span class="notif-card-category-badge ${cat.colorClass}">
                            <span>${cat.icon}</span>
                            <span>${cat.label}</span>
                        </span>
                        <div class="notif-card-meta">
                            <span class="notif-card-time" title="${item.created_at || ''}">${timeStr}</span>
                            ${newBadge}
                        </div>
                    </div>
                    <div class="notif-card-content">
                        <div class="notif-card-title-row">
                            <h4 class="notif-card-title">${escapeHtml(item.title || '알림')}</h4>
                            <div class="notif-more-menu-wrapper" onclick="event.stopPropagation()">
                                <button type="button" class="btn-notif-more" aria-label="메뉴 더보기" onclick="toggleNotifCardMenu(${item.id}, event)" title="더보기">⋮</button>
                                <div class="notif-dropdown-menu" id="notifDropdown-${item.id}">
                                    <button type="button" class="notif-dropdown-btn btn-action-delete" onclick="handleCardDelete(${item.id}, event)">
                                        <span>🗑️</span>
                                        <span>알림 삭제</span>
                                    </button>
                                    <button type="button" class="notif-dropdown-btn btn-action-mute" onclick="handleCardMute('${cat.key}', '${cat.label}', event)">
                                        <span>🔕</span>
                                        <span>${cat.label} 알림 끄기</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p class="notif-card-body">${escapeHtml(item.body || '')}</p>
                    </div>
                </div>
            `;
        }).join('');

        const hasMoreInDb = notifHistoryListItems.length < notifHistoryTotal;
        const endNoticeHtml = hasMoreInDb
            ? `
                <div class="notif-list-end-notice has-more">
                    <div class="notif-end-icon">📄</div>
                    <div class="notif-end-text">현재 불러온 알림 목록의 마지막입니다.</div>
                    <div class="notif-end-sub">이전 알림을 더 확인하시려면 아래 <strong>[+ 이전 알림 더보기]</strong> 메뉴를 눌러주세요.</div>
                </div>
            `
            : `
                <div class="notif-list-end-notice is-complete">
                    <div class="notif-end-icon">✨</div>
                    <div class="notif-end-text">모든 알림을 확인했습니다.</div>
                    <div class="notif-end-sub">수신된 알림의 마지막입니다.</div>
                </div>
            `;

        listEl.innerHTML = cardsHtml + endNoticeHtml;

        if (loadMoreBox) {
            loadMoreBox.style.display = hasMoreInDb ? 'block' : 'none';
            const btn = document.getElementById('btnNotifLoadMore');
            if (btn) {
                btn.textContent = `+ 이전 알림 더보기 (${notifHistoryListItems.length}/${notifHistoryTotal})`;
            }
        }
    }

    // 수신 내역 새로고침
    window.refreshNotificationHistory = function() {
        notifHistoryOffset = 0;
        notifHistoryListItems = [];
        window.fetchNotificationHistory(false);
    };

    // 수신 내역 더보기
    window.loadMoreNotificationHistory = function() {
        notifHistoryOffset += NOTIF_HISTORY_LIMIT;
        window.fetchNotificationHistory(true);
    };

    // 푸시 알림 수신 내역 조회 (API)
    window.fetchNotificationHistory = async function(isAppend = false) {
        const listEl = document.getElementById('notifHistoryList');

        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`, {
                credentials: 'include'
            });
            const data = await res.json();
            const history = data.history || [];
            const unreadCount = data.unreadCount || 0;
            notifHistoryTotal = data.totalCount || 0;

            const updateBadge = (id, cnt) => {
                const b = document.getElementById(id);
                if (b) {
                    b.textContent = cnt;
                    b.style.display = cnt > 0 ? 'inline-block' : 'none';
                }
            };
            updateBadge('unavNotifBadge', unreadCount);
            updateBadge('unavMNotifBadge', unreadCount);
            updateBadge('notifHistoryBadge', unreadCount);

            if (isAppend) {
                notifHistoryListItems = notifHistoryListItems.concat(history);
            } else {
                notifHistoryListItems = history;
            }

            renderCategoryChips();
            renderFilteredNotificationList();

        } catch (e) {
            console.error('[알림 내역 조회 오류]:', e);
            if (listEl) listEl.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 2rem 0; font-size: 0.88rem;">알림 내역을 불러오지 못했습니다.</div>';
        }
    };

    // 전체 읽음 처리 (API)
    window.markAllNotificationsAsRead = async function() {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/read-all`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems.forEach(i => i.is_read = 1);
                renderCategoryChips();
                renderFilteredNotificationList();
                const updateBadge = (bId) => {
                    const b = document.getElementById(bId);
                    if (b) b.style.display = 'none';
                };
                updateBadge('unavNotifBadge');
                updateBadge('unavMNotifBadge');
                updateBadge('notifHistoryBadge');
            } else {
                alert('읽음 처리 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            console.error('전체 읽음 처리 오류:', e);
        }
    };

    // 개별 알림 읽음 처리 후 이동
    window.openAndReadNotification = async function(id, url) {
        try {
            await fetch(`${NOTIF_BASE_URL}/api/notification/history/${id}/read`, {
                method: 'POST',
                credentials: 'include',
                keepalive: true
            });
            const item = notifHistoryListItems.find(i => i.id === id);
            if (item) item.is_read = 1;
            renderCategoryChips();
            renderFilteredNotificationList();
        } catch (e) {
            console.error('Failed to mark read', e);
        }

        const item = notifHistoryListItems.find(i => i.id === id);
        const targetUrl = (url && url !== '#' && !url.startsWith('javascript:'))
            ? url
            : (item && item.url && item.url !== '#' && !item.url.startsWith('javascript:') ? item.url : '');

        if (targetUrl) {
            window.closeNotificationModal();
            window.location.href = targetUrl;
        }
    };

    // 개별 읽음 처리 (UI 즉시 반영)
    window.markSingleAsRead = async function(id) {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/${id}/read`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                const item = notifHistoryListItems.find(i => i.id === id);
                if (item) item.is_read = 1;
                renderCategoryChips();
                renderFilteredNotificationList();

                const currentUnread = parseInt(document.getElementById('unavNotifBadge')?.textContent || '1', 10);
                const newUnread = Math.max(0, currentUnread - 1);
                const updateBadge = (bId, cnt) => {
                    const b = document.getElementById(bId);
                    if (b) {
                        b.textContent = cnt;
                        b.style.display = cnt > 0 ? 'inline-block' : 'none';
                    }
                };
                updateBadge('unavNotifBadge', newUnread);
                updateBadge('unavMNotifBadge', newUnread);
                updateBadge('notifHistoryBadge', newUnread);
            }
        } catch (e) {
            console.error('개별 읽음 처리 오류:', e);
        }
    };

    // 알림 삭제 (API)
    window.deleteNotificationItem = async function(id) {
        if (!confirm('이 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = notifHistoryListItems.filter(i => i.id !== id);
                renderCategoryChips();
                renderFilteredNotificationList();
            } else {
                alert('삭제 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            alert('삭제 중 오류: ' + e.message);
        }
    };

    // 전체 알림 내역 삭제 (API)
    window.clearAllNotificationHistory = async function() {
        if (!confirm('수신된 모든 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/clear/all`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = [];
                renderCategoryChips();
                renderFilteredNotificationList();
            } else {
                alert('전체 삭제 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            alert('전체 삭제 중 오류: ' + e.message);
        }
    };

    // ⋮ 카드 메뉴 열기/닫기 토글
    window.toggleNotifCardMenu = function(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const targetMenu = document.getElementById(`notifDropdown-${id}`);
        const isAlreadyOpen = targetMenu && targetMenu.classList.contains('show');
        window.closeAllNotifMenus();
        if (targetMenu && !isAlreadyOpen) {
            targetMenu.classList.add('show');
        }
    };

    // 모든 열린 카드 메뉴 닫기
    window.closeAllNotifMenus = function() {
        document.querySelectorAll('.notif-dropdown-menu.show').forEach(el => el.classList.remove('show'));
    };

    // 카드 메뉴에서 알림 삭제 클릭
    window.handleCardDelete = function(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.closeAllNotifMenus();
        window.deleteNotificationItem(id);
    };

    // 카드 메뉴에서 카테고리 알림 끄기 클릭
    window.handleCardMute = async function(catKey, catLabel, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.closeAllNotifMenus();

        const label = catLabel || '해당';
        if (!confirm(`'${label}' 관련 알림을 끄시겠습니까?\n('알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.)`)) {
            return;
        }

        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        if (catKey === 'breaking') {
            portalNotifSettings.breaking_news_enabled = 0;
            setCheck('notifBreakingNewsEnabled', false);
        } else if (catKey === 'calendar') {
            portalNotifSettings.hospital_push_enabled = 0;
            setCheck('notifHospitalPushEnabled', false);
        } else if (catKey === 'weather') {
            portalNotifSettings.weather_morning_enabled = 0;
            setCheck('notifWeatherMorningEnabled', false);
        } else if (catKey === 'finance') {
            portalNotifSettings.asset_open_enabled = 0;
            portalNotifSettings.asset_close_enabled = 0;
            portalNotifSettings.asset_report_enabled = 0;
            setCheck('notifAssetOpenEnabled', false);
            setCheck('notifAssetCloseEnabled', false);
            setCheck('notifAssetReportEnabled', false);
        } else if (catKey === 'health') {
            portalNotifSettings.bp_reminder_enabled = 0;
            setCheck('notifBpReminderEnabled', false);
        } else if (catKey === 'system') {
            portalNotifSettings.system_alert_enabled = 0;
            setCheck('notifSystemAlertEnabled', false);
        }

        try {
            await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            alert(`🔕 '${label}' 알림을 껐습니다.\n'알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.`);
        } catch (err) {
            console.error('[알림 음소거 저장 실패]:', err);
            alert('설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    // 상단 마스터 전체 켜기/끄기 스위치
    window.toggleNotifMaster = async function(checked) {
        portalNotifSettings.enabled = checked ? 1 : 0;
        try {
            await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            if (checked) {
                await window.registerWebPushSubscription();
            } else {
                await window.unsubscribeWebPushSubscription();
            }
        } catch (err) {
            console.error('[마스터 알림 스위치 저장 실패]:', err);
        }
    };

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // 내비게이션 바에 알림 항목이 없을 경우 자동 주입 및 보정 (fallback & self-healing)
    function ensureNotificationNavItems() {
        // 1. 데스크톱 내비게이션 메뉴 알림 버튼 보정
        const menu = document.querySelector('.unav-menu');
        if (menu && !document.querySelector('.unav-notif-btn')) {
            const logoutItem = menu.querySelector('.unav-logout-btn')?.closest('.unav-item') || menu.lastElementChild;
            const notifItem = document.createElement('div');
            notifItem.className = 'unav-item';
            notifItem.innerHTML = `
                <button type="button" class="unav-link unav-notif-btn" onclick="handleUnifiedNotifClick(event)" title="통합 알림 센터" style="background: none; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; font-family: inherit; font-size: inherit; color: inherit;">
                    <span style="font-size: 1.15rem; line-height: 1;">🔔</span>
                    <span>알림</span>
                    <span class="unav-notif-badge" id="unavNotifBadge" style="display: none; background: #ef4444; color: white; border-radius: 10px; padding: 1px 6px; font-size: 0.72rem; font-weight: bold; line-height: 1.2;">0</span>
                </button>
            `;
            if (logoutItem) {
                menu.insertBefore(notifItem, logoutItem);
            } else {
                menu.appendChild(notifItem);
            }
        }

        // 2. 모바일 상단 우측 삼선 바 옆 종 아이콘 버튼 보정
        const hamburgerBtn = document.getElementById('unavHamburgerBtn');
        let mobileNotifBtn = document.getElementById('unavMobileNotifBtn');
        if (hamburgerBtn && !mobileNotifBtn) {
            let actionsWrap = hamburgerBtn.closest('.unav-actions');
            if (!actionsWrap) {
                actionsWrap = document.createElement('div');
                actionsWrap.className = 'unav-actions';
                hamburgerBtn.parentNode.insertBefore(actionsWrap, hamburgerBtn);
                actionsWrap.appendChild(hamburgerBtn);
            }
            mobileNotifBtn = document.createElement('button');
            mobileNotifBtn.type = 'button';
            mobileNotifBtn.className = 'unav-mobile-notif-btn';
            mobileNotifBtn.id = 'unavMobileNotifBtn';
            mobileNotifBtn.onclick = window.handleUnifiedNotifClick;
            mobileNotifBtn.setAttribute('aria-label', '통합 알림 센터');
            mobileNotifBtn.setAttribute('title', '통합 알림 센터');
            mobileNotifBtn.innerHTML = `
                <span class="unav-mobile-notif-icon">🔔</span>
                <span class="unav-notif-badge unav-mobile-badge" id="unavMobileNotifBadge" style="display: none;">0</span>
            `;
            actionsWrap.insertBefore(mobileNotifBtn, hamburgerBtn);
        }

        // 3. 모바일 드로어(삼선 메뉴) 내부의 중복 알림 항목 완전히 청소 (제거)
        const mList = document.querySelector('.unav-m-list');
        if (mList) {
            const oldNotifItems = mList.querySelectorAll('.unav-m-notif-btn, #unavMNotifBadge');
            oldNotifItems.forEach(el => {
                const group = el.closest('.unav-m-group');
                if (group) group.remove();
                else el.remove();
            });
            mList.querySelectorAll('.unav-m-group').forEach(group => {
                if (group.textContent && group.textContent.includes('통합 알림 센터')) {
                    group.remove();
                }
            });
        }

        // 4. 혈압 관리 및 뉴스 브리핑 서브메뉴의 불필요한 관리자 링크 자동 정리 (데스크톱 및 모바일)
        document.querySelectorAll('header.unav-header').forEach(header => {
            header.querySelectorAll('a[href*="admin#tab-blood"]').forEach(a => {
                const isUnderBlood = a.closest('[data-nav="blood"]') || a.textContent.includes('관리자 제어 센터') || a.textContent.includes('보안 로그 감시');
                if (isUnderBlood) a.remove();
            });
            header.querySelectorAll('a[href*="admin#tab-news"]').forEach(a => {
                const isUnderNews = a.closest('[data-nav="news"]') || a.textContent.includes('뉴스 수집 관리') || a.textContent.includes('RSS 피드 수집');
                if (isUnderNews) a.remove();
            });
        });
    }

    // 미확인 알림 뱃지 카운트 조회
    function fetchUnreadNotificationBadge() {
        const apiUrl = `${NOTIF_BASE_URL}/api/notification/history?limit=1`;

        fetch(apiUrl, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data && typeof data.unreadCount === 'number') {
                    const cnt = data.unreadCount;
                    const text = cnt > 99 ? '99+' : String(cnt);
                    const badges = document.querySelectorAll('#unavNotifBadge, #unavMobileNotifBadge, #unavMNotifBadge, .unav-notif-badge');
                    badges.forEach(b => {
                        b.textContent = text;
                        b.style.display = cnt > 0 ? 'inline-block' : 'none';
                    });
                }
            })
            .catch(() => {});
    }

    // URL 쿼리스트링에 notif_id 또는 일회용 SSO token이 있을 경우 주소창에서 즉시 클렌징
    function handleNotifIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const notifId = urlParams.get('notif_id');
        const hasSsoToken = urlParams.has('token');
        if (notifId || hasSsoToken) {
            // 🌟 주소창 및 방문 기록에 민감한 토큰이나 알림 ID가 남지 않도록 동기적으로 즉시 제거
            urlParams.delete('notif_id');
            urlParams.delete('token');
            const newQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            const newUrl = window.location.pathname + newQuery + window.location.hash;
            window.history.replaceState({}, document.title, newUrl);
        }

        if (notifId) {
            const apiUrl = `${NOTIF_BASE_URL}/api/notification/history/${notifId}/read`;
            fetch(apiUrl, {
                method: 'POST',
                credentials: 'include',
                keepalive: true
            }).then(() => {
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
        document.body.style.overflow = '';
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

    // 텔레그램 브리핑 시간 추가 버튼 이벤트 위임 (인라인 onclick 실패 대비 100% 동작 보장)
    document.addEventListener('click', function(e) {
        const btn = e.target && (e.target.closest('#btnAddTelegramBriefingTime') || 
                    (e.target.tagName === 'BUTTON' && e.target.getAttribute('onclick') && e.target.getAttribute('onclick').includes('addTelegramBriefingTime')));
        if (btn) {
            e.preventDefault();
            if (typeof window.addTelegramBriefingTime === 'function') {
                window.addTelegramBriefingTime();
            }
        }
    });

    // DOM 준비 시 마운트 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountUnifiedNav);
    } else {
        mountUnifiedNav();
    }
})();
