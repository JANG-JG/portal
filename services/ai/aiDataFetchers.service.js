/**
 * 🔒 JG 포털 AI 비서 - 3계층 보안 RBAC 데이터 수집기 (aiDataFetchers.service.js)
 * - 관리자 전용(혈압/자산/시스템) vs 가족 공용(날씨/증시/뉴스/가족일정/위키/앨범) vs 개인(본인메모/본인일정)
 * - 사용자 세션(req.user)에 따라 물리적으로 데이터를 격리하여 정보 유출 원천 차단
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { db, assetDb, newsDb, portalDb } = require('../db');
const { getLiveWeatherData, getDefaultWeatherCity } = require('../weather.service');
const { getLiveMarketData, enrichAssetsWithQuotes } = require('../market.service');
const { getCurrentCpuPercent, getRealMemoryInfo, getDiskUsage, formatUptime } = require('../systemMonitor.service');
const { decryptMemoText } = require('../crypto.service');
const { classifyBloodPressure } = require('../bloodClassifier.util');
const { searchWikiContent, getWikiSummary } = require('../wikiSummary.service');
const { searchAlbumPhotos, getRecentAlbumActivity } = require('../albumSummary.service');
const { getTopNewsIssues, searchNewsByKeyword } = require('../newsHeadline.service');
const { ADMIN_USERS } = require('../../config/constants');

/** 🛡️ 관리자 권한 확인 헬퍼 */
function isAdmin(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.username && ADMIN_USERS && (ADMIN_USERS.has ? ADMIN_USERS.has(user.username) : ADMIN_USERS.includes(user.username))) return true;
    return false;
}

/** 🕒 KST 오늘 날짜 문자열 (YYYY-MM-DD) */
function getTodayKst() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

// =============================================================================
// 1. 🔒 [관리자 전용] 데이터 수집기 (admin 권한 미보유 시 null 반환)
// =============================================================================

/** 관리자 전용: 최근 혈압 측정치 및 복약 현황 */
async function fetchBloodSummary(user) {
    if (!isAdmin(user)) return null;
    const today = getTodayKst();

    return new Promise((resolve) => {
        db.get(
            'SELECT systolic, diastolic, pulse, measured_at FROM records WHERE systolic IS NOT NULL ORDER BY measured_at DESC LIMIT 1',
            (err, row) => {
                if (err || !row) {
                    return resolve({ available: false, message: '혈압 측정 기록이 없습니다.' });
                }
                const sys = Number(row.systolic);
                const dia = Number(row.diastolic);
                const grade = classifyBloodPressure(sys, dia) || { label: '정상 혈압 🟢', name: '정상 혈압' };
                const isTodayMeasured = row.measured_at ? row.measured_at.startsWith(today) : false;

                db.get(
                    "SELECT 1 FROM records WHERE substr(medication_time, 1, 10) = ? LIMIT 1",
                    [today],
                    (mErr, todayMed) => {
                        resolve({
                            available: true,
                            systolic: sys,
                            diastolic: dia,
                            pulse: row.pulse,
                            measuredAt: row.measured_at,
                            isTodayMeasured,
                            gradeLabel: grade.label || grade.name,
                            isTodayMedicationTaken: !!todayMed
                        });
                    }
                );
            }
        );
    });
}

/** 관리자 전용: 자산 현황 요약 (총평가액, 계좌별, 상위 보유종목) */
async function fetchAssetSummary(user) {
    if (!isAdmin(user)) return null;
    if (!assetDb) return { available: false, message: '자산 데이터베이스가 연결되어 있지 않습니다.' };

    return new Promise((resolve) => {
        assetDb.all(
            'SELECT id, account_id, symbol, full_name, quantity, avg_price, currency FROM assets WHERE quantity > 0 ORDER BY id DESC',
            async (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    return resolve({ available: false, message: '등록된 자산이 없습니다.' });
                }
                try {
                    const enriched = await enrichAssetsWithQuotes(rows);
                    const list = enriched.enrichedAssets || rows;
                    let totalKrw = 0;
                    const items = list.map(a => {
                        const price = a.current_price || a.avg_price || 0;
                        const rate = a.currency === 'USD' ? (enriched.exchangeRate || 1350) : 1;
                        const valuation = Math.round(a.quantity * price * rate);
                        totalKrw += valuation;
                        return {
                            name: a.full_name || a.symbol,
                            quantity: a.quantity,
                            valuationKrw: valuation,
                            profitRate: a.profit_rate ? `${a.profit_rate.toFixed(1)}%` : '-'
                        };
                    });

                    // 평가액 기준 상위 5개 종목
                    items.sort((a, b) => b.valuationKrw - a.valuationKrw);
                    resolve({
                        available: true,
                        totalValuationKrw: totalKrw,
                        exchangeRate: enriched.exchangeRate || 1350,
                        topHoldings: items.slice(0, 5)
                    });
                } catch (e) {
                    resolve({ available: false, message: '자산 데이터 계산 중 오류가 발생했습니다.' });
                }
            }
        );
    });
}

