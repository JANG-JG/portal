/**
 * ==============================================================================
 * 보조서버 가족 위키 리버스 프록시 라우터 (wiki.proxy.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 준수 (약 200줄)
 * [아키텍처]
 *  1. 포털(노트 9)로 들어오는 /wiki 및 /api/wiki 요청을 보조서버(HP 15: 5060)로 투명 프록시
 *  2. 포털 단일 인증(JWT/PIN) 미들웨어 연동
 *  3. 대시보드 요약 API SWR(Stale-While-Revalidate) 캐싱으로 네트워크 순단 방어
 * ==============================================================================
 */

const express = require('express');
const http = require('http');
const path = require('path');
const querystring = require('querystring');
const { WIKI_HOST, WIKI_PORT, WIKI_BASE_URL, INTERNAL_API_SECRET } = require('../config/constants');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { isServiceAllowed } = require('../services/moduleRegistry.service');
const { db } = require('../services/db');

const router = express.Router();

// HTTP Keep-Alive Agent: Wi-Fi 구간 반복 TCP 3-way 핸드셰이크 제거 (응답 속도 가속)
const wikiKeepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 10000
});

// 대시보드 요약 SWR 캐시 (Wi-Fi 지연 시 무중단 폴백)
let summaryCache = {
    data: null,
    cachedAt: 0
};

function requireWikiAccess(req, res, next) {
    const proceed = (effectiveUser) => {
        if (!isServiceAllowed(effectiveUser, 'wiki')) {
            if (req.path && req.path.startsWith('/api/')) {
                return res.status(403).json({ success: false, message: '위키 접근 권한이 없습니다.' });
            }
            return res.redirect('/error?code=403&path=' + encodeURIComponent(req.originalUrl || req.path));
        }
        next();
    };

    if (req.user && req.user.username) {
        return db.get(
            'SELECT username, role, allowed_services, is_active FROM users WHERE username = ?',
            [req.user.username],
            (err, dbUser) => {
                if (err) {
                    return proceed(req.user);
                }
                if (!dbUser || dbUser.is_active === 0) {
                    if (req.path && req.path.startsWith('/api/')) {
                        return res.status(403).json({ success: false, message: '비활성화된 계정입니다.' });
                    }
                    return res.redirect('/error?code=403&path=' + encodeURIComponent(req.originalUrl || req.path));
                }
                req.user = { ...req.user, ...dbUser };
                return proceed(req.user);
            }
        );
    }
    return proceed(req.user);
}

function verifyWikiCsrfOrigin(req, res, next) {
    const method = (req.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return next();
    }
    const rawSource = req.headers.origin || req.headers.referer || '';
    if (!rawSource) {
        return res.status(403).json({ success: false, message: '요청 출처(Origin)를 확인할 수 없어 차단되었습니다.' });
    }
    try {
        const parsed = new URL(rawSource);
        const reqHost = (req.get('host') || '').toLowerCase();
        const allowedHosts = new Set(['j-jg.cc', reqHost, 'localhost', '127.0.0.1']);
        const hostNoPort = parsed.hostname.toLowerCase();
        if (!allowedHosts.has(parsed.host.toLowerCase()) && !allowedHosts.has(hostNoPort)) {
            return res.status(403).json({ success: false, message: '허용되지 않은 출처에서의 상태 변경 요청입니다.' });
        }
        return next();
    } catch (_) {
        return res.status(403).json({ success: false, message: '유효하지 않은 Origin 헤더입니다.' });
    }
}

function isSafeProxyTargetPath(rawTargetPath) {
    if (!rawTargetPath || typeof rawTargetPath !== 'string') return false;
    if (/[\r\n\0\\]/.test(rawTargetPath)) return false;
    const qIdx = rawTargetPath.indexOf('?');
    const rawPath = qIdx >= 0 ? rawTargetPath.slice(0, qIdx) : rawTargetPath;
    try {
        const decoded = decodeURIComponent(rawPath);
        if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('..')) return false;
    } catch (_) {
        return false;
    }
    return rawPath.startsWith('/');
}

function sanitizeWikiStaticPath(rawOriginalUrl, allowedPrefix) {
    if (!rawOriginalUrl || typeof rawOriginalUrl !== 'string') return null;
    const qIdx = rawOriginalUrl.indexOf('?');
    const rawPath = qIdx >= 0 ? rawOriginalUrl.slice(0, qIdx) : rawOriginalUrl;
    const rawQuery = qIdx >= 0 ? rawOriginalUrl.slice(qIdx) : '';
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(rawPath);
    } catch (_) {
        return null;
    }
    if (decodedPath.includes('\0') || decodedPath.includes('\\') || decodedPath.includes('..')) {
        return null;
    }
    const normalized = path.posix.normalize(decodedPath);
    if (!normalized.startsWith(allowedPrefix)) {
        return null;
    }
    return `${normalized}${rawQuery}`;
}

