require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// ⚙️ 환경변수 및 상수
const STATIC_ASSET_VERSION = process.env.STATIC_ASSET_VERSION || '20261031_160641';
const {
    PORT,
    JWT_SECRET,
    COOKIE_DOMAIN,
    isOriginAllowed
} = require('./config/constants');

// 🗄️ 데이터베이스 및 서비스
const { db } = require('./services/db');
const { getLiveWeatherData, initWeatherAutoRefresh } = require('./services/weather.service');
const { getLiveMarketData } = require('./services/market.service');
const { sendUnifiedPushNotification } = require('./services/push.service');
const { initUnifiedNotificationScheduler } = require('./services/unifiedNotificationScheduler');

// 🛡️ 미들웨어
const {
    authenticateToken,
    requireAdmin,
    revokedTokens
} = require('./middleware/auth');

// 🌐 도메인별 라우터
const authRoutes = require('./routes/auth.routes');
const authResetRoutes = require('./routes/auth.reset.routes');
const authRegisterRoutes = require('./routes/auth.register.routes');
const portalRoutes = require('./routes/portal.routes');
const calendarRoutes = require('./routes/calendar.routes');
const memoRoutes = require('./routes/memo.routes');
const pushRoutes = require('./routes/push.routes');
const searchRoutes = require('./routes/search.routes');
const adminRoutes = require('./routes/admin.routes');
const wikiProxyRoutes = require('./routes/wiki.proxy.routes');

const app = express();
app.set('trust proxy', 1);
app.use(compression());

// 🌐 CORS 화이트리스트 검증 미들웨어
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// 🛡️ [보안 강화] 필수 보안 헤더 및 CSP 미들웨어
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval';");
    next();
});

// 기본 미들웨어 설정
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// 🚀 중앙 UI 로더 무캐시 동적 엔드포인트 (.js 확장자 제외로 Cloudflare Edge 캐시 100% 원천 우회: cf-cache-status: DYNAMIC)
app.get('/api/jg-ui', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'js', 'jg-ui.js'));
});

// ==========================================
// 📄 [HTML 웹 화면 라우팅 - 무하드코딩 동적 버전 주입]
// ==========================================

// 🧩 관리자 센터 탭 컴포넌트(views/tab-*.html) SSR 결합 엔진 (파일당 500줄 이하 모듈화)
function assembleAdminHtml() {
    const adminIndex = path.join(__dirname, 'public', 'admin', 'index.html');
    let shell = fs.readFileSync(adminIndex, 'utf8');
    const viewsDir = path.join(__dirname, 'public', 'admin', 'views');
    const tabFiles = [
        'tab-overview.html',
        'tab-blood.html',
        'tab-asset.html',
        'tab-news.html',
        'tab-security.html',
        'tab-album.html',
        'tab-backup.html',
        'tab-database.html'
    ];
    const panes = tabFiles.map(file => {
        const filePath = path.join(viewsDir, file);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    }).join('\n');

    return shell.replace('<!-- @@ADMIN_TAB_PANES@@ -->', panes);
}

