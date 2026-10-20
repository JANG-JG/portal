/**
 * 🔔 JG 포털 전용 통합 알림 센터 엔진 (portal-notification.js)
 * - 외부 의존성 없이 단독 동작하는 완전한 알림 센터 모달 컨트롤러
 * - 실시간 미확인 배지 카운트 + 알림 수신 내역 + 맞춤 알림 설정 + 브라우저 웹 푸시 연동
 * - 모듈화 표준 (500줄 이하) 준수
 */
(function() {
    'use strict';

    let portalNotifSettings = {
        enabled: 1,
        hospital_push_enabled: 1,
        breaking_news_enabled: 1,
        weather_morning_enabled: 1,
        weather_morning_time: '07:00',
        asset_report_enabled: 1,
        asset_open_enabled: 1,
        asset_close_enabled: 1,
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

    // 1. 모달 열기 및 닫기
    window.openNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (!modal) return;
        modal.classList.add('open');
        modal.style.setProperty('display', 'flex', 'important');
        document.body.style.overflow = 'hidden';
        switchNotifMainTab('history');
        updateBrowserPermissionUI();
        fetchNotificationSettings();
        fetchNotificationHistory(false);
    };

    window.closeNotificationModal = function() {
        const modal = document.getElementById('notificationModal');
        if (modal) {
            modal.classList.remove('open');
            modal.style.setProperty('display', 'none', 'important');
        }
        document.body.style.overflow = '';
    };

    // 모달 배경 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'notificationModal') {
            window.closeNotificationModal();
        }
    });

    // 2. 메인 탭 (수신 내역 vs 설정)
    window.switchNotifMainTab = function(tab) {
        const isSettings = tab === 'settings';
        const settingsView = document.getElementById('notifMainViewSettings');
        const historyView = document.getElementById('notifMainViewHistory');
        const settingsTab = document.getElementById('notifMainTabSettings');
        const historyTab = document.getElementById('notifMainTabHistory');

        if (settingsView) settingsView.style.display = isSettings ? 'block' : 'none';
        if (historyView) historyView.style.display = isSettings ? 'none' : 'block';
        if (settingsTab) settingsTab.classList.toggle('active', isSettings);
        if (historyTab) historyTab.classList.toggle('active', !isSettings);

        if (!isSettings) {
            fetchNotificationHistory(false);
        }
    };

    // 3. 서브 탭 (평일 vs 주말 알림 시간)
    window.switchNotifSubTab = function(type) {
        const isWeekday = type === 'weekday';
        const weekdayView = document.getElementById('notifSubTabWeekday');
        const weekendView = document.getElementById('notifSubTabWeekend');
        const weekdayTab = document.getElementById('notifTabWeekday');
        const weekendTab = document.getElementById('notifTabWeekend');

        if (weekdayView) weekdayView.style.display = isWeekday ? 'block' : 'none';
        if (weekendView) weekendView.style.display = isWeekday ? 'none' : 'block';
        if (weekdayTab) weekdayTab.classList.toggle('active', isWeekday);
        if (weekendTab) weekendTab.classList.toggle('active', !isWeekday);
    };

    // 4. 브라우저 알림 권한 UI
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

    window.requestBrowserNotificationPermission = async function() {
        if (!('Notification' in window)) {
            alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
            return;
        }
        const perm = await Notification.requestPermission();
        updateBrowserPermissionUI();
        if (perm === 'granted') {
            await registerWebPushSubscription();
            alert('🎉 알림 권한이 허용되었습니다!');
        } else {
            alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
        }
    };

    // 5. 알림 설정 페치 및 저장
    window.fetchNotificationSettings = async function() {
        try {
            const res = await fetch('/api/notification/settings');
            if (!res.ok) return;
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
                setCheck('notifAssetOpenEnabled', portalNotifSettings.asset_open_enabled !== 0);
                setCheck('notifAssetCloseEnabled', portalNotifSettings.asset_close_enabled !== 0);
                setCheck('notifBpReminderEnabled', portalNotifSettings.bp_reminder_enabled);
                setCheck('notifHospitalPushEnabled', portalNotifSettings.hospital_push_enabled);
                setCheck('notifSystemAlertEnabled', portalNotifSettings.system_alert_enabled);

                const setVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el && val) el.value = val;
                };
                setVal('inputWeatherTime', portalNotifSettings.weather_morning_time || '07:00');
                setVal('inputBpReminderTime', portalNotifSettings.bp_reminder_time || '21:00');

                renderNotifChips();
            }
        } catch (e) {
            console.error('[Notification] 설정 조회 실패:', e);
        }
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
        if (reportEl) reportEl.checked = (openEl && openEl.checked) || (closeEl && closeEl.checked);
    };

    window.toggleNotifMaster = function(checked) {
        portalNotifSettings.enabled = checked ? 1 : 0;
        document.querySelectorAll('#notifMainViewSettings input[type="checkbox"]').forEach(cb => {
            if (cb.id !== 'notifMasterEnabled') cb.checked = checked;
        });
    };

    function renderNotifChips() {
        const renderBox = (containerId, arr, key) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (!arr || arr.length === 0) {
                container.innerHTML = '<span style="font-size:0.75rem; color:#71717a;">등록된 시간 없음</span>';
                return;
            }
            container.innerHTML = arr.map((t, idx) => `
                <span class="notif-time-chip" style="display:inline-flex; align-items:center; gap:4px; background:#18181b; border:1px solid #27272a; border-radius:4px; padding:2px 6px; font-size:0.75rem; color:#f4f4f5; margin-right:4px;">
                    <span>⏰ ${t}</span>
                    <button type="button" onclick="removeNotifTime('${key}', ${idx})" style="background:none; border:none; color:#a1a1aa; cursor:pointer;" title="삭제">✕</button>
                </span>
            `).join('');
        };
        renderBox('containerWeekdayMedTimes', portalNotifSettings.weekday_med_times, 'weekday_med_times');
        renderBox('containerWeekdayBpTimes', portalNotifSettings.weekday_bp_times, 'weekday_bp_times');
        renderBox('containerWeekendMedTimes', portalNotifSettings.weekend_med_times, 'weekend_med_times');
        renderBox('containerWeekendBpTimes', portalNotifSettings.weekend_bp_times, 'weekend_bp_times');
    }

    window.addNotifTime = function(dayType, category) {
        const inputId = dayType === 'weekday'
            ? (category === 'med' ? 'inputWeekdayMedTime' : 'inputWeekdayBpTime')
            : (category === 'med' ? 'inputWeekendMedTime' : 'inputWeekendBpTime');
        const key = `${dayType}_${category}_times`;
        const inputEl = document.getElementById(inputId);
        if (!inputEl || !inputEl.value) { alert('추가할 알림 시간을 먼저 선택해 주세요.'); return; }
        const val = inputEl.value;
        if (!portalNotifSettings[key]) portalNotifSettings[key] = [];
        if (portalNotifSettings[key].includes(val)) { alert('이미 등록된 시간입니다.'); return; }
        portalNotifSettings[key].push(val);
        portalNotifSettings[key].sort();
        inputEl.value = '';
        renderNotifChips();
    };

    window.removeNotifTime = function(key, index) {
        if (portalNotifSettings[key]) {
            portalNotifSettings[key].splice(index, 1);
            renderNotifChips();
        }
    };

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
            const saveRes = await fetch('/api/notification/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(portalNotifSettings)
            });
            const result = await saveRes.json();
            if (portalNotifSettings.enabled) {
                await registerWebPushSubscription();
            }
            updateBrowserPermissionUI();
            alert(result.message || '알림 설정이 성공적으로 저장되었습니다.');
            window.closeNotificationModal();
        } catch (err) {
            console.error('[알림 설정 저장 오류]:', err);
            alert('알림 설정 저장 중 오류가 발생했습니다.');
        }
    };

    // 6. 알림 수신 내역 조회 & 읽음/삭제 처리
    window.refreshNotificationHistory = function() {
        notifHistoryOffset = 0;
        notifHistoryListItems = [];
        fetchNotificationHistory(false);
    };

    window.loadMoreNotificationHistory = function() {
        notifHistoryOffset += NOTIF_HISTORY_LIMIT;
        fetchNotificationHistory(true);
    };

    window.fetchNotificationHistory = async function(isAppend = false) {
        const listEl = document.getElementById('notifHistoryList');
        const loadMoreBox = document.getElementById('notifLoadMoreBox');
        const countLabel = document.getElementById('notifHistoryCountLabel');

        try {
            const res = await fetch(`/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`);
            if (!res.ok) return;
            const data = await res.json();
            const history = data.history || [];
            const unreadCount = data.unreadCount || 0;
            notifHistoryTotal = data.totalCount || 0;

            // 뱃지 업데이트
            const updateBadge = (id, cnt) => {
                const b = document.getElementById(id);
                if (b) {
                    b.textContent = cnt;
                    b.style.display = cnt > 0 ? 'inline-block' : 'none';
                }
            };
            updateBadge('unavNotifBadge', unreadCount);
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
                listEl.innerHTML = '<div style="text-align: center; color: #71717a; padding: 2.5rem 0; font-size: 0.88rem;">수신된 푸시 알림 내역이 없습니다.</div>';
                if (loadMoreBox) loadMoreBox.style.display = 'none';
                return;
            }

            const typeIconMap = {
                'breaking': '🚨', 'weather': '🌤️', 'asset': '💰', 'economy': '💰',
                'blood_pressure': '🩸', 'medication': '💊', 'hospital': '🏥', 'system': '🖥️', 'test': '🔔'
            };

            listEl.innerHTML = notifHistoryListItems.map(item => {
                const icon = typeIconMap[item.type] || '🔔';
                const timeStr = item.created_at ? item.created_at.replace('T', ' ').slice(5, 16) : '';
                const linkUrl = item.url || '#';
                const isUnread = item.is_read === 0;
                const cardClass = isUnread ? 'notif-history-card is-unread' : 'notif-history-card is-read';
                const newBadge = isUnread ? '<span class="badge-unread-dot" style="background:#f43f5e; color:#fff; font-size:0.65rem; font-weight:700; padding:1px 5px; border-radius:3px;">NEW</span>' : '';

                return `
                    <div class="${cardClass}" id="notif-card-${item.id}" style="background:${isUnread ? '#18181b' : '#121215'}; border:1px solid ${isUnread ? '#3f3f46' : '#27272a'}; border-radius:8px; padding:0.75rem 0.85rem; margin-bottom:0.5rem; display:flex; gap:0.65rem; align-items:flex-start;">
                        <span style="font-size:1.25rem; line-height:1; flex-shrink:0;">${icon}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                                <div style="display:flex; align-items:center; gap:0.35rem; min-width:0;">
                                    ${newBadge}
                                    <span style="font-weight:700; font-size:0.85rem; color:#f4f4f5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title || '알림'}</span>
                                </div>
                                <span style="font-size:0.72rem; color:#71717a; flex-shrink:0;">${timeStr}</span>
                            </div>
                            <p style="margin:0 0 0.45rem; font-size:0.8rem; color:#a1a1aa; line-height:1.4;">${item.body || ''}</p>
                            <div style="display:flex; align-items:center; gap:0.4rem;">
                                <button type="button" onclick="openAndReadNotification(${item.id}, '${linkUrl}')" style="background:#27272a; border:none; border-radius:4px; color:#f4f4f5; font-size:0.72rem; padding:3px 8px; cursor:pointer;">바로가기 ↗</button>
                                ${isUnread ? `<button type="button" onclick="markSingleAsRead(${item.id})" style="background:#18181b; border:1px solid #27272a; border-radius:4px; color:#a1a1aa; font-size:0.72rem; padding:2px 7px; cursor:pointer;">읽음</button>` : ''}
                                <button type="button" onclick="deleteNotificationItem(${item.id})" style="background:transparent; border:none; color:#71717a; font-size:0.72rem; padding:2px 5px; cursor:pointer; margin-left:auto;">🗑️</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (loadMoreBox) {
                loadMoreBox.style.display = notifHistoryListItems.length < notifHistoryTotal ? 'block' : 'none';
            }
        } catch (e) {
            console.error('[Notification] 내역 조회 오류:', e);
            if (listEl) listEl.innerHTML = '<div style="text-align: center; color: #f43f5e; padding: 2rem 0; font-size: 0.85rem;">알림 내역을 불러오지 못했습니다.</div>';
        }
    };

    window.markAllNotificationsAsRead = async function() {
        try {
            const res = await fetch('/api/notification/history/read-all', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                refreshNotificationHistory();
            }
        } catch (e) {
            console.error('전체 읽음 처리 오류:', e);
        }
    };

    window.openAndReadNotification = async function(id, url) {
        try {
            await fetch(`/api/notification/history/${id}/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true
            });
        } catch (e) {}
        if (url && url !== '#') {
            window.location.href = url;
        } else {
            markSingleAsRead(id);
        }
    };

    window.markSingleAsRead = async function(id) {
        try {
            await fetch(`/api/notification/history/${id}/read`, { method: 'POST' });
            const card = document.getElementById(`notif-card-${id}`);
            if (card) {
                card.style.background = '#121215';
                card.style.borderColor = '#27272a';
                const badge = card.querySelector('.badge-unread-dot');
                if (badge) badge.remove();
            }
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
            if (data.success) refreshNotificationHistory();
        } catch (e) { alert('삭제 오류: ' + e.message); }
    };

    window.clearAllNotificationHistory = async function() {
        if (!confirm('모든 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch('/api/notification/history/clear/all', { method: 'DELETE' });
            const data = await res.json();
            if (data.success) refreshNotificationHistory();
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
                const outputArray = new Uint8Array(rawData.length);
                for (let i = 0; i < rawData.length; ++i) {
                    outputArray[i] = rawData.charCodeAt(i);
                }
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: outputArray
                });
            }
            await fetch('/api/notification/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub, userAgent: navigator.userAgent })
            });
        } catch (e) {
            console.warn('[Push] 구독 등록 실패:', e);
        }
    }

    function bindNotifTrigger() {
        const btn = document.getElementById('btnNotifCenter');
        if (btn && !btn.dataset.boundClick) {
            btn.dataset.boundClick = 'true';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                window.openNotificationModal();
            });
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('notificationModal');
            if (modal && (modal.classList.contains('open') || modal.style.display === 'flex')) {
                window.closeNotificationModal();
            }
        }
    });

    // 8. 초기 로드
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            bindNotifTrigger();
            fetchNotificationHistory(false);
            setTimeout(registerWebPushSubscription, 1500);
        });
    } else {
        bindNotifTrigger();
        fetchNotificationHistory(false);
        setTimeout(registerWebPushSubscription, 1500);
    }
})();
