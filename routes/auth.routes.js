const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { JWT_SECRET, COOKIE_DOMAIN, ADMIN_USERS } = require('../config/constants');
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

    db.get('SELECT rowid, * FROM users WHERE username = ?', [username], async (err, user) => {
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

            const userRole = user.role || (user.rowid === 1 || ADMIN_USERS.has(user.username) ? 'admin' : 'family');
            if (userRole === 'admin') {
                ADMIN_USERS.add(user.username);
            }

            const isRemember = rememberMe === true || rememberMe === 'true';
            const expiresIn = isRemember ? '7d' : '1d';
            const token = jwt.sign({ username: user.username, role: userRole }, JWT_SECRET, { expiresIn });

            const reqHost = (req.hostname || req.headers.host || '').split(':')[0];
            const isJjgDomain = reqHost === 'j-jg.cc' || reqHost.endsWith('.j-jg.cc');
            const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

            const cookieOptions = {
                httpOnly: true,
                path: '/',
                sameSite: 'lax',
                secure: isHttps
            };
            if (isJjgDomain) {
                cookieOptions.domain = COOKIE_DOMAIN;
            }
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

// ------------------------------------------------------------------------------
// 가족 간편 로그인 & 6자리 PIN 인증 API
// ------------------------------------------------------------------------------

function sendPortalAuthCookie(res, req, token, maxAgeDays = 365) {
    const reqHost = (req.hostname || req.headers.host || '').split(':')[0];
    const isJjgDomain = reqHost === 'j-jg.cc' || reqHost.endsWith('.j-jg.cc');
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    const cookieOptions = {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: isHttps,
        maxAge: maxAgeDays * 24 * 60 * 60 * 1000
    };
    if (isJjgDomain) {
        cookieOptions.domain = COOKIE_DOMAIN;
    }
    res.cookie('portal_token', token, cookieOptions);
}

function sendDeviceCookie(res, req, deviceToken) {
    const reqHost = (req.hostname || req.headers.host || '').split(':')[0];
    const isJjgDomain = reqHost === 'j-jg.cc' || reqHost.endsWith('.j-jg.cc');
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    const cookieOptions = {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: isHttps,
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000
    };
    if (isJjgDomain) {
        cookieOptions.domain = COOKIE_DOMAIN;
    }
    res.cookie('jg_family_device', deviceToken, cookieOptions);
}

function getAuthorizedDeviceUsername(req) {
    const token = req.cookies?.jg_family_device || req.headers['x-family-device'] || req.query?.device_token;
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.username && decoded.purpose === 'family_device') {
            return decoded.username;
        }
    } catch (e) {}
    return null;
}

// 1. 로그인 화면용 가족 구성원 목록 (🛡️ 인증된 가족 기기만 조회 가능, 외부인 일체 비노출)
router.get('/api/auth/family-members', (req, res) => {
    let authorizedUsername = getAuthorizedDeviceUsername(req);

    // 새 기기 초대 링크로 진입한 경우(PIN 검증 대기 상태) 해당 가족 1명만 임시 노출하여 PIN 입력 유도
    if (!authorizedUsername && (req.headers['x-invite-verify'] || req.query?.verify_invite)) {
        const verifyToken = req.headers['x-invite-verify'] || req.query?.verify_invite;
        try {
            const decoded = jwt.verify(verifyToken, JWT_SECRET);
            if (decoded && decoded.username && decoded.purpose === 'invite_verify') {
                authorizedUsername = decoded.username;
            }
        } catch (e) {}
    }

    // 인증된 기기나 유효한 초대 검증이 아니면 가족 정보 일체 비노출 (0건 반환)
    if (!authorizedUsername) {
        return res.json({ success: true, hasDevice: false, members: [] });
    }

    db.get(
        `SELECT username, nickname, role, avatar_emoji 
         FROM users 
         WHERE username = ? AND (role = 'family' OR role IS NULL)`,
        [authorizedUsername],
        (err, row) => {
            if (err || !row) {
                return res.json({ success: true, hasDevice: false, members: [] });
            }
            const emoji = row.avatar_emoji || ((row.nickname && row.nickname.includes('엄마')) ? '👩' : ((row.nickname && row.nickname.includes('아빠')) ? '👨' : ((row.nickname && row.nickname.includes('동생')) ? '👧' : '😊')));
            res.json({
                success: true,
                hasDevice: true,
                members: [{
                    username: row.username,
                    nickname: row.nickname || row.username,
                    role: row.role || 'family',
                    emoji
                }]
            });
        }
    );
});

