/**
 * ==============================================================================
 * 내부 Wi-Fi(LAN) 자동 감지 · 원클릭 SSO 핸드오프 · 관리자 게이트웨이 API
 * (lan.routes.js)
 * ------------------------------------------------------------------------------
 * - 외부 도메인(*.j-jg.cc)에서 내부망 감지 시 로그인 재입력 없이 LAN HTTPS로 즉시 이관
 * - 단일 host-only 쿠키 체계(192.168.50.111) + 1회용 JTI 검증으로 5개 포트 통합 인증
 * ==============================================================================
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ADMIN_USERS } = require('../config/constants');
const { db } = require('../services/db');
const { authenticateToken, requireAdmin, revokedTokens } = require('../middleware/auth');
const {
    getLocalHttpsStatus,
    getPublicLanConfig,
    isPrivateLanRequest,
    getSafeRequestHostname,
    getLanServiceBaseUrl,
    setAutoRedirectEnabled
} = require('../services/localHttps.service');

const router = express.Router();
const usedLanHandoffs = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, exp] of usedLanHandoffs.entries()) {
        if (exp <= now) usedLanHandoffs.delete(key);
    }
}, 5 * 60 * 1000).unref();

const ALLOWED_LAN_SERVICES = new Set(['portal', 'asset', 'blood', 'album', 'news', 'economy']);

function setNoStore(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

function sanitizeService(rawSvc) {
    const svc = String(rawSvc || 'portal').trim().toLowerCase();
    return ALLOWED_LAN_SERVICES.has(svc) ? svc : 'portal';
}

function sanitizeRelativePath(rawPath, role) {
    let trimmed = String(rawPath || '/').trim();
    if (!trimmed || trimmed.includes('\r') || trimmed.includes('\n')) trimmed = '/';
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) trimmed = '/';
    if (trimmed.startsWith('/login') || trimmed.startsWith('/logout') || trimmed.startsWith('/auth/')) {
        trimmed = '/';
    }
    if (role === 'kid') {
        return (trimmed === '/study' || trimmed.startsWith('/study/')) ? trimmed : '/study';
    }
    return trimmed;
}

function splitPathAndHash(fullPath) {
    const idx = fullPath.indexOf('#');
    if (idx === -1) return { cleanPath: fullPath, hash: '' };
    return {
        cleanPath: fullPath.slice(0, idx) || '/',
        hash: fullPath.slice(idx)
    };
}

function verifyPortalCookieUser(req) {
    const token = req.cookies && req.cookies.portal_token;
    if (!token || revokedTokens.has(token)) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        if (!decoded || !decoded.username || decoded.purpose === 'sso_ticket' || decoded.purpose === 'lan_sso_handoff') {
            return null;
        }
        return decoded;
    } catch (_) {
        return null;
    }
}

function setLanHostAuthCookies(res, req, userInfo) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const maxAgeDays = userInfo.role === 'kid' ? 180 : 30;
    const baseOpts = {
        path: '/',
        sameSite: 'lax',
        secure: isHttps,
        maxAge: maxAgeDays * 24 * 60 * 60 * 1000
    };

    const portalJwt = jwt.sign(
        {
            username: userInfo.username,
            role: userInfo.role,
            nickname: userInfo.nickname
        },
        JWT_SECRET,
        { expiresIn: `${maxAgeDays}d` }
    );
    res.cookie('portal_token', portalJwt, { ...baseOpts, httpOnly: true });
    res.cookie('jg_user_role', userInfo.role, { ...baseOpts, httpOnly: false });
    res.cookie('jg_allowed_services', userInfo.allowedServicesStr, { ...baseOpts, httpOnly: false });

    const deviceJwt = jwt.sign(
        { username: userInfo.username, purpose: 'family_device' },
        JWT_SECRET,
        { expiresIn: '3650d' }
    );
    res.cookie('jg_family_device', deviceJwt, {
        ...baseOpts,
        httpOnly: true,
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000
    });
}

// 1. 공개 LAN HTTPS 게이트웨이 설정 조회
router.get('/api/lan-config', (req, res) => {
    setNoStore(res);
    res.json({
        success: true,
        ...getPublicLanConfig(req),
        isLanRequest: isPrivateLanRequest(req)
    });
});

// 2. 외부 도메인(*.j-jg.cc) -> 내부망 HTTPS 자동 전환 게이트웨이
router.get('/api/auth/lan-redirect', (req, res) => {
    setNoStore(res);
    const cfg = getPublicLanConfig();
    if (!cfg.enabled || !cfg.active || !cfg.lanOrigin) {
        return res.redirect('/');
    }

    const service = sanitizeService(req.query.service);
    const cookieUser = verifyPortalCookieUser(req);
    const safePath = sanitizeRelativePath(req.query.path, cookieUser ? cookieUser.role : 'family');

    if (!cookieUser) {
        if (service === 'portal') {
            return res.redirect(`${cfg.lanOrigin}/login?redirect=${encodeURIComponent(safePath)}`);
        }
        return res.redirect(`${cfg.lanOrigin}/login`);
    }

    const jti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const handoffToken = jwt.sign(
        {
            username: cookieUser.username,
            role: cookieUser.role || 'family',
            nickname: cookieUser.nickname || cookieUser.username,
            jti,
            purpose: 'lan_sso_handoff'
        },
        JWT_SECRET,
        { expiresIn: '20s' }
    );

    const params = new URLSearchParams({
        token: handoffToken,
        service,
        path: safePath
    });
    return res.redirect(`${cfg.lanOrigin}/auth/lan-sso?${params.toString()}`);
});

// 3. 내부망 HTTPS(:3443)에서 1회용 핸드오프 티켓 검증 -> host-only 쿠키 발급 & 목적지 이동
router.get('/auth/lan-sso', (req, res) => {
    setNoStore(res);
    const rawToken = String(req.query.token || '').trim();
    const service = sanitizeService(req.query.service);

    if (!rawToken) {
        return res.redirect('/login');
    }

    let decoded = null;
    try {
        decoded = jwt.verify(rawToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (_) {}

    const jti = decoded && decoded.jti;
    const now = Date.now();
    if (!decoded || !decoded.username || decoded.purpose !== 'lan_sso_handoff' || !jti) {
        return res.redirect('/login');
    }
    if (usedLanHandoffs.has(jti) && usedLanHandoffs.get(jti) > now) {
        return res.redirect('/');
    }
    usedLanHandoffs.set(jti, now + 60 * 1000);

    db.get(
        'SELECT rowid, username, nickname, role, allowed_services FROM users WHERE username = ?',
        [decoded.username],
        (err, userRow) => {
            if (err || !userRow) {
                return res.redirect('/login');
            }
            const role = userRow.role || (ADMIN_USERS.includes(userRow.username) || userRow.rowid === 1 ? 'admin' : 'family');
            const nickname = userRow.nickname || userRow.username;
            let allowedList = ['album', 'news'];
            try {
                if (userRow.allowed_services) allowedList = JSON.parse(userRow.allowed_services);
            } catch (_) {}
            const allowedServicesStr = role === 'admin' ? 'all' : (Array.isArray(allowedList) ? allowedList.join(',') : 'album,news');

            // RBAC 차단: 권한 없는 서비스 접근 시 포털 홈으로 안전 우회
            let effectiveService = service;
            if (role === 'kid') {
                effectiveService = 'portal';
            } else if (role === 'family' && !['portal', 'news', 'economy'].includes(service)) {
                if (!Array.isArray(allowedList) || !allowedList.includes(service)) {
                    effectiveService = 'portal';
                }
            }

            setLanHostAuthCookies(res, req, {
                username: userRow.username,
                role,
                nickname,
                allowedServicesStr
            });

            const safePath = sanitizeRelativePath(req.query.path, role);
            if (effectiveService === 'portal') {
                return res.redirect(safePath || '/');
            }

            const baseServiceKey = effectiveService === 'economy' ? 'news' : effectiveService;
            const lanHostBase = getLanServiceBaseUrl(req, baseServiceKey);
            if (!lanHostBase) {
                return res.redirect('/');
            }

            const targetFullPath = (effectiveService === 'economy' && safePath === '/') ? '/economy' : safePath;
            const { cleanPath, hash } = splitPathAndHash(targetFullPath);
            const ticketJti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
            const ssoTicket = jwt.sign(
                {
                    username: userRow.username,
                    role,
                    nickname,
                    jti: ticketJti,
                    purpose: 'sso_ticket'
                },
                JWT_SECRET,
                { expiresIn: '15s' }
            );
            const destUrl = lanHostBase + (cleanPath === '/' ? '' : cleanPath);
            const sep = destUrl.includes('?') ? '&' : '?';
            return res.redirect(`${destUrl}${sep}token=${ssoTicket}${hash}`);
        }
    );
});

// 4. 관리자 LAN 게이트웨이 상태 조회 & 자동 전환 제어 API ([규칙 11])
router.get('/api/admin/lan-gateway/status', authenticateToken, requireAdmin, (req, res) => {
    setNoStore(res);
    const reqHost = getSafeRequestHostname(req);
    res.json({
        success: true,
        currentHost: reqHost,
        isCurrentLan: isPrivateLanRequest(req),
        ...getLocalHttpsStatus()
    });
});

router.post('/api/admin/lan-gateway/config', authenticateToken, requireAdmin, (req, res) => {
    setNoStore(res);
    const { autoRedirect } = req.body || {};
    if (typeof autoRedirect !== 'boolean') {
        return res.status(400).json({ success: false, message: 'autoRedirect (boolean) 값이 필요합니다.' });
    }
    const updated = setAutoRedirectEnabled(autoRedirect);
    res.json({
        success: true,
        autoRedirect: updated,
        message: updated
            ? '같은 Wi-Fi 내부망 자동 감지가 활성화되었습니다.'
            : '같은 Wi-Fi 내부망 자동 전환이 일시 중지되었습니다.',
        ...getLocalHttpsStatus()
    });
});

module.exports = router;
