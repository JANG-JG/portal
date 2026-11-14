/**
 * ==============================================================================
 * 내부 Wi-Fi(LAN) 멀티 서비스 고속 HTTPS 리버스 프록시 (lanProxy.service.js)
 * ------------------------------------------------------------------------------
 * - 포털(:3443)과 동일한 로컬 루트 CA 인증서(lan-cert.pem)로 자산(:3444), 혈압(:3445),
 *   가족앨범(:3446), 뉴스룸(:3447)을 단일 인증서 체계로 즉시 HTTPS 제공
 * - 스트리밍 파이프 + HTTP Keep-Alive로 사진 업로드/다운로드/SSE 지연 최소화
 * ==============================================================================
 */

const http = require('http');
const https = require('https');

const LAN_UPSTREAMS = {
    asset: {
        key: 'asset',
        label: '자산 관리',
        port: parseInt(process.env.LOCAL_HTTPS_ASSET_PORT, 10) || 3444,
        targetHost: '127.0.0.1',
        targetPort: parseInt(process.env.ASSET_PORT, 10) || 3003,
        externalOrigin: 'https://asset.j-jg.cc'
    },
    blood: {
        key: 'blood',
        label: '혈압·건강',
        port: parseInt(process.env.LOCAL_HTTPS_BLOOD_PORT, 10) || 3445,
        targetHost: '127.0.0.1',
        targetPort: parseInt(process.env.BLOOD_PORT, 10) || 3000,
        externalOrigin: 'https://blood.j-jg.cc'
    },
    album: {
        key: 'album',
        label: '가족 앨범',
        port: parseInt(process.env.LOCAL_HTTPS_ALBUM_PORT, 10) || 3446,
        targetHost: '127.0.0.1',
        targetPort: parseInt(process.env.ALBUM_PORT, 10) || 3005,
        externalOrigin: 'https://album.j-jg.cc'
    },
    news: {
        key: 'news',
        label: '뉴스룸',
        port: parseInt(process.env.LOCAL_HTTPS_NEWS_PORT, 10) || 3447,
        targetHost: '127.0.0.1',
        targetPort: parseInt(process.env.NEWS_PORT, 10) || 5050,
        externalOrigin: 'https://news.j-jg.cc'
    }
};

const keepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 64,
    maxFreeSockets: 16
});

const proxyStates = new Map();
const serverInstances = [];