// 2. 가족 6자리 PIN 로그인 처리
router.post('/api/auth/family-login', async (req, res) => {
    const { username, pin } = req.body;
    const clientIp = getClientIp(req);

    if (!username || !pin) {
        return res.status(400).json({ success: false, message: '가족을 선택하고 6자리 PIN을 입력해 주세요.' });
    }

    if (!/^\d{6}$/.test(String(pin))) {
        return res.status(400).json({ success: false, message: 'PIN 번호는 숫자 6자리여야 합니다.' });
    }

    db.get('SELECT rowid, * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            recordLoginFailure(clientIp);
            return res.status(401).json({ success: false, message: '등록되지 않은 가족 계정입니다.' });
        }

        // 🛡️ 5회 연속 실패 잠금 검사 (30분 잠금)
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const diffMin = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / (60 * 1000));
            return res.status(423).json({
                success: false,
                isLocked: true,
                message: `PIN을 5회 연속 잘못 입력하여 일시 잠금되었습니다.\n약 ${diffMin}분 후 다시 시도하시거나 관리자에게 초기화를 요청하세요.`
            });
        }

        try {
            const pinToCompare = user.pin || user.password;
            const match = await bcrypt.compare(String(pin), pinToCompare);

            if (!match) {
                const newAttempts = (user.failed_pin_attempts || 0) + 1;
                if (newAttempts >= 5) {
                    db.run(
                        "UPDATE users SET failed_pin_attempts = 5, locked_until = datetime('now', '+30 minutes') WHERE username = ?",
                        [username]
                    );
                    recordLoginLog(username, clientIp, 'LOCKED_PIN_LIMIT');
                    return res.status(423).json({
                        success: false,
                        isLocked: true,
                        message: 'PIN을 5회 연속 잘못 입력하여 30분간 입장이 제한됩니다.\n관리자에게 PIN 초기화를 요청해 주세요.'
                    });
                } else {
                    db.run('UPDATE users SET failed_pin_attempts = ? WHERE username = ?', [newAttempts, username]);
                    recordLoginLog(username, clientIp, 'FAILED_PIN');
                    return res.status(401).json({
                        success: false,
                        message: `PIN 번호가 올바르지 않습니다. (남은 기회: ${5 - newAttempts}회)`
                    });
                }
            }

            // PIN 일치 성공! 실패 카운트 리셋 및 로그인 기록
            db.run(
                "UPDATE users SET failed_pin_attempts = 0, locked_until = NULL, last_login_at = datetime('now', 'localtime') WHERE username = ?",
                [username]
            );
            recordLoginSuccess(clientIp);
            recordLoginLog(username, clientIp, 'SUCCESS_FAMILY_PIN');

            // 최초 PIN 변경 필요 여부 확인
            if (user.pin_reset_required === 1 || !user.pin) {
                const tempToken = jwt.sign(
                    { username: user.username, role: user.role || 'family', purpose: 'pin_change_required' },
                    JWT_SECRET,
                    { expiresIn: '15m' }
                );
                return res.json({
                    success: true,
                    requirePinChange: true,
                    tempToken,
                    username: user.username,
                    nickname: user.nickname || user.username,
                    message: '보안을 위해 앞으로 사용할 나만의 6자리 PIN으로 변경해 주세요.'
                });
            }

            // 정상 로그인 쿠키 발급 (1년 자동 로그인)
            let allowedServices = ['album', 'news'];
            try {
                if (user.allowed_services) allowedServices = JSON.parse(user.allowed_services);
            } catch (e) {}

            const token = jwt.sign(
                {
                    username: user.username,
                    role: user.role || 'family',
                    nickname: user.nickname || user.username,
                    allowed_services: allowedServices
                },
                JWT_SECRET,
                { expiresIn: '365d' }
            );

            const deviceToken = jwt.sign(
                { username: user.username, role: user.role || 'family', purpose: 'family_device' },
                JWT_SECRET,
                { expiresIn: '3650d' }
            );
            sendDeviceCookie(res, req, deviceToken);
            sendPortalAuthCookie(res, req, token, 365);
            res.json({
                success: true,
                requirePinChange: false,
                redirect: '/',
                nickname: user.nickname || user.username,
                deviceToken
            });
        } catch (bcryptErr) {
            console.error('가족 PIN 검증 오류:', bcryptErr);
            res.status(500).json({ success: false, message: '인증 처리 중 오류가 발생했습니다.' });
        }
    });
});

