/**
 * 📲 JG 통합 웹 푸시 클라이언트 엔진 (unified-nav-push.js — Clean-Slate v2)
 * - 메인 포털 및 전 서브 서비스 단일 표준 푸시 구독·권한·진단 모듈 (500줄 이하 헌법 준수)
 */
(function() {
    'use strict';

    if (window.__JG_PUSH_CLIENT_READY__) return;
    window.__JG_PUSH_CLIENT_READY__ = true;

    function isPortalPushOrigin() {
        const portalOrigin = window.__JG_PORTAL_ORIGIN__ || 'https://j-jg.cc';
        if (window.location.origin === portalOrigin) return true;
        const h = window.location.hostname;
        return h === 'j-jg.cc' || h === 'localhost' || h === '127.0.0.1';
    }
    window.isPortalPushOrigin = isPortalPushOrigin;

    const NOTIF_BASE_URL = isPortalPushOrigin() ? '' : (window.__JG_PORTAL_ORIGIN__ || 'https://j-jg.cc');
    window.NOTIF_BASE_URL = NOTIF_BASE_URL;

    function detectClientBrowser(ua) {
        if (/SamsungBrowser/i.test(ua)) return '삼성 인터넷';
        if (/EdgA?\//i.test(ua)) return '엣지';
        if (/Firefox|FxiOS/i.test(ua)) return '파이어폭스';
        if (/iPhone|iPad|Macintosh/i.test(ua) && !/Chrome|CriOS|SamsungBrowser|Edg/i.test(ua)) return '사파리';
        if (/Chrome|CriOS/i.test(ua)) return '크롬';
        return '브라우저';
    }

    window.getDevicePushMetadata = function() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                             window.matchMedia('(display-mode: fullscreen)').matches ||
                             window.matchMedia('(display-mode: minimal-ui)').matches ||
                             window.navigator.standalone === true ||
                             document.referrer.includes('android-app://');
        const clientType = isStandalone ? 'pwa' : 'browser';
        const modeLabel = isStandalone ? '설치형 웹앱' : '웹 브라우저';
        const ua = navigator.userAgent || '';
        const browserName = detectClientBrowser(ua);

        const isTouchMobile = navigator.maxTouchPoints > 1 && /android|linux|macintosh|iphone|ipad/i.test(ua) &&
                              window.screen && Math.min(window.screen.width, window.screen.height) <= 900;
        const deviceType = (/mobi|iphone|ipod|ipad|tablet|android|samsungbrowser|wv/i.test(ua) || isTouchMobile) ? 'mobile' : 'desktop';

        let deviceId = 'unknown';
        try {
            deviceId = localStorage.getItem('jg_device_id') || '';
            if (!deviceId) {
                deviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
                localStorage.setItem('jg_device_id', deviceId);
            }
        } catch (e) {}

        return { clientType, modeLabel, browserName, deviceType, deviceId, userAgent: ua };
    };

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const out = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
        return out;
    }

    function showDeniedUnblockGuide(meta) {
        const isSamsung = meta.browserName === '삼성 인터넷';
        const msg = [
            `🚫 현재 [${meta.modeLabel} · ${meta.browserName}]의 알림 권한이 '차단(거부)' 상태입니다.`,
            '',
            '웹 표준 보안 정책상 한 번 차단된 상태에서는 코드로 허용 팝업을 띄울 수 없어 아래 순서로 초기화해 주세요:',
            '',
            isSamsung
                ? '1) 삼성 인터넷 앱 자체의 휴대폰 알림이 꺼져 있다면 먼저 [휴대폰 설정 → 애플리케이션 → 삼성 인터넷 → 알림 허용]을 켜주세요.\n2) 삼성 인터넷 우측 하단 [≡ 메뉴 → 설정 → 사이트 및 다운로드 → 사이트 권한 → 알림]에서 j-jg.cc를 [허용] 또는 [초기화]로 변경해 주세요.'
                : '1) 브라우저 주소창 왼쪽 [자물쇠/설정 아이콘]을 누른 뒤 [권한 → 알림]을 [허용] 또는 [권한 초기화]로 변경해 주세요.\n2) 설치형 웹앱이라면 휴대폰 [설정 → 애플리케이션 → JG 포털 → 알림]이 켜져 있는지 확인해 주세요.',
            '',
            '변경 후 화면을 새로고침하면 [알림 권한 허용] 창이 정상적으로 나타납니다.'
        ].join('\n');
        alert(msg);
    }

    // 실시간 기기 권한 및 서버 구독 일치 상태 UI 렌더링
    let _statusCheckSeq = 0;
    window.updateBrowserPermissionUI = async function() {
        const textEl = document.getElementById('notifPermissionStatusText');
        const btnEl = document.getElementById('btnRequestNotifPermission');
        const bannerEl = document.getElementById('notifPermissionBanner');
        const isSettingsTab = Boolean(document.getElementById('notifMainTabSettings')?.classList.contains('active'));
        const meta = window.getDevicePushMetadata();

        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            if (textEl) textEl.textContent = `❌ 현재 실행 환경(${meta.modeLabel})에서는 웹 푸시 알림을 지원하지 않습니다.`;
            if (btnEl) btnEl.style.display = 'none';
            if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');
            return;
        }

        if (!isPortalPushOrigin()) {
            if (textEl) textEl.textContent = '🔔 푸시 알림 기기 연결은 메인 포털 화면에서 통합 설정됩니다.';
            if (btnEl) {
                btnEl.textContent = '포털에서 설정';
                btnEl.style.display = 'inline-block';
            }
            if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');
            return;
        }

        const perm = Notification.permission;
        if (perm === 'denied') {
            if (textEl) textEl.textContent = `🚫 [${meta.modeLabel} · ${meta.browserName}] 알림 권한이 차단되어 있습니다.`;
            if (btnEl) {
                btnEl.textContent = '차단 해제 방법';
                btnEl.style.display = 'inline-block';
            }
            if (bannerEl) bannerEl.style.setProperty('display', 'flex', 'important');
            return;
        }

        if (perm === 'default') {
            if (textEl) textEl.textContent = `🔔 [${meta.modeLabel} · ${meta.browserName}] 알림을 받으려면 권한을 허용해 주세요.`;
            if (btnEl) {
                btnEl.textContent = '알림 권한 허용';
                btnEl.style.display = 'inline-block';
            }
            if (bannerEl) bannerEl.style.setProperty('display', 'flex', 'important');
            return;
        }

        // perm === 'granted' : 로컬 구독 및 서버 DB 일치 여부 실시간 점검
        const seq = ++_statusCheckSeq;
        if (textEl) textEl.textContent = `⏳ [${meta.modeLabel} · ${meta.browserName}] 서버 연결 상태를 확인하고 있습니다...`;
        if (btnEl) {
            btnEl.textContent = '🔄 기기 재연결';
            btnEl.style.display = isSettingsTab ? 'inline-block' : 'none';
        }
        if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');

        try {
            const reg = await navigator.serviceWorker.getRegistration('/');
            const sub = reg ? await reg.pushManager.getSubscription() : null;
            const ep = sub && sub.endpoint ? sub.endpoint : '';
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/status?endpoint=${encodeURIComponent(ep)}`, { credentials: 'include' });
            if (seq !== _statusCheckSeq) return;

            if (res.ok) {
                const stat = await res.json();
                if (ep && stat.isCurrentRegistered) {
                    if (textEl) textEl.textContent = `✅ [${meta.modeLabel} · ${meta.browserName}] 푸시 알림 연결 정상 (등록 기기 ${stat.totalDevices}대)`;
                    if (btnEl) {
                        btnEl.textContent = '🔄 기기 재연결';
                        btnEl.style.display = isSettingsTab ? 'inline-block' : 'none';
                    }
                    if (bannerEl) bannerEl.style.setProperty('display', isSettingsTab ? 'flex' : 'none', 'important');
                    return;
                }
            }

            // 브라우저 권한은 허용되었으나 현재 기기 토큰이 서버에 없는 경우
            if (textEl) textEl.textContent = `⚠️ [${meta.modeLabel} · ${meta.browserName}] 권한은 허용되었으나 기기 등록이 필요합니다.`;
            if (btnEl) {
                btnEl.textContent = '📲 지금 기기 연결';
                btnEl.style.display = 'inline-block';
            }
            if (bannerEl) bannerEl.style.setProperty('display', 'flex', 'important');
        } catch (e) {
            if (textEl) textEl.textContent = `✅ [${meta.modeLabel} · ${meta.browserName}] 알림 권한 허용됨`;
        }
    };

    // 순정 웹 표준 PushManager 구독 등록
    let _pushSubPromise = null;
    window.registerWebPushSubscription = function(forceResubscribe = false) {
        if (_pushSubPromise) return _pushSubPromise;
        _pushSubPromise = (async () => {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

            // 서브도메인에서는 레거시 구독만 자동 정리
            if (!isPortalPushOrigin()) {
                try {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const r of regs) {
                        const oldSub = await r.pushManager.getSubscription();
                        if (oldSub) {
                            const oldEp = oldSub.endpoint;
                            await oldSub.unsubscribe().catch(() => {});
                            await fetch(`${NOTIF_BASE_URL}/api/notification/unsubscribe`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ endpoint: oldEp })
                            }).catch(() => {});
                        }
                    }
                } catch (e) {}
                return false;
            }

            if (!('Notification' in window) || Notification.permission !== 'granted') return false;

            try {
                const meta = window.getDevicePushMetadata();
                const keyRes = await fetch('/api/notification/vapid-key', { credentials: 'include' });
                if (!keyRes.ok) return false;
                const { publicKey } = await keyRes.json();
                if (!publicKey) return false;

                let reg = await navigator.serviceWorker.getRegistration('/');
                if (!reg) {
                    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
                }
                reg = await navigator.serviceWorker.ready;

                const appServerKey = urlBase64ToUint8Array(publicKey);
                let sub = await reg.pushManager.getSubscription();
                let previousEndpoint = '';

                if (sub && sub.options && sub.options.applicationServerKey) {
                    const curKey = new Uint8Array(sub.options.applicationServerKey);
                    let sameKey = curKey.length === appServerKey.length;
                    if (sameKey) {
                        for (let i = 0; i < curKey.length; i++) {
                            if (curKey[i] !== appServerKey[i]) { sameKey = false; break; }
                        }
                    }
                    if (!sameKey) forceResubscribe = true;
                }

                if (sub && forceResubscribe) {
                    previousEndpoint = sub.endpoint || '';
                    try { await sub.unsubscribe(); } catch (e) {}
                    sub = null;
                }

                if (!sub) {
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: appServerKey
                    });
                }

                const subRes = await fetch('/api/notification/subscribe', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subscription: sub,
                        previousEndpoint,
                        clientType: meta.clientType,
                        deviceType: meta.deviceType,
                        deviceId: meta.deviceId,
                        userAgent: meta.userAgent
                    })
                });
                return subRes.ok;
            } catch (e) {
                console.error('[WebPush] 구독 등록 실패:', e);
                return false;
            } finally {
                _pushSubPromise = null;
            }
        })();
        return _pushSubPromise;
    };

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
            }
        } catch (e) {}
    };

    // 알림 권한 요청 및 기기 재연결 버튼 핸들러 (사용자 명시 클릭 제스처 전용)
    window.requestBrowserNotificationPermission = async function() {
        if (!isPortalPushOrigin()) {
            window.location.href = 'https://j-jg.cc/?open=notification';
            return;
        }
        const meta = window.getDevicePushMetadata();
        if (!('Notification' in window)) {
            return alert('현재 실행 환경에서는 웹 푸시 알림을 지원하지 않습니다.');
        }
        if (Notification.permission === 'denied') {
            return showDeniedUnblockGuide(meta);
        }

        const wasGranted = (Notification.permission === 'granted');
        let perm = Notification.permission;
        if (perm === 'default') {
            try {
                perm = await Notification.requestPermission();
            } catch (e) {
                console.error('[WebPush] 권한 요청 오류:', e);
            }
        }

        if (perm !== 'granted') {
            await window.updateBrowserPermissionUI();
            if (perm === 'denied') showDeniedUnblockGuide(meta);
            else alert('알림 권한이 아직 허용되지 않았습니다. [알림 권한 허용]을 눌러 승인해 주세요.');
            return;
        }

        const ok = await window.registerWebPushSubscription(wasGranted);
        await window.updateBrowserPermissionUI();
        if (ok) {
            alert(wasGranted
                ? `✅ 현재 [${meta.modeLabel} · ${meta.browserName}]의 푸시 알림 토큰을 새로고침하여 다시 연결했습니다!`
                : `🎉 [${meta.modeLabel} · ${meta.browserName}] 알림 권한 허용 및 기기 연결이 완료되었습니다!`);
        } else {
            alert('⚠️ 서버에 기기 등록 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
        }
    };

    // 원클릭 내 계정 푸시 기기 전체 초기화 후 현재 기기만 깨끗이 재등록
    window.resetMyPushDevices = async function() {
        if (!isPortalPushOrigin()) {
            if (confirm('기기 초기화 및 재등록은 메인 포털 화면에서 진행됩니다. 이동하시겠습니까?')) {
                window.location.href = 'https://j-jg.cc/?open=notification';
            }
            return;
        }
        const meta = window.getDevicePushMetadata();
        if (!('Notification' in window)) return alert('현재 환경에서는 웹 푸시를 지원하지 않습니다.');
        if (Notification.permission === 'denied') return showDeniedUnblockGuide(meta);

        if (!confirm('기존에 등록된 기기 연결 기록을 모두 지우고, 현재 사용 중인 기기만 깨끗하게 새로 등록하시겠습니까?')) {
            return;
        }

        try {
            if (Notification.permission === 'default') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') {
                    await window.updateBrowserPermissionUI();
                    return alert('알림 권한을 먼저 허용해 주셔야 기기 등록이 가능합니다.');
                }
            }
            await window.unsubscribeWebPushSubscription();
            await fetch('/api/notification/reset-devices', { method: 'POST', credentials: 'include' });
            const ok = await window.registerWebPushSubscription(true);
            await window.updateBrowserPermissionUI();
            if (ok) {
                alert(`🎉 기존 기기 기록을 정리하고 현재 [${meta.modeLabel} · ${meta.browserName}] 1대만 깨끗하게 새로 연결했습니다!`);
            } else {
                alert('⚠️ 새 기기 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.');
            }
        } catch (e) {
            alert('기기 초기화 중 오류가 발생했습니다: ' + e.message);
        }
    };

    // 테스트 알림 발송
    window.sendTestNotification = async function() {
        if (isPortalPushOrigin()) {
            const meta = window.getDevicePushMetadata();
            if ('Notification' in window && Notification.permission === 'denied') {
                return showDeniedUnblockGuide(meta);
            }
            if ('Notification' in window && Notification.permission === 'default') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') {
                    await window.updateBrowserPermissionUI();
                    return alert('알림 권한을 허용한 뒤 테스트 발송을 눌러주세요.');
                }
            }
            if ('Notification' in window && Notification.permission === 'granted') {
                await window.registerWebPushSubscription(false);
            }
        }

        try {
            let res = await fetch(`${NOTIF_BASE_URL}/api/notification/test`, { method: 'POST', credentials: 'include' });
            let data = await res.json();

            if (isPortalPushOrigin() && data.success && (!data.successCount || data.successCount === 0) &&
                'Notification' in window && Notification.permission === 'granted') {
                await window.registerWebPushSubscription(true);
                res = await fetch('/api/notification/test', { method: 'POST', credentials: 'include' });
                data = await res.json();
            }

            await window.updateBrowserPermissionUI();
            if (typeof window.fetchNotificationHistory === 'function') {
                setTimeout(() => window.fetchNotificationHistory(false), 400);
            }

            if (data.success && data.successCount > 0) {
                alert(`🔔 등록된 기기(${data.successCount}대)로 테스트 알림을 발송했습니다!\n상단 알림바를 확인해 주세요.`);
            } else if (!isPortalPushOrigin()) {
                if (confirm('⚠️ 등록된 푸시 수신 기기가 없습니다.\n메인 포털로 이동하여 현재 기기를 등록하시겠습니까?')) {
                    window.location.href = 'https://j-jg.cc/?open=notification';
                }
            } else {
                alert('⚠️ 발송 대상 기기를 찾지 못했습니다. [🔄 기기 연결 초기화] 버튼을 눌러 기기를 새로 등록해 보세요.');
            }
        } catch (e) {
            alert('테스트 발송 요청 중 오류가 발생했습니다: ' + e.message);
        }
    };

    // 초기 서비스워커 등록 및 기존 허용 기기 자동 동기화 (무단 클릭 가로채기 완전 제거)
    function initPushClient() {
        if (!isPortalPushOrigin()) {
            setTimeout(() => window.registerWebPushSubscription(false), 1200);
            return;
        }
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js', { scope: '/' })
                .then((reg) => { try { reg.update(); } catch (e) {} })
                .catch(() => {});

            navigator.serviceWorker.addEventListener('message', (evt) => {
                if (evt && evt.data && evt.data.type === 'JG_PUSH_RESUBSCRIBE_NEEDED') {
                    window.registerWebPushSubscription(true);
                }
            });
        }
        if ('Notification' in window && Notification.permission === 'granted') {
            setTimeout(() => window.registerWebPushSubscription(false), 600);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPushClient);
    } else {
        initPushClient();
    }
})();
