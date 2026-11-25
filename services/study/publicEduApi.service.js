/**
 * ==============================================================================
 * 공교육·국립국어원(우리말샘/표준국어대사전) Open API 연동 & SQLite 캐시 서비스
 * (publicEduApi.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * [규칙 8] API 키는 런타임 process.env만 참조하며 평문 노출/파일 직접 조회 금지
 * - API 키 미설정/외부 네트워크 장애 시 내장 어휘 뱅크로 100% 무중단 폴백
 * ==============================================================================
 */

const https = require('https');
const { dbGet, dbAll, dbRun, getSystemConfig } = require('./studyDb.service');
const {
    LOCAL_KOREAN_DICT_WORDS,
    splitHangulSyllables
} = require('./curriculumKorea.data');

const ipv4Agent = new https.Agent({ family: 4 });
const BAD_DICT_REGEX = /욕설|비속어|은어|성인|폭력|죽음|살인|도박|마약|음란|북한어|옛말|고어|방언/;
const PLACEHOLDER_REGEX = /^(여기에_|your_|example|test_key)/i;

let tablesPromise = null;

function ensurePublicEduTables() {
    if (tablesPromise) return tablesPromise;
    tablesPromise = (async () => {
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_public_word_cache (
                word TEXT PRIMARY KEY,
                provider TEXT NOT NULL DEFAULT 'local',
                pos TEXT NOT NULL DEFAULT '명사',
                definition TEXT NOT NULL,
                example TEXT DEFAULT '',
                level_hint INTEGER NOT NULL DEFAULT 2,
                hit_count INTEGER NOT NULL DEFAULT 0,
                fetched_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_public_api_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                query_text TEXT NOT NULL,
                status TEXT NOT NULL,
                hit_cache INTEGER NOT NULL DEFAULT 0,
                result_count INTEGER NOT NULL DEFAULT 0,
                error_message TEXT DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )
        `);
        await dbRun('CREATE INDEX IF NOT EXISTS idx_public_api_logs_time ON study_public_api_logs (created_at DESC)').catch(() => {});
    })().catch((err) => {
        tablesPromise = null;
        throw err;
    });
    return tablesPromise;
}

function resolveEnvKey(name) {
    const raw = String(process.env[name] || '').trim().replace(/^["']|["']$/g, '');
    if (!raw || PLACEHOLDER_REGEX.test(raw)) return '';
    return raw;
}

function maskKey(val) {
    if (!val) return '';
    if (val.length <= 6) return '****';
    return `${val.slice(0, 4)}****${val.slice(-2)}`;
}

function getApiProviderStatuses() {
    const urimal = resolveEnvKey('URIMALSAEM_API_KEY');
    const stdt = resolveEnvKey('STDT_DIC_API_KEY');
    const dataGoKr = resolveEnvKey('DATA_GO_KR_API_KEY');
    const gemini = resolveEnvKey('GEMINI_API_KEY');
    return {
        urimalsam: { label: '국립국어원 우리말샘', configured: Boolean(urimal), masked: maskKey(urimal) },
        stdtdic: { label: '국립국어원 표준국어대사전', configured: Boolean(stdt), masked: maskKey(stdt) },
        datagokr: { label: '공공데이터포털(에듀넷/기초학력)', configured: Boolean(dataGoKr), masked: maskKey(dataGoKr) },
        gemini: { label: 'Google Gemini 맞춤 학습지', configured: Boolean(gemini), masked: maskKey(gemini) },
        arasaac: { label: 'ARASAAC 유아 픽토그램', configured: true, masked: '무료·키불필요' },
        freedict: { label: 'Free Dictionary 영단어 발음', configured: true, masked: '무료·키불필요' }
    };
}

function stripDictMarkup(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\^_]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isKidSafeDictEntry(word, definition) {
    const cleanW = String(word || '').replace(/[\-\^0-9]/g, '').trim();
    const cleanD = stripDictMarkup(definition);
    if (!/^[가-힣]{1,10}$/.test(cleanW)) return false;
    if (cleanD.length < 4) return false;
    if (BAD_DICT_REGEX.test(`${cleanW} ${cleanD}`)) return false;
    return true;
}

function getJsonIPv4(urlStr, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        const req = https.get(urlStr, { agent: ipv4Agent, timeout: timeoutMs }, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => resolve({ status: res.statusCode || 500, body: raw }));
        });
        req.on('timeout', () => req.destroy(new Error('PUBLIC_EDU_API_TIMEOUT')));
        req.on('error', reject);
    });
}

async function logPublicApiCall({ provider, queryText, status, hitCache = 0, resultCount = 0, errorMessage = '' }) {
    await ensurePublicEduTables();
    await dbRun(
        `INSERT INTO study_public_api_logs (provider, query_text, status, hit_cache, result_count, error_message)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [provider, String(queryText || '').slice(0, 40), status, hitCache ? 1 : 0, Number(resultCount || 0), String(errorMessage || '').slice(0, 160)]
    ).catch(() => {});
}

const JARGON_CAT_REGEX = /불교|유학|책명|미술|인명|지명|법률|군사|한방|서비스업|역사|철학|고유/;

function parseKoreanDictItems(rawBody, wordQuery, providerName) {
    if (!rawBody || !rawBody.trim()) return null;
    const parsed = JSON.parse(rawBody);
    const items = parsed?.channel?.item;
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    const candidates = [];
    for (const item of list) {
        const cleanWord = stripDictMarkup(item?.word || '').replace(/[\-\^0-9\s]/g, '');
        const senses = Array.isArray(item?.sense) ? item.sense : (item?.sense ? [item.sense] : []);
        const firstSense = senses[0] || item;
        const cat = stripDictMarkup(firstSense?.cat || '');
        const pos = stripDictMarkup(item?.pos || firstSense?.pos || '명사') || '명사';
        const definition = stripDictMarkup(firstSense?.definition || '');
        const example = stripDictMarkup(firstSense?.example || '');
        if (!isKidSafeDictEntry(cleanWord, definition)) continue;
        candidates.push({
            word: cleanWord,
            provider: providerName,
            pos: pos.slice(0, 16),
            definition: definition.slice(0, 110),
            example: example.slice(0, 90),
            isGeneral: !cat || !JARGON_CAT_REGEX.test(cat)
        });
    }
    const exactGeneral = candidates.find((c) => c.word === wordQuery && c.isGeneral);
    const exactAny = candidates.find((c) => c.word === wordQuery);
    const chosen = exactGeneral || exactAny || candidates.find((c) => c.isGeneral) || candidates[0] || null;
    if (!chosen) return null;
    const { isGeneral: _ignored, ...entry } = chosen;
    return entry;
}

async function queryUrimalsaem(wordQuery) {
    const key = resolveEnvKey('URIMALSAEM_API_KEY');
    if (!key) return { ok: false, reason: 'missing_key' };
    const qs = new URLSearchParams({
        key,
        q: wordQuery,
        req_type: 'json',
        method: 'exact',
        num: '10'
    });
    const url = `https://opendict.korean.go.kr/api/search?${qs.toString()}`;
    const res = await getJsonIPv4(url, 7000);
    if (res.status !== 200) {
        return { ok: false, reason: `http_${res.status}` };
    }
    if (/error_code/i.test(res.body) && !res.body.includes('"channel"')) {
        return { ok: false, reason: 'api_error_response' };
    }
    const entry = parseKoreanDictItems(res.body, wordQuery, 'urimalsam');
    if (!entry) return { ok: false, reason: 'no_kid_safe_match' };
    return { ok: true, entry };
}

async function queryStdKoreanDict(wordQuery) {
    const key = resolveEnvKey('STDT_DIC_API_KEY');
    if (!key) return { ok: false, reason: 'missing_key' };
    const qs = new URLSearchParams({
        key,
        q: wordQuery,
        req_type: 'json',
        method: 'exact',
        num: '10'
    });
    const url = `https://stdict.korean.go.kr/api/search.do?${qs.toString()}`;
    const res = await getJsonIPv4(url, 7000);
    if (res.status !== 200) {
        return { ok: false, reason: `http_${res.status}` };
    }
    if (/error_code/i.test(res.body) && !res.body.includes('"channel"')) {
        return { ok: false, reason: 'api_error_response' };
    }
    const entry = parseKoreanDictItems(res.body, wordQuery, 'stdtdic');
    if (!entry) return { ok: false, reason: 'no_kid_safe_match' };
    return { ok: true, entry };
}

function findLocalKoreanWord(wordQuery) {
    const exact = LOCAL_KOREAN_DICT_WORDS.find((w) => w.word === wordQuery);
    if (exact) return { ...exact, provider: 'local' };
    const partial = LOCAL_KOREAN_DICT_WORDS.find((w) => w.word.includes(wordQuery) || wordQuery.includes(w.word));
    return partial ? { ...partial, provider: 'local' } : null;
}

function formatEntryForResponse(entry, { hitCache = false } = {}) {
    return {
        word: entry.word,
        syllables: splitHangulSyllables(entry.word),
        pos: entry.pos || '명사',
        definition: entry.definition,
        example: entry.example || '',
        provider: entry.provider || 'local',
        providerLabel: entry.provider === 'urimalsam'
            ? '우리말샘 사전'
            : (entry.provider === 'stdtdic' ? '표준국어대사전' : '기초학력 추천 낱말'),
        hitCache: Boolean(hitCache)
    };
}

async function upsertWordCache(entry, levelHint = 2) {
    await ensurePublicEduTables();
    await dbRun(
        `INSERT INTO study_public_word_cache (word, provider, pos, definition, example, level_hint, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(word) DO UPDATE SET
           provider = excluded.provider,
           pos = excluded.pos,
           definition = excluded.definition,
           example = excluded.example,
           level_hint = excluded.level_hint,
           fetched_at = datetime('now', 'localtime')`,
        [entry.word, entry.provider, entry.pos || '명사', entry.definition, entry.example || '', Number(levelHint || 2)]
    );
}

async function lookupKoreanWord(rawWord, { level = 2, preferFresh = false, skipPublicApi = false } = {}) {
    await ensurePublicEduTables();
    const cleanWord = String(rawWord || '').trim().replace(/\s+/g, '');
    if (!/^[가-힣]{1,12}$/.test(cleanWord)) {
        return { ok: false, reason: 'invalid_word', message: '찾고 싶은 순수 한글 낱말(1~12글자)을 입력해 주세요.' };
    }

    const publicEnabled = (await getSystemConfig('study_public_dict_enabled', '1')) !== '0';
    if (!preferFresh) {
        const cached = await dbGet('SELECT * FROM study_public_word_cache WHERE word = ?', [cleanWord]);
        if (cached) {
            await dbRun('UPDATE study_public_word_cache SET hit_count = hit_count + 1 WHERE word = ?', [cleanWord]).catch(() => {});
            await logPublicApiCall({ provider: cached.provider, queryText: cleanWord, status: 'ok', hitCache: 1, resultCount: 1 });
            return { ok: true, entry: formatEntryForResponse(cached, { hitCache: true }) };
        }
    }

    if (publicEnabled && !skipPublicApi) {
        const providers = [
            { name: 'urimalsam', fn: queryUrimalsaem },
            { name: 'stdtdic', fn: queryStdKoreanDict }
        ];
        for (const p of providers) {
            try {
                const res = await p.fn(cleanWord);
                if (res.ok && res.entry) {
                    await upsertWordCache(res.entry, level);
                    await logPublicApiCall({ provider: p.name, queryText: cleanWord, status: 'ok', hitCache: 0, resultCount: 1 });
                    return { ok: true, entry: formatEntryForResponse(res.entry, { hitCache: false }) };
                }
                if (res.reason !== 'missing_key') {
                    await logPublicApiCall({ provider: p.name, queryText: cleanWord, status: 'miss', errorMessage: res.reason });
                }
            } catch (err) {
                await logPublicApiCall({ provider: p.name, queryText: cleanWord, status: 'error', errorMessage: err.message });
            }
        }
    }

    const localMatch = findLocalKoreanWord(cleanWord);
    if (localMatch) {
        await logPublicApiCall({ provider: 'local', queryText: cleanWord, status: 'fallback_ok', hitCache: 1, resultCount: 1 });
        return { ok: true, entry: formatEntryForResponse(localMatch, { hitCache: false }) };
    }

    return {
        ok: false,
        reason: 'not_found',
        message: `"${cleanWord}" 낱말을 찾지 못했어요. 사과, 나비, 무지개 같은 쉬운 낱말로 다시 찾아볼까요?`
    };
}

async function pickCuratedKoreanWords({ level = 2, limit = 4 } = {}) {
    await ensurePublicEduTables();
    const lv = Math.min(Math.max(Number(level) || 2, 1), 5);
    const cached = await dbAll(
        'SELECT word, definition FROM study_public_word_cache WHERE level_hint <= ? ORDER BY hit_count DESC, fetched_at DESC LIMIT ?',
        [lv + 1, limit]
    ).catch(() => []);
    const merged = [...cached];
    for (const local of LOCAL_KOREAN_DICT_WORDS) {
        if (merged.length >= limit) break;
        if (local.level <= lv + 1 && !merged.some((m) => m.word === local.word)) {
            merged.push({ word: local.word, definition: local.definition });
        }
    }
    return merged.slice(0, limit);
}

async function testPublicEduProvider({ provider = 'urimalsam', query = '사과' } = {}) {
    await ensurePublicEduTables();
    const cleanQuery = String(query || '사과').trim() || '사과';
    const started = Date.now();
    try {
        let res;
        if (provider === 'stdtdic') res = await queryStdKoreanDict(cleanQuery);
        else res = await queryUrimalsaem(cleanQuery);
        const elapsedMs = Date.now() - started;
        if (!res.ok) {
            await logPublicApiCall({ provider, queryText: cleanQuery, status: res.reason === 'missing_key' ? 'unconfigured' : 'error', errorMessage: res.reason });
            return {
                ok: false,
                provider,
                elapsedMs,
                reason: res.reason,
                message: res.reason === 'missing_key' ? '환경변수(.env)에 해당 Open API 키가 아직 등록되지 않았습니다.' : `조회 실패 (${res.reason})`
            };
        }
        await upsertWordCache(res.entry, 2);
        await logPublicApiCall({ provider, queryText: cleanQuery, status: 'test_ok', resultCount: 1 });
        return { ok: true, provider, elapsedMs, entry: formatEntryForResponse(res.entry) };
    } catch (err) {
        const elapsedMs = Date.now() - started;
        await logPublicApiCall({ provider, queryText: cleanQuery, status: 'error', errorMessage: err.message });
        return { ok: false, provider, elapsedMs, reason: 'exception', message: `연결 오류: ${err.message}` };
    }
}

async function getPublicEduOverview() {
    await ensurePublicEduTables();
    const [cacheStats, logs, sampleWords] = await Promise.all([
        dbGet('SELECT COUNT(*) AS count, COALESCE(SUM(hit_count), 0) AS hits FROM study_public_word_cache'),
        dbAll('SELECT id, provider, query_text, status, hit_cache, result_count, error_message, created_at FROM study_public_api_logs ORDER BY id DESC LIMIT 20'),
        dbAll('SELECT word, provider, pos, definition, hit_count FROM study_public_word_cache ORDER BY hit_count DESC, fetched_at DESC LIMIT 8')
    ]);
    return {
        providers: getApiProviderStatuses(),
        cache: {
            wordCount: Number(cacheStats?.count || 0),
            totalHits: Number(cacheStats?.hits || 0),
            localBankCount: LOCAL_KOREAN_DICT_WORDS.length
        },
        recentLogs: logs || [],
        sampleWords: sampleWords || []
    };
}

module.exports = {
    ensurePublicEduTables,
    getApiProviderStatuses,
    lookupKoreanWord,
    pickCuratedKoreanWords,
    testPublicEduProvider,
    getPublicEduOverview,
    parseKoreanDictItems,
    isKidSafeDictEntry
};
