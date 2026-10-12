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

    // 1. 공통 CSS 스타일시트 자동 주입 확인
    function ensureUnifiedNavCss() {
        if (!document.querySelector('link[href*="unified-nav.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            const isLocal = window.location.hostname === 'localhost';
            link.href = (isLocal ? '/css/unified-nav.css' : 'https://j-jg.cc/css/unified-nav.css') + '?v=20261013_v4';
            document.head.appendChild(link);
        }
    }

    // 2. 상단 내비게이션 HTML 컴포넌트 비동기 로드 및 마운트 (SWR 패턴: 항상 최신 통합 컴포넌트 유지)
    async function mountUnifiedNav() {
        ensureUnifiedNavCss();

        const CACHE_KEY = 'jg_unav_html_v20261013_v4';
        let cachedHtml = null;
        try {
            cachedHtml = sessionStorage.getItem(CACHE_KEY);
        } catch (e) {}

        const applyHtml = (html) => {
            let target = document.getElementById('unified-nav-root') || 
                         document.getElementById('unavRoot') || 
                         document.querySelector('header.unav-header');

            if (target) {
                const oldDrawer = document.getElementById('unavDrawer');
                if (oldDrawer && oldDrawer.parentNode !== target) oldDrawer.remove();
                const oldModal = document.getElementById('notificationModal');
                if (oldModal && oldModal.parentNode !== target) oldModal.remove();
                target.outerHTML = html;
            } else if (document.body) {
                const oldModal = document.getElementById('notificationModal');
                if (oldModal) oldModal.remove();
                document.body.insertAdjacentHTML('afterbegin', html);
            }
        };

        // 1) 캐시가 있으면 즉시 렌더링 (0ms 레이턴시)
        if (cachedHtml) {
            applyHtml(cachedHtml);
            highlightActiveMenu();
            initUnifiedNav();
        }

        // 2) 최신 컴포넌트를 네트워크로 로드하여 항상 동기화 유지
        try {
            const isLocal = window.location.hostname === 'localhost';
            const compUrl = (isLocal ? '/components/unified-nav.html' : 'https://j-jg.cc/components/unified-nav.html') + '?v=20261013_v4';
            const res = await fetch(compUrl);
            if (res.ok) {
                const html = await res.text();
                if (html !== cachedHtml || !cachedHtml) {
                    applyHtml(html);
                    try {
                        sessionStorage.setItem(CACHE_KEY, html);
                    } catch (e) {}
                    highlightActiveMenu();
                    initUnifiedNav();
                }
            }
        } catch (err) {
            console.warn('[UnifiedNav] 동적 컴포넌트 로드 실패:', err);
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

        // 모달 배경 클릭 시 닫기 이벤트
        document.addEventListener('click', function(e) {
            if (e.target && e.target.id === 'notificationModal') {
                window.closeNotificationModal();
            }
        });

        // URL 쿼리 또는 해시(?open=notification, #notification)로 유입 시 모달 자동 열기
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('open') === 'notification' || window.location.hash === '#notification') {
            setTimeout(function() {
                window.openNotificationModal();
            }, 300);
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

    // 알림 모달 열기 (미발견 시 자동 마운트 Self-Healing 보장)
    window.openNotificationModal = async function() {
        let modal = document.getElementById('notificationModal');
        if (!modal) {
            console.log('[UnifiedNav] notificationModal 미발견 -> 실시간 마운트 시도...');
            try {
                const isLocal = window.location.hostname === 'localhost';
                const compUrl = (isLocal ? '/components/unified-nav.html' : 'https://j-jg.cc/components/unified-nav.html') + '?v=' + Date.now();
                const res = await fetch(compUrl);
                if (res.ok) {
                    const html = await res.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    const fetchedModal = doc.getElementById('notificationModal');
                    if (fetchedModal) {
                        document.body.appendChild(fetchedModal);
                        modal = fetchedModal;
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
        if (modal) modal.style.display = 'none';
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

        renderBox('containerWeekdayMedTimes', portalNotifSettings.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', portalNotifSettings.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', portalNotifSettings.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', portalNotifSettings.weekend_bp_times, 'weekend_bp_times');
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
        portalNotifSettings.asset_report_enabled = getCheck('notifAssetReportEnabled');
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

    // VAPID 키 및 푸시 매니저 구독 등록 (API)
    window.registerWebPushSubscription = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        if (Notification.permission !== 'granted') return;

        try {
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

            await fetch(`${NOTIF_BASE_URL}/api/notification/subscribe`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub })
            });
            console.log('✅ 포털 웹 푸시 구독 토큰 등록 완료');
        } catch (e) {
            console.error('[푸시 구독 등록 실패]:', e);
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
        const loadMoreBox = document.getElementById('notifLoadMoreBox');
        const countLabel = document.getElementById('notifHistoryCountLabel');

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

            if (countLabel) {
                countLabel.textContent = `알림 내역 (${notifHistoryListItems.length}/${notifHistoryTotal}건, 미확인 ${unreadCount}건)`;
            }

            if (!listEl) return;
            if (notifHistoryListItems.length === 0) {
                listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 2.5rem 0; font-size: 0.88rem;">수신된 푸시 알림 내역이 없습니다.</div>';
                if (loadMoreBox) loadMoreBox.style.display = 'none';
                return;
            }

            const typeIconMap = {
                'breaking': '🚨',
                'weather': '🌤️',
                'asset': '💰',
                'blood_pressure': '🩸',
                'medication': '💊',
                'hospital': '🏥',
                'system': '🖥️',
                'test': '🔔'
            };

            listEl.innerHTML = notifHistoryListItems.map(item => {
                const icon = typeIconMap[item.type] || item.icon || '🔔';
                const timeStr = item.created_at ? item.created_at.replace('T', ' ').slice(5, 16) : '';
                const linkUrl = item.url || '#';
                const isUnread = item.is_read === 0;
                const cardClass = isUnread ? 'notif-history-card is-unread' : 'notif-history-card is-read';
                const newBadge = isUnread ? '<span class="badge-unread-dot">NEW</span>' : '';

                return `
                    <div class="${cardClass}" id="notif-card-${item.id}">
                        <span class="notif-h-icon">${icon}</span>
                        <div class="notif-h-body">
                            <div class="notif-h-top">
                                <div style="display: flex; align-items: center; gap: 0.35rem; min-width: 0;">
                                    ${newBadge}
                                    <span class="notif-h-title">${item.title || '알림'}</span>
                                </div>
                                <span class="notif-h-time">${timeStr}</span>
                            </div>
                            <p class="notif-h-msg">${item.body || ''}</p>
                            <div class="notif-h-actions">
                                <button type="button" class="notif-h-btn-link" onclick="openAndReadNotification(${item.id}, '${linkUrl}')">바로가기 ↗</button>
                                ${isUnread ? `<button type="button" class="notif-h-btn-link" style="color: #64748b; background: #f1f5f9;" onclick="markSingleAsRead(${item.id})">읽음</button>` : ''}
                                <button type="button" class="notif-h-btn-del" onclick="deleteNotificationItem(${item.id})" title="삭제">🗑️ 삭제</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (loadMoreBox) {
                loadMoreBox.style.display = notifHistoryListItems.length < notifHistoryTotal ? 'block' : 'none';
            }

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
                window.refreshNotificationHistory();
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
        } catch (e) {
            console.error('Failed to mark read', e);
        }

        if (url && url !== '#') {
            window.location.href = url;
        } else {
            window.markSingleAsRead(id);
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
                const card = document.getElementById(`notif-card-${id}`);
                if (card) {
                    card.classList.remove('is-unread');
                    card.classList.add('is-read');
                    const newBadge = card.querySelector('.badge-unread-dot');
                    if (newBadge) newBadge.remove();
                }
                const item = notifHistoryListItems.find(i => i.id === id);
                if (item) item.is_read = 1;

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
                window.refreshNotificationHistory();
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
                window.fetchNotificationHistory(false);
            } else {
                alert('전체 삭제 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            alert('전체 삭제 중 오류: ' + e.message);
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

    // URL 쿼리스트링에 notif_id가 있을 경우 즉시 읽음 처리 및 주소창 정리
    function handleNotifIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const notifId = urlParams.get('notif_id');
        if (notifId) {
            const apiUrl = `${NOTIF_BASE_URL}/api/notification/history/${notifId}/read`;

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