/** 관리자 전용: 시스템 관제 상태 */
async function fetchSystemStatus(user) {
    if (!isAdmin(user)) return null;
    try {
        const cpu = getCurrentCpuPercent();
        const mem = getRealMemoryInfo();
        const disk = await getDiskUsage();
        return {
            available: true,
            cpuPercent: cpu,
            memoryPercent: mem.usagePercent,
            memoryUsedMb: mem.usedMb,
            memoryTotalMb: mem.totalMb,
            diskPercent: disk ? disk.percent : null
        };
    } catch (e) {
        return { available: false, message: '시스템 관제 지표 조회 실패' };
    }
}

// =============================================================================
// 2. 👥 [가족 공용] 데이터 수집기 (전체 사용자 접근 가능)
// =============================================================================

/** 가족 공용: 실시간 날씨 */
async function fetchWeatherSummary(user) {
    try {
        const city = (user && user.weather_city) ? user.weather_city : getDefaultWeatherCity();
        const weather = await getLiveWeatherData(city);
        if (!weather || !weather.success) {
            return { available: false, message: '날씨 정보를 불러올 수 없습니다.' };
        }
        return {
            available: true,
            city: weather.cityKo || weather.city,
            temperature: weather.temp,
            feelsLike: weather.feelsLike,
            condition: weather.descKo || weather.description,
            humidity: weather.humidity,
            rainPop: weather.pop !== undefined ? `${Math.round(weather.pop * 100)}%` : null,
            pm10: weather.pm10Grade || '보통'
        };
    } catch (e) {
        return { available: false, message: '날씨 조회 오류' };
    }
}

/** 가족 공용: 공개 거시 증시 지표 (코스피/코스닥/환율) */
async function fetchMarketIndicators() {
    try {
        const market = await getLiveMarketData();
        return {
            available: true,
            kospi: market?.kospi ? { price: market.kospi.price, change: market.kospi.change, changePercent: market.kospi.changePercent } : null,
            kosdaq: market?.kosdaq ? { price: market.kosdaq.price, change: market.kosdaq.change, changePercent: market.kosdaq.changePercent } : null,
            usdKrw: market?.usdKrw ? { rate: market.usdKrw.price, change: market.usdKrw.change } : null
        };
    } catch (e) {
        return { available: false, message: '증시 지표 조회 오류' };
    }
}

/** 가족 공용: 주요 뉴스 헤드라인 (키워드 검색 가능) */
async function fetchNewsTop(keyword = null) {
    try {
        if (keyword && keyword.trim()) {
            const searchResults = await searchNewsByKeyword(keyword.trim(), 4);
            return { available: true, keyword, news: searchResults || [] };
        }
        const topNews = await getTopNewsIssues(4);
        return { available: true, news: topNews || [] };
    } catch (e) {
        return { available: false, message: '뉴스 헤드라인 조회 오류' };
    }
}

/** 가족 공용: 가족 캘린더 일정 (is_family = 1) */
async function fetchFamilyCalendar(startDate, endDate) {
    const start = startDate || getTodayKst();
    const end = endDate || start;

    return new Promise((resolve) => {
        portalDb.all(
            `SELECT id, title, event_date, event_time, category, memo, is_all_day 
             FROM calendar_events 
             WHERE is_family = 1 AND event_date BETWEEN ? AND ? 
             ORDER BY event_date ASC, event_time ASC LIMIT 10`,
            [start, end],
            (err, rows) => {
                if (err) return resolve({ available: false, message: '가족 일정 조회 실패' });
                resolve({
                    available: true,
                    count: rows ? rows.length : 0,
                    events: (rows || []).map(r => ({
                        title: r.title,
                        date: r.event_date,
                        time: r.is_all_day ? '하루 종일' : (r.event_time || '시간 미지정'),
                        category: r.category,
                        memo: r.memo
                    }))
                });
            }
        );
    });
}

