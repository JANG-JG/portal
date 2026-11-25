/**
 * ==============================================================================
 * 유아 학습지 무료 리치 미디어 API 연동 & SQLite 캐시 서비스
 * (studyRichMediaApi.service.js)
 * ------------------------------------------------------------------------------
 * - ARASAAC 유아 교육 픽토그램 API (한글/영어 낱말 직관적 일러스트, 키 불필요)
 * - Free Dictionary API (영어 원어민 발음 MP3 및 발음기호, 키 불필요)
 * - SQLite 영구 캐시 + IPv4 강제 + 타임아웃 시 기존 이모지/TTS로 100% 무중단 폴백
 * ==============================================================================
 */

const https = require('https');
const { dbGet, dbRun, getSystemConfig } = require('./studyDb.service');

const ipv4Agent = new https.Agent({ family: 4 });
let tableReadyPromise = null;

function ensureRichMediaTable() {
    if (tableReadyPromise) return tableReadyPromise;
    tableReadyPromise = dbRun(`
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
        tableReadyPromise = null;
        throw err;
    });
    return tableReadyPromise;
}

function getJsonIPv4(urlStr, timeoutMs = 3500) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            urlStr,
            {
                agent: ipv4Agent,
                timeout: timeoutMs,
                headers: { 'User-Agent': 'JG-Study-Portal/1.0' }
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 500, body: raw }));
            }
        );
        req.on('timeout', () => req.destroy(new Error('RICH_MEDIA_TIMEOUT')));
        req.on('error', reject);
    });
}

async function fetchArasaacPictogram(word, lang = 'ko') {
    const clean = String(word || '').trim();
    if (!clean) return null;
    const safeLang = lang === 'en' ? 'en' : 'ko';
    const cacheKey = `arasaac:${safeLang}:${clean.toLowerCase()}`;

    await ensureRichMediaTable();
    const cached = await dbGet('SELECT image_url FROM study_rich_media_cache WHERE cache_key = ?', [cacheKey]).catch(() => null);
    if (cached) {
        return cached.image_url || null;
    }

    try {
        const url = `https://api.arasaac.org/v1/pictograms/${safeLang}/search/${encodeURIComponent(clean)}`;
        const res = await getJsonIPv4(url, 3200);
        if (res.status !== 200) {
            await dbRun(
                'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, image_url) VALUES (?, ?, ?, ?)',
                [cacheKey, 'arasaac', clean, '']
            ).catch(() => {});
            return null;
        }
        const arr = JSON.parse(res.body);
        const first = Array.isArray(arr) ? arr.find((item) => item && Number(item._id) > 0 && !item.violence && !item.sex) : null;
        const imageUrl = first ? `https://static.arasaac.org/pictograms/${first._id}/${first._id}_500.png` : '';
        await dbRun(
            'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, image_url) VALUES (?, ?, ?, ?)',
            [cacheKey, 'arasaac', clean, imageUrl]
        ).catch(() => {});
        return imageUrl || null;
    } catch (_) {
        return null;
    }
}

