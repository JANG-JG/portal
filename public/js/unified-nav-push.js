/**
 * 📲 JG 통합 알림 푸시 구독 & 디바이스 관리자 (Web Push Manager)
 * - VAPID 키 교환 및 ServiceWorker PushSubscription 등록/해제
 * - 디바이스 및 PWA/브라우저 클라이언트 타입 메타데이터 수집
 * - 브라우저 알림 권한 상태 UI 및 요청 처리
 */
(function() {
    const NOTIF_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://j-jg.cc';

    // 📱 [알림 중복 방지] 디바이스 및 실행 환경 메타데이터 수집 헬퍼
    window.getDevicePushMetadata = function() {
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

    function isPortalPushOrigin() {
        const h = window.location.hostname;
        return h === 'j-jg.cc' || h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.');
    }

    // 브라우저 푸시 알림 권한 상태 표시
    window.updateBrowserPermissionUI = function() {
        const textEl = document.getElementById('notifPermissionStatusText');
        const btnEl = document.getElementById('btnRequestNotifPermission');
        const bannerEl = document.getElementById('notifPermissionBanner');
        const isSettingsTab = document.getElementById('notifMainTabSettings')?.classList.contains('active');
        if (!('Notification' in window)) {
            if (textEl) textEl.textContent = '❌ 이 브라우저는 웹 푸시를 지원하지 않습니다.';
            if (btnEl) btnEl.style.display = 'none';
            if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');
            return;
        }
        if (!isPortalPushOrigin()) {
            if (textEl) textEl.textContent = '🔔 푸시 알림 권한 및 기기 등록은 메인 포털(j-jg.cc)에서 통합 관리됩니다.';
            if (btnEl) {
                btnEl.textContent = '포털에서 권한 설정';
                btnEl.style.display = 'inline-block';
            }
            if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');
            return;
        }
        if (Notification.permission === 'granted') {
            if (textEl) textEl.textContent = '✅ 브라우저 푸시 알림 수신이 활성화되어 있습니다.';
            if (btnEl) {
                btnEl.textContent = '🔄 기기 재연결';
                btnEl.style.display = isSettingsTab ? 'inline-block' : 'none';
            }
            if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');
        } else if (Notification.permission === 'denied') {
            if (textEl) textEl.textContent = '🚫 브라우저에서 알림이 차단되었습니다. 주소창 자물쇠(🔒) 설정에서 허용해 주세요.';
            if (btnEl) btnEl.style.display = 'none';
            if (bannerEl) bannerEl.style.setProperty('display', 'flex', 'important');
        } else {
            if (textEl) textEl.textContent = '⚠️ 푸시 알림 권한이 필요합니다. [권한 허용]을 눌러주세요.';
            if (btnEl) {
                btnEl.textContent = '권한 허용';
                btnEl.style.display = 'inline-block';
            }
            if (bannerEl) bannerEl.style.setProperty('display', 'flex', 'important');
        }
    };

    // 브라우저 알림 권한 요청
    window.requestBrowserNotificationPermission = async function() {
        if (!isPortalPushOrigin()) {
            window.location.href = 'https://j-jg.cc/?open=notification';
            return;
        }
        if (!('Notification' in window)) {
            alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
            return;
        }
        if (Notification.permission === 'denied') {
            alert('🚫 브라우저에서 알림 권한이 차단되어 있습니다.\n브라우저 주소창의 자물쇠(🔒) 또는 사이트 설정에서 [알림]을 [허용]으로 변경해 주세요.');
            return;
        }
        const wasGranted = (Notification.permission === 'granted');
        try {
            const perm = await Notification.requestPermission();
            try { localStorage.setItem('jg_pwa_os_perm_v2', '1'); } catch (e) {}
            window.updateBrowserPermissionUI();
            if (perm === 'granted') {
                const ok = await window.registerWebPushSubscription(false);
                if (ok) alert(wasGranted ? '🎉 현재 기기의 푸시 알림 연결이 최신 상태로 확인되었습니다!' : '🎉 알림 권한 허용 및 기기 등록이 완료되었습니다!');
                else alert('⚠️ 푸시 기기 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
            } else {
                alert('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 확인해 주세요.');
            }
        } catch (e) {
            console.error('권한 요청 실패:', e);
        }
    };

    // VAPID 키 및 푸시 매니저 구독 등록 (API) - 오직 메인 포털(j-jg.cc) 오리진에서만 수행
    let _unavPushSubPromise = null;
    window.registerWebPushSubscription = function(forceResubscribe = false) {
        if (_unavPushSubPromise) return _unavPushSubPromise;
        _unavPushSubPromise = (async () => {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

            // 🛡️ 서브도메인(blood.j-jg.cc, asset.j-jg.cc 등)에서는 알림 권한 요청 및 구독 생성을 원천 차단하고, 잔존 서브도메인 구독만 자동 정리
            if (!isPortalPushOrigin()) {
                try {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const r of regs) {
                        const oldSub = await r.pushManager.getSubscription();
                        if (oldSub) {
                            const ep = oldSub.endpoint;
                            await oldSub.unsubscribe().catch(() => {});
                            await fetch(`${NOTIF_BASE_URL}/api/notification/unsubscribe`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ endpoint: ep })
                            }).catch(() => {});
                        }
                    }
                } catch (e) {}
                return false;
            }

            if (!('Notification' in window) || Notification.permission !== 'granted') return false;

            try {
                const meta = window.getDevicePushMetadata();
                const keyRes = await fetch(`${NOTIF_BASE_URL}/api/notification/vapid-key`, { credentials: 'include' });
                if (!keyRes.ok) return false;
                const { publicKey } = await keyRes.json();
                if (!publicKey) return false;

                let reg = await navigator.serviceWorker.getRegistration('/');
                if (!reg) {
                    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
                }
                reg = await navigator.serviceWorker.ready;
                let sub = await reg.pushManager.getSubscription();
                const convertedKey = urlBase64ToUint8Array(publicKey);

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
                        console.log('🔄 [VAPID Key Changed] 새 VAPID 키 감지: 기존 푸시 구독 취소 후 재구독');
                        forceResubscribe = true;
                    }
                }

                if (sub && forceResubscribe === true) {
                    try { await sub.unsubscribe(); } catch (unsubErr) {}
                    sub = null;
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
                console.log(`✅ 포털 웹 푸시 구독 등록 완료 (${meta.deviceType} / ${meta.clientType.toUpperCase()})`);
                return subRes.ok;
            } catch (e) {
                console.error('[푸시 구독 등록 실패]:', e);
                return false;
            } finally {
                _unavPushSubPromise = null;
            }
        })();
        return _unavPushSubPromise;
    };

    // 푸시 구독 해제 (API)
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
            if (isPortalPushOrigin()) {
                if ('Notification' in window && Notification.permission !== 'denied') {
                    const perm = await Notification.requestPermission();
                    try { localStorage.setItem('jg_pwa_os_perm_v2', '1'); } catch (e) {}
                    window.updateBrowserPermissionUI();
                    if (perm !== 'granted') {
                        return alert('알림 권한이 허용되지 않았습니다. 권한을 허용한 뒤 다시 시도해 주세요.');
                    }
                }
                if ('Notification' in window && Notification.permission === 'granted') {
                    await window.registerWebPushSubscription(false);
                }
            }
            let res = await fetch(`${NOTIF_BASE_URL}/api/notification/test`, {
                method: 'POST',
                credentials: 'include'
            });
            let data = await res.json();
            if (isPortalPushOrigin() && data.success && (data.successCount === 0 || data.targetCount === 0) && 'Notification' in window && Notification.permission === 'granted') {
                await window.registerWebPushSubscription(true);
                res = await fetch(`${NOTIF_BASE_URL}/api/notification/test`, {
                    method: 'POST',
                    credentials: 'include'
                });
                data = await res.json();
            }
            if (data.success && data.successCount > 0) {
                alert('🎉 기기로 테스트 푸시 알림이 발송되었습니다!');
                if (typeof window.fetchNotificationHistory === 'function') {
                    setTimeout(() => window.fetchNotificationHistory(false), 500);
                }
            } else if (!isPortalPushOrigin()) {
                if (confirm('⚠️ 현재 등록된 푸시 수신 기기가 없습니다.\n메인 포털(j-jg.cc)로 이동하여 알림 권한을 등록하시겠습니까?')) {
                    window.location.href = 'https://j-jg.cc/?open=notification';
                }
            } else {
                alert('⚠️ 푸시 발송 대상 기기가 없거나 브라우저 알림 권한이 꺼져 있습니다.\n상단 [권한 허용 / 기기 재연결] 버튼 또는 브라우저 주소창 자물쇠(🔒) 설정에서 알림 권한을 확인해 주세요.');
            }
        } catch (e) {
            alert('테스트 알림 요청 중 오류 발생: ' + e.message);
        }
    };
})();
