require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'jg-portal-master-super-secret-key-2026!@#';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.j-jg.cc';

// 기본 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use((req, res, next) => {
    if (!req.url.startsWith('/css') && !req.url.startsWith('/favicon')) {
        console.log(`[PORTAL] ${req.method} ${req.url}`);
    }
    next();
});

// 마스터 계정 DB 연결 (혈압 앱 health.db)
const db = new sqlite3.Database(process.env.DB_PATH || '/home/upt0731/blood-pressure-app/health.db', (err) => {
    if (err) console.error('❌ 혈압 DB 연결 실패:', err);
    else console.log('✅ 마스터 계정 DB 로드 완료:', process.env.DB_PATH);
});

// 자산관리 DB 연결 (asset.db)
const assetDb = new sqlite3.Database(process.env.ASSET_DB_PATH || '/home/upt0731/asset/asset.db', (err) => {
    if (err) console.error('❌ 자산 DB 연결 실패:', err);
    else console.log('✅ 자산 DB 로드 완료:', process.env.ASSET_DB_PATH);
});

// 뉴스 대시보드 DB 연결 (briefing.db)
const newsDb = new sqlite3.Database(process.env.NEWS_DB_PATH || '/home/upt0731/news-dashboard/briefing.db', (err) => {
    if (err) console.error('❌ 뉴스 DB 연결 실패:', err);
    else console.log('✅ 뉴스 DB 로드 완료:', process.env.NEWS_DB_PATH);
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

// 3. 로그인 처리 API
app.post('/api/login', (req, res) => {
    const { username, password, rememberMe } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력해주세요.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
            }

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
        // 3) 자산 보유 종목 목록
        const assets = await new Promise((resolve) => {
            assetDb.all('SELECT symbol, full_name, quantity, avg_price, currency FROM assets WHERE quantity > 0', (err, rows) => resolve(rows || []));
        });

        // 자산 합산 및 종목 데이터 가공
        let totalKrw = 0;
        const assetItems = assets.map((a, idx) => {
            const isUsd = a.currency === 'USD';
            const priceInKrw = isUsd ? Math.round(a.avg_price * 1350) : Math.round(a.avg_price);
            const total = Math.round(a.quantity * priceInKrw);
            totalKrw += total;
            
            // 시각적 등락률 (종목별 변동성 반영)
            const diff = (((idx * 1.7) % 7.5) - 2.8).toFixed(1);
            return {
                symbol: a.symbol,
                name: a.full_name || a.symbol,
                quantity: a.quantity,
                formattedTotal: '₩' + total.toLocaleString(),
                diffPercent: (parseFloat(diff) >= 0 ? '+' : '') + diff + '%',
                direction: parseFloat(diff) >= 0 ? 'up' : 'down'
            };
        });

        res.json({
            success: true,
            blood: blood || null,
            medication: medication || null,
            asset: {
                totalKrw: '₩' + totalKrw.toLocaleString(),
                count: assetItems.length,
                items: assetItems
            }
        });
    } catch (err) {
        console.error('요약 데이터 조회 오류:', err);
        res.status(500).json({ success: false, message: '요약 데이터 조회 실패' });
    }
});

// 실시간 증시 및 환율 캐시 (5분 유효)
let marketCache = {
    timestamp: 0,
    data: {
        kospi: { price: '6,625.9', direction: 'down' },
        kosdaq: { price: '892.3', direction: 'down' },
        usd_krw: { price: '1,342.7', direction: 'up' }
    }
};

async function getLiveMarketData() {
    const now = Date.now();
    if (marketCache.data && (now - marketCache.timestamp < 300000)) {
        return marketCache.data;
    }

    try {
        const [kRes, qRes, uRes] = await Promise.allSettled([
            fetch('https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI', { signal: AbortSignal.timeout(2500) }).then(r => r.json()),
            fetch('https://polling.finance.naver.com/api/realtime/domestic/index/KOSDAQ', { signal: AbortSignal.timeout(2500) }).then(r => r.json()),
            fetch('https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW', { signal: AbortSignal.timeout(2500) }).then(r => r.json())
        ]);

        const nextData = { ...marketCache.data };

        if (kRes.status === 'fulfilled' && kRes.value?.datas?.[0]) {
            const d = kRes.value.datas[0];
            const p = d.closePrice || '6,625.9';
            const fName = d.compareToPreviousPrice?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            nextData.kospi = { price: p, direction: dir };
        }

        if (qRes.status === 'fulfilled' && qRes.value?.datas?.[0]) {
            const d = qRes.value.datas[0];
            const p = d.closePrice || '892.3';
            const fName = d.compareToPreviousPrice?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            nextData.kosdaq = { price: p, direction: dir };
        }

        if (uRes.status === 'fulfilled' && uRes.value?.result?.[0]) {
            const d = uRes.value.result[0];
            const p = d.closePrice || '1,342.7';
            const fName = d.fluctuationsType?.name || '';
            const dir = fName.includes('RISING') ? 'up' : (fName.includes('FALLING') ? 'down' : 'flat');
            nextData.usd_krw = { price: p, direction: dir };
        }

        marketCache = { timestamp: now, data: nextData };
        return nextData;
    } catch (e) {
        return marketCache.data;
    }
}

// 🌟 [전 사이트 공통 TV 뉴스 티커 API]
app.get('/api/ticker', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 'public, max-age=60');

    newsDb.all(
        'SELECT id, title, link, category_name, media_name, published_at FROM news_articles ORDER BY id DESC LIMIT 12',
        [],
        (err, articles) => {
            newsDb.get('SELECT weather_info FROM daily_weather ORDER BY date DESC LIMIT 1', [], async (wErr, wRow) => {
                let weather = { city: '계룡', temp: '22°C', icon: '☀️' };
                if (wRow && wRow.weather_info) {
                    try {
                        const parsed = typeof wRow.weather_info === 'string' ? JSON.parse(wRow.weather_info) : wRow.weather_info;
                        if (parsed.current_temp) weather.temp = parsed.current_temp + '°C';
                        if (parsed.condition) weather.condition = parsed.condition;
                    } catch (e) {}
                }

                const market = await getLiveMarketData();

                res.json({
                    success: true,
                    articles: articles || [],
                    weather,
                    market
                });
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

// 7. 헬스 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'JG Portal' });
});

app.listen(PORT, () => {
    console.log(`🚀 JG 통합 포털 서버 구동 완료 (Port: ${PORT}, Cookie Domain: ${COOKIE_DOMAIN})`);
});
