/**
 * ==============================================================================
 * 공공데이터포털(data.go.kr) 천문·기상 실시간 자연과학 연동 서비스
 * (studyDataGoKr.service.js)
 * ------------------------------------------------------------------------------
 * - 한국천문연구원 월령 정보 (LunPhInfoService/getLunPhInfo)
 * - 기상청 단기예보 조회서비스 (VilageFcstInfoService_2.0/getVilageFcst)
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | 3초 타임아웃 안전 폴백
 * ==============================================================================
 */

const https = require('https');

const cacheStore = {
    moon: { key: '', data: null, ts: 0 },
    weather: { key: '', data: null, ts: 0 }
};

function getDataGoKrKey() {
    const raw = String(process.env.DATA_GO_KR_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!raw || /your_|example|placeholder/i.test(raw)) return '';
    return raw;
}

function encodeServiceKey(key) {
    return key.includes('%') ? key : encodeURIComponent(key);
}

function getKstNowParts() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const y = String(kst.getUTCFullYear());
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    const hh = kst.getUTCHours();
    return { y, m, d, ymd: `${y}${m}${d}`, hh };
}

function httpGetText(url, timeoutMs = 3200) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { family: 4, timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

function mapMoonPhaseLabel(lunAgeNum) {
    const age = Number(lunAgeNum);
    if (!Number.isFinite(age)) return null;
    if (age <= 2 || age >= 28) return { name: '그믐달(새달)', emoji: '🌑', age };
    if (age <= 6) return { name: '초승달', emoji: '🌒', age };
    if (age <= 9) return { name: '상현달', emoji: '🌓', age };
    if (age <= 13) return { name: '차오르는 달', emoji: '🌔', age };
    if (age <= 16) return { name: '보름달', emoji: '🌕', age };
    if (age <= 21) return { name: '기우는 달', emoji: '🌖', age };
    return { name: '하현달', emoji: '🌗', age };
}

async function fetchTodayMoonPhase() {
    const key = getDataGoKrKey();
    if (!key) return null;

    const { y, m, d, ymd } = getKstNowParts();
    if (cacheStore.moon.key === ymd && cacheStore.moon.data && Date.now() - cacheStore.moon.ts < 6 * 3600 * 1000) {
        return cacheStore.moon.data;
    }

    try {
        const url = `https://apis.data.go.kr/B090041/openapi/service/LunPhInfoService/getLunPhInfo?serviceKey=${encodeServiceKey(key)}&solYear=${y}&solMonth=${m}&solDay=${d}&_type=json`;
        const res = await httpGetText(url);
        if (res.status !== 200) return null;

        let lunAge = null;
        if (res.body.trim().startsWith('{')) {
            const parsed = JSON.parse(res.body);
            const item = parsed?.response?.body?.items?.item;
            const first = Array.isArray(item) ? item[0] : item;
            lunAge = first?.lunAge ?? null;
        } else {
            const match = res.body.match(/<lunAge>([^<]+)<\/lunAge>/);
            lunAge = match ? match[1] : null;
        }
        const info = mapMoonPhaseLabel(lunAge);
        if (info) {
            cacheStore.moon = { key: ymd, data: info, ts: Date.now() };
        }
        return info;
    } catch (_) {
        return null;
    }
}

function pickKmaBaseDateTime() {
    const { ymd, hh } = getKstNowParts();
    const slots = [23, 20, 17, 14, 11, 8, 5, 2];
    const picked = slots.find((s) => hh >= s + 1);
    if (picked !== undefined) {
        return { baseDate: ymd, baseTime: `${String(picked).padStart(2, '0')}00` };
    }
    const prev = new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000);
    const py = String(prev.getUTCFullYear());
    const pm = String(prev.getUTCMonth() + 1).padStart(2, '0');
    const pd = String(prev.getUTCDate()).padStart(2, '0');
    return { baseDate: `${py}${pm}${pd}`, baseTime: '2300' };
}

async function fetchTodayWeatherSummary() {
    const key = getDataGoKrKey();
    if (!key) return null;

    const { baseDate, baseTime } = pickKmaBaseDateTime();
    const cacheKey = `${baseDate}:${baseTime}`;
    if (cacheStore.weather.key === cacheKey && cacheStore.weather.data && Date.now() - cacheStore.weather.ts < 3600 * 1000) {
        return cacheStore.weather.data;
    }

    try {
        const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${encodeServiceKey(key)}&pageNo=1&numOfRows=40&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=60&ny=127`;
        const res = await httpGetText(url);
        if (res.status !== 200 || !res.body.trim().startsWith('{')) return null;

        const parsed = JSON.parse(res.body);
        const items = parsed?.response?.body?.items?.item;
        if (!Array.isArray(items) || !items.length) return null;

        const findCat = (cat) => items.find((it) => it.category === cat)?.fcstValue;
        const tmp = findCat('TMP');
        const sky = String(findCat('SKY') || '1');
        const pty = String(findCat('PTY') || '0');

        let label = '맑아요';
        let emoji = '☀️';
        if (pty === '1' || pty === '4') { label = '비가 와요'; emoji = '☔'; }
        else if (pty === '2') { label = '비와 눈이 내려요'; emoji = '🌨️'; }
        else if (pty === '3') { label = '눈이 내려요'; emoji = '⛄'; }
        else if (sky === '3') { label = '구름이 많아요'; emoji = '⛅'; }
        else if (sky === '4') { label = '흐려요'; emoji = '☁️'; }

        const summary = {
            temp: tmp !== undefined ? Number(tmp) : null,
            label,
            emoji,
            text: `${emoji} ${label}${tmp !== undefined ? ` (${tmp}°C)` : ''}`
        };
        cacheStore.weather = { key: cacheKey, data: summary, ts: Date.now() };
        return summary;
    } catch (_) {
        return null;
    }
}

async function getTodayScienceContext() {
    const [moon, weather] = await Promise.all([
        fetchTodayMoonPhase().catch(() => null),
        fetchTodayWeatherSummary().catch(() => null)
    ]);
    const parts = [];
    if (moon) parts.push(`오늘의 달 모양: ${moon.emoji} ${moon.name}`);
    if (weather) parts.push(`오늘의 날씨: ${weather.text}`);
    return { moon, weather, summaryText: parts.join(' / ') };
}

async function testDataGoKrProviders() {
    const started = Date.now();
    const key = getDataGoKrKey();
    if (!key) {
        return { ok: false, provider: 'datagokr', elapsedMs: 0, message: 'DATA_GO_KR_API_KEY가 설정되지 않았습니다.' };
    }
    const { moon, weather, summaryText } = await getTodayScienceContext();
    const elapsedMs = Date.now() - started;
    if (moon || weather) {
        return {
            ok: true,
            provider: 'datagokr',
            elapsedMs,
            message: `공공데이터포털 연결 성공 — ${summaryText}`
        };
    }
    return {
        ok: false,
        provider: 'datagokr',
        elapsedMs,
        message: '천문/기상 API 응답이 없습니다. 활용신청 승인 상태 또는 인증키(Encoding/Decoding)를 확인해 주세요.'
    };
}

module.exports = {
    fetchTodayMoonPhase,
    fetchTodayWeatherSummary,
    getTodayScienceContext,
    testDataGoKrProviders
};
