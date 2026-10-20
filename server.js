require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const jwt = require('jsonwebtoken');

// ⚙️ 환경변수 및 상수
const {
    PORT,
    JWT_SECRET,
    COOKIE_DOMAIN,
    isOriginAllowed
} = require('./config/constants');

// 🗄️ 데이터베이스 및 서비스
const { db } = require('./services/db');
const { getLiveWeatherData } = require('./services/weather.service');
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
const portalRoutes = require('./routes/portal.routes');
const calendarRoutes = require('./routes/calendar.routes');
const memoRoutes = require('./routes/memo.routes');
const pushRoutes = require('./routes/push.routes');
const searchRoutes = require('./routes/search.routes');
const adminRoutes = require('./routes/admin.routes');

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

// 정적 파일 서빙 및 캐시 제어
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    etag: true,
    lastModified: true,
    dotfiles: 'allow',
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.endsWith('jg-ui.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        } else if (filePath.endsWith('news-ticker.js')) {
            res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        }
    }
}));

// 요청 로깅 미들웨어 (정적 자원 제외)
app.use((req, res, next) => {
    if (!req.url.startsWith('/css') && !req.url.startsWith('/favicon') && !req.url.startsWith('/js') && !req.url.startsWith('/components')) {
        console.log(`[PORTAL] ${req.method} ${req.url}`);
    }
    next();
});

// ==========================================
// 📄 [HTML 웹 화면 라우팅]
// ==========================================

// 1. 메인 포털 홈 화면
app.get(['/', '/index.html'], authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1-1. 통합 관리자 센터 화면 (관리자 전용 접근 제어)
app.get(['/admin', '/admin.html'], authenticateToken, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 1-2. 아이디어 & 메모장 전용 화면
app.get(['/memo', '/memo.html', '/memos'], authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'memo.html'));
});

// 1-3. 스마트 라이프 캘린더 화면
app.get(['/calendar', '/calendar.html'], authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'calendar.html'));
});

// 2. 로그인 페이지
app.get(['/login', '/login.html'], (req, res) => {
    const token = req.cookies.portal_token;
    if (token) {
        if (!revokedTokens.has(token)) {
            return jwt.verify(token, JWT_SECRET, (err) => {
                if (!err) return res.redirect('/');
                res.sendFile(path.join(__dirname, 'public', 'login.html'));
            });
        }
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ==========================================
// 🔌 [도메인별 REST API 라우터 마운트]
// ==========================================

// 인증 & 세션 API (/api/login, /logout, /api/me)
app.use('/', authRoutes);

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

// 관리자 관제 API (/api/admin/*)
app.use('/api/admin', authenticateToken, requireAdmin, adminRoutes);

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'JG Portal' });
});

// ==========================================
// ⏰ [통합 포털 단일 알림 스케줄러 기동]
// ==========================================
initUnifiedNotificationScheduler(db, sendUnifiedPushNotification, getLiveWeatherData, getLiveMarketData);

// 서버 기동
app.listen(PORT, () => {
    console.log(`🚀 JG 통합 포털 서버 구동 완료 (Port: ${PORT}, Cookie Domain: ${COOKIE_DOMAIN})`);
    // 백그라운드 캐시 사전 웜업
    getLiveWeatherData().catch(() => {});
    getLiveMarketData().catch(() => {});
});
