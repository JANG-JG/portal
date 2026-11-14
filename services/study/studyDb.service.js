/**
 * ==============================================================================
 * 어린이 학습실 DB & 도장판·레벨·할당량 관리 서비스 (studyDb.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스
 * [규칙 3] portalDb 통합 저장 & 500줄 이하 모듈화
 * ==============================================================================
 */

const crypto = require('crypto');
const { portalDb } = require('../db');
const { sendServerTelegram } = require('../telegramAlert.service');

const VALID_CHILDREN = new Set(['first', 'second']);
const VALID_SUBJECTS = new Set(['korean', 'math', 'english']);

const SUBJECT_NAMES = {
    korean: '한글 놀이',
    math: '숫자·수학 놀이',
    english: '영어 놀이'
};

function getKstDateString(offsetDays = 0) {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 86400000);
    return now.toISOString().slice(0, 10);
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
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

function normalizeChildId(input) {
    const val = String(input || '').trim().toLowerCase();
    if (val === 'first' || val === '1' || val === '첫째') return 'first';
    if (val === 'second' || val === '2' || val === '둘째') return 'second';
    return 'first';
}

function normalizeSubject(input) {
    const val = String(input || '').trim().toLowerCase();
    if (val === 'korean' || val === '한글') return 'korean';
    if (val === 'math' || val === '수학') return 'math';
    if (val === 'english' || val === '영어') return 'english';
    return 'korean';
}

function clampLevel(level) {
    const num = Number(level);
    if (!Number.isFinite(num)) return 1;
    return Math.min(5, Math.max(1, Math.round(num)));
}

async function getSystemConfig(key, defaultValue = '') {
    const row = await dbGet('SELECT value FROM system_configs WHERE key = ?', [key]);
    return row && row.value !== null && row.value !== undefined ? row.value : defaultValue;
}

async function setSystemConfig(key, value) {
    await dbRun(
        'INSERT INTO system_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(value)]
    );
}

async function getProfiles() {
    const rows = await dbAll('SELECT * FROM study_profiles ORDER BY birth_year ASC, id ASC');
    return rows;
}

async function getChildLevels(childId) {
    const cid = normalizeChildId(childId);
    const rows = await dbAll('SELECT subject, level, updated_at FROM study_levels WHERE child_id = ?', [cid]);
    const levels = { korean: 1, math: 1, english: 1 };
    rows.forEach((r) => {
        if (VALID_SUBJECTS.has(r.subject)) {
            levels[r.subject] = clampLevel(r.level);
        }
    });
    return levels;
}

async function setChildLevel(childId, subject, level) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    const clamped = clampLevel(level);
    await dbRun(
        `INSERT INTO study_levels (child_id, subject, level, updated_at)
         VALUES (?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(child_id, subject) DO UPDATE SET level = excluded.level, updated_at = datetime('now', 'localtime')`,
        [cid, subj, clamped]
    );
    return clamped;
}

async function adjustChildLevel(childId, subject, delta) {
    const levels = await getChildLevels(childId);
    const subj = normalizeSubject(subject);
    const next = clampLevel((levels[subj] || 1) + Number(delta || 0));
    return setChildLevel(childId, subj, next);
}

async function getActiveStampBoard(childId) {
    const cid = normalizeChildId(childId);
    const maxRow = await dbGet('SELECT MAX(cycle_no) as maxCycle, COUNT(*) as totalEarned FROM study_stamps WHERE child_id = ?', [cid]);
    const totalEarned = maxRow?.totalEarned || 0;
    let currentCycle = maxRow?.maxCycle || 1;
    let stamps = await dbAll(
        'SELECT id, source_type, sheet_id, note, earned_at FROM study_stamps WHERE child_id = ? AND cycle_no = ? ORDER BY id ASC',
        [cid, currentCycle]
    );
    if (stamps.length >= 10) {
        // 직전 사이클이 10칸 완성 상태이면 요약 정보로 표시하되, 새 도장 적립 시 cycle + 1
        return {
            cycleNo: currentCycle,
            earnedCount: stamps.length,
            totalEarned,
            completedCycles: Math.floor(totalEarned / 10),
            isFull: true,
            stamps
        };
    }
    return {
        cycleNo: currentCycle,
        earnedCount: stamps.length,
        totalEarned,
        completedCycles: Math.floor(totalEarned / 10),
        isFull: false,
        stamps
    };
}

