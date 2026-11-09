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

    // VAPID 키 및 푸시 매니저 구독 등록 (API)
    window.registerWebPushSubscription = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        try {
            const meta = window.getDevicePushMetadata();

            if (Notification.permission === 'default') {
                const requested = await Notification.requestPermission();
                if (requested !== 'granted') {
                    console.log('[WebPush] 알림 권한 미허용');
                    return;
                }
            } else if (Notification.permission !== 'granted') {
                return;
            }

            const keyRes = await fetch(`${NOTIF_BASE_URL}/api/notification/vapid-key`, { credentials: 'include' });
            const { publicKey } = await keyRes.json();
            if (!publicKey) return;

            const reg = await navigator.serviceWorker.ready;
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
                    try { await sub.unsubscribe(); } catch (unsubErr) {}
                    sub = null;
                }
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
            const subData = await subRes.json().catch(() => ({}));
            if (subData && subData.skippedBrowser && sub) {
                try { await sub.unsubscribe(); } catch (e) {}
                console.log('🧹 [WebPush Guard] PWA 구독 활성화 상태로 브라우저 중복 구독 해제');
                return;
            }
            console.log(`✅ 포털 웹 푸시 구독 등록 완료 (${meta.deviceType} / ${meta.clientType.toUpperCase()})`);
        } catch (e) {
            console.error('[푸시 구독 등록 실패]:', e);
        }
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
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/test`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                alert('🎉 기기로 테스트 푸시 알림이 발송되었습니다!\n수신 내역 탭에서도 확인하실 수 있습니다.');
                if (typeof window.fetchNotificationHistory === 'function') {
                    setTimeout(() => window.fetchNotificationHistory(false), 500);
                }
            } else {
                alert('테스트 알림 발송 실패: ' + (data.message || '서버 응답 오류'));
            }
        } catch (e) {
            alert('테스트 알림 요청 중 오류 발생: ' + e.message);
        }
    };
})();
