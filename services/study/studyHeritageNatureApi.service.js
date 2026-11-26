/**
 * ==============================================================================
 * 국가유산청 · iNaturalist · NASA · 위키백과 공신력 실사/지식 API 연동 서비스
 * (studyHeritageNatureApi.service.js)
 * ------------------------------------------------------------------------------
 * - 국가유산청 국가유산포털 Open API (키 불필요, 국보·보물·사적 정보 & 실사)
 * - iNaturalist 한국어 자연생물 도감 API (키 불필요, 동식물 실사 사진)
 * - NASA Images API (키 불필요, 달·행성·우주 실사 사진)
 * - 한국어 위키백과 REST API (백과사전 요약 및 썸네일)
 * - SQLite 영구 캐시 + IPv4 강제 + 3.5초 타임아웃 안전 폴백
 * ==============================================================================
 */

const https = require('https');
const { dbGet, dbRun } = require('./studyDb.service');

const ipv4Agent = new https.Agent({ family: 4 });
let cacheReadyPromise = null;

function ensureCacheTable() {
    if (cacheReadyPromise) return cacheReadyPromise;
    cacheReadyPromise = dbRun(`
        CREATE TABLE IF NOT EXISTS study_rich_media_cache (
            cache_key TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            word TEXT NOT NULL,
            image_url TEXT DEFAULT '',
            audio_url TEXT DEFAULT '',
            phonetic TEXT DEFAULT '',
            fetched_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `).catch((err) => {
        cacheReadyPromise = null;
        throw err;
    });
    return cacheReadyPromise;
}

function httpGetRawIPv4(urlStr, timeoutMs = 3500, redirectsLeft = 2) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            urlStr,
            {
                agent: ipv4Agent,
                timeout: timeoutMs,
                headers: { 'User-Agent': 'JG-Study-Portal/1.0 (https://j-jg.cc)' }
            },
            (res) => {
                const status = res.statusCode || 500;
                if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
                    res.resume();
                    const nextUrl = new URL(res.headers.location, urlStr).toString();
                    if (!nextUrl.startsWith('https://')) return resolve({ status, body: '' });
                    return httpGetRawIPv4(nextUrl, timeoutMs, redirectsLeft - 1).then(resolve).catch(reject);
                }
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => resolve({ status, body: raw }));
            }
        );
        req.on('timeout', () => req.destroy(new Error('HERITAGE_NATURE_TIMEOUT')));
        req.on('error', reject);
    });
}

