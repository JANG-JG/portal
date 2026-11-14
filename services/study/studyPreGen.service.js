/**
 * ==============================================================================
 * AI 학습지 사전 생성 & TTS 서버 워밍 스케줄러 (studyPreGen.service.js)
 * ------------------------------------------------------------------------------
 * - 아이별·영역별 기본 테마('동물 친구') 학습지를 백그라운드에서 미리 1장씩 대기 큐에 준비
 * - 학습지 생성 요청 시 조건(레벨·테마·놀이포함)이 일치하면 대기 없이 <10ms 즉시 발급 후 보충
 * - 생성/사전생성된 학습지의 블록별 음성(TTS)을 data/tts-cache에 순차 사전 워밍
 * - [규칙 3] 500줄 이하 모듈화 | 일일 Gemini 할당량 예비분(4장) 보호
 * ==============================================================================
 */

const cron = require('node-cron');
const { portalDb } = require('../db');
const {
    normalizeChildId,
    normalizeSubject,
    getProfiles,
    getChildLevels,
    saveWorksheet,
    getSystemConfig,
    setSystemConfig
} = require('./studyDb.service');
const { generateWorksheetPayload } = require('./geminiWorksheet.service');
const { synthesizeStudySpeech, hasCachedTts, getTtsCacheStats } = require('./studyTts.service');

const PREGEN_ENABLED_KEY = 'study_pregen_enabled';
const PREGEN_LAST_RUN_KEY = 'study_pregen_last_run';
const PREGEN_LAST_SUMMARY_KEY = 'study_pregen_last_summary';
const DEFAULT_PREGEN_THEME = '동물 친구';
const PREGEN_SUBJECTS = ['korean', 'math', 'english'];
const MAX_BUFFER_PER_SLOT = 1;
const RESERVE_DAILY_QUOTA = 4;

let tableReadyPromise = null;
let cronTask = null;
let workerRunning = false;
const pendingSlots = new Map();

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

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

function ensurePreGenTable() {
    if (tableReadyPromise) return tableReadyPromise;
    tableReadyPromise = (async () => {
        await dbRun(
            `CREATE TABLE IF NOT EXISTS study_pregen_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                subject TEXT NOT NULL,
                level INTEGER NOT NULL,
                theme TEXT NOT NULL DEFAULT '동물 친구',
                include_play_block INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                content_json TEXT NOT NULL,
                tts_warmed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            )`
        );
        await dbRun(
            `CREATE INDEX IF NOT EXISTS idx_study_pregen_lookup
             ON study_pregen_queue(child_id, subject, level, theme, include_play_block)`
        );
    })().catch((err) => {
        tableReadyPromise = null;
        throw err;
    });
    return tableReadyPromise;
}

async function isPreGenEnabled() {
    const val = await getSystemConfig(PREGEN_ENABLED_KEY, 'true');
    return String(val).toLowerCase() !== 'false';
}

async function setPreGenEnabled(enabled) {
    const clean = enabled ? 'true' : 'false';
    await setSystemConfig(PREGEN_ENABLED_KEY, clean);
    return enabled === true;
}