// 3. 최초 접속 시 나만의 새 6자리 PIN으로 변경 API
router.post('/api/auth/change-pin', async (req, res) => {
    const { tempToken, newPin } = req.body;
    if (!tempToken || !newPin) {
        return res.status(400).json({ success: false, message: '인증 토큰과 새로운 6자리 PIN을 입력해 주세요.' });
    }

    if (!/^\d{6}$/.test(String(newPin))) {
        return res.status(400).json({ success: false, message: '새 PIN은 반드시 숫자 6자리여야 합니다.' });
    }

    try {
        const decoded = jwt.verify(tempToken, JWT_SECRET);
        if (!decoded || !decoded.username || decoded.purpose !== 'pin_change_required') {
            return res.status(401).json({ success: false, message: '유효하지 않거나 만료된 요청입니다. 다시 로그인해 주세요.' });
        }

        const username = decoded.username;
        const newPinHash = await bcrypt.hash(String(newPin), 10);

        db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
            }

            db.run(
                'UPDATE users SET pin = ?, password = ?, pin_reset_required = 0, failed_pin_attempts = 0, locked_until = NULL WHERE username = ?',
                [newPinHash, newPinHash, username],
                (upErr) => {
                    if (upErr) {
                        return res.status(500).json({ success: false, message: 'PIN 변경 실패' });
                    }

                    let allowedServices = ['album', 'news'];
                    try {
                        if (user.allowed_services) allowedServices = JSON.parse(user.allowed_services);
                    } catch (e) {}

                    const token = jwt.sign(
                        {
                            username: user.username,
                            role: user.role || 'family',
                            nickname: user.nickname || user.username,
                            allowed_services: allowedServices
                        },
                        JWT_SECRET,
                        { expiresIn: '365d' }
                    );

                    const deviceToken = jwt.sign(
                        { username: user.username, role: user.role || 'family', purpose: 'family_device' },
                        JWT_SECRET,
                        { expiresIn: '3650d' }
                    );
                    sendDeviceCookie(res, req, deviceToken);
                    sendPortalAuthCookie(res, req, token, 365);
                    res.json({
                        success: true,
                        message: '새로운 6자리 PIN이 안전하게 설정되었습니다! 이제 자동 로그인됩니다.',
                        redirect: '/',
                        deviceToken
                    });
                }
            );
        });
    } catch (jwtErr) {
        return res.status(401).json({ success: false, message: '인증 세션이 만료되었습니다. 다시 시도해 주세요.' });
    }
});

// 4. 카톡 원터치 초대 링크 처리 (GET /invite/:token)
router.get('/invite/:token', (req, res) => {
    const inviteToken = req.params.token;
    if (!inviteToken) return res.redirect('/login');

    db.get('SELECT * FROM users WHERE invite_token = ?', [inviteToken], (err, user) => {
        if (err || !user) {
            return res.redirect('/login?error=invalid_invite');
        }

        // 1) 아직 가입하지 않은 초대 링크인 경우: 회원가입 모달로 연결
        if (user.is_registered === 0 || !user.password) {
            return res.redirect(`/login?register_invite=${encodeURIComponent(inviteToken)}&memo=${encodeURIComponent(user.admin_memo || user.nickname || '')}`);
        }

        // 2) 가입 완료되었으나 초기 PIN 변경이 필요한 경우: PIN 변경 모달로 연결
        if (user.pin_reset_required === 1 || !user.pin) {
            const tempToken = jwt.sign(
                { username: user.username, role: user.role || 'family', purpose: 'pin_change_required' },
                JWT_SECRET,
                { expiresIn: '30m' }
            );
            return res.redirect(`/login?invite_token=${encodeURIComponent(tempToken)}&username=${encodeURIComponent(user.username)}&nickname=${encodeURIComponent(user.nickname || '')}`);
        }

        // 이미 PIN 설정이 완료된 가족인 경우: PIN 검증을 거쳐야만 기기 인증이 완료되도록 일회용 검증 토큰 발급
        const verifyToken = jwt.sign(
            { username: user.username, role: user.role || 'family', purpose: 'invite_verify' },
            JWT_SECRET,
            { expiresIn: '30m' }
        );
        return res.redirect(`/login?verify_invite=${encodeURIComponent(verifyToken)}&username=${encodeURIComponent(user.username)}&nickname=${encodeURIComponent(user.nickname || '')}`);
    });
});

// 5. 기기 간편입장 등록 해제 API (POST /api/auth/unlink-device)
router.post('/api/auth/unlink-device', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const clearOpts = { path: '/', sameSite: 'lax', secure: isHttps };
    const reqHost = (req.hostname || req.headers.host || '').split(':')[0];
    if (reqHost === 'j-jg.cc' || reqHost.endsWith('.j-jg.cc')) {
        clearOpts.domain = COOKIE_DOMAIN;
    }
    res.clearCookie('jg_family_device', clearOpts);
    res.clearCookie('jg_family_device', { path: '/' });
    res.json({ success: true, message: '이 기기에서 간편 입장이 해제되었습니다.' });
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

// 내 정보 조회 API (역할, 닉네임, 허용 서비스 포함)
router.get('/api/me', authenticateToken, (req, res) => {
    db.get('SELECT rowid, username, nickname, role, allowed_services FROM users WHERE username = ?', [req.user.username], (err, user) => {
        let allowedServices = ['album', 'news'];
        let role = req.user.role || 'family';
        let nickname = req.user.username;

        if (user) {
            role = user.role || (user.rowid === 1 ? 'admin' : 'family');
            nickname = user.nickname || user.username;
            try {
                if (user.allowed_services) allowedServices = JSON.parse(user.allowed_services);
            } catch (e) {}
        }

        res.json({
            success: true,
            username: req.user.username,
            nickname,
            role,
            isAdmin: role === 'admin',
            allowedServices
        });
    });
});

module.exports = router;

