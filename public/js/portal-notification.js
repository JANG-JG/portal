/**
 * 🔔 JG 포털 전용 통합 알림 센터 엔진 (portal-notification.js)
 * - 전 사이트 공통 통합 알림 센터(unified-nav.js)와 100% 동일한 UI/기능/구독 메타데이터 동기화
 * - 미확인 배지 + 카테고리 필터링(속보/일정/날씨/금융/건강/시스템) + 텔레그램 브리핑 시간표 + 푸시 중복 차단
 * - 규칙 3 준수: 파일당 500줄 이하 모듈화
 */
(function() {
    'use strict';
    let portalNotifSettings = {
        enabled: 1,
        album_push_enabled: 1, album_new_photo_enabled: 1, album_comment_enabled: 1, album_mention_enabled: 1,
        hospital_push_enabled: 1, breaking_news_enabled: 1,
        weather_morning_enabled: 1, weather_morning_time: '07:00',
        asset_report_enabled: 1, asset_open_enabled: 1, asset_close_enabled: 1,
        bp_reminder_enabled: 1, bp_reminder_time: '21:00', system_alert_enabled: 1,
        telegram_briefing_times: ['07:30'],
        weekday_med_times: ['08:00', '19:00'], weekday_bp_times: ['07:30', '21:30'],
        weekend_med_times: ['09:00', '19:30'], weekend_bp_times: ['08:30', '22:00']
    };
    let notifHistoryOffset = 0, notifHistoryTotal = 0, notifHistoryListItems = [], notifSelectedCategory = 'all';
    const NOTIF_HISTORY_LIMIT = 30;
    const NOTIF_CATEGORIES = [
        { key: 'all', label: '전체', icon: '🔔' },
        { key: 'album', label: '가족앨범', icon: '📸' },
        { key: 'breaking', label: '속보', icon: '🚨' },
        { key: 'calendar', label: '일정', icon: '📅' },
        { key: 'weather', label: '날씨', icon: '🌤️' },
        { key: 'finance', label: '금융', icon: '💰' },
        { key: 'health', label: '건강', icon: '🩸' },
        { key: 'system', label: '시스템', icon: '🖥️' }
    ];

    // 🎨 사이트 특성(포털 메인, 다크 모드 등) 능동 감지 및 다크징크 테마 적용 엔진
    function applyNotifAdaptiveTheme(modal) {
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
    }
    window.applyNotifAdaptiveTheme = applyNotifAdaptiveTheme;

    // 1. 모달 제어
    window.openNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (!modal) return;
        applyNotifAdaptiveTheme(modal);
        modal.classList.add('open');
        modal.style.setProperty('display', 'flex', 'important');
        if (typeof window.lockBodyScroll === 'function') window.lockBodyScroll();
        else { document.documentElement.classList.add('modal-open'); document.body.classList.add('modal-open'); }
        window.switchNotifMainTab('history');
        window.updateBrowserPermissionUI();
        window.fetchNotificationSettings();
        window.fetchNotificationHistory(false);
    };
    window.closeNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (modal) {
            modal.classList.remove('open');
            modal.style.setProperty('display', 'none', 'important');
        }
        if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll();
        else { document.documentElement.classList.remove('modal-open'); document.body.classList.remove('modal-open'); }
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

    // 2. 탭 전환
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
        if (!isSet) window.fetchNotificationHistory(false);
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

    // 3. 브라우저 푸시 권한
    window.updateBrowserPermissionUI = function() {
        const tEl = document.getElementById('notifPermissionStatusText');
        const bEl = document.getElementById('btnRequestNotifPermission');
        if (!('Notification' in window)) {
            if (tEl) tEl.textContent = '❌ 이 브라우저는 웹 푸시를 지원하지 않습니다.';
            if (bEl) bEl.style.display = 'none';
            return;
        }
        if (Notification.permission === 'granted') {
            if (tEl) tEl.textContent = '✅ 브라우저 푸시 알림 수신이 활성화되어 있습니다.';
            if (bEl) bEl.style.display = 'none';
        } else if (Notification.permission === 'denied') {
            if (tEl) tEl.textContent = '🚫 브라우저에서 알림이 차단되었습니다. 사이트 설정에서 허용해 주세요.';
            if (bEl) bEl.style.display = 'none';
        } else {
            if (tEl) tEl.textContent = '⚠️ 푸시 알림 권한이 필요합니다. [권한 허용]을 눌러주세요.';
            if (bEl) bEl.style.display = 'inline-block';
        }
    };
    window.requestBrowserNotificationPermission = async function() {
        if (!('Notification' in window)) return alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
        const perm = await Notification.requestPermission();
        window.updateBrowserPermissionUI();
        if (perm === 'granted') {
            await window.registerWebPushSubscription();
            alert('🎉 알림 권한이 성공적으로 허용되었습니다!');
        } else {
            alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
        }
    };

    // 4. 알림 맞춤 설정 & 텔레그램 브리핑 시간표
    window.fetchNotificationSettings = async function() {
        try {
            const res = await fetch('/api/notification/settings', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.settings) {
                portalNotifSettings = Object.assign(portalNotifSettings, data.settings);
                const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val !== 0); };
                setC('notifMasterEnabled', portalNotifSettings.enabled);
                setC('notifAlbumPushEnabled', portalNotifSettings.album_push_enabled);
                setC('notifAlbumNewPhotoEnabled', portalNotifSettings.album_new_photo_enabled);
                setC('notifAlbumCommentEnabled', portalNotifSettings.album_comment_enabled);
                setC('notifAlbumMentionEnabled', portalNotifSettings.album_mention_enabled);
                setC('notifBreakingNewsEnabled', portalNotifSettings.breaking_news_enabled);
                setC('notifWeatherMorningEnabled', portalNotifSettings.weather_morning_enabled);
                setC('notifAssetReportEnabled', portalNotifSettings.asset_report_enabled);
                const isOpenOn = portalNotifSettings.asset_open_enabled !== undefined ? portalNotifSettings.asset_open_enabled : portalNotifSettings.asset_report_enabled;
                const isCloseOn = portalNotifSettings.asset_close_enabled !== undefined ? portalNotifSettings.asset_close_enabled : portalNotifSettings.asset_report_enabled;
                setC('notifAssetOpenEnabled', isOpenOn);
                setC('notifAssetCloseEnabled', isCloseOn);
                setC('notifBpReminderEnabled', portalNotifSettings.bp_reminder_enabled);
                setC('notifHospitalPushEnabled', portalNotifSettings.hospital_push_enabled);
                setC('notifSystemAlertEnabled', portalNotifSettings.system_alert_enabled);
                const setV = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
                setV('inputWeatherTime', portalNotifSettings.weather_morning_time || '07:00');
                setV('inputBpReminderTime', portalNotifSettings.bp_reminder_time || '21:00');
                window.renderNotifChips();
            }
        } catch (e) { console.error('[Notification] 설정 조회 실패:', e); }
    };
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
        ['notifAssetOpenEnabled', 'notifAssetCloseEnabled'].forEach(id => {
            const el = document.getElementById(id); if (el) el.checked = checked;
        });
    };
    window.handleAssetSubOptionChange = function() {
        const oEl = document.getElementById('notifAssetOpenEnabled');
        const cEl = document.getElementById('notifAssetCloseEnabled');
        const rEl = document.getElementById('notifAssetReportEnabled');
        if (rEl) rEl.checked = (oEl && oEl.checked) || (cEl && cEl.checked);
    };
    window.toggleNotifMaster = async function(checked) {
        portalNotifSettings.enabled = checked ? 1 : 0;
        try {
            await fetch('/api/notification/settings', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            if (checked) await window.registerWebPushSubscription();
            else await window.unsubscribeWebPushSubscription();
        } catch (err) { console.error('[마스터 알림 스위치 저장 실패]:', err); }
    };
    window.renderNotifChips = function() {
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
        renderBox('containerTelegramBriefingTimes', portalNotifSettings.telegram_briefing_times, 'telegram_briefing_times');
        renderBox('containerWeekdayMedTimes', portalNotifSettings.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', portalNotifSettings.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', portalNotifSettings.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', portalNotifSettings.weekend_bp_times, 'weekend_bp_times');
    };
    window.addTelegramBriefingTime = function() {
        const el = document.getElementById('inputTelegramBriefingTime');
        if (!el || !el.value) return alert('추가할 브리핑 발송 시간을 먼저 선택해 주세요.');
        const val = el.value.trim();
        if (!/^\d{2}:\d{2}$/.test(val)) return alert('올바른 시간(HH:MM)을 선택해 주세요.');
        if (!portalNotifSettings.telegram_briefing_times) portalNotifSettings.telegram_briefing_times = [];
        if (portalNotifSettings.telegram_briefing_times.includes(val)) return alert('이미 등록된 브리핑 시간입니다: ' + val);
        portalNotifSettings.telegram_briefing_times.push(val);
        portalNotifSettings.telegram_briefing_times.sort();
        el.value = '';
        window.renderNotifChips();
    };
    window.addNotifTime = function(dayType, category) {
        const inputId = dayType === 'weekday' ? (category === 'med' ? 'inputWeekdayMedTime' : 'inputWeekdayBpTime') : (category === 'med' ? 'inputWeekendMedTime' : 'inputWeekendBpTime');
        const key = `${dayType}_${category}_times`;
        const el = document.getElementById(inputId);
        if (!el || !el.value) return alert('추가할 알림 시간을 먼저 선택해 주세요.');
        const val = el.value;
        if (!portalNotifSettings[key]) portalNotifSettings[key] = [];
        if (portalNotifSettings[key].includes(val)) return alert('이미 등록된 시간입니다.');
        portalNotifSettings[key].push(val);
        portalNotifSettings[key].sort();
        el.value = '';
        window.renderNotifChips();
    };
    window.removeNotifTime = function(key, idx) {
        if (portalNotifSettings[key]) {
            portalNotifSettings[key].splice(idx, 1);
            window.renderNotifChips();
        }
    };
    window.saveNotificationSettings = async function() {
        const getC = (id) => { const el = document.getElementById(id); return el ? (el.checked ? 1 : 0) : 1; };
        const getV = (id, def) => { const el = document.getElementById(id); return (el && el.value.trim()) ? el.value.trim() : def; };
        portalNotifSettings.enabled = getC('notifMasterEnabled');
        portalNotifSettings.album_new_photo_enabled = getC('notifAlbumNewPhotoEnabled');
        portalNotifSettings.album_comment_enabled = getC('notifAlbumCommentEnabled');
        portalNotifSettings.album_mention_enabled = getC('notifAlbumMentionEnabled');
        portalNotifSettings.album_push_enabled = (portalNotifSettings.album_new_photo_enabled || portalNotifSettings.album_comment_enabled || portalNotifSettings.album_mention_enabled) ? 1 : getC('notifAlbumPushEnabled');
        portalNotifSettings.breaking_news_enabled = getC('notifBreakingNewsEnabled');
        portalNotifSettings.weather_morning_enabled = getC('notifWeatherMorningEnabled');
        portalNotifSettings.weather_morning_time = getV('inputWeatherTime', '07:00');
        portalNotifSettings.asset_open_enabled = getC('notifAssetOpenEnabled');
        portalNotifSettings.asset_close_enabled = getC('notifAssetCloseEnabled');
        portalNotifSettings.asset_report_enabled = (portalNotifSettings.asset_open_enabled || portalNotifSettings.asset_close_enabled) ? 1 : getC('notifAssetReportEnabled');
        portalNotifSettings.bp_reminder_enabled = getC('notifBpReminderEnabled');
        portalNotifSettings.bp_reminder_time = getV('inputBpReminderTime', '21:00');
        portalNotifSettings.hospital_push_enabled = getC('notifHospitalPushEnabled');
        portalNotifSettings.system_alert_enabled = getC('notifSystemAlertEnabled');
        try {
            const res = await fetch('/api/notification/settings', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            const result = await res.json();
            if (portalNotifSettings.enabled) await window.registerWebPushSubscription();
            window.updateBrowserPermissionUI();
            alert(result.message || '알림 설정이 성공적으로 저장되었습니다.');
            window.closeNotificationModal();
        } catch (err) {
            console.error('[알림 설정 저장 오류]:', err);
            alert('알림 설정 저장 중 오류가 발생했습니다.');
        }
    };
    window.sendTestNotification = async function() {
        try {
            const res = await fetch('/api/notification/test', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                alert('🎉 기기로 테스트 푸시 알림이 발송되었습니다!\n수신 내역 탭에서도 확인하실 수 있습니다.');
                setTimeout(() => window.fetchNotificationHistory(false), 500);
            } else {
                alert('테스트 알림 발송 실패: ' + (data.message || '서버 오류'));
            }
        } catch (e) { alert('테스트 알림 요청 오류: ' + e.message); }
    };
    window.toggleNotifInfoTooltip = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const el = document.getElementById('notifInfoTooltipWrapper');
        if (el) el.classList.toggle('active');
    };

    // 5. 카테고리 판별 & 필터링 바 (unified-nav.js와 100% 동일 UI)
    function getNotificationCategory(item) {
        const type = (item.type || '').toLowerCase();
        const full = `${type} ${(item.title || '')} ${(item.body || '')}`.toLowerCase();
        if (type === 'album' || full.includes('가족앨범') || full.includes('앨범') || full.includes('새 사진') || full.includes('댓글이 등록') || full.includes('회원님을 언급')) return { key: 'album', label: '가족앨범', icon: '📸', colorClass: 'cat-album' };
        if (type === 'breaking' || full.includes('속보')) return { key: 'breaking', label: '속보', icon: '🚨', colorClass: 'cat-breaking' };
        if (type === 'calendar' || full.includes('일정') || full.includes('캘린더')) return { key: 'calendar', label: '일정', icon: '📅', colorClass: 'cat-calendar' };
        if (type === 'weather' || full.includes('날씨') || full.includes('기온') || full.includes('미세먼지') || full.includes('강수')) return { key: 'weather', label: '날씨', icon: '🌤️', colorClass: 'cat-weather' };
        if (['asset', 'economy', 'finance', 'stock'].includes(type) || full.includes('증시') || full.includes('환율') || full.includes('코스피') || full.includes('주가')) return { key: 'finance', label: '금융', icon: '💰', colorClass: 'cat-finance' };
        if (['blood_pressure', 'medication', 'hospital'].includes(type) || full.includes('혈압') || full.includes('복약') || full.includes('병원') || full.includes('약 복용')) return { key: 'health', label: '건강', icon: '🩸', colorClass: 'cat-health' };
        if (['system', 'backup', 'server'].includes(type) || full.includes('서버') || full.includes('백업') || full.includes('경보') || full.includes('다운')) return { key: 'system', label: '시스템', icon: '🖥️', colorClass: 'cat-system' };
        return { key: 'general', label: '일반', icon: '🔔', colorClass: 'cat-general' };
    }
    function renderCategoryChips() {
        const barEl = document.getElementById('notifCategoryBar');
        if (!barEl) return;
        const isFamily = document.documentElement.classList.contains('role-family');
        const visibleCats = isFamily
            ? NOTIF_CATEGORIES.filter(c => !['system', 'health'].includes(c.key))
            : NOTIF_CATEGORIES;
        const counts = { all: notifHistoryListItems.length }, unreads = { all: 0 };
        visibleCats.forEach(c => { if (c.key !== 'all') { counts[c.key] = 0; unreads[c.key] = 0; } });
        notifHistoryListItems.forEach(item => {
            const cat = getNotificationCategory(item);
            if (counts[cat.key] !== undefined) {
                counts[cat.key]++;
                if (item.is_read === 0) unreads[cat.key]++;
            }
            if (item.is_read === 0) unreads.all++;
        });
        barEl.innerHTML = visibleCats.map(cat => {
            const isActive = notifSelectedCategory === cat.key;
            const total = counts[cat.key] || 0;
            const unread = unreads[cat.key] || 0;
            const dot = unread > 0 ? '<span class="notif-cat-unread-dot"></span>' : '';
            return `<button type="button" class="notif-cat-chip ${isActive ? 'active' : ''}" onclick="selectNotificationCategory('${cat.key}')"><span>${cat.icon} ${cat.label}</span>${dot}<span class="notif-cat-badge">${total}</span></button>`;
        }).join('');
    }
    window.selectNotificationCategory = function(catKey) {
        notifSelectedCategory = catKey;
        renderCategoryChips();
        renderFilteredNotificationList();
    };
    function formatNotificationTime(dateStr) {
        if (!dateStr) return '';
        const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
        const target = m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6] || '0', 10)) : new Date(dateStr);
        if (isNaN(target.getTime())) return String(dateStr).replace('T', ' ').slice(5, 16);
        const now = new Date();
        const diffMs = now.getTime() - target.getTime();
        if (now.toDateString() === target.toDateString()) {
            if (diffMs < 60000) return '방금 전';
            const mins = Math.floor(diffMs / 60000);
            if (mins < 60) return `${mins}분 전`;
            const hrs = Math.floor(mins / 60), rem = mins % 60;
            return rem === 0 ? `${hrs}시간 전` : `${hrs}시간 ${rem}분 전`;
        }
        const pad = n => String(n).padStart(2, '0');
        const yest = new Date(now); yest.setDate(now.getDate() - 1);
        if (yest.toDateString() === target.toDateString()) return `어제 ${pad(target.getHours())}:${pad(target.getMinutes())}`;
        return `${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}`;
    }
    function renderFilteredNotificationList() {
        const listEl = document.getElementById('notifHistoryList');
        const countLabel = document.getElementById('notifHistoryCountLabel');
        const loadMoreBox = document.getElementById('notifLoadMoreBox');
        if (!listEl) return;
        const filtered = notifSelectedCategory === 'all'
            ? notifHistoryListItems
            : notifHistoryListItems.filter(item => getNotificationCategory(item).key === notifSelectedCategory);
        const unreadCount = filtered.filter(i => i.is_read === 0).length;
        if (countLabel) {
            const catName = NOTIF_CATEGORIES.find(c => c.key === notifSelectedCategory)?.label || '전체';
            const unreadTxt = unreadCount > 0 ? `, 미확인 ${unreadCount}건` : '';
            countLabel.textContent = notifSelectedCategory === 'all'
                ? `전체 알림 (총 ${notifHistoryTotal}건 중 ${filtered.length}건${unreadTxt})`
                : `${catName} 알림 (${filtered.length}건 / 전체 총 ${notifHistoryTotal}건${unreadTxt})`;
        }
        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 3.5rem 1rem; font-size: 0.9rem;">해당 분류의 알림 내역이 없습니다.</div>';
            if (loadMoreBox) loadMoreBox.style.display = 'none';
            return;
        }
        const cardsHtml = filtered.map(item => {
            const cat = getNotificationCategory(item);
            const timeStr = formatNotificationTime(item.created_at);
            const linkUrl = item.url || '#';
            const isUnread = item.is_read === 0;
            const newBadge = isUnread ? '<span class="notif-badge-new">NEW</span>' : '';
            const safeUrlAttr = escapeHtml(linkUrl);
            return `
                <div class="notif-card-item ${isUnread ? 'is-unread' : 'is-read'}" id="notif-card-${item.id}" data-url="${safeUrlAttr}" onclick="openAndReadNotification(${item.id}, this.getAttribute('data-url'))">
                    <div class="notif-card-header">
                        <span class="notif-card-category-badge ${cat.colorClass}">
                            <span>${cat.icon}</span> <span>${cat.label}</span>
                        </span>
                        <div class="notif-card-meta">
                            <span class="notif-card-time" title="${escapeHtml(item.created_at || '')}">${timeStr}</span>
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
                                        <span>🗑️</span> <span>알림 삭제</span>
                                    </button>
                                    <button type="button" class="notif-dropdown-btn btn-action-mute" onclick="handleCardMute('${cat.key}', '${cat.label}', event)">
                                        <span>🔕</span> <span>${cat.label} 알림 끄기</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p class="notif-card-body">${escapeHtml(item.body || '')}</p>
                    </div>
                </div>
            `;
        }).join('');
        const hasMore = notifHistoryListItems.length < notifHistoryTotal;
        const endHtml = hasMore
            ? `<div class="notif-list-end-notice has-more"><div class="notif-end-icon">📄</div><div class="notif-end-text">현재 불러온 알림 목록의 마지막입니다.</div><div class="notif-end-sub">이전 알림을 더 확인하시려면 아래 <strong>[+ 이전 알림 더보기]</strong> 메뉴를 눌러주세요.</div></div>`
            : `<div class="notif-list-end-notice is-complete"><div class="notif-end-icon">✨</div><div class="notif-end-text">모든 알림을 확인했습니다.</div><div class="notif-end-sub">수신된 알림의 마지막입니다.</div></div>`;
        listEl.innerHTML = cardsHtml + endHtml;
        if (loadMoreBox) {
            loadMoreBox.style.display = hasMore ? 'block' : 'none';
            const btn = document.getElementById('btnNotifLoadMore');
            if (btn) btn.textContent = `+ 이전 알림 더보기 (${notifHistoryListItems.length}/${notifHistoryTotal})`;
        }
    }

    // 6. 알림 수신 내역 조회 & 카드 메뉴 액션
    window.refreshNotificationHistory = function() {
        notifHistoryOffset = 0;
        notifHistoryListItems = [];
        window.fetchNotificationHistory(false);
    };
    window.loadMoreNotificationHistory = function() {
        notifHistoryOffset += NOTIF_HISTORY_LIMIT;
        window.fetchNotificationHistory(true);
    };
    function updateAllBadges(cnt) {
        const text = cnt > 99 ? '99+' : String(cnt);
        document.querySelectorAll('#unavNotifBadge, #unavMobileNotifBadge, #notifHistoryBadge, .cmd-notif-badge, .unav-notif-badge').forEach(b => {
            b.textContent = text;
            b.style.display = cnt > 0 ? 'inline-block' : 'none';
        });
    }
    window.fetchNotificationHistory = async function(isAppend = false) {
        try {
            const res = await fetch(`/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            const history = data.history || [];
            notifHistoryTotal = data.totalCount || 0;
            updateAllBadges(data.unreadCount || 0);
            notifHistoryListItems = isAppend ? notifHistoryListItems.concat(history) : history;
            renderCategoryChips();
            renderFilteredNotificationList();
        } catch (e) { console.error('[Notification] 내역 조회 오류:', e); }
    };
    window.markAllNotificationsAsRead = async function() {
        try {
            const res = await fetch('/api/notification/history/read-all', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems.forEach(i => i.is_read = 1);
                renderCategoryChips();
                renderFilteredNotificationList();
                updateAllBadges(0);
            }
        } catch (e) { console.error('전체 읽음 처리 오류:', e); }
    };
    window.openAndReadNotification = async function(id, url) {
        try {
            await fetch(`/api/notification/history/${id}/read`, { method: 'POST', credentials: 'include', keepalive: true });
            const item = notifHistoryListItems.find(i => i.id === id);
            if (item) item.is_read = 1;
            renderCategoryChips();
            renderFilteredNotificationList();
            initUnreadBadge();
        } catch (e) {}
        const item = notifHistoryListItems.find(i => i.id === id);
        const rawUrl = (url && url !== '#') ? url : (item && item.url && item.url !== '#' ? item.url : '');
        const isSafeUrl = rawUrl && (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('/'));
        if (isSafeUrl) {
            window.closeNotificationModal();
            window.location.href = rawUrl;
        }
    };
    window.deleteNotificationItem = async function(id) {
        if (!confirm('이 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/notification/history/${id}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = notifHistoryListItems.filter(i => i.id !== id);
                renderCategoryChips();
                renderFilteredNotificationList();
                initUnreadBadge();
            }
        } catch (e) { alert('삭제 오류: ' + e.message); }
    };
    window.clearAllNotificationHistory = async function() {
        if (!confirm('수신된 모든 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch('/api/notification/history/clear/all', { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = [];
                notifHistoryTotal = 0;
                renderCategoryChips();
                renderFilteredNotificationList();
                updateAllBadges(0);
            }
        } catch (e) { alert('전체 삭제 오류: ' + e.message); }
    };
    window.toggleNotifCardMenu = function(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const targetMenu = document.getElementById(`notifDropdown-${id}`);
        const isAlreadyOpen = targetMenu && targetMenu.classList.contains('show');
        window.closeAllNotifMenus();
        if (targetMenu && !isAlreadyOpen) targetMenu.classList.add('show');
    };
    window.closeAllNotifMenus = function() {
        document.querySelectorAll('.notif-dropdown-menu.show').forEach(el => el.classList.remove('show'));
    };
    window.handleCardDelete = function(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.closeAllNotifMenus();
        window.deleteNotificationItem(id);
    };
    window.handleCardMute = async function(catKey, catLabel, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.closeAllNotifMenus();
        const label = catLabel || '해당';
        if (!confirm(`'${label}' 관련 알림을 끄시겠습니까?\n('알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.)`)) return;
        const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
        if (catKey === 'album') {
            portalNotifSettings.album_push_enabled = 0;
            portalNotifSettings.album_new_photo_enabled = 0;
            portalNotifSettings.album_comment_enabled = 0;
            portalNotifSettings.album_mention_enabled = 0;
            setC('notifAlbumPushEnabled', false);
            setC('notifAlbumNewPhotoEnabled', false);
            setC('notifAlbumCommentEnabled', false);
            setC('notifAlbumMentionEnabled', false);
        } else if (catKey === 'breaking') { portalNotifSettings.breaking_news_enabled = 0; setC('notifBreakingNewsEnabled', false); }
        else if (catKey === 'calendar') { portalNotifSettings.hospital_push_enabled = 0; setC('notifHospitalPushEnabled', false); }
        else if (catKey === 'weather') { portalNotifSettings.weather_morning_enabled = 0; setC('notifWeatherMorningEnabled', false); }
        else if (catKey === 'finance') {
            portalNotifSettings.asset_open_enabled = 0; portalNotifSettings.asset_close_enabled = 0; portalNotifSettings.asset_report_enabled = 0;
            setC('notifAssetOpenEnabled', false); setC('notifAssetCloseEnabled', false); setC('notifAssetReportEnabled', false);
        } else if (catKey === 'health') { portalNotifSettings.bp_reminder_enabled = 0; setC('notifBpReminderEnabled', false); }
        else if (catKey === 'system') { portalNotifSettings.system_alert_enabled = 0; setC('notifSystemAlertEnabled', false); }
        try {
            await fetch('/api/notification/settings', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            alert(`🔕 '${label}' 알림을 껐습니다.\n'알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.`);
        } catch (err) { alert('설정 저장 중 오류가 발생했습니다.'); }
    };

    // 7. 디바이스 판별 & 웹 푸시 구독/해제 (삼성 인터넷 및 모바일 중복 원천 차단)
    function getDevicePushMetadata() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                             window.matchMedia('(display-mode: fullscreen)').matches ||
                             window.matchMedia('(display-mode: minimal-ui)').matches ||
                             window.navigator.standalone === true ||
                             document.referrer.includes('android-app://');
        const clientType = isStandalone ? 'pwa' : 'browser';
        const ua = navigator.userAgent.toLowerCase();
        const isTouchMobile = (navigator.maxTouchPoints > 1 && /android|linux|macintosh|iphone|ipad/i.test(ua) && window.screen && Math.min(window.screen.width, window.screen.height) <= 900);
        const deviceType = (/mobi|iphone|ipod|ipad|tablet|android|samsungbrowser|wv|kindle|silk/i.test(ua) || isTouchMobile) ? 'mobile' : 'desktop';
        let deviceId = '';
        try {
            deviceId = localStorage.getItem('jg_device_id');
            if (!deviceId) {
                deviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
                localStorage.setItem('jg_device_id', deviceId);
            }
        } catch (e) { deviceId = 'unknown'; }
        return { clientType, deviceType, deviceId, userAgent: navigator.userAgent };
    }
    window.registerWebPushSubscription = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
            const meta = getDevicePushMetadata();
            if (Notification.permission === 'default') {
                const requested = await Notification.requestPermission();
                if (requested !== 'granted') return;
            } else if (Notification.permission !== 'granted') return;

            const keyRes = await fetch('/api/notification/vapid-key', { credentials: 'include' });
            const { publicKey } = await keyRes.json();
            if (!publicKey) return;
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                const padding = '='.repeat((4 - publicKey.length % 4) % 4);
                const base64 = (publicKey + padding).replace(/\-/g, '+').replace(/_/g, '/');
                const rawData = window.atob(base64);
                const out = new Uint8Array(rawData.length);
                for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: out });
            }
            const subRes = await fetch('/api/notification/subscribe', {
                method: 'POST', credentials: 'include',
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
        } catch (e) { console.error('[WebPush] 구독 오류:', e); }
    };
    window.unsubscribeWebPushSubscription = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const ep = sub.endpoint;
                await sub.unsubscribe();
                await fetch('/api/notification/unsubscribe', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: ep })
                }).catch(() => {});
            }
        } catch (e) {}
    };
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 8. 서비스워커 등록, 뱃지 동기화, URL notif_id 자동 읽음 처리 및 PWA 자동 구독
    async function initUnreadBadge() {
        try {
            const res = await fetch('/api/notification/history?limit=1', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            updateAllBadges(data.unreadCount || 0);
        } catch (e) {}
    }
    function handleNotifIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const notifId = urlParams.get('notif_id');
        if (notifId) {
            urlParams.delete('notif_id');
            const newQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            window.history.replaceState({}, document.title, window.location.pathname + newQuery + window.location.hash);
            fetch(`/api/notification/history/${notifId}/read`, { method: 'POST', credentials: 'include', keepalive: true })
                .then(() => initUnreadBadge()).catch(() => {});
        }
        if (urlParams.get('open') === 'notification' || window.location.hash === '#notification') {
            setTimeout(() => window.openNotificationModal(), 200);
            urlParams.delete('open');
            const cleanQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            const cleanHash = window.location.hash === '#notification' ? '' : window.location.hash;
            window.history.replaceState({}, document.title, window.location.pathname + cleanQuery + cleanHash);
        }
    }
    const init = () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        }
        handleNotifIdFromUrl();
        initUnreadBadge();
        setInterval(initUnreadBadge, 60000);
        if ('Notification' in window) {
            const meta = getDevicePushMetadata();
            if (meta.deviceType !== 'mobile' || meta.clientType === 'pwa' || meta.clientType === 'apk') {
                setTimeout(() => window.registerWebPushSubscription(), 1000);
            }
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();