async function warmWorksheetTts(contentOrSheet) {
    const content = contentOrSheet && contentOrSheet.content ? contentOrSheet.content : contentOrSheet;
    const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
    const seen = new Set();
    const entries = [];

    for (const blk of blocks) {
        const text = String(blk?.ttsText || blk?.prompt || '').trim();
        const lang = String(blk?.ttsLang || 'ko-KR').trim() || 'ko-KR';
        if (!text) continue;
        const key = `${lang}:${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ text, lang });
    }

    let warmed = 0;
    let cachedHit = 0;
    for (const item of entries) {
        try {
            if (hasCachedTts(item.text, item.lang)) {
                cachedHit += 1;
                continue;
            }
            const res = await synthesizeStudySpeech(item.text, item.lang);
            if (res && res.ok) warmed += 1;
            await new Promise((r) => setTimeout(r, 60));
        } catch (e) {}
    }

    return { total: entries.length, warmed, cachedHit };
}

async function pruneStaleQueueRows(childId, subject, currentLevel) {
    await ensurePreGenTable();
    await dbRun(
        `DELETE FROM study_pregen_queue WHERE child_id = ? AND subject = ? AND level != ?`,
        [childId, subject, Number(currentLevel)]
    );
}

async function consumePregeneratedWorksheet({
    childId,
    subject,
    theme = DEFAULT_PREGEN_THEME,
    includePlayBlock = true,
    createdBy = 'web'
}) {
    if (!(await isPreGenEnabled())) return null;
    await ensurePreGenTable();

    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    if (!PREGEN_SUBJECTS.includes(subj)) return null;

    const cleanTheme = String(theme || DEFAULT_PREGEN_THEME).trim().slice(0, 24) || DEFAULT_PREGEN_THEME;
    const playFlag = includePlayBlock !== false ? 1 : 0;
    const levels = await getChildLevels(cid);
    const level = levels[subj] || 1;

    await pruneStaleQueueRows(cid, subj, level);

    const row = await dbGet(
        `SELECT * FROM study_pregen_queue
         WHERE child_id = ? AND subject = ? AND level = ? AND theme = ? AND include_play_block = ?
         ORDER BY id ASC LIMIT 1`,
        [cid, subj, level, cleanTheme, playFlag]
    );
    if (!row) return null;

    const del = await dbRun('DELETE FROM study_pregen_queue WHERE id = ?', [row.id]);
    if (!del.changes) return null;

    let content = null;
    try { content = JSON.parse(row.content_json); } catch (e) { content = null; }
    if (!content) return null;

    const sheetId = await saveWorksheet({
        childId: cid,
        subject: subj,
        level,
        theme: cleanTheme,
        title: row.title,
        source: row.source,
        content,
        createdBy
    });

    if (!row.tts_warmed) {
        setImmediate(() => { warmWorksheetTts(content).catch(() => {}); });
    }
    scheduleReplenish(cid, subj, cleanTheme);

    return {
        id: sheetId,
        childId: cid,
        subject: subj,
        level,
        theme: cleanTheme,
        title: row.title,
        source: row.source,
        content,
        pregenerated: true
    };
}

async function replenishSlot(childId, subject, theme = DEFAULT_PREGEN_THEME) {
    if (!(await isPreGenEnabled())) return { status: 'disabled' };
    await ensurePreGenTable();

    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    if (!PREGEN_SUBJECTS.includes(subj)) return { status: 'skipped' };

    const cleanTheme = String(theme || DEFAULT_PREGEN_THEME).trim().slice(0, 24) || DEFAULT_PREGEN_THEME;
    const levels = await getChildLevels(cid);
    const level = levels[subj] || 1;

    await pruneStaleQueueRows(cid, subj, level);

    const existing = await dbAll(
        `SELECT id, content_json, tts_warmed FROM study_pregen_queue
         WHERE child_id = ? AND subject = ? AND level = ? AND theme = ? AND include_play_block = 1`,
        [cid, subj, level, cleanTheme]
    );

    if (existing.length >= MAX_BUFFER_PER_SLOT) {
        for (const row of existing) {
            if (!row.tts_warmed) {
                try {
                    const parsed = JSON.parse(row.content_json);
                    await warmWorksheetTts(parsed);
                    await dbRun('UPDATE study_pregen_queue SET tts_warmed = 1 WHERE id = ?', [row.id]);
                } catch (e) {}
            }
        }
        return { status: 'already_full', level };
    }

    const payload = await generateWorksheetPayload({
        childId: cid,
        subject: subj,
        theme: cleanTheme,
        includePlayBlock: true,
        allowFallback: false,
        reserveQuota: RESERVE_DAILY_QUOTA
    });

    if (!payload || !payload.ok) {
        return { status: 'skipped', reason: payload?.reason || 'unavailable' };
    }

    const ttsStats = await warmWorksheetTts(payload.content);
    await dbRun(
        `INSERT INTO study_pregen_queue
            (child_id, subject, level, theme, include_play_block, title, source, content_json, tts_warmed)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1)`,
        [
            cid,
            subj,
            payload.level,
            payload.theme,
            payload.title,
            payload.source,
            JSON.stringify(payload.content)
        ]
    );

    return {
        status: 'generated',
        level: payload.level,
        ttsWarmed: ttsStats.warmed
    };
}

async function processPendingQueue() {
    if (workerRunning) return;
    workerRunning = true;
    try {
        while (pendingSlots.size > 0) {
            const [key, task] = pendingSlots.entries().next().value;
            pendingSlots.delete(key);
            try {
                await replenishSlot(task.childId, task.subject, task.theme);
            } catch (err) {
                console.warn(`⚠️ [Study PreGen] 슬롯 보충 실패 (${key}):`, err.message);
            }
        }
    } finally {
        workerRunning = false;
    }
}

function scheduleReplenish(childId, subject, theme = DEFAULT_PREGEN_THEME) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    if (!PREGEN_SUBJECTS.includes(subj)) return;
    const cleanTheme = String(theme || DEFAULT_PREGEN_THEME).trim().slice(0, 24) || DEFAULT_PREGEN_THEME;
    const key = `${cid}:${subj}:${cleanTheme}`;
    pendingSlots.set(key, { childId: cid, subject: subj, theme: cleanTheme });
    setTimeout(() => { processPendingQueue().catch(() => {}); }, 250);
}

async function triggerWarmupAll({ reason = 'manual' } = {}) {
    if (!(await isPreGenEnabled())) {
        return { started: false, message: '사전 생성 기능이 꺼져 있습니다.' };
    }
    if (workerRunning) {
        return { started: false, message: '이미 백그라운드 사전 생성 작업이 진행 중입니다.' };
    }
    await ensurePreGenTable();
    workerRunning = true;
    let created = 0;
    let ttsCount = 0;
    let skipped = 0;

    try {
        const profiles = await getProfiles();
        for (const p of profiles) {
            for (const subj of PREGEN_SUBJECTS) {
                const out = await replenishSlot(p.id, subj, DEFAULT_PREGEN_THEME);
                if (out.status === 'generated') {
                    created += 1;
                    ttsCount += Number(out.ttsWarmed || 0);
                } else {
                    skipped += 1;
                }
            }
        }

        const nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');
        const summary = `신규 ${created}장 준비 · 음성 ${ttsCount}개 캐시 (${reason})`;
        await setSystemConfig(PREGEN_LAST_RUN_KEY, nowStr);
        await setSystemConfig(PREGEN_LAST_SUMMARY_KEY, summary);
        return { started: true, created, ttsCount, skipped, summary, lastRunAt: nowStr };
    } finally {
        workerRunning = false;
        if (pendingSlots.size > 0) {
            setTimeout(() => { processPendingQueue().catch(() => {}); }, 300);
        }
    }
}

async function getPreGenStatus() {
    await ensurePreGenTable();
    const [enabled, lastRunAt, lastSummary, profiles, rows] = await Promise.all([
        isPreGenEnabled(),
        getSystemConfig(PREGEN_LAST_RUN_KEY, ''),
        getSystemConfig(PREGEN_LAST_SUMMARY_KEY, ''),
        getProfiles(),
        dbAll(`SELECT child_id, subject, level, theme, tts_warmed, created_at FROM study_pregen_queue ORDER BY id ASC`)
    ]);

    const byChild = profiles.map((p) => {
        const slots = {};
        for (const subj of PREGEN_SUBJECTS) {
            const matched = rows.filter((r) => r.child_id === p.id && r.subject === subj);
            slots[subj] = {
                count: matched.length,
                level: matched[0]?.level || null,
                ttsWarmed: matched.some((r) => Boolean(r.tts_warmed))
            };
        }
        return {
            childId: p.id,
            displayName: p.display_name,
            avatarEmoji: p.avatar_emoji || '🌟',
            slots
        };
    });

    return {
        enabled,
        running: workerRunning,
        lastRunAt: lastRunAt || null,
        lastSummary: lastSummary || null,
        totalQueued: rows.length,
        maxPerSlot: MAX_BUFFER_PER_SLOT,
        reserveDailyQuota: RESERVE_DAILY_QUOTA,
        byChild,
        ttsCache: getTtsCacheStats()
    };
}

function initStudyPreGenScheduler() {
    ensurePreGenTable().catch((err) => {
        console.warn('⚠️ [Study PreGen] 테이블 초기화 지연:', err.message);
    });

    if (!cronTask) {
        cronTask = cron.schedule('20 6 * * *', () => {
            triggerWarmupAll({ reason: '아침 자동 준비' }).catch((err) => {
                console.warn('⚠️ [Study PreGen] 일일 스케줄 오류:', err.message);
            });
        }, { timezone: 'Asia/Seoul' });
    }

    const startupTimer = setTimeout(() => {
        triggerWarmupAll({ reason: '부팅 점검' }).catch(() => {});
    }, 15000);
    if (typeof startupTimer.unref === 'function') startupTimer.unref();
}

module.exports = {
    ensurePreGenTable,
    isPreGenEnabled,
    setPreGenEnabled,
    warmWorksheetTts,
    consumePregeneratedWorksheet,
    scheduleReplenish,
    triggerWarmupAll,
    getPreGenStatus,
    initStudyPreGenScheduler
};
