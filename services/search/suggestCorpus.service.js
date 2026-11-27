/**
 * 🧠 JG 통합 검색 - 추천어 확장 코퍼스 & 즉답 프리뷰 & 랭킹 (suggestCorpus.service.js)
 * - 일정, 병원, 복약, 주요 도시 날씨, 환율/증시/단위 사전 제공
 * - 계산기·단위변환(0ms) 및 날씨·환율(350ms 제한) 바로 답 미리보기 생성
 * - 접두어·단어·부분·초성 매칭 점수 기반 랭킹 및 중복 제거
 */

const { db, portalDb } = require('../db');
const { decryptCalendarText } = require('../crypto.service');
const { resolveCalcOrUnitWidget, resolveSmartWidget } = require('./smartWidget.service');
const { matchesQuery } = require('./chosung.util');

const MAJOR_CITIES = [
    '서울', '부산', '인천', '대구', '대전', '광주', '울산', '세종',
    '수원', '성남', '용인', '고양', '청주', '천안', '전주', '포항',
    '창원', '제주', '춘천', '강릉', '여수', '계룡', '공주', '논산',
    '도쿄', '오사카', '후쿠오카', '뉴욕', '런던', '파리', '방콕', '싱가포르'
];

const STATIC_DICTIONARY_HINTS = [
    { text: '오늘 날씨', type: 'weather', icon: '🌤️', badge: '날씨', subtitle: '내 위치 실시간 날씨' },
    { text: '원달러 환율', type: 'finance', icon: '💱', badge: '환율', subtitle: 'USD/KRW 실시간 시세' },
    { text: '엔화 환율', type: 'finance', icon: '💱', badge: '환율', subtitle: 'JPY/KRW 실시간 시세' },
    { text: '유로 환율', type: 'finance', icon: '💱', badge: '환율', subtitle: 'EUR/KRW 실시간 시세' },
    { text: '코스피 증시', type: 'finance', icon: '📈', badge: '증시', subtitle: 'KOSPI 지수 현황' },
    { text: '코스닥 증시', type: 'finance', icon: '📈', badge: '증시', subtitle: 'KOSDAQ 지수 현황' },
    { text: '나스닥', type: 'finance', icon: '📈', badge: '증시', subtitle: 'NASDAQ 지수 현황' },
    { text: '삼성전자 주가', type: 'finance', icon: '📈', badge: '종목', subtitle: '실시간 시세' },
    { text: '34평 몇제곱미터', type: 'unit', icon: '📐', badge: '단위변환', subtitle: '112.40 ㎡' },
    { text: '100달러 원화', type: 'finance', icon: '💱', badge: '환율계산', subtitle: '실시간 환율 계산' },
    ...MAJOR_CITIES.map((city) => ({
        text: `${city} 날씨`,
        type: 'weather',
        icon: '🌤️',
        badge: '날씨',
        subtitle: `${city} 현재 기온 및 예보`
    }))
];

function safeDecryptCal(text, userId, isFam) {
    try {
        return decryptCalendarText(text, userId, isFam);
    } catch (_) {
        return '';
    }
}

async function fetchUserExtendedPool(userId, isAdmin, hasBlood) {
    const calendarPromise = new Promise((resolve) => {
        if (!portalDb) return resolve([]);
        portalDb.all(
            `SELECT id, user_id, title, event_date, category, is_family
             FROM calendar_events
             WHERE is_family = 1 OR category = '가족' OR user_id = ?
             ORDER BY event_date DESC, id DESC LIMIT 30`,
            [userId],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const out = [];
                for (const r of rows) {
                    const isFam = Boolean(r.is_family === 1 || r.category === '가족');
                    const title = safeDecryptCal(r.title, r.user_id, isFam);
                    if (title) {
                        out.push({
                            text: title,
                            type: 'calendar',
                            icon: '📅',
                            badge: '일정',
                            subtitle: r.event_date ? `${r.event_date} · ${r.category || '일정'}` : '스마트 캘린더',
                            url: `/calendar?date=${encodeURIComponent(r.event_date || '')}`
                        });
                    }
                }
                resolve(out);
            }
        );
    });

    const hospitalPromise = new Promise((resolve) => {
        if (!hasBlood || !db) return resolve([]);
        db.all(
            'SELECT hospital_name, department, visit_date FROM hospital_visits WHERE (user_id = ? OR ? = 1) ORDER BY visit_date DESC LIMIT 20',
            [userId, isAdmin ? 1 : 0],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(
                    rows
                        .filter((r) => r.hospital_name)
                        .map((r) => ({
                            text: r.hospital_name,
                            type: 'hospital',
                            icon: '🏥',
                            badge: '병원',
                            subtitle: [r.department, r.visit_date].filter(Boolean).join(' · '),
                            url: 'https://blood.j-jg.cc/dashboard.html#hospital'
                        }))
                );
            }
        );
    });

    const medPromise = new Promise((resolve) => {
        if (!hasBlood || !db) return resolve([]);
        db.all(
            'SELECT med_name, target_label FROM health_medications WHERE (user_id = ? OR ? = 1 OR share_with_family = 1) AND is_active = 1 LIMIT 20',
            [userId, isAdmin ? 1 : 0],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(
                    rows
                        .filter((r) => r.med_name)
                        .map((r) => ({
                            text: r.med_name,
                            type: 'medication',
                            icon: '💊',
                            badge: '복약',
                            subtitle: r.target_label ? `${r.target_label} 복약` : '복약 관리',
                            url: 'https://blood.j-jg.cc/dashboard.html'
                        }))
                );
            }
        );
    });

    const [calendar, hospitals, medications] = await Promise.all([
        calendarPromise,
        hospitalPromise,
        medPromise
    ]);

    return { calendar, hospitals, medications };
}