function sendHtml(res, fileName) {
    const filePath = path.join(__dirname, 'public', fileName);
    try {
        let html;
        if (fileName === 'admin.html' || fileName === 'admin/index.html') {
            html = assembleAdminHtml();
        } else {
            html = fs.readFileSync(filePath, 'utf8');
        }
        // 정적 자원(/css/, /js/) 링크에 서버 동적 버전 자동 주입 (HTML 파일 자체는 항상 100% 클린한 상태 유지)
        html = html.replace(/(href="\/css\/[^"?]+)(\?v=[^"']*)?"/g, `$1?v=${STATIC_ASSET_VERSION}"`)
                   .replace(/(src="\/js\/[^"?]+)(\?v=[^"']*)?"/g, `$1?v=${STATIC_ASSET_VERSION}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.type('html').send(html);
    } catch (e) {
        res.sendFile(filePath);
    }
}

function sendErrorPage(res, statusCode = 404, reqPath = '', customMessage = '') {
    const filePath = path.join(__dirname, 'public', 'error.html');
    try {
        let html = fs.readFileSync(filePath, 'utf8');
        html = html.replace(/(href="\/css\/[^"?]+)(\?v=[^"']*)?"/g, `$1?v=${STATIC_ASSET_VERSION}"`)
                   .replace(/(src="\/js\/[^"?]+)(\?v=[^"']*)?"/g, `$1?v=${STATIC_ASSET_VERSION}"`);
        const codeNum = parseInt(statusCode, 10) || 404;
        html = html.replace('__INITIAL_CODE__', String(codeNum))
                   .replace('__INITIAL_PATH__', (reqPath || '').replace(/"/g, '&quot;'))
                   .replace('__INITIAL_MSG__', (customMessage || '').replace(/"/g, '&quot;'));

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.status(codeNum).type('html').send(html);
    } catch (e) {
        console.error('에러 페이지 렌더링 실패:', e);
        res.status(statusCode || 500).send(`오류가 발생했습니다 (${statusCode})`);
    }
}

// 1. 메인 포털 홈 화면
app.get(['/', '/index.html'], authenticateToken, (req, res) => {
    sendHtml(res, 'index.html');
});

// 1-1. 통합 관리자 센터 화면 (관리자 전용 접근 제어, 폴더 기반 모듈화)
app.get(['/admin', '/admin/', '/admin/index.html', '/admin.html'], authenticateToken, requireAdmin, (req, res) => {
    sendHtml(res, 'admin/index.html');
});

// 1-2. 아이디어 & 메모장 전용 화면
app.get(['/memo', '/memo.html', '/memos'], authenticateToken, (req, res) => {
    sendHtml(res, 'memo.html');
});

// 1-3. 스마트 라이프 캘린더 화면
app.get(['/calendar', '/calendar.html'], authenticateToken, (req, res) => {
    sendHtml(res, 'calendar.html');
});

// 1-4. 오프라인 대체 화면
app.get('/offline.html', (req, res) => {
    sendHtml(res, 'offline.html');
});

// 1-5. 통합 에러 화면 (403, 404, 500 등)
app.get(['/error', '/error.html'], (req, res) => {
    const code = parseInt(req.query.code, 10) || 404;
    const reqPath = req.query.path || '';
    const msg = req.query.msg || '';
    sendErrorPage(res, code, reqPath, msg);
});

// 2. 로그인 페이지
app.get(['/login', '/login.html'], (req, res) => {
    // 🔗 구버전/URL 파라미터형 초대 링크(?invite=...) 감지 시 초대 처리 엔드포인트로 즉시 전달
    if (req.query.invite) {
        return res.redirect(`/invite/${encodeURIComponent(req.query.invite)}`);
    }

    // 신규 초대 링크(invite_token)로 진입한 경우 기존 관리자/가족 세션이 있더라도 새 PIN 설정을 위해 로그인 페이지 렌더링
    if (!req.query.invite_token) {
        const token = req.cookies.portal_token;
        if (token) {
            if (!revokedTokens.has(token)) {
                return jwt.verify(token, JWT_SECRET, (err) => {
                    if (!err) return res.redirect('/');
                    sendHtml(res, 'login.html');
                });
            }
        }
    }
    sendHtml(res, 'login.html');
});

// 정적 파일 서빙 및 캐시 제어 (.well-known 디지털 자산 링크만 예외 허용하고 일반 dotfiles 차단)
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known')));
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    etag: true,
    lastModified: true,
    dotfiles: 'ignore',
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        const reqUrl = res.req ? res.req.url : '';
        const hasVersionQuery = reqUrl.includes('?v=') || reqUrl.includes('&v=');

        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            if (hasVersionQuery) {
                // 🚀 배포 버전 쿼리가 있는 에셋은 1년 불변 캐시 -> 0ms 로컬 캐시 즉시 렌더링
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
                // 버전 쿼리가 없는 에셋은 ETag 기반 재검증
                res.setHeader('Cache-Control', 'no-cache, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
            }
        } else if (filePath.match(/\.(woff2?|ttf|eot|otf)$/i)) {
            // 웹폰트는 항상 불변 캐시 적용 (Pretendard 등 폰트 렌더링 0ms 보장)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        }
    }
}));

// 📸 가족 사진첩 썸네일 동일 오리진 초고속 서빙 (크로스 도메인 지연 방지)
const ALBUM_THUMBNAILS_DIR = path.resolve(__dirname, '..', 'family-album', 'uploads', 'thumbnails');
app.use('/album-uploads/thumbnails', express.static(ALBUM_THUMBNAILS_DIR, {
    maxAge: '7d',
    immutable: true
}));

// 요청 로깅 미들웨어 (정적 자원 제외)
app.use((req, res, next) => {
    if (!req.url.startsWith('/css') && !req.url.startsWith('/favicon') && !req.url.startsWith('/js') && !req.url.startsWith('/components')) {
        console.log(`[PORTAL] ${req.method} ${req.url}`);
    }
    next();
});

// ==========================================
// 🔌 [도메인별 REST API 라우터 마운트]
// ==========================================

// 인증 & 세션 API (/api/login, /logout, /api/me, /api/reset-password, /api/auth/register)
app.use('/', authRoutes);
app.use('/', authResetRoutes);
app.use('/', authRegisterRoutes);

// 포털 메인 & 공통 대시보드 API (/api/summary, /api/ticker, /api/blood/quick-med, /go/:service)
app.use('/', portalRoutes);

// 스마트 캘린더 API (/api/calendar/events, /api/calendar/categories 등)
app.use('/api/calendar', calendarRoutes);

// 아이디어 & 메모장 API (/api/memos/*)
app.use('/api/memos', memoRoutes);

// 통합 알림 센터 & WebPush API (/api/notification/*)
app.use('/api/notification', pushRoutes);

// 통합 검색 API (/api/search/unified)
app.use('/api/search', searchRoutes);

// 보조서버 가족 위키 및 REST API 프록시 (/wiki, /api/wiki/*)
app.use('/', wikiProxyRoutes);

// 관리자 관제 API (/api/admin/*)
app.use('/api/admin', authenticateToken, requireAdmin, adminRoutes);

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'JG Portal' });
});

// ==========================================
// 🚨 [404 Not Found & 500 서버 오류 미들웨어]
// ==========================================

// 404 핸들러 (매칭되지 않은 모든 경로 가로채기)
app.use((req, res, next) => {
    if (req.path && req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: '요청하신 API 엔드포인트를 찾을 수 없습니다.' });
    }
    sendErrorPage(res, 404, req.originalUrl || req.path);
});

