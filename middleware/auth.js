const jwt = require('jsonwebtoken');
const { JWT_SECRET, COOKIE_DOMAIN, ADMIN_USERS } = require('../config/constants');
const { db } = require('../services/db');

// 🛡️ [보안 강화] 로그아웃된 JWT 무효화(Blacklist) 인메모리 관리
const revokedTokens = new Map(); // token -> expiresAt (timestamp)

// 30분마다 만료된 블랙리스트 토큰 정리
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of revokedTokens.entries()) {
        if (exp <= now) {
            revokedTokens.delete(t);
        }
    }
}, 30 * 60 * 1000);

// 토큰 인증 미들웨어
function authenticateToken(req, res, next) {
    const token = req.cookies.portal_token;
    if (!token) {
        if (req.path && req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: '인증이 필요합니다.' });
        }
        return res.redirect('/login');
    }

    // 🛡️ 로그아웃된 무효화 토큰(블랙리스트) 검증
    if (revokedTokens.has(token)) {
        res.clearCookie('portal_token', { path: '/', domain: COOKIE_DOMAIN });
        if (req.path && req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: '로그아웃된 토큰입니다. 다시 로그인해 주세요.' });
        }
        return res.redirect('/login');
    }

    let user = null;
    try {
        user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        user = null;
    }

    if (!user || !user.username) {
        res.clearCookie('portal_token', { path: '/', domain: COOKIE_DOMAIN });
        if (req.path && req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: '인증이 만료되었습니다.' });
        }
        return res.redirect('/login');
    }
    req.user = user;
    next();
}

// 🛡️ [보안 강화] 관리자 권한(RBAC) 검증 미들웨어
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.username || !ADMIN_USERS.has(req.user.username)) {
        if (req.path && req.path.startsWith('/api/')) {
            return res.status(403).json({ success: false, message: '관리자 전용 기능입니다. 접근 권한이 없습니다.' });
        }
        return res.status(403).send('접근 권한이 없습니다. (403 Forbidden)');
    }
    next();
}

// 클라이언트 실제 접속 IP 추출 유틸리티 (Cloudflare cf-connecting-ip 최우선)
function getClientIp(req) {
    if (req.headers['cf-connecting-ip']) {
        return req.headers['cf-connecting-ip'].toString().trim();
    }
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

// 🛡️ [보안 강화] 로그인 무차별 대입(Brute-Force) 방어 인메모리 레이트 리미터
const loginAttemptsMap = new Map(); // IP -> { count, lockedUntil, firstAttemptAt }

function checkLoginRateLimit(ip) {
    const now = Date.now();
    const entry = loginAttemptsMap.get(ip);
    if (!entry) return { allowed: true };

    if (entry.lockedUntil && entry.lockedUntil > now) {
        const remainingMinutes = Math.ceil((entry.lockedUntil - now) / 60000);
        return { allowed: false, remainingMinutes };
    }

    if (now - entry.firstAttemptAt > 15 * 60 * 1000) {
        loginAttemptsMap.delete(ip);
        return { allowed: true };
    }

    return { allowed: true };
}

function recordLoginFailure(ip) {
    const now = Date.now();
    const entry = loginAttemptsMap.get(ip) || { count: 0, lockedUntil: 0, firstAttemptAt: now };
    entry.count += 1;
    if (entry.count >= 5) {
        entry.lockedUntil = now + 15 * 60 * 1000; // 15분 잠금
    }
    loginAttemptsMap.set(ip, entry);
}

function recordLoginSuccess(ip) {
    loginAttemptsMap.delete(ip);
}

// 30분마다 만료된 엔트리 정리
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttemptsMap.entries()) {
        if ((entry.lockedUntil && entry.lockedUntil <= now) || (now - entry.firstAttemptAt > 30 * 60 * 1000)) {
            loginAttemptsMap.delete(ip);
        }
    }
}, 30 * 60 * 1000);

// 보안 로그인 시도 이력 기록 헬퍼
function recordLoginLog(username, ip, status) {
    try {
        db.run(
            `INSERT INTO login_logs (username, ip, status, attempted_at) VALUES (?, ?, ?, datetime('now', 'localtime'))`,
            [username || 'unknown', ip || 'unknown', status],
            (err) => {
                if (err) console.error('로그인 이력 DB 저장 실패:', err);
            }
        );
    } catch (e) {
        console.error('로그인 이력 DB 예외:', e);
    }
}

module.exports = {
    revokedTokens,
    authenticateToken,
    requireAdmin,
    getClientIp,
    checkLoginRateLimit,
    recordLoginFailure,
    recordLoginSuccess,
    recordLoginLog
};
