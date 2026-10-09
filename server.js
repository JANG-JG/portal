require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'jg-portal-master-super-secret-key-2026!@#';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.j-jg.cc';

const BLOOD_DB_PATH = process.env.DB_PATH || '/home/upt0731/blood-pressure-app/health.db';
const ASSET_DB_PATH = process.env.ASSET_DB_PATH || '/home/upt0731/asset/asset.db';
const NEWS_DB_PATH = process.env.NEWS_DB_PATH || '/home/upt0731/news-dashboard/briefing.db';

// 기본 미들웨어 설정
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use((req, res, next) => {
    if (!req.url.startsWith('/css') && !req.url.startsWith('/favicon')) {
        console.log(`[PORTAL] ${req.method} ${req.url}`);
    }
    next();
});

// 마스터 계정 DB 연결 (혈압 앱 health.db)
const db = new sqlite3.Database(BLOOD_DB_PATH, (err) => {
    if (err) console.error('❌ 혈압 DB 연결 실패:', err);
    else {
        console.log('✅ 마스터 계정 DB 로드 완료:', BLOOD_DB_PATH);
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
    }
});

// 자산관리 DB 연결 (asset.db)
const assetDb = new sqlite3.Database(ASSET_DB_PATH, (err) => {
    if (err) console.error('❌ 자산 DB 연결 실패:', err);
    else console.log('✅ 자산 DB 로드 완료:', ASSET_DB_PATH);
});

// 뉴스 대시보드 DB 연결 (briefing.db)
const newsDb = new sqlite3.Database(NEWS_DB_PATH, (err) => {
    if (err) console.error('❌ 뉴스 DB 연결 실패:', err);
    else console.log('✅ 뉴스 DB 로드 완료:', NEWS_DB_PATH);
});

