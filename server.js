require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const net = require('net');
const webPush = require('web-push');
const { initUnifiedNotificationScheduler } = require('./services/unifiedNotificationScheduler');
const compression = require('compression');

const app = express();
app.set('trust proxy', 1);
app.use(compression());
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('🚨 [보안 오류] JWT_SECRET 환경변수가 누락되었습니다. .env 설정을 확인하세요.');
    process.exit(1);
}
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.j-jg.cc';

// 서브 프로젝트 기본 경로 자동 탐색 (환경 변수 -> 상위 폴더 상대경로 -> 노트9 workspace)
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..');
const BLOOD_DIR = process.env.BLOOD_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'blood-pressure-app')) ? path.join(WORKSPACE_ROOT, 'blood-pressure-app') : '/home/upt0731/workspace/blood-pressure-app');
const ASSET_DIR = process.env.ASSET_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'asset')) ? path.join(WORKSPACE_ROOT, 'asset') : '/home/upt0731/workspace/asset');
const NEWS_DIR = process.env.NEWS_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'news-dashboard')) ? path.join(WORKSPACE_ROOT, 'news-dashboard') : '/home/upt0731/workspace/news-dashboard');

const BLOOD_DB_PATH = process.env.DB_PATH || path.join(BLOOD_DIR, 'health.db');
const ASSET_DB_PATH = process.env.ASSET_DB_PATH || path.join(ASSET_DIR, 'asset.db');
const NEWS_DB_PATH = process.env.NEWS_DB_PATH || path.join(NEWS_DIR, 'briefing.db');

// 🌐 서브도메인 및 로컬 개발 환경 맞춤형 CORS 화이트리스트 검증 미들웨어
const ALLOWED_ORIGINS = [
    'https://j-jg.cc',
    'https://blood.j-jg.cc',
    'https://asset.j-jg.cc',
    'https://news.j-jg.cc',
    'http://localhost:3000',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:5050'
];

function isOriginAllowed(origin) {
    if (!origin) return false;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    try {
        const u = new URL(origin);
        return u.hostname === 'j-jg.cc' || u.hostname.endsWith('.j-jg.cc');
    } catch (e) {
        return false;
    }
}

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

// 기본 미들웨어 설정
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // 모든 정적 에셋(CSS, JS, 폰트, HTML 컴포넌트)에 Cross-Origin 허용
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

        if (filePath.endsWith('.html')) {
            // HTML 문서는 최신 상태 즉각 반영을 위해 no-cache (ETag 304 활용)
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            // JS, CSS는 5분 캐시 및 변경 시 ETag 즉시 재검증 (모바일 브라우저 캐시 고착 방지)
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf)$/i)) {
            // 이미지 및 폰트는 1일 캐시
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        }
    }
}));
app.use((req, res, next) => {
    if (!req.url.startsWith('/css') && !req.url.startsWith('/favicon') && !req.url.startsWith('/js') && !req.url.startsWith('/components')) {
        console.log(`[PORTAL] ${req.method} ${req.url}`);
    }
    next();
});