// 500 전역 서버 오류 핸들러
app.use((err, req, res, next) => {
    console.error('💥 [서버 내부 오류]:', err);
    if (res.headersSent) {
        return next(err);
    }
    if (req.path && req.path.startsWith('/api/')) {
        return res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
    }
    sendErrorPage(res, 500, req.originalUrl || req.path, '서버 처리 중 일시적인 오류가 발생했습니다.');
});

// ==========================================
// ⏰ [통합 포털 단일 알림 스케줄러 기동]
// ==========================================
const isDevInstance = PORT == 3005 || process.env.IS_DEV === 'true';
const isPrimaryWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
if (!isDevInstance && isPrimaryWorker) {
    initUnifiedNotificationScheduler(db, sendUnifiedPushNotification, getLiveWeatherData, getLiveMarketData);
} else {
    console.log('🧪 [portal] 보조 워커 또는 테스트 인스턴스: 알림 중복 발송 방지를 위해 백그라운드 푸시 스케줄러 비활성화');
}

// 서버 기동
app.listen(PORT, () => {
    console.log(`🚀 JG 통합 포털 서버 구동 완료 (Port: ${PORT}, Cookie Domain: ${COOKIE_DOMAIN})`);
    // 백그라운드 캐시 사전 웜업 및 주기적 자동 갱신 스케줄러 기동
    initWeatherAutoRefresh();
    getLiveMarketData().catch(() => {});
});