function rewriteLocationHeader(locVal, reqHost, portalPort) {
    if (!locVal || typeof locVal !== 'string') return locVal;
    let out = locVal.replace(/^https:\/\/j-jg\.cc(?=\/|$|\?|#)/i, `https://${reqHost}:${portalPort}`);
    for (const spec of Object.values(LAN_UPSTREAMS)) {
        const extRe = new RegExp(`^https:\\/\\/${spec.externalOrigin.replace('https://', '').replace(/\./g, '\\.')}(?=\\/|$|\\?|#)`, 'i');
        out = out.replace(extRe, `https://${reqHost}:${spec.port}`);
        const localRe = new RegExp(`^http:\\/\\/(?:127\\.0\\.0\\.1|localhost):${spec.targetPort}(?=\\/|$|\\?|#)`, 'i');
        out = out.replace(localRe, `https://${reqHost}:${spec.port}`);
    }
    return out;
}

function sanitizeSetCookieHeaders(setCookieHeader) {
    if (!setCookieHeader) return setCookieHeader;
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    return list.map((cookieStr) => String(cookieStr).replace(/;\s*domain=[^;]+/ig, ''));
}

function isAllowedProxyHost(host, lanIp) {
    const h = String(host || '').trim().toLowerCase();
    if (!h) return false;
    return h === lanIp.toLowerCase() || h === '127.0.0.1' || h === 'localhost' || h === 'jg-server.local' || h === 'lan.j-jg.cc';
}

function createServiceProxyHandler(spec, lanIp, portalPort) {
    return (req, res) => {
        const reqHostRaw = (req.headers.host || lanIp).split(':')[0].trim();
        const reqHost = (/^[a-zA-Z0-9.-]+$/.test(reqHostRaw) && isAllowedProxyHost(reqHostRaw, lanIp)) ? reqHostRaw : lanIp;

        const forwardHeaders = { ...req.headers };
        delete forwardHeaders.connection;
        delete forwardHeaders['keep-alive'];
        delete forwardHeaders['transfer-encoding'];
        forwardHeaders.host = `${reqHost}:${spec.port}`;
        forwardHeaders['x-forwarded-host'] = `${reqHost}:${spec.port}`;
        forwardHeaders['x-forwarded-proto'] = 'https';
        forwardHeaders['x-forwarded-for'] = req.headers['x-forwarded-for']
            ? `${req.headers['x-forwarded-for']}, ${req.socket?.remoteAddress || ''}`
            : (req.socket?.remoteAddress || '127.0.0.1');

        const isHeavyStream = req.url.startsWith('/api/photos') || req.url.startsWith('/uploads') || req.url.startsWith('/api/ocr');
        const proxyReq = http.request({
            hostname: spec.targetHost,
            port: spec.targetPort,
            path: req.url,
            method: req.method,
            headers: forwardHeaders,
            agent: isHeavyStream ? false : keepAliveAgent,
            timeout: isHeavyStream ? 600000 : 30000
        }, (proxyRes) => {
            const outHeaders = { ...proxyRes.headers };
            if (outHeaders.location) {
                outHeaders.location = rewriteLocationHeader(outHeaders.location, reqHost, portalPort);
            }
            if (outHeaders['set-cookie']) {
                outHeaders['set-cookie'] = sanitizeSetCookieHeaders(outHeaders['set-cookie']);
            }
            res.writeHead(proxyRes.statusCode || 200, outHeaders);
            proxyRes.pipe(res, { end: true });
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) {
                res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: `${spec.label} 내부 응답 시간이 초과되었습니다.` }));
            }
        });

        proxyReq.on('error', (err) => {
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: `${spec.label} 서비스(${spec.targetPort})에 일시적으로 연결할 수 없습니다.`, detail: err.message }));
            } else {
                res.end();
            }
        });

        req.on('aborted', () => {
            proxyReq.destroy();
        });

        req.pipe(proxyReq, { end: true });
    };
}

function startLanProxyServers(tlsOptions, lanIp, portalPort = 3443) {
    stopLanProxyServers();

    for (const spec of Object.values(LAN_UPSTREAMS)) {
        const stateEntry = {
            key: spec.key,
            label: spec.label,
            port: spec.port,
            targetPort: spec.targetPort,
            externalOrigin: spec.externalOrigin,
            url: `https://${lanIp}:${spec.port}`,
            active: false,
            lastError: ''
        };
        proxyStates.set(spec.key, stateEntry);

        try {
            const server = https.createServer(tlsOptions, createServiceProxyHandler(spec, lanIp, portalPort));
            server.on('error', (err) => {
                stateEntry.active = false;
                stateEntry.lastError = err.message;
                console.error(`⚠️ [LAN HTTPS:${spec.port}] ${spec.label} 프록시 오류:`, err.message);
            });
            server.listen(spec.port, '0.0.0.0', () => {
                stateEntry.active = true;
                stateEntry.lastError = '';
                console.log(`🔒 내부 Wi-Fi ${spec.label} 게이트웨이 구동 완료 (https://${lanIp}:${spec.port})`);
            });
            serverInstances.push(server);
        } catch (err) {
            stateEntry.active = false;
            stateEntry.lastError = err.message;
            console.error(`⚠️ [LAN HTTPS:${spec.port}] ${spec.label} 초기화 실패:`, err.message);
        }
    }
}

function stopLanProxyServers() {
    while (serverInstances.length > 0) {
        const srv = serverInstances.pop();
        try { srv.close(); } catch (_) {}
    }
    proxyStates.clear();
}

function getLanProxyStatuses(lanIp = '192.168.50.111') {
    return Object.values(LAN_UPSTREAMS).map((spec) => {
        const live = proxyStates.get(spec.key);
        return {
            key: spec.key,
            label: spec.label,
            port: spec.port,
            targetPort: spec.targetPort,
            externalOrigin: spec.externalOrigin,
            url: `https://${lanIp}:${spec.port}`,
            active: live ? live.active : false,
            lastError: live ? live.lastError : ''
        };
    });
}

module.exports = {
    LAN_UPSTREAMS,
    startLanProxyServers,
    stopLanProxyServers,
    getLanProxyStatuses
};