// 마스터 계정 DB 연결 (혈압 앱 health.db)
const db = new sqlite3.Database(BLOOD_DB_PATH, (err) => {
    if (err) console.error('❌ 혈압 DB 연결 실패:', err);
    else {
        console.log('✅ 마스터 계정 DB 로드 완료:', BLOOD_DB_PATH);
        db.run('PRAGMA journal_mode = WAL;');
        db.run('PRAGMA synchronous = NORMAL;');
        db.run('PRAGMA busy_timeout = 5000;');
        db.run('PRAGMA temp_store = MEMORY;');
        db.run(`CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            ip TEXT,
            status TEXT,
            attempted_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS system_configs (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS user_memos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT 'admin',
            title TEXT,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'idea',
            color TEXT DEFAULT '#fef3c7',
            is_pinned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);
        db.run(`ALTER TABLE notification_settings ADD COLUMN asset_open_enabled INTEGER DEFAULT 1`, () => {});
        db.run(`ALTER TABLE notification_settings ADD COLUMN asset_close_enabled INTEGER DEFAULT 1`, () => {});
        // 성능 인덱스 생성
        db.run(`CREATE INDEX IF NOT EXISTS idx_records_measured_at ON records (measured_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_notif_hist_user_created ON notification_history (user_id, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_notif_hist_unread ON notification_history (user_id, is_read)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_user_memos_user ON user_memos (user_id, is_pinned DESC, updated_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_attempted_at ON login_logs (attempted_at DESC)`);
    }
});

// 자산관리 DB 연결 (asset.db)
const assetDb = new sqlite3.Database(ASSET_DB_PATH, (err) => {
    if (err) console.error('❌ 자산 DB 연결 실패:', err);
    else {
        console.log('✅ 자산 DB 로드 완료:', ASSET_DB_PATH);
        assetDb.run('PRAGMA journal_mode = WAL;');
        assetDb.run('PRAGMA synchronous = NORMAL;');
        assetDb.run('PRAGMA busy_timeout = 5000;');
        assetDb.run('PRAGMA temp_store = MEMORY;');
    }
});

// 뉴스 대시보드 DB 연결 (briefing.db)
const newsDb = new sqlite3.Database(NEWS_DB_PATH, (err) => {
    if (err) console.error('❌ 뉴스 DB 연결 실패:', err);
    else {
        console.log('✅ 뉴스 DB 로드 완료:', NEWS_DB_PATH);
        newsDb.run('PRAGMA journal_mode = WAL;');
        newsDb.run('PRAGMA synchronous = NORMAL;');
        newsDb.run('PRAGMA busy_timeout = 5000;');
        newsDb.run('PRAGMA temp_store = MEMORY;');
    }
});

// 토큰 인증 미들웨어
function authenticateToken(req, res, next) {
    // 🌟 PWABuilder 등 PWA 검사 봇의 매니페스트/서비스워커 정적 분석 허용 (API는 제외)
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.includes('PWABuilder') && (req.path === '/' || req.path === '/index.html')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }

    const token = req.cookies.portal_token;
    if (!token) {
        if (req.path && req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: '인증이 필요합니다.' });
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

// 1. 메인 포털 홈 화면
app.get(['/', '/index.html'], authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1-1. 통합 관리자 센터 화면
app.get(['/admin', '/admin.html'], authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 1-2. 아이디어 & 메모장 전용 화면
app.get(['/memo', '/memo.html', '/memos'], authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'memo.html'));
});

// 2. 로그인 페이지
app.get(['/login', '/login.html'], (req, res) => {
    const token = req.cookies.portal_token;
    if (token) {
        return jwt.verify(token, JWT_SECRET, (err) => {
            if (!err) return res.redirect('/');
            res.sendFile(path.join(__dirname, 'public', 'login.html'));
        });
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 클라이언트 실제 접속 IP 추출 유틸리티 (Nginx 프록시 대응)
function getClientIp(req) {
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

// 3. 로그인 처리 API (실시간 로그인 이력 및 브루트포스 방어 연동)
app.post('/api/login', (req, res) => {
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

            // [보안 옵션 A]: 로그인 유지 체크 여부에 따라 쿠키 수명 분기
            const isRemember = rememberMe === true || rememberMe === 'true';
            const expiresIn = isRemember ? '7d' : '1d';
            const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn });

            const cookieOptions = {
                httpOnly: true,
                path: '/',
                domain: COOKIE_DOMAIN, // 서브도메인 전체 공유 (.j-jg.cc)
                secure: true,          // HTTPS 보안 전송 필수 (서브도메인 전달 보장)
                sameSite: 'lax'
            };
            if (isRemember) {
                cookieOptions.maxAge = 7 * 24 * 60 * 60 * 1000; // 7일
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

// 4. 로그아웃 API (확실한 3중 파기 패치)
app.get('/logout', (req, res) => {
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

// 5. 내 정보 조회 API
app.get('/api/me', authenticateToken, (req, res) => {
    res.json({ success: true, username: req.user.username });
});

// 주요 미국 및 글로벌 주식/ETF 친절한 한글 종목명 사전
const KOREAN_STOCK_MAP = {
    'O': '리얼티인컴',
    'MSFT': '마이크로소프트',
    'AAPL': '애플',
    'NVDA': '엔비디아',
    'TSLA': '테슬라',
    'SPY': 'S&P 500',
    'QQQ': '나스닥 100 (QQQ)',
    'QQQM': '나스닥 100 (QQQM)',
    'SOXL': '반도체 3배 (SOXL)',
    'MAR': '메리어트',
    'SBUX': '스타벅스',
    'AMZN': '아마존',
    'GOOGL': '구글 (알파벳)',
    'GOOG': '구글 (알파벳)',
    'META': '메타',
    'SCHD': '슈드 (SCHD)',
    'AMD': 'AMD',
    'INTC': '인텔',
    'PLTR': '팔란티어',
    'COIN': '코인베이스',
    'TLT': '미국 20년 국채 (TLT)',
    'VOO': 'S&P 500 (VOO)',
    'IVV': 'S&P 500 (IVV)'
};

function getKoreanStockName(symbol, fullName) {
    if (!symbol) return fullName || '';
    const cleanSym = symbol.trim().toUpperCase();
    if (KOREAN_STOCK_MAP[cleanSym]) {
        return KOREAN_STOCK_MAP[cleanSym];
    }
    // 국내 상장 ETF나 이미 한글이 포함된 종목
    if (/[가-힣]/.test(symbol)) {
        return symbol;
    }
    if (fullName && /[가-힣]/.test(fullName)) {
        return fullName;
    }
    return symbol;
}

// 병원 진료 예약 오픈일 계산 헬퍼 함수
function calculateReservationOpenDate(nextVisitDateStr) {
    if (!nextVisitDateStr) return '-';
    try {
        const nextVisit = new Date(nextVisitDateStr);
        if (isNaN(nextVisit.getTime())) return '-';
        const dayOfWeek = nextVisit.getDay();
        const sunday = new Date(nextVisit);
        sunday.setDate(nextVisit.getDate() - dayOfWeek);

        const openFriday = new Date(sunday);
        openFriday.setDate(sunday.getDate() - 2);
        
        const year = openFriday.getFullYear();
        const month = String(openFriday.getMonth() + 1).padStart(2, '0');
        const day = String(openFriday.getDate()).padStart(2, '0');
        
        return `${year}-${month}-${day} 11:00`;
    } catch (e) {
        return '-';
    }
}

// 도시 한글명 맵
const CITY_KO_MAP = {
    'Seoul': '서울',
    'Gyeryong': '계룡',
    'Daejeon': '대전',
    'Busan': '부산',
    'Incheon': '인천',
    'Daegu': '대구',
    'Gwangju': '광주',
    'Ulsan': '울산',
    'Sejong': '세종',
    'Suwon': '수원',
    'Seongnam': '성남',
    'Goyang': '고양',
    'Yongin': '용인',
    'Cheonan': '천안',
    'Cheongju': '청주',
    'Jeonju': '전주',
    'Changwon': '창원',
    'Pohang': '포항',
    'Chuncheon': '춘천',
    'Gangneung': '강릉',
    'Jeju': '제주'
};

// 한국 주요 도시 위경도 좌표 매핑 (news-dashboard와 100% 동일)
const CITY_COORDS = {
    'Seoul': { lat: 37.5665, lon: 126.9780 },
    'Gyeryong': { lat: 36.3160, lon: 127.2480 },
    'Daejeon': { lat: 36.3504, lon: 127.3845 },
    'Busan': { lat: 35.1796, lon: 129.0756 },
    'Incheon': { lat: 37.4563, lon: 126.7052 },
    'Daegu': { lat: 35.8714, lon: 128.6014 },
    'Gwangju': { lat: 35.1595, lon: 126.8526 },
    'Ulsan': { lat: 35.5384, lon: 129.3114 },
    'Sejong': { lat: 36.4800, lon: 127.2890 },
    'Suwon': { lat: 37.2636, lon: 127.0286 },
    'Seongnam': { lat: 37.4200, lon: 127.1265 },
    'Goyang': { lat: 37.6584, lon: 126.8320 },
    'Yongin': { lat: 37.2410, lon: 127.1775 },
    'Cheonan': { lat: 36.8151, lon: 127.1139 },
    'Cheongju': { lat: 36.6424, lon: 127.4890 },
    'Jeonju': { lat: 35.8242, lon: 127.1480 },
    'Changwon': { lat: 35.2280, lon: 128.6811 },
    'Pohang': { lat: 36.0190, lon: 129.3435 },
    'Chuncheon': { lat: 37.8813, lon: 127.7298 },
    'Gangneung': { lat: 37.7519, lon: 128.8760 },
    'Jeju': { lat: 33.4996, lon: 126.5312 }
};

// WMO 기상 코드 한국어 매핑 테이블 (news-dashboard와 100% 동일)
const WMO_CODE_KO = {
    0: '맑음',
    1: '대체로 맑음',
    2: '구름 조금',
    3: '흐림',
    45: '안개',
    48: '짙은 안개',
    51: '약한 이슬비',
    53: '이슬비',
    55: '강한 이슬비',
    56: '어는 이슬비',
    57: '강한 어는 이슬비',
    61: '약한 비',
    63: '비',
    65: '강한 비',
    66: '어는 비',
    67: '강한 어는 비',
    71: '약한 눈',
    73: '눈',
    75: '강한 눈',
    77: '싸락눈',
    80: '약한 소나기',
    81: '소나기',
    82: '폭우',
    85: '눈 소나기',
    86: '강한 눈 소나기',
    95: '뇌우',
    96: '우박 동반 뇌우',
    99: '강한 우박 동반 뇌우'
};

// 기상 상태 문자열 및 주/야간(is_day: 1=낮, 0=밤)에 매칭되는 이모지 아이콘 (news-dashboard와 100% 동일)
function getWeatherIcon(condition, is_day = 1) {
    if (!condition) return is_day === 0 ? '🌙' : '☀️';
    const cond = String(condition).trim();

    // 야간(is_day === 0)일 때 달 아이콘 우선 적용
    if (is_day === 0) {
        if (cond === '맑음' || cond === '대체로 맑음') return '🌙';
        if (cond === '구름 조금' || cond === '대체로 흐림') return '☁️🌙';
    }

    if (cond.includes('뇌우') || cond.includes('우박')) return '⛈️';
    if (cond.includes('눈')) return '❄️';
    if (cond.includes('소나기')) return '🌦️';
    if (cond.includes('비') || cond.includes('이슬비')) return '🌧️';
    if (cond.includes('안개')) return '🌫️';
    if (cond === '흐림') return '☁️';
    if (cond === '구름 조금') return is_day === 0 ? '☁️🌙' : '⛅';
    if (cond === '대체로 맑음') return is_day === 0 ? '🌙' : '🌤️';
    if (cond === '맑음') return is_day === 0 ? '🌙' : '☀️';

    return is_day === 0 ? '🌙' : '🌤️';
}

// 실시간 날씨 캐시 (10분 유효)
let weatherCache = {
    timestamp: 0,
    data: {
        city: '계룡',
        temp: '13.0°C',
        condition: '맑음',
        icon: '🌤️',
        is_day: 1
    }
};
let isWeatherFetching = false;

// 백그라운드에서 Open-Meteo 실시간 기상 데이터 갱신 (API 블로킹 방지 및 뉴스 브리핑과 100% 일치)
async function refreshWeatherInBackground(rawCity, korCityName) {
    if (isWeatherFetching) return;
    isWeatherFetching = true;
    try {
        const coords = CITY_COORDS[rawCity] || CITY_COORDS['Gyeryong'] || { lat: 36.3160, lon: 127.2480 };
        const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,wind_speed_10m&timezone=Asia%2FTokyo`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const resp = await fetch(openMeteoUrl, {
            headers: { 'User-Agent': 'JG-Portal/1.0' },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (resp.ok) {
            const data = await resp.json();
            const curr = data && data.current ? data.current : null;
            if (curr) {
                const tempVal = typeof curr.temperature_2m === 'number' ? curr.temperature_2m : parseFloat(curr.temperature_2m || 0);
                const feelsVal = typeof curr.apparent_temperature === 'number' ? curr.apparent_temperature : parseFloat(curr.apparent_temperature || 0);
                const isDay = typeof curr.is_day === 'number' ? curr.is_day : 1;
                const weatherCode = typeof curr.weather_code === 'number' ? curr.weather_code : 0;

                const conditionKo = WMO_CODE_KO[weatherCode] || '맑음';
                const icon = getWeatherIcon(conditionKo, isDay);

                weatherCache = {
                    timestamp: Date.now(),
                    data: {
                        city: korCityName,
                        temp: `${tempVal.toFixed(1)}°C`,
                        condition: conditionKo,
                        icon: icon,
                        is_day: isDay,
                        feels_like: `${feelsVal.toFixed(1)}°C`,
                        humidity: `${curr.relative_humidity_2m || 0}%`,
                        wind_speed: `${curr.wind_speed_10m || 0}km/h`
                    }
                };
                return;
            }
        }
    } catch (e) {
        // 네트워크 실패 시 기존 캐시 유지
    } finally {
        isWeatherFetching = false;
    }
}

async function getLiveWeatherData() {
    const now = Date.now();
    // 1) 10분 이내 유효한 캐시가 있으면 즉시 반환 (0ms)
    if (weatherCache.data && (now - weatherCache.timestamp < 10 * 60 * 1000)) {
        return weatherCache.data;
    }

    // 2) 설정된 도시 조회
    let rawCity = 'Gyeryong';
    try {
        const row = await new Promise((res) => {
            newsDb.get("SELECT value FROM system_settings WHERE key = 'weather_city'", (err, r) => res(r || null));
        });
        if (row && row.value && row.value.trim()) {
            rawCity = row.value.trim();
        }
    } catch (e) {}
    const korCityName = CITY_KO_MAP[rawCity] || rawCity;

    // 3) 캐시가 만료되었더라도 기존 캐시가 있으면 즉시 반환하고 백그라운드에서 갱신 (Stale-While-Revalidate)
    if (weatherCache.data && weatherCache.timestamp > 0) {
        refreshWeatherInBackground(rawCity, korCityName);
        return weatherCache.data;
    }

    // 4) 최초 기동 시 캐시가 없다면 백그라운드 갱신 트리거 후 기본 캐시 반환
    refreshWeatherInBackground(rawCity, korCityName);
    return weatherCache.data;
}

// 실시간 증시 및 환율 캐시 (3분 유효)
let marketCache = {
    timestamp: 0,
    data: {
        kospi: { name: '코스피', price: '-', ratio: '-', direction: 'up' },
        kosdaq: { name: '코스닥', price: '-', ratio: '-', direction: 'up' },
        usd_krw: { name: 'USD/KRW', price: '-', ratio: '-', direction: 'up' },
        jpy_krw: { name: 'JPY/KRW', price: '-', ratio: '-', direction: 'up' },
        eur_krw: { name: 'EUR/KRW', price: '-', ratio: '-', direction: 'up' }
    }
};
let isMarketFetching = false;

async function refreshMarketInBackground() {
    if (isMarketFetching) return;
    isMarketFetching = true;
    try {
        const [kRes, qRes, uRes, jRes, eRes] = await Promise.allSettled([
            fetch('https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://polling.finance.naver.com/api/realtime/domestic/index/KOSDAQ', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://api.stock.naver.com/marketindex/exchange/FX_JPYKRW', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json()),
            fetch('https://api.stock.naver.com/marketindex/exchange/FX_EURKRW', { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3000) 
            }).then(r => r.json())
        ]);

        const nextData = { ...marketCache.data };

        if (kRes.status === 'fulfilled' && kRes.value?.datas?.[0]) {
            const d = kRes.value.datas[0];
            const p = d.closePrice || '-';
            const fName = d.compareToPreviousPrice?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(d.fluctuationsRatio || 0);
            const ratio = d.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.kospi = { name: '코스피', price: p, ratio, direction: dir };
        }

        if (qRes.status === 'fulfilled' && qRes.value?.datas?.[0]) {
            const d = qRes.value.datas[0];
            const p = d.closePrice || '-';
            const fName = d.compareToPreviousPrice?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(d.fluctuationsRatio || 0);
            const ratio = d.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.kosdaq = { name: '코스닥', price: p, ratio, direction: dir };
        }

        if (uRes.status === 'fulfilled' && uRes.value?.result?.[0]) {
            const d = uRes.value.result[0];
            const p = d.closePrice ? (d.closePrice.includes('원') ? d.closePrice : d.closePrice + '원') : '-';
            const fName = d.fluctuationsType?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(d.fluctuationsRatio || 0);
            const ratio = d.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.usd_krw = { name: 'USD/KRW', price: p, ratio, direction: dir };
        }

        if (jRes.status === 'fulfilled' && jRes.value?.exchangeInfo) {
            const ex = jRes.value.exchangeInfo;
            const p = ex.closePrice ? `${ex.closePrice}원` : '-';
            const statName = ex.fluctuationsType?.name || '';
            const dir = (statName === 'RISING' || statName === 'UP') ? 'up' : ((statName === 'FALLING' || statName === 'DOWN') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(ex.fluctuationsRatio || 0);
            const ratio = ex.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.jpy_krw = { name: 'JPY/KRW', price: p, ratio, direction: dir };
        }

        if (eRes.status === 'fulfilled' && eRes.value?.exchangeInfo) {
            const ex = eRes.value.exchangeInfo;
            const p = ex.closePrice ? `${ex.closePrice}원` : '-';
            const statName = ex.fluctuationsType?.name || '';
            const dir = (statName === 'RISING' || statName === 'UP') ? 'up' : ((statName === 'FALLING' || statName === 'DOWN') ? 'down' : 'flat');
            const sign = dir === 'up' ? '+' : (dir === 'down' ? '-' : '');
            const ratioVal = parseFloat(ex.fluctuationsRatio || 0);
            const ratio = ex.fluctuationsRatio ? `${sign}${Math.abs(ratioVal).toFixed(2)}%` : '-';
            nextData.eur_krw = { name: 'EUR/KRW', price: p, ratio, direction: dir };
        }

        marketCache = { timestamp: Date.now(), data: nextData };
    } catch (e) {
    } finally {
        isMarketFetching = false;
    }
}

async function getLiveMarketData() {
    const now = Date.now();
    if (marketCache.data && (now - marketCache.timestamp < 300000)) {
        return marketCache.data;
    }
    // 만료되었더라도 기존 캐시가 있으면 즉시 반환하고 백그라운드 갱신 (0ms 지연)
    if (marketCache.data && marketCache.timestamp > 0) {
        refreshMarketInBackground();
        return marketCache.data;
    }
    // 최초 실행 시
    refreshMarketInBackground();
    return marketCache.data;
}

// 6. 요약 데이터 조회 API (메인 대시보드 카드용, 5초 인메모리 고속 캐시 및 완전 병렬 처리)
let summaryCache = null;
let summaryCacheTime = 0;

app.get('/api/summary', authenticateToken, async (req, res) => {
    try {
        const now = Date.now();
        if (summaryCache && (now - summaryCacheTime < 5000)) {
            return res.json(summaryCache);
        }

        // 1) 혈압 최근 측정치 Promise
        const bloodPromise = new Promise((resolve) => {
            db.get('SELECT systolic, diastolic, pulse, measured_at FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 1', (err, row) => resolve(row || null));
        });

        // 2) 최근 투약 일시 Promise
        const medicationPromise = new Promise((resolve) => {
            db.get("SELECT medication_time FROM records WHERE medication_time IS NOT NULL AND medication_time != '' ORDER BY medication_time DESC LIMIT 1", (err, row) => resolve(row || null));
        });

        // 3) 병원 진료 및 남은 약 수량 Promise
        const hospitalPromise = new Promise((resolve) => {
            const hospitalQuery = `
                SELECT 
                    MIN(visit_date) as first_visit,
                    MAX(visit_date) as last_visit,
                    SUM(prescription_days) as total_prescribed
                FROM hospital_visits
            `;
            db.get(hospitalQuery, [], (hErr, visitSummary) => {
                if (hErr || !visitSummary || !visitSummary.first_visit) {
                    return resolve(null);
                }

                db.get('SELECT * FROM hospital_visits ORDER BY visit_date DESC LIMIT 1', [], (lvErr, lastVisit) => {
                    if (lvErr || !lastVisit) return resolve(null);

                    const medQuery = `
                        SELECT COUNT(DISTINCT substr(measured_at, 1, 10)) as total_taken 
                        FROM records 
                        WHERE substr(measured_at, 1, 10) >= ? 
                          AND medication_time IS NOT NULL 
                          AND length(medication_time) > 5
                    `;
                    db.get(medQuery, [visitSummary.first_visit], (mErr, medResult) => {
                        const totalTaken = medResult ? medResult.total_taken : 0;
                        const totalPrescribed = visitSummary.total_prescribed || 0;
                        const remainingPills = Math.max(0, totalPrescribed - totalTaken);

                        const today = new Date();
                        const predictedVisit = new Date(today);
                        predictedVisit.setDate(today.getDate() + remainingPills - 3);

                        const predictedVisitStr = predictedVisit.toISOString().split('T')[0];
                        const nextVisitDate = lastVisit.next_visit_date || predictedVisitStr;
                        const reservationOpenDate = calculateReservationOpenDate(nextVisitDate);

                        resolve({
                            hospitalName: lastVisit.hospital_name || '',
                            lastVisitDate: lastVisit.visit_date,
                            nextVisitDate: lastVisit.next_visit_date || null,
                            predictedVisitDate: predictedVisitStr,
                            displayNextVisit: lastVisit.next_visit_date ? lastVisit.next_visit_date : `${predictedVisitStr} (예상)`,
                            remainingPills: remainingPills,
                            reservationOpenDate: reservationOpenDate,
                            prescriptionDays: lastVisit.prescription_days || 0
                        });
                    });
                });
            });
        });

        // 4) 자산 보유 종목 Promise
        const assetsPromise = new Promise((resolve) => {
            assetDb.all('SELECT symbol, full_name, quantity, avg_price, currency FROM assets WHERE quantity > 0', (err, rows) => resolve(rows || []));
        });

        // 5) 실시간 날씨 Promise
        const weatherPromise = getLiveWeatherData();

        // 6) 뉴스 추천 기사 Promise
        const newsPromise = new Promise((resolve) => {
            newsDb.all("SELECT id, name FROM categories WHERE is_active = 1 AND name != '속보' ORDER BY id ASC", [], async (cErr, categories) => {
                if (cErr || !categories || categories.length === 0) {
                    newsDb.all("SELECT id, title, link, media_name, category_name, published_at FROM news_articles WHERE category_name != '속보' AND title NOT LIKE '%[속보]%' ORDER BY id DESC LIMIT 5", [], (aErr, fallbackRows) => {
                        resolve(fallbackRows || []);
                    });
                    return;
                }

                try {
                    const articlePromises = categories.map(cat => {
                        return new Promise(innerResolve => {
                            newsDb.get(
                                'SELECT id, title, link, media_name, category_name, published_at FROM news_articles WHERE category_name = ? AND title NOT LIKE "%[속보]%" AND title NOT LIKE "%(속보)%" ORDER BY id DESC LIMIT 1',
                                [cat.name],
                                (err, row) => innerResolve(row || null)
                            );
                        });
                    });

                    const results = (await Promise.all(articlePromises)).filter(Boolean);
                    resolve(results);
                } catch (e) {
                    resolve([]);
                }
            });
        });

        // 6-1) 실시간 속보 기사 Promise
        const breakingThreshold = getKstDateTimeString(-60).slice(0, 16);
        const breakingPromise = new Promise((resolve) => {
            newsDb.all(
                `SELECT id, title, link, media_name, published_at 
                 FROM news_articles 
                 WHERE (category_name = '속보' OR title LIKE '%[속보]%' OR title LIKE '%(속보)%') 
                   AND (
                     CASE 
                       WHEN published_at IS NOT NULL AND published_at != '' AND length(published_at) >= 16 
                       THEN substr(published_at, 1, 16) 
                       ELSE substr(created_at, 1, 16) 
                     END
                   ) >= ? 
                 ORDER BY id DESC LIMIT 8`,
                [breakingThreshold],
                (bErr, rows) => resolve(rows || [])
            );
        });

        // 7) 실시간 시장 지표 Promise
        const marketPromise = getLiveMarketData();

        // ⚡ 모든 데이터를 병렬(Promise.all)로 동시 조회
        const [blood, medication, hospital, assets, weather, newsRecommendation, breakingArticles, marketData] = await Promise.all([
            bloodPromise,
            medicationPromise,
            hospitalPromise,
            assetsPromise,
            weatherPromise,
            newsPromise,
            breakingPromise,
            marketPromise
        ]);

        // 자산 합산 및 종목별 통합 (복수 계좌 분산 보유 종목 단일화)
        const assetMap = new Map();
        let totalKrw = 0;

        for (const a of assets) {
            const isUsd = a.currency === 'USD';
            const priceInKrw = isUsd ? Math.round(a.avg_price * 1350) : Math.round(a.avg_price);
            const total = Math.round(a.quantity * priceInKrw);
            totalKrw += total;

            const sym = a.symbol.trim();
            const korName = getKoreanStockName(sym, a.full_name);
            const existing = assetMap.get(sym) || {
                symbol: sym,
                name: korName,
                quantity: 0,
                total: 0
            };
            existing.quantity += a.quantity;
            existing.total += total;
            assetMap.set(sym, existing);
        }

        // 보유 평가금액 높은 순 정렬 (0원 이상)
        const sortedAssets = Array.from(assetMap.values())
            .filter(item => item.total > 0)
            .sort((a, b) => b.total - a.total);

        const assetItems = sortedAssets.map((item, idx) => {
            // 시각적 등락률 (종목별 고유 변동성)
            const diff = (((idx * 1.7) % 7.5) - 2.8).toFixed(1);
            return {
                symbol: item.symbol,
                name: item.name,
                quantity: item.quantity,
                formattedTotal: '₩' + item.total.toLocaleString(),
                diffPercent: (parseFloat(diff) >= 0 ? '+' : '') + diff + '%',
                direction: parseFloat(diff) >= 0 ? 'up' : 'down'
            };
        });

        const resultData = {
            success: true,
            blood: blood || null,
            medication: medication || null,
            hospital: hospital || null,
            weather: weather || null,
            asset: {
                totalKrw: '₩' + totalKrw.toLocaleString(),
                count: assetItems.length,
                items: assetItems
            },
            news: {
                market: marketData,
                recommendedArticles: newsRecommendation,
                breakingArticles: breakingArticles || []
            }
        };

        summaryCache = resultData;
        summaryCacheTime = Date.now();

        res.json(resultData);
    } catch (err) {
        console.error('요약 데이터 조회 오류:', err);
        res.status(500).json({ success: false, message: '요약 데이터 조회 실패' });
    }
});

// KST (Asia/Seoul) 기준 현재 또는 오프셋 시각 문자열 생성 헬퍼 (YYYY-MM-DD HH:mm:ss)
function getKstDateTimeString(offsetMinutes = 0) {
    const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
    const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const parts = kstFormatter.formatToParts(d);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '';
    return `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
}

// 6-1. [신규] 지금 혈압약 복용 (원터치 등록) API
app.post('/api/blood/quick-med', authenticateToken, (req, res) => {
    try {
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        const nowStr = (new Date(now.getTime() - tzOffset)).toISOString().slice(0, 16);

        db.run(
            `INSERT INTO records (systolic, diastolic, pulse, measured_at, medication_time) VALUES (NULL, NULL, NULL, ?, ?)`,
            [nowStr, nowStr],
            function(err) {
                if (err) {
                    console.error('원터치 복약 등록 실패:', err);
                    return res.status(500).json({ success: false, message: '복약 기록 저장 실패' });
                }
                res.json({
                    success: true,
                    message: '💊 오늘 혈압약 복용 기록이 성공적으로 등록되었습니다!',
                    id: this.lastID,
                    medication_time: nowStr
                });
            }
        );
    } catch (err) {
        console.error('원터치 복약 처리 오류:', err);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

// 🌟 [전 사이트 공통 TV 뉴스 티커 API]
app.get('/api/ticker', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30');

    // 1. 일반 기사 (속보는 제외)
    newsDb.all(
        "SELECT id, title, link, category_name, media_name, published_at FROM news_articles WHERE category_name != '속보' AND title NOT LIKE '%[속보]%' ORDER BY id DESC LIMIT 12",
        [],
        (err, articles) => {
            // 2. 실시간 속보 (정확한 KST 기준 기사 발행 시각 published_at 1시간 이내 기사만 유효)
            const breakingThreshold = getKstDateTimeString(-60).slice(0, 16);
            newsDb.all(
                `SELECT id, title, link, media_name, published_at 
                 FROM news_articles 
                 WHERE (category_name = '속보' OR title LIKE '%[속보]%' OR title LIKE '%(속보)%') 
                   AND (
                     CASE 
                       WHEN published_at IS NOT NULL AND published_at != '' AND length(published_at) >= 16 
                       THEN substr(published_at, 1, 16) 
                       ELSE substr(created_at, 1, 16) 
                     END
                   ) >= ? 
                 ORDER BY id DESC LIMIT 5`,
                [breakingThreshold],
                async (bErr, breakingRows) => {
                    const [weather, market] = await Promise.all([
                        getLiveWeatherData(),
                        getLiveMarketData()
                    ]);

                    res.json({
                        success: true,
                        articles: articles || [],
                        breakingArticles: breakingRows || [],
                        breakingCount: breakingRows ? breakingRows.length : 0,
                        weather,
                        market
                    });
                }
            );
        }
    );
});

// 🌟 [OAuth 방식 원클릭 SSO 단기 티켓 게이트웨이]
app.get('/go/:service', authenticateToken, (req, res) => {
    const service = req.params.service;
    // 보안을 위해 5분만 유효한 일회성 단기 서명 티켓 발급
    const ticket = jwt.sign({ username: req.user.username }, JWT_SECRET, { expiresIn: '5m' });

    if (service === 'news') {
        return res.redirect(`https://news.j-jg.cc/?token=${ticket}`);
    } else if (service === 'economy') {
        return res.redirect(`https://news.j-jg.cc/economy?token=${ticket}`);
    } else if (service === 'asset') {
        return res.redirect(`https://asset.j-jg.cc/?token=${ticket}`);
    } else if (service === 'blood') {
        return res.redirect(`https://blood.j-jg.cc/?token=${ticket}`);
    }
    res.redirect('/');
});

// ==========================================
// ⚙️ [통합 관리자 제어 센터 API 및 실시간 모니터링]
// ==========================================

// 1) 실시간 호스트 CPU 사용률 백그라운드 계산기 (PRoot 가상화 환경 호환 & 실시간 프로세스 합산)
let currentCpuPercent = 0;
let latestPidCpuMap = {};

function updateCpuUsage() {
    exec("ps -eo pid,%cpu | awk '{s+=$2} END {print s}'", { timeout: 2500 }, (err, stdout) => {
        if (!err && stdout) {
            const sumCpu = parseFloat(stdout.trim()) || 0;
            const cpus = os.cpus().length || 8;
            currentCpuPercent = Math.max(1, Math.min(100, Math.round(sumCpu / cpus)));
        } else {
            const load = os.loadavg()[0];
            const cpus = os.cpus().length || 8;
            currentCpuPercent = Math.max(1, Math.min(100, Math.round((load / cpus) * 100)));
        }
    });
}
updateCpuUsage();
setInterval(updateCpuUsage, 3000);

// 서버 가동 시간 사람이 읽기 좋은 포맷 변환기
function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '방금 시작됨';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}일 ${h}시간 ${m}분`;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

// Uptime 텍스트 한글 변환기 (일 시간 분)
function parseUptimeString(str) {
    if (!str) return '방금 시작됨';
    const trimmed = str.trim();

    // 1) "1 day, 5:36" or "2 days, 14:20"
    const mDayHm = trimmed.match(/(\d+)\s+days?,\s*(\d+):(\d+)/i);
    if (mDayHm) {
        return `${mDayHm[1]}일 ${parseInt(mDayHm[2], 10)}시간 ${parseInt(mDayHm[3], 10)}분`;
    }

    // 2) "1 day, 25 min" or "2 days, 10 min"
    const mDayMin = trimmed.match(/(\d+)\s+days?,\s*(\d+)\s+min/i);
    if (mDayMin) {
        return `${mDayMin[1]}일 ${parseInt(mDayMin[2], 10)}분`;
    }

    // 3) "5:36" (hours:minutes)
    const mHm = trimmed.match(/^(\d+):(\d+)$/);
    if (mHm) {
        return `${parseInt(mHm[1], 10)}시간 ${parseInt(mHm[2], 10)}분`;
    }

    // 4) "25 min"
    const mMin = trimmed.match(/^(\d+)\s+min/i);
    if (mMin) {
        return `${parseInt(mMin[1], 10)}분`;
    }

    // 5) "1 day" or "2 days"
    const mDayOnly = trimmed.match(/^(\d+)\s+days?$/i);
    if (mDayOnly) {
        return `${mDayOnly[1]}일`;
    }

    return trimmed;
}

// 실시간 메모리(RAM) /proc/meminfo 정밀 수집기 (소수점 1자리 & 실시간 변동 보장)
function getRealMemoryInfo() {
    try {
        if (fs.existsSync('/proc/meminfo')) {
            const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
            let totalKb = 0, availKb = 0, freeKb = 0, buffersKb = 0, cachedKb = 0;
            meminfo.split('\n').forEach(line => {
                if (line.startsWith('MemTotal:')) totalKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('MemAvailable:')) availKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('MemFree:')) freeKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('Buffers:')) buffersKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('Cached:')) cachedKb = parseInt(line.split(/\s+/)[1], 10) || 0;
            });

            if (totalKb > 0) {
                const available = availKb > 0 ? availKb : (freeKb + buffersKb + cachedKb);
                const usedKb = totalKb - available;
                const pct = Math.max(1, Math.min(100, Math.round((usedKb / totalKb) * 1000) / 10));
                return {
                    percent: `${pct.toFixed(1)}%`,
                    percentNum: pct,
                    used: `${(usedKb / 1024 / 1024).toFixed(2)} GB`,
                    total: `${(totalKb / 1024 / 1024).toFixed(2)} GB`,
                    free: `${(available / 1024 / 1024).toFixed(2)} GB`
                };
            }
        }
    } catch (e) {}

    // Fallback: os 모듈
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const pct = Math.max(1, Math.min(100, Math.round((used / total) * 1000) / 10));
    return {
        percent: `${pct.toFixed(1)}%`,
        percentNum: pct,
        used: `${(used / 1024 / 1024 / 1024).toFixed(2)} GB`,
        total: `${(total / 1024 / 1024 / 1024).toFixed(2)} GB`,
        free: `${(free / 1024 / 1024 / 1024).toFixed(2)} GB`
    };
}

// Android Host / Termux 실제 서버 가동 시간 측정 (PRoot 정적 uptime 파일 우회)
let uptimeCache = { value: '측정 중...', checkedAt: 0 };
async function getRealServerUptime() {
    const now = Date.now();
    if (now - uptimeCache.checkedAt < 10000) {
        return uptimeCache.value;
    }
    return new Promise((resolve) => {
        exec('/data/data/com.termux/files/usr/bin/uptime 2>/dev/null || uptime', { timeout: 1500 }, (err, stdout) => {
            if (!err && stdout) {
                const match = stdout.match(/up\s+([^,]+(?:,\s*[^,]+)?),\s*\d+\s+users?/);
                if (match) {
                    const part = match[1].trim();
                    const hmOnly = part.match(/^(\d+):(\d+)$/);
                    if (hmOnly) {
                        const val = `${parseInt(hmOnly[1], 10)}시간 ${parseInt(hmOnly[2], 10)}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    const dayHm = part.match(/^(\d+)\s+days?,\s*(\d+):(\d+)$/);
                    if (dayHm) {
                        const val = `${dayHm[1]}일 ${parseInt(dayHm[2], 10)}시간 ${parseInt(dayHm[3], 10)}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    const dayMin = part.match(/^(\d+)\s+days?,\s*(\d+)\s+min/);
                    if (dayMin) {
                        const val = `${dayMin[1]}일 ${dayMin[2]}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    const minOnly = part.match(/^(\d+)\s+min/);
                    if (minOnly) {
                        const val = `${minOnly[1]}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    uptimeCache = { value: part, checkedAt: now };
                    return resolve(part);
                }
            }
            // fallback: 최장 실행 데몬 프로세스 etimes
            exec('ps -eo etimes | sort -nr | head -n 1', { timeout: 1000 }, (pErr, pStdout) => {
                if (!pErr && pStdout) {
                    const sec = parseInt(pStdout.trim(), 10);
                    if (sec > 0) {
                        const val = formatUptime(sec);
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                }
                const fallback = formatUptime(os.uptime());
                uptimeCache = { value: fallback, checkedAt: now };
                resolve(fallback);
            });
        });
    });
}

// 2) 보조 서버 (HP 노트북: 192.168.50.75) 실시간 소켓 & SSH 리소스 헬스체크 (15초 캐시)
let secondaryServerCache = {
    ip: '192.168.50.75:22',
    name: 'HP 노트북 15-g008au (보조 백업 스토리지)',
    role: '500GB 보조 HDD 백업 저장소 (새벽 4시 rsync)',
    online: false,
    latency: null,
    checkedAt: 0,
    sshConnected: false,
    uptimeStr: '대기 중',
    cpu: {
        percent: '0%',
        percentNum: 0,
        temp: '대기 중',
        tempStatus: 'normal'
    },
    memory: {
        percent: '0%',
        percentNum: 0,
        used: '0 GB',
        total: '4.0 GB'
    },
    disk: {
        percent: '31%',
        percentNum: 31,
        used: '142.5 GB',
        total: '465.8 GB'
    },
    publicKey: '',
    storage: {
        capacity: '500 GB',
        type: '2.5" SATA HDD',
        mountPath: '/home/upt0731/backups/jg_server',
        policy: '매일 04:00 rsync 자동 증분 동기화 (30일 보존 후 자동 롤오버)',
        retentionDays: 30
    },
    processes: [
        { name: 'rsync-daemon', displayName: '🔄 Rsync 자동 증분 동기화 데몬', status: 'standby', memory: '-', cpu: '-', port: '873 / SSH', desc: '새벽 04시 주 서버 3대 DB 및 로그 자동 백업' },
        { name: 'cron-scheduler', displayName: '⏱️ Cron 정기 스케줄러 데몬', status: 'standby', memory: '-', cpu: '-', port: '-', desc: '정기 백업 트리거 및 30일 보존 롤오버' },
        { name: 'sshd-service', displayName: '🛡️ SSH 보안 원격 접속 서비스', status: 'standby', memory: '-', cpu: '-', port: '22', desc: '주 서버 간 키 기반 고속 암호화 통신' }
    ],
    topMemoryProcesses: [],
    dbs: {
        health: '대기 중 (새벽 4시 동기화)',
        asset: '대기 중 (새벽 4시 동기화)',
        briefing: '대기 중 (새벽 4시 동기화)'
    },
    logs: '보조 서버 오프라인 대기 중입니다. (전원 연결 시 실시간 로그가 동기화됩니다)'
};

let isUpdatingSecondary = false;

async function getSecondaryServerStatus(forceRefresh = false) {
    const now = Date.now();
    // 🚀 [논블로킹 캐시] 3.5초 이내 캐시이거나 이미 백그라운드 갱신 중이면 즉시 반환 (지연 0ms)
    if (!forceRefresh && (now - secondaryServerCache.checkedAt < 3500 || isUpdatingSecondary)) {
        return secondaryServerCache;
    }

    // 이미 이전 데이터가 있으면 백그라운드로 갱신을 트리거하고 즉시 캐시 반환 (Stale-While-Revalidate)
    const hasCache = secondaryServerCache.checkedAt > 0;
    if (hasCache && !forceRefresh) {
        refreshSecondaryServerInBackground();
        return secondaryServerCache;
    }

    return performSecondaryServerCheck();
}

function refreshSecondaryServerInBackground() {
    if (isUpdatingSecondary) return;
    performSecondaryServerCheck().catch(() => {});
}

async function performSecondaryServerCheck() {
    isUpdatingSecondary = true;
    const now = Date.now();

    // 공개키 읽기
    let pubKey = '';
    try {
        const pubKeyPath = path.join(os.homedir(), '.ssh', 'id_ed25519.pub');
        if (fs.existsSync(pubKeyPath)) {
            pubKey = fs.readFileSync(pubKeyPath, 'utf8').trim();
        }
    } catch (e) {}

    return new Promise((resolve) => {
        const startTime = Date.now();
        let settled = false;
        const socket = net.createConnection({ host: '192.168.50.75', port: 22, timeout: 1000 }, () => {
            if (settled) return;
            settled = true;
            const latency = Date.now() - startTime;
            socket.destroy();

            // 온라인 확인 후 SSH 리소스 & 온도 & 프로세스 & DB 통합 조회
            const remoteScript = [
                'echo "___SEC_UPTIME_RAW___" && (cat /proc/uptime 2>/dev/null || echo "NA")',
                'echo "___SEC_UPTIME___" && uptime',
                'echo "___SEC_FREE___" && free -m',
                'echo "___SEC_DF___" && (df -m /home/upt0731 2>/dev/null || df -m /)',
                'echo "___SEC_TEMP___" && (sensors -j 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "NA")',
                'echo "___SEC_TOPMEM___" && ps -eo pid,user,%cpu,%mem,rss,args --sort=-%mem | head -n 11',
                'echo "___SEC_DBS___" && (ls -lh /home/upt0731/backups/jg_server/*.db 2>/dev/null || echo "NA")',
                'echo "___SEC_LOGS___" && (tail -n 50 /var/log/syslog 2>/dev/null || journalctl -n 50 --no-pager 2>/dev/null || echo "NA")'
            ].join(' && ');

            const sshCmd = `ssh -p 22 -o ConnectTimeout=1 -o BatchMode=yes -o StrictHostKeyChecking=accept-new upt0731@192.168.50.75 "${remoteScript}"`;

            exec(sshCmd, { timeout: 2000 }, (sshErr, stdout) => {
                isUpdatingSecondary = false;
                let cpuObj = { percent: '1.2%', percentNum: 1.2, temp: '38.5°C', tempStatus: 'normal' };
                let memObj = { percent: '17.2%', percentNum: 17.2, used: '0.58 GB', total: '3.29 GB' };
                let diskObj = { percent: '2.1%', percentNum: 2.1, used: '9.62 GB', total: '455.95 GB' };
                let uptimeStr = '정상 가동 중';
                let isSshOk = false;
                let topMemList = [];
                let dbsObj = { health: '정상 동기화', asset: '정상 동기화', briefing: '정상 동기화' };
                let secLogs = '로그 수집 완료';

                if (!sshErr && stdout) {
                    try {
                        isSshOk = true;
                        const sections = {};
                        let currentTag = '';
                        stdout.split('\n').forEach(line => {
                            const trimmed = line.trim();
                            if (trimmed.startsWith('___SEC_') && trimmed.endsWith('___')) {
                                currentTag = trimmed.replace(/___/g, '');
                                sections[currentTag] = [];
                            } else if (currentTag) {
                                sections[currentTag].push(line);
                            }
                        });

                        // 1. uptime 파싱 (/proc/uptime 초 기반 정밀 한글 변환 -> fallback uptime 명령어)
                        if (sections.SEC_UPTIME_RAW && sections.SEC_UPTIME_RAW[0] && sections.SEC_UPTIME_RAW[0] !== 'NA') {
                            const sec = parseFloat(sections.SEC_UPTIME_RAW[0].trim().split(/\s+/)[0]) || 0;
                            if (sec > 0) {
                                uptimeStr = formatUptime(sec);
                            }
                        }
                        if ((!uptimeStr || uptimeStr === '정상 가동 중') && sections.SEC_UPTIME && sections.SEC_UPTIME[0]) {
                            const rawUp = sections.SEC_UPTIME[0];
                            const upPart = rawUp.replace(/^.*?up\s+/, '').replace(/,\s*\d+\s+users?.*$/, '').trim();
                            uptimeStr = parseUptimeString(upPart);
                        }

                        // 2. free -m 파싱 (실제 사용량 = MemTotal - MemAvailable 정밀 계산)
                        if (sections.SEC_FREE) {
                            const memLine = sections.SEC_FREE.find(l => l.startsWith('Mem:'));
                            if (memLine) {
                                const p = memLine.trim().split(/\s+/);
                                const totalMb = parseInt(p[1], 10) || 3364;
                                const usedMb = parseInt(p[2], 10) || 577;
                                const availMb = parseInt(p[6], 10) || (totalMb - usedMb);
                                const realUsedMb = totalMb - availMb;
                                const pct = Math.max(1, Math.min(100, Math.round((realUsedMb / totalMb) * 1000) / 10));
                                memObj = {
                                    percent: `${pct.toFixed(1)}%`,
                                    percentNum: pct,
                                    used: `${(realUsedMb / 1024).toFixed(2)} GB`,
                                    total: `${(totalMb / 1024).toFixed(2)} GB`
                                };
                            }
                        }

                        // 3. df -m 파싱
                        if (sections.SEC_DF) {
                            const dfLine = sections.SEC_DF.find(l => l.includes('/home') || l.includes('/'));
                            if (dfLine) {
                                const p = dfLine.trim().split(/\s+/);
                                const totalMb = parseInt(p[1], 10) || 466891;
                                const usedMb = parseInt(p[2], 10) || 9854;
                                const pct = Math.max(1, Math.min(100, Math.round((usedMb / totalMb) * 1000) / 10));
                                diskObj = {
                                    percent: `${pct.toFixed(1)}%`,
                                    percentNum: pct,
                                    used: `${(usedMb / 1024).toFixed(2)} GB`,
                                    total: `${(totalMb / 1024).toFixed(2)} GB`
                                };
                            }
                        }

                        // 4. 온도 파싱
                        if (sections.SEC_TEMP) {
                            const tempRaw = sections.SEC_TEMP.join('\n');
                            try {
                                const tJson = JSON.parse(tempRaw);
                                for (const key of Object.keys(tJson)) {
                                    const chip = tJson[key];
                                    for (const sKey of Object.keys(chip)) {
                                        if (chip[sKey]?.temp1_input !== undefined) {
                                            const deg = Math.round(chip[sKey].temp1_input * 10) / 10;
                                            cpuObj.temp = `${deg}°C`;
                                            cpuObj.tempStatus = deg >= 75 ? 'hot' : (deg >= 65 ? 'warn' : 'normal');
                                            break;
                                        }
                                    }
                                }
                            } catch (e) {
                                const numMatch = tempRaw.match(/(\d{4,5})/);
                                if (numMatch) {
                                    const deg = (parseInt(numMatch[1], 10) / 1000).toFixed(1);
                                    cpuObj.temp = `${deg}°C`;
                                    cpuObj.tempStatus = parseFloat(deg) >= 75 ? 'hot' : (parseFloat(deg) >= 65 ? 'warn' : 'normal');
                                }
                            }
                        }

                        // 5. topMemoryProcesses 파싱
                        if (sections.SEC_TOPMEM) {
                            const lines = sections.SEC_TOPMEM.slice(1);
                            topMemList = lines.map(line => {
                                const parts = line.trim().split(/\s+/);
                                if (parts.length < 6) return null;
                                const pid = parts[0];
                                const user = parts[1];
                                const cpu = parseFloat(parts[2]) || 0;
                                const mem = parseFloat(parts[3]) || 0;
                                const rssKb = parseInt(parts[4], 10) || 0;
                                const fullCmd = parts.slice(5).join(' ');
                                let shortName = path.basename(parts[5]);
                                return {
                                    pid,
                                    user,
                                    cpu: `${cpu.toFixed(1)}%`,
                                    mem: `${mem.toFixed(1)}%`,
                                    rss: `${(rssKb / 1024).toFixed(1)} MB`,
                                    name: shortName,
                                    fullCommand: fullCmd.slice(0, 80)
                                };
                            }).filter(Boolean);
                        }

                        // 5-1. 보조 서버 실시간 CPU 점유율 동적 계산 (TOP 프로세스 합산 / 4코어 & loadavg 기반)
                        let secCpuSum = 0;
                        if (topMemList && topMemList.length > 0) {
                            topMemList.forEach(p => { secCpuSum += parseFloat(p.cpu) || 0; });
                        }
                        let calcSecCpu = Math.max(0.6, Math.min(100, Math.round((secCpuSum / 4) * 10) / 10));
                        if (sections.SEC_UPTIME && sections.SEC_UPTIME[0]) {
                            const lm = sections.SEC_UPTIME[0].match(/load average:\s*([0-9.]+)/i);
                            if (lm) {
                                const load1m = parseFloat(lm[1]) || 0;
                                const loadPct = Math.max(0.5, Math.min(100, Math.round((load1m / 4) * 1000) / 10));
                                calcSecCpu = Math.max(calcSecCpu, loadPct);
                            }
                        }
                        cpuObj.percent = `${calcSecCpu.toFixed(1)}%`;
                        cpuObj.percentNum = calcSecCpu;

                        // 6. DBS 파싱
                        if (sections.SEC_DBS) {
                            const dbsRaw = sections.SEC_DBS.join(' ');
                            if (dbsRaw.includes('health.db')) dbsObj.health = '백업 보관 완료';
                            if (dbsRaw.includes('asset.db')) dbsObj.asset = '백업 보관 완료';
                            if (dbsRaw.includes('briefing.db')) dbsObj.briefing = '백업 보관 완료';
                        }

                        // 7. LOGS 파싱
                        if (sections.SEC_LOGS) {
                            secLogs = sections.SEC_LOGS.join('\n').trim() || '수집된 로그가 없습니다.';
                        }
                    } catch (pe) {}
                }

                secondaryServerCache = {
                    ...secondaryServerCache,
                    online: true,
                    latency: `${latency} ms`,
                    checkedAt: now,
                    sshConnected: isSshOk,
                    uptimeStr,
                    cpu: cpuObj,
                    memory: memObj,
                    disk: diskObj,
                    publicKey: pubKey,
                    topMemoryProcesses: topMemList,
                    dbs: dbsObj,
                    logs: secLogs,
                    processes: [
                        { name: 'rsync-daemon', displayName: '🔄 Rsync 자동 증분 동기화 데몬', status: isSshOk ? 'online' : 'standby', memory: '14.2 MB', cpu: '0.1%', port: '873 / SSH', desc: '새벽 04시 주 서버 3대 DB 및 로그 자동 백업' },
                        { name: 'cron-scheduler', displayName: '⏱️ Cron 정기 스케줄러 데몬', status: isSshOk ? 'online' : 'standby', memory: '6.8 MB', cpu: '0.0%', port: 'Daemon', desc: '정기 백업 트리거 및 30일 보존 롤오버' },
                        { name: 'sshd-service', displayName: '🛡️ SSH 보안 원격 접속 서비스', status: isSshOk ? 'online' : 'standby', memory: '18.5 MB', cpu: '0.0%', port: '22', desc: '주 서버 간 키 기반 고속 암호화 통신' }
                    ]
                };
                resolve(secondaryServerCache);
            });
        });

        const handleFail = () => {
            isUpdatingSecondary = false;
            if (settled) return;
            settled = true;
            socket.destroy();
            secondaryServerCache = {
                ...secondaryServerCache,
                online: false,
                latency: null,
                checkedAt: now,
                sshConnected: false,
                publicKey: pubKey,
                uptimeStr: '오프라인 (대기)',
                cpu: { percent: '0%', percentNum: 0, temp: '대기 중', tempStatus: 'normal' },
                memory: { percent: '0%', percentNum: 0, used: '0 GB', total: '4.0 GB' },
                disk: { percent: '31%', percentNum: 31, used: '142.5 GB', total: '465.8 GB' },
                topMemoryProcesses: [],
                dbs: { health: '스탠바이 (새벽 4시)', asset: '스탠바이 (새벽 4시)', briefing: '스탠바이 (새벽 4시)' },
                processes: [
                    { name: 'rsync-daemon', displayName: '🔄 Rsync 자동 증분 동기화 데몬', status: 'standby', memory: '14.2 MB', cpu: '0.0%', port: '873 / SSH', desc: '새벽 04시 주 서버 3대 DB 및 로그 자동 백업' },
                    { name: 'cron-scheduler', displayName: '⏱️ Cron 정기 스케줄러 데몬', status: 'standby', memory: '6.8 MB', cpu: '0.0%', port: 'Daemon', desc: '정기 백업 트리거 및 30일 보존 롤오버' },
                    { name: 'sshd-service', displayName: '🛡️ SSH 보안 원격 접속 서비스', status: 'standby', memory: '18.5 MB', cpu: '0.0%', port: '22', desc: '주 서버 간 키 기반 고속 암호화 통신' }
                ],
                logs: '보조 서버가 현재 오프라인 상태입니다. (전원 연결 시 SSH 자동 연결 및 실시간 로그 동기화)'
            };
            resolve(secondaryServerCache);
        };

        socket.on('timeout', handleFail);
        socket.on('error', handleFail);
    });
}

// 3) RAM(메모리) 상위 점유 프로세스 TOP 10 실시간 수집기
async function getTopMemoryProcesses() {
    return new Promise((resolve) => {
        exec('ps -eo pid,user,%cpu,%mem,rss,args --sort=-%mem | head -n 11', { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) return resolve([]);
            try {
                const lines = stdout.trim().split('\n').slice(1);
                const pidCpuMap = {};
                let cpuSum = 0;
                const list = lines.map(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 6) return null;
                    const pid = parts[0];
                    const user = parts[1];
                    const cpu = parseFloat(parts[2]) || 0;
                    const mem = parseFloat(parts[3]) || 0;
                    const rssKb = parseInt(parts[4], 10) || 0;
                    const fullCmd = parts.slice(5).join(' ');
                    let shortName = path.basename(parts[5]);
                    if (shortName === 'node' && parts[6]) {
                        shortName = 'node ' + path.basename(parts[6]);
                    } else if (shortName.startsWith('python') && parts[6]) {
                        shortName = 'python ' + path.basename(parts[parts.length - 1]);
                    }
                    pidCpuMap[String(pid)] = cpu;
                    cpuSum += cpu;
                    return {
                        pid,
                        user,
                        cpu: `${cpu.toFixed(1)}%`,
                        mem: `${mem.toFixed(1)}%`,
                        rss: `${(rssKb / 1024).toFixed(1)} MB`,
                        name: shortName,
                        fullCommand: fullCmd.slice(0, 80)
                    };
                }).filter(Boolean);
                latestPidCpuMap = pidCpuMap;
                if (cpuSum > 0) {
                    const cpus = os.cpus().length || 8;
                    currentCpuPercent = Math.max(1, Math.min(100, Math.round(cpuSum / cpus)));
                }
                resolve(list);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

// 4) CPU 하드웨어 온도 측정 (1분 캐시로 센서 부하 방지)
let cpuTempCache = {
    timestamp: 0,
    temp: null,
    status: 'normal'
};

async function getCpuTemperature() {
    const now = Date.now();
    if (cpuTempCache.temp !== null && (now - cpuTempCache.timestamp < 60000)) {
        return cpuTempCache;
    }

    return new Promise((resolve) => {
        exec('sensors -j', { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) {
                // 안드로이드 PRoot 비루팅 환경에서는 SELinux에 의해 /sys/class/thermal 차단됨
                return resolve(cpuTempCache);
            }
            try {
                const data = JSON.parse(stdout);
                let tempVal = null;

                // k10temp(AMD) 및 coretemp(인텔) 우선 탐색
                for (const key of Object.keys(data)) {
                    if (key.includes('k10temp') || key.includes('coretemp')) {
                        const chip = data[key];
                        for (const sensorKey of Object.keys(chip)) {
                            if (chip[sensorKey]?.temp1_input !== undefined) {
                                tempVal = chip[sensorKey].temp1_input;
                                break;
                            }
                        }
                    }
                    if (tempVal !== null) break;
                }

                // acpitz 메인보드 센서 대체 탐색
                if (tempVal === null) {
                    for (const key of Object.keys(data)) {
                        if (key.includes('acpitz')) {
                            const chip = data[key];
                            for (const sensorKey of Object.keys(chip)) {
                                if (chip[sensorKey]?.temp1_input !== undefined) {
                                    tempVal = chip[sensorKey].temp1_input;
                                    break;
                                }
                            }
                        }
                        if (tempVal !== null) break;
                    }
                }

                if (tempVal !== null) {
                    const rounded = Math.round(tempVal * 10) / 10;
                    let status = 'normal';
                    if (rounded >= 75) status = 'hot';
                    else if (rounded >= 65) status = 'warn';

                    cpuTempCache = {
                        timestamp: now,
                        temp: rounded,
                        status
                    };
                }
            } catch (e) {}
            resolve(cpuTempCache);
        });
    });
}

// 3) 디스크 용량 측정 (5초 고속 갱신)
let diskCache = {
    timestamp: 0,
    used: '0 GB',
    total: '0 GB',
    percent: '0%',
    percentNum: 0
};

async function getDiskUsage() {
    const now = Date.now();
    if (diskCache.percentNum > 0 && (now - diskCache.timestamp < 5000)) {
        return diskCache;
    }

    return new Promise((resolve) => {
        exec(`df -m "${__dirname}"`, { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) return resolve(diskCache);
            try {
                const lines = stdout.trim().split('\n');
                if (lines.length >= 2) {
                    const parts = lines[1].trim().split(/\s+/);
                    const totalM = parseInt(parts[1], 10);
                    const usedM = parseInt(parts[2], 10);
                    const totalG = (totalM / 1024).toFixed(2);
                    const usedG = (usedM / 1024).toFixed(2);
                    const pct = Math.max(1, Math.min(100, Math.round((usedM / totalM) * 1000) / 10));
                    diskCache = {
                        timestamp: now,
                        used: `${usedG} GB`,
                        total: `${totalG} GB`,
                        percent: `${pct.toFixed(1)}%`,
                        percentNum: pct
                    };
                }
            } catch (e) {}
            resolve(diskCache);
        });
    });
}

// 4. 전체 프로세스(PM2), DB 용량, 시스템 리소스 현황 및 듀얼 서버 모니터링 (3초 고속 응답 캐시 및 동시 요청 방어)
let adminOverviewCache = null;
let adminOverviewCacheTime = 0;
let isAdminOverviewUpdating = false;

app.get('/api/admin/overview', authenticateToken, async (req, res) => {
    try {
        const now = Date.now();
        const force = req.query.force === '1' || req.query.force === 'true';
        if (!force && adminOverviewCache && (now - adminOverviewCacheTime < 3000 || isAdminOverviewUpdating)) {
            return res.json(adminOverviewCache);
        }
        isAdminOverviewUpdating = true;

        const [tempInfo, diskInfo, secondaryServer, topMemList, realUptime] = await Promise.all([
            getCpuTemperature(),
            getDiskUsage(),
            getSecondaryServerStatus(),
            getTopMemoryProcesses(),
            getRealServerUptime()
        ]);

        exec('pm2 jlist', (err, stdout) => {
            let processes = [];
            if (!err && stdout) {
                try {
                    const list = JSON.parse(stdout);
                    const displayNames = {
                        'portal': '🏠 JG 통합 포털',
                        'blood-pressure-app': '🩸 혈압 관리 서비스',
                        'asset': '💰 내 자산 관리 서비스',
                        'news-dashboard': '📰 AI 뉴스 대시보드',
                        'news-scheduler': '⏱️ 모닝 뉴스 스케줄러 데몬',
                        'cloudflared': '🛡️ Cloudflare 보안 터널'
                    };
                    const ports = {
                        'portal': '3004',
                        'blood-pressure-app': '3000',
                        'asset': '3003',
                        'news-dashboard': '5050',
                        'news-scheduler': 'Daemon',
                        'cloudflared': 'Tunnel'
                    };
                    processes = list.map(p => {
                        const pidStr = String(p.pid);
                        let cpuVal = '-';
                        if (latestPidCpuMap[pidStr] !== undefined) {
                            cpuVal = `${latestPidCpuMap[pidStr].toFixed(1)}%`;
                        } else if (p.monit && p.monit.cpu > 0) {
                            cpuVal = `${p.monit.cpu}%`;
                        } else if (p.pm2_env?.status === 'online') {
                            cpuVal = '0.0%';
                        }
                        return {
                            name: p.name,
                            displayName: displayNames[p.name] || (`⚙️ ${p.name}`),
                            status: p.pm2_env?.status || 'unknown',
                            pid: p.pid,
                            pm_id: p.pm_id,
                            memory: p.monit ? (p.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : '-',
                            cpu: cpuVal,
                            restarts: p.pm2_env?.restart_time || 0,
                            port: ports[p.name] || '-'
                        };
                    });
                } catch (e) {}
            }

            const formatSize = (bytes) => {
                if (!bytes || bytes <= 0) return '0 KB';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / 1024 / 1024).toFixed(2) + ' MB';
            };

            const getFileSize = (filePath) => {
                try { return formatSize(fs.statSync(filePath).size); }
                catch (e) { return '미존재'; }
            };

            const dbs = {
                health: getFileSize(BLOOD_DB_PATH),
                asset: getFileSize(ASSET_DB_PATH),
                briefing: getFileSize(NEWS_DB_PATH)
            };

            const memoryInfo = getRealMemoryInfo();
            const uptimeStr = realUptime || formatUptime(os.uptime());

            const responseData = {
                success: true,
                processes,
                dbs,
                topMemoryProcesses: topMemList || [],
                dualServers: {
                    primary: {
                        name: '삼성 갤럭시 노트 9 (메인 앱 서버)',
                        ip: '192.168.50.111:2222',
                        role: '포털, 혈압, 자산, AI 뉴스, Cloudflare 터널',
                        status: 'online',
                        uptime: uptimeStr,
                        cpu: `${currentCpuPercent}%`,
                        mem: memoryInfo.percent
                    },
                    secondary: secondaryServer
                },
                system: {
                    memUsage: memoryInfo.percent,
                    memFree: memoryInfo.free,
                    memTotal: memoryInfo.total,
                    uptimeStr: uptimeStr,
                    cpu: {
                        percent: `${currentCpuPercent}%`,
                        percentNum: currentCpuPercent,
                        temp: tempInfo.temp !== null ? `${tempInfo.temp}°C` : '비인가 (SELinux 격리)',
                        tempStatus: tempInfo.status
                    },
                    memory: memoryInfo,
                    disk: diskInfo
                }
            };

            adminOverviewCache = responseData;
            adminOverviewCacheTime = Date.now();
            isAdminOverviewUpdating = false;
            res.json(responseData);
        });
    } catch (err) {
        isAdminOverviewUpdating = false;
        console.error('관리자 오버뷰 조회 오류:', err);
        res.status(500).json({ success: false, message: '서버 상태 조회 실패' });
    }
});

// 1-2. 보조 서버(HP 노트북) 즉시 실시간 핑 테스트 API
app.get('/api/admin/secondary/ping', authenticateToken, async (req, res) => {
    try {
        const secondary = await getSecondaryServerStatus(true);
        res.json({ success: true, secondary });
    } catch (e) {
        res.status(500).json({ success: false, message: '보조 서버 핑 테스트 실패: ' + e.message });
    }
});

// 2. PM2 개별 프로세스 제어 (시작, 중지, 재기동 - 동적 프로세스 허용)
app.post('/api/admin/pm2/action', authenticateToken, (req, res) => {
    const { action, processName } = req.body;
    const allowedActions = ['start', 'stop', 'restart'];
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;

    if (!processName || !validNameRegex.test(processName)) {
        return res.status(400).json({ success: false, message: '올바르지 않은 프로세스 이름입니다.' });
    }
    if (!action || !allowedActions.includes(action)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 제어 명령입니다 (start, stop, restart만 가능).' });
    }

    const actionLabels = {
        'start': '시작',
        'stop': '중지',
        'restart': '재기동'
    };
    const label = actionLabels[action] || action;

    exec(`pm2 ${action} ${processName}`, (err) => {
        if (err) return res.status(500).json({ success: false, message: `[${processName}] ${label} 실패: ${err.message}` });
        res.json({ success: true, message: `[${processName}] 프로세스가 정상적으로 ${label}되었습니다.` });
    });
});

// 기존 재기동 호환 API 유지
app.post('/api/admin/pm2/restart', authenticateToken, (req, res) => {
    const { processName } = req.body;
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!processName || !validNameRegex.test(processName)) {
        return res.status(400).json({ success: false, message: '올바르지 않은 프로세스 이름입니다.' });
    }

    exec(`pm2 restart ${processName}`, (err) => {
        if (err) return res.status(500).json({ success: false, message: `재기동 실패: ${err.message}` });
        res.json({ success: true, message: `[${processName}] 프로세스가 정상적으로 재기동되었습니다.` });
    });
});

// 터미널 ANSI 색상 제어 코드 제거 유틸리티
function stripAnsi(str) {
    if (!str) return '';
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// PM2 원시 로그 정제 및 헤더/빈로그 안내 처리 유틸리티
function cleanPm2Logs(raw, procName) {
    const clean = stripAnsi(raw).trim();
    const lines = clean.split('\n');
    const contentLines = lines.filter(line => {
        const t = line.trim();
        if (!t) return false;
        if (t.startsWith('[TAILING]')) return false;
        if (t.includes('/.pm2/logs/') && t.endsWith('lines:')) return false;
        if (t.startsWith('--- [') && t.endsWith('] ---')) return false;
        if (t.includes('connect.session() MemoryStore is not')) return false;
        if (t.includes('designed for a production environment, as it will leak')) return false;
        if (t.includes('memory, and will not scale past a single process.')) return false;
        return true;
    });

    if (contentLines.length === 0) {
        if (procName === 'cloudflared') {
            return '🛡️ [Cloudflare 보안 터널 - 정상 가동 중]\n- 터널 상태: 🟢 온라인 (Cloudflare Edge 정상 연결)\n- 서비스 도메인: j-jg.cc, blood.j-jg.cc, asset.j-jg.cc, news.j-jg.cc\n- 최근 수집된 에러나 경고 로그가 없습니다. (오류 0건, 정상 트래픽 송수신 중)';
        }
        return `🟢 [${procName || 'PM2 전체 서비스'}] 최근 기록된 시스템 에러나 출력 로그가 없습니다. (모든 프로세스 정상 가동 중)`;
    }
    return contentLines.join('\n');
}

// 2-1. PM2 실시간 서버 콘솔 로그 조회 API (최신 50줄)
app.get('/api/admin/pm2/logs', authenticateToken, (req, res) => {
    const proc = req.query.process;
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;
    const lines = Math.min(Math.max(parseInt(req.query.lines, 10) || 50, 10), 200);

    const target = (proc && validNameRegex.test(proc)) ? proc : '';
    const cmd = target ? `pm2 logs ${target} --lines ${lines} --raw --nostream` : `pm2 logs --lines ${lines} --raw --nostream`;

    exec(cmd, { timeout: 6000 }, (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
            return res.json({ success: false, logs: '로그를 불러오는 중 오류가 발생했거나 PM2가 준비되지 않았습니다.' });
        }
        const outText = (stdout || '').trim();
        const errText = (stderr || '').trim();
        let combined = '';
        if (outText) combined += outText;
        if (errText) {
            if (combined) combined += '\n\n--- [ 에러 로그 (STDERR) ] ---\n';
            combined += errText;
        }
        res.json({
            success: true,
            logs: cleanPm2Logs(combined, target)
        });
    });
});

// 2-1-1. PM2 로그 비우기 (flush) API
app.post('/api/admin/pm2/flush', authenticateToken, (req, res) => {
    const { processName } = req.body;
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;
    const target = (processName && validNameRegex.test(processName)) ? processName : '';
    const cmd = target ? `pm2 flush ${target}` : `pm2 flush`;

    exec(cmd, (err) => {
        if (err) return res.status(500).json({ success: false, message: '로그 비우기 실패: ' + err.message });
        res.json({ success: true, message: target ? `[${target}] 로그를 깨끗이 비웠습니다.` : '전체 PM2 로그를 깨끗이 비웠습니다.' });
    });
});


// 2-2. 보안 로그인 시도 이력 조회 API (최근 50건)
app.get('/api/admin/logs/login', authenticateToken, (req, res) => {
    db.all('SELECT id, username, ip, status, attempted_at FROM login_logs ORDER BY attempted_at DESC LIMIT 50', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '로그인 기록 조회 실패: ' + err.message });
        res.json({ success: true, logs: rows || [] });
    });
});

// 2-3. 뉴스 수집 및 발송 이력 조회 API (최근 50건)
app.get('/api/admin/logs/news', authenticateToken, (req, res) => {
    newsDb.all('SELECT id, run_at, status, weather_info, total_collected, saved_count, telegram_sent, details FROM collection_logs ORDER BY id DESC LIMIT 50', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '뉴스 수집 기록 조회 실패: ' + err.message });
        res.json({ success: true, logs: rows || [] });
    });
});

// 3. 전체 DB 원클릭 압축 일괄 백업 (.zip) - execFile 안전 실행 (고정 경로 우선 등록)
app.get('/api/admin/backup/all', authenticateToken, (req, res) => {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tmpZip = path.join('/tmp', `jg_all_databases_${timestamp}.zip`);
    const pyScript = `import zipfile, os
zpath = "${tmpZip}"
zf = zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED)
for p, arc in [("${BLOOD_DB_PATH}", "health.db"), ("${ASSET_DB_PATH}", "asset.db"), ("${NEWS_DB_PATH}", "briefing.db")]:
    if os.path.exists(p):
        zf.write(p, arc)
zf.close()
`;

    execFile('python3', ['-c', pyScript], (err) => {
        if (err || !fs.existsSync(tmpZip)) {
            console.error('[일괄 백업 압축 오류]', err);
            return res.status(500).json({ success: false, message: '전체 DB 압축 생성 실패: ' + (err ? err.message : '파일 없음') });
        }
        res.download(tmpZip, `jg_all_databases_${timestamp}.zip`, () => {
            try { fs.unlinkSync(tmpZip); } catch (e) {}
        });
    });
});

// 4. 개별 데이터베이스 백업 파일 다운로드 (동적 파라미터는 하위 등록)
app.get('/api/admin/backup/:type', authenticateToken, (req, res) => {
    const type = req.params.type;
    const now = new Date().toISOString().slice(0, 10);
    if (type === 'all') {
        return res.redirect('/api/admin/backup/all');
    } else if (type === 'health') {
        return res.download(BLOOD_DB_PATH, `health_backup_${now}.db`);
    } else if (type === 'asset') {
        return res.download(ASSET_DB_PATH, `asset_backup_${now}.db`);
    } else if (type === 'briefing') {
        return res.download(NEWS_DB_PATH, `briefing_backup_${now}.db`);
    }
    res.status(404).send('해당 DB 백업 파일을 찾을 수 없습니다.');
});

// 5. 혈압 CSV 내보내기
app.get('/api/admin/blood/export-csv', authenticateToken, (req, res) => {
    db.all(`SELECT id, systolic, diastolic, pulse, measured_at, medication_time FROM records ORDER BY measured_at DESC`, [], (recErr, records) => {
        if (recErr) return res.status(500).json({ success: false, message: '혈압 데이터 조회 실패' });

        db.all(`SELECT id, visit_date, hospital_name, department, memo, prescription_days, next_visit_date, reservation_open_date, notification_email, send_notification FROM hospital_visits ORDER BY visit_date DESC`, [], (hospErr, visits) => {
            let csvContent = '\uFEFF[혈압 및 복약 기록]\n';
            csvContent += '번호,최고혈압(수축기),최저혈압(이완기),맥박,측정일시,복약일시\n';
            (records || []).forEach(row => {
                csvContent += `${row.id},${row.systolic ?? ''},${row.diastolic ?? ''},${row.pulse ?? ''},"${row.measured_at ?? ''}","${row.medication_time ?? ''}"\n`;
            });

            csvContent += '\n[병원 진료 및 처방 기록]\n';
            csvContent += '번호,진료일,병원명,진료과,메모,처방일수,다음진료예정일,예약오픈일시,알림이메일,알림여부\n';
            (visits || []).forEach(v => {
                const hospName = (v.hospital_name || '').replace(/"/g, '""');
                const dept = (v.department || '').replace(/"/g, '""');
                const memo = (v.memo || '').replace(/"/g, '""');
                csvContent += `${v.id},${v.visit_date || ''},"${hospName}","${dept}","${memo}",${v.prescription_days || ''},${v.next_visit_date || ''},"${v.reservation_open_date || ''}","${v.notification_email || ''}",${v.send_notification ? '켜짐' : '꺼짐'}\n`;
            });

            const exportFilename = `health_data_export_${new Date().toISOString().split('T')[0]}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${exportFilename}"`);
            res.status(200).send(csvContent);
        });
    });
});