function extractXmlTag(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

async function fetchWikipediaPhotoAndSummary(keyword) {
    const clean = String(keyword || '').trim();
    if (!clean || clean.length > 24) return null;
    const cacheKey = `wiki_photo:ko:${clean.toLowerCase()}`;
    await ensureCacheTable();
    const cached = await dbGet('SELECT image_url, phonetic FROM study_rich_media_cache WHERE cache_key = ?', [cacheKey]).catch(() => null);
    if (cached) {
        return cached.image_url ? { imageUrl: cached.image_url, summary: cached.phonetic || '' } : null;
    }

    try {
        const url = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`;
        const res = await httpGetRawIPv4(url, 3200);
        const data = res.status === 200 && res.body.trim().startsWith('{') ? JSON.parse(res.body) : null;
        const thumb = data && data.type === 'standard' && data.thumbnail?.source ? String(data.thumbnail.source) : '';
        const summary = data?.extract ? String(data.extract).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
        await dbRun(
            'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, image_url, phonetic) VALUES (?, ?, ?, ?, ?)',
            [cacheKey, 'wiki_photo', clean, thumb, summary]
        ).catch(() => {});
        return thumb ? { imageUrl: thumb, summary } : null;
    } catch (_) {
        return null;
    }
}

async function fetchInaturalistPhoto(keyword) {
    const clean = String(keyword || '').trim();
    if (!clean || clean.length > 24) return null;
    const cacheKey = `inat:ko:${clean.toLowerCase()}`;
    await ensureCacheTable();
    const cached = await dbGet('SELECT image_url, phonetic FROM study_rich_media_cache WHERE cache_key = ?', [cacheKey]).catch(() => null);
    if (cached) {
        return cached.image_url ? { imageUrl: cached.image_url, commonName: cached.phonetic || clean } : null;
    }

    try {
        const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(clean)}&locale=ko&per_page=5`;
        const res = await httpGetRawIPv4(url, 3500);
        if (res.status !== 200 || !res.body.trim().startsWith('{')) return null;
        const parsed = JSON.parse(res.body);
        const results = Array.isArray(parsed?.results) ? parsed.results : [];
        const picked = results.find((r) => r?.default_photo?.medium_url) || null;
        const imageUrl = picked?.default_photo?.medium_url ? String(picked.default_photo.medium_url) : '';
        const commonName = String(picked?.preferred_common_name || picked?.name || clean).slice(0, 40);
        await dbRun(
            'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, image_url, phonetic) VALUES (?, ?, ?, ?, ?)',
            [cacheKey, 'inaturalist', clean, imageUrl, commonName]
        ).catch(() => {});
        return imageUrl ? { imageUrl, commonName } : null;
    } catch (_) {
        return null;
    }
}

const NASA_KEYWORD_MAP = {
    달: 'full moon',
    보름달: 'full moon',
    초승달: 'crescent moon',
    상현달: 'first quarter moon',
    하현달: 'last quarter moon',
    그믐달: 'new moon',
    태양: 'sun solar',
    해: 'sun solar',
    지구: 'planet earth from space',
    화성: 'mars planet',
    토성: 'saturn rings',
    목성: 'jupiter planet',
    우주: 'milky way galaxy',
    별: 'stars nebula',
    은하수: 'milky way',
    로켓: 'space rocket launch'
};

async function fetchNasaSpacePhoto(keyword) {
    const clean = String(keyword || '').trim();
    if (!clean) return null;
    const engQuery = NASA_KEYWORD_MAP[clean] || (/^[A-Za-z\s]+$/.test(clean) ? clean : '');
    if (!engQuery) return null;

    const cacheKey = `nasa:img:${engQuery.toLowerCase()}`;
    await ensureCacheTable();
    const cached = await dbGet('SELECT image_url, phonetic FROM study_rich_media_cache WHERE cache_key = ?', [cacheKey]).catch(() => null);
    if (cached) {
        return cached.image_url ? { imageUrl: cached.image_url, title: cached.phonetic || clean } : null;
    }

    try {
        const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(engQuery)}&media_type=image&page_size=5`;
        const res = await httpGetRawIPv4(url, 3500);
        if (res.status !== 200 || !res.body.trim().startsWith('{')) return null;
        const parsed = JSON.parse(res.body);
        const items = Array.isArray(parsed?.collection?.items) ? parsed.collection.items : [];
        const withThumb = items.find((it) => Array.isArray(it?.links) && it.links[0]?.href);
        const imageUrl = withThumb?.links?.[0]?.href ? String(withThumb.links[0].href) : '';
        const title = String(withThumb?.data?.[0]?.title || clean).slice(0, 60);
        await dbRun(
            'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, image_url, phonetic) VALUES (?, ?, ?, ?, ?)',
            [cacheKey, 'nasa', clean, imageUrl, title]
        ).catch(() => {});
        return imageUrl ? { imageUrl, title } : null;
    } catch (_) {
        return null;
    }
}

async function fetchKoreaHeritageInfo(keyword) {
    const clean = String(keyword || '').trim();
    if (!clean || clean.length > 24) return null;
    const cacheKey = `khs:ko:${clean.toLowerCase()}`;
    await ensureCacheTable();
    const cached = await dbGet('SELECT image_url, phonetic FROM study_rich_media_cache WHERE cache_key = ?', [cacheKey]).catch(() => null);
    if (cached && cached.image_url) {
        return { imageUrl: cached.image_url, title: cached.phonetic || clean, provider: '국가유산청' };
    }

    try {
        const listUrl = `https://www.khs.go.kr/cha/SearchKindOpenapiList.do?ccbaMnm1=${encodeURIComponent(clean)}&pageUnit=3&pageIndex=1`;
        const res = await httpGetRawIPv4(listUrl, 3600);
        if (res.status === 200 && res.body.includes('<item>')) {
            const firstItem = res.body.split('<item>')[1]?.split('</item>')[0] || '';
            const kdcd = extractXmlTag(firstItem, 'ccbaKdcd');
            const asno = extractXmlTag(firstItem, 'ccbaAsno');
            const ctcd = extractXmlTag(firstItem, 'ccbaCtcd');
            const name = extractXmlTag(firstItem, 'ccbaMnm1') || clean;
            const kind = extractXmlTag(firstItem, 'ccmaName');
            let imageUrl = '';
            if (kdcd && asno && ctcd) {
                const dtUrl = `https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=${encodeURIComponent(kdcd)}&ccbaAsno=${encodeURIComponent(asno)}&ccbaCtcd=${encodeURIComponent(ctcd)}`;
                const dtRes = await httpGetRawIPv4(dtUrl, 3500).catch(() => null);
                if (dtRes?.status === 200) {
                    const rawImg = extractXmlTag(dtRes.body, 'imageUrl');
                    if (rawImg && rawImg.startsWith('http')) {
                        imageUrl = rawImg.replace(/^http:\/\//i, 'https://');
                    }
                }
            }
            if (imageUrl) {
                const label = kind ? `${kind} · ${name}` : name;
                await dbRun(
                    'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, image_url, phonetic) VALUES (?, ?, ?, ?, ?)',
                    [cacheKey, 'khs', clean, imageUrl, label.slice(0, 60)]
                ).catch(() => {});
                return { imageUrl, title: label, provider: '국가유산청' };
            }
        }
    } catch (_) {}

    const wiki = await fetchWikipediaPhotoAndSummary(clean);
    if (wiki?.imageUrl) {
        return { imageUrl: wiki.imageUrl, title: clean, summary: wiki.summary, provider: '위키백과' };
    }
    return null;
}

const HERITAGE_PRESETS = {
    훈민정음: { keyword: '훈민정음', fact: '세종대왕이 백성을 위해 만든 우리나라 글자 한글이에요.' },
    거북선: { keyword: '거북선', fact: '이순신 장군이 바다를 지킬 때 활약한 튼튼한 배예요.' },
    첨성대: { keyword: '첨성대', fact: '신라 시대에 밤하늘의 별과 달을 관찰하던 돌 탑이에요.' },
    불국사: { keyword: '불국사', fact: '경주에 있는 오랜 역사의 아름다운 절과 석가탑·다보탑이에요.' },
    금관: { keyword: '금관', fact: '신라의 왕이 쓰던 반짝이는 황금빛 왕관이에요.' },
    한복: { keyword: '한복', fact: '명절이나 특별한 날 입는 아름답고 편안한 우리 전통 옷이에요.' },
    윷놀이: { keyword: '윷놀이', fact: '네 개의 나무 막대를 던져 말을 움직이는 즐거운 전통 놀이예요.' },
    고인돌: { keyword: '고인돌', fact: '아주 먼 옛날 사람들이 큰 돌을 올려 만든 무덤이에요.' }
};

async function getHeritageContextForTheme(theme = '') {
    const clean = String(theme || '').trim();
    const matchedKeys = Object.keys(HERITAGE_PRESETS).filter((k) => clean.includes(k));
    const targetKeys = matchedKeys.length ? matchedKeys : ['첨성대', '훈민정음', '거북선', '한복'].slice(0, 2);
    const results = [];
    for (const key of targetKeys.slice(0, 2)) {
        const info = await fetchKoreaHeritageInfo(HERITAGE_PRESETS[key].keyword).catch(() => null);
        results.push({
            keyword: key,
            fact: HERITAGE_PRESETS[key].fact,
            imageUrl: info?.imageUrl || '',
            provider: info?.provider || '역사도감'
        });
    }
    return results;
}

async function testHeritageOrNatureProvider(provider = 'khs', query = '') {
    const started = Date.now();
    if (provider === 'khs') {
        const q = String(query || '첨성대').trim() || '첨성대';
        const info = await fetchKoreaHeritageInfo(q);
        const elapsedMs = Date.now() - started;
        return info?.imageUrl
            ? { ok: true, provider, elapsedMs, message: `${info.provider} 문화유산 연결 성공 (${info.title})`, sample: info }
            : { ok: false, provider, elapsedMs, message: `"${q}" 문화유산 정보를 찾지 못했습니다.` };
    }
    if (provider === 'inaturalist') {
        const q = String(query || '다람쥐').trim() || '다람쥐';
        const info = await fetchInaturalistPhoto(q);
        const elapsedMs = Date.now() - started;
        return info?.imageUrl
            ? { ok: true, provider, elapsedMs, message: `iNaturalist 생물 도감 연결 성공 (${info.commonName})`, sample: info }
            : { ok: false, provider, elapsedMs, message: `"${q}" 생물 실사를 찾지 못했습니다.` };
    }
    if (provider === 'nasa') {
        const q = String(query || '보름달').trim() || '보름달';
        const info = await fetchNasaSpacePhoto(q);
        const elapsedMs = Date.now() - started;
        return info?.imageUrl
            ? { ok: true, provider, elapsedMs, message: `NASA 우주 이미지 연결 성공 (${info.title})`, sample: info }
            : { ok: false, provider, elapsedMs, message: `"${q}" 우주 이미지를 찾지 못했습니다.` };
    }
    return { ok: false, provider, elapsedMs: Date.now() - started, message: '지원하지 않는 공급자입니다.' };
}

module.exports = {
    fetchWikipediaPhotoAndSummary,
    fetchInaturalistPhoto,
    fetchNasaSpacePhoto,
    fetchKoreaHeritageInfo,
    getHeritageContextForTheme,
    testHeritageOrNatureProvider
};