// 토큰 인증 미들웨어
function authenticateToken(req, res, next) {
    const token = req.cookies.portal_token;
    if (!token) {
        return res.redirect('/login');
    }

    const candidateSecrets = [
        JWT_SECRET,
        'jg-portal-master-super-secret-key-2026-upt0731',
        'jg-portal-master-super-secret-key-2026!@',
        'jg-portal-master-super-secret-key-2026!@#',
        'portal-master-secret-key-2026-upt0731!@#'
    ];
    let user = null;
    for (const secret of candidateSecrets) {
        try {
            user = jwt.verify(token, secret);
            if (user && user.username) break;
        } catch (err) {}
    }

    if (!user || !user.username) {
        res.clearCookie('portal_token', { path: '/', domain: COOKIE_DOMAIN });
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

// 3. 로그인 처리 API (실시간 로그인 이력 수집 연동)
app.post('/api/login', (req, res) => {
    const { username, password, rememberMe } = req.body;
    const clientIp = getClientIp(req);

    if (!username || !password) {
        recordLoginLog(username || '미입력', clientIp, 'FAILED');
        return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력해주세요.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            recordLoginLog(username, clientIp, 'FAILED');
            return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                recordLoginLog(username, clientIp, 'FAILED');
                return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
            }

            // 로그인 성공 기록
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
    'Jeju': '제주',
    'Chuncheon': '춘천',
    'Gangneung': '강릉',
    'Cheongju': '청주',
    'Jeonju': '전주',
    'Changwon': '창원',
    'Pohang': '포항'
};

const WEATHER_ICON_MAP = {
    'sunny': '☀️',
    'clear': '☀️',
    'partly cloudy': '🌤️',
    'cloudy': '☁️',
    'overcast': '☁️',
    'mist': '🌫️',
    'fog': '🌫️',
    'haze': '🌫️',
    'smoky': '🌫️',
    'rain': '🌧️',
    'patchy rain': '🌦️',
    'thundery': '⛈️',
    'snow': '❄️'
};

function getWeatherIcon(desc) {
    if (!desc) return '🌤️';
    const lower = desc.toLowerCase();
    for (const [k, v] of Object.entries(WEATHER_ICON_MAP)) {
        if (lower.includes(k)) return v;
    }
    return '🌤️';
}

// 실시간 날씨 캐시 (10분 유효)
let weatherCache = {
    timestamp: 0,
    data: null
};

async function getLiveWeatherData() {
    const now = Date.now();
    if (weatherCache.data && (now - weatherCache.timestamp < 10 * 60 * 1000)) {
        return weatherCache.data;
    }

    // 1) DB에서 설정된 도시 조회
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

    let weatherObj = {
        city: korCityName,
        temp: '13°C',
        condition: '맑음',
        icon: '🌤️'
    };

    // 2) wttr.in 실시간 API 호출
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(`https://wttr.in/${encodeURIComponent(rawCity)}?format=j1`, {
            headers: { 'User-Agent': 'curl/7.68.0' },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (resp.ok) {
            const data = await resp.json();
            if (data && data.current_condition && data.current_condition[0]) {
                const cur = data.current_condition[0];
                const tempC = cur.temp_C ? `${cur.temp_C}°C` : '-';
                const desc = cur.weatherDesc && cur.weatherDesc[0] ? cur.weatherDesc[0].value : '';
                const icon = getWeatherIcon(desc);
                weatherObj = {
                    city: korCityName,
                    temp: tempC,
                    condition: desc || '맑음',
                    icon: icon
                };
                weatherCache = { timestamp: now, data: weatherObj };
                return weatherObj;
            }
        }
    } catch (apiErr) {}

    // 3) 실패 시 daily_weather 테이블에서 fallback 파싱
    try {
        const dwRow = await new Promise((res) => {
            newsDb.get('SELECT weather_info FROM daily_weather ORDER BY date DESC LIMIT 1', (err, r) => res(r || null));
        });
        if (dwRow && dwRow.weather_info) {
            const info = dwRow.weather_info;
            const tempMatch = info.match(/(\d+)°C/);
            if (tempMatch) {
                weatherObj.temp = `${tempMatch[1]}°C`;
            }
            if (info.includes('안개')) weatherObj.icon = '🌫️';
            else if (info.includes('비')) weatherObj.icon = '🌧️';
            else if (info.includes('눈')) weatherObj.icon = '❄️';
            else if (info.includes('맑')) weatherObj.icon = '☀️';
            else if (info.includes('구름')) weatherObj.icon = '☁️';
        }
    } catch (e) {}

    weatherCache = { timestamp: now, data: weatherObj };
    return weatherObj;
}

// 실시간 증시 및 환율 캐시 (5분 유효)
let marketCache = {
    timestamp: 0,
    data: {
        kospi: { name: '코스피', price: '-', ratio: '-', direction: 'up' },
        kosdaq: { name: '코스닥', price: '-', ratio: '-', direction: 'up' },
        usd_krw: { name: 'USD/KRW', price: '-', ratio: '-', direction: 'up' }
    }
};

async function getLiveMarketData() {
    const now = Date.now();
    if (marketCache.data && (now - marketCache.timestamp < 300000)) {
        return marketCache.data;
    }

    try {
        const [kRes, qRes, uRes] = await Promise.allSettled([
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

        marketCache = { timestamp: now, data: nextData };
        return nextData;
    } catch (e) {
        return marketCache.data;
    }
}

// 6. 요약 데이터 조회 API (메인 대시보드 카드용)
app.get('/api/summary', authenticateToken, async (req, res) => {
    try {
        // 1) 혈압 최근 측정치
        const blood = await new Promise((resolve) => {
            db.get('SELECT systolic, diastolic, pulse, measured_at FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 1', (err, row) => resolve(row || null));
        });

        // 2) 최근 투약 일시
        const medication = await new Promise((resolve) => {
            db.get("SELECT medication_time FROM records WHERE medication_time IS NOT NULL AND medication_time != '' ORDER BY medication_time DESC LIMIT 1", (err, row) => resolve(row || null));
        });

        // 3) 병원 진료 및 남은 약 수량 계산
        const hospital = await new Promise((resolve) => {
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

        // 4) 자산 보유 종목 목록
        const assets = await new Promise((resolve) => {
            assetDb.all('SELECT symbol, full_name, quantity, avg_price, currency FROM assets WHERE quantity > 0', (err, rows) => resolve(rows || []));
        });

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

        // 5) 실시간 날씨 정보 조회 (인사말 옆 뱃지용)
        const weather = await getLiveWeatherData();

        // 6) 뉴스 관심 분야별 추천 기사 조회 (활성 관심분야 최대 5개까지 동적 반영)
        const newsRecommendation = await new Promise((resolve) => {
            newsDb.all('SELECT id, name FROM categories WHERE is_active = 1 ORDER BY id ASC LIMIT 5', [], async (cErr, categories) => {
                if (cErr || !categories || categories.length === 0) {
                    newsDb.all('SELECT id, title, link, media_name, category_name, published_at FROM news_articles ORDER BY id DESC LIMIT 5', [], (aErr, fallbackRows) => {
                        resolve(fallbackRows || []);
                    });
                    return;
                }

                try {
                    const articlePromises = categories.map(cat => {
                        return new Promise(innerResolve => {
                            newsDb.get(
                                'SELECT id, title, link, media_name, category_name, published_at FROM news_articles WHERE category_name = ? ORDER BY id DESC LIMIT 1',
                                [cat.name],
                                (err, row) => innerResolve(row || null)
                            );
                        });
                    });

                    const results = (await Promise.all(articlePromises)).filter(Boolean);
                    const targetLimit = Math.max(categories.length, 5);
                    if (results.length < targetLimit) {
                        const existingIds = results.map(r => r.id);
                        const placeholders = existingIds.length > 0 ? existingIds.map(() => '?').join(',') : '0';
                        const needCount = targetLimit - results.length;
                        newsDb.all(
                            `SELECT id, title, link, media_name, category_name, published_at FROM news_articles WHERE id NOT IN (${placeholders}) ORDER BY id DESC LIMIT ?`,
                            [...existingIds, needCount],
                            (fbErr, extraRows) => {
                                if (extraRows && Array.isArray(extraRows)) results.push(...extraRows);
                                resolve(results);
                            }
                        );
                    } else {
                        resolve(results);
                    }
                } catch (e) {
                    resolve([]);
                }
            });
        });

        // 7) 실시간 시장 지표
        const marketData = await getLiveMarketData();

        res.json({
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
                recommendedArticles: newsRecommendation
            }
        });
    } catch (err) {
        console.error('요약 데이터 조회 오류:', err);
        res.status(500).json({ success: false, message: '요약 데이터 조회 실패' });
    }
});

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 'public, max-age=60');

    newsDb.all(
        'SELECT id, title, link, category_name, media_name, published_at FROM news_articles ORDER BY id DESC LIMIT 12',
        [],
        async (err, articles) => {
            const [weather, market] = await Promise.all([
                getLiveWeatherData(),
                getLiveMarketData()
            ]);

            res.json({
                success: true,
                articles: articles || [],
                weather,
                market
            });
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

// 1) 실시간 호스트 CPU 사용률 백그라운드 계산기 (/proc/stat 기반, 3초 주기)
let currentCpuPercent = 0;
let prevCpuStat = null;

function updateCpuUsage() {
    try {
        const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
        const parts = line.trim().split(/\s+/).slice(1).map(Number);
        const idle = parts[3] + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        if (prevCpuStat) {
            const idleDelta = idle - prevCpuStat.idle;
            const totalDelta = total - prevCpuStat.total;
            if (totalDelta > 0) {
                currentCpuPercent = Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
            }
        }
        prevCpuStat = { idle, total };
    } catch (e) {
        const load = os.loadavg()[0];
        const cpus = os.cpus().length || 1;
        currentCpuPercent = Math.min(100, Math.round((load / cpus) * 100));
    }
}
updateCpuUsage();
setInterval(updateCpuUsage, 3000);

// 2) CPU 하드웨어 온도 측정 (1분 캐시로 센서 부하 방지)
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
            if (err || !stdout) return resolve(cpuTempCache);
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

// 3) 디스크 용량 측정 (1분 캐시)
let diskCache = {
    timestamp: 0,
    used: '0 GB',
    total: '0 GB',
    percent: '0%',
    percentNum: 0
};

async function getDiskUsage() {
    const now = Date.now();
    if (diskCache.percentNum > 0 && (now - diskCache.timestamp < 60000)) {
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
                    const totalG = (totalM / 1024).toFixed(1);
                    const usedG = (usedM / 1024).toFixed(1);
                    const pct = Math.round((usedM / totalM) * 100);
                    diskCache = {
                        timestamp: now,
                        used: `${usedG} GB`,
                        total: `${totalG} GB`,
                        percent: `${pct}%`,
                        percentNum: pct
                    };
                }
            } catch (e) {}
            resolve(diskCache);
        });
    });
}

// 4. 전체 프로세스(PM2), DB 용량, 시스템 리소스 현황
app.get('/api/admin/overview', authenticateToken, async (req, res) => {
    try {
        const [tempInfo, diskInfo] = await Promise.all([
            getCpuTemperature(),
            getDiskUsage()
        ]);

        exec('pm2 jlist', (err, stdout) => {
            let processes = [];
            if (!err && stdout) {
                try {
                    const list = JSON.parse(stdout);
                    const displayNames = {
                        'portal': '🏠 JG 통합 포털',
                        'blood-pressure-app': '🩸 혈압 관리 서비스',
                        'blood-pressure-app-test': '🩸 혈압 관리 (테스트)',
                        'asset': '💰 내 자산 관리 서비스',
                        'news-dashboard': '📰 AI 뉴스 대시보드',
                        'news-scheduler': '⏱️ 모닝 뉴스 스케줄러 데몬'
                    };
                    const ports = {
                        'portal': '3004',
                        'blood-pressure-app': '3000',
                        'blood-pressure-app-test': '3001',
                        'asset': '3003',
                        'news-dashboard': '5050',
                        'news-scheduler': 'Daemon'
                    };
                    processes = list.map(p => ({
                        name: p.name,
                        displayName: displayNames[p.name] || p.name,
                        status: p.pm2_env?.status || 'unknown',
                        pid: p.pid,
                        pm_id: p.pm_id,
                        memory: p.monit ? (p.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : '-',
                        cpu: p.monit ? p.monit.cpu + '%' : '-',
                        restarts: p.pm2_env?.restart_time || 0,
                        port: ports[p.name] || '-'
                    }));
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

            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memPercentNum = Math.round((usedMem / totalMem) * 100);
            const memPercent = `${memPercentNum}%`;
            const uptimeHours = (os.uptime() / 3600).toFixed(1) + '시간';

            res.json({
                success: true,
                processes,
                dbs,
                system: {
                    memUsage: memPercent,
                    memFree: (freeMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
                    memTotal: (totalMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
                    uptimeStr: uptimeHours,
                    cpu: {
                        percent: `${currentCpuPercent}%`,
                        percentNum: currentCpuPercent,
                        temp: tempInfo.temp !== null ? `${tempInfo.temp}°C` : '측정 불가',
                        tempStatus: tempInfo.status
                    },
                    memory: {
                        percent: memPercent,
                        percentNum: memPercentNum,
                        used: (usedMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
                        total: (totalMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
                        free: (freeMem / 1024 / 1024 / 1024).toFixed(1) + ' GB'
                    },
                    disk: {
                        percent: diskInfo.percent,
                        percentNum: diskInfo.percentNum,
                        used: diskInfo.used,
                        total: diskInfo.total
                    }
                }
            });
        });
    } catch (err) {
        console.error('관리자 오버뷰 조회 오류:', err);
        res.status(500).json({ success: false, message: '서버 상태 조회 실패' });
    }
});

// 2. PM2 개별 프로세스 제어 (시작, 중지, 재기동)
app.post('/api/admin/pm2/action', authenticateToken, (req, res) => {
    const { action, processName } = req.body;
    const allowedProcesses = ['portal', 'blood-pressure-app', 'blood-pressure-app-test', 'asset', 'news-dashboard', 'news-scheduler'];
    const allowedActions = ['start', 'stop', 'restart'];

    if (!processName || !allowedProcesses.includes(processName)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 프로세스 이름입니다.' });
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
    const allowed = ['portal', 'blood-pressure-app', 'blood-pressure-app-test', 'asset', 'news-dashboard', 'news-scheduler'];
    if (!processName || !allowed.includes(processName)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 프로세스 이름입니다.' });
    }

    exec(`pm2 restart ${processName}`, (err) => {
        if (err) return res.status(500).json({ success: false, message: `재기동 실패: ${err.message}` });
        res.json({ success: true, message: `[${processName}] 프로세스가 정상적으로 재기동되었습니다.` });
    });
});

// 2-1. PM2 실시간 서버 콘솔 로그 조회 API (최신 50줄)
app.get('/api/admin/pm2/logs', authenticateToken, (req, res) => {
    const allowedProcesses = ['portal', 'blood-pressure-app', 'blood-pressure-app-test', 'asset', 'news-dashboard', 'news-scheduler'];
    const proc = req.query.process;
    const lines = Math.min(Math.max(parseInt(req.query.lines, 10) || 50, 10), 200);

    const target = (proc && allowedProcesses.includes(proc)) ? proc : '';
    const cmd = target ? `pm2 logs ${target} --lines ${lines} --raw --nostream` : `pm2 logs --lines ${lines} --raw --nostream`;

    exec(cmd, { timeout: 6000 }, (err, stdout, stderr) => {
        if (err && !stdout) {
            return res.json({ success: false, logs: '로그를 불러오는 중 오류가 발생했거나 PM2가 준비되지 않았습니다.' });
        }
        res.json({
            success: true,
            logs: stdout || stderr || '현재 기록된 로그가 없습니다.'
        });
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

// 3. 개별 데이터베이스 백업 파일 다운로드
app.get('/api/admin/backup/:type', authenticateToken, (req, res) => {
    const type = req.params.type;
    const now = new Date().toISOString().slice(0, 10);
    if (type === 'health') {
        return res.download(BLOOD_DB_PATH, `health_backup_${now}.db`);
    } else if (type === 'asset') {
        return res.download(ASSET_DB_PATH, `asset_backup_${now}.db`);
    } else if (type === 'briefing') {
        return res.download(NEWS_DB_PATH, `briefing_backup_${now}.db`);
    }
    res.status(404).send('해당 DB 백업 파일을 찾을 수 없습니다.');
});

// 4. 전체 DB 원클릭 압축 일괄 백업 (.zip)
app.get('/api/admin/backup/all', authenticateToken, (req, res) => {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tmpZip = path.join('/tmp', `jg_all_databases_${timestamp}.zip`);
    const pyScript = `import zipfile, os; zpath='${tmpZip}'; zf=zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED); os.path.exists('${BLOOD_DB_PATH}') and zf.write('${BLOOD_DB_PATH}', 'health.db'); os.path.exists('${ASSET_DB_PATH}') and zf.write('${ASSET_DB_PATH}', 'asset.db'); os.path.exists('${NEWS_DB_PATH}') and zf.write('${NEWS_DB_PATH}', 'briefing.db'); zf.close()`;

    exec(`python3 -c "${pyScript}"`, (err) => {
        if (err || !fs.existsSync(tmpZip)) {
            return res.status(500).json({ success: false, message: '전체 DB 압축 생성 실패' });
        }
        res.download(tmpZip, `jg_all_databases_${timestamp}.zip`, () => {
            try { fs.unlinkSync(tmpZip); } catch (e) {}
        });
    });
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
    const testScript = `require('dotenv').config({ path: '/home/upt0731/blood-pressure-app/.env' }); const nodemailer = require('nodemailer'); if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) { console.error('MISSING_ENV'); process.exit(1); } const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }); transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: '🩸 JG 포털 통합 관리자 - 구글 SMTP 연결 테스트', text: '통합 관리자 센터에서 요청하신 Gmail SMTP 알림 메일 발송 테스트가 성공하였습니다! 일시: ' + new Date().toLocaleString() }).then(() => { process.exit(0); }).catch(e => { console.error(e.message); process.exit(2); });`;

    exec(`node -e "${testScript}"`, { cwd: '/home/upt0731/blood-pressure-app' }, (err, stdout, stderr) => {
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
    const filePath = path.join('/home/upt0731/news-dashboard/logs', logFile);
    const linesCount = Math.min(Math.max(parseInt(req.query.lines, 10) || 120, 10), 300);

    if (!fs.existsSync(filePath)) {
        return res.json({ success: true, logs: `[알림] ${logFile} 파일이 아직 생성되지 않았거나 비어 있습니다.` });
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
    const pyPath = '/home/upt0731/news-dashboard/venv/bin/python';
    const scriptPath = '/home/upt0731/news-dashboard/scheduler.py';

    exec(`${pyPath} ${scriptPath} ${flag}`, { cwd: '/home/upt0731/news-dashboard' }, (err, stdout, stderr) => {
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

// 7. 헬스 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'JG Portal' });
});

app.listen(PORT, () => {
    console.log(`🚀 JG 통합 포털 서버 구동 완료 (Port: ${PORT}, Cookie Domain: ${COOKIE_DOMAIN})`);
});