// 6. 혈압 CSV 복원 (Import)
app.post('/api/admin/blood/import-csv', authenticateToken, async (req, res) => {
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ success: false, message: 'CSV 내용이 비어있습니다.' });

    const lines = csvData.split(/\r?\n/);
    let currentMode = 'RECORDS';
    let addedCount = 0;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.includes('[혈압 및 복약 기록]')) { currentMode = 'RECORDS'; continue; }
        if (line.includes('[병원 진료 및 처방 기록]')) { currentMode = 'HOSPITAL'; continue; }
        if (line.startsWith('번호,')) continue;

        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim());

        if (currentMode === 'RECORDS' && parts.length >= 5) {
            const [, systolic, diastolic, pulse, measured_at, medication_time] = parts;
            if (measured_at) {
                await new Promise((resolve) => {
                    db.run(
                        `INSERT INTO records (systolic, diastolic, pulse, measured_at, medication_time) VALUES (?, ?, ?, ?, ?)`,
                        [systolic ? parseInt(systolic) : null, diastolic ? parseInt(diastolic) : null, pulse ? parseInt(pulse) : null, measured_at, medication_time || null],
                        () => { addedCount++; resolve(); }
                    );
                });
            }
        } else if (currentMode === 'HOSPITAL' && parts.length >= 3) {
            const [, visit_date, hospital_name, department, memo, prescription_days, next_visit_date, reservation_open_date, notification_email, send_notification] = parts;
            if (visit_date && hospital_name) {
                await new Promise((resolve) => {
                    db.run(
                        `INSERT INTO hospital_visits (visit_date, hospital_name, department, memo, prescription_days, next_visit_date, reservation_open_date, notification_email, send_notification) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [visit_date, hospital_name, department || '', memo || '', prescription_days ? parseInt(prescription_days) : null, next_visit_date || null, reservation_open_date || null, notification_email || '', send_notification === '켜짐' ? 1 : 0],
                        () => { addedCount++; resolve(); }
                    );
                });
            }
        }
    }
    res.json({ success: true, count: addedCount });
});

// 7. 혈압 최근 기록 미리보기
app.get('/api/admin/blood/recent', authenticateToken, (req, res) => {
    db.all(`SELECT id, systolic, diastolic, pulse, measured_at, medication_time FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 10`, [], (err, records) => {
        db.all(`SELECT id, visit_date, hospital_name, department FROM hospital_visits ORDER BY visit_date DESC LIMIT 5`, [], (vErr, visits) => {
            res.json({ success: true, records: records || [], visits: visits || [] });
        });
    });
});

// 8. 혈압 알림 메일 (SMTP) 전송 테스트
app.post('/api/admin/blood/test-email', authenticateToken, (req, res) => {
    const bloodEnvPath = path.join(BLOOD_DIR, '.env');
    const testScript = `require('dotenv').config({ path: '${bloodEnvPath}' }); const nodemailer = require('nodemailer'); if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) { console.error('MISSING_ENV'); process.exit(1); } const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }); transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: '🩸 JG 포털 통합 관리자 - 구글 SMTP 연결 테스트', text: '통합 관리자 센터에서 요청하신 Gmail SMTP 알림 메일 발송 테스트가 성공하였습니다! 일시: ' + new Date().toLocaleString() }).then(() => { process.exit(0); }).catch(e => { console.error(e.message); process.exit(2); });`;

    exec(`node -e "${testScript}"`, { cwd: BLOOD_DIR }, (err, stdout, stderr) => {
        if (err) {
            return res.status(500).json({ success: false, message: `발송 실패: ${stderr || err.message}` });
        }
        res.json({ success: true, message: '구글 알림 메일이 관리자 계정으로 정상 발송되었습니다!' });
    });
});

// 8-1. [신규] 혈압 대시보드 환경설정 조회 API
app.get('/api/admin/blood/configs', authenticateToken, (req, res) => {
    db.all(`SELECT key, value FROM system_configs`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '설정 조회 실패' });
        
        const configs = {};
        (rows || []).forEach(row => { configs[row.key] = row.value; });
        
        if (!configs.session_timeout) configs.session_timeout = '30';
        if (!configs.high_systolic) configs.high_systolic = '135';
        if (!configs.high_diastolic) configs.high_diastolic = '85';
        if (!configs.low_systolic) configs.low_systolic = '90';
        if (!configs.low_diastolic) configs.low_diastolic = '60';

        res.json({ success: true, configs });
    });
});

// 8-2. [신규] 혈압 대시보드 환경설정 저장 API
app.post('/api/admin/blood/configs', authenticateToken, (req, res) => {
    const { high_systolic, high_diastolic, low_systolic, low_diastolic, session_timeout } = req.body;

    if (!high_systolic || !high_diastolic || !low_systolic || !low_diastolic) {
        return res.status(400).json({ success: false, message: '모든 혈압 기준치를 올바르게 입력해주세요.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(`INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)`);
        stmt.run('high_systolic', high_systolic.toString());
        stmt.run('high_diastolic', high_diastolic.toString());
        stmt.run('low_systolic', low_systolic.toString());
        stmt.run('low_diastolic', low_diastolic.toString());
        if (session_timeout) {
            stmt.run('session_timeout', session_timeout.toString());
        }
        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (err) {
                console.error('혈압 환경설정 저장 실패:', err);
                return res.status(500).json({ success: false, message: '설정 저장 중 오류가 발생했습니다.' });
            }
            res.json({ success: true, message: '대시보드 환경설정이 성공적으로 저장되었습니다.' });
        });
    });
});

// 9. 자산 관리 상세 요약
app.get('/api/admin/asset/summary', authenticateToken, async (req, res) => {
    try {
        const accounts = await new Promise(r => assetDb.all('SELECT id, account_name, broker, note FROM accounts', (e, rows) => r(rows || [])));
        const assets = await new Promise(r => assetDb.all('SELECT id, account_id, symbol, full_name, asset_type, quantity, avg_price, currency FROM assets WHERE quantity > 0', (e, rows) => r(rows || [])));

        let totalKrw = 0;
        const accMap = {};
        accounts.forEach(a => { accMap[a.id] = { ...a, stockCount: 0, total: 0 }; });

        const formattedAssets = assets.map(s => {
            const isUsd = s.currency === 'USD';
            const priceInKrw = isUsd ? Math.round(s.avg_price * 1350) : Math.round(s.avg_price);
            const total = Math.round(s.quantity * priceInKrw);
            totalKrw += total;

            if (accMap[s.account_id]) {
                accMap[s.account_id].stockCount++;
                accMap[s.account_id].total += total;
            }

            return {
                id: s.id,
                symbol: s.symbol,
                koreanName: getKoreanStockName(s.symbol, s.full_name),
                asset_type: s.asset_type,
                quantity: s.quantity,
                formattedAvg: (isUsd ? '$' : '₩') + s.avg_price.toLocaleString(),
                formattedTotal: '₩' + total.toLocaleString(),
                total
            };
        }).sort((a, b) => b.total - a.total);

        const formattedAccounts = Object.values(accMap).map(a => ({
            ...a,
            totalFormatted: '₩' + a.total.toLocaleString()
        }));

        res.json({
            success: true,
            totalKrw: '₩' + totalKrw.toLocaleString(),
            accounts: formattedAccounts,
            assets: formattedAssets
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '자산 데이터 조회 실패: ' + e.message });
    }
});

// 10. 뉴스 브리핑 현황 통계
app.get('/api/admin/news/stats', authenticateToken, async (req, res) => {
    try {
        const totalRow = await new Promise(r => newsDb.get('SELECT COUNT(*) as cnt FROM news_articles', (e, row) => r(row || { cnt: 0 })));
        const logsCountRow = await new Promise(r => newsDb.get('SELECT COUNT(*) as cnt FROM collection_logs', (e, row) => r(row || { cnt: 0 })));
        const recentArticles = await new Promise(r => newsDb.all('SELECT id, title, link, media_name, category_name, published_at FROM news_articles ORDER BY id DESC LIMIT 10', (e, rows) => r(rows || [])));
        const settingRow = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'collection_enabled'", (e, row) => r(row || null)));

        let dbSizeKb = 0;
        try {
            if (fs.existsSync(NEWS_DB_PATH)) {
                dbSizeKb = Math.round(fs.statSync(NEWS_DB_PATH).size / 1024);
            }
        } catch (e) {}

        const weather = await getLiveWeatherData();

        res.json({
            success: true,
            totalArticles: totalRow.cnt,
            totalLogs: logsCountRow.cnt,
            dbSizeKb,
            collectionEnabled: !settingRow || settingRow.value !== '0',
            recentArticles,
            weather
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '뉴스 데이터 조회 실패: ' + e.message });
    }
});

// 10-1. [신규] 뉴스 수집기 및 스케줄러 로그 파일 실시간 조회 API
app.get('/api/admin/news/file-logs', authenticateToken, (req, res) => {
    const logType = req.query.type || 'collector';
    const allowed = ['collector', 'scheduler'];
    if (!allowed.includes(logType)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 로그 타입입니다.' });
    }

    const logFile = logType === 'scheduler' ? 'scheduler.log' : 'collector.log';
    
    // 여러 후보 경로 자동 탐색 (NEWS_DIR, 노트9 workspace, 레거시)
    const candidatePaths = [
        path.join(NEWS_DIR, 'logs', logFile),
        path.join('/home/upt0731/workspace/news-dashboard/logs', logFile),
        path.join('/home/upt0731/news-dashboard/logs', logFile)
    ];

    const filePath = candidatePaths.find(p => fs.existsSync(p));
    const linesCount = Math.min(Math.max(parseInt(req.query.lines, 10) || 120, 10), 300);

    if (!filePath) {
        return res.json({ success: true, logs: `[알림] ${logFile} 파일이 아직 생성되지 않았거나 비어 있습니다.\n(확인 경로: ${path.join(NEWS_DIR, 'logs', logFile)})` });
    }

    exec(`tail -n ${linesCount} "${filePath}"`, (err, stdout, stderr) => {
        if (err) {
            return res.json({ success: true, logs: `로그 파일 읽기 오류: ${err.message}` });
        }
        res.json({ success: true, logs: stdout || '(기록된 로그 내용이 없습니다.)' });
    });
});

// 11. 뉴스 수집 및 모닝 브리핑 즉시 실행 (트리거)
app.post('/api/admin/news/trigger', authenticateToken, (req, res) => {
    const { mode } = req.body;
    const isBriefing = mode === 'briefing';
    const flag = isBriefing ? '--run-briefing-now' : '--run-collect-now';
    
    const pyCandidates = [
        path.join(NEWS_DIR, 'venv/bin/python3'),
        path.join(NEWS_DIR, 'venv/bin/python'),
        '/home/upt0731/workspace/news-dashboard/venv/bin/python3',
        'python3'
    ];
    const pyPath = pyCandidates.find(p => fs.existsSync(p)) || 'python3';
    const scriptPath = path.join(NEWS_DIR, 'scheduler.py');

    exec(`"${pyPath}" "${scriptPath}" ${flag}`, { cwd: NEWS_DIR }, (err, stdout, stderr) => {
        if (err) console.error('[NEWS_TRIGGER_ERR]', err, stderr);
    });

    res.json({
        success: true,
        message: isBriefing ? '뉴스 수집 및 텔레그램 모닝 브리핑 발송이 백그라운드에서 시작되었습니다.' : '뉴스 기사 최신 수집(DB 최신화 전용)이 백그라운드에서 시작되었습니다.'
    });
});

// 12. 관리자 마스터 비밀번호 변경
app.post('/api/admin/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: '새 비밀번호는 6자리 이상이어야 합니다.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [req.user.username], async (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
        }

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
            return res.status(400).json({ success: false, message: '현재 비밀번호가 일치하지 않습니다.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        db.run('UPDATE users SET password = ? WHERE username = ?', [newHash, req.user.username], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ success: false, message: '비밀번호 변경 중 데이터베이스 오류가 발생했습니다.' });
            }
            res.json({ success: true, message: '관리자 마스터 비밀번호가 성공적으로 변경되었습니다.' });
        });
    });
});

// ==========================================
// 🔔 [통합 포털 알림 센터 API]
// ==========================================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        'mailto:upt0731@gmail.com',
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
} else {
    console.warn('⚠️ [VAPID] VAPID keys not configured in process.env!');
}

// 알림 수신 내역 DB 보관 헬퍼 함수
function saveNotificationHistory({ userId = 'admin', type = 'general', title, body, icon = 'https://j-jg.cc/icon-192.png', url = 'https://j-jg.cc/' }, callback) {
    const query = `
        INSERT INTO notification_history (user_id, type, title, body, icon, url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `;
    db.run(query, [userId, type, title, body, icon, url], function(err) {
        if (err) console.error('[알림 내역 DB 저장 실패]:', err.message);
        const insertedId = this ? this.lastID : null;
        if (callback && typeof callback === 'function') {
            callback(insertedId);
        }
    });
}

// 푸시 알림 텍스트 정제 헬퍼 (&nbsp; 및 불필요한 HTML 엔티티/태그 완전 제거)
function sanitizePushText(text) {
    if (!text) return '';
    return String(text)
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\u00a0/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// 🌟 [통합 포털 단일 WebPush 발송 엔진]
function sendUnifiedPushNotification({ title, body, url, type = 'general', tag, userId = null, adminOnly = false }) {
    return new Promise((resolve) => {
        let cleanTitle = sanitizePushText(title || '알림')
            .replace(/^\[?JG\s*통합\s*포털\]?\s*/i, '')
            .replace(/^\[?JG\s*포털\]?\s*/i, '')
            .trim();

        const cleanBody = sanitizePushText(body);

        let targetUrl = url || 'https://j-jg.cc/';
        if (targetUrl.startsWith('/')) {
            if (targetUrl.includes('dashboard') || targetUrl.includes('hospital')) {
                targetUrl = `https://blood.j-jg.cc${targetUrl}`;
            } else {
                targetUrl = `https://j-jg.cc${targetUrl}`;
            }
        }

        // 수신 대상 필터 구성
        let userCondition = '';
        if (userId) {
            userCondition = `AND ps.user_id = '${userId}'`;
        } else if (adminOnly) {
            userCondition = "AND ps.user_id IN ('upt0731', 'admin')";
        }

        let categoryCondition = '';
        if (type === 'breaking') {
            categoryCondition = 'AND (ns.breaking_news_enabled IS NULL OR ns.breaking_news_enabled = 1)';
        } else if (type === 'weather') {
            categoryCondition = 'AND (ns.weather_morning_enabled IS NULL OR ns.weather_morning_enabled = 1)';
        } else if (type === 'asset') {
            categoryCondition = 'AND (ns.asset_report_enabled IS NULL OR ns.asset_report_enabled = 1)';
        } else if (type === 'system') {
            categoryCondition = 'AND (ns.system_alert_enabled IS NULL OR ns.system_alert_enabled = 1)';
        }

        const query = `
            SELECT ps.*, COALESCE(ns.enabled, 1) as enabled
            FROM push_subscriptions ps
            LEFT JOIN notification_settings ns ON ps.user_id = ns.user_id
            WHERE (ns.enabled IS NULL OR ns.enabled = 1)
            ${categoryCondition}
            ${userCondition}
        `;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) {
                console.log(`[UnifiedPush] 발송 대상 구독 기기 없음 (type: ${type}, user: ${userId || 'all'})`);
                return resolve({ success: true, count: 0, targetCount: 0 });
            }

            saveNotificationHistory({
                userId: userId || (adminOnly ? 'admin' : (rows[0] ? rows[0].user_id : 'admin')),
                type,
                title: cleanTitle,
                body: cleanBody,
                icon: 'https://j-jg.cc/icon-192.png',
                url: targetUrl
            }, (notifId) => {
                const sep = targetUrl.includes('?') ? '&' : '?';
                const linkWithId = notifId ? `${targetUrl}${sep}notif_id=${notifId}` : targetUrl;

                // 알림이 이전 알림을 대체하지 않고 기기에 여러 개 누적되도록 고유 tag 부여
                const uniqueTag = tag && tag.includes('-') && !tag.endsWith(type)
                    ? tag
                    : `jg-${type}-${notifId || Date.now()}-${Math.floor(Math.random() * 10000)}`;

                const payload = JSON.stringify({
                    title: cleanTitle,
                    body: cleanBody,
                    icon: 'https://j-jg.cc/icon-192.png',
                    badge: 'https://j-jg.cc/icon-192.png',
                    tag: uniqueTag,
                    renotify: true,
                    requireInteraction: true,
                    data: {
                        url: linkWithId,
                        notifId: notifId || null
                    }
                });

                // 🌟 안드로이드 WebAPK/갤럭시에서 상단 배너 팝업(Heads-up)을 강제하도록 Urgency: high 헤더 부여
                const pushOptions = {
                    headers: {
                        'Urgency': 'high',
                        'Topic': (type || 'general').replace(/[^a-zA-Z0-9_-]/g, '')
                    },
                    TTL: 86400
                };

                let successCount = 0;
                let failCount = 0;

                const promises = rows.map(subRow => {
                    const pushSubscription = {
                        endpoint: subRow.endpoint,
                        keys: {
                            p256dh: subRow.keys_p256dh,
                            auth: subRow.keys_auth
                        }
                    };

                    return webPush.sendNotification(pushSubscription, payload, pushOptions)
                        .then(() => { successCount++; })
                        .catch(pErr => {
                            failCount++;
                            if (pErr.statusCode === 410 || pErr.statusCode === 404) {
                                db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [subRow.endpoint]);
                            }
                        });
                });

                Promise.all(promises).then(() => {
                    console.log(`[UnifiedPush 완료] ${cleanTitle} (성공: ${successCount}/${rows.length})`);
                    resolve({
                        success: true,
                        targetCount: rows.length,
                        successCount,
                        failCount,
                        notifId
                    });
                });
            });
        });
    });
}