async function awardStamp({ childId, sourceType = 'online', sheetId = null, note = '' }) {
    const cid = normalizeChildId(childId);
    const cleanSource = sourceType === 'paper' ? 'paper' : 'online';

    if (sheetId) {
        const already = await dbGet(
            'SELECT id FROM study_stamps WHERE child_id = ? AND sheet_id = ?',
            [cid, Number(sheetId)]
        );
        if (already) {
            await dbRun(
                "UPDATE study_sheets SET completed_at = COALESCE(completed_at, datetime('now', 'localtime')) WHERE id = ?",
                [Number(sheetId)]
            );
            const board = await getActiveStampBoard(cid);
            return { alreadyAwarded: true, reachedTen: false, board };
        }
    }

    const boardBefore = await getActiveStampBoard(cid);
    const targetCycle = boardBefore.isFull ? boardBefore.cycleNo + 1 : boardBefore.cycleNo;

    const cleanNote = note
        ? String(note).slice(0, 80)
        : (cleanSource === 'paper' ? '종이 학습지 스스로 완료' : '태블릿 학습지 완료');

    await dbRun(
        'INSERT INTO study_stamps (child_id, cycle_no, source_type, sheet_id, note) VALUES (?, ?, ?, ?, ?)',
        [cid, targetCycle, cleanSource, sheetId ? Number(sheetId) : null, cleanNote]
    );

    if (sheetId) {
        await dbRun(
            "UPDATE study_sheets SET completed_at = datetime('now', 'localtime') WHERE id = ?",
            [Number(sheetId)]
        );
    }

    const boardAfter = await getActiveStampBoard(cid);
    const reachedTen = boardAfter.earnedCount === 10;

    if (reachedTen) {
        const profile = await dbGet('SELECT display_name, target_reward FROM study_profiles WHERE id = ?', [cid]);
        const childLabel = profile?.display_name || (cid === 'first' ? '첫째' : '둘째');
        const reward = profile?.target_reward || '칭찬 선물';
        sendServerTelegram(
            `🎉 <b>[어린이 학습실] ${childLabel} 칭찬 도장판 10칸 완성!</b>\n` +
            `• 총 누적 도장: ${boardAfter.totalEarned}개 (${boardAfter.completedCycles}번째 도장판 달성)\n` +
            `• 약속한 보상: <b>${reward}</b>\n` +
            `아이에게 크게 칭찬하고 선물을 챙겨주세요! 🌟`
        ).catch(() => {});
    }

    return { alreadyAwarded: false, reachedTen, board: boardAfter };
}

async function getWeeklyBalanceRecommendation(childId) {
    const cid = normalizeChildId(childId);
    const sinceDate = getKstDateString(-6);
    const rows = await dbAll(
        `SELECT subject, COUNT(*) as cnt
         FROM study_sheets
         WHERE child_id = ? AND substr(created_at, 1, 10) >= ?
         GROUP BY subject`,
        [cid, sinceDate]
    );
    const counts = { korean: 0, math: 0, english: 0 };
    rows.forEach((r) => {
        if (VALID_SUBJECTS.has(r.subject)) counts[r.subject] = Number(r.cnt || 0);
    });

    const ordered = ['korean', 'math', 'english'].sort((a, b) => counts[a] - counts[b]);
    const recommended = ordered[0];
    const reason = counts[recommended] === 0
        ? `이번 주에 아직 '${SUBJECT_NAMES[recommended]}'을 안 했어요! 오늘 도전해 볼까요?`
        : `이번 주 '${SUBJECT_NAMES[recommended]}' 횟수(${counts[recommended]}회)가 가장 적어 균형 추천해요!`;

    return {
        counts,
        recommendedSubject: recommended,
        recommendedName: SUBJECT_NAMES[recommended],
        reason
    };
}