/**
 * 범용 HTTP 리버스 프록시 포워더 (Keep-Alive 소켓 재사용)
 */
function forwardToSecondaryWiki(req, res, targetPath, { injectInternalSecret = true } = {}) {
    if (!isSafeProxyTargetPath(targetPath)) {
        return res.status(400).json({ success: false, message: '잘못된 위키 요청 경로입니다.' });
    }
    const rawContentType = req.headers['content-type'] || '';
    const isFormUrlEncoded = rawContentType.toLowerCase().includes('application/x-www-form-urlencoded');
    const isJson = rawContentType.toLowerCase().includes('application/json');

    // 클라이언트 헤더 복사 및 호스트/길이/스푸핑 가능 내부 헤더 정돈
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['host'];
    delete forwardHeaders['content-length']; // 바디 직렬화 후 재계산 주입
    delete forwardHeaders['x-internal-secret'];
    for (const key of Object.keys(forwardHeaders)) {
        if (key.toLowerCase().startsWith('x-user-')) {
            delete forwardHeaders[key];
        }
    }

    forwardHeaders['host'] = `${WIKI_HOST}:${WIKI_PORT}`;
    forwardHeaders['x-forwarded-for'] = req.ip || req.connection.remoteAddress;
    forwardHeaders['x-forwarded-proto'] = req.protocol;
    forwardHeaders['x-forwarded-host'] = req.get('host');
    if (req.user) {
        forwardHeaders['x-user-role'] = req.user.role === 'admin' ? 'admin' : 'family';
        forwardHeaders['x-user-name'] = encodeURIComponent(String(req.user.username || '가족').slice(0, 20));
    }
    if (injectInternalSecret && INTERNAL_API_SECRET) {
        forwardHeaders['x-internal-secret'] = INTERNAL_API_SECRET;
    }

    // AI 분석 및 파일 업로드 요청은 AI 모델 추론 시간을 감안하여 60초 타임아웃 부여
    const isAiOrUpload = targetPath.startsWith('/api/wiki/ai/') || targetPath.startsWith('/api/wiki/upload');
    const proxyTimeout = isAiOrUpload ? 60000 : 15000;

    const options = {
        hostname: WIKI_HOST,
        port: WIKI_PORT,
        path: targetPath,
        method: req.method,
        agent: isAiOrUpload ? false : wikiKeepAliveAgent,
        headers: forwardHeaders,
        timeout: proxyTimeout
    };

    const proxyReq = http.request(options, (proxyRes) => {
        // 리다이렉트 응답 헤더 보정
        if (proxyRes.headers.location) {
            proxyRes.headers.location = proxyRes.headers.location.replace(`http://${WIKI_HOST}:${WIKI_PORT}`, '');
        }

        const outHeaders = { ...proxyRes.headers };
        outHeaders['x-content-type-options'] = outHeaders['x-content-type-options'] || 'nosniff';
        if (targetPath.startsWith('/static/uploads/')) {
            outHeaders['cache-control'] = 'private, max-age=86400';
            outHeaders['cdn-cache-control'] = 'no-store';
        } else if (targetPath.startsWith('/static/')) {
            outHeaders['cache-control'] = req.query.v
                ? 'public, max-age=31536000, immutable'
                : 'no-store, no-cache, must-revalidate, max-age=0';
        } else {
            outHeaders['cache-control'] = 'no-store, no-cache, must-revalidate, max-age=0';
            outHeaders['cdn-cache-control'] = 'no-store';
        }

        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
            res.status(504).json({
                success: false,
                message: '보조서버 위키 응답 시간이 초과되었습니다.'
            });
        }
    });

    proxyReq.on('error', (err) => {
        console.warn(`⚠️ [위키 프록시 오류]: ${err.message}`);
        if (!res.headersSent) {
            res.status(502).json({
                success: false,
                message: '보조서버(HP 노트북)에 연결할 수 없습니다. 서버 전원 및 네트워크를 확인하세요.'
            });
        }
    });

    // 요청 바디 직렬화 및 전송 ([규칙 3, 5] 504 타임아웃 원천 방지)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.body && Object.keys(req.body).length > 0) {
            let bodyBuffer;
            if (isFormUrlEncoded) {
                const encoded = querystring.stringify(req.body);
                bodyBuffer = Buffer.from(encoded, 'utf-8');
                proxyReq.setHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            } else if (isJson) {
                const jsonStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
                bodyBuffer = Buffer.from(jsonStr, 'utf-8');
                proxyReq.setHeader('Content-Type', 'application/json; charset=UTF-8');
            } else if (typeof req.body === 'string') {
                bodyBuffer = Buffer.from(req.body, 'utf-8');
                if (rawContentType) proxyReq.setHeader('Content-Type', rawContentType);
            } else if (Buffer.isBuffer(req.body)) {
                bodyBuffer = req.body;
                if (rawContentType) proxyReq.setHeader('Content-Type', rawContentType);
            } else {
                const jsonStr = JSON.stringify(req.body);
                bodyBuffer = Buffer.from(jsonStr, 'utf-8');
                proxyReq.setHeader('Content-Type', 'application/json; charset=UTF-8');
            }

            proxyReq.setHeader('Content-Length', bodyBuffer.byteLength);
            proxyReq.write(bodyBuffer);
            proxyReq.end();
        } else if (req.readable && !req.readableEnded) {
            req.pipe(proxyReq, { end: true });
        } else {
            proxyReq.setHeader('Content-Length', 0);
            proxyReq.end();
        }
    } else {
        proxyReq.end();
    }
}

