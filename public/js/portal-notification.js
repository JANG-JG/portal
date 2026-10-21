/**
 * 🔔 JG 포털 전용 통합 알림 센터 엔진 (portal-notification.js)
 * - 외부 의존성 없이 단독 동작하는 완전한 알림 센터 모달 컨트롤러
 * - 미확인 배지 + 카테고리 필터링(속보/일정/날씨/금융/건강/시스템) + 텔레그램 브리핑 시간표 + 푸시
 * - 규칙 3 준수: 파일당 500줄 이하 모듈화
 */
(function() {
    'use strict';
    let portalNotifSettings = {
        enabled: 1, hospital_push_enabled: 1, breaking_news_enabled: 1,
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
        { key: 'all', label: '전체', icon: '🔔' }, { key: 'breaking', label: '속보', icon: '🚨' },
        { key: 'calendar', label: '일정', icon: '📅' }, { key: 'weather', label: '날씨', icon: '🌤️' },
        { key: 'finance', label: '금융', icon: '💰' }, { key: 'health', label: '건강', icon: '🩸' },
        { key: 'system', label: '시스템', icon: '🖥️' }
    ];

    // 1. 모달 제어
    window.openNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (!modal) return;
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
            await registerWebPushSubscription();
            alert('🎉 알림 권한이 성공적으로 허용되었습니다!');
        } else {
            alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
        }
    };

    // 4. 알림 맞춤 설정 & 텔레그램 브리핑 시간표
    window.fetchNotificationSettings = async function() {
        try {
            const res = await fetch('/api/notification/settings');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.settings) {
                portalNotifSettings = Object.assign(portalNotifSettings, data.settings);
                const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val !== 0); };
                setC('notifMasterEnabled', portalNotifSettings.enabled);
                setC('notifBreakingNewsEnabled', portalNotifSettings.breaking_news_enabled);
                setC('notifWeatherMorningEnabled', portalNotifSettings.weather_morning_enabled);
                setC('notifAssetReportEnabled', portalNotifSettings.asset_report_enabled);
                setC('notifAssetOpenEnabled', portalNotifSettings.asset_open_enabled !== 0);
                setC('notifAssetCloseEnabled', portalNotifSettings.asset_close_enabled !== 0);
                setC('notifBpReminderEnabled', portalNotifSettings.bp_reminder_enabled);
                setC('notifHospitalPushEnabled', portalNotifSettings.hospital_push_enabled);
                setC('notifSystemAlertEnabled', portalNotifSettings.system_alert_enabled);
                const setV = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
                setV('inputWeatherTime', portalNotifSettings.weather_morning_time || '07:00');
                setV('inputBpReminderTime', portalNotifSettings.bp_reminder_time || '21:00');
                renderNotifChips();
            }
        } catch (e) { console.error('[Notification] 설정 조회 실패:', e); }
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
    window.toggleNotifMaster = function(checked) {
        portalNotifSettings.enabled = checked ? 1 : 0;
        document.querySelectorAll('#notifMainViewSettings input[type="checkbox"]').forEach(cb => {
            if (cb.id !== 'notifMasterEnabled') cb.checked = checked;
        });
    };
    function renderNotifChips() {
        const renderBox = (cId, arr, key) => {
            const c = document.getElementById(cId);
            if (!c) return;
            if (!arr || arr.length === 0) {
                c.innerHTML = '<span style="font-size:0.75rem; color:#71717a;">등록된 시간 없음</span>';
                return;
            }
            c.innerHTML = arr.map((t, idx) => `
                <span class="notif-time-chip" style="display:inline-flex; align-items:center; gap:4px; background:#18181b; border:1px solid #27272a; border-radius:4px; padding:2px 6px; font-size:0.75rem; color:#f4f4f5; margin-right:4px;">
                    <span>⏰ ${t}</span>
                    <button type="button" onclick="removeNotifTime('${key}', ${idx})" style="background:none; border:none; color:#a1a1aa; cursor:pointer;" title="삭제">✕</button>
                </span>
            `).join('');
        };
        renderBox('containerTelegramBriefingTimes', portalNotifSettings.telegram_briefing_times, 'telegram_briefing_times');
        renderBox('containerWeekdayMedTimes', portalNotifSettings.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', portalNotifSettings.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', portalNotifSettings.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', portalNotifSettings.weekend_bp_times, 'weekend_bp_times');
    }
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
        renderNotifChips();
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
        renderNotifChips();
    };
    window.removeNotifTime = function(key, idx) {
        if (portalNotifSettings[key]) {
            portalNotifSettings[key].splice(idx, 1);
            renderNotifChips();
        }
    };
    window.saveNotificationSettings = async function() {
        const getC = (id) => { const el = document.getElementById(id); return el ? (el.checked ? 1 : 0) : 1; };
        const getV = (id, def) => { const el = document.getElementById(id); return (el && el.value.trim()) ? el.value.trim() : def; };
        portalNotifSettings.enabled = getC('notifMasterEnabled');
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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            const result = await res.json();
            if (portalNotifSettings.enabled) await registerWebPushSubscription();
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
            const res = await fetch('/api/notification/test', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                alert('🎉 테스트 푸시 알림이 발송되었습니다!\n수신 내역 탭에서도 확인하실 수 있습니다.');
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

    // 5. 카테고리 판별 & 필터링 바
    function getNotificationCategory(item) {
        const type = (item.type || '').toLowerCase();
        const full = `${type} ${(item.title || '')} ${(item.body || '')}`.toLowerCase();
        if (type === 'breaking' || full.includes('속보')) return { key: 'breaking', label: '속보', icon: '🚨', colorClass: 'cat-breaking' };
        if (type === 'calendar' || full.includes('일정') || full.includes('캘린더')) return { key: 'calendar', label: '일정', icon: '📅', colorClass: 'cat-calendar' };
        if (type === 'weather' || full.includes('날씨') || full.includes('기온') || full.includes('강수')) return { key: 'weather', label: '날씨', icon: '🌤️', colorClass: 'cat-weather' };
        if (['asset', 'economy', 'finance', 'stock'].includes(type) || full.includes('증시') || full.includes('환율') || full.includes('코스피')) return { key: 'finance', label: '금융', icon: '💰', colorClass: 'cat-finance' };
        if (['blood_pressure', 'medication', 'hospital'].includes(type) || full.includes('혈압') || full.includes('복약') || full.includes('병원')) return { key: 'health', label: '건강', icon: '🩸', colorClass: 'cat-health' };
        if (['system', 'backup', 'server'].includes(type) || full.includes('서버') || full.includes('다운')) return { key: 'system', label: '시스템', icon: '🖥️', colorClass: 'cat-system' };
        return { key: 'general', label: '일반', icon: '🔔', colorClass: 'cat-general' };
    }
    function renderCategoryChips() {
        const barEl = document.getElementById('notifCategoryBar');
        if (!barEl) return;
        const counts = { all: notifHistoryListItems.length }, unreads = { all: 0 };
        NOTIF_CATEGORIES.forEach(c => { if (c.key !== 'all') { counts[c.key] = 0; unreads[c.key] = 0; } });
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
        const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
        if (!m) return String(dateStr).replace('T', ' ').slice(5, 16);
        const target = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10));
        const diffMs = Date.now() - target;
        if (new Date().toDateString() === target.toDateString()) {
            if (diffMs < 60000) return '방금 전';
            const mins = Math.floor(diffMs / 60000);
            return mins < 60 ? `${mins}분 전` : `${Math.floor(mins / 60)}시간 전`;
        }
        return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
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
            countLabel.textContent = `${catName} 알림 (${filtered.length}/${notifHistoryTotal}건${unreadTxt})`;
        }
        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: #71717a; padding: 3rem 0; font-size: 0.88rem;">해당 분류의 알림 내역이 없습니다.</div>';
            if (loadMoreBox) loadMoreBox.style.display = 'none';
            return;
        }
        listEl.innerHTML = filtered.map(item => {
            const cat = getNotificationCategory(item);
            const timeStr = formatNotificationTime(item.created_at);
            const linkUrl = item.url || '#';
            const isUnread = item.is_read === 0;
            const newBadge = isUnread ? '<span class="notif-badge-new">NEW</span>' : '';
            const safeUrl = linkUrl.replace(/'/g, "\\'");
            return `
                <div class="notif-card-item ${isUnread ? 'is-unread' : 'is-read'}" id="notif-card-${item.id}">
                    <div class="notif-card-header">
                        <span class="notif-card-category-badge ${cat.colorClass}">
                            <span>${cat.icon}</span> <span>${cat.label}</span>
                        </span>
                        <div class="notif-card-meta">
                            <span class="notif-card-time">${timeStr}</span>
                            ${newBadge}
                        </div>
                    </div>
                    <div class="notif-card-content">
                        <h4 class="notif-card-title">${escapeHtml(item.title || '알림')}</h4>
                        <p class="notif-card-body">${escapeHtml(item.body || '')}</p>
                        <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.45rem;">
                            <button type="button" onclick="openAndReadNotification(${item.id}, '${safeUrl}')" class="btn-history-tool" style="padding:2px 8px; font-size:0.75rem;">바로가기 ↗</button>
                            ${isUnread ? `<button type="button" onclick="markSingleAsRead(${item.id})" class="btn-history-tool" style="padding:2px 8px; font-size:0.75rem;">읽음</button>` : ''}
                            <button type="button" onclick="deleteNotificationItem(${item.id})" class="btn-history-tool btn-danger-tool" style="padding:2px 8px; font-size:0.75rem; margin-left:auto;">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        if (loadMoreBox) loadMoreBox.style.display = notifHistoryListItems.length < notifHistoryTotal ? 'block' : 'none';
    }

    // 6. 알림 수신 내역 비동기 조회 & 상태 관리
    window.refreshNotificationHistory = function() {
        notifHistoryOffset = 0;
        notifHistoryListItems = [];
        window.fetchNotificationHistory(false);
    };
    window.loadMoreNotificationHistory = function() {
        notifHistoryOffset += NOTIF_HISTORY_LIMIT;
        window.fetchNotificationHistory(true);
    };
    window.fetchNotificationHistory = async function(isAppend = false) {
        try {
            const res = await fetch(`/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`);
            if (!res.ok) return;
            const data = await res.json();
            const history = data.history || [];
            const unreadCount = data.unreadCount || 0;
            notifHistoryTotal = data.totalCount || 0;
            const updateBadge = (id, cnt) => {
                const b = document.getElementById(id);
                if (b) { b.textContent = cnt; b.style.display = cnt > 0 ? 'inline-block' : 'none'; }
            };
            ['unavNotifBadge', 'unavMobileNotifBadge', 'notifHistoryBadge'].forEach(id => updateBadge(id, unreadCount));
            notifHistoryListItems = isAppend ? notifHistoryListItems.concat(history) : history;
            renderCategoryChips();
            renderFilteredNotificationList();
        } catch (e) {
            console.error('[Notification] 내역 조회 오류:', e);
        }
    };
    window.markAllNotificationsAsRead = async function() {
        try {
            const res = await fetch('/api/notification/history/read-all', { method: 'POST' });
            const data = await res.json();
            if (data.success) window.refreshNotificationHistory();
        } catch (e) { console.error('전체 읽음 처리 오류:', e); }
    };
    window.openAndReadNotification = async function(id, url) {
        try { await fetch(`/api/notification/history/${id}/read`, { method: 'POST', keepalive: true }); } catch (e) {}
        if (url && url !== '#') window.location.href = url;
        else window.markSingleAsRead(id);
    };
    window.markSingleAsRead = async function(id) {
        try {
            await fetch(`/api/notification/history/${id}/read`, { method: 'POST' });
            const item = notifHistoryListItems.find(i => i.id === id);
            if (item) item.is_read = 1;
            renderCategoryChips();
            renderFilteredNotificationList();
            const b = document.getElementById('unavNotifBadge');
            if (b) {
                const cur = Math.max(0, parseInt(b.textContent || '1', 10) - 1);
                b.textContent = cur;
                b.style.display = cur > 0 ? 'inline-block' : 'none';
            }
        } catch (e) {}
    };
    window.deleteNotificationItem = async function(id) {
        if (!confirm('이 알림을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/notification/history/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) window.refreshNotificationHistory();
        } catch (e) { alert('삭제 오류: ' + e.message); }
    };
    window.clearAllNotificationHistory = async function() {
        if (!confirm('모든 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch('/api/notification/history/clear/all', { method: 'DELETE' });
            const data = await res.json();
            if (data.success) window.refreshNotificationHistory();
        } catch (e) { alert('전체 삭제 오류: ' + e.message); }
    };

    // 7. 웹 푸시 구독
    async function registerWebPushSubscription() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        if (Notification.permission !== 'granted') return;
        try {
            const keyRes = await fetch('/api/notification/vapid-key');
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
            await fetch('/api/notification/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub })
            });
        } catch (e) { console.error('[WebPush] 구독 오류:', e); }
    }
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 8. 뱃지 카운트 초기화 및 60초 주기 갱신
    async function initUnreadBadge() {
        try {
            const res = await fetch('/api/notification/unread-count');
            if (!res.ok) return;
            const data = await res.json();
            const cnt = data.unreadCount || 0;
            ['unavNotifBadge', 'unavMobileNotifBadge'].forEach(id => {
                const b = document.getElementById(id);
                if (b) { b.textContent = cnt; b.style.display = cnt > 0 ? 'inline-block' : 'none'; }
            });
        } catch (e) {}
    }
    const init = () => { initUnreadBadge(); setInterval(initUnreadBadge, 60000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();