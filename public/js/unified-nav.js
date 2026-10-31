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
        const mBtn = document.getElementById('btnPwaInstallMobile');
        if (mBtn) mBtn.style.display = 'flex';
        const dBtn = document.getElementById('btnPwaInstall');
        if (dBtn) dBtn.style.display = 'inline-flex';
    });
    window.triggerPwaInstall = async function() {
        if (window.deferredInstallPrompt) {
            window.deferredInstallPrompt.prompt();
            const { outcome } = await window.deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') localStorage.setItem('pwa_installed', 'true');
            window.deferredInstallPrompt = null;
        } else {
            alert('스마트폰(Android/Chrome, iOS/Safari) 또는 브라우저의 [공유] 또는 [메뉴(⋮)] > [홈 화면에 추가] 또는 [앱 설치]를 선택해 설치할 수 있습니다.');
        }
    };

    const UNAV_VERSION = window.__JG_UI_VERSION__ || '20261031_162658';
    const CACHE_KEY_HTML = 'jg_unav_html', CACHE_KEY_VER = 'jg_unav_ver', CACHE_KEY_TIME = 'jg_unav_time';
    const STALE_CHECK_INTERVAL = 5 * 60 * 1000;
    const NOTIF_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://j-jg.cc';

    // 🛡️ [Android WebAPK / App Links 가로채기 방지 가드]
    (function initBrowserLinkIntentGuard() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || document.referrer.includes('android-app://');
        if (isStandalone) return;

        document.addEventListener('click', function(e) {
            const link = e.target && e.target.closest('a[href]');
            if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

            const rawHref = link.getAttribute('href');
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

            let targetUrl;
            try { targetUrl = new URL(link.href, window.location.href); } catch (err) { return; }

            const isFamilySite = targetUrl.hostname === 'j-jg.cc' || targetUrl.hostname.endsWith('.j-jg.cc') || targetUrl.hostname === 'localhost';
            if (!isFamilySite) return;

            if (targetUrl.origin === window.location.origin && targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search && targetUrl.hash) return;

            e.preventDefault();
            if (typeof window.closeUnavDrawer === 'function') window.closeUnavDrawer();

            const dest = targetUrl.href;
            setTimeout(() => { window.location.href = dest; }, 10);
        }, true);
    })();

    // 1. 공통 CSS 스타일시트 및 서브 모듈 자동 주입 확인
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
                html.hide-blood [data-service="blood"], html.hide-asset [data-service="asset"], html.hide-ops [data-service="ops"], html.role-pending [data-service="blood"], html.role-pending [data-service="asset"], html.role-pending [data-service="ops"] { display: none !important; }
            `;
            (document.head || document.documentElement).appendChild(style);
        }
        const baseUrl = isLocal ? '' : 'https://j-jg.cc';
        const addLink = (href) => {
            const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
        };
        if (!document.querySelector('link[href*="pretendard.css"]')) addLink(`${baseUrl}/css/pretendard.css?v=${UNAV_VERSION}`);
        if (!document.querySelector('link[href*="unified-nav.css"]')) addLink(`${baseUrl}/css/unified-nav.css?v=${UNAV_VERSION}`);

        ['unified-nav-push.js', 'unified-nav-modal.js', 'unified-nav-history.js'].forEach(scriptName => {
            if (!document.querySelector(`script[src*="${scriptName}"]`)) {
                const s = document.createElement('script');
                s.src = `${baseUrl}/js/${scriptName}?v=${UNAV_VERSION}`;
                s.defer = true;
                (document.head || document.documentElement).appendChild(s);
            }
        });
    }

    function isPortalMainPage() {
        const host = window.location.hostname;
        const path = window.location.pathname;
        const isPortalHost = (host === 'j-jg.cc' || host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.'));
        return (isPortalHost && (path === '/' || path === '/index.html')) || !!document.getElementById('portal-tab-bar');
    }

    // 2. 상단 내비게이션 HTML 컴포넌트 비동기 로드 및 마운트 (localStorage SWR 캐싱)
    async function mountUnifiedNav() {
        ensureUnifiedNavCss();

        if (isPortalMainPage()) {
            const existingNav = document.getElementById('unified-nav-root') || document.getElementById('unavRoot') || document.querySelector('header.unav-header');
            if (existingNav) existingNav.remove();
            const existingDrawer = document.getElementById('unavDrawer');
            if (existingDrawer) existingDrawer.remove();
            initUnifiedNav();
            return;
        }

        let cachedHtml = null, cachedVer = null, cachedTime = 0;
        try {
            cachedHtml = localStorage.getItem(CACHE_KEY_HTML);
            cachedVer = localStorage.getItem(CACHE_KEY_VER);
            cachedTime = parseInt(localStorage.getItem(CACHE_KEY_TIME) || '0', 10);
            const isLegacy = cachedHtml && (!cachedHtml.includes('notif-category-bar') || !cachedHtml.includes('/go/blood') || !cachedHtml.includes('혈압·건강·약'));
            if (cachedVer !== UNAV_VERSION || isLegacy) {
                localStorage.removeItem(CACHE_KEY_HTML);
                localStorage.removeItem(CACHE_KEY_VER);
                localStorage.removeItem(CACHE_KEY_TIME);
                cachedHtml = null; cachedVer = null;
            }
        } catch (e) {}

        const applyHtml = (html) => {
            let target = document.getElementById('unified-nav-root') || document.getElementById('unavRoot') || document.querySelector('header.unav-header');
            if (target) {
                const oldDrawer = document.getElementById('unavDrawer');
                if (oldDrawer && oldDrawer.parentNode !== target) oldDrawer.remove();
                document.querySelectorAll('#notificationModal').forEach(m => { if (m.parentNode !== target) m.remove(); });
                target.outerHTML = html;
            } else if (document.body) {
                document.querySelectorAll('#notificationModal').forEach(m => m.remove());
                document.body.insertAdjacentHTML('afterbegin', html);
            }
        };

        const hasValidCache = cachedHtml && cachedVer === UNAV_VERSION;
        if (hasValidCache) {
            applyHtml(cachedHtml);
            optimizeInternalNavLinks();
            highlightActiveMenu();
            initUnifiedNav();
        }

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

        optimizeInternalNavLinks();
        highlightActiveMenu();
        initUnifiedNav();
    }

    // 현재 접속 중인 서비스 내부 링크 최적화
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
                link.href = targetPath || ((currentService === 'asset') ? '#tab-home' : '/');
            } catch (e) {}
        });

        document.querySelectorAll('.unav-header a[href^="#tab-"]').forEach(link => {
            if (link.__unavHashBound) return;
            link.__unavHashBound = true;
            link.addEventListener('click', function() {
                const targetHash = this.getAttribute('href');
                if (targetHash && targetHash.startsWith('#')) {
                    const tabId = targetHash.slice(1);
                    if (typeof window.switchTab === 'function') setTimeout(() => window.switchTab(tabId), 0);
                }
            });
        });
    }

    // 현재 접속 페이지에 따른 메뉴 하이라이트
    function highlightActiveMenu() {
        const host = window.location.hostname, path = window.location.pathname;
        let activeKey = 'home';

        if (host.includes('blood') || path.includes('/go/blood') || path.includes('hospital') || path.includes('report')) activeKey = 'blood';
        else if (host.includes('asset') || path.includes('/go/asset')) activeKey = 'asset';
        else if (host.includes('news') || path.includes('/go/news') || path.includes('weather') || path.includes('breaking') || path.includes('economy')) activeKey = 'news';
        else if (path.includes('admin')) activeKey = 'admin';
        else if (path.includes('calendar')) activeKey = 'calendar';
        else if (path.includes('memo')) activeKey = 'memo';
        else if (host === 'j-jg.cc' || host === 'localhost') activeKey = 'home';

        document.querySelectorAll('.unav-link[data-nav]').forEach(el => el.classList.toggle('active', el.getAttribute('data-nav') === activeKey));
        document.querySelectorAll('.unav-m-group[data-nav]').forEach(group => {
            const btn = group.querySelector('.unav-m-title');
            const isMatch = group.getAttribute('data-nav') === activeKey;
            group.classList.toggle('expanded', isMatch);
            if (btn) btn.classList.toggle('active', isMatch);
        });
    }

    // 🛡️ 권한 기반 상단 내비바 메뉴 마스킹
    function applyUnifiedNavPermissions() {
        try {
            const c = document.cookie || '';
            let role = '', allowed = '';
            const mRole = c.match(/(?:^|;\s*)jg_user_role=([^;]*)/);
            if (mRole) role = decodeURIComponent(mRole[1]);
            else role = localStorage.getItem('jg_user_role') || '';
            const mAllowed = c.match(/(?:^|;\s*)jg_allowed_services=([^;]*)/);
            if (mAllowed) allowed = decodeURIComponent(mAllowed[1]);
            else allowed = localStorage.getItem('jg_allowed_services') || '';

            const applyDom = (r, a) => {
                if (r === 'family') {
                    document.documentElement.classList.add('role-family', 'hide-ops');
                    if (a.indexOf('blood') === -1) {
                        document.documentElement.classList.add('hide-blood');
                        document.querySelectorAll('[data-service="blood"]').forEach(el => el.style.setProperty('display', 'none', 'important'));
                    }
                    if (a.indexOf('asset') === -1) {
                        document.documentElement.classList.add('hide-asset');
                        document.querySelectorAll('[data-service="asset"]').forEach(el => el.style.setProperty('display', 'none', 'important'));
                    }
                    document.querySelectorAll('[data-service="ops"]').forEach(el => el.style.setProperty('display', 'none', 'important'));
                } else if (r === 'admin') {
                    document.documentElement.classList.remove('hide-blood', 'hide-asset', 'hide-ops');
                    document.documentElement.classList.add('role-admin');
                }
            };
            applyDom(role, allowed);

            fetch(`${NOTIF_BASE_URL}/api/me`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data && data.success) {
                        const newRole = data.role || 'family';
                        const newAllowed = (data.allowedServices || []).join(',');
                        try {
                            localStorage.setItem('jg_user_role', newRole);
                            localStorage.setItem('jg_allowed_services', newAllowed);
                        } catch (e) {}
                        applyDom(newRole, newAllowed);
                    }
                }).catch(() => {});
        } catch (e) {}
    }

    // 내비게이션 바에 알림 항목이 없을 경우 자동 주입 및 보정
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
                    <span class="unav-notif-badge" id="unavNotifBadge" style="display: none; background: #ef4444; color: white; border-radius: 10px; padding: 1px 6px; font-size: 0.72rem; font-weight: bold; line-height: 1.2;">0</span>
                </button>
            `;
            if (logoutItem) menu.insertBefore(notifItem, logoutItem);
            else menu.appendChild(notifItem);
        }

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

        const mList = document.querySelector('.unav-m-list');
        if (mList) {
            mList.querySelectorAll('.unav-m-notif-btn, #unavMNotifBadge').forEach(el => {
                const group = el.closest('.unav-m-group');
                if (group) group.remove();
                else el.remove();
            });
            mList.querySelectorAll('.unav-m-group').forEach(group => {
                if (group.textContent && group.textContent.includes('통합 알림 센터')) group.remove();
            });
        }
    }

    function fetchUnreadBadge() {
        if (typeof window.fetchUnreadNotificationBadge === 'function') {
            window.fetchUnreadNotificationBadge();
        } else {
            fetch(`${NOTIF_BASE_URL}/api/notification/history?limit=1`, { credentials: 'include' })
                .then(r => r.json())
                .then(d => {
                    if (d && typeof d.unreadCount === 'number') {
                        const cnt = d.unreadCount;
                        const txt = cnt > 99 ? '99+' : String(cnt);
                        document.querySelectorAll('#unavNotifBadge, #unavMobileNotifBadge, #unavMNotifBadge, .unav-notif-badge').forEach(b => {
                            b.textContent = txt;
                            b.style.display = cnt > 0 ? 'inline-block' : 'none';
                        });
                    }
                }).catch(() => {});
        }
    }

    function handleNotifIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const notifId = urlParams.get('notif_id');
        const hasSsoToken = urlParams.has('token');
        if (notifId || hasSsoToken) {
            urlParams.delete('notif_id');
            urlParams.delete('token');
            const newQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            const newUrl = window.location.pathname + newQuery + window.location.hash;
            window.history.replaceState({}, document.title, newUrl);
        }
        if (notifId) {
            fetch(`${NOTIF_BASE_URL}/api/notification/history/${notifId}/read`, {
                method: 'POST', credentials: 'include', keepalive: true
            }).then(() => fetchUnreadBadge()).catch(() => {});
        }
    }

    // 4. 내비게이션 바 인터랙션 및 알림 연동
    function initUnifiedNav() {
        const btn = document.getElementById('unavHamburgerBtn');
        const drawer = document.getElementById('unavDrawer');

        ensureNotificationNavItems();
        applyUnifiedNavPermissions();

        fetchUnreadBadge();
        if (!window.__unavBadgeTimer) {
            window.__unavBadgeTimer = setInterval(fetchUnreadBadge, 60000);
        }

        handleNotifIdFromUrl();

        if ('Notification' in window && typeof window.getDevicePushMetadata === 'function') {
            const meta = window.getDevicePushMetadata();
            const isInstalledApp = meta.deviceType !== 'mobile' || meta.clientType === 'pwa' || meta.clientType === 'apk';
            if (isInstalledApp) {
                setTimeout(() => {
                    if (typeof window.registerWebPushSubscription === 'function') window.registerWebPushSubscription();
                }, 1000);
            }
        }

        if (!btn || !drawer) return;

        btn.onclick = function(e) {
            e.stopPropagation();
            const isOpen = drawer.classList.contains('open');
            drawer.classList.toggle('open', !isOpen);
            btn.classList.toggle('open', !isOpen);
            btn.setAttribute('aria-expanded', String(!isOpen));
            document.body.style.overflow = !isOpen ? 'hidden' : '';
        };
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.unav-header') && drawer.classList.contains('open')) window.closeUnavDrawer();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drawer.classList.contains('open')) window.closeUnavDrawer();
        });
        drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', () => window.closeUnavDrawer()));

        if (!window.__unavLogoutListenerBound) {
            window.__unavLogoutListenerBound = true;
            document.addEventListener('click', function(e) {
                if (e.__unavLogoutHandled) return;
                const logoutLink = e.target.closest('.unav-logout-btn, .unav-m-logout-btn');
                if (logoutLink) {
                    e.__unavLogoutHandled = true;
                    e.preventDefault(); e.stopPropagation();
                    if (typeof window.openLogoutModal === 'function' && document.getElementById('logoutModal')) {
                        window.openLogoutModal(e);
                    } else if (confirm('정말 로그아웃 할까요?')) {
                        window.location.href = logoutLink.href || '/logout';
                    }
                }
            }, true);
        }

        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'notificationModal' && typeof window.closeNotificationModal === 'function') {
                window.closeNotificationModal();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('notificationModal');
                if (modal && (modal.classList.contains('open') || modal.style.display === 'flex')) {
                    if (typeof window.closeNotificationModal === 'function') window.closeNotificationModal();
                }
            }
        });
        window.toggleNotifInfoTooltip = function(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            const wrapper = document.getElementById('notifInfoTooltipWrapper');
            if (wrapper) wrapper.classList.toggle('active');
        };
        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('notifInfoTooltipWrapper');
            if (wrapper && !wrapper.contains(e.target)) wrapper.classList.remove('active');
            if (!e.target.closest('.notif-more-menu-wrapper') && typeof window.closeAllNotifMenus === 'function') {
                window.closeAllNotifMenus();
            }
        });
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('open') === 'notification' || window.location.hash === '#notification') {
            setTimeout(() => { if (typeof window.openNotificationModal === 'function') window.openNotificationModal(); }, 200);
            urlParams.delete('open');
            const cleanQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            const cleanHash = window.location.hash === '#notification' ? '' : window.location.hash;
            window.history.replaceState({}, document.title, window.location.pathname + cleanQuery + cleanHash);
        }
    }

    window.closeUnavDrawer = function() {
        const drawer = document.getElementById('unavDrawer');
        const btn = document.getElementById('unavHamburgerBtn');
        if (drawer) drawer.classList.remove('open');
        if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
        document.body.style.overflow = '';
    };

    window.toggleUnavAccordion = function(button) {
        const group = button.closest('.unav-m-group');
        if (!group) return;
        const isExpanded = group.classList.contains('expanded');
        document.querySelectorAll('.unav-m-group').forEach(g => { if (g !== group) g.classList.remove('expanded'); });
        group.classList.toggle('expanded', !isExpanded);
    };

    document.addEventListener('click', (e) => {
        const btn = e.target && (e.target.closest('#btnAddTelegramBriefingTime') || (e.target.tagName === 'BUTTON' && e.target.getAttribute('onclick') && e.target.getAttribute('onclick').includes('addTelegramBriefingTime')));
        if (btn) {
            e.preventDefault();
            if (typeof window.addTelegramBriefingTime === 'function') window.addTelegramBriefingTime();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountUnifiedNav);
    } else {
        mountUnifiedNav();
    }
})();