// ------------------------------------------------------------------------------
// 1. 대시보드 요약 API (인증 필수 + SWR 캐싱 적용)
// ------------------------------------------------------------------------------
router.get('/api/wiki/dashboard-summary', authenticateToken, requireWikiAccess, async (req, res) => {
    const now = Date.now();
    // 10초 이내 캐시가 있으면 즉시 반환
    if (summaryCache.data && (now - summaryCache.cachedAt < 10000)) {
        return res.json({ ...summaryCache.data, cached: true });
    }

    try {
        const fetchPromise = new Promise((resolve, reject) => {
            const reqUrl = `http://${WIKI_HOST}:${WIKI_PORT}/api/wiki/dashboard-summary`;
            const reqHeaders = INTERNAL_API_SECRET ? { 'x-internal-secret': INTERNAL_API_SECRET } : {};
            const clientReq = http.get(reqUrl, { agent: wikiKeepAliveAgent, timeout: 3500, headers: reqHeaders }, (clientRes) => {
                let rawData = '';
                clientRes.on('data', chunk => { rawData += chunk; });
                clientRes.on('end', () => {
                    try {
                        const parsed = JSON.parse(rawData);
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            clientReq.on('error', reject);
            clientReq.on('timeout', () => {
                clientReq.destroy();
                reject(new Error('Timeout'));
            });
        });

        const liveData = await fetchPromise;
        summaryCache = {
            data: liveData,
            cachedAt: now
        };
        return res.json(liveData);
    } catch (err) {
        // 보조서버 일시 지연 시 이전 캐시 데이터 반환 (무장애 원칙)
        if (summaryCache.data) {
            return res.json({ ...summaryCache.data, fallback: true, warning: '보조서버 응답 지연' });
        }
        return res.status(503).json({
            success: false,
            dday: [],
            todos: [],
            routine_stats: { total: 0, completed: 0, percent: 0 },
            message: '보조서버 연결 대기 중'
        });
    }
});

// ------------------------------------------------------------------------------
// 2. 위키 관련 REST API 프록시 (/api/wiki/*) - 관리자 전용 라우트 선행 분리
// ------------------------------------------------------------------------------
router.get(['/api/wiki/ai/logs', '/api/wiki/revisions/recent'], authenticateToken, requireAdmin, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

router.post(['/api/wiki/wifi/update', '/api/wiki/medical/update'], verifyWikiCsrfOrigin, authenticateToken, requireAdmin, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

router.all('/api/wiki/*', verifyWikiCsrfOrigin, authenticateToken, requireWikiAccess, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

// ------------------------------------------------------------------------------
// 3. 위키 정적 자원 프록시 (/static/css/*, /static/js/*, /static/uploads/*)
// ------------------------------------------------------------------------------
router.get('/static/css/*', (req, res) => {
    const safePath = sanitizeWikiStaticPath(req.originalUrl, '/static/css/');
    if (!safePath) return res.status(400).send('잘못된 정적 경로입니다.');
    if (req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    forwardToSecondaryWiki(req, res, safePath, { injectInternalSecret: false });
});

router.get('/static/js/*', (req, res) => {
    const safePath = sanitizeWikiStaticPath(req.originalUrl, '/static/js/');
    if (!safePath) return res.status(400).send('잘못된 정적 경로입니다.');
    if (req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    forwardToSecondaryWiki(req, res, safePath, { injectInternalSecret: false });
});

router.get('/static/uploads/*', authenticateToken, requireWikiAccess, (req, res) => {
    const safePath = sanitizeWikiStaticPath(req.originalUrl, '/static/uploads/');
    if (!safePath) return res.status(400).send('잘못된 파일 경로입니다.');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    forwardToSecondaryWiki(req, res, safePath, { injectInternalSecret: true });
});

// ------------------------------------------------------------------------------
// 4. 위키 웹 화면 라우팅 (/wiki, /wiki/*) - 관리자 삭제 분리 및 포털 단일 인증 필수
// ------------------------------------------------------------------------------
router.post('/wiki/delete/*', verifyWikiCsrfOrigin, authenticateToken, requireAdmin, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

router.all(['/wiki', '/wiki/*'], verifyWikiCsrfOrigin, authenticateToken, requireWikiAccess, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

module.exports = router;
