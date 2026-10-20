const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');
const { db, assetDb, newsDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { getLiveWeatherData } = require('../services/weather.service');
const { getLiveMarketData, getKoreanStockName } = require('../services/market.service');

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

// 대한고혈압학회(KSH) 진료지침 기준 혈압 분류 헬퍼 함수
function classifyBloodPressure(sys, dia) {
    if (!sys || !dia) return null;
    const s = Number(sys);
    const d = Number(dia);
    if (isNaN(s) || isNaN(d)) return null;

    if (s < 90 || d < 60) {
        return {
            key: 'low',
            label: '저혈압 ❄️',
            name: '저혈압',
            desc: '수축기 90 미만 또는 이완기 60 미만',
            color: '#2563eb',
            badgeClass: 'bp-badge-low'
        };
    }
    if (s >= 160 || d >= 100) {
        return {
            key: 'stage2',
            label: '2기 고혈압 🚨',
            name: '고혈압 2기',
            desc: '수축기 160 이상 또는 이완기 100 이상',
            color: '#991b1b',
            badgeClass: 'bp-badge-stage2'
        };
    }
    if (s >= 140 || d >= 90) {
        return {
            key: 'stage1',
            label: '1기 고혈압 🔴',
            name: '고혈압 1기',
            desc: '수축기 140~159 또는 이완기 90~99',
            color: '#dc2626',
            badgeClass: 'bp-badge-stage1'
        };
    }
    if (s >= 130 || d >= 80) {
        return {
            key: 'prehypertension',
            label: '고혈압 전단계 🟠',
            name: '고혈압 전단계',
            desc: '수축기 130~139 또는 이완기 80~89',
            color: '#ea580c',
            badgeClass: 'bp-badge-pre'
        };
    }
    if (s >= 120 && d < 80) {
        return {
            key: 'elevated',
            label: '주의 혈압 🟡',
            name: '주의 혈압',
            desc: '수축기 120~129 그리고 이완기 80 미만',
            color: '#d97706',
            badgeClass: 'bp-badge-elevated'
        };
    }
    return {
        key: 'normal',
        label: '정상 혈압 🟢',
        name: '정상 혈압',
        desc: '수축기 120 미만 그리고 이완기 80 미만',
        color: '#059669',
        badgeClass: 'bp-badge-normal'
    };
}

// 1. 요약 데이터 조회 API (메인 대시보드 카드용, 5초 인메모리 고속 캐시 및 완전 병렬 처리)
let summaryCache = null;
let summaryCacheTime = 0;

router.get('/api/summary', authenticateToken, async (req, res) => {
    try {
        const now = Date.now();
        if (summaryCache && (now - summaryCacheTime < 5000)) {
            return res.json(summaryCache);
        }

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
                    key: 'normal',
                    label: '정상 혈압 🟢',
                    name: '정상 혈압',
                    desc: '수축기 120 미만 그리고 이완기 80 미만',
                    color: '#059669',
                    badgeClass: 'bp-badge-normal'
                };
                const isToday = row.measured_at ? row.measured_at.startsWith(todayKst) : false;
                resolve({
                    systolic: sys,
                    diastolic: dia,
                    pulse: row.pulse,
                    measured_at: row.measured_at,
                    is_today_measured: isToday,
                    grade: grade
                });
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

        // 3-1) 최근 메모 3건 및 메모 총 개수 Promise
        const memoPromise = new Promise((resolve) => {
            db.all("SELECT id, title, category, updated_at, is_pinned FROM user_memos ORDER BY is_pinned DESC, updated_at DESC LIMIT 3", [], (err, rows) => {
                db.get("SELECT COUNT(*) as cnt FROM user_memos", [], (cErr, cRow) => {
                    resolve({
                        recent: rows || [],
                        totalCount: cRow ? cRow.cnt : (rows ? rows.length : 0)
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

        const [blood, medication, hospital, memoData, assets, weather, newsRecommendation, breakingArticles, marketData] = await Promise.all([
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

        const sortedAssets = Array.from(assetMap.values())
            .filter(item => item.total > 0)
            .sort((a, b) => b.total - a.total);

        const assetItems = sortedAssets.map((item, idx) => {
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
            memo: memoData || null,
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
let tickerMemoryCache = {
    timestamp: 0,
    payload: null
};

router.get('/api/ticker', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=15');
    const now = Date.now();
    if (tickerMemoryCache.payload && (now - tickerMemoryCache.timestamp < 15000)) {
        return res.json(tickerMemoryCache.payload);
    }

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
                    const [weather, market] = await Promise.all([
                        getLiveWeatherData(),
                        getLiveMarketData()
                    ]);

                    const responseData = {
                        success: true,
                        articles: articles || [],
                        breakingArticles: breakingRows || [],
                        breakingCount: breakingRows ? breakingRows.length : 0,
                        weather,
                        market
                    };

                    tickerMemoryCache = {
                        timestamp: Date.now(),
                        payload: responseData
                    };

                    res.json(responseData);
                }
            );
        }
    );
});

// 4. OAuth 방식 SSO 게이트웨이
router.get('/go/:service', authenticateToken, (req, res) => {
    const service = req.params.service;
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

module.exports = router;
