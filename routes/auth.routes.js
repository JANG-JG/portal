const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { JWT_SECRET, COOKIE_DOMAIN } = require('../config/constants');
const { db } = require('../services/db');
const {
    authenticateToken,
    revokedTokens,
    getClientIp,
    checkLoginRateLimit,
    recordLoginFailure,
    recordLoginSuccess,
    recordLoginLog
} = require('../middleware/auth');

// 로그인 처리 API
router.post('/api/login', (req, res) => {
    const { username, password, rememberMe } = req.body;
    const clientIp = getClientIp(req);

    // 🛡️ 브루트포스 연속 실패 잠금 확인
    const limitCheck = checkLoginRateLimit(clientIp);
    if (!limitCheck.allowed) {
        recordLoginLog(username || '미입력', clientIp, 'BLOCKED_RATE_LIMIT');
        return res.status(429).json({
            success: false,
            message: `로그인 시도가 너무 많습니다. 보안을 위해 약 ${limitCheck.remainingMinutes}분 후에 다시 시도해 주세요.`
        });
    }

    if (!username || !password) {
        recordLoginFailure(clientIp);
        recordLoginLog(username || '미입력', clientIp, 'FAILED');
        return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력해주세요.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            recordLoginFailure(clientIp);
            recordLoginLog(username, clientIp, 'FAILED');
            return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                recordLoginFailure(clientIp);
                recordLoginLog(username, clientIp, 'FAILED');
                return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
            }

            // 로그인 성공 시 카운트 리셋 및 성공 기록
            recordLoginSuccess(clientIp);
            recordLoginLog(user.username, clientIp, 'SUCCESS');

            const isRemember = rememberMe === true || rememberMe === 'true';
            const expiresIn = isRemember ? '7d' : '1d';
            const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn });

            const cookieOptions = {
                httpOnly: true,
                path: '/',
                domain: COOKIE_DOMAIN,
                secure: true,
                sameSite: 'lax'
            };
            if (isRemember) {
                cookieOptions.maxAge = 7 * 24 * 60 * 60 * 1000;
            }

            res.cookie('portal_token', token, cookieOptions);
            res.json({ success: true, redirect: '/' });
        } catch (bcryptErr) {
            console.error('비밀번호 검증 오류:', bcryptErr);
            recordLoginLog(username, clientIp, 'FAILED');
            res.status(500).json({ success: false, message: '로그인 검증 중 오류가 발생했습니다.' });
        }
    });
});

// 로그아웃 API
router.get('/logout', (req, res) => {
    const token = req.cookies.portal_token;
    if (token) {
        try {
            const decoded = jwt.decode(token);
            const expTime = (decoded && decoded.exp) ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
            revokedTokens.set(token, expTime);
        } catch (e) {
            revokedTokens.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
    }

    res.clearCookie('portal_token', { path: '/', domain: COOKIE_DOMAIN });
    res.clearCookie('portal_token', { path: '/' });
    res.clearCookie('portal_token', { path: '/', domain: 'j-jg.cc' });

    res.setHeader('Set-Cookie', [
        'portal_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
        `portal_token=; Path=/; Domain=${COOKIE_DOMAIN}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
        'portal_token=; Path=/; Domain=j-jg.cc; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax'
    ]);

    res.redirect('/login?logout=success');
});

// 내 정보 조회 API
router.get('/api/me', authenticateToken, (req, res) => {
    res.json({ success: true, username: req.user.username });
});

module.exports = router;
