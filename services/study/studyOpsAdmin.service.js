/**
 * ==============================================================================
 * 관리자 학습실 세부 기능 On/Off · 보너스 간식 · 미션 테마 · 소셜/AI 도안 로그 서비스
 * (studyOpsAdmin.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const {
    dbGet,
    dbAll,
    dbRun,
    getKstDateString,
    getProfiles,
    getSystemConfig,
    setSystemConfig,
    normalizeChildId,
    normalizeSubject
} = require('./studyDb.service');
const { getSnackMeta, SNACK_CATALOG } = require('./pokemonEvolution.data');
const {
    ensureSocialTables,
    addSnackDelta,
    getSnackInventory
} = require('./studyPokemonSocial.service');

const MISSION_THEME_PRESETS = [
    '동물 친구',
    '공룡 탐험',
    '달콤 과일',
    '탈것 여행',
    '우주 모험',
    '바다 친구',
    '공주·요정',
    '로봇·변신'
];

const FEATURE_FLAG_PAIRS = [
    ['pokemonSocialEnabled', 'study_pokemon_social_enabled'],
    ['aiCustomColoringEnabled', 'study_ai_custom_coloring_enabled'],
    ['pianoVoiceEnabled', 'study_piano_voice_enabled'],
    ['dailyMissionsEnabled', 'study_daily_missions_enabled'],
    ['phase3SubjectsEnabled', 'study_phase3_subjects_enabled'],
    ['wrongReviewMixEnabled', 'study_wrong_review_mix_enabled']
];

let opsTablesPromise = null;

function ensureOpsTables() {
    if (opsTablesPromise) return opsTablesPromise;
    opsTablesPromise = (async () => {
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_custom_coloring_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                raw_prompt TEXT NOT NULL,
                safe_prompt TEXT NOT NULL,
                blocked INTEGER NOT NULL DEFAULT 0,
                block_reason TEXT DEFAULT '',
                source_label TEXT DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )
        `);
        await dbRun('CREATE INDEX IF NOT EXISTS idx_study_custom_color_created ON study_custom_coloring_logs (created_at DESC)').catch(() => {});
    })().catch((err) => {
        opsTablesPromise = null;
        throw err;
    });
    return opsTablesPromise;
}

async function logCustomColoringAttempt({
    childId = 'first',
    rawPrompt = '',
    safePrompt = '',
    blocked = false,
    blockReason = '',
    sourceLabel = ''
}) {
    try {
        await ensureOpsTables();
        const cid = normalizeChildId(childId);
        await dbRun(
            `INSERT INTO study_custom_coloring_logs
             (child_id, raw_prompt, safe_prompt, blocked, block_reason, source_label)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                cid,
                String(rawPrompt || '').slice(0, 80),
                String(safePrompt || '').slice(0, 80),
                blocked ? 1 : 0,
                String(blockReason || '').slice(0, 80),
                String(sourceLabel || '').slice(0, 60)
            ]
        );
    } catch (err) {
        console.warn('AI 자유 도안 로그 기록 무시:', err?.message || err);
    }
}

async function getStudyFeatureFlags() {
    const values = await Promise.all(
        FEATURE_FLAG_PAIRS.map(([, dbKey]) => getSystemConfig(dbKey, '1'))
    );
    const flags = {};
    FEATURE_FLAG_PAIRS.forEach(([prop], idx) => {
        flags[prop] = values[idx] !== '0';
    });
    return flags;
}

async function setStudyFeatureFlags(input = {}) {
    for (const [prop, dbKey] of FEATURE_FLAG_PAIRS) {
        if (typeof input[prop] === 'boolean') {
            await setSystemConfig(dbKey, input[prop] ? '1' : '0');
        }
    }
    return getStudyFeatureFlags();
}

async function getTodayMissionThemeConfig() {
    const today = getKstDateString();
    const raw = await getSystemConfig('study_daily_mission_theme', '');
    let theme = '';
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.date === today && parsed.theme) {
                theme = String(parsed.theme).trim().slice(0, 24);
            }
        } catch (_) {
            theme = '';
        }
    }
    return { date: today, theme, presets: MISSION_THEME_PRESETS };
}

async function setTodayMissionTheme({
    childId = 'all',
    theme = '',
    slot1Subject = '',
    slot2Subject = '',
    slot3Subject = ''
} = {}) {
    const today = getKstDateString();
    const cleanTheme = String(theme || '').trim().slice(0, 24);
    await setSystemConfig('study_daily_mission_theme', JSON.stringify({ date: today, theme: cleanTheme }));

    const { ensureTodayMissionsForChild } = require('./studyMissions.service');
    const profiles = await getProfiles();
    const targetIds = (!childId || childId === 'all')
        ? profiles.map((p) => p.id)
        : [normalizeChildId(childId)];

    const slotOverrides = [
        { slotIndex: 1, subject: slot1Subject ? normalizeSubject(slot1Subject) : '', allowed: ['korean', 'english'] },
        { slotIndex: 2, subject: slot2Subject ? normalizeSubject(slot2Subject) : '', allowed: ['math', 'logic'] },
        { slotIndex: 3, subject: slot3Subject ? normalizeSubject(slot3Subject) : '', allowed: ['reading', 'science', 'music', 'coloring'] }
    ];

    for (const cid of targetIds) {
        await ensureTodayMissionsForChild(cid);
        for (const ov of slotOverrides) {
            if (!ov.subject || !ov.allowed.includes(ov.subject)) continue;
            await dbRun(
                `UPDATE study_daily_missions
                 SET subject = ?, sheet_id = CASE WHEN subject = ? THEN sheet_id ELSE NULL END
                 WHERE child_id = ? AND mission_date = ? AND slot_index = ? AND status = 'pending'`,
                [ov.subject, ov.subject, cid, today, ov.slotIndex]
            );
        }
    }

    return getTodayMissionThemeConfig();
}

async function grantBonusSnackToChild({ childId, snackType, qty = 1 }) {
    await ensureSocialTables();
    const cid = normalizeChildId(childId);
    const profiles = await getProfiles();
    if (!profiles.some((p) => p.id === cid)) {
        throw new Error('지급할 아이 프로필을 찾을 수 없습니다.');
    }
    const meta = getSnackMeta(snackType);
    const cleanQty = Math.min(20, Math.max(1, Math.round(Number(qty) || 1)));
    await addSnackDelta(cid, meta.id, cleanQty);
    const snacks = await getSnackInventory(cid);
    return { childId: cid, snack: meta, qty: cleanQty, snacks };
}

async function forceEndPokemonVisit(visitId) {
    await ensureSocialTables();
    const id = Number(visitId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('올바른 방문 번호가 아닙니다.');
    const res = await dbRun(
        "UPDATE study_pokemon_visits SET status = 'ended' WHERE id = ? AND status = 'active'",
        [id]
    );
    if (res.changes === 0) throw new Error('이미 종료되었거나 존재하지 않는 방문 기록입니다.');
    return { ok: true, id };
}

async function getAdminOpsOverview() {
    await Promise.all([ensureSocialTables(), ensureOpsTables()]);
    const today = getKstDateString();
    const [flags, missionTheme, profiles, trades, visits, customColoringLogs, colorStatsRow] = await Promise.all([
        getStudyFeatureFlags(),
        getTodayMissionThemeConfig(),
        getProfiles(),
        dbAll(
            `SELECT t.*, fp.display_name AS from_name, fp.avatar_emoji AS from_emoji,
                    tp.display_name AS to_name, tp.avatar_emoji AS to_emoji
             FROM study_pokemon_trades t
             LEFT JOIN study_profiles fp ON fp.id = t.from_child_id
             LEFT JOIN study_profiles tp ON tp.id = t.to_child_id
             ORDER BY t.id DESC LIMIT 25`
        ),
        dbAll(
            `SELECT v.*, gp.display_name AS guest_name, gp.avatar_emoji AS guest_emoji,
                    hp.display_name AS host_name, hp.avatar_emoji AS host_emoji
             FROM study_pokemon_visits v
             LEFT JOIN study_profiles gp ON gp.id = v.guest_child_id
             LEFT JOIN study_profiles hp ON hp.id = v.host_child_id
             ORDER BY v.id DESC LIMIT 25`
        ),
        dbAll(
            `SELECT l.*, p.display_name AS child_name, p.avatar_emoji AS child_emoji
             FROM study_custom_coloring_logs l
             LEFT JOIN study_profiles p ON p.id = l.child_id
             ORDER BY l.id DESC LIMIT 30`
        ),
        dbGet(
            `SELECT COUNT(*) AS totalToday,
                    SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blockedToday
             FROM study_custom_coloring_logs
             WHERE DATE(created_at) = ?`,
            [today]
        )
    ]);

    const { getPokemonCondition } = require('./studyPokemonGrowth.service');
    const childrenSnacks = [];
    for (const p of profiles) {
        const [snacks, condition, partnerRow, shinyRow] = await Promise.all([
            getSnackInventory(p.id),
            getPokemonCondition(p.id).catch(() => null),
            dbGet(
                `SELECT a.level FROM study_pokemon_pokedex d
                 LEFT JOIN study_pokemon_affection a ON a.child_id = d.child_id AND a.pokemon_id = d.pokemon_id
                 WHERE d.child_id = ? ORDER BY d.is_partner DESC, d.last_hatched_at DESC LIMIT 1`,
                [p.id]
            ).catch(() => null),
            dbGet(
                'SELECT COUNT(*) AS cnt FROM study_pokemon_pokedex WHERE child_id = ? AND is_shiny = 1',
                [p.id]
            ).catch(() => null)
        ]);
        childrenSnacks.push({
            childId: p.id,
            displayName: p.display_name,
            avatarEmoji: p.avatar_emoji || '🧒',
            snacks,
            condition,
            partnerLevel: Number(partnerRow?.level || 1),
            shinyCount: Number(shinyRow?.cnt || 0)
        });
    }

    return {
        today,
        flags,
        missionTheme,
        snackCatalog: SNACK_CATALOG,
        childrenSnacks,
        trades,
        visits,
        customColoringLogs,
        customColoringStats: {
            totalToday: Number(colorStatsRow?.totalToday || 0),
            blockedToday: Number(colorStatsRow?.blockedToday || 0)
        }
    };
}

module.exports = {
    MISSION_THEME_PRESETS,
    ensureOpsTables,
    logCustomColoringAttempt,
    getStudyFeatureFlags,
    setStudyFeatureFlags,
    getTodayMissionThemeConfig,
    setTodayMissionTheme,
    grantBonusSnackToChild,
    forceEndPokemonVisit,
    getAdminOpsOverview
};
