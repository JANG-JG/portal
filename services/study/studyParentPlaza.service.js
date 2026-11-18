/**
 * ==============================================================================
 * 가족 포켓몬 광장 · 엄마아빠 포켓몬 트레이너 · DB 스키마 서비스
 * (studyParentPlaza.service.js)
 * ------------------------------------------------------------------------------
 * - 개인 초원 <-> 우리 가족 포켓몬 광장(키보드 없는 그림 말풍선 소통)
 * - 엄마·아빠(mom/dad) 포켓몬 트레이너 입양·먹이주기·진화·광장 참여
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');
const { getProfiles, getSystemConfig, setSystemConfig, normalizeChildId } = require('./studyDb.service');
const { getPokemonById, POKEMON_CATALOG } = require('./pokemonCatalog.data');
const { GEN1_EVOLUTIONS, getSnackMeta, pickRandomSnacks } = require('./pokemonEvolution.data');
const { ensureSocialTables, addSnackDelta, getSnackInventory, getAffectionMap } = require('./studyPokemonSocial.service');
const { ensurePokemonTables } = require('./studyPokemon.service');

const VALID_PARENT_IDS = new Set(['mom', 'dad']);
const PLAZA_THEMES = [
    { id: 'park', emoji: '⛲', label: '햇살 분수 공원' },
    { id: 'beach', emoji: '🏖️', label: '푸른 바다 해변' },
    { id: 'starry', emoji: '🌌', label: '별빛 캠프 광장' },
    { id: 'sakura', emoji: '🌸', label: '벚꽃 마을 광장' },
    { id: 'meadow', emoji: '🌿', label: '푸른 초원 들판' }
];
const VALID_PLAZA_THEMES = new Set(PLAZA_THEMES.map((t) => t.id));

const REACTION_PRESETS = [
    { id: 'hi', sticker: '👋', label: '안녕!', speech: '안녕! 우리 가족 모두 반가워! 👋' },
    { id: 'love', sticker: '❤️', label: '사랑해!', speech: '우리 가족 최고로 사랑해! ❤️' },
    { id: 'clap', sticker: '👏', label: '최고야!', speech: '오늘 공부 정말 멋졌어! 👏' },
    { id: 'snack', sticker: '🍎', label: '간식 먹자!', speech: '같이 맛있는 간식 나눠 먹자! 🍎' },
    { id: 'play', sticker: '🤗', label: '같이 놀자!', speech: '초원에서 공놀이하고 방울톡 하자! ⚽' },
    { id: 'goal', sticker: '🎁', label: '쿠폰 모으자!', speech: '열심히 공부해서 선물 쿠폰 모으자! 🎁' }
];

const DEFAULT_COUPONS = [
    { title: '아이스크림 1개 쿠폰', emoji: '🍦', description: '마트에서 내가 좋아하는 아이스크림 1개를 골라요!', cost_points: 120, sort_order: 1 },
    { title: '간식 고르기 쿠폰', emoji: '🍩', description: '달콤하거나 바삭한 간식 1개를 직접 고를 수 있어요!', cost_points: 100, sort_order: 2 },
    { title: '만화·영상 20분 쿠폰', emoji: '📺', description: '약속한 시간 외에 좋아하는 영상을 20분 더 봐요!', cost_points: 150, sort_order: 3 },
    { title: '잠자리 동화 2권 더 쿠폰', emoji: '📚', description: '엄마·아빠가 자기 전에 재미있는 책을 2권 더 읽어줘요!', cost_points: 80, sort_order: 4 },
    { title: '주말 놀이터 정하기 쿠폰', emoji: '🎡', description: '이번 주말에 가고 싶은 놀이터나 공원을 내가 정해요!', cost_points: 300, sort_order: 5 },
    { title: '작은 장난감 선물 쿠폰', emoji: '🧸', description: '열심히 모은 보람! 갖고 싶던 작은 선물을 골라요!', cost_points: 450, sort_order: 6 }
];

const PARENT_TRAINER_DEFAULTS = {
    mom: { id: 'mom', display_name: '엄마', avatar_emoji: '👩', role_label: '엄마 트레이너', partner_pokemon_id: 133, starterIds: [133, 39, 35, 1, 7, 37] },
    dad: { id: 'dad', display_name: '아빠', avatar_emoji: '👨', role_label: '아빠 트레이너', partner_pokemon_id: 25, starterIds: [25, 143, 4, 6, 9, 59] }
};

let tablesPromise = null;

const dbGet = (sql, params = []) => new Promise((res, rej) => portalDb.get(sql, params, (e, r) => (e ? rej(e) : res(r || null))));
const dbAll = (sql, params = []) => new Promise((res, rej) => portalDb.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
const dbRun = (sql, params = []) => new Promise((res, rej) => portalDb.run(sql, params, function (e) { e ? rej(e) : res({ lastID: this.lastID, changes: this.changes }); }));

function formatSpriteUrls(pokemonId) {
    return {
        animatedUrl: `/api/study/pokemon/sprite/${pokemonId}?kind=animated`,
        artworkUrl: `/api/study/pokemon/sprite/${pokemonId}?kind=artwork`
    };
}

function ensurePlazaRewardTables() {
    if (tablesPromise) return tablesPromise;
    tablesPromise = (async () => {
        await ensurePokemonTables();
        await ensureSocialTables();
        const ddls = [
            `CREATE TABLE IF NOT EXISTS study_point_balances (
                owner_id TEXT PRIMARY KEY,
                points INTEGER NOT NULL DEFAULT 0,
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE TABLE IF NOT EXISTS study_point_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id TEXT NOT NULL,
                delta INTEGER NOT NULL,
                reason TEXT NOT NULL,
                ref_key TEXT DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_study_point_ledger_ref
             ON study_point_ledger(owner_id, ref_key) WHERE ref_key <> ''`,
            `CREATE TABLE IF NOT EXISTS study_reward_coupons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                emoji TEXT NOT NULL DEFAULT '🎁',
                description TEXT DEFAULT '',
                cost_points INTEGER NOT NULL DEFAULT 100,
                is_active INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 10,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE TABLE IF NOT EXISTS study_coupon_purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                coupon_id INTEGER NOT NULL,
                coupon_title TEXT NOT NULL,
                coupon_emoji TEXT NOT NULL DEFAULT '🎁',
                cost_points INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'owned',
                child_note TEXT DEFAULT '',
                requested_at DATETIME,
                resolved_at DATETIME,
                resolved_by TEXT DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE TABLE IF NOT EXISTS study_plaza_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                sender_emoji TEXT DEFAULT '✨',
                pokemon_name TEXT DEFAULT '',
                sticker TEXT NOT NULL,
                speech_text TEXT NOT NULL,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`,
            `CREATE TABLE IF NOT EXISTS study_parent_trainers (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                avatar_emoji TEXT NOT NULL,
                role_label TEXT NOT NULL,
                partner_pokemon_id INTEGER NOT NULL,
                care_progress INTEGER NOT NULL DEFAULT 0,
                updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )`
        ];
        for (const sql of ddls) await dbRun(sql);

        const couponCnt = await dbGet('SELECT COUNT(*) AS cnt FROM study_reward_coupons');
        if (!couponCnt || Number(couponCnt.cnt) === 0) {
            for (const c of DEFAULT_COUPONS) {
                await dbRun(
                    `INSERT INTO study_reward_coupons (title, emoji, description, cost_points, is_active, sort_order)
                     VALUES (?, ?, ?, ?, 1, ?)`,
                    [c.title, c.emoji, c.description, c.cost_points, c.sort_order]
                );
            }
        }

        for (const t of Object.values(PARENT_TRAINER_DEFAULTS)) {
            const exists = await dbGet('SELECT id FROM study_parent_trainers WHERE id = ?', [t.id]);
            if (!exists) {
                await dbRun(
                    `INSERT INTO study_parent_trainers (id, display_name, avatar_emoji, role_label, partner_pokemon_id, care_progress)
                     VALUES (?, ?, ?, ?, ?, 0)`,
                    [t.id, t.display_name, t.avatar_emoji, t.role_label, t.partner_pokemon_id]
                );
                for (const pid of t.starterIds) {
                    await dbRun(
                        `INSERT OR IGNORE INTO study_pokemon_pokedex (child_id, pokemon_id, count, is_partner)
                         VALUES (?, ?, 1, ?)`,
                        [t.id, pid, pid === t.partner_pokemon_id ? 1 : 0]
                    );
                }
                await addSnackDelta(t.id, 'apple', 3);
                await addSnackDelta(t.id, 'berry', 2);
            }
        }
    })().catch((err) => {
        tablesPromise = null;
        throw err;
    });
    return tablesPromise;
}

async function getPlazaConfig() {
    const [plaza, shop, parentPoke] = await Promise.all([
        getSystemConfig('study_plaza_enabled', '1'),
        getSystemConfig('study_coupon_shop_enabled', '1'),
        getSystemConfig('study_parent_pokemon_enabled', '1')
    ]);
    return { plazaEnabled: plaza !== '0', couponShopEnabled: shop !== '0', parentPokemonEnabled: parentPoke !== '0' };
}

async function grantParentCareBonus(trainerId) {
    const tid = VALID_PARENT_IDS.has(trainerId) ? trainerId : 'mom';
    const picked = pickRandomSnacks(1);
    for (const [snackId, qty] of Object.entries(picked)) {
        await addSnackDelta(tid, snackId, qty);
    }
    await dbRun(
        `UPDATE study_parent_trainers SET care_progress = care_progress + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
        [tid]
    );
}

async function getParentTrainersState() {
    await ensurePlazaRewardTables();
    const rows = await dbAll('SELECT * FROM study_parent_trainers ORDER BY CASE id WHEN "mom" THEN 1 ELSE 2 END');
    const trainers = [];
    for (const r of rows) {
        const [dexRows, snacks, affMap] = await Promise.all([
            dbAll('SELECT * FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, last_hatched_at DESC', [r.id]),
            getSnackInventory(r.id),
            getAffectionMap(r.id)
        ]);
        const partnerRow = dexRows.find((d) => Number(d.is_partner) === 1) || dexRows[0];
        const partnerId = partnerRow ? Number(partnerRow.pokemon_id) : Number(r.partner_pokemon_id || 25);
        const partnerMeta = getPokemonById(partnerId);
        const aff = affMap[partnerId] || { level: 1, exp: 0 };
        const evoRule = GEN1_EVOLUTIONS[partnerId] || null;
        const evoNext = evoRule ? getPokemonById(evoRule.into) : null;

        trainers.push({
            id: r.id, displayName: r.display_name, avatarEmoji: r.avatar_emoji, roleLabel: r.role_label,
            careProgress: Number(r.care_progress || 0), snacks,
            partnerPokemon: {
                ...partnerMeta, ...formatSpriteUrls(partnerId), level: aff.level, exp: aff.exp,
                evolution: evoRule ? { into: evoRule.into, nextNameKo: evoNext.nameKo, needExp: evoRule.needExp, canEvolve: aff.exp >= evoRule.needExp } : null
            },
            collected: dexRows.map((d) => ({ ...getPokemonById(d.pokemon_id), ...formatSpriteUrls(d.pokemon_id), isPartner: Number(d.pokemon_id) === partnerId }))
        });
    }
    return trainers;
}

async function pickParentPartner({ trainerId, pokemonId }) {
    await ensurePlazaRewardTables();
    const tid = VALID_PARENT_IDS.has(trainerId) ? trainerId : 'mom';
    const meta = getPokemonById(Number(pokemonId));
    await dbRun(
        `INSERT INTO study_pokemon_pokedex (child_id, pokemon_id, count, is_partner, first_hatched_at, last_hatched_at)
         VALUES (?, ?, 1, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET last_hatched_at = datetime('now', 'localtime')`,
        [tid, meta.id]
    );
    await dbRun('UPDATE study_pokemon_pokedex SET is_partner = CASE WHEN pokemon_id = ? THEN 1 ELSE 0 END WHERE child_id = ?', [meta.id, tid]);
    await dbRun(`UPDATE study_parent_trainers SET partner_pokemon_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [meta.id, tid]);
    return { message: `${tid === 'mom' ? '👩 엄마' : '👨 아빠'} 단짝 포켓몬을 ${meta.nameKo}(으)로 정했어요! ✨`, parentTrainers: await getParentTrainersState() };
}

async function feedParentPokemon({ trainerId, pokemonId, snackType }) {
    await ensurePlazaRewardTables();
    const tid = VALID_PARENT_IDS.has(trainerId) ? trainerId : 'mom';
    const meta = getSnackMeta(snackType);
    const trainers = await getParentTrainersState();
    const tr = trainers.find((x) => x.id === tid);
    const pid = Number(pokemonId) || Number(tr?.partnerPokemon?.id || 25);

    await addSnackDelta(tid, meta.id, -1);
    await dbRun(
        `INSERT INTO study_pokemon_affection (child_id, pokemon_id, exp, level, updated_at)
         VALUES (?, ?, ?, 1, datetime('now', 'localtime'))
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET
            exp = exp + excluded.exp,
            level = 1 + CAST((exp + excluded.exp) / 10 AS INTEGER),
            updated_at = datetime('now', 'localtime')`,
        [tid, pid, meta.exp]
    );
    await dbRun('UPDATE study_parent_trainers SET care_progress = care_progress + 1 WHERE id = ?', [tid]);
    return { message: `${tr?.avatarEmoji || ''} ${tr?.displayName || ''}네 ${getPokemonById(pid).nameKo}에게 ${meta.emoji} ${meta.name}을(를) 주었어요! (친밀도 +${meta.exp})`, parentTrainers: await getParentTrainersState() };
}

async function adoptParentEggPokemon({ trainerId }) {
    await ensurePlazaRewardTables();
    const tid = VALID_PARENT_IDS.has(trainerId) ? trainerId : 'mom';
    const row = await dbGet('SELECT care_progress FROM study_parent_trainers WHERE id = ?', [tid]);
    const prog = Number(row?.care_progress || 0);
    if (prog < 3) throw new Error(`가족 돌봄 게이지가 ${3 - prog}번 더 모이면 새 포켓몬 알을 열 수 있어요!`);

    const ownedRows = await dbAll('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ?', [tid]);
    const ownedSet = new Set(ownedRows.map((x) => Number(x.pokemon_id)));
    const pool = POKEMON_CATALOG.filter((p) => !ownedSet.has(p.id));
    const picked = (pool.length ? pool : POKEMON_CATALOG)[Math.floor(Math.random() * (pool.length || POKEMON_CATALOG.length))];

    await dbRun(
        `INSERT INTO study_pokemon_pokedex (child_id, pokemon_id, count, is_partner) VALUES (?, ?, 1, 0)
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET count = count + 1, last_hatched_at = datetime('now', 'localtime')`,
        [tid, picked.id]
    );
    await dbRun('UPDATE study_parent_trainers SET care_progress = MAX(0, care_progress - 3) WHERE id = ?', [tid]);
    await addSnackDelta(tid, 'berry', 2);
    return {
        adopted: { ...picked, ...formatSpriteUrls(picked.id) },
        message: `🎉 ${tid === 'mom' ? '👩 엄마' : '👨 아빠'} 트레이너의 가족 알에서 ${picked.nameKo}가 태어났어요!`,
        parentTrainers: await getParentTrainersState()
    };
}

async function evolveParentPokemon({ trainerId, pokemonId }) {
    await ensurePlazaRewardTables();
    const tid = VALID_PARENT_IDS.has(trainerId) ? trainerId : 'mom';
    const pid = Number(pokemonId);
    const rule = GEN1_EVOLUTIONS[pid];
    if (!rule) throw new Error('이 포켓몬은 더 이상 진화하지 않아요!');
    const aff = await dbGet('SELECT exp FROM study_pokemon_affection WHERE child_id = ? AND pokemon_id = ?', [tid, pid]);
    if (!aff || Number(aff.exp) < rule.needExp) throw new Error(`친밀도가 ${rule.needExp - Number(aff?.exp || 0)} 더 필요해요!`);

    const nextMeta = getPokemonById(rule.into);
    await dbRun(
        `INSERT INTO study_pokemon_pokedex (child_id, pokemon_id, count, is_partner) VALUES (?, ?, 1, 1)
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET count = count + 1, is_partner = 1, last_hatched_at = datetime('now', 'localtime')`,
        [tid, nextMeta.id]
    );
    await dbRun('UPDATE study_pokemon_pokedex SET is_partner = CASE WHEN pokemon_id = ? THEN 1 ELSE 0 END WHERE child_id = ?', [nextMeta.id, tid]);
    await dbRun('UPDATE study_parent_trainers SET partner_pokemon_id = ? WHERE id = ?', [nextMeta.id, tid]);
    return { message: `✨ 와! ${getPokemonById(pid).nameKo}가 ${nextMeta.nameKo}(으)로 진화했어요!`, parentTrainers: await getParentTrainersState() };
}

async function getFamilyPlazaState(viewerChildId) {
    await ensurePlazaRewardTables();
    const [profiles, parentTrainers, recentReactions] = await Promise.all([
        getProfiles(),
        getParentTrainersState(),
        dbAll('SELECT * FROM study_plaza_reactions ORDER BY id DESC LIMIT 12')
    ]);
    const latestBySender = new Map();
    for (const r of recentReactions) { if (!latestBySender.has(r.sender_id)) latestBySender.set(r.sender_id, r); }

    const members = [];
    for (const p of profiles) {
        const dex = await dbAll('SELECT * FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, last_hatched_at DESC LIMIT 1', [p.id]);
        const row = dex[0];
        let pokeMeta = row ? getPokemonById(row.pokemon_id) : null;
        if (!pokeMeta) {
            const egg = await dbGet('SELECT target_pokemon_id FROM study_pokemon_eggs WHERE child_id = ? ORDER BY cycle_no DESC LIMIT 1', [p.id]);
            pokeMeta = getPokemonById(egg?.target_pokemon_id || (p.id === 'second' ? 133 : 25));
        }
        const reaction = latestBySender.get(p.id);
        members.push({
            ownerId: p.id, ownerType: 'kid', ownerName: p.display_name, ownerEmoji: p.avatar_emoji || '🧒',
            pokemonId: pokeMeta.id, nameKo: pokeMeta.nameKo, label: `${p.avatar_emoji || '🧒'} ${p.display_name} · ${pokeMeta.nameKo}`,
            isPartner: p.id === normalizeChildId(viewerChildId), hasPokemonYet: Boolean(row),
            latestSpeech: reaction ? reaction.speech_text : `${p.display_name}와(과) 가족 광장에서 놀아요! ✨`,
            ...formatSpriteUrls(pokeMeta.id)
        });
    }

    for (const tr of parentTrainers) {
        const p = tr.partnerPokemon;
        const reaction = latestBySender.get(tr.id);
        members.push({
            ownerId: tr.id, ownerType: 'parent', ownerName: tr.displayName, ownerEmoji: tr.avatarEmoji,
            pokemonId: p.id, nameKo: p.nameKo, label: `${tr.avatarEmoji} ${tr.displayName} · ${p.nameKo}`,
            isParent: true, isPartner: false, hasPokemonYet: true,
            latestSpeech: reaction ? reaction.speech_text : `${tr.displayName} 포켓몬도 함께 응원해요! 💪`,
            ...formatSpriteUrls(p.id)
        });
    }
    const plazaThemeRaw = await getSystemConfig('study_plaza_theme', 'park');
    const plazaTheme = VALID_PLAZA_THEMES.has(plazaThemeRaw) ? plazaThemeRaw : 'park';
    return { plazaTheme, themes: PLAZA_THEMES, members, reactions: recentReactions, presets: REACTION_PRESETS };
}

async function setPlazaTheme(themeId) {
    await ensurePlazaRewardTables();
    const tid = String(themeId || 'park').trim();
    if (!VALID_PLAZA_THEMES.has(tid)) throw new Error('올바른 광장 배경을 선택해 주세요.');
    await setSystemConfig('study_plaza_theme', tid);
    const meta = PLAZA_THEMES.find((t) => t.id === tid) || PLAZA_THEMES[0];
    return { plazaTheme: tid, message: `${meta.emoji} 우리 가족 광장 배경을 '${meta.label}'(으)로 바꿨어요!`, familyPlaza: await getFamilyPlazaState('first') };
}

async function postPlazaReaction({ senderId, reactionId }) {
    await ensurePlazaRewardTables();
    const preset = REACTION_PRESETS.find((r) => r.id === reactionId) || REACTION_PRESETS[0];
    const sid = String(senderId || 'first').trim();
    let senderName = sid, senderEmoji = '✨', pokemonName = '포켓몬';

    if (VALID_PARENT_IDS.has(sid)) {
        const tr = (await getParentTrainersState()).find((t) => t.id === sid);
        senderName = tr?.displayName || (sid === 'mom' ? '엄마' : '아빠');
        senderEmoji = tr?.avatarEmoji || '👩';
        pokemonName = tr?.partnerPokemon?.nameKo || '포켓몬';
        await grantParentCareBonus(sid).catch(() => {});
    } else {
        const profiles = await getProfiles();
        const prof = profiles.find((p) => p.id === sid) || profiles[0];
        senderName = prof?.display_name || '친구';
        senderEmoji = prof?.avatar_emoji || '🧒';
        const partner = await dbGet('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC LIMIT 1', [prof?.id || sid]);
        if (partner) pokemonName = getPokemonById(partner.pokemon_id).nameKo;
    }

    await dbRun(
        `INSERT INTO study_plaza_reactions (sender_id, sender_name, sender_emoji, pokemon_name, sticker, speech_text) VALUES (?, ?, ?, ?, ?, ?)`,
        [sid, senderName, senderEmoji, pokemonName, preset.sticker, preset.speech]
    );
    return { message: `${senderEmoji} ${senderName}: "${preset.speech}"`, familyPlaza: await getFamilyPlazaState(sid) };
}

module.exports = {
    REACTION_PRESETS,
    PLAZA_THEMES,
    dbGet, dbAll, dbRun,
    ensurePlazaRewardTables,
    getPlazaConfig,
    grantParentCareBonus,
    getParentTrainersState,
    pickParentPartner,
    feedParentPokemon,
    adoptParentEggPokemon,
    evolveParentPokemon,
    getFamilyPlazaState,
    setPlazaTheme,
    postPlazaReaction
};
