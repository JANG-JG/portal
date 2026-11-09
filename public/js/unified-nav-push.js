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
            if (textEl) textEl.textContent = '🔄 기기 알림 연결 상태 확인 중...';
            if (btnEl) {
                btnEl.style.display = 'inline-block';
                btnEl.textContent = '기기 연결 갱신';
            }
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
                    if (sub) {
                        if (textEl) textEl.textContent = '✅ 기기 푸시 알림 수신 연결됨';
                        if (btnEl) btnEl.textContent = '기기 연결 갱신';
                    } else {
                        if (textEl) textEl.textContent = '⚠️ 알림 권한 허용됨 (기기 등록 필요)';
                        if (btnEl) btnEl.textContent = '기기 지금 등록';
                    }
                }).catch(() => {
                    if (textEl) textEl.textContent = '✅ 브라우저 푸시 알림 수신 활성화';
                });
            }
        } else if (Notification.permission === 'denied') {
            if (textEl) textEl.textContent = '🚫 알림이 차단되어 있습니다. 사이트 설정에서 허용해 주세요.';
            if (btnEl) {
                btnEl.style.display = 'inline-block';
                btnEl.textContent = '해제 방법';
            }
        } else {
            if (textEl) textEl.textContent = '⚠️ 푸시 알림 권한이 필요합니다. [권한 허용]을 눌러주세요.';
            if (btnEl) {
                btnEl.style.display = 'inline-block';
                btnEl.textContent = '권한 허용';
            }
        }
    };

    // 브라우저 알림 권한 요청
    window.requestBrowserNotificationPermission = async function() {
        if (!('Notification' in window)) {
            alert('현재 브라우저에서는 알림 권한을 지원하지 않습니다.');
            return;
        }
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

    // VAPID 키 및 푸시 매니저 구독 등록 (API)
    window.registerWebPushSubscription = async function(forceResubscribe = false) {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return { success: false, message: '현재 브라우저가 웹 푸시를 지원하지 않습니다.' };
        }

        try {
            const meta = window.getDevicePushMetadata();

            if (Notification.permission !== 'granted') {
                return { success: false, message: '브라우저 알림 권한이 허용되지 않았습니다.' };
            }

            const keyRes = await fetch(`${NOTIF_BASE_URL}/api/notification/vapid-key`, { credentials: 'include' });
            if (!keyRes.ok) return { success: false, message: '서버 VAPID 공개키 조회에 실패했습니다.' };
            const { publicKey } = await keyRes.json();
            if (!publicKey) return { success: false, message: '유효한 VAPID 키가 서버에 설정되어 있지 않습니다.' };

            const reg = await navigator.serviceWorker.ready;
            if (!reg) return { success: false, message: '서비스 워커가 아직 준비되지 않았습니다. 새로고침 후 다시 시도해 주세요.' };

            let sub = await reg.pushManager.getSubscription().catch(() => null);
            const convertedKey = urlBase64ToUint8Array(publicKey);

            // 1. 강제 재구독 모드이거나 VAPID 키가 변경된 경우 기존 만료 토큰 깨끗하게 정리 (FCM 충돌 원천 차단)
            if (sub && forceResubscribe) {
                console.log('🔄 [UnifiedPush] 강제 재구독 요청: 기존 구독 토큰 초기화 후 재발급 진행');
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
                    console.log('🔄 [UnifiedPush] 서버 VAPID 키 변경 감지: 기존 푸시 구독 취소 후 재구독');
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
                    console.warn('⚠️ [UnifiedPush] 1차 구독 시도 실패, 자동 클린업 및 2차 재시도...', subErr);
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
                        console.error('❌ [UnifiedPush] 2차 구독 시도 최종 실패:', secondErr);
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

            if (subRes.status === 401) {
                return { success: false, message: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' };
            }

            const subData = await subRes.json().catch(() => ({}));
            if (!subRes.ok || subData.success === false) {
                return { success: false, message: subData.message || ('서버 저장 오류 (HTTP ' + subRes.status + ')') };
            }

            if (subData.skippedBrowser && sub) {
                try { await sub.unsubscribe(); } catch (e) {}
                console.log('🧹 [UnifiedPush Guard] PWA 구독 활성화 상태로 브라우저 중복 구독 해제');
                return { success: true, skippedBrowser: true };
            }

            console.log(`✅ 포털 웹 푸시 구독 등록 완료 (${meta.deviceType} / ${meta.clientType.toUpperCase()})`);
            return { success: true };
        } catch (e) {
            console.error('[UnifiedPush] 푸시 구독 등록 실패:', e);
            let userMsg = e.message || '푸시 서비스 등록 중 오류가 발생했습니다.';
            if (userMsg.includes('push service error')) {
                userMsg = '구글 푸시 서비스(FCM) 연결 지연입니다. 1~2초 후 [기기 연결 갱신]을 다시 눌러주세요.';
            }
            return { success: false, message: userMsg };
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
            if ('Notification' in window && Notification.permission === 'granted') {
                await window.registerWebPushSubscription().catch(() => {});
            }
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/test`, {
                method: 'POST',
                credentials: 'include'
            });
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

    // 권한 허용 기기 서비스워커 준비 시 자동 등록
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => {
            setTimeout(() => window.registerWebPushSubscription().catch(() => {}), 1000);
        });
    }
})();
