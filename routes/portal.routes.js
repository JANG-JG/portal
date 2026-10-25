const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');
const { db, assetDb, newsDb, albumDb, portalDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { getLiveWeatherData, CITY_LIST, normalizeCityCode, getDefaultWeatherCity } = require('../services/weather.service');
const { getLiveMarketData, getKoreanStockName, enrichAssetsWithQuotes } = require('../services/market.service');
const { getCurrentCpuPercent, getRealMemoryInfo, getSecondaryServerStatus, getDiskUsage } = require('../services/systemMonitor.service');
const { decryptMemoText } = require('../services/crypto.service');

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
const { calculateReservationOpenDate, classifyBloodPressure } = require('../services/bloodClassifier.util');

// 1. 요약 데이터 조회 API (메인 대시보드 카드용, SWR 60초 캐시 및 백그라운드 무기다림 갱신)
let summaryCache = null;
let summaryCacheTime = 0;
let isRefreshingSummary = false;

async function buildSummaryData() {
    const todayKst = getKstDateTimeString().slice(0, 10);

    function calcDDay(targetDateStr) {
        if (!targetDateStr || targetDateStr === '-') return null;
        try {
            const cleanDate = targetDateStr.slice(0, 10);
            const target = new Date(cleanDate + 'T00:00:00+09:00');
            const today = new Date(todayKst + 'T00:00:00+09:00');
            if (isNaN(target.getTime()) || isNaN(today.getTime())) return null;
            const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'D-Day';
            if (diffDays > 0) return `D-${diffDays}`;
            return `D+${Math.abs(diffDays)}`;
        } catch (e) {
            return null;
        }
    }

    // 1) 혈압 최근 측정치 Promise
    const bloodPromise = new Promise((resolve) => {
        db.get('SELECT systolic, diastolic, pulse, measured_at FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 1', (err, row) => {
            if (err || !row) return resolve(null);
            const sys = Number(row.systolic);
            const dia = Number(row.diastolic);
            const grade = classifyBloodPressure(sys, dia) || {
                key: 'normal', label: '정상 혈압 🟢', name: '정상 혈압',
                desc: '수축기 120 미만 그리고 이완기 80 미만', color: '#059669', badgeClass: 'bp-badge-normal'
            };
            const isToday = row.measured_at ? row.measured_at.startsWith(todayKst) : false;
            resolve({ systolic: sys, diastolic: dia, pulse: row.pulse, measured_at: row.measured_at, is_today_measured: isToday, grade });
        });
    });

    // 2) 최근 투약 일시 및 오늘 복약 완료 여부 Promise
    const medicationPromise = new Promise((resolve) => {
        db.get("SELECT medication_time FROM records WHERE medication_time IS NOT NULL AND medication_time != '' ORDER BY medication_time DESC LIMIT 1", (err, row) => {
            db.get("SELECT 1 FROM records WHERE substr(medication_time, 1, 10) = ? LIMIT 1", [todayKst], (tErr, todayRow) => {
                const isTodayTaken = !!todayRow;
                resolve({
                    medication_time: row ? row.medication_time : null,
                    is_today_taken: isTodayTaken
                });
            });
        });
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
                        prescriptionDays: lastVisit.prescription_days || 0,
                        nextVisitDDay: calcDDay(nextVisitDate),
                        reservationOpenDDay: calcDDay(reservationOpenDate)
                    });
                });
            });
        });
    });

    // 3-1) 최근 메모 3건 및 메모 총 개수 Promise (AES-256-GCM 복호화 적용)
    const memoPromise = new Promise((resolve) => {
        portalDb.all("SELECT id, user_id, title, category, updated_at, is_pinned FROM user_memos ORDER BY is_pinned DESC, updated_at DESC LIMIT 3", [], (err, rows) => {
            const decRows = (rows || []).map(r => ({
                id: r.id,
                title: decryptMemoText(r.title, r.user_id),
                category: r.category,
                updated_at: r.updated_at,
                is_pinned: r.is_pinned
            }));
            portalDb.get("SELECT COUNT(*) as cnt FROM user_memos", [], (cErr, cRow) => {
                resolve({
                    recent: decRows,
                    totalCount: cRow ? cRow.cnt : decRows.length
                });
            });
        });
    });

    // 4) 자산 보유 종목 Promise (실시간 시세 및 환율 반영)
    const assetsPromise = new Promise((resolve) => {
        assetDb.all('SELECT id, account_id, symbol, full_name, quantity, avg_price, currency FROM assets WHERE quantity > 0 ORDER BY id DESC', async (err, rows) => {
            try {
                const result = await enrichAssetsWithQuotes(rows || []);
                resolve(result);
            } catch (e) {
                resolve({ enrichedAssets: rows || [], exchangeRate: 1350.0 });
            }
        });
    });

    // 5) 실시간 날씨 Promise
    const weatherPromise = getLiveWeatherData();

    // 6) 뉴스 추천 기사 Promise
    const newsPromise = new Promise((resolve) => {
        newsDb.all("SELECT id, name FROM categories WHERE is_active = 1 AND name != '속보' ORDER BY id ASC", [], async (cErr, categories) => {
            if (cErr || !categories || categories.length === 0) {
                newsDb.all("SELECT id, title, link, media_name, category_name, published_at, image_url FROM news_articles WHERE category_name != '속보' AND title NOT LIKE '%[속보]%' ORDER BY id DESC LIMIT 5", [], (aErr, fallbackRows) => {
                    resolve(fallbackRows || []);
                });
                return;
            }

            try {
                const articlePromises = categories.map(cat => {
                    return new Promise(innerResolve => {
                        newsDb.get(
                            'SELECT id, title, link, media_name, category_name, published_at, image_url FROM news_articles WHERE category_name = ? AND title NOT LIKE "%[속보]%" AND title NOT LIKE "%(속보)%" ORDER BY id DESC LIMIT 1',
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
            `SELECT id, title, link, media_name, published_at, image_url 
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

    const [blood, medication, hospital, memoData, assetQuoteResult, weather, newsRecommendation, breakingArticles, marketData] = await Promise.all([
        bloodPromise,
        medicationPromise,
        hospitalPromise,
        memoPromise,
        assetsPromise,
        weatherPromise,
        newsPromise,
        breakingPromise,
        marketPromise
    ]);

    const enrichedAssets = (assetQuoteResult && assetQuoteResult.enrichedAssets) ? assetQuoteResult.enrichedAssets : [];
    const currentRate = (assetQuoteResult && assetQuoteResult.exchangeRate) ? assetQuoteResult.exchangeRate : 1350.0;

    const assetMap = new Map();
    let totalUsd = 0;

    for (const a of enrichedAssets) {
        const curPrice = (typeof a.currentPrice === 'number' && a.currentPrice > 0) ? a.currentPrice : a.avg_price;
        const curVal = a.quantity * curPrice;
        const costVal = a.quantity * a.avg_price;
        const isUsd = (a.currency || '').toUpperCase() === 'USD';

        const curValKrw = isUsd ? (curVal * currentRate) : curVal;
        const costValKrw = isUsd ? (costVal * currentRate) : costVal;

        if (isUsd) {
            totalUsd += curVal;
        } else {
            totalUsd += (curVal / currentRate);
        }

        const sym = a.symbol.trim();
        const korName = getKoreanStockName(sym, a.full_name);
        const existing = assetMap.get(sym) || {
            symbol: sym,
            name: korName,
            quantity: 0,
            total: 0,
            costTotal: 0
        };
        existing.quantity += a.quantity;
        existing.total += curValKrw;
        existing.costTotal += costValKrw;
        assetMap.set(sym, existing);
    }

    const totalKrw = Math.round(totalUsd * currentRate);

    const sortedAssets = Array.from(assetMap.values())
        .filter(item => item.total > 0)
        .sort((a, b) => b.total - a.total);

    const assetItems = sortedAssets.map((item) => {
        const profitPct = item.costTotal > 0 ? ((item.total - item.costTotal) / item.costTotal) * 100 : 0;
        const diffStr = profitPct.toFixed(1);
        const isUp = profitPct >= 0;
        return {
            symbol: item.symbol,
            name: item.name,
            quantity: item.quantity,
            formattedTotal: '₩' + Math.round(item.total).toLocaleString(),
            diffPercent: (isUp ? '+' : '') + diffStr + '%',
            direction: isUp ? 'up' : 'down'
        };
    });

    // 5) 주서버 & 구형 노트북 보조서버 인프라 메트릭 취합
    let primaryCpu = '0.0%';
    let primaryRam = '44.7%';
    let primaryDisk = '42% (26.8GB / 64.0GB)';
    let primaryNet = '정상 (온라인)';

    let secondaryCpu = '대기 중';
    let secondaryRam = '대기 중';
    let secondaryDisk = '2.1% (9.6GB / 456GB)';
    let secondaryNet = '백업 대기 (새벽 04:00)';
    let secondaryTemp = '38.5°C';
    let secondaryStatus = {
        online: false
    };

    try {
        primaryCpu = (typeof getCurrentCpuPercent === 'function' ? getCurrentCpuPercent() : '0.0') + '%';
        const memInfo = typeof getRealMemoryInfo === 'function' ? getRealMemoryInfo() : null;
        if (memInfo && memInfo.percent) {
            primaryRam = memInfo.percent;
        }
        if (typeof getDiskUsage === 'function') {
            const diskInfo = await getDiskUsage();
            if (diskInfo && diskInfo.total !== '0 GB') {
                primaryDisk = `${diskInfo.percent} (${diskInfo.used} / ${diskInfo.total})`;
            }
        }
        primaryNet = '정상 (온라인)';

        if (typeof getSecondaryServerStatus === 'function') {
            const secInfo = await getSecondaryServerStatus();
            if (secInfo) {
                secondaryStatus.online = !!secInfo.online;
                if (secInfo.online) {
                    secondaryCpu = (secInfo.cpu && secInfo.cpu.percent) ? secInfo.cpu.percent : '1.2%';
                    secondaryRam = (secInfo.memory && secInfo.memory.percent) ? secInfo.memory.percent : '17.2%';
                    if (secInfo.disk && secInfo.disk.total) {
                        secondaryDisk = `${secInfo.disk.percent} (${secInfo.disk.used} / ${secInfo.disk.total})`;
                    }
                    secondaryNet = '정상 (온라인)';
                    secondaryTemp = (secInfo.cpu && secInfo.cpu.temp) ? secInfo.cpu.temp : '38.5°C';
                } else {
                    secondaryCpu = '대기 중';
                    secondaryRam = '대기 중';
                    if (secInfo.disk && secInfo.disk.total) {
                        secondaryDisk = `${secInfo.disk.percent} (${secInfo.disk.used} / ${secInfo.disk.total})`;
                    }
                    secondaryNet = '백업 대기 (새벽 04:00)';
                    secondaryTemp = (secInfo.cpu && secInfo.cpu.temp && secInfo.cpu.temp !== '대기 중') ? secInfo.cpu.temp : '38.5°C';
                }
            }
        }
    } catch (e) {}

    return {
        success: true,
        blood: blood || null,
        medication: medication || null,
        hospital: hospital || null,
        memo: memoData || null,
        weather: weather || null,
        asset: {
            totalKrw: '₩' + totalKrw.toLocaleString(),
            count: enrichedAssets.length,
            items: assetItems
        },
        news: {
            market: marketData,
            recommendedArticles: newsRecommendation,
            breakingArticles: breakingArticles || []
        },
        system: {
            primary: {
                name: '주서버 (갤럭시 노트 9)',
                cpu: primaryCpu,
                ram: primaryRam,
                disk: primaryDisk,
                network: primaryNet,
                status: 'online',
                statusText: '상시 가동'
            },
            secondary: {
                name: '보조서버 (구형 노트북)',
                cpu: secondaryCpu,
                ram: secondaryRam,
                disk: secondaryDisk,
                network: secondaryNet,
                temp: secondaryTemp,
                status: secondaryStatus.online ? 'online' : 'standby',
                statusText: secondaryStatus.online ? '정상 가동' : '백업 대기'
            }
        }
    };
}

async function refreshSummaryInBackground() {
    if (isRefreshingSummary) return;
    isRefreshingSummary = true;
    try {
        const freshData = await buildSummaryData();
        summaryCache = freshData;
        summaryCacheTime = Date.now();
    } catch (e) {
        console.error('백그라운드 요약 데이터 갱신 오류:', e);
    } finally {
        isRefreshingSummary = false;
    }
}

router.get('/api/summary', authenticateToken, async (req, res) => {
    try {
        const now = Date.now();

        async function attachUserWeather(baseSummary) {
            if (!baseSummary) return baseSummary;
            const username = req.user ? req.user.username : 'admin';
            let userCity = null;
            try {
                const userRow = await new Promise((resUser) => {
                    db.get("SELECT weather_city FROM users WHERE username = ?", [username], (uErr, row) => resUser(row || null));
                });
                if (userRow && userRow.weather_city && userRow.weather_city.trim()) {
                    userCity = userRow.weather_city.trim();
                }
            } catch (e) {}

            if (!userCity) {
                userCity = await getDefaultWeatherCity();
            }

            const userWeather = await getLiveWeatherData(userCity);
            return {
                ...baseSummary,
                user_city: userCity,
                weather: userWeather || baseSummary.weather
            };
        }

        // 1. 60초 이내 신선한 캐시: 0ms 즉시 반환
        if (summaryCache && (now - summaryCacheTime < 60 * 1000)) {
            const responseData = await attachUserWeather(summaryCache);
            return res.json(responseData);
        }

        // 2. 만료되었지만 기존 캐시가 있음: 0ms 즉시 반환하고 백그라운드에서 조용히 갱신 (SWR)
        if (summaryCache) {
            refreshSummaryInBackground();
            const responseData = await attachUserWeather(summaryCache);
            return res.json(responseData);
        }

        // 3. 서버 시작 후 최초 1회 요청 시
        const resultData = await buildSummaryData();
        summaryCache = resultData;
        summaryCacheTime = now;
        const responseData = await attachUserWeather(resultData);
        res.json(responseData);
    } catch (err) {
        console.error('요약 데이터 조회 오류:', err);
        res.status(500).json({ success: false, message: '요약 데이터 조회 실패' });
    }
});

// 1-1. 메인 대시보드용 최근 가족 앨범 사진 8선 조회 API
router.get('/api/portal/recent-photos', authenticateToken, (req, res) => {
    if (!albumDb) {
        return res.json({ success: true, photos: [] });
    }
    const query = `
        SELECT 
            p.id, p.caption, p.thumbnail_filename, p.storage_filename, p.created_at, 
            COALESCE(m.nickname, '가족') as author_nickname,
            COALESCE(m.avatar_emoji, '😊') as author_emoji,
            (SELECT COUNT(*) FROM photo_comments c WHERE c.photo_id = p.id) as comment_count,
            (SELECT COUNT(*) FROM photo_reactions r WHERE r.photo_id = p.id) as reaction_count,
            (SELECT COUNT(*) FROM photo_images pi WHERE pi.photo_id = p.id) as image_count
        FROM photos p
        LEFT JOIN family_members m ON p.member_id = m.id
        ORDER BY p.id DESC
        LIMIT 8
    `;
    albumDb.all(query, [], (err, rows) => {
        if (err) {
            console.error('포털 최근 사진 조회 오류:', err.message);
            return res.json({ success: false, photos: [] });
        }
        const photos = (rows || []).map(r => ({
            id: r.id,
            caption: r.caption || '',
            thumbnailUrl: `https://album.j-jg.cc/uploads/thumbnails/${r.thumbnail_filename}`,
            author: r.author_nickname,
            emoji: r.author_emoji,
            createdAt: r.created_at,
            commentCount: r.comment_count || 0,
            reactionCount: r.reaction_count || 0,
            batchTotal: Math.max(1, r.image_count || 1)
        }));
        res.json({ success: true, photos });
    });
});

// 2. 원터치 복약 등록 API
router.post('/api/blood/quick-med', authenticateToken, (req, res) => {
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
                summaryCache = null; // 복약 상태 즉시 반영을 위한 캐시 무효화
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

// 3. 전 사이트 공통 TV 뉴스 티커 API
// 3. 하단 실시간 뉴스/속보 티커 API (SWR 무기다림 캐시 패턴 적용: 직전 데이터 0ms 반환 + 백그라운드 비동기 갱신)
let tickerMemoryCache = {
    timestamp: 0,
    payload: null
};
let isUpdatingTicker = false;

function fetchTickerFromDb() {
    return new Promise((resolve) => {
        newsDb.all(
            "SELECT id, title, link, category_name, media_name, published_at FROM news_articles WHERE category_name != '속보' AND title NOT LIKE '%[속보]%' ORDER BY id DESC LIMIT 12",
            [],
            (err, articles) => {
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
                        try {
                            const defaultCity = await getDefaultWeatherCity();
                            const [weather, market] = await Promise.all([
                                getLiveWeatherData(defaultCity),
                                getLiveMarketData()
                            ]);

                            resolve({
                                success: true,
                                articles: articles || [],
                                breakingArticles: breakingRows || [],
                                breakingCount: breakingRows ? breakingRows.length : 0,
                                weather,
                                market
                            });
                        } catch (e) {
                            resolve({
                                success: true,
                                articles: articles || [],
                                breakingArticles: breakingRows || [],
                                breakingCount: 0,
                                weather: null,
                                market: null
                            });
                        }
                    }
                );
            }
        );
    });
}

async function refreshTickerInBackground() {
    if (isUpdatingTicker) return;
    isUpdatingTicker = true;
    try {
        const freshData = await fetchTickerFromDb();
        if (freshData && freshData.success) {
            tickerMemoryCache = {
                timestamp: Date.now(),
                payload: freshData
            };
        }
    } catch (e) {
        console.warn('[Ticker] 백그라운드 갱신 에러:', e.message);
    } finally {
        isUpdatingTicker = false;
    }
}

// 최초 서버 가동 2초 후 1회 사전 웜업 (첫 접속자도 0ms 보장)
setTimeout(() => {
    refreshTickerInBackground();
}, 2000);

router.get('/api/ticker', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=15');
    const now = Date.now();

    // 1) 15초 이내 신선한 캐시가 있으면 즉시 반환 (0ms)
    if (tickerMemoryCache.payload && (now - tickerMemoryCache.timestamp < 15000)) {
        return res.json(tickerMemoryCache.payload);
    }

    // 2) 만료되었더라도 직전 캐시가 있으면 즉시 반환(0ms)하고 백그라운드 비동기 갱신 (SWR 무기다림)
    if (tickerMemoryCache.payload) {
        refreshTickerInBackground();
        return res.json(tickerMemoryCache.payload);
    }

    // 3) 최초 1회 부팅 직후 캐시가 아예 없을 때만 동기 대기
    const freshData = await fetchTickerFromDb();
    tickerMemoryCache = {
        timestamp: Date.now(),
        payload: freshData
    };
    res.json(freshData);
});

// 4. OAuth 방식 SSO 게이트웨이 (15초 초단기 + jti 1회용 Nonce + 딥링크 지원 + RBAC 권한 검증)
const crypto = require('crypto');
router.get('/go/:service', authenticateToken, (req, res) => {
    const service = req.params.service;
    let targetPath = (req.query.path || '').trim();
    // 🛡️ 오픈 리다이렉트 및 프로토콜 탈출 차단 가드
    if (targetPath) {
        if (/^\/\//.test(targetPath) || /^\/\\/.test(targetPath) || /^[a-zA-Z]+:/.test(targetPath) || targetPath.includes('\\')) {
            targetPath = '';
        }
    }

    const executeSso = (userNickname = '') => {
        const jti = crypto.randomBytes(16).toString('hex');
        const ticket = jwt.sign(
            {
                username: req.user.username,
                role: req.user.role || 'family',
                nickname: userNickname || req.user.nickname || req.user.username,
                jti,
                purpose: 'sso_ticket'
            },
            JWT_SECRET,
            { expiresIn: '15s' }
        );

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');

        let baseUrl = '';
        if (service === 'news') baseUrl = 'https://news.j-jg.cc';
        else if (service === 'economy') baseUrl = 'https://news.j-jg.cc/economy';
        else if (service === 'asset') baseUrl = 'https://asset.j-jg.cc';
        else if (service === 'blood') baseUrl = 'https://blood.j-jg.cc';
        else if (service === 'album') baseUrl = 'https://album.j-jg.cc';

        if (baseUrl) {
            let destUrl = baseUrl;
            let hash = '';
            if (targetPath) {
                const hashIdx = targetPath.indexOf('#');
                let cleanPath = targetPath;
                if (hashIdx !== -1) {
                    hash = targetPath.slice(hashIdx);
                    cleanPath = targetPath.slice(0, hashIdx);
                }
                if (cleanPath && !cleanPath.startsWith('/') && !cleanPath.startsWith('?')) {
                    cleanPath = '/' + cleanPath;
                }
                destUrl = baseUrl.replace(/\/+$/, '') + cleanPath;
            }
            const sep = destUrl.includes('?') ? '&' : '?';
            return res.redirect(`${destUrl}${sep}token=${ticket}${hash}`);
        }
        res.redirect('/');
    };

    // 🛡️ 가족 계정 서비스별 접근 권한(RBAC) 검증
    if (req.user.role === 'family') {
        db.get('SELECT allowed_services, nickname FROM users WHERE username = ?', [req.user.username], (uErr, userRow) => {
            let allowed = ['album', 'news'];
            try {
                if (userRow && userRow.allowed_services) allowed = JSON.parse(userRow.allowed_services);
            } catch (e) {}

            const serviceKey = (service === 'economy' ? 'news' : service);
            if (!allowed.includes('all') && !allowed.includes(serviceKey)) {
                return res.redirect('/?notice=unauthorized_service');
            }
            executeSso(userRow?.nickname);
        });
    } else {
        executeSso();
    }
});

// 6. 사용자 날씨 지역 조회 API
router.get('/api/portal/user/weather-city', authenticateToken, async (req, res) => {
    try {
        const username = req.user ? req.user.username : 'admin';
        const defaultCity = await getDefaultWeatherCity();
        db.get("SELECT weather_city FROM users WHERE username = ?", [username], (err, row) => {
            const currentCity = (row && row.weather_city && row.weather_city.trim()) ? row.weather_city.trim() : defaultCity;
            res.json({
                success: true,
                current_city: currentCity,
                cities: CITY_LIST
            });
        });
    } catch (e) {
        res.json({ success: true, current_city: 'Seoul', cities: CITY_LIST });
    }
});

// 7. 사용자 날씨 지역 변경 저장 API (포털, 하단 뉴스바, 날씨 브리핑 100% 자동 연동)
router.post('/api/portal/user/weather-city', authenticateToken, async (req, res) => {
    try {
        const username = req.user ? req.user.username : 'admin';
        const rawCity = (req.body && req.body.city) ? req.body.city : 'Seoul';
        const cityCode = normalizeCityCode(rawCity);

        // 1) health.db users 테이블에 저장
        db.run("UPDATE users SET weather_city = ? WHERE username = ?", [cityCode, username], async function(err) {
            if (err) {
                console.error('날씨 지역 변경 실패:', err);
                return res.status(500).json({ success: false, message: '지역 설정 저장에 실패했습니다.' });
            }

            // 2) briefing.db(newsDb) system_settings 테이블에도 즉시 동기화 저장 (날씨 브리핑과 100% 자동 연동)
            if (newsDb) {
                try {
                    newsDb.run(
                        "INSERT INTO system_settings (key, value, updated_at) VALUES ('weather_city', ?, datetime('now', '+9 hours')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                        [cityCode]
                    );
                } catch (dbErr) {
                    console.warn('newsDb system_settings 동기화 경고:', dbErr.message);
                }
            }

            // 3) 캐시 즉시 무효화 (하단 뉴스바 및 메인 화면 즉시 갱신)
            tickerMemoryCache.payload = null;
            tickerMemoryCache.timestamp = 0;
            summaryCache = null;

            const updatedWeather = await getLiveWeatherData(cityCode);
            res.json({
                success: true,
                message: '날씨 지역이 성공적으로 변경되었습니다.',
                current_city: cityCode,
                weather: updatedWeather
            });
        });
    } catch (e) {
        console.error('날씨 지역 설정 오류:', e);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

module.exports = router;
