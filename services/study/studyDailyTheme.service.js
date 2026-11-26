/**
 * ==============================================================================
 * 매일 1개 오늘의 학습 주제 자동 선정 & 미완료 시 다음 날 이월 서비스
 * (studyDailyTheme.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 한국어 | [규칙 3] 500줄 이하 모듈화
 * - 아이별로 매일 1가지 오늘의 주제를 자동 선정합니다.
 * - 해당 날에 문제 학습지를 1장도 풀지(완료하지) 않으면 다음 날에도 같은 주제가 이월됩니다.
 * - 완료한 다음 날에는 자동으로 다음 주제로 넘어갑니다.
 * ==============================================================================
 */

const {
    dbGet,
    dbRun,
    normalizeChildId,
    getKstDateString
} = require('./studyDb.service');

const DAILY_THEME_POOL = [
    { theme: '동물 친구', emoji: '🐾' },
    { theme: '공룡 탐험', emoji: '🦕' },
    { theme: '달콤 과일', emoji: '🍓' },
    { theme: '탈것 여행', emoji: '🚒' },
    { theme: '바다 친구', emoji: '🐳' },
    { theme: '우주 모험', emoji: '🚀' },
    { theme: '숲속 생물', emoji: '🦋' },
    { theme: '우리말 고운 낱말', emoji: '📖' },
    { theme: '색깔과 모양', emoji: '🎨' },
    { theme: '공주·요정', emoji: '👑' },
    { theme: '로봇·변신', emoji: '🤖' },
    { theme: '전통과 옛날 생활', emoji: '🎎' },
    { theme: '오늘 날씨와 계절', emoji: '⛅' },
    { theme: '맛있는 간식', emoji: '🍰' }
];

let tableReadyPromise = null;

function ensureDailyThemeTable() {
    if (tableReadyPromise) return tableReadyPromise;
    tableReadyPromise = dbRun(`
        CREATE TABLE IF NOT EXISTS study_daily_theme (
            child_id TEXT PRIMARY KEY,
            theme TEXT NOT NULL,
            emoji TEXT NOT NULL DEFAULT '🌟',
            theme_index INTEGER NOT NULL DEFAULT 0,
            assigned_date TEXT NOT NULL,
            completed_at DATETIME,
            completed_date TEXT,
            carried_over INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `).catch((err) => {
        tableReadyPromise = null;
        throw err;
    });
    return tableReadyPromise;
}

function getPoolEntry(idx) {
    const safeIdx = ((Number(idx) || 0) % DAILY_THEME_POOL.length + DAILY_THEME_POOL.length) % DAILY_THEME_POOL.length;
    return { index: safeIdx, ...DAILY_THEME_POOL[safeIdx] };
}

function formatState(row, today) {
    const completedToday = Boolean(row.completed_date && row.completed_date === today);
    const carriedOver = Boolean(row.carried_over) && !completedToday;
    return {
        theme: row.theme,
        emoji: row.emoji || '🌟',
        themeIndex: Number(row.theme_index || 0),
        assignedDate: row.assigned_date,
        completedToday,
        carriedOver
    };
}

/**
 * 아이별 오늘의 주제를 조회하고, 날짜 변경 및 미완료 이월 상태를 갱신합니다.
 */
async function getDailyThemeState(childId) {
    await ensureDailyThemeTable();
    const cid = normalizeChildId(childId);
    const today = getKstDateString();

    const row = await dbGet('SELECT * FROM study_daily_theme WHERE child_id = ?', [cid]);
    if (!row) {
        const entry = getPoolEntry(0);
        await dbRun(
            `INSERT INTO study_daily_theme (child_id, theme, emoji, theme_index, assigned_date, carried_over)
             VALUES (?, ?, ?, ?, ?, 0)`,
            [cid, entry.theme, entry.emoji, entry.index, today]
        );
        return formatState({
            theme: entry.theme,
            emoji: entry.emoji,
            theme_index: entry.index,
            assigned_date: today,
            completed_date: null,
            carried_over: 0
        }, today);
    }

    // 1) 아직 한 번도 안 푼 주제인 경우
    if (!row.completed_at) {
        // 어제(또는 그 이전) 배정된 주제를 안 풀었으면 다음 날로 그대로 이월
        if (row.assigned_date < today && !row.carried_over) {
            await dbRun(
                `UPDATE study_daily_theme
                 SET carried_over = 1, updated_at = datetime('now', 'localtime')
                 WHERE child_id = ?`,
                [cid]
            );
            row.carried_over = 1;
        }
        return formatState(row, today);
    }

    // 2) 오늘 이미 완료한 경우: 오늘 안에는 완료 상태로 유지
    if (row.completed_date === today) {
        return formatState(row, today);
    }

    // 3) 이전 날에 완료했고 오늘 새로 접속한 경우 -> 다음 주제로 이동!
    const nextEntry = getPoolEntry((Number(row.theme_index) || 0) + 1);
    await dbRun(
        `UPDATE study_daily_theme
         SET theme = ?, emoji = ?, theme_index = ?, assigned_date = ?,
             completed_at = NULL, completed_date = NULL, carried_over = 0,
             updated_at = datetime('now', 'localtime')
         WHERE child_id = ?`,
        [nextEntry.theme, nextEntry.emoji, nextEntry.index, today, cid]
    );
    return formatState({
        theme: nextEntry.theme,
        emoji: nextEntry.emoji,
        theme_index: nextEntry.index,
        assigned_date: today,
        completed_date: null,
        carried_over: 0
    }, today);
}

/**
 * 문제 학습지를 완료했을 때 오늘의 주제를 완료 처리합니다. (색칠놀이는 제외)
 */
async function markDailyThemeCompleted(childId) {
    const cid = normalizeChildId(childId);
    const today = getKstDateString();
    const current = await getDailyThemeState(cid);
    if (!current.completedToday) {
        await dbRun(
            `UPDATE study_daily_theme
             SET completed_at = datetime('now', 'localtime'),
                 completed_date = ?,
                 carried_over = 0,
                 updated_at = datetime('now', 'localtime')
             WHERE child_id = ?`,
            [today, cid]
        );
    }
    return getDailyThemeState(cid);
}

module.exports = {
    DAILY_THEME_POOL,
    getDailyThemeState,
    markDailyThemeCompleted
};
