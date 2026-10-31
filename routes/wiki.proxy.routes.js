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
const querystring = require('querystring');
const { WIKI_HOST, WIKI_PORT, WIKI_BASE_URL } = require('../config/constants');
const { authenticateToken } = require('../middleware/auth');

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

/**
 * 범용 HTTP 리버스 프록시 포워더 (Keep-Alive 소켓 재사용)
 */
function forwardToSecondaryWiki(req, res, targetPath) {
    const rawContentType = req.headers['content-type'] || '';
    const isFormUrlEncoded = rawContentType.toLowerCase().includes('application/x-www-form-urlencoded');
    const isJson = rawContentType.toLowerCase().includes('application/json');

    // 클라이언트 헤더 복사 및 호스트/길이 헤더 정돈
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['host'];
    delete forwardHeaders['content-length']; // 바디 직렬화 후 재계산 주입

    forwardHeaders['host'] = `${WIKI_HOST}:${WIKI_PORT}`;
    forwardHeaders['x-forwarded-for'] = req.ip || req.connection.remoteAddress;
    forwardHeaders['x-forwarded-proto'] = req.protocol;
    forwardHeaders['x-forwarded-host'] = req.get('host');

    const options = {
        hostname: WIKI_HOST,
        port: WIKI_PORT,
        path: targetPath,
        method: req.method,
        agent: wikiKeepAliveAgent,
        headers: forwardHeaders,
        timeout: 10000
    };

    const proxyReq = http.request(options, (proxyRes) => {
        // 리다이렉트 응답 헤더 보정
        if (proxyRes.headers.location) {
            proxyRes.headers.location = proxyRes.headers.location.replace(`http://${WIKI_HOST}:${WIKI_PORT}`, '');
        }

        const outHeaders = { ...proxyRes.headers };
        // 정적 자원에 버전 쿼리(?v=...)가 있는 경우 24시간 브라우저 캐싱 보장 ([규칙 4] 준수)
        if (targetPath.startsWith('/static/') && req.query.v) {
            outHeaders['cache-control'] = 'public, max-age=86400, immutable';
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
// 1. 대시보드 요약 API (SWR 캐싱 적용)
// ------------------------------------------------------------------------------
router.get('/api/wiki/dashboard-summary', async (req, res) => {
    const now = Date.now();
    // 10초 이내 캐시가 있으면 즉시 반환
    if (summaryCache.data && (now - summaryCache.cachedAt < 10000)) {
        return res.json({ ...summaryCache.data, cached: true });
    }

    try {
        const fetchPromise = new Promise((resolve, reject) => {
            const reqUrl = `http://${WIKI_HOST}:${WIKI_PORT}/api/wiki/dashboard-summary`;
            const clientReq = http.get(reqUrl, { agent: wikiKeepAliveAgent, timeout: 3500 }, (clientRes) => {
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
// 2. 위키 관련 REST API 프록시 (/api/wiki/*)
// ------------------------------------------------------------------------------
router.all('/api/wiki/*', authenticateToken, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

// ------------------------------------------------------------------------------
// 3. 위키 정적 자원 프록시 (/static/css/*, /static/js/*, /static/uploads/*)
// ------------------------------------------------------------------------------
router.get('/static/css/*', (req, res) => {
    // 버전 쿼리(?v=...)가 있으면 24시간 브라우저 캐싱 허용, 없으면 재검증 ([규칙 4] 준수)
    if (req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

router.get('/static/js/*', (req, res) => {
    if (req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

router.get('/static/uploads/*', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

// ------------------------------------------------------------------------------
// 4. 위키 웹 화면 라우팅 (/wiki, /wiki/*) - 포털 단일 인증 필수
// ------------------------------------------------------------------------------
router.all(['/wiki', '/wiki/*'], authenticateToken, (req, res) => {
    forwardToSecondaryWiki(req, res, req.originalUrl);
});

module.exports = router;
