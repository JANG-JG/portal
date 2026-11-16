/**
 * ==============================================================================
 * 포켓몬 API 응답(일러스트·색칠 SVG·종 정보) SQLite 영구 캐시 서비스
 * (studyPokemonCache.service.js)
 * ------------------------------------------------------------------------------
 * - PokéAPI에서 1회 받아온 데이터를 portal.db(study_pokemon_cache)에 영구 보관
 * - 배포(rsync) 시 public/img/pokemon 파일이 정리되어도 DB에서 즉시 복구 가능
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');

let cacheTableReady = false;

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

async function ensureCacheTable() {
    if (cacheTableReady) return;
    await dbRun(`
        CREATE TABLE IF NOT EXISTS study_pokemon_cache (
            cache_key TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            payload BLOB NOT NULL,
            source_url TEXT DEFAULT '',
            updated_ms INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);
    cacheTableReady = true;
}

async function getPokemonCacheEntry(cacheKey, maxAgeMs = 0) {
    try {
        await ensureCacheTable();
        const row = await dbGet(
            'SELECT content_type, payload, updated_ms FROM study_pokemon_cache WHERE cache_key = ?',
            [String(cacheKey)]
        );
        if (!row || !row.payload) return null;
        if (maxAgeMs > 0 && row.updated_ms > 0 && (Date.now() - Number(row.updated_ms)) >= maxAgeMs) {
            return null;
        }
        return {
            contentType: row.content_type || 'application/octet-stream',
            buffer: Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload)
        };
    } catch (_) {
        return null;
    }
}

async function setPokemonCacheEntry(cacheKey, contentType, payload, sourceUrl = '') {
    try {
        await ensureCacheTable();
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
        await dbRun(
            `INSERT INTO study_pokemon_cache (cache_key, content_type, payload, source_url, updated_ms, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
             ON CONFLICT(cache_key) DO UPDATE SET
                content_type = excluded.content_type,
                payload = excluded.payload,
                source_url = excluded.source_url,
                updated_ms = excluded.updated_ms,
                updated_at = datetime('now', 'localtime')`,
            [String(cacheKey), String(contentType || 'application/octet-stream'), buf, String(sourceUrl || ''), Date.now()]
        );
    } catch (_) {}
}

async function getPokemonCacheStats() {
    try {
        await ensureCacheTable();
        const row = await dbGet(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN cache_key LIKE 'species:%' THEN 1 ELSE 0 END) AS speciesCount,
                SUM(CASE WHEN cache_key LIKE 'coloring_svg:%' THEN 1 ELSE 0 END) AS coloringSvgCount,
                SUM(CASE WHEN cache_key LIKE 'sprite:artwork:%' THEN 1 ELSE 0 END) AS artworkCount,
                SUM(CASE WHEN cache_key LIKE 'sprite:animated:%' THEN 1 ELSE 0 END) AS animatedCount
            FROM study_pokemon_cache
        `);
        return {
            total: Number(row?.total || 0),
            speciesCount: Number(row?.speciesCount || 0),
            coloringSvgCount: Number(row?.coloringSvgCount || 0),
            artworkCount: Number(row?.artworkCount || 0),
            animatedCount: Number(row?.animatedCount || 0)
        };
    } catch (_) {
        return { total: 0, speciesCount: 0, coloringSvgCount: 0, artworkCount: 0, animatedCount: 0 };
    }
}

module.exports = {
    getPokemonCacheEntry,
    setPokemonCacheEntry,
    getPokemonCacheStats
};