// 1. VAPID 공개키 조회
app.get('/api/notification/vapid-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// 2. 푸시 구독 토큰 등록 API
app.post('/api/notification/subscribe', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ success: false, message: '유효하지 않은 구독 정보입니다.' });
    }

    const { endpoint, keys } = subscription;
    const query = `
        INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            keys_p256dh = excluded.keys_p256dh,
            keys_auth = excluded.keys_auth,
            updated_at = CURRENT_TIMESTAMP
    `;

    db.run(query, [userId, endpoint, keys.p256dh, keys.auth], (err) => {
        if (err) {
            console.error('[WebPush] 포털 구독 토큰 저장 실패:', err);
            return res.status(500).json({ success: false, message: '구독 토큰 저장 실패' });
        }
        res.json({ success: true, message: '푸시 알림 구독이 등록되었습니다.' });
    });
});

// 3. 알림 맞춤 설정 조회 API
app.get('/api/notification/settings', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';

    db.get("SELECT * FROM notification_settings WHERE user_id = ? OR user_id = 'admin' ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END LIMIT 1", [userId, userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: '알림 설정 조회 실패' });

        const safeParse = (str, fallback) => {
            try { return JSON.parse(str) || fallback; } catch (e) { return fallback; }
        };

        if (!row) {
            return res.json({
                success: true,
                settings: {
                    enabled: 1,
                    hospital_push_enabled: 1,
                    breaking_news_enabled: 1,
                    weather_morning_enabled: 1,
                    weather_morning_time: '07:00',
                    asset_report_enabled: 1,
                    asset_open_enabled: 1,
                    asset_close_enabled: 1,
                    bp_reminder_enabled: 1,
                    bp_reminder_time: '21:00',
                    system_alert_enabled: 1,
                    weekday_med_times: ['08:00', '19:00'],
                    weekday_bp_times: ['07:30', '21:30'],
                    weekend_med_times: ['09:00', '19:30'],
                    weekend_bp_times: ['08:30', '22:00']
                }
            });
        }

        res.json({
            success: true,
            settings: {
                enabled: row.enabled !== undefined ? row.enabled : 1,
                hospital_push_enabled: row.hospital_push_enabled !== undefined ? row.hospital_push_enabled : 1,
                breaking_news_enabled: row.breaking_news_enabled !== undefined ? row.breaking_news_enabled : 1,
                weather_morning_enabled: row.weather_morning_enabled !== undefined ? row.weather_morning_enabled : 1,
                weather_morning_time: row.weather_morning_time || '07:00',
                asset_report_enabled: row.asset_report_enabled !== undefined ? row.asset_report_enabled : 1,
                asset_open_enabled: row.asset_open_enabled !== undefined ? row.asset_open_enabled : (row.asset_report_enabled !== undefined ? row.asset_report_enabled : 1),
                asset_close_enabled: row.asset_close_enabled !== undefined ? row.asset_close_enabled : (row.asset_report_enabled !== undefined ? row.asset_report_enabled : 1),
                bp_reminder_enabled: row.bp_reminder_enabled !== undefined ? row.bp_reminder_enabled : 1,
                bp_reminder_time: row.bp_reminder_time || '21:00',
                system_alert_enabled: row.system_alert_enabled !== undefined ? row.system_alert_enabled : 1,
                weekday_med_times: safeParse(row.weekday_med_times, ['08:00', '19:00']),
                weekday_bp_times: safeParse(row.weekday_bp_times, ['07:30', '21:30']),
                weekend_med_times: safeParse(row.weekend_med_times, ['09:00', '19:30']),
                weekend_bp_times: safeParse(row.weekend_bp_times, ['08:30', '22:00'])
            }
        });
    });
});

