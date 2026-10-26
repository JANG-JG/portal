/**
 * 🔔 JG 통합 상단 내비게이션 - 통합 알림 센터 모달 컨트롤러
 * - 알림 모달 열기/닫기, 탭 전환
 * - 알림 맞춤 설정 CRUD 및 발송 시간표 관리
 * - 마스터 알림 스위치 토글
 */
(function() {
    const NOTIF_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://j-jg.cc';
    window.NOTIF_BASE_URL = NOTIF_BASE_URL;

    window.portalNotifSettings = window.portalNotifSettings || {
        enabled: 1,
        album_push_enabled: 1,
        album_new_photo_enabled: 1,
        album_comment_enabled: 1,
        album_mention_enabled: 1,
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

    // 🔔 알림 버튼 클릭 시 현재 페이지에서 모달 즉시 오픈
    window.handleUnifiedNotifClick = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (typeof window.closeUnavDrawer === 'function') window.closeUnavDrawer();
        window.openNotificationModal();
    };

    // 🎨 사이트 특성 능동 감지 및 다크징크 테마 적용 엔진
    window.applyNotifAdaptiveTheme = function(modal) {
        if (!modal) modal = document.getElementById('notificationModal');
        if (!modal) return;

        const htmlEl = document.documentElement;
        const bodyEl = document.body;

        const isPortalMain = window.location.pathname === '/' || 
                             window.location.pathname === '/index.html' ||
                             document.querySelector('.cmd-navbar') !== null ||
                             document.getElementById('portal-tab-bar') !== null;

        const hasDarkClass = htmlEl.classList.contains('dark') || 
                              bodyEl.classList.contains('dark') ||
                              htmlEl.getAttribute('data-theme') === 'dark' ||
                              bodyEl.getAttribute('data-theme') === 'dark';

        const hasDarkMeta = !!document.querySelector('meta[name="color-scheme"][content*="dark"]') ||
                            (function() {
                                const metaTheme = document.querySelector('meta[name="theme-color"]');
                                if (!metaTheme) return false;
                                const content = (metaTheme.getAttribute('content') || '').toLowerCase();
                                return ['#09090b', '#000000', '#121215', '#18181b', '#1e1e24'].includes(content);
                            })();

        let isDarkBg = false;
        try {
            if (bodyEl) {
                const bg = window.getComputedStyle(bodyEl).backgroundColor;
                const rgb = bg.match(/\d+/g);
                if (rgb && rgb.length >= 3) {
                    const brightness = (Number(rgb[0]) * 299 + Number(rgb[1]) * 587 + Number(rgb[2]) * 114) / 1000;
                    if (brightness < 128) isDarkBg = true;
                }
            }
        } catch (e) {}

        const isDark = isPortalMain || hasDarkClass || hasDarkMeta || isDarkBg;
        if (isDark) {
            modal.classList.add('dark-zinc', 'theme-dark');
        } else {
            modal.classList.remove('dark-zinc', 'theme-dark');
        }
    };

    // 알림 모달 열기 (미발견 또는 구버전 시 자동 마운트 Self-Healing 보장)
    window.openNotificationModal = async function() {
        let modal = document.getElementById('notificationModal');
        if (modal && !modal.querySelector('.notif-category-bar')) {
            modal.remove();
            modal = null;
        }

        if (!modal) {
            console.log('[UnifiedNav] notificationModal 미발견 또는 구버전 교체 -> 최신 컴포넌트 마운트 시도...');
            try {
                const localHtml = localStorage.getItem('jg_unav_html');
                if (localHtml && localHtml.includes('notif-category-bar')) {
                    const temp = document.createElement('div');
                    temp.innerHTML = localHtml;
                    const cachedModal = temp.querySelector('#notificationModal');
                    if (cachedModal) {
                        document.body.appendChild(cachedModal);
                        modal = cachedModal;
                    }
                }

                if (!modal) {
                    const isLocal = window.location.hostname === 'localhost';
                    const uVer = window.__JG_UI_VERSION__ || '20261025_203906';
                    const compUrl = (isLocal ? '/components/unified-nav.html' : 'https://j-jg.cc/components/unified-nav.html') + '?v=' + uVer;
                    const res = await fetch(compUrl);
                    if (res.ok) {
                        const html = await res.text();
                        try {
                            localStorage.setItem('jg_unav_html', html);
                            localStorage.setItem('jg_unav_ver', uVer);
                            localStorage.setItem('jg_unav_time', String(Date.now()));
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
        window.applyNotifAdaptiveTheme(modal);
        modal.classList.add('open');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        window.switchNotifMainTab('history');
        if (typeof window.updateBrowserPermissionUI === 'function') {
            window.updateBrowserPermissionUI();
        }
        window.fetchNotificationSettings();
        if (typeof window.fetchNotificationHistory === 'function') {
            window.fetchNotificationHistory(false);
        }
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

        if (!isSettings && typeof window.fetchNotificationHistory === 'function') {
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

    // 알림 설정 데이터 조회 (API)
    window.fetchNotificationSettings = async function() {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, { credentials: 'include' });
            const data = await res.json();
            if (data.success && data.settings) {
                window.portalNotifSettings = data.settings;
                const setCheck = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.checked = Boolean(val !== 0);
                };
                setCheck('notifMasterEnabled', window.portalNotifSettings.enabled);
                setCheck('notifAlbumPushEnabled', window.portalNotifSettings.album_push_enabled);
                setCheck('notifAlbumNewPhotoEnabled', window.portalNotifSettings.album_new_photo_enabled);
                setCheck('notifAlbumCommentEnabled', window.portalNotifSettings.album_comment_enabled);
                setCheck('notifAlbumMentionEnabled', window.portalNotifSettings.album_mention_enabled);
                setCheck('notifBreakingNewsEnabled', window.portalNotifSettings.breaking_news_enabled);
                setCheck('notifWeatherMorningEnabled', window.portalNotifSettings.weather_morning_enabled);
                setCheck('notifAssetReportEnabled', window.portalNotifSettings.asset_report_enabled);
                const isOpenOn = window.portalNotifSettings.asset_open_enabled !== undefined ? window.portalNotifSettings.asset_open_enabled : window.portalNotifSettings.asset_report_enabled;
                const isCloseOn = window.portalNotifSettings.asset_close_enabled !== undefined ? window.portalNotifSettings.asset_close_enabled : window.portalNotifSettings.asset_report_enabled;
                setCheck('notifAssetOpenEnabled', isOpenOn);
                setCheck('notifAssetCloseEnabled', isCloseOn);
                setCheck('notifBpReminderEnabled', window.portalNotifSettings.bp_reminder_enabled);
                setCheck('notifHospitalPushEnabled', window.portalNotifSettings.hospital_push_enabled);
                setCheck('notifSystemAlertEnabled', window.portalNotifSettings.system_alert_enabled);

                const setVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el && val) el.value = val;
                };
                setVal('inputWeatherTime', window.portalNotifSettings.weather_morning_time || '07:00');
                setVal('inputBpReminderTime', window.portalNotifSettings.bp_reminder_time || '21:00');

                window.renderNotifChips();
            }
        } catch (e) {
            console.error('[포털 알림 설정 조회 실패]:', e);
        }
    };

    // 옵션 동기화 헬퍼들
    window.toggleAlbumSubOptions = function(checked) {
        ['notifAlbumNewPhotoEnabled', 'notifAlbumCommentEnabled', 'notifAlbumMentionEnabled'].forEach(id => {
            const el = document.getElementById(id); if (el) el.checked = checked;
        });
    };

    window.handleAlbumSubOptionChange = function() {
        const pEl = document.getElementById('notifAlbumNewPhotoEnabled');
        const cEl = document.getElementById('notifAlbumCommentEnabled');
        const mEl = document.getElementById('notifAlbumMentionEnabled');
        const aEl = document.getElementById('notifAlbumPushEnabled');
        if (aEl) aEl.checked = (pEl && pEl.checked) || (cEl && cEl.checked) || (mEl && mEl.checked);
    };

    window.toggleAssetSubOptions = function(checked) {
        const openEl = document.getElementById('notifAssetOpenEnabled');
        const closeEl = document.getElementById('notifAssetCloseEnabled');
        if (openEl) openEl.checked = checked;
        if (closeEl) closeEl.checked = checked;
    };

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

        renderBox('containerTelegramBriefingTimes', window.portalNotifSettings.telegram_briefing_times, 'telegram_briefing_times');
        renderBox('containerWeekdayMedTimes', window.portalNotifSettings.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', window.portalNotifSettings.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', window.portalNotifSettings.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', window.portalNotifSettings.weekend_bp_times, 'weekend_bp_times');
    };

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
        if (!window.portalNotifSettings.telegram_briefing_times) {
            window.portalNotifSettings.telegram_briefing_times = [];
        }
        if (window.portalNotifSettings.telegram_briefing_times.includes(val)) {
            alert('이미 등록된 브리핑 시간입니다: ' + val);
            return;
        }
        window.portalNotifSettings.telegram_briefing_times.push(val);
        window.portalNotifSettings.telegram_briefing_times.sort();
        inputEl.value = '';
        window.renderNotifChips();
    };

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
        if (!window.portalNotifSettings[key]) window.portalNotifSettings[key] = [];
        if (window.portalNotifSettings[key].includes(val)) {
            alert('이미 등록된 시간입니다.');
            return;
        }
        window.portalNotifSettings[key].push(val);
        window.portalNotifSettings[key].sort();
        inputEl.value = '';
        window.renderNotifChips();
    };

    window.removeNotifTime = function(key, index) {
        if (window.portalNotifSettings[key]) {
            window.portalNotifSettings[key].splice(index, 1);
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

        window.portalNotifSettings.enabled = getCheck('notifMasterEnabled');
        window.portalNotifSettings.album_new_photo_enabled = getCheck('notifAlbumNewPhotoEnabled');
        window.portalNotifSettings.album_comment_enabled = getCheck('notifAlbumCommentEnabled');
        window.portalNotifSettings.album_mention_enabled = getCheck('notifAlbumMentionEnabled');
        window.portalNotifSettings.album_push_enabled = (window.portalNotifSettings.album_new_photo_enabled || window.portalNotifSettings.album_comment_enabled || window.portalNotifSettings.album_mention_enabled) ? 1 : getCheck('notifAlbumPushEnabled');
        window.portalNotifSettings.breaking_news_enabled = getCheck('notifBreakingNewsEnabled');
        window.portalNotifSettings.weather_morning_enabled = getCheck('notifWeatherMorningEnabled');
        window.portalNotifSettings.weather_morning_time = getVal('inputWeatherTime', '07:00');
        
        window.portalNotifSettings.asset_open_enabled = getCheck('notifAssetOpenEnabled');
        window.portalNotifSettings.asset_close_enabled = getCheck('notifAssetCloseEnabled');
        window.portalNotifSettings.asset_report_enabled = (window.portalNotifSettings.asset_open_enabled || window.portalNotifSettings.asset_close_enabled) ? 1 : getCheck('notifAssetReportEnabled');
        
        window.portalNotifSettings.bp_reminder_enabled = getCheck('notifBpReminderEnabled');
        window.portalNotifSettings.bp_reminder_time = getVal('inputBpReminderTime', '21:00');
        window.portalNotifSettings.hospital_push_enabled = getCheck('notifHospitalPushEnabled');
        window.portalNotifSettings.system_alert_enabled = getCheck('notifSystemAlertEnabled');

        try {
            const saveRes = await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(window.portalNotifSettings)
            });
            const result = await saveRes.json();

            if (window.portalNotifSettings.enabled && typeof window.registerWebPushSubscription === 'function') {
                await window.registerWebPushSubscription();
            }

            if (typeof window.updateBrowserPermissionUI === 'function') {
                window.updateBrowserPermissionUI();
            }
            alert(result.message || '알림 설정이 성공적으로 저장되었습니다.');
            window.closeNotificationModal();
        } catch (err) {
            console.error('[알림 설정 저장 오류]:', err);
            alert('알림 설정 저장 중 오류가 발생했습니다.');
        }
    };

    // 상단 마스터 전체 켜기/끄기 스위치
    window.toggleNotifMaster = async function(checked) {
        window.portalNotifSettings.enabled = checked ? 1 : 0;
        try {
            await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(window.portalNotifSettings)
            });
            if (checked) {
                if (typeof window.registerWebPushSubscription === 'function') {
                    await window.registerWebPushSubscription();
                }
            } else {
                if (typeof window.unsubscribeWebPushSubscription === 'function') {
                    await window.unsubscribeWebPushSubscription();
                }
            }
        } catch (err) {
            console.error('[마스터 알림 스위치 저장 실패]:', err);
        }
    };
})();
