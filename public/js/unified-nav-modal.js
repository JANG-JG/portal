/**
 * 🔔 JG 통합 알림 센터 모달 & 맞춤 설정 컨트롤러 (unified-nav-modal.js — Clean-Slate v2)
 * - 메인 포털 및 전 서브 서비스 단일 모달·설정·시간표 모듈 (500줄 이하 헌법 준수)
 */
(function() {
    'use strict';

    if (window.__JG_NOTIF_MODAL_READY__) return;
    window.__JG_NOTIF_MODAL_READY__ = true;

    function getBaseUrl() {
        const h = window.location.hostname;
        return (h === 'j-jg.cc' || h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.')) ? '' : 'https://j-jg.cc';
    }

    window.portalNotifSettings = window.portalNotifSettings || {
        enabled: 1,
        album_push_enabled: 1, album_new_photo_enabled: 1, album_comment_enabled: 1, album_mention_enabled: 1,
        hospital_push_enabled: 1, breaking_news_enabled: 1,
        weather_morning_enabled: 1, weather_morning_time: '07:00',
        asset_report_enabled: 1, asset_open_enabled: 1, asset_close_enabled: 1,
        bp_reminder_enabled: 1, bp_reminder_time: '21:00',
        system_alert_enabled: 1,
        telegram_briefing_times: ['07:30'],
        weekday_med_times: ['08:00', '19:00'], weekday_bp_times: ['07:30', '21:30'],
        weekend_med_times: ['09:00', '19:30'], weekend_bp_times: ['08:30', '22:00']
    };

    window.handleUnifiedNotifClick = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (typeof window.closeUnavDrawer === 'function') window.closeUnavDrawer();
        window.openNotificationModal();
    };

    window.applyNotifAdaptiveTheme = function(modal) {
        if (!modal) modal = document.getElementById('notificationModal');
        if (!modal) return;
        const isPortalMain = window.location.pathname === '/' || window.location.pathname === '/index.html' || !!document.getElementById('portal-tab-bar');
        if (isPortalMain) {
            modal.classList.remove('dark-zinc', 'theme-dark');
            return;
        }
        const hasDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
        modal.classList.toggle('dark-zinc', hasDark);
        modal.classList.toggle('theme-dark', hasDark);
    };

    async function ensureModalMounted() {
        let modal = document.getElementById('notificationModal');
        if (modal && modal.querySelector('.notif-category-bar')) return modal;
        if (modal) { modal.remove(); modal = null; }

        try {
            const base = getBaseUrl();
            const uVer = window.__JG_UI_VERSION__ || Date.now();
            const compUrl = `${base || ''}/components/unified-nav.html?v=${uVer}`;
            const res = await fetch(compUrl);
            if (res.ok) {
                const html = await res.text();
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const fetchedModal = temp.querySelector('#notificationModal');
                if (fetchedModal) {
                    document.body.appendChild(fetchedModal);
                    modal = fetchedModal;
                }
            }
        } catch (e) {
            console.error('[NotificationModal] 컴포넌트 로드 실패:', e);
        }
        return modal;
    }

    window.openNotificationModal = async function(initialTab) {
        const modal = await ensureModalMounted();
        if (!modal) return;

        window.applyNotifAdaptiveTheme(modal);
        modal.classList.add('open');
        modal.style.setProperty('display', 'flex', 'important');

        if (typeof window.lockBodyScroll === 'function') window.lockBodyScroll();
        else {
            document.documentElement.classList.add('modal-open');
            document.body.classList.add('modal-open');
        }

        window.switchNotifMainTab(initialTab === 'settings' ? 'settings' : 'history');
        if (typeof window.updateBrowserPermissionUI === 'function') window.updateBrowserPermissionUI();
        window.fetchNotificationSettings();
        if (typeof window.fetchNotificationHistory === 'function') window.fetchNotificationHistory(false);
    };

    window.closeNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (modal) {
            modal.classList.remove('open');
            modal.style.setProperty('display', 'none', 'important');
        }
        if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll();
        else {
            document.documentElement.classList.remove('modal-open');
            document.body.classList.remove('modal-open');
        }
    };

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'notificationModal') window.closeNotificationModal();
        const wrapper = document.getElementById('notifInfoTooltipWrapper');
        if (wrapper && !wrapper.contains(e.target)) wrapper.classList.remove('active');
        if (!e.target.closest('.notif-more-menu-wrapper') && typeof window.closeAllNotifMenus === 'function') {
            window.closeAllNotifMenus();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.closeNotificationModal();
    });

    window.switchNotifMainTab = function(tab) {
        const isSet = tab === 'settings';
        const sView = document.getElementById('notifMainViewSettings');
        const hView = document.getElementById('notifMainViewHistory');
        const sTab = document.getElementById('notifMainTabSettings');
        const hTab = document.getElementById('notifMainTabHistory');
        if (sView) sView.style.display = isSet ? 'block' : 'none';
        if (hView) hView.style.display = isSet ? 'none' : 'flex';
        if (sTab) sTab.classList.toggle('active', isSet);
        if (hTab) hTab.classList.toggle('active', !isSet);
        if (typeof window.updateBrowserPermissionUI === 'function') window.updateBrowserPermissionUI();
        if (!isSet && typeof window.fetchNotificationHistory === 'function') window.fetchNotificationHistory(false);
    };

    window.switchNotifSubTab = function(type) {
        const isWk = type === 'weekday';
        const wView = document.getElementById('notifSubTabWeekday');
        const eView = document.getElementById('notifSubTabWeekend');
        const wTab = document.getElementById('notifTabWeekday');
        const eTab = document.getElementById('notifTabWeekend');
        if (wView) wView.style.display = isWk ? 'block' : 'none';
        if (eView) eView.style.display = isWk ? 'none' : 'block';
        if (wTab) wTab.classList.toggle('active', isWk);
        if (eTab) eTab.classList.toggle('active', !isWk);
    };

    window.toggleNotifInfoTooltip = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const el = document.getElementById('notifInfoTooltipWrapper');
        if (el) el.classList.toggle('active');
    };

    window.fetchNotificationSettings = async function() {
        try {
            const res = await fetch(`${getBaseUrl()}/api/notification/settings`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.settings) {
                const s = Object.assign(window.portalNotifSettings, data.settings);
                const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val !== 0); };
                setC('notifMasterEnabled', s.enabled);
                setC('notifAlbumPushEnabled', s.album_push_enabled);
                setC('notifAlbumNewPhotoEnabled', s.album_new_photo_enabled);
                setC('notifAlbumCommentEnabled', s.album_comment_enabled);
                setC('notifAlbumMentionEnabled', s.album_mention_enabled);
                setC('notifBreakingNewsEnabled', s.breaking_news_enabled);
                setC('notifWeatherMorningEnabled', s.weather_morning_enabled);
                setC('notifAssetReportEnabled', s.asset_report_enabled);
                setC('notifAssetOpenEnabled', s.asset_open_enabled !== undefined ? s.asset_open_enabled : s.asset_report_enabled);
                setC('notifAssetCloseEnabled', s.asset_close_enabled !== undefined ? s.asset_close_enabled : s.asset_report_enabled);
                setC('notifBpReminderEnabled', s.bp_reminder_enabled);
                setC('notifHospitalPushEnabled', s.hospital_push_enabled);
                setC('notifSystemAlertEnabled', s.system_alert_enabled);

                const setV = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
                setV('inputWeatherTime', s.weather_morning_time || '07:00');
                setV('inputBpReminderTime', s.bp_reminder_time || '21:00');
                window.renderNotifChips();
            }
        } catch (e) {
            console.error('[Notification] 설정 조회 실패:', e);
        }
    };

    window.toggleAlbumSubOptions = function(checked) {
        ['notifAlbumNewPhotoEnabled', 'notifAlbumCommentEnabled', 'notifAlbumMentionEnabled'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = checked;
        });
    };

    window.handleAlbumSubOptionChange = function() {
        const pEl = document.getElementById('notifAlbumNewPhotoEnabled');
        const cEl = document.getElementById('notifAlbumCommentEnabled');
        const mEl = document.getElementById('notifAlbumMentionEnabled');
        const aEl = document.getElementById('notifAlbumPushEnabled');
        if (aEl) aEl.checked = Boolean((pEl && pEl.checked) || (cEl && cEl.checked) || (mEl && mEl.checked));
    };

    window.toggleAssetSubOptions = function(checked) {
        ['notifAssetOpenEnabled', 'notifAssetCloseEnabled'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = checked;
        });
    };

    window.handleAssetSubOptionChange = function() {
        const oEl = document.getElementById('notifAssetOpenEnabled');
        const cEl = document.getElementById('notifAssetCloseEnabled');
        const rEl = document.getElementById('notifAssetReportEnabled');
        if (rEl) rEl.checked = Boolean((oEl && oEl.checked) || (cEl && cEl.checked));
    };

    window.toggleNotifMaster = async function(checked) {
        window.portalNotifSettings.enabled = checked ? 1 : 0;
        try {
            if (checked && window.isPortalPushOrigin && window.isPortalPushOrigin() &&
                'Notification' in window && Notification.permission === 'default') {
                try { await Notification.requestPermission(); } catch (e) {}
            }
            await fetch(`${getBaseUrl()}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(window.portalNotifSettings)
            });
            if (checked && typeof window.registerWebPushSubscription === 'function') {
                await window.registerWebPushSubscription(false);
            } else if (!checked && typeof window.unsubscribeWebPushSubscription === 'function') {
                await window.unsubscribeWebPushSubscription();
            }
            if (typeof window.updateBrowserPermissionUI === 'function') window.updateBrowserPermissionUI();
        } catch (err) {
            console.error('[Notification] 마스터 토글 저장 실패:', err);
        }
    };

    window.renderNotifChips = function() {
        const s = window.portalNotifSettings;
        const renderBox = (cId, arr, key) => {
            const c = document.getElementById(cId);
            if (!c) return;
            if (!arr || arr.length === 0) {
                c.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">등록된 알림 시간이 없습니다.</span>';
                return;
            }
            c.innerHTML = arr.map((t, idx) => `
                <span class="notif-time-chip">
                    <span>⏰ ${t}</span>
                    <button type="button" onclick="removeNotifTime('${key}', ${idx})" title="삭제">✕</button>
                </span>
            `).join('');
        };
        renderBox('containerTelegramBriefingTimes', s.telegram_briefing_times, 'telegram_briefing_times');
        renderBox('containerWeekdayMedTimes', s.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', s.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', s.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', s.weekend_bp_times, 'weekend_bp_times');
    };

    window.addTelegramBriefingTime = function() {
        const el = document.getElementById('inputTelegramBriefingTime');
        if (!el || !el.value) return alert('추가할 브리핑 발송 시간을 먼저 선택해 주세요.');
        const val = el.value.trim();
        if (!/^\d{2}:\d{2}$/.test(val)) return alert('올바른 시간(HH:MM)을 선택해 주세요.');
        const s = window.portalNotifSettings;
        if (!Array.isArray(s.telegram_briefing_times)) s.telegram_briefing_times = [];
        if (s.telegram_briefing_times.includes(val)) return alert('이미 등록된 시간입니다: ' + val);
        s.telegram_briefing_times.push(val);
        s.telegram_briefing_times.sort();
        el.value = '';
        window.renderNotifChips();
    };

    window.addNotifTime = function(dayType, category) {
        const inputId = dayType === 'weekday'
            ? (category === 'med' ? 'inputWeekdayMedTime' : 'inputWeekdayBpTime')
            : (category === 'med' ? 'inputWeekendMedTime' : 'inputWeekendBpTime');
        const key = `${dayType}_${category}_times`;
        const el = document.getElementById(inputId);
        if (!el || !el.value) return alert('추가할 알림 시간을 먼저 선택해 주세요.');
        const s = window.portalNotifSettings;
        if (!Array.isArray(s[key])) s[key] = [];
        if (s[key].includes(el.value)) return alert('이미 등록된 시간입니다.');
        s[key].push(el.value);
        s[key].sort();
        el.value = '';
        window.renderNotifChips();
    };

    window.removeNotifTime = function(key, idx) {
        const s = window.portalNotifSettings;
        if (Array.isArray(s[key])) {
            s[key].splice(idx, 1);
            window.renderNotifChips();
        }
    };

    window.saveNotificationSettings = async function() {
        const s = window.portalNotifSettings;
        const getC = (id, fallback = 1) => { const el = document.getElementById(id); return el ? (el.checked ? 1 : 0) : fallback; };
        const getV = (id, def) => { const el = document.getElementById(id); return (el && el.value.trim()) ? el.value.trim() : def; };

        s.enabled = getC('notifMasterEnabled', s.enabled);
        s.album_new_photo_enabled = getC('notifAlbumNewPhotoEnabled', s.album_new_photo_enabled);
        s.album_comment_enabled = getC('notifAlbumCommentEnabled', s.album_comment_enabled);
        s.album_mention_enabled = getC('notifAlbumMentionEnabled', s.album_mention_enabled);
        s.album_push_enabled = (s.album_new_photo_enabled || s.album_comment_enabled || s.album_mention_enabled)
            ? 1 : getC('notifAlbumPushEnabled', s.album_push_enabled);
        s.breaking_news_enabled = getC('notifBreakingNewsEnabled', s.breaking_news_enabled);
        s.weather_morning_enabled = getC('notifWeatherMorningEnabled', s.weather_morning_enabled);
        s.weather_morning_time = getV('inputWeatherTime', '07:00');
        s.asset_open_enabled = getC('notifAssetOpenEnabled', s.asset_open_enabled);
        s.asset_close_enabled = getC('notifAssetCloseEnabled', s.asset_close_enabled);
        s.asset_report_enabled = (s.asset_open_enabled || s.asset_close_enabled)
            ? 1 : getC('notifAssetReportEnabled', s.asset_report_enabled);
        s.bp_reminder_enabled = getC('notifBpReminderEnabled', s.bp_reminder_enabled);
        s.bp_reminder_time = getV('inputBpReminderTime', '21:00');
        s.hospital_push_enabled = getC('notifHospitalPushEnabled', s.hospital_push_enabled);
        s.system_alert_enabled = getC('notifSystemAlertEnabled', s.system_alert_enabled);

        try {
            if (s.enabled && window.isPortalPushOrigin && window.isPortalPushOrigin() &&
                'Notification' in window && Notification.permission === 'default') {
                try { await Notification.requestPermission(); } catch (e) {}
            }
            const res = await fetch(`${getBaseUrl()}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(s)
            });
            const result = await res.json();
            if (s.enabled && window.isPortalPushOrigin && window.isPortalPushOrigin() &&
                'Notification' in window && Notification.permission === 'granted' &&
                typeof window.registerWebPushSubscription === 'function') {
                await window.registerWebPushSubscription(false);
            }
            if (typeof window.updateBrowserPermissionUI === 'function') await window.updateBrowserPermissionUI();
            alert(result.message || '알림 설정이 저장되었습니다.');
        } catch (err) {
            console.error('[Notification] 설정 저장 오류:', err);
            alert('알림 설정 저장 중 오류가 발생했습니다.');
        }
    };

    window.muteNotificationCategory = async function(catKey, catLabel) {
        const label = catLabel || '해당';
        if (!confirm(`'${label}' 관련 알림을 끄시겠습니까?\n('알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.)`)) return;

        const s = window.portalNotifSettings;
        const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

        if (catKey === 'album') {
            s.album_push_enabled = 0; s.album_new_photo_enabled = 0; s.album_comment_enabled = 0; s.album_mention_enabled = 0;
            setC('notifAlbumPushEnabled', false); setC('notifAlbumNewPhotoEnabled', false);
            setC('notifAlbumCommentEnabled', false); setC('notifAlbumMentionEnabled', false);
        } else if (catKey === 'breaking') {
            s.breaking_news_enabled = 0; setC('notifBreakingNewsEnabled', false);
        } else if (catKey === 'calendar') {
            s.hospital_push_enabled = 0; setC('notifHospitalPushEnabled', false);
        } else if (catKey === 'weather') {
            s.weather_morning_enabled = 0; setC('notifWeatherMorningEnabled', false);
        } else if (catKey === 'finance') {
            s.asset_open_enabled = 0; s.asset_close_enabled = 0; s.asset_report_enabled = 0;
            setC('notifAssetOpenEnabled', false); setC('notifAssetCloseEnabled', false); setC('notifAssetReportEnabled', false);
        } else if (catKey === 'health') {
            s.bp_reminder_enabled = 0; s.hospital_push_enabled = 0;
            setC('notifBpReminderEnabled', false); setC('notifHospitalPushEnabled', false);
        } else if (catKey === 'system') {
            s.system_alert_enabled = 0; setC('notifSystemAlertEnabled', false);
        }

        try {
            await fetch(`${getBaseUrl()}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(s)
            });
            alert(`🔕 '${label}' 알림을 껐습니다.`);
        } catch (err) {
            alert('설정 저장 중 오류가 발생했습니다.');
        }
    };
})();