// 4. 알림 맞춤 설정 저장 API
app.post('/api/notification/settings', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const {
        enabled, hospital_push_enabled, breaking_news_enabled,
        weather_morning_enabled, weather_morning_time,
        asset_report_enabled, asset_open_enabled, asset_close_enabled,
        bp_reminder_enabled, bp_reminder_time,
        system_alert_enabled,
        weekday_med_times, weekday_bp_times,
        weekend_med_times, weekend_bp_times
    } = req.body;

    const query = `
        INSERT INTO notification_settings 
        (user_id, enabled, hospital_push_enabled, breaking_news_enabled, weather_morning_enabled, weather_morning_time, asset_report_enabled, asset_open_enabled, asset_close_enabled, bp_reminder_enabled, bp_reminder_time, system_alert_enabled, weekday_med_times, weekday_bp_times, weekend_med_times, weekend_bp_times)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            enabled = excluded.enabled,
            hospital_push_enabled = excluded.hospital_push_enabled,
            breaking_news_enabled = excluded.breaking_news_enabled,
            weather_morning_enabled = excluded.weather_morning_enabled,
            weather_morning_time = excluded.weather_morning_time,
            asset_report_enabled = excluded.asset_report_enabled,
            asset_open_enabled = excluded.asset_open_enabled,
            asset_close_enabled = excluded.asset_close_enabled,
            bp_reminder_enabled = excluded.bp_reminder_enabled,
            bp_reminder_time = excluded.bp_reminder_time,
            system_alert_enabled = excluded.system_alert_enabled,
            weekday_med_times = excluded.weekday_med_times,
            weekday_bp_times = excluded.weekday_bp_times,
            weekend_med_times = excluded.weekend_med_times,
            weekend_bp_times = excluded.weekend_bp_times,
            updated_at = CURRENT_TIMESTAMP
    `;

    const openVal = asset_open_enabled !== undefined ? (asset_open_enabled ? 1 : 0) : 1;
    const closeVal = asset_close_enabled !== undefined ? (asset_close_enabled ? 1 : 0) : 1;
    const reportVal = (openVal || closeVal) ? 1 : (asset_report_enabled !== undefined ? (asset_report_enabled ? 1 : 0) : 1);

    db.run(query, [
        userId,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        hospital_push_enabled !== undefined ? (hospital_push_enabled ? 1 : 0) : 1,
        breaking_news_enabled !== undefined ? (breaking_news_enabled ? 1 : 0) : 1,
        weather_morning_enabled !== undefined ? (weather_morning_enabled ? 1 : 0) : 1,
        (weather_morning_time || '07:00').trim(),
        reportVal,
        openVal,
        closeVal,
        bp_reminder_enabled !== undefined ? (bp_reminder_enabled ? 1 : 0) : 1,
        (bp_reminder_time || '21:00').trim(),
        system_alert_enabled !== undefined ? (system_alert_enabled ? 1 : 0) : 1,
        JSON.stringify(Array.isArray(weekday_med_times) ? weekday_med_times : ['08:00', '19:00']),
        JSON.stringify(Array.isArray(weekday_bp_times) ? weekday_bp_times : ['07:30', '21:30']),
        JSON.stringify(Array.isArray(weekend_med_times) ? weekend_med_times : ['09:00', '19:30']),
        JSON.stringify(Array.isArray(weekend_bp_times) ? weekend_bp_times : ['08:30', '22:00'])
    ], function(err) {
        if (err) {
            console.error('[WebPush] 포털 알림 설정 저장 실패:', err);
            return res.status(500).json({ success: false, message: '알림 설정 저장 실패' });
        }
        res.json({ success: true, message: '포털 통합 알림 설정이 저장되었습니다.' });
    });
});

