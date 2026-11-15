/**
 * ==============================================================================
 * 어린이 학습실 알 부화 & 포켓몬 도감 서비스 (studyPokemon.service.js)
 * ------------------------------------------------------------------------------
 * - 10칸 칭찬 도장판(cycleNo)과 1:1 연동되는 알 부화 & 포켓몬 도감 수집 시스템
 * - PokéAPI 공식 스프라이트(움직이는 Showdown GIF + 공식 아트워크) 서버 로컬 디스크 캐싱
 * - 외부 네트워크 장애 시에도 100% 무장애 동작하는 자체 SVG 폴백 내장
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { portalDb } = require('../db');
const {
    POKEMON_CATALOG,
    getPokemonById,
    listEnrichedCatalog,
    pickEggPokemonId
} = require('./pokemonCatalog.data');

const SPRITE_CACHE_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'pokemon');
const ipv4Agent = new https.Agent({ family: 4 });
let tablesReady = false;

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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

async function ensurePokemonTables() {
    if (tablesReady) return;
    await dbRun(`
        CREATE TABLE IF NOT EXISTS study_pokemon_eggs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            child_id TEXT NOT NULL,
            cycle_no INTEGER NOT NULL DEFAULT 1,
            target_pokemon_id INTEGER NOT NULL,
            current_steps INTEGER NOT NULL DEFAULT 0,
            required_steps INTEGER NOT NULL DEFAULT 10,
            hatched INTEGER NOT NULL DEFAULT 0,
            hatch_acknowledged INTEGER NOT NULL DEFAULT 0,
            hatched_at DATETIME,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            UNIQUE (child_id, cycle_no)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS study_pokemon_pokedex (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            child_id TEXT NOT NULL,
            pokemon_id INTEGER NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            is_partner INTEGER NOT NULL DEFAULT 0,
            first_hatched_at DATETIME DEFAULT (datetime('now', 'localtime')),
            last_hatched_at DATETIME DEFAULT (datetime('now', 'localtime')),
            UNIQUE (child_id, pokemon_id)
        )
    `);
    tablesReady = true;
}

async function isPokemonFeatureEnabled() {
    try {
        const row = await dbGet("SELECT value FROM system_configs WHERE key = 'study_pokemon_enabled'");
        if (!row || row.value === null || row.value === undefined) return true;
        return String(row.value) !== '0';
    } catch (_) {
        return true;
    }
}

async function setPokemonFeatureEnabled(enabled) {
    const val = enabled ? '1' : '0';
    await dbRun(
        `INSERT INTO system_configs (key, value) VALUES ('study_pokemon_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [val]
    );
    return enabled;
}

function computeEggStage(steps, hatched) {
    if (hatched || steps >= 10) {
        return { stage: 4, stageLabel: '부화 완료! 🎉', statusLine: '짝짝짝! 알에서 새 친구가 태어났어요!' };
    }
    if (steps >= 8) {
        return { stage: 3, stageLabel: '곧 부화해요! ✨', statusLine: `도장 ${10 - steps}칸만 더 모으면 알이 톡! 열려요!` };
    }
    if (steps >= 6) {
        return { stage: 2, stageLabel: '톡톡 금이 가요 ⚡', statusLine: '알 안에서 톡톡 노크 소리가 들려요!' };
    }
    if (steps >= 3) {
        return { stage: 1, stageLabel: '살짝 흔들려요 💫', statusLine: '공부할 때마다 알이 따뜻하게 움직여요!' };
    }
    return { stage: 0, stageLabel: '포근히 잠든 알 🥚', statusLine: '학습지를 풀고 도장을 찍어 알을 깨워 보아요!' };
}

function formatCollectedEntry(row) {
    const meta = getPokemonById(row.pokemon_id);
    return {
        ...meta,
        count: Number(row.count || 1),
        isPartner: Number(row.is_partner || 0) === 1,
        firstHatchedAt: row.first_hatched_at,
        lastHatchedAt: row.last_hatched_at,
        animatedUrl: `/api/study/pokemon/sprite/${meta.id}?kind=animated`,
        artworkUrl: `/api/study/pokemon/sprite/${meta.id}?kind=artwork`
    };
}

async function syncEggProgressWithBoard(childId, board) {
    await ensurePokemonTables();
    const cid = String(childId || 'first').trim() || 'first';
    const cycleNo = Math.max(1, Number(board?.cycleNo || 1));
    const steps = Math.min(10, Math.max(0, Number(board?.earnedCount || 0)));

    let egg = await dbGet(
        'SELECT * FROM study_pokemon_eggs WHERE child_id = ? AND cycle_no = ?',
        [cid, cycleNo]
    );

    if (!egg) {
        const ownedRows = await dbAll('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ?', [cid]);
        const pickedId = pickEggPokemonId(ownedRows.map((r) => r.pokemon_id));
        await dbRun(
            `INSERT OR IGNORE INTO study_pokemon_eggs
             (child_id, cycle_no, target_pokemon_id, current_steps, required_steps, hatched, hatch_acknowledged)
             VALUES (?, ?, ?, ?, 10, 0, 0)`,
            [cid, cycleNo, pickedId, steps]
        );
        egg = await dbGet(
            'SELECT * FROM study_pokemon_eggs WHERE child_id = ? AND cycle_no = ?',
            [cid, cycleNo]
        );
    } else if (Number(egg.current_steps) !== steps && Number(egg.hatched) === 0) {
        await dbRun(
            'UPDATE study_pokemon_eggs SET current_steps = ? WHERE id = ?',
            [steps, egg.id]
        );
        egg.current_steps = steps;
    }

    let newlyHatched = false;
    if (steps >= 10 && Number(egg.hatched) === 0) {
        await dbRun(
            `UPDATE study_pokemon_eggs
             SET current_steps = 10, hatched = 1, hatched_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [egg.id]
        );
        egg.current_steps = 10;
        egg.hatched = 1;
        newlyHatched = true;

        const existingPartner = await dbGet(
            'SELECT id FROM study_pokemon_pokedex WHERE child_id = ? AND is_partner = 1 LIMIT 1',
            [cid]
        );
        const makePartner = existingPartner ? 0 : 1;

        await dbRun(
            `INSERT INTO study_pokemon_pokedex (child_id, pokemon_id, count, is_partner, first_hatched_at, last_hatched_at)
             VALUES (?, ?, 1, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
             ON CONFLICT(child_id, pokemon_id) DO UPDATE SET
                count = count + 1,
                last_hatched_at = datetime('now', 'localtime')`,
            [cid, egg.target_pokemon_id, makePartner]
        );
    }

    return { egg, newlyHatched };
}

async function getPokemonStateForBoard(childId, board) {
    const enabled = await isPokemonFeatureEnabled();
    if (!enabled) {
        return {
            enabled: false,
            activeEgg: null,
            partnerPokemon: null,
            collected: [],
            collectedCount: 0,
            totalCatalogCount: POKEMON_CATALOG.length,
            catalog: []
        };
    }

    const cid = String(childId || 'first').trim() || 'first';
    const { egg } = await syncEggProgressWithBoard(cid, board);
    const targetMeta = getPokemonById(egg.target_pokemon_id);
    const isHatched = Number(egg.hatched) === 1;
    const stageInfo = computeEggStage(Number(egg.current_steps || 0), isHatched);

    const activeEgg = {
        cycleNo: egg.cycle_no,
        steps: Number(egg.current_steps || 0),
        requiredSteps: Number(egg.required_steps || 10),
        hatched: isHatched,
        hatchAcknowledged: Number(egg.hatch_acknowledged || 0) === 1,
        stage: stageInfo.stage,
        stageLabel: stageInfo.stageLabel,
        statusLine: stageInfo.statusLine,
        eggColor: targetMeta.eggColor,
        eggSpot: targetMeta.eggSpot,
        typeHint: `${targetMeta.typeEmoji} ${targetMeta.typeLabel} 기운이 느껴져요!`,
        revealedPokemon: isHatched
            ? {
                ...targetMeta,
                animatedUrl: `/api/study/pokemon/sprite/${targetMeta.id}?kind=animated`,
                artworkUrl: `/api/study/pokemon/sprite/${targetMeta.id}?kind=artwork`
            }
            : null
    };

    const dexRows = await dbAll(
        'SELECT * FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, last_hatched_at DESC',
        [cid]
    );
    const collected = dexRows.map(formatCollectedEntry);
    const collectedMap = new Map(collected.map((c) => [c.id, c]));
    const partnerPokemon = collected.find((c) => c.isPartner) || collected[0] || null;

    const catalog = listEnrichedCatalog().map((item) => {
        const owned = collectedMap.get(item.id);
        return {
            id: item.id,
            nameKo: owned ? item.nameKo : '???',
            typeLabel: item.typeLabel,
            typeEmoji: item.typeEmoji,
            color: item.color,
            bgSoft: item.bgSoft,
            rarity: item.rarity,
            flavorKo: owned ? item.flavorKo : '도장 10칸을 채워 알을 부화시키면 만날 수 있어요!',
            unlocked: Boolean(owned),
            count: owned ? owned.count : 0,
            isPartner: owned ? owned.isPartner : false,
            animatedUrl: owned ? owned.animatedUrl : null,
            artworkUrl: owned ? owned.artworkUrl : null
        };
    });

    return {
        enabled: true,
        activeEgg,
        partnerPokemon,
        collected,
        collectedCount: collected.length,
        totalCatalogCount: POKEMON_CATALOG.length,
        catalog
    };
}

async function acknowledgeEggHatch(childId, cycleNo) {
    await ensurePokemonTables();
    const cid = String(childId || 'first').trim() || 'first';
    const cNo = Math.max(1, Number(cycleNo || 1));
    await dbRun(
        'UPDATE study_pokemon_eggs SET hatch_acknowledged = 1 WHERE child_id = ? AND cycle_no = ? AND hatched = 1',
        [cid, cNo]
    );
    return true;
}

async function setPartnerPokemon(childId, pokemonId) {
    await ensurePokemonTables();
    const cid = String(childId || 'first').trim() || 'first';
    const pid = Number(pokemonId);
    const owned = await dbGet(
        'SELECT id FROM study_pokemon_pokedex WHERE child_id = ? AND pokemon_id = ?',
        [cid, pid]
    );
    if (!owned) {
        throw new Error('아직 도감에서 해금되지 않은 포켓몬이에요.');
    }
    await dbRun('UPDATE study_pokemon_pokedex SET is_partner = 0 WHERE child_id = ?', [cid]);
    await dbRun('UPDATE study_pokemon_pokedex SET is_partner = 1 WHERE child_id = ? AND pokemon_id = ?', [cid, pid]);
    return getPokemonById(pid);
}

async function rerollUnhatchedEgg(childId, cycleNo) {
    await ensurePokemonTables();
    const cid = String(childId || 'first').trim() || 'first';
    const cNo = Math.max(1, Number(cycleNo || 1));
    const existing = await dbGet(
        'SELECT * FROM study_pokemon_eggs WHERE child_id = ? AND cycle_no = ?',
        [cid, cNo]
    );
    if (!existing) {
        throw new Error('진행 중인 알이 없습니다.');
    }
    if (Number(existing.hatched) === 1) {
        throw new Error('이미 부화한 알은 바꿀 수 없습니다.');
    }
    const ownedRows = await dbAll('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ?', [cid]);
    const exclude = ownedRows.map((r) => r.pokemon_id).concat([existing.target_pokemon_id]);
    const nextPokemonId = pickEggPokemonId(exclude);
    await dbRun(
        'UPDATE study_pokemon_eggs SET target_pokemon_id = ? WHERE id = ?',
        [nextPokemonId, existing.id]
    );
    return getPokemonById(nextPokemonId);
}

function downloadBinary(url, timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { agent: ipv4Agent, timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadBinary(res.headers.location, timeoutMs).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP_${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('SPRITE_TIMEOUT'));
        });
        req.on('error', reject);
    });
}

function buildFallbackSvg(pokemonId) {
    const meta = getPokemonById(pokemonId);
    const shortName = String(meta.nameKo || '포켓몬').slice(0, 5);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <circle cx="60" cy="60" r="52" fill="${meta.bgSoft}" stroke="${meta.eggSpot}" stroke-width="4"/>
  <text x="60" y="56" text-anchor="middle" font-size="38">${meta.typeEmoji}</text>
  <text x="60" y="90" text-anchor="middle" font-size="15" font-weight="700" fill="${meta.color}" font-family="sans-serif">${shortName}</text>
</svg>`;
}

async function getOrCachePokemonSprite(pokemonId, kind = 'animated') {
    const idNum = Math.round(Number(pokemonId));
    if (!Number.isInteger(idNum) || idNum <= 0 || idNum > 1025) {
        return { contentType: 'image/svg+xml', buffer: Buffer.from(buildFallbackSvg(25), 'utf8') };
    }

    const wantAnimated = kind !== 'artwork';
    fs.mkdirSync(SPRITE_CACHE_DIR, { recursive: true });

    const gifPath = path.join(SPRITE_CACHE_DIR, `anim-${idNum}.gif`);
    const pngPath = path.join(SPRITE_CACHE_DIR, `art-${idNum}.png`);

    if (wantAnimated && fs.existsSync(gifPath)) {
        return { contentType: 'image/gif', buffer: fs.readFileSync(gifPath) };
    }
    if (fs.existsSync(pngPath)) {
        return { contentType: 'image/png', buffer: fs.readFileSync(pngPath) };
    }

    if (wantAnimated) {
        try {
            const gifUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/${idNum}.gif`;
            const buf = await downloadBinary(gifUrl, 4500);
            if (buf && buf.length > 200) {
                fs.writeFileSync(gifPath, buf);
                return { contentType: 'image/gif', buffer: buf };
            }
        } catch (_) {}
    }

    try {
        const pngUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${idNum}.png`;
        const buf = await downloadBinary(pngUrl, 4500);
        if (buf && buf.length > 200) {
            fs.writeFileSync(pngPath, buf);
            return { contentType: 'image/png', buffer: buf };
        }
    } catch (_) {}

    return { contentType: 'image/svg+xml', buffer: Buffer.from(buildFallbackSvg(idNum), 'utf8') };
}

async function getAdminPokemonOverview(profiles = [], stampBoardsMap = {}) {
    await ensurePokemonTables();
    const enabled = await isPokemonFeatureEnabled();
    const children = [];
    for (const p of profiles) {
        const board = stampBoardsMap[p.id] || { cycleNo: 1, earnedCount: 0 };
        const state = await getPokemonStateForBoard(p.id, board);
        const rawEgg = await dbGet(
            'SELECT target_pokemon_id, current_steps, hatched FROM study_pokemon_eggs WHERE child_id = ? AND cycle_no = ?',
            [p.id, board.cycleNo]
        );
        const targetMeta = rawEgg ? getPokemonById(rawEgg.target_pokemon_id) : null;
        children.push({
            childId: p.id,
            displayName: p.display_name,
            avatarEmoji: p.avatar_emoji || '🌟',
            cycleNo: board.cycleNo,
            steps: Number(rawEgg?.current_steps ?? board.earnedCount ?? 0),
            hatched: Number(rawEgg?.hatched || 0) === 1,
            targetNameKo: targetMeta ? targetMeta.nameKo : '-',
            targetTypeEmoji: targetMeta ? targetMeta.typeEmoji : '🥚',
            collectedCount: state.collectedCount,
            partnerNameKo: state.partnerPokemon?.nameKo || '없음'
        });
    }
    return {
        enabled,
        totalCatalogCount: POKEMON_CATALOG.length,
        children
    };
}

module.exports = {
    ensurePokemonTables,
    isPokemonFeatureEnabled,
    setPokemonFeatureEnabled,
    syncEggProgressWithBoard,
    getPokemonStateForBoard,
    acknowledgeEggHatch,
    setPartnerPokemon,
    rerollUnhatchedEgg,
    getOrCachePokemonSprite,
    getAdminPokemonOverview
};
