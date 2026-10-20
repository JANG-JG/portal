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

        function openNotificationModal() {
            const modal = document.getElementById('notificationModal');
            if (!modal) return;
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            switchNotifMainTab('history');
            updateBrowserPermissionUI();
            fetchNotificationSettings();
            fetchNotificationHistory();
        }

        function closeNotificationModal() {
            const modal = document.getElementById('notificationModal');
            if (modal) modal.style.display = 'none';
            document.body.style.overflow = '';
        }

        // 모달 배경 클릭 시 닫기
        document.getElementById('notificationModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'notificationModal') {
                closeNotificationModal();
            }
        });

        function switchNotifMainTab(tab) {
            const isSettings = tab === 'settings';
            document.getElementById('notifMainViewSettings').style.display = isSettings ? 'block' : 'none';
            document.getElementById('notifMainViewHistory').style.display = isSettings ? 'none' : 'block';
            document.getElementById('notifMainTabSettings').classList.toggle('active', isSettings);
            document.getElementById('notifMainTabHistory').classList.toggle('active', !isSettings);
            if (!isSettings) {
                fetchNotificationHistory();
            }
        }

        function switchNotifSubTab(type) {
            const isWeekday = type === 'weekday';
            document.getElementById('notifSubTabWeekday').style.display = isWeekday ? 'block' : 'none';
            document.getElementById('notifSubTabWeekend').style.display = isWeekday ? 'none' : 'block';
            document.getElementById('notifTabWeekday').classList.toggle('active', isWeekday);
            document.getElementById('notifTabWeekend').classList.toggle('active', !isWeekday);
        }

        function updateBrowserPermissionUI() {
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
        }

        async function requestBrowserNotificationPermission() {
            if (!('Notification' in window)) {
                alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
                return;
            }
            const perm = await Notification.requestPermission();
            updateBrowserPermissionUI();
            if (perm === 'granted') {
                await registerWebPushSubscription();
                alert('🎉 알림 권한이 성공적으로 허용되었습니다!');
            } else {
                alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
            }
        }

        async function fetchNotificationSettings() {
            try {
                const res = await fetch('/api/notification/settings');
                const data = await res.json();
                if (data.success && data.settings) {
                    portalNotifSettings = data.settings;
                    // 체크박스 반영
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

                    // 시간 입력값 반영
                    const setVal = (id, val) => {
                        const el = document.getElementById(id);
                        if (el && val) el.value = val;
                    };
                    setVal('inputWeatherTime', portalNotifSettings.weather_morning_time || '07:00');
                    setVal('inputBpReminderTime', portalNotifSettings.bp_reminder_time || '21:00');

                    renderNotifChips();
                }
            } catch (e) {
                console.error('[포털 알림 설정 조회 실패]:', e);
            }
        }

        function toggleAssetSubOptions(checked) {
            const openEl = document.getElementById('notifAssetOpenEnabled');
            const closeEl = document.getElementById('notifAssetCloseEnabled');
            if (openEl) openEl.checked = checked;
            if (closeEl) closeEl.checked = checked;
        }

        function handleAssetSubOptionChange() {
            const openEl = document.getElementById('notifAssetOpenEnabled');
            const closeEl = document.getElementById('notifAssetCloseEnabled');
            const reportEl = document.getElementById('notifAssetReportEnabled');
            const hasAny = (openEl && openEl.checked) || (closeEl && closeEl.checked);
            if (reportEl) reportEl.checked = hasAny;
        }

        function renderNotifChips() {
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
        }

        function addNotifTime(dayType, category) {
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
            renderNotifChips();
        }

        function removeNotifTime(key, index) {
            if (portalNotifSettings[key]) {
                portalNotifSettings[key].splice(index, 1);
                renderNotifChips();
            }
        }

        async function saveNotificationSettings() {
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

                // 푸시 권한이 활성화되어 있으면 브라우저 토큰 재등록
                if (portalNotifSettings.enabled) {
                    await registerWebPushSubscription();
                }

                updateBrowserPermissionUI();
                alert(result.message || '알림 설정이 성공적으로 저장되었습니다.');
                closeNotificationModal();
            } catch (err) {
                console.error('[알림 설정 저장 오류]:', err);
                alert('알림 설정 저장 중 오류가 발생했습니다.');
            }
        }

        async function registerWebPushSubscription() {
            if (typeof window.registerWebPushSubscription === 'function' && window.registerWebPushSubscription !== registerWebPushSubscription) {
                return window.registerWebPushSubscription();
            }
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            if (Notification.permission !== 'granted') return;

            try {
                const keyRes = await fetch('/api/notification/vapid-key');
                const { publicKey } = await keyRes.json();
                if (!publicKey) return;

                const reg = await navigator.serviceWorker.ready;
                let sub = await reg.pushManager.getSubscription();

                if (!sub) {
                    const convertedKey = urlBase64ToUint8Array(publicKey);
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: convertedKey
                    });
                }

                const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                                     window.matchMedia('(display-mode: fullscreen)').matches ||
                                     window.matchMedia('(display-mode: minimal-ui)').matches ||
                                     window.navigator.standalone === true;
                const clientType = isStandalone ? 'pwa' : 'browser';
                const ua = navigator.userAgent.toLowerCase();
                const deviceType = (/ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk/i.test(ua)) ? 'tablet' : (/mobi|iphone|ipod|android/i.test(ua) ? 'mobile' : 'desktop');

                let deviceId = '';
                try {
                    deviceId = localStorage.getItem('jg_device_id') || ('dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9));
                    localStorage.setItem('jg_device_id', deviceId);
                } catch(e) { deviceId = 'unknown'; }

                await fetch('/api/notification/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subscription: sub,
                        clientType,
                        deviceType,
                        deviceId,
                        userAgent: navigator.userAgent
                    })
                });
                console.log(`✅ 포털 웹 푸시 구독 등록 완료 (${deviceType} / ${clientType.toUpperCase()})`);
            } catch (e) {
                console.error('[푸시 구독 등록 실패]:', e);
            }
        }

        async function sendTestNotification() {
            try {
                const res = await fetch('/api/notification/test', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    alert('🎉 기기로 테스트 푸시 알림이 발송되었습니다!\n수신 내역 탭에서도 확인하실 수 있습니다.');
                    setTimeout(fetchNotificationHistory, 500);
                } else {
                    alert('테스트 알림 발송 실패: ' + (data.message || '서버 응답 오류'));
                }
            } catch (e) {
                alert('테스트 알림 요청 중 오류 발생: ' + e.message);
            }
        }

        let notifHistoryOffset = 0;
        const NOTIF_HISTORY_LIMIT = 30;
        let notifHistoryTotal = 0;
        let notifHistoryListItems = [];

        function refreshNotificationHistory() {
            notifHistoryOffset = 0;
            notifHistoryListItems = [];
            fetchNotificationHistory(false);
        }

        function loadMoreNotificationHistory() {
            notifHistoryOffset += NOTIF_HISTORY_LIMIT;
            fetchNotificationHistory(true);
        }

        async function fetchNotificationHistory(isAppend = false) {
            const listEl = document.getElementById('notifHistoryList');
            const loadMoreBox = document.getElementById('notifLoadMoreBox');
            const countLabel = document.getElementById('notifHistoryCountLabel');

            try {
                const res = await fetch(`/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`);
                const data = await res.json();
                const history = data.history || [];
                const unreadCount = data.unreadCount || 0;
                notifHistoryTotal = data.totalCount || 0;

                // 🌟 상단바 배지는 '안 읽은 알림(unreadCount)'만 표시! (0건이면 완전 숨김)
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
                    'economy': '💰',
                    'finance': '💰',
                    'stock': '💰',
                    'blood_pressure': '🩸',
                    'medication': '💊',
                    'hospital': '🏥',
                    'system': '🖥️',
                    'test': '🔔'
                };

                listEl.innerHTML = notifHistoryListItems.map(item => {
                    let icon = typeIconMap[item.type];
                    if (!icon) {
                        if (item.icon && (item.icon.startsWith('http://') || item.icon.startsWith('https://') || item.icon.startsWith('/'))) {
                            icon = '🔔';
                        } else {
                            icon = item.icon || '🔔';
                        }
                    }
                    // URL 문자열이 포함되어 있다면 무조건 안전한 이모지로 치환 (주소 텍스트 노출 원천 봉쇄)
                    if (typeof icon === 'string' && (icon.includes('http://') || icon.includes('https://') || icon.includes('.png') || icon.includes('.svg'))) {
                        icon = typeIconMap[item.type] || '🔔';
                    }
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

                // 더보기 버튼 표시 여부
                if (loadMoreBox) {
                    loadMoreBox.style.display = notifHistoryListItems.length < notifHistoryTotal ? 'block' : 'none';
                }

            } catch (e) {
                console.error('[알림 내역 조회 오류]:', e);
                if (listEl) listEl.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 2rem 0; font-size: 0.88rem;">알림 내역을 불러오지 못했습니다.</div>';
            }
        }

        // 전체 읽음 처리
        async function markAllNotificationsAsRead() {
            try {
                const res = await fetch('/api/notification/history/read-all', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    refreshNotificationHistory();
                } else {
                    alert('읽음 처리 실패: ' + (data.message || '오류'));
                }
            } catch (e) {
                console.error('전체 읽음 처리 오류:', e);
            }
        }

        // 개별 읽음 처리 후 페이지 이동
        async function openAndReadNotification(id, url) {
            try {
                await fetch(`/api/notification/history/${id}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    keepalive: true
                });
            } catch (e) {
                console.error('Failed to mark read', e);
            }

            if (url && url !== '#') {
                window.location.href = url;
            } else {
                markSingleAsRead(id);
            }
        }

        // 개별 읽음 처리 (UI 즉시 반영)
        async function markSingleAsRead(id) {
            try {
                const res = await fetch(`/api/notification/history/${id}/read`, { method: 'POST' });
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

                    // 미확인 배지 -1
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
        }

        async function deleteNotificationItem(id) {
            if (!confirm('이 알림 내역을 삭제하시겠습니까?')) return;
            try {
                const res = await fetch(`/api/notification/history/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    refreshNotificationHistory();
                } else {
                    alert('삭제 실패: ' + (data.message || '오류'));
                }
            } catch (e) {
                alert('삭제 중 오류: ' + e.message);
            }
        }

        async function clearAllNotificationHistory() {
            if (!confirm('수신된 모든 알림 내역을 삭제하시겠습니까?')) return;
            try {
                const res = await fetch('/api/notification/history/clear/all', { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    fetchNotificationHistory();
                } else {
                    alert('전체 삭제 실패: ' + (data.message || '오류'));
                }
            } catch (e) {
                alert('전체 삭제 중 오류: ' + e.message);
            }
        }

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

        // 페이지 진입 시 초기 배지 로드 및 자동 구독 갱신
        window.addEventListener('DOMContentLoaded', () => {
            fetchNotificationHistory();
            setTimeout(registerWebPushSubscription, 1500);

            // 🔔 외부 링크(?open=notification 또는 #notification)로부터 유입 시 알림 모달 즉시 오픈 및 주소창 정리
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('open') === 'notification' || window.location.hash === '#notification') {
                setTimeout(() => {
                    openNotificationModal();
                }, 200);
                urlParams.delete('open');
                const cleanQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
                const cleanHash = window.location.hash === '#notification' ? '' : window.location.hash;
                window.history.replaceState({}, document.title, window.location.pathname + cleanQuery + cleanHash);
            }
        });
