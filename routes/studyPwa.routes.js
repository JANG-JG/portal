/**
 * ==============================================================================
 * 빨간패드공부 (/study) 전용 태블릿 PWA 공개 리소스 & 로그인/로그아웃 라우터
 * ------------------------------------------------------------------------------
 * - authenticateToken 미들웨어 이전에 마운트되어 미로그인 상태에서도
 *   manifest.json, sw.js, 아이콘, /study/login, /study/logout 정상 서빙
 * - [규칙 3] 500줄 이하 모듈화 준수
 * ==============================================================================
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { JWT_SECRET, COOKIE_DOMAIN, STATIC_ASSET_VERSION } = require('../config/constants');
const { revokedTokens } = require('../middleware/auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ICONS_DIR = path.join(PUBLIC_DIR, 'study', 'icons');
const ALLOWED_ICON_FILES = new Set([
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-192.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
    'favicon-64.png'
]);

function sendNoStoreHtml(res, relPath) {
    try {
        const fullPath = path.join(PUBLIC_DIR, relPath);
        let html = fs.readFileSync(fullPath, 'utf8');
        const v = STATIC_ASSET_VERSION || Date.now();
        html = html.replace(/(href|src)="(\/(?:css|js)\/[^"?#]+)(\?v=[^"]*)?"/g, `$1="$2?v=${v}"`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(html);
    } catch (err) {
        console.error(`학습실 PWA HTML 서빙 오류 (${relPath}):`, err);
        res.status(500).send('화면을 불러오는 중 오류가 발생했습니다.');
    }
}

function getSafeStudyNext(rawNext) {
    if (!rawNext || typeof rawNext !== 'string') return '/study';
    const trimmed = rawNext.trim();
    if (
        (trimmed === '/study' || trimmed.startsWith('/study/')) &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('/study/login') &&
        !trimmed.startsWith('/study/logout')
    ) {
        return trimmed;
    }
    return '/study';
}

// 1. 전용 매니페스트 (/study/manifest.json)
router.get('/study/manifest.json', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.type('application/manifest+json');
    res.sendFile(path.join(PUBLIC_DIR, 'study', 'manifest.json'));
});

// 2. 전용 무알림 Service Worker (/study/sw.js) — 배포 버전 자동 스탬핑
router.get('/study/sw.js', (req, res) => {
    try {
        const swPath = path.join(PUBLIC_DIR, 'study', 'sw.js');
        const v = STATIC_ASSET_VERSION || Date.now();
        const body = fs.readFileSync(swPath, 'utf8').replace('__STUDY_ASSET_VERSION__', String(v));
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Service-Worker-Allowed', '/study/');
        res.type('application/javascript; charset=utf-8');
        res.send(body);
    } catch (err) {
        console.error('학습실 SW 서빙 오류:', err);
        res.status(500).send('// study sw unavailable');
    }
});

// 3. 전용 오프라인 안내 화면 (/study/offline.html)
router.get('/study/offline.html', (req, res) => {
    sendNoStoreHtml(res, 'study/offline.html');
});

// 4. 전용 앱 아이콘 세트 (/study/icons/:file)
router.get('/study/icons/:file', (req, res) => {
    const file = path.basename(String(req.params.file || ''));
    if (!ALLOWED_ICON_FILES.has(file)) {
        return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    return res.sendFile(path.join(ICONS_DIR, file));
});

// 5. 태블릿 전용 로그인 화면 (/study/login) — PWA 스코프 내부 유지
router.get(['/study/login', '/study/login.html'], (req, res) => {
    const token = req.cookies?.portal_token;
    if (token && !revokedTokens.has(token)) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            if (decoded && decoded.username && !decoded.purpose) {
                return res.redirect(getSafeStudyNext(req.query.next));
            }
        } catch (e) {}
    }
    return sendNoStoreHtml(res, 'study/login.html');
});

// 6. 태블릿 전용 로그아웃 (/study/logout) — 페어링된 기기 토큰(jg_family_device)은 유지
router.get('/study/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const bearerToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : null;
    const tokensToRevoke = [req.cookies?.portal_token, bearerToken].filter(Boolean);
    for (const token of tokensToRevoke) {
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
    res.clearCookie('jg_user_role', { path: '/', domain: COOKIE_DOMAIN });
    res.clearCookie('jg_user_role', { path: '/' });
    res.clearCookie('jg_allowed_services', { path: '/', domain: COOKIE_DOMAIN });
    res.clearCookie('jg_allowed_services', { path: '/' });

    res.setHeader('Set-Cookie', [
        'portal_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
        `portal_token=; Path=/; Domain=${COOKIE_DOMAIN}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
        'portal_token=; Path=/; Domain=j-jg.cc; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
        `jg_user_role=; Path=/; Domain=${COOKIE_DOMAIN}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`,
        `jg_allowed_services=; Path=/; Domain=${COOKIE_DOMAIN}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
    ]);

    return res.redirect('/study/login?logout=success');
});

module.exports = router;