async function saveWorksheet({ childId, subject, level, theme, title, source = 'gemini', content, createdBy = 'web' }) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    const lv = clampLevel(level);
    const jsonStr = typeof content === 'string' ? content : JSON.stringify(content);
    const res = await dbRun(
        `INSERT INTO study_sheets (child_id, subject, level, theme, title, source, content_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cid, subj, lv, String(theme || '동물 친구'), String(title || '오늘의 학습지'), source, jsonStr, createdBy]
    );
    return res.lastID;
}

async function getWorksheetById(sheetId) {
    const row = await dbGet('SELECT * FROM study_sheets WHERE id = ?', [Number(sheetId)]);
    if (!row) return null;
    let content = null;
    try {
        content = JSON.parse(row.content_json);
    } catch (e) {
        content = null;
    }
    return { ...row, content };
}

async function updateWorksheetContent(sheetId, contentObj) {
    await dbRun(
        'UPDATE study_sheets SET content_json = ? WHERE id = ?',
        [JSON.stringify(contentObj), Number(sheetId)]
    );
}

async function listRecentWorksheets(childId, limit = 16) {
    const cid = normalizeChildId(childId);
    return dbAll(
        `SELECT id, child_id, subject, level, theme, title, source, completed_at, created_by, created_at
         FROM study_sheets
         WHERE child_id = ?
         ORDER BY id DESC
         LIMIT ?`,
        [cid, Number(limit)]
    );
}

async function getChildDashboardState(childId) {
    const cid = normalizeChildId(childId);
    const profiles = await getProfiles();
    const profile = profiles.find((p) => p.id === cid) || profiles[0];
    const levels = await getChildLevels(cid);
    const stampBoard = await getActiveStampBoard(cid);
    const weeklyBalance = await getWeeklyBalanceRecommendation(cid);
    const recentSheets = await listRecentWorksheets(cid, 16);
    const hasParentPin = Boolean(await getSystemConfig('study_parent_pin', ''));
    const quota = await getDailyQuotaStatus();

    return {
        profiles,
        activeChild: profile,
        levels,
        stampBoard,
        weeklyBalance,
        recentSheets,
        hasParentPin,
        quota
    };
}

async function getDailyQuotaLimit() {
    const cfg = await getSystemConfig('study_daily_gemini_limit', '');
    const parsed = Number(cfg || process.env.STUDY_GEMINI_DAILY_LIMIT || 30);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(500, Math.round(parsed)) : 30;
}

async function getDailyQuotaStatus(dateStr = getKstDateString()) {
    const dailyLimit = await getDailyQuotaLimit();
    const row = await dbGet('SELECT * FROM study_daily_quota WHERE quota_date = ?', [dateStr]);
    const geminiCalls = row ? Number(row.gemini_calls || 0) : 0;
    const fallbackCalls = row ? Number(row.fallback_calls || 0) : 0;
    return {
        date: dateStr,
        geminiCalls,
        fallbackCalls,
        dailyLimit,
        remaining: Math.max(0, dailyLimit - geminiCalls)
    };
}

async function tryConsumeGeminiQuota() {
    const dateStr = getKstDateString();
    const dailyLimit = await getDailyQuotaLimit();
    await dbRun(
        `INSERT OR IGNORE INTO study_daily_quota (quota_date, gemini_calls, fallback_calls, daily_limit)
         VALUES (?, 0, 0, ?)`,
        [dateStr, dailyLimit]
    );
    const res = await dbRun(
        `UPDATE study_daily_quota
         SET gemini_calls = gemini_calls + 1, daily_limit = ?, updated_at = datetime('now', 'localtime')
         WHERE quota_date = ? AND gemini_calls < ?`,
        [dailyLimit, dateStr, dailyLimit]
    );
    return res.changes > 0;
}

async function recordFallbackUsage() {
    const dateStr = getKstDateString();
    const dailyLimit = await getDailyQuotaLimit();
    await dbRun(
        `INSERT INTO study_daily_quota (quota_date, gemini_calls, fallback_calls, daily_limit, updated_at)
         VALUES (?, 0, 1, ?, datetime('now', 'localtime'))
         ON CONFLICT(quota_date) DO UPDATE SET fallback_calls = fallback_calls + 1, updated_at = datetime('now', 'localtime')`,
        [dateStr, dailyLimit]
    );
}

function hashPin(pin) {
    return crypto.createHash('sha256').update(`jg-study-parent-pin:${String(pin).trim()}`).digest('hex');
}

async function verifyParentLockPin(inputPin) {
    const saved = await getSystemConfig('study_parent_pin', '');
    if (!saved) return { configured: false, valid: true };
    const valid = hashPin(inputPin) === saved;
    return { configured: true, valid };
}

async function setParentLockPin(newPin) {
    const clean = String(newPin || '').trim();
    if (!clean) {
        await setSystemConfig('study_parent_pin', '');
        return { configured: false };
    }
    if (!/^\d{4,6}$/.test(clean)) {
        throw new Error('부모 잠금 PIN은 숫자 4~6자리로 입력해 주세요.');
    }
    await setSystemConfig('study_parent_pin', hashPin(clean));
    return { configured: true };
}

module.exports = {
    VALID_CHILDREN,
    VALID_SUBJECTS,
    SUBJECT_NAMES,
    getKstDateString,
    dbGet,
    dbAll,
    dbRun,
    normalizeChildId,
    normalizeSubject,
    clampLevel,
    getSystemConfig,
    setSystemConfig,
    getProfiles,
    getChildLevels,
    setChildLevel,
    adjustChildLevel,
    getActiveStampBoard,
    awardStamp,
    getWeeklyBalanceRecommendation,
    saveWorksheet,
    getWorksheetById,
    updateWorksheetContent,
    listRecentWorksheets,
    getChildDashboardState,
    getDailyQuotaStatus,
    tryConsumeGeminiQuota,
    recordFallbackUsage,
    verifyParentLockPin,
    setParentLockPin
};