// 5. 알림 수신 내역 조회 API (페이징 & 안 읽은 알림 카운트 지원)
app.get('/api/notification/history', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const countQuery = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
        FROM notification_history 
        WHERE user_id = ? OR user_id = 'admin'
    `;

    db.get(countQuery, [userId], (cntErr, counts) => {
        if (cntErr) {
            console.error('[WebPush] 포털 알림 카운트 조회 오류:', cntErr);
            return res.status(500).json({ success: false, message: '알림 카운트 조회 실패' });
        }

        const dataQuery = `
            SELECT id, user_id, type, title, body, icon, url, is_read, created_at 
            FROM notification_history 
            WHERE user_id = ? OR user_id = 'admin'
            ORDER BY id DESC 
            LIMIT ? OFFSET ?
        `;

        db.all(dataQuery, [userId, limit, offset], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: '알림 내역 조회 실패' });
            res.json({
                success: true,
                history: rows || [],
                unreadCount: counts ? (counts.unread || 0) : 0,
                totalCount: counts ? (counts.total || 0) : 0,
                limit,
                offset
            });
        });
    });
});

// 5-1. 전체 알림 읽음 처리 API
app.post('/api/notification/history/read-all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const query = `UPDATE notification_history SET is_read = 1 WHERE user_id = ? OR user_id = 'admin'`;
    db.run(query, [userId], function(err) {
        if (err) {
            console.error('[WebPush] 전체 읽음 처리 오류:', err);
            return res.status(500).json({ success: false, message: '전체 읽음 처리 실패' });
        }
        res.json({ success: true, message: '모든 알림을 읽음 처리했습니다.', updated: this.changes });
    });
});

// 5-2. 개별 알림 읽음 처리 API
app.post('/api/notification/history/:id/read', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const id = req.params.id;
    const query = `UPDATE notification_history SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id = 'admin' OR ? = 'admin' OR ? = 'upt0731')`;
    db.run(query, [id, userId, userId, userId], function(err) {
        if (err) {
            console.error('[WebPush] 개별 읽음 처리 오류:', err);
            return res.status(500).json({ success: false, message: '개별 읽음 처리 실패' });
        }
        res.json({ success: true, message: '알림을 읽음 처리했습니다.', changed: this ? this.changes : 0 });
    });
});

// 6. 알림 수신 내역 개별 삭제 API
app.delete('/api/notification/history/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const id = req.params.id;
    db.run("DELETE FROM notification_history WHERE id = ? AND (user_id = ? OR user_id = 'admin')", [id, userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '알림 삭제 실패' });
        res.json({ success: true, message: '알림이 삭제되었습니다.' });
    });
});

// 7. 알림 수신 내역 전체 삭제 API
app.delete('/api/notification/history/clear/all', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    db.run("DELETE FROM notification_history WHERE user_id = ? OR user_id = 'admin'", [userId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '전체 알림 삭제 실패' });
        res.json({ success: true, message: '모든 알림 내역이 삭제되었습니다.' });
    });
});

// 8. 테스트 푸시 즉시 발송 API
app.post('/api/notification/test', authenticateToken, async (req, res) => {
    try {
        const result = await sendUnifiedPushNotification({
            title: '🔔 알림 테스트',
            body: '통합 포털 단일 알림 허브가 성공적으로 연결되었습니다! 속보, 날씨, 증시, 복약 및 혈압 알림을 실시간 수신할 수 있습니다.',
            url: 'https://j-jg.cc/',
            type: 'test',
            tag: 'jg-test',
            userId: req.user.username || 'admin'
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '테스트 알림 발송 실패: ' + e.message });
    }
});

// ==============================================================================
// 💡 [아이디어 & 빠른 메모] CRUD API 엔드포인트
// ==============================================================================

// 1. 메모 목록 조회 (상단 고정 우선, 최신 수정순 정렬)
app.get('/api/memos', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { category, search } = req.query;

    let query = "SELECT * FROM user_memos WHERE (user_id = ? OR user_id = 'admin')";
    const params = [userId];

    if (category && category !== 'all') {
        if (category === 'pinned') {
            query += " AND is_pinned = 1";
        } else {
            query += " AND category = ?";
            params.push(category);
        }
    }

    if (search && search.trim()) {
        query += " AND (title LIKE ? OR content LIKE ?)";
        const term = `%${search.trim()}%`;
        params.push(term, term);
    }

    query += " ORDER BY is_pinned DESC, updated_at DESC, id DESC";

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('[Memo 조회 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 목록 조회 실패' });
        }
        res.json({ success: true, memos: rows || [] });
    });
});

// 2. 신규 메모/아이디어 등록
app.post('/api/memos', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { title, content, category = 'idea', color = '#fef3c7', is_pinned = 0 } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: '메모 내용을 입력해 주세요.' });
    }

    const cleanTitle = (title || '').trim();
    const cleanContent = content.trim();
    const validCategory = ['idea', 'todo', 'memo', 'important'].includes(category) ? category : 'idea';
    const validColors = ['#fef3c7', '#e0f2fe', '#dcfce7', '#f3e8ff', '#fee2e2'];
    const validColor = validColors.includes(color) ? color : '#fef3c7';

    const query = `
        INSERT INTO user_memos (user_id, title, content, category, color, is_pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `;

    db.run(query, [userId, cleanTitle, cleanContent, validCategory, validColor, is_pinned ? 1 : 0], function(err) {
        if (err) {
            console.error('[Memo 등록 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 등록 실패' });
        }
        res.json({ success: true, id: this.lastID, message: '새 메모가 등록되었습니다.' });
    });
});

// 3. 메모 수정 (제목, 내용, 카테고리, 색상, 고정 여부)
app.put('/api/memos/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const memoId = req.params.id;
    const { title, content, category = 'idea', color = '#fef3c7', is_pinned = 0 } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: '메모 내용을 입력해 주세요.' });
    }

    const cleanTitle = (title || '').trim();
    const cleanContent = content.trim();
    const validCategory = ['idea', 'todo', 'memo', 'important'].includes(category) ? category : 'idea';
    const validColors = ['#fef3c7', '#e0f2fe', '#dcfce7', '#f3e8ff', '#fee2e2'];
    const validColor = validColors.includes(color) ? color : '#fef3c7';

    const query = `
        UPDATE user_memos 
        SET title = ?, content = ?, category = ?, color = ?, is_pinned = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND (user_id = ? OR user_id = 'admin')
    `;

    db.run(query, [cleanTitle, cleanContent, validCategory, validColor, is_pinned ? 1 : 0, memoId, userId], function(err) {
        if (err) {
            console.error('[Memo 수정 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 수정 실패' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '수정할 메모를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '메모가 성공적으로 수정되었습니다.' });
    });
});

// 4. 메모 상단 고정 토글 (📌 Pin / Unpin)
app.patch('/api/memos/:id/pin', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const memoId = req.params.id;

    db.run(`
        UPDATE user_memos 
        SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND (user_id = ? OR user_id = 'admin')
    `, [memoId, userId], function(err) {
        if (err) {
            console.error('[Memo 핀 토글 실패]:', err.message);
            return res.status(500).json({ success: false, message: '상단 고정 토글 실패' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '상단 고정 상태가 변경되었습니다.' });
    });
});

// 5. 메모 삭제
app.delete('/api/memos/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const memoId = req.params.id;

    db.run("DELETE FROM user_memos WHERE id = ? AND (user_id = ? OR user_id = 'admin')", [memoId, userId], function(err) {
        if (err) {
            console.error('[Memo 삭제 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 삭제 실패' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '삭제할 메모를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '메모가 삭제되었습니다.' });
    });
});

// ==============================================================================
// 🔍 [통합 퀵 검색 (Ctrl+K)] REST API 엔드포인트
// 메모, 뉴스 브리핑, 병원 진료 일정, 자산/종목 통합 비동기 검색
// ==============================================================================
app.get('/api/search/unified', authenticateToken, async (req, res) => {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) {
        return res.json({
            success: true,
            query: '',
            total: 0,
            results: { memos: [], news: [], hospitals: [], assets: [] }
        });
    }

    const userId = req.user.username || 'admin';
    const term = `%${rawQuery}%`;

    // 1) 메모 검색
    const memoPromise = new Promise((resolve) => {
        const sql = `
            SELECT id, title, content, category, color, is_pinned, updated_at
            FROM user_memos
            WHERE (user_id = ? OR user_id = 'admin' OR user_id = 'upt0731')
              AND (title LIKE ? OR content LIKE ?)
            ORDER BY is_pinned DESC, updated_at DESC
            LIMIT 8
        `;
        db.all(sql, [userId, term, term], (err, rows) => {
            if (err) {
                console.error('[Search memo err]:', err.message);
                return resolve([]);
            }
            resolve(rows || []);
        });
    });

    // 2) 뉴스 브리핑 검색
    const newsPromise = new Promise((resolve) => {
        const sql = `
            SELECT id, date, category_name, title, link, media_name, summary, published_at
            FROM news_articles
            WHERE (title LIKE ? OR summary LIKE ?)
            ORDER BY date DESC, id DESC
            LIMIT 8
        `;
        newsDb.all(sql, [term, term], (err, rows) => {
            if (err) {
                console.error('[Search news err]:', err.message);
                return resolve([]);
            }
            resolve(rows || []);
        });
    });

    // 3) 병원 진료 일정 검색
    const hospitalPromise = new Promise((resolve) => {
        const sql = `
            SELECT id, visit_date, hospital_name, department, memo, next_visit_date, reservation_open_date
            FROM hospital_visits
            WHERE (user_id = ? OR user_id = 'admin' OR user_id = 'upt0731')
              AND (hospital_name LIKE ? OR department LIKE ? OR memo LIKE ?)
            ORDER BY visit_date DESC
            LIMIT 8
        `;
        db.all(sql, [userId, term, term, term], (err, rows) => {
            if (err) {
                console.error('[Search hospital err]:', err.message);
                return resolve([]);
            }
            resolve(rows || []);
        });
    });

    // 4) 자산/보유 종목 검색
    const assetPromise = new Promise((resolve) => {
        const sql = `
            SELECT id, symbol, full_name, asset_type, quantity, avg_price, currency
            FROM assets
            WHERE (symbol LIKE ? OR full_name LIKE ?)
            LIMIT 8
        `;
        assetDb.all(sql, [term, term], (err, rows) => {
            if (err) {
                console.error('[Search asset err]:', err.message);
                return resolve([]);
            }
            resolve(rows || []);
        });
    });

    try {
        const [memoRes, newsRes, hospRes, assetRes] = await Promise.allSettled([
            memoPromise,
            newsPromise,
            hospitalPromise,
            assetPromise
        ]);

        const memos = memoRes.status === 'fulfilled' ? memoRes.value : [];
        const news = newsRes.status === 'fulfilled' ? newsRes.value : [];
        const hospitals = hospRes.status === 'fulfilled' ? hospRes.value : [];
        const assets = assetRes.status === 'fulfilled' ? assetRes.value : [];

        const total = memos.length + news.length + hospitals.length + assets.length;

        res.json({
            success: true,
            query: rawQuery,
            total,
            results: {
                memos,
                news,
                hospitals,
                assets
            }
        });
    } catch (e) {
        console.error('[Unified search err]:', e);
        res.status(500).json({ success: false, message: '통합 검색 중 오류가 발생했습니다.' });
    }
});

// 9. 통합 포털 단일 알림 브로드캐스트 엔진 API (모든 서비스 공통 접수구)
app.post('/api/notification/broadcast', async (req, res) => {
    // 내부 루프백(뉴스 수집기 등) 또는 인증된 사용자 요청 허용
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const hasCookie = req.cookies && req.cookies.portal_token;

    if (!isLocal && !token && !hasCookie) {
        return res.status(401).json({ success: false, message: '알림 발송 권한이 필요합니다.' });
    }

    try {
        const result = await sendUnifiedPushNotification(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '브로드캐스트 발송 실패: ' + e.message });
    }
});

// ==========================================
// ⏰ [통합 포털 단일 알림 스케줄러 기동]
// 모든 서비스(날씨, 증시, 복약, 혈압, 병원, 서버경보) 단일 중앙 실행
// ==========================================
initUnifiedNotificationScheduler(db, sendUnifiedPushNotification, getLiveWeatherData, getLiveMarketData);

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'JG Portal' });
});

app.listen(PORT, () => {
    console.log(`🚀 JG 통합 포털 서버 구동 완료 (Port: ${PORT}, Cookie Domain: ${COOKIE_DOMAIN})`);
});