/** 가족 공용: 가족 위키 검색 */
async function fetchFamilyWiki(query) {
    if (!query || !query.trim()) {
        const summary = await getWikiSummary();
        return { available: true, summary: summary?.tip || '가족 위키에 다양한 생활 가이드가 등록되어 있습니다.' };
    }
    try {
        const searchResults = await searchWikiContent(query.trim(), 3);
        return { available: true, query, results: searchResults || [] };
    } catch (e) {
        return { available: false, message: '위키 검색 오류' };
    }
}

/** 가족 공용: 가족 사진첩 검색 */
async function fetchFamilyPhotos(query) {
    try {
        if (query && query.trim()) {
            const results = await searchAlbumPhotos(query.trim(), 4);
            return { available: true, query, photos: results || [] };
        }
        const recent = await getRecentAlbumActivity(4);
        return { available: true, photos: recent || [] };
    } catch (e) {
        return { available: false, message: '사진첩 검색 오류' };
    }
}

// =============================================================================
// 3. 👤 [개인 전용] 데이터 수집기 (본인 계정의 데이터만 엄격 격리)
// =============================================================================

/** 개인 전용: 본인 개인 캘린더 일정 */
async function fetchPersonalCalendar(userId, startDate, endDate) {
    if (!userId) return { available: false, message: '사용자 정보가 필요합니다.' };
    const start = startDate || getTodayKst();
    const end = endDate || start;

    return new Promise((resolve) => {
        portalDb.all(
            `SELECT id, title, event_date, event_time, category, memo, is_all_day 
             FROM calendar_events 
             WHERE user_id = ? AND is_family = 0 AND event_date BETWEEN ? AND ? 
             ORDER BY event_date ASC, event_time ASC LIMIT 10`,
            [userId, start, end],
            (err, rows) => {
                if (err) return resolve({ available: false, message: '개인 일정 조회 실패' });
                resolve({
                    available: true,
                    count: rows ? rows.length : 0,
                    events: (rows || []).map(r => ({
                        title: r.title,
                        date: r.event_date,
                        time: r.is_all_day ? '하루 종일' : (r.event_time || '시간 미지정'),
                        category: r.category,
                        memo: r.memo
                    }))
                });
            }
        );
    });
}

/** 개인 전용: 본인 메모장 검색 (AES-256-GCM 복호화 적용) */
async function fetchPersonalMemos(userId, query = null) {
    if (!userId) return { available: false, message: '사용자 정보가 필요합니다.' };

    return new Promise((resolve) => {
        portalDb.all(
            `SELECT id, title, content, category, updated_at, is_pinned 
             FROM user_memos 
             WHERE user_id = ? 
             ORDER BY is_pinned DESC, updated_at DESC LIMIT 15`,
            [userId],
            (err, rows) => {
                if (err || !rows) return resolve({ available: false, message: '메모 조회 실패' });

                // 본인 키로 복호화 수행
                const decryptedMemos = rows.map(r => {
                    const decTitle = decryptMemoText(r.title, userId) || r.title || '';
                    const decContent = decryptMemoText(r.content, userId) || r.content || '';
                    return {
                        id: r.id,
                        title: decTitle,
                        content: decContent,
                        category: r.category,
                        updatedAt: r.updated_at
                    };
                });

                // 검색어가 있으면 필터링
                if (query && query.trim()) {
                    const q = query.trim().toLowerCase();
                    const filtered = decryptedMemos.filter(m =>
                        m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q)
                    );
                    return resolve({ available: true, query, memos: filtered.slice(0, 5) });
                }

                resolve({ available: true, memos: decryptedMemos.slice(0, 5) });
            }
        );
    });
}

module.exports = {
    isAdmin,
    getTodayKst,
    // 1. 관리자 전용
    fetchBloodSummary,
    fetchAssetSummary,
    fetchSystemStatus,
    // 2. 가족 공용
    fetchWeatherSummary,
    fetchMarketIndicators,
    fetchNewsTop,
    fetchFamilyCalendar,
    fetchFamilyWiki,
    fetchFamilyPhotos,
    // 3. 개인 전용
    fetchPersonalCalendar,
    fetchPersonalMemos
};
