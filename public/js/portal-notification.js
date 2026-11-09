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

    // 🎨 사이트 특성 능동 감지 및 화이트/다크 테마 적용 엔진
    function applyNotifAdaptiveTheme(modal) {
        if (!modal) modal = document.getElementById('notificationModal');
        if (!modal) return;
        const htmlEl = document.documentElement, bodyEl = document.body;
        const isPortalMain = window.location.pathname === '/' || window.location.pathname === '/index.html' || !!document.getElementById('portal-tab-bar');
        if (isPortalMain) {
            modal.classList.remove('dark-zinc', 'theme-dark');
            return;
        }
        const hasDarkClass = htmlEl.classList.contains('dark') || bodyEl.classList.contains('dark');
        if (hasDarkClass) modal.classList.add('dark-zinc', 'theme-dark');
        else modal.classList.remove('dark-zinc', 'theme-dark');
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
        if ('Notification' in window && Notification.permission === 'granted') {
            window.registerWebPushSubscription().then(() => {
                window.updateBrowserPermissionUI();
            }).catch(() => {});
        }
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
            if (tEl) tEl.textContent = '🔄 기기 알림 연결 상태 확인 중...';
            if (bEl) {
                bEl.style.display = 'inline-block';
                bEl.textContent = '기기 연결 갱신';
            }
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
                    if (sub) {
                        if (tEl) tEl.textContent = '✅ 기기 푸시 알림 수신 연결됨';
                        if (bEl) bEl.textContent = '기기 연결 갱신';
                    } else {
                        if (tEl) tEl.textContent = '⚠️ 알림 권한 허용됨 (기기 등록 필요)';
                        if (bEl) bEl.textContent = '기기 지금 등록';
                    }
                }).catch(() => {
                    if (tEl) tEl.textContent = '✅ 브라우저 푸시 알림 수신 활성화';
                });
            }
        } else if (Notification.permission === 'denied') {
            if (tEl) tEl.textContent = '🚫 알림이 차단되어 있습니다. 사이트 설정에서 허용해 주세요.';
            if (bEl) {
                bEl.style.display = 'inline-block';
                bEl.textContent = '해제 방법';
            }
        } else {
            if (tEl) tEl.textContent = '⚠️ 푸시 알림 권한이 필요합니다. [권한 허용]을 눌러주세요.';
            if (bEl) {
                bEl.style.display = 'inline-block';
                bEl.textContent = '권한 허용';
            }
        }
    };
    window.requestBrowserNotificationPermission = async function() {
        if (!('Notification' in window)) return alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
        if (Notification.permission === 'denied') {
            return alert('🚫 브라우저 알림이 차단되어 있습니다.\n\n[해결 방법]\n1. 브라우저 주소창 좌측(또는 우측)의 자물쇠/설정 아이콘을 터치하세요.\n2. [사이트 설정] -> [알림] -> [허용]으로 변경해 주세요.\n(스마트폰의 경우: [설정] -> [애플리케이션] -> [웹앱 또는 브라우저] -> [알림 허용])');
        }
        try {
            let perm = Notification.permission;
            if (perm !== 'granted') {
                perm = await Notification.requestPermission();
            }
            window.updateBrowserPermissionUI();
            if (perm === 'granted') {
                const regRes = await window.registerWebPushSubscription(true);
                window.updateBrowserPermissionUI();
                if (regRes && regRes.success) {
                    alert('🎉 현재 기기가 푸시 알림 수신 대상으로 성공적으로 등록되었습니다!');
                } else if (regRes && regRes.message) {
                    alert('알림 권한은 허용되었으나 기기 등록 실패:\n' + regRes.message);
                } else {
                    alert('🎉 알림 권한이 허용되었습니다.');
                }
            } else {
                alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
            }
        } catch (e) {
            console.error('권한 요청 실패:', e);
            alert('알림 권한 요청 중 오류 발생: ' + (e.message || e));
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
            if ('Notification' in window && Notification.permission === 'granted') {
                await window.registerWebPushSubscription().catch(() => {});
            }
            const res = await fetch('/api/notification/test', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                if (data.count && data.count > 0) {
                    alert(`🎉 등록된 기기(${data.count}대)로 테스트 푸시 알림이 발송되었습니다!\n스마트폰 상단 알림바를 확인해 보세요.`);
                } else {
                    const retry = confirm('⚠️ 알림 권한은 허용되어 있으나 서버에 연결된 기기 토큰이 없습니다.\n지금 이 기기를 푸시 수신 대상으로 등록하시겠습니까?');
                    if (retry) {
                        const regRes = await window.registerWebPushSubscription();
                        window.updateBrowserPermissionUI();
                        if (regRes && regRes.success) {
                            alert('✅ 기기 등록 완료! 다시 테스트 발송을 진행합니다.');
                            return window.sendTestNotification();
                        } else {
                            alert('기기 등록 실패: ' + (regRes && regRes.message ? regRes.message : '알 수 없는 오류'));
                        }
                    }
                }
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

    // 5. 카테고리 알림 끄기(Mute) 핸들러 (수신 내역 카드의 🔕 메뉴에서 호출)
    window.muteNotificationCategory = async function(catKey, catLabel) {
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
        } else if (catKey === 'health') {
            portalNotifSettings.bp_reminder_enabled = 0; portalNotifSettings.hospital_push_enabled = 0;
            setC('notifBpReminderEnabled', false); setC('notifHospitalPushEnabled', false);
        }
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
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const out = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
        return out;
    }

    window.registerWebPushSubscription = async function(forceResubscribe = false) {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return { success: false, message: '현재 브라우저가 웹 푸시를 지원하지 않습니다.' };
        }
        try {
            const meta = getDevicePushMetadata();
            if (Notification.permission !== 'granted') {
                return { success: false, message: '브라우저 알림 권한이 허용되지 않았습니다.' };
            }

            const keyRes = await fetch('/api/notification/vapid-key', { credentials: 'include' });
            if (!keyRes.ok) return { success: false, message: '서버 VAPID 공개키 조회에 실패했습니다.' };
            const { publicKey } = await keyRes.json();
            if (!publicKey) return { success: false, message: '유효한 VAPID 키가 서버에 설정되어 있지 않습니다.' };

            const reg = await navigator.serviceWorker.ready;
            if (!reg) return { success: false, message: '서비스 워커가 아직 준비되지 않았습니다. 새로고침 후 다시 시도해 주세요.' };

            let sub = await reg.pushManager.getSubscription().catch(() => null);
            const convertedKey = urlBase64ToUint8Array(publicKey);

            // 1. 강제 재구독 모드이거나 VAPID 키가 변경된 경우 기존 만료 토큰 깨끗하게 정리 (FCM 충돌 원천 차단)
            if (sub && forceResubscribe) {
                console.log('🔄 [WebPush] 강제 재구독 요청: 기존 구독 토큰 초기화 후 재발급 진행');
                try { await sub.unsubscribe(); } catch (unsubErr) {}
                sub = null;
            } else if (sub && sub.options && sub.options.applicationServerKey) {
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
                    console.log('🔄 [WebPush] 서버 VAPID 키 변경 감지: 기존 푸시 구독 취소 후 재구독');
                    try { await sub.unsubscribe(); } catch (unsubErr) {}
                    sub = null;
                }
            }

            // 2. 신규 구독 발급 시도 (실패 시 FCM 충돌 해제 후 2차 폴백 자동 재시도)
            if (!sub) {
                try {
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: convertedKey
                    });
                } catch (subErr) {
                    console.warn('⚠️ [WebPush] 1차 구독 시도 실패, 자동 클린업 및 2차 재시도...', subErr);
                    try {
                        const leftover = await reg.pushManager.getSubscription();
                        if (leftover) await leftover.unsubscribe();
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 400));
                    try {
                        sub = await reg.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: convertedKey.buffer || convertedKey
                        });
                    } catch (secondErr) {
                        console.error('❌ [WebPush] 2차 구독 시도 최종 실패:', secondErr);
                        let errMsg = secondErr.message || '';
                        if (errMsg.includes('push service error') || errMsg.includes('Registration failed')) {
                            return { success: false, message: '구글 푸시 서비스(FCM) 연결 일시 지연입니다.\n스마트폰의 네트워크 연결 상태를 확인하시고, 1~2초 후 [기기 연결 갱신]을 다시 눌러주세요.' };
                        }
                        if (secondErr.name === 'NotAllowedError') {
                            return { success: false, message: '알림 권한이 차단되어 있습니다. 사이트 설정에서 알림을 허용해 주세요.' };
                        }
                        return { success: false, message: '푸시 토큰 발급 실패: ' + (secondErr.message || secondErr) };
                    }
                }
            }

            if (!sub || !sub.endpoint) {
                return { success: false, message: '유효한 푸시 구독 토큰을 생성하지 못했습니다.' };
            }

            // 3. 서버에 구독 토큰 동기화 저장
            const subRes = await fetch('/api/notification/subscribe', {
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

            if (subRes.status === 401) {
                return { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' };
            }

            const subData = await subRes.json().catch(() => ({}));
            if (!subRes.ok || subData.success === false) {
                return { success: false, message: subData.message || ('서버 저장 오류 (HTTP ' + subRes.status + ')') };
            }

            if (subData.skippedBrowser && sub) {
                try { await sub.unsubscribe(); } catch (e) {}
                console.log('🧹 [WebPush Guard] 전용 웹앱(PWA) 구독이 활성화되어 있어 일반 브라우저 중복 구독을 자동 해제했습니다.');
                return { success: true, skippedBrowser: true };
            }

            console.log(`✅ 포털 웹 푸시 구독 등록 완료 (${meta.deviceType} / ${meta.clientType.toUpperCase()})`);
            return { success: true };
        } catch (e) {
            console.error('[WebPush] 구독 오류:', e);
            let userMsg = e.message || '푸시 서비스 등록 중 오류가 발생했습니다.';
            if (userMsg.includes('push service error')) {
                userMsg = '구글 푸시 서비스(FCM) 연결 지연입니다. 1~2초 후 [기기 연결 갱신]을 다시 눌러주세요.';
            }
            return { success: false, message: userMsg };
        }
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
            navigator.serviceWorker.register('/sw.js').then(() => {
                if ('Notification' in window && Notification.permission === 'granted') {
                    navigator.serviceWorker.ready.then(() => {
                        window.registerWebPushSubscription().catch(() => {});
                    });
                }
            }).catch(() => {});
        }
        handleNotifIdFromUrl();
        initUnreadBadge();
        setInterval(initUnreadBadge, 60000);
        if ('Notification' in window && Notification.permission === 'granted') {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(() => {
                    setTimeout(() => window.registerWebPushSubscription().catch(() => {}), 500);
                });
            } else {
                setTimeout(() => window.registerWebPushSubscription().catch(() => {}), 1000);
            }
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();