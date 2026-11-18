/**
 * ==============================================================================
 * 포켓몬 초원 소셜·간식 교환·놀러가기·협동·진화 서비스 (studyPokemonSocial.service.js)
 * ------------------------------------------------------------------------------
 * - 간식 획득 및 포켓몬 먹이기 -> 친밀도/레벨업 -> 1세대 진화 해금
 * - 아이(프로필) 간 간식 물물교환/선물 + 받는 아이 mathLevel 맞춤 수학 퀴즈 검증
 * - 상대 초원 포켓몬 놀러가기 (24시간 체류 + 기념품 별사탕) & 형제 협동 도장 목표
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');
const { getPokemonById } = require('./pokemonCatalog.data');
const {
    SNACK_CATALOG,
    GEN1_EVOLUTIONS,
    GREETING_PRESETS,
    REPLY_PRESETS,
    getSnackMeta,
    pickRandomSnacks,
    generateTradeMathQuiz
} = require('./pokemonEvolution.data');

let socialTablesPromise = null;

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

function getKstDateString() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function ensureSocialTables() {
    if (socialTablesPromise) return socialTablesPromise;
    socialTablesPromise = (async () => {
        const ddls = [
            `CREATE TABLE IF NOT EXISTS study_pokemon_snacks (id INTEGER PRIMARY KEY AUTOINCREMENT, child_id TEXT NOT NULL, snack_type TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT (datetime('now', 'localtime')), UNIQUE (child_id, snack_type))`,
            `CREATE TABLE IF NOT EXISTS study_pokemon_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, from_child_id TEXT NOT NULL, to_child_id TEXT NOT NULL, offer_snack TEXT NOT NULL, offer_qty INTEGER NOT NULL DEFAULT 1, request_snack TEXT DEFAULT '', request_qty INTEGER NOT NULL DEFAULT 0, quiz_json TEXT DEFAULT '', greeting_msg TEXT DEFAULT '', reply_msg TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT (datetime('now', 'localtime')), resolved_at DATETIME)`,
            `CREATE TABLE IF NOT EXISTS study_pokemon_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, host_child_id TEXT NOT NULL, guest_child_id TEXT NOT NULL, guest_pokemon_id INTEGER NOT NULL, guest_pokemon_name TEXT NOT NULL, greeting_msg TEXT DEFAULT '', expires_at DATETIME NOT NULL, souvenir_claimed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at DATETIME DEFAULT (datetime('now', 'localtime')))`,
            `CREATE TABLE IF NOT EXISTS study_pokemon_affection (id INTEGER PRIMARY KEY AUTOINCREMENT, child_id TEXT NOT NULL, pokemon_id INTEGER NOT NULL, exp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, evolved_into_id INTEGER DEFAULT 0, updated_at DATETIME DEFAULT (datetime('now', 'localtime')), UNIQUE (child_id, pokemon_id))`,
            `CREATE TABLE IF NOT EXISTS study_pokemon_coop_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_date TEXT NOT NULL, child_id TEXT NOT NULL, claimed_at DATETIME DEFAULT (datetime('now', 'localtime')), UNIQUE (mission_date, child_id))`
        ];
        for (const sql of ddls) await dbRun(sql);
    })().catch((err) => {
        socialTablesPromise = null;
        throw err;
    });
    return socialTablesPromise;
}

async function isSocialFeatureEnabled() {
    try {
        const row = await dbGet("SELECT value FROM system_configs WHERE key = 'study_pokemon_social_enabled'");
        return !row || row.value === null || String(row.value) !== '0';
    } catch (_) {
        return true;
    }
}

async function addSnackDelta(childId, snackType, delta) {
    await ensureSocialTables();
    const meta = getSnackMeta(snackType);
    const d = Math.round(Number(delta) || 0);
    if (d === 0) return;
    if (d > 0) {
        await dbRun(
            `INSERT INTO study_pokemon_snacks (child_id, snack_type, qty, updated_at)
             VALUES (?, ?, ?, datetime('now', 'localtime'))
             ON CONFLICT(child_id, snack_type) DO UPDATE SET
               qty = qty + excluded.qty,
               updated_at = datetime('now', 'localtime')`,
            [childId, meta.id, d]
        );
    } else {
        const res = await dbRun(
            `UPDATE study_pokemon_snacks
             SET qty = qty + ?, updated_at = datetime('now', 'localtime')
             WHERE child_id = ? AND snack_type = ? AND qty >= ?`,
            [d, childId, meta.id, Math.abs(d)]
        );
        if (res.changes === 0) throw new Error(`${meta.name} 개수가 부족해요.`);
    }
}

async function grantStudySnacks(childId, count = 2) {
    if (!(await isSocialFeatureEnabled())) return [];
    const cid = String(childId || 'first').trim() || 'first';
    const picked = pickRandomSnacks(Math.max(1, Math.min(5, count)));
    const awarded = [];
    for (const [snackId, qty] of Object.entries(picked)) {
        await addSnackDelta(cid, snackId, qty);
        const meta = getSnackMeta(snackId);
        awarded.push({ id: meta.id, name: meta.name, emoji: meta.emoji, qty });
    }
    return awarded;
}

async function getSnackInventory(childId) {
    await ensureSocialTables();
    const rows = await dbAll('SELECT snack_type, qty FROM study_pokemon_snacks WHERE child_id = ?', [childId]);
    const qtyMap = new Map(rows.map((r) => [r.snack_type, Number(r.qty || 0)]));
    if (rows.length === 0) {
        // 첫 이용 시 환영 간식(사과 2개, 베리 1개) 자동 지급
        await addSnackDelta(childId, 'apple', 2);
        await addSnackDelta(childId, 'berry', 1);
        qtyMap.set('apple', 2);
        qtyMap.set('berry', 1);
    }
    return SNACK_CATALOG.map((s) => ({ ...s, qty: qtyMap.get(s.id) || 0 }));
}

async function getAffectionMap(childId) {
    await ensureSocialTables();
    const rows = await dbAll('SELECT * FROM study_pokemon_affection WHERE child_id = ?', [childId]);
    const out = {};
    for (const r of rows) {
        const evo = GEN1_EVOLUTIONS[Number(r.pokemon_id)] || null;
        const exp = Number(r.exp || 0);
        out[r.pokemon_id] = {
            pokemonId: Number(r.pokemon_id),
            exp,
            level: Number(r.level || 1),
            evolvedIntoId: Number(r.evolved_into_id || 0),
            evolution: evo ? {
                nextId: evo.nextId,
                nextNameKo: getPokemonById(evo.nextId).nameKo,
                needExp: evo.needExp,
                canEvolve: exp >= evo.needExp && Number(r.evolved_into_id || 0) === 0
            } : null
        };
    }
    return out;
}

async function addPokemonAffection(childId, pokemonId, expDelta) {
    await ensureSocialTables();
    const pid = Number(pokemonId);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const row = await dbGet('SELECT * FROM study_pokemon_affection WHERE child_id = ? AND pokemon_id = ?', [childId, pid]);
    const nextExp = Math.max(0, Number(row?.exp || 0) + Number(expDelta || 0));
    const nextLv = Math.floor(nextExp / 10) + 1;
    await dbRun(
        `INSERT INTO study_pokemon_affection (child_id, pokemon_id, exp, level, updated_at)
         VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET
           exp = ?, level = ?, updated_at = datetime('now', 'localtime')`,
        [childId, pid, nextExp, nextLv, nextExp, nextLv]
    );
    return { pokemonId: pid, exp: nextExp, level: nextLv };
}

async function feedPokemonSnack(childId, pokemonId, snackType) {
    await ensureSocialTables();
    const pid = Number(pokemonId);
    const meta = getSnackMeta(snackType);
    const owned = await dbGet('SELECT * FROM study_pokemon_pokedex WHERE child_id = ? AND pokemon_id = ?', [childId, pid]);
    if (!owned) throw new Error('아직 도감에서 만나지 못한 포켓몬이에요.');

    await addSnackDelta(childId, meta.id, -1);
    const aff = await addPokemonAffection(childId, pid, meta.exp);
    const evo = GEN1_EVOLUTIONS[pid] || null;
    const poke = getPokemonById(pid);
    return {
        pokemon: poke,
        snack: meta,
        affection: aff,
        canEvolve: Boolean(evo && aff.exp >= evo.needExp),
        nextPokemon: evo ? getPokemonById(evo.nextId) : null
    };
}

async function evolvePokemon(childId, pokemonId) {
    await ensureSocialTables();
    const pid = Number(pokemonId);
    const evo = GEN1_EVOLUTIONS[pid];
    if (!evo) throw new Error('이 포켓몬은 더 이상 진화하지 않아요.');

    const owned = await dbGet('SELECT * FROM study_pokemon_pokedex WHERE child_id = ? AND pokemon_id = ?', [childId, pid]);
    if (!owned) throw new Error('보유 중인 포켓몬만 진화시킬 수 있어요.');

    const aff = await dbGet('SELECT * FROM study_pokemon_affection WHERE child_id = ? AND pokemon_id = ?', [childId, pid]);
    if (!aff || Number(aff.exp || 0) < evo.needExp) {
        throw new Error(`친밀도 경험치가 ${evo.needExp} 이상 모여야 진화할 수 있어요!`);
    }

    const wasPartner = Number(owned.is_partner || 0) === 1;
    if (wasPartner) {
        await dbRun('UPDATE study_pokemon_pokedex SET is_partner = 0 WHERE child_id = ?', [childId]);
    }
    await dbRun(
        `INSERT INTO study_pokemon_pokedex (child_id, pokemon_id, count, is_partner, first_hatched_at, last_hatched_at)
         VALUES (?, ?, 1, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET
           count = count + 1,
           is_partner = CASE WHEN excluded.is_partner = 1 THEN 1 ELSE study_pokemon_pokedex.is_partner END,
           last_hatched_at = datetime('now', 'localtime')`,
        [childId, evo.nextId, wasPartner ? 1 : 0]
    );
    await dbRun('UPDATE study_pokemon_affection SET evolved_into_id = ? WHERE child_id = ? AND pokemon_id = ?', [evo.nextId, childId, pid]);

    return { fromPokemon: getPokemonById(pid), toPokemon: getPokemonById(evo.nextId) };
}

async function expireOldVisits() {
    await ensureSocialTables();
    await dbRun(
        `UPDATE study_pokemon_visits SET status = 'ended'
         WHERE status = 'active' AND expires_at <= datetime('now', 'localtime')`
    );
}

async function getActiveVisitingGuestsForMeadow(hostChildId) {
    if (!(await isSocialFeatureEnabled())) return [];
    await expireOldVisits();
    const rows = await dbAll(
        `SELECT v.*, p.display_name AS guest_child_name
         FROM study_pokemon_visits v
         LEFT JOIN study_profiles p ON p.id = v.guest_child_id
         WHERE v.host_child_id = ? AND v.status = 'active'
         ORDER BY v.id DESC LIMIT 4`,
        [hostChildId]
    );
    return rows.map((r) => {
        const meta = getPokemonById(r.guest_pokemon_id);
        const ownerName = r.guest_child_name || r.guest_child_id;
        return {
            visitId: r.id,
            id: meta.id,
            nameKo: meta.nameKo,
            label: `${ownerName}네 ${meta.nameKo}`,
            guestOwnerName: ownerName,
            greetingMsg: r.greeting_msg || '안녕! 같이 놀자!',
            isGuest: true,
            animatedUrl: `/api/study/pokemon/sprite/${meta.id}?kind=animated`,
            artworkUrl: `/api/study/pokemon/sprite/${meta.id}?kind=artwork`
        };
    });
}

async function createTradeOffer({ fromChildId, toChildId, offerSnack, offerQty = 1, requestSnack = '', requestQty = 0, greetingMsg = '' }) {
    await ensureSocialTables();
    if (fromChildId === toChildId) throw new Error('내 자신에게는 교환을 보낼 수 없어요.');
    const oMeta = getSnackMeta(offerSnack);
    const oQty = Math.min(5, Math.max(1, Math.round(Number(offerQty) || 1)));
    const rQty = Math.min(5, Math.max(0, Math.round(Number(requestQty) || 0)));
    const rMeta = rQty > 0 ? getSnackMeta(requestSnack) : null;

    const inv = await dbGet('SELECT qty FROM study_pokemon_snacks WHERE child_id = ? AND snack_type = ?', [fromChildId, oMeta.id]);
    if (!inv || Number(inv.qty || 0) < oQty) throw new Error(`보내려는 ${oMeta.name}이(가) 부족해요!`);

    const cleanGreeting = String(greetingMsg || GREETING_PRESETS[0]).trim().slice(0, 40);
    const ins = await dbRun(
        `INSERT INTO study_pokemon_trades
         (from_child_id, to_child_id, offer_snack, offer_qty, request_snack, request_qty, greeting_msg, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [fromChildId, toChildId, oMeta.id, oQty, rMeta ? rMeta.id : '', rQty, cleanGreeting]
    );
    return dbGet('SELECT * FROM study_pokemon_trades WHERE id = ?', [ins.lastID]);
}

async function prepareTradeQuiz(tradeId, receiverChildId) {
    await ensureSocialTables();
    const trade = await dbGet('SELECT * FROM study_pokemon_trades WHERE id = ? AND to_child_id = ?', [tradeId, receiverChildId]);
    if (!trade || trade.status !== 'pending') throw new Error('대기 중인 교환 요청을 찾을 수 없어요.');

    const lvlRow = await dbGet("SELECT level FROM study_levels WHERE child_id = ? AND subject = 'math'", [receiverChildId]);
    const mathLevel = Number(lvlRow?.level || 1);
    const targetSnack = trade.request_qty > 0 ? trade.request_snack : trade.offer_snack;
    const invRow = await dbGet('SELECT qty FROM study_pokemon_snacks WHERE child_id = ? AND snack_type = ?', [receiverChildId, targetSnack]);

    const quiz = generateTradeMathQuiz({ mathLevel, trade, receiverQty: Number(invRow?.qty || 0) });
    await dbRun('UPDATE study_pokemon_trades SET quiz_json = ? WHERE id = ?', [JSON.stringify(quiz), trade.id]);
    return {
        tradeId: trade.id,
        quiz: { mathLevel: quiz.mathLevel, prompt: quiz.prompt, visual: quiz.visual, hint: quiz.hint, choices: quiz.choices }
    };
}

async function respondToTrade({ tradeId, receiverChildId, action, answer, replyMsg = '' }) {
    await ensureSocialTables();
    const trade = await dbGet('SELECT * FROM study_pokemon_trades WHERE id = ?', [tradeId]);
    if (!trade || trade.status !== 'pending') throw new Error('이미 처리되었거나 없는 교환 요청이에요.');

    if (action === 'cancel' && trade.from_child_id === receiverChildId) {
        await dbRun("UPDATE study_pokemon_trades SET status = 'cancelled', resolved_at = datetime('now', 'localtime') WHERE id = ?", [trade.id]);
        return { ok: true, status: 'cancelled', message: '교환 요청을 취소했어요.' };
    }
    if (trade.to_child_id !== receiverChildId) throw new Error('이 교환 요청을 처리할 권한이 없어요.');

    if (action === 'decline') {
        await dbRun("UPDATE study_pokemon_trades SET status = 'declined', resolved_at = datetime('now', 'localtime') WHERE id = ?", [trade.id]);
        return { ok: true, status: 'declined', message: '이번에는 정중히 거절했어요.' };
    }

    const storedQuiz = trade.quiz_json ? JSON.parse(trade.quiz_json) : null;
    if (!storedQuiz || String(answer ?? '').trim() !== String(storedQuiz.answer)) {
        return { ok: false, quizRetry: true, message: `아쉬워요! ${storedQuiz?.hint || '한번 더 세어 볼까요?'}` };
    }

    const cleanReply = String(replyMsg || REPLY_PRESETS[0]).trim().slice(0, 40);
    await dbRun('BEGIN IMMEDIATE');
    try {
        await addSnackDelta(trade.from_child_id, trade.offer_snack, -Number(trade.offer_qty));
        if (Number(trade.request_qty) > 0) {
            await addSnackDelta(trade.to_child_id, trade.request_snack, -Number(trade.request_qty));
            await addSnackDelta(trade.from_child_id, trade.request_snack, Number(trade.request_qty));
        }
        await addSnackDelta(trade.to_child_id, trade.offer_snack, Number(trade.offer_qty));
        await dbRun(
            "UPDATE study_pokemon_trades SET status = 'accepted', reply_msg = ?, resolved_at = datetime('now', 'localtime') WHERE id = ? AND status = 'pending'",
            [cleanReply, trade.id]
        );
        await dbRun('COMMIT');
    } catch (err) {
        await dbRun('ROLLBACK').catch(() => {});
        throw err;
    }

    for (const cid of [trade.from_child_id, trade.to_child_id]) {
        const partner = await dbGet('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, id ASC LIMIT 1', [cid]);
        if (partner) await addPokemonAffection(cid, partner.pokemon_id, 5);
    }
    return { ok: true, status: 'accepted', message: '딩동댕! 정답을 맞혀 간식 교환과 친밀도 +5가 완료되었어요! 🎉' };
}

async function sendPokemonVisit({ guestChildId, hostChildId, pokemonId = 0, greetingMsg = '' }) {
    await ensureSocialTables();
    await expireOldVisits();
    if (guestChildId === hostChildId) throw new Error('다른 친구의 초원으로만 놀러갈 수 있어요!');

    const existing = await dbGet("SELECT id FROM study_pokemon_visits WHERE guest_child_id = ? AND status = 'active'", [guestChildId]);
    if (existing) throw new Error('이미 다른 초원에 놀러간 포켓몬이 있어요! 먼저 집으로 불러와 주세요.');

    let pokeRow = null;
    if (Number(pokemonId) > 0) {
        pokeRow = await dbGet('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ? AND pokemon_id = ?', [guestChildId, Number(pokemonId)]);
    }
    if (!pokeRow) {
        pokeRow = await dbGet('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, id ASC LIMIT 1', [guestChildId]);
    }
    if (!pokeRow) throw new Error('먼저 알을 부화시켜 포켓몬 친구를 만나야 놀러갈 수 있어요! 🥚');

    const meta = getPokemonById(pokeRow.pokemon_id);
    const cleanNote = String(greetingMsg || '오늘 하루 즐겁게 같이 놀자! ✨').trim().slice(0, 40);
    const ins = await dbRun(
        `INSERT INTO study_pokemon_visits
         (host_child_id, guest_child_id, guest_pokemon_id, guest_pokemon_name, greeting_msg, expires_at, status)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime', '+24 hours'), 'active')`,
        [hostChildId, guestChildId, meta.id, meta.nameKo, cleanNote]
    );
    return dbGet('SELECT * FROM study_pokemon_visits WHERE id = ?', [ins.lastID]);
}

async function endPokemonVisit(visitId, childId) {
    await ensureSocialTables();
    const visit = await dbGet('SELECT * FROM study_pokemon_visits WHERE id = ?', [visitId]);
    if (!visit || visit.status !== 'active') throw new Error('종료할 놀러가기 기록을 찾지 못했어요.');
    if (visit.guest_child_id !== childId && visit.host_child_id !== childId) {
        throw new Error('해당 방문을 종료할 권한이 없어요.');
    }
    await dbRun("UPDATE study_pokemon_visits SET status = 'ended', souvenir_claimed = 1 WHERE id = ?", [visit.id]);
    await addSnackDelta(visit.guest_child_id, 'star_candy', 1);
    return { ok: true, message: `${visit.guest_pokemon_name}이(가) 즐겁게 놀고 답례 🍬 별사탕 1개를 가져왔어요!` };
}

async function getCoopStatus(childId) {
    await ensureSocialTables();
    const today = getKstDateString();
    const profiles = await dbAll('SELECT id, display_name FROM study_profiles');
    const goalStars = Math.max(2, (profiles.length || 2) * 2);
    const row = await dbGet("SELECT COUNT(*) AS cnt FROM study_stamps WHERE DATE(earned_at) = ?", [today]);
    const currentStars = Number(row?.cnt || 0);
    const claimed = await dbGet('SELECT id FROM study_pokemon_coop_claims WHERE mission_date = ? AND child_id = ?', [today, childId]);
    return {
        missionDate: today,
        goalStars,
        currentStars,
        reached: currentStars >= goalStars,
        claimed: Boolean(claimed),
        canClaim: currentStars >= goalStars && !claimed
    };
}

async function claimCoopReward(childId) {
    const coop = await getCoopStatus(childId);
    if (!coop.reached) throw new Error(`모두 합쳐 도장 ${coop.goalStars}개를 모아야 받을 수 있어요!`);
    if (coop.claimed) throw new Error('오늘의 협동 보상은 이미 받았어요!');

    await dbRun('INSERT INTO study_pokemon_coop_claims (mission_date, child_id) VALUES (?, ?)', [coop.missionDate, childId]);
    await addSnackDelta(childId, 'star_candy', 2);
    const partner = await dbGet('SELECT pokemon_id FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, id ASC LIMIT 1', [childId]);
    if (partner) await addPokemonAffection(childId, partner.pokemon_id, 15);
    return { ok: true, message: '🎉 형제 협동 미션 달성! 🍬 별사탕 2개와 친밀도 +15를 받았어요!' };
}

async function getSocialState(childId) {
    const enabled = await isSocialFeatureEnabled();
    if (!enabled) return { enabled: false };
    await expireOldVisits();

    const [snacks, affection, profiles, incomingTrades, outgoingTrades, incomingVisits, outgoingVisit, coop] = await Promise.all([
        getSnackInventory(childId),
        getAffectionMap(childId),
        dbAll('SELECT id, display_name, avatar_emoji FROM study_profiles ORDER BY birth_year ASC, id ASC'),
        dbAll("SELECT t.*, p.display_name AS from_name FROM study_pokemon_trades t LEFT JOIN study_profiles p ON p.id = t.from_child_id WHERE t.to_child_id = ? AND t.status = 'pending' ORDER BY t.id DESC", [childId]),
        dbAll("SELECT t.*, p.display_name AS to_name FROM study_pokemon_trades t LEFT JOIN study_profiles p ON p.id = t.to_child_id WHERE t.from_child_id = ? ORDER BY t.id DESC LIMIT 6", [childId]),
        dbAll("SELECT v.*, p.display_name AS guest_name FROM study_pokemon_visits v LEFT JOIN study_profiles p ON p.id = v.guest_child_id WHERE v.host_child_id = ? AND v.status = 'active'", [childId]),
        dbGet("SELECT v.*, p.display_name AS host_name FROM study_pokemon_visits v LEFT JOIN study_profiles p ON p.id = v.host_child_id WHERE v.guest_child_id = ? AND v.status = 'active' LIMIT 1", [childId]),
        getCoopStatus(childId)
    ]);

    return {
        enabled: true,
        snacks,
        affection,
        siblings: profiles.filter((p) => p.id !== childId),
        incomingTrades,
        outgoingTrades,
        incomingVisits,
        outgoingVisit,
        coop,
        greetingPresets: GREETING_PRESETS,
        replyPresets: REPLY_PRESETS
    };
}

module.exports = {
    ensureSocialTables,
    isSocialFeatureEnabled,
    grantStudySnacks,
    getActiveVisitingGuestsForMeadow,
    feedPokemonSnack,
    evolvePokemon,
    createTradeOffer,
    prepareTradeQuiz,
    respondToTrade,
    sendPokemonVisit,
    endPokemonVisit,
    claimCoopReward,
    getSocialState,
    addSnackDelta
};