async function resolveQuickPreview(rawQuery, user) {
    const q = String(rawQuery || '').trim();
    if (!q) return null;

    const calcOrUnit = resolveCalcOrUnitWidget(q);
    if (calcOrUnit) {
        if (calcOrUnit.type === 'calculator') {
            return {
                text: q,
                type: 'instant',
                icon: '🧮',
                badge: '바로 답',
                subtitle: `= ${calcOrUnit.data.result}`,
                isInstant: true
            };
        }
        if (calcOrUnit.type === 'unit') {
            return {
                text: q,
                type: 'instant',
                icon: '📐',
                badge: '바로 답',
                subtitle: `${calcOrUnit.data.from} → ${calcOrUnit.data.to}`,
                isInstant: true
            };
        }
    }

    const looksLikeSmart = /(날씨|기온|미세먼지|환율|달러|엔화|유로|위안|코스피|코스닥|나스닥|주가)/.test(q);
    if (!looksLikeSmart) return null;

    try {
        const widget = await Promise.race([
            resolveSmartWidget(q, user),
            new Promise((resolve) => setTimeout(() => resolve(null), 350))
        ]);
        if (!widget || !widget.data) return null;

        if (widget.type === 'weather') {
            const d = widget.data;
            const tempStr = String(d.temp ?? '-').includes('°') ? String(d.temp) : `${d.temp ?? '-'}°C`;
            const descStr = d.weatherDesc || d.desc || d.condition || '';
            return {
                text: q,
                type: 'instant',
                icon: d.icon || '🌤️',
                badge: '바로 답',
                subtitle: [d.city, tempStr, descStr].filter(Boolean).join(' · '),
                isInstant: true
            };
        }
        if (widget.type === 'fx') {
            const d = widget.data;
            return {
                text: q,
                type: 'instant',
                icon: '💱',
                badge: '바로 답',
                subtitle: `${d.fromAmount} ${d.fromCurrency} ≈ ${Number(d.krwAmount || 0).toLocaleString()}원`,
                isInstant: true
            };
        }
        if (widget.type === 'stock') {
            const d = widget.data;
            return {
                text: q,
                type: 'instant',
                icon: '📈',
                badge: '바로 답',
                subtitle: `${d.name || d.symbol} ${Number(d.price || 0).toLocaleString()} (${d.changePct || ''})`,
                isInstant: true
            };
        }
    } catch (_) {}

    return null;
}

function scoreCandidate(text, q, isChosung, cleanChosung, baseWeight = 40) {
    if (!text) return -1;
    if (!matchesQuery(text, q, isChosung, cleanChosung)) return -1;

    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    let matchBonus = 15;
    if (lowerText === lowerQ) matchBonus = 100;
    else if (lowerText.startsWith(lowerQ)) matchBonus = 60;
    else if (lowerText.includes(' ' + lowerQ)) matchBonus = 40;
    else if (!isChosung && lowerText.includes(lowerQ)) matchBonus = 22;

    return baseWeight + matchBonus;
}

module.exports = {
    STATIC_DICTIONARY_HINTS,
    fetchUserExtendedPool,
    resolveQuickPreview,
    scoreCandidate
};
