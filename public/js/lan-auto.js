/**
 * ==============================================================================
 * JG 내부 Wi-Fi(LAN) 자동 감지 · 무중단 원클릭 고속 전환 브릿지 (lan-auto.js)
 * ------------------------------------------------------------------------------
 * - 단일 웹앱/도메인(j-jg.cc)으로 외부에서는 Cloudflare, 같은 집 Wi-Fi에서는
 *   내부 HTTPS(192.168.50.111:3443~3447)를 자동 감지해 SSO 세션 그대로 즉시 전환
 * - 루트 인증서(CA) 미설치 기기나 외부 망에서는 조용히 무영향 폴백
 * ==============================================================================
 */
(function () {
    'use strict';

    if (window.__JG_LAN_AUTO_INIT__) return;
    window.__JG_LAN_AUTO_INIT__ = true;

    const FAIL_COOLDOWN_MS = 20000;
    const PROBE_TIMEOUT_MS = 450;
    const FAIL_KEY = 'jg_lan_probe_fail_at';
    const STAY_EXT_KEY = 'jg_stay_external';
    const USER_OPT_KEY = 'jg_lan_auto';

    function isPrivateHost(host) {
        const h = String(host || '').split(':')[0].trim().toLowerCase();
        if (!h) return false;
        if (h === 'localhost' || h === '127.0.0.1' || h === 'lan.j-jg.cc' || h.endsWith('.local')) return true;
        return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
    }

    function getLanCfg() {
        const cfg = window.__JG_LAN_CONFIG__ || {};
        const ports = cfg.ports || { portal: 3443, asset: 3444, blood: 3445, album: 3446, news: 3447 };
        const host = isPrivateHost(window.location.hostname)
            ? window.location.hostname
            : (cfg.lanIp || '192.168.50.111');
        return {
            enabled: cfg.enabled !== false,
            active: cfg.active !== false,
            autoRedirect: cfg.autoRedirect !== false,
            lanIp: host,
            lanOrigin: cfg.lanOrigin || `https://${host}:${ports.portal}`,
            ports
        };
    }

    function getCurrentServiceKey() {
        const h = window.location.hostname.toLowerCase();
        const p = String(window.location.port || '');
        const { ports } = getLanCfg();
        if (p && p === String(ports.asset)) return 'asset';
        if (p && p === String(ports.blood)) return 'blood';
        if (p && p === String(ports.album)) return 'album';
        if (p && p === String(ports.news)) return 'news';
        if (h.startsWith('asset.')) return 'asset';
        if (h.startsWith('blood.')) return 'blood';
        if (h.startsWith('album.')) return 'album';
        if (h.startsWith('news.')) return 'news';
        return 'portal';
    }

    function toLanUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
        let u;
        try { u = new URL(rawUrl, window.location.href); } catch (_) { return rawUrl; }
        const h = u.hostname.toLowerCase();
        const { ports } = getLanCfg();
        const host = isPrivateHost(window.location.hostname) ? window.location.hostname : getLanCfg().lanIp;
        let port = null;
        if (h === 'j-jg.cc') port = ports.portal;
        else if (h === 'asset.j-jg.cc') port = ports.asset;
        else if (h === 'blood.j-jg.cc') port = ports.blood;
        else if (h === 'album.j-jg.cc') port = ports.album;
        else if (h === 'news.j-jg.cc') port = ports.news;
        if (!port) return rawUrl;
        return `https://${host}:${port}${u.pathname}${u.search}${u.hash}`;
    }

    function toExternalUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return 'https://j-jg.cc/';
        let u;
        try { u = new URL(rawUrl, window.location.href); } catch (_) { return 'https://j-jg.cc/'; }
        const p = String(u.port || '');
        const { ports } = getLanCfg();
        let extOrigin = 'https://j-jg.cc';
        if (p === String(ports.asset)) extOrigin = 'https://asset.j-jg.cc';
        else if (p === String(ports.blood)) extOrigin = 'https://blood.j-jg.cc';
        else if (p === String(ports.album)) extOrigin = 'https://album.j-jg.cc';
        else if (p === String(ports.news)) extOrigin = 'https://news.j-jg.cc';
        return `${extOrigin}${u.pathname}${u.search}${u.hash}`;
    }

    function rewriteLanAnchors(root = document) {
        if (!isPrivateHost(window.location.hostname) || window.location.protocol !== 'https:') return;
        const anchors = (root.querySelectorAll ? root.querySelectorAll('a[href]') : []);
        anchors.forEach((a) => {
            if (a.dataset && a.dataset.keepExternal === 'true') return;
            const href = a.getAttribute('href') || '';
            if (!href.startsWith('https://')) return;
            const converted = toLanUrl(href);
            if (converted !== href) a.setAttribute('href', converted);
        });
    }

    function setupLanNavigationBridge() {
        rewriteLanAnchors(document);
        document.addEventListener('click', (e) => {
            const link = e.target && e.target.closest('a[href]');
            if (!link || (link.dataset && link.dataset.keepExternal === 'true')) return;
            const rawHref = link.getAttribute('href') || '';
            if (!rawHref.startsWith('https://')) return;
            const converted = toLanUrl(rawHref);
            if (converted === rawHref) return;
            e.preventDefault();
            if (link.target === '_blank') {
                window.open(converted, '_blank', 'noopener');
            } else {
                window.location.href = converted;
            }
        }, true);
    }

    function shouldSkipExternalProbe() {
        const p = window.location.pathname || '/';
        if (
            p.startsWith('/login') ||
            p.startsWith('/logout') ||
            p.startsWith('/register') ||
            p.startsWith('/invite') ||
            p.startsWith('/auth/') ||
            p.startsWith('/error') ||
            p.startsWith('/offline')
        ) {
            return true;
        }
        try {
            if (localStorage.getItem(USER_OPT_KEY) === 'off') return true;
            if (sessionStorage.getItem(STAY_EXT_KEY) === '1') return true;
            const failAt = parseInt(sessionStorage.getItem(FAIL_KEY) || '0', 10);
            if (failAt && Date.now() - failAt < FAIL_COOLDOWN_MS) return true;
        } catch (_) {}
        return false;
    }

    let probeInFlight = false;
    async function probeAndSwitchToLan(force = false) {
        if (probeInFlight) return false;
        if (isPrivateHost(window.location.hostname)) return false;
        if (navigator.onLine === false) return false;
        const cfg = getLanCfg();
        if (!cfg.enabled || !cfg.active || (!force && !cfg.autoRedirect)) return false;
        if (!force && shouldSkipExternalProbe()) return false;

        probeInFlight = true;
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;

        try {
            const res = await fetch(`${cfg.lanOrigin}/health?probe=1`, {
                mode: 'cors',
                cache: 'no-store',
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!res.ok) throw new Error('status_' + res.status);
            const data = await res.json();
            if (!data || data.status !== 'ok') throw new Error('invalid_health');

            try { sessionStorage.removeItem(FAIL_KEY); } catch (_) {}
            const svc = getCurrentServiceKey();
            const fullPath = (window.location.pathname || '/') + (window.location.search || '') + (window.location.hash || '');
            const redirectUrl = `https://j-jg.cc/api/auth/lan-redirect?service=${encodeURIComponent(svc)}&path=${encodeURIComponent(fullPath)}`;
            window.location.replace(redirectUrl);
            return true;
        } catch (_) {
            try { sessionStorage.setItem(FAIL_KEY, String(Date.now())); } catch (e) {}
            return false;
        } finally {
            if (timer) clearTimeout(timer);
            probeInFlight = false;
        }
    }

    function handleInitialQueryParams() {
        const params = new URLSearchParams(window.location.search || '');
        let touched = false;
        if (params.get('stay_external') === '1') {
            try { sessionStorage.setItem(STAY_EXT_KEY, '1'); } catch (_) {}
            params.delete('stay_external');
            touched = true;
        } else if (params.get('auto_lan') === '1') {
            try {
                sessionStorage.removeItem(STAY_EXT_KEY);
                sessionStorage.removeItem(FAIL_KEY);
            } catch (_) {}
            params.delete('auto_lan');
            touched = true;
        }
        if (touched) {
            const qs = params.toString();
            const cleanUrl = window.location.pathname + (qs ? '?' + qs : '') + (window.location.hash || '');
            try { window.history.replaceState({}, document.title, cleanUrl); } catch (_) {}
        }
    }

    function bindNetworkChangeEvents() {
        const retryOnNetworkRestore = () => {
            try { sessionStorage.removeItem(FAIL_KEY); } catch (_) {}
            probeAndSwitchToLan(false);
        };
        window.addEventListener('online', retryOnNetworkRestore);
        if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
            navigator.connection.addEventListener('change', retryOnNetworkRestore);
        }
    }

    window.JGLanBridge = {
        isLanHost: () => isPrivateHost(window.location.hostname),
        getPortalOrigin: () => window.__JG_PORTAL_ORIGIN__ || 'https://j-jg.cc',
        toLanUrl,
        toExternalUrl,
        rewriteLanAnchors,
        probeAndSwitch: () => probeAndSwitchToLan(true),
        switchToExternal: () => {
            const target = toExternalUrl(window.location.href);
            const sep = target.includes('?') ? '&' : '?';
            const hashIdx = target.indexOf('#');
            const base = hashIdx === -1 ? target : target.slice(0, hashIdx);
            const hash = hashIdx === -1 ? '' : target.slice(hashIdx);
            window.location.href = `${base}${sep}stay_external=1${hash}`;
        },
        setAutoSwitchEnabled: (flag) => {
            try { localStorage.setItem(USER_OPT_KEY, flag ? 'on' : 'off'); } catch (_) {}
        }
    };

    handleInitialQueryParams();
    if (isPrivateHost(window.location.hostname)) {
        setupLanNavigationBridge();
    } else {
        bindNetworkChangeEvents();
        probeAndSwitchToLan(false);
    }
})();