async function fetchFreeDictionaryAudio(word) {
    const clean = String(word || '').trim().toLowerCase();
    if (!/^[a-z]{2,20}$/.test(clean)) return null;
    const cacheKey = `freedict:en:${clean}`;

    await ensureRichMediaTable();
    const cached = await dbGet('SELECT audio_url, phonetic FROM study_rich_media_cache WHERE cache_key = ?', [cacheKey]).catch(() => null);
    if (cached) {
        return cached.audio_url ? { audioUrl: cached.audio_url, phonetic: cached.phonetic || '' } : null;
    }

    try {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`;
        const res = await getJsonIPv4(url, 3200);
        if (res.status !== 200) {
            await dbRun(
                'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, audio_url, phonetic) VALUES (?, ?, ?, ?, ?)',
                [cacheKey, 'freedict', clean, '', '']
            ).catch(() => {});
            return null;
        }
        const entries = JSON.parse(res.body);
        const firstEntry = Array.isArray(entries) ? entries[0] : null;
        const phonetics = Array.isArray(firstEntry?.phonetics) ? firstEntry.phonetics : [];
        const withAudio = phonetics.find((p) => p && typeof p.audio === 'string' && p.audio.startsWith('https://'))
            || phonetics.find((p) => p && typeof p.audio === 'string' && p.audio.startsWith('//'));
        let audioUrl = withAudio ? withAudio.audio : '';
        if (audioUrl.startsWith('//')) audioUrl = `https:${audioUrl}`;
        const phonetic = String(firstEntry?.phonetic || withAudio?.text || '').slice(0, 40);

        await dbRun(
            'INSERT OR REPLACE INTO study_rich_media_cache (cache_key, provider, word, audio_url, phonetic) VALUES (?, ?, ?, ?, ?)',
            [cacheKey, 'freedict', clean, audioUrl, phonetic]
        ).catch(() => {});
        return audioUrl ? { audioUrl, phonetic } : null;
    } catch (_) {
        return null;
    }
}

async function enrichWorksheetMedia(sheet, subject) {
    if (!sheet || !Array.isArray(sheet.blocks)) return sheet;
    if (subject !== 'korean' && subject !== 'english') return sheet;

    const [arasaacOn, freedictOn] = await Promise.all([
        getSystemConfig('study_arasaac_enabled', '1'),
        getSystemConfig('study_freedict_enabled', '1')
    ]);
    const useArasaac = arasaacOn !== '0';
    const useFreedict = subject === 'english' && freedictOn !== '0';
    if (!useArasaac && !useFreedict) return sheet;

    const lang = subject === 'english' ? 'en' : 'ko';
    const tasks = [];

    for (const blk of sheet.blocks) {
        if (!blk) continue;
        if (blk.type === 'quiz' && blk.answer) {
            const word = String(blk.answer).trim();
            if (useArasaac && !blk.imageUrl) {
                tasks.push(
                    fetchArasaacPictogram(word, lang).then((url) => {
                        if (url) blk.imageUrl = url;
                    })
                );
            }
            if (useFreedict && !blk.audioUrl) {
                tasks.push(
                    fetchFreeDictionaryAudio(word).then((info) => {
                        if (info?.audioUrl) blk.audioUrl = info.audioUrl;
                    })
                );
            }
        } else if (blk.type === 'trace' && blk.targetWord) {
            const word = String(blk.targetWord).trim();
            if (useFreedict && !blk.audioUrl) {
                tasks.push(
                    fetchFreeDictionaryAudio(word).then((info) => {
                        if (info?.audioUrl) blk.audioUrl = info.audioUrl;
                    })
                );
            }
        } else if (blk.type === 'match' && Array.isArray(blk.pairs) && useArasaac) {
            for (const p of blk.pairs) {
                if (p && p.right && !p.imageUrl) {
                    tasks.push(
                        fetchArasaacPictogram(String(p.right).trim(), lang).then((url) => {
                            if (url) p.imageUrl = url;
                        })
                    );
                }
            }
        }
    }

    if (tasks.length) {
        await Promise.race([
            Promise.allSettled(tasks),
            new Promise((resolve) => setTimeout(resolve, 4000))
        ]);
    }
    return sheet;
}

async function testRichMediaProvider({ provider = 'arasaac', query = '' } = {}) {
    const started = Date.now();
    if (provider === 'freedict') {
        const word = String(query || 'apple').trim() || 'apple';
        const info = await fetchFreeDictionaryAudio(word);
        const elapsedMs = Date.now() - started;
        return info?.audioUrl
            ? { ok: true, provider, elapsedMs, message: `원어민 발음 오디오 연결 성공 (${word})`, sample: info }
            : { ok: false, provider, elapsedMs, message: `"${word}" 발음 데이터를 찾지 못했습니다.` };
    }
    const word = String(query || '사과').trim() || '사과';
    const imageUrl = await fetchArasaacPictogram(word, /^[A-Za-z]+$/.test(word) ? 'en' : 'ko');
    const elapsedMs = Date.now() - started;
    return imageUrl
        ? { ok: true, provider: 'arasaac', elapsedMs, message: `유아 픽토그램 일러스트 연결 성공 (${word})`, sample: { imageUrl } }
        : { ok: false, provider: 'arasaac', elapsedMs, message: `"${word}" 픽토그램을 찾지 못했습니다.` };
}

async function getRichMediaStats() {
    await ensureRichMediaTable();
    const row = await dbGet(
        `SELECT
            SUM(CASE WHEN provider = 'arasaac' AND image_url != '' THEN 1 ELSE 0 END) AS arasaacCount,
            SUM(CASE WHEN provider = 'freedict' AND audio_url != '' THEN 1 ELSE 0 END) AS freedictCount
         FROM study_rich_media_cache`
    ).catch(() => null);
    return {
        arasaacCount: Number(row?.arasaacCount || 0),
        freedictCount: Number(row?.freedictCount || 0)
    };
}

module.exports = {
    fetchArasaacPictogram,
    fetchFreeDictionaryAudio,
    enrichWorksheetMedia,
    testRichMediaProvider,
    getRichMediaStats
};
