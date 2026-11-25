/**
 * ==============================================================================
 * 오늘의 3종 미션 & 오답 자동 복습 섞기 서비스 (studyMissions.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const {
    dbGet,
    dbAll,
    dbRun,
    normalizeChildId,
    normalizeSubject,
    getKstDateString,
    getSystemConfig,
    getProfiles
} = require('./studyDb.service');
const { awardStamp } = require('./studyStamps.service');

const MISSION_SLOT_DEFS = [
    {
        slotIndex: 1,
        slotKey: 'foundation',
        title: '기초 탄탄 한글·영어',
        description: '한글이나 영어 학습지 1장 풀기',
        emoji: '🔤',
        accepted: ['korean', 'english']
    },
    {
        slotIndex: 2,
        slotKey: 'math_logic',
        title: '생각 쑥쑥 수학·퍼즐',
        description: '수학 또는 두뇌 퍼즐 1장 풀기',
        emoji: '🧩',
        accepted: ['math', 'logic']
    },
    {
        slotIndex: 3,
        slotKey: 'explore',
        title: '동화·과학·피아노·색칠',
        description: '동화책·과학·피아노·색칠 중 1개 즐기기',
        emoji: '📚',
        accepted: ['reading', 'science', 'music', 'coloring']
    }
];

const MIXABLE_BLOCK_TYPES = new Set(['quiz', 'count', 'match', 'clock', 'coins', 'hangul_tiles', 'phonics_blend', 'pattern', 'picture_sudoku', 'tangram_grid']);

let missionTablesPromise = null;

function ensureMissionTables() {
    if (missionTablesPromise) return missionTablesPromise;
    missionTablesPromise = (async () => {
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_daily_missions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                mission_date TEXT NOT NULL,
                slot_index INTEGER NOT NULL,
                slot_key TEXT NOT NULL,
                subject TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                emoji TEXT DEFAULT '🌟',
                sheet_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                completed_at DATETIME,
                created_at DATETIME DEFAULT (datetime('now', 'localtime')),
                UNIQUE (child_id, mission_date, slot_index)
            )
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_daily_mission_bonus (
                child_id TEXT NOT NULL,
                mission_date TEXT NOT NULL,
                bonus_stamps INTEGER NOT NULL DEFAULT 1,
                bonus_snacks INTEGER NOT NULL DEFAULT 1,
                claimed_at DATETIME DEFAULT (datetime('now', 'localtime')),
                PRIMARY KEY (child_id, mission_date)
            )
        `);
        await dbRun('CREATE INDEX IF NOT EXISTS idx_study_missions_child_date ON study_daily_missions (child_id, mission_date)').catch(() => {});
    })().catch((err) => {
        missionTablesPromise = null;
        throw err;
    });
    return missionTablesPromise;
}

async function pickDefaultSubjectsForToday(childId, todayKst) {
    const [weekRows, pianoVoiceRaw] = await Promise.all([
        dbAll(
            `SELECT subject, COUNT(*) AS cnt FROM study_sheets
             WHERE child_id = ? AND DATE(created_at) >= DATE(?, '-7 days')
             GROUP BY subject`,
            [childId, todayKst]
        ),
        getSystemConfig('study_piano_voice_enabled', '1')
    ]);
    const countMap = new Map(weekRows.map((r) => [r.subject, Number(r.cnt || 0)]));
    const dayNum = Number(todayKst.slice(-2)) || 1;
    const slot1Subj = (countMap.get('english') || 0) < (countMap.get('korean') || 0) ? 'english' : 'korean';
    const slot2Subj = dayNum % 2 === 0 ? 'logic' : 'math';
    const explorePool = pianoVoiceRaw === '0'
        ? ['reading', 'science', 'coloring']
        : ['reading', 'science', 'music', 'coloring'];
    const slot3Subj = explorePool[dayNum % explorePool.length];
    return [slot1Subj, slot2Subj, slot3Subj];
}

async function ensureTodayMissionsForChild(childId) {
    await ensureMissionTables();
    const cid = normalizeChildId(childId);
    const today = getKstDateString();

    const existing = await dbAll(
        'SELECT * FROM study_daily_missions WHERE child_id = ? AND mission_date = ? ORDER BY slot_index ASC',
        [cid, today]
    );
    if (existing.length >= 3) return existing;

    const defaults = await pickDefaultSubjectsForToday(cid, today);
    for (let i = 0; i < MISSION_SLOT_DEFS.length; i++) {
        const def = MISSION_SLOT_DEFS[i];
        await dbRun(
            `INSERT OR IGNORE INTO study_daily_missions
             (child_id, mission_date, slot_index, slot_key, subject, title, description, emoji, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [cid, today, def.slotIndex, def.slotKey, defaults[i], def.title, def.description, def.emoji]
        );
    }

    return dbAll(
        'SELECT * FROM study_daily_missions WHERE child_id = ? AND mission_date = ? ORDER BY slot_index ASC',
        [cid, today]
    );
}

async function getDailyMissionsState(childId) {
    const enabled = (await getSystemConfig('study_daily_missions_enabled', '1')) !== '0';
    const phase3SubjectsEnabled = (await getSystemConfig('study_phase3_subjects_enabled', '1')) !== '0';
    if (!enabled) {
        return { enabled: false, phase3SubjectsEnabled, missions: [], bonus: null };
    }

    const cid = normalizeChildId(childId);
    const today = getKstDateString();
    const rows = await ensureTodayMissionsForChild(cid);
    const bonusRow = await dbGet(
        'SELECT * FROM study_daily_mission_bonus WHERE child_id = ? AND mission_date = ?',
        [cid, today]
    );

    const missions = rows.map((row) => {
        const def = MISSION_SLOT_DEFS.find((d) => d.slotIndex === Number(row.slot_index)) || MISSION_SLOT_DEFS[0];
        return {
            id: row.id,
            slotIndex: Number(row.slot_index),
            slotKey: row.slot_key,
            subject: row.subject,
            title: row.title,
            description: row.description,
            emoji: row.emoji,
            acceptedSubjects: def.accepted,
            sheetId: row.sheet_id ? Number(row.sheet_id) : null,
            status: row.status,
            completedAt: row.completed_at || null
        };
    });

    const completedCount = missions.filter((m) => m.status === 'completed').length;
    return {
        enabled: true,
        phase3SubjectsEnabled,
        missionDate: today,
        completedCount,
        totalCount: missions.length,
        allCompleted: completedCount >= missions.length,
        bonusClaimed: Boolean(bonusRow),
        bonus: bonusRow || null,
        missions
    };
}

async function startDailyMission(childId, slotIndex, preferredSubject = '', createdBy = 'kid') {
    const cid = normalizeChildId(childId);
    const idx = Math.min(3, Math.max(1, Number(slotIndex) || 1));
    const missions = await ensureTodayMissionsForChild(cid);
    const row = missions.find((m) => Number(m.slot_index) === idx);
    const def = MISSION_SLOT_DEFS.find((d) => d.slotIndex === idx) || MISSION_SLOT_DEFS[0];

    const cleanPref = preferredSubject ? normalizeSubject(preferredSubject) : '';
    const targetSubject = (cleanPref && def.accepted.includes(cleanPref)) ? cleanPref : (row?.subject || def.accepted[0]);

    if (row && row.status === 'pending' && row.sheet_id && row.subject === targetSubject) {
        const existingSheet = await dbGet('SELECT id, completed_at FROM study_sheets WHERE id = ?', [row.sheet_id]);
        if (existingSheet && !existingSheet.completed_at) {
            return { sheetId: Number(existingSheet.id), subject: targetSubject, reused: true, url: `/study/sheet/${existingSheet.id}` };
        }
    }

    const { generateAndSaveWorksheet } = require('./geminiWorksheet.service');
    const { getTodayMissionThemeConfig } = require('./studyOpsAdmin.service');
    const pianoVoiceRaw = await getSystemConfig('study_piano_voice_enabled', '1');
    const safeSubject = (targetSubject === 'music' && pianoVoiceRaw === '0') ? 'reading' : targetSubject;
    const missionThemeCfg = await getTodayMissionThemeConfig().catch(() => ({ theme: '' }));
    const themes = ['동물 친구', '공룡 탐험', '우주 모험', '바다 친구', '달콤 과일'];
    const theme = missionThemeCfg.theme || themes[Math.floor(Math.random() * themes.length)];
    const sheet = await generateAndSaveWorksheet({
        childId: cid,
        subject: safeSubject,
        theme,
        createdBy,
        includePlayBlock: true,
        coloringMode: 'auto_3'
    });

    if (row && row.status === 'pending') {
        await dbRun(
            'UPDATE study_daily_missions SET subject = ?, sheet_id = ? WHERE id = ?',
            [safeSubject, Number(sheet.id), row.id]
        );
    }

    return { sheetId: Number(sheet.id), subject: safeSubject, reused: false, url: `/study/sheet/${sheet.id}` };
}

async function markMissionProgressForSheet(sheet) {
    if (!sheet || !sheet.child_id || !sheet.subject) return null;
    const enabled = (await getSystemConfig('study_daily_missions_enabled', '1')) !== '0';
    if (!enabled) return null;

    const cid = normalizeChildId(sheet.child_id);
    const subj = normalizeSubject(sheet.subject);
    const today = getKstDateString();
    const rows = await ensureTodayMissionsForChild(cid);

    const matchingDef = MISSION_SLOT_DEFS.find((d) => d.accepted.includes(subj));
    if (!matchingDef) return null;

    const targetRow = rows.find((r) => Number(r.slot_index) === matchingDef.slotIndex);
    let slotCompletedNow = false;
    if (targetRow && targetRow.status !== 'completed') {
        await dbRun(
            `UPDATE study_daily_missions
             SET status = 'completed', subject = ?, sheet_id = ?, completed_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [subj, Number(sheet.id), targetRow.id]
        );
        slotCompletedNow = true;
    }

    const updatedRows = await dbAll(
        'SELECT status FROM study_daily_missions WHERE child_id = ? AND mission_date = ?',
        [cid, today]
    );
    const allCompleted = updatedRows.length >= 3 && updatedRows.every((r) => r.status === 'completed');

    let bonusGranted = false;
    let bonusMessage = '';
    if (allCompleted) {
        const alreadyBonus = await dbGet(
            'SELECT child_id FROM study_daily_mission_bonus WHERE child_id = ? AND mission_date = ?',
            [cid, today]
        );
        if (!alreadyBonus) {
            await dbRun(
                'INSERT OR IGNORE INTO study_daily_mission_bonus (child_id, mission_date, bonus_stamps, bonus_snacks) VALUES (?, ?, 1, 1)',
                [cid, today]
            );
            await awardStamp({
                childId: cid,
                sourceType: 'online',
                note: '🚀 오늘의 3종 미션 올클리어 보너스!'
            }).catch(() => {});
            try {
                const { addSnackDelta } = require('./studyPokemonSocial.service');
                await addSnackDelta(cid, 'star_candy', 1);
            } catch (_) {}
            bonusGranted = true;
            bonusMessage = '🚀 오늘의 3종 미션 모두 완료! 보너스 칭찬 도장 ⭐ + 별사탕 🍬 1개를 받았어요!';
        }
    }

    return { slotIndex: matchingDef.slotIndex, slotCompletedNow, allCompleted, bonusGranted, bonusMessage };
}

async function injectRecentWrongReviews(childId, subject, sheet) {
    if (!sheet || !Array.isArray(sheet.blocks) || sheet.blocks.length < 4) return sheet;
    const subj = normalizeSubject(subject);
    if (!['korean', 'math', 'english'].includes(subj)) return sheet;

    const mixEnabled = (await getSystemConfig('study_wrong_review_mix_enabled', '1')) !== '0';
    if (!mixEnabled) return sheet;

    const cid = normalizeChildId(childId);
    let rows = [];
    try {
        rows = await dbAll(
            `SELECT id, block_json FROM study_wrong_notes
             WHERE child_id = ? AND subject = ? AND status = 'pending'
               AND datetime(last_wrong_at) >= datetime('now', 'localtime', '-7 days')
             ORDER BY last_wrong_at DESC LIMIT 2`,
            [cid, subj]
        );
    } catch (_) {
        return sheet;
    }
    if (!rows.length) return sheet;

    const blocks = [...sheet.blocks];
    const replaceSlots = [1, 3];
    let used = 0;

    for (const row of rows) {
        if (used >= replaceSlots.length) break;
        try {
            const parsed = JSON.parse(row.block_json);
            if (!parsed || !MIXABLE_BLOCK_TYPES.has(parsed.type)) continue;
            const slot = replaceSlots[used];
            if (!blocks[slot]) continue;
            blocks[slot] = {
                ...parsed,
                id: `review-${row.id}`,
                isWrongReview: true,
                reviewBadge: '🔁 지난번 헷갈렸던 문제 복습!'
            };
            used += 1;
        } catch (_) {}
    }

    return { ...sheet, blocks };
}

async function getAdminMissionsOverview() {
    await ensureMissionTables();
    const today = getKstDateString();
    const profiles = await getProfiles();
    const [missionsEnabled, phase3Enabled, wrongMixEnabled] = await Promise.all([
        getSystemConfig('study_daily_missions_enabled', '1'),
        getSystemConfig('study_phase3_subjects_enabled', '1'),
        getSystemConfig('study_wrong_review_mix_enabled', '1')
    ]);

    const perChild = [];
    for (const p of profiles) {
        const state = await getDailyMissionsState(p.id);
        perChild.push({
            childId: p.id,
            displayName: p.display_name,
            avatarEmoji: p.avatar_emoji || '🧒',
            completedCount: state.completedCount || 0,
            totalCount: state.totalCount || 3,
            bonusClaimed: Boolean(state.bonusClaimed),
            missions: state.missions || []
        });
    }

    const recentBonuses = await dbAll(
        `SELECT b.*, p.display_name, p.avatar_emoji
         FROM study_daily_mission_bonus b
         LEFT JOIN study_profiles p ON p.id = b.child_id
         ORDER BY b.mission_date DESC, b.claimed_at DESC LIMIT 14`
    );

    return {
        today,
        config: {
            dailyMissionsEnabled: missionsEnabled !== '0',
            phase3SubjectsEnabled: phase3Enabled !== '0',
            wrongReviewMixEnabled: wrongMixEnabled !== '0'
        },
        perChild,
        recentBonuses
    };
}

module.exports = {
    ensureMissionTables,
    ensureTodayMissionsForChild,
    getDailyMissionsState,
    startDailyMission,
    markMissionProgressForSheet,
    injectRecentWrongReviews,
    getAdminMissionsOverview
};
