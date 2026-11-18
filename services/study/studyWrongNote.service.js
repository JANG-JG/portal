/**
 * ==============================================================================
 * 어린이 학습실 채점 · 오답 노트 저장 · 복습 별(도장) 보상 서비스
 * (studyWrongNote.service.js)
 * ------------------------------------------------------------------------------
 * - 문제별 2회 기회 채점 검증 (1회 오답 시 재시도 허용, 2회 오답 시 틀림 처리)
 * - 1개 이상 틀리면 별(칭찬 도장) 보류 & 틀린 문제를 study_wrong_notes에 자동 저장
 * - 학습지 재도전 또는 오답 복습(/study/review)으로 틀린 문제를 모두 맞추면
 *   보류되었던 별(칭찬 도장)을 즉시 부여
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const {
    dbGet,
    dbAll,
    dbRun,
    normalizeChildId,
    normalizeSubject
} = require('./studyDb.service');
const { awardStamp } = require('./studyStamps.service');
const { ensureSheetExtensions } = require('./studySheetShare.service');

const {
    PHASE3_SCORED_TYPES,
    evaluatePhase3SubmittedBlock
} = require('./fallbackPhase3Bank.data');

const SCORED_BLOCK_TYPES = new Set(['quiz', 'count', 'match', ...PHASE3_SCORED_TYPES]);

let wrongTableReadyPromise = null;

function ensureWrongNotesTable() {
    if (wrongTableReadyPromise) return wrongTableReadyPromise;
    wrongTableReadyPromise = (async () => {
        await ensureSheetExtensions();
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_wrong_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                sheet_id INTEGER,
                block_index INTEGER NOT NULL DEFAULT 0,
                block_id TEXT DEFAULT '',
                subject TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 1,
                theme TEXT DEFAULT '',
                block_type TEXT NOT NULL,
                prompt_text TEXT DEFAULT '',
                block_json TEXT NOT NULL,
                last_wrong_answer TEXT DEFAULT '',
                wrong_count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                first_wrong_at DATETIME DEFAULT (datetime('now', 'localtime')),
                last_wrong_at DATETIME DEFAULT (datetime('now', 'localtime')),
                resolved_at DATETIME,
                UNIQUE (child_id, sheet_id, block_index)
            )
        `);
        await dbRun('CREATE INDEX IF NOT EXISTS idx_study_wrong_child_status ON study_wrong_notes (child_id, status, last_wrong_at DESC)').catch(() => {});
        await dbRun('CREATE INDEX IF NOT EXISTS idx_study_wrong_sheet ON study_wrong_notes (child_id, sheet_id, status)').catch(() => {});
    })().catch((err) => {
        wrongTableReadyPromise = null;
        throw err;
    });
    return wrongTableReadyPromise;
}

function evaluateSubmittedBlock(blk, blockIndex, submitted) {
    const type = String(blk?.type || 'quiz');
    const wrongTries = Math.max(0, Number(submitted?.wrongCount || 0));
    const attempts = Math.max(1, Number(submitted?.attempts || 1));
    const lastWrongAnswer = String(submitted?.lastWrongAnswer || '').trim().slice(0, 80);

    let isRight = false;
    if (type === 'quiz' || type === 'count') {
        const expected = String(blk?.answer || '').trim().toUpperCase();
        const actual = String(submitted?.finalAnswer || '').trim().toUpperCase();
        isRight = submitted?.status === 'correct' && Boolean(expected) && actual === expected && wrongTries < 2;
    } else if (type === 'match') {
        const pairCount = Array.isArray(blk?.pairs) ? blk.pairs.length : 0;
        const matchedCount = Number(submitted?.matchedCount || 0);
        isRight = submitted?.status === 'correct' && matchedCount >= pairCount && wrongTries < 2;
    } else if (PHASE3_SCORED_TYPES.has(type)) {
        isRight = evaluatePhase3SubmittedBlock(blk, submitted);
    }

    return {
        blockIndex,
        blockId: String(blk?.id || `block-${blockIndex + 1}`),
        blockType: type,
        status: isRight ? 'correct' : 'wrong',
        attempts,
        wrongCount: isRight ? wrongTries : Math.max(2, wrongTries),
        lastWrongAnswer
    };
}

async function upsertWrongNoteFromBlock(sheet, blockIndex, blk, evalItem) {
    const cid = normalizeChildId(sheet.child_id);
    const subj = normalizeSubject(sheet.subject);
    const blockJson = JSON.stringify(blk);
    const promptText = String(blk?.prompt || '').trim().slice(0, 160);

    const existing = await dbGet(
        'SELECT id, status, wrong_count FROM study_wrong_notes WHERE child_id = ? AND sheet_id = ? AND block_index = ?',
        [cid, Number(sheet.id), Number(blockIndex)]
    );

    if (existing) {
        await dbRun(
            `UPDATE study_wrong_notes
             SET block_id = ?, subject = ?, level = ?, theme = ?, block_type = ?,
                 prompt_text = ?, block_json = ?, last_wrong_answer = ?,
                 wrong_count = wrong_count + 1, status = 'pending',
                 last_wrong_at = datetime('now', 'localtime'), resolved_at = NULL
             WHERE id = ?`,
            [
                evalItem.blockId, subj, Number(sheet.level || 1), String(sheet.theme || ''),
                evalItem.blockType, promptText, blockJson, evalItem.lastWrongAnswer, existing.id
            ]
        );
        return existing.id;
    }

    const res = await dbRun(
        `INSERT INTO study_wrong_notes
            (child_id, sheet_id, block_index, block_id, subject, level, theme, block_type, prompt_text, block_json, last_wrong_answer, wrong_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')`,
        [
            cid, Number(sheet.id), Number(blockIndex), evalItem.blockId, subj,
            Number(sheet.level || 1), String(sheet.theme || ''), evalItem.blockType,
            promptText, blockJson, evalItem.lastWrongAnswer
        ]
    );
    return res.lastID;
}

async function getWrongNoteStats(childId) {
    await ensureWrongNotesTable();
    const cid = normalizeChildId(childId);
    const rows = await dbAll(
        `SELECT subject, status, COUNT(*) AS cnt
         FROM study_wrong_notes
         WHERE child_id = ?
         GROUP BY subject, status`,
        [cid]
    );

    let pendingCount = 0;
    let resolvedCount = 0;
    const bySubject = { korean: 0, math: 0, english: 0 };

    rows.forEach((r) => {
        const cnt = Number(r.cnt || 0);
        if (r.status === 'pending') {
            pendingCount += cnt;
            if (Object.prototype.hasOwnProperty.call(bySubject, r.subject)) {
                bySubject[r.subject] += cnt;
            }
        } else if (r.status === 'resolved') {
            resolvedCount += cnt;
        }
    });

    return { pendingCount, resolvedCount, bySubject };
}

async function gradeAndSubmitWorksheet({ sheet, blockResults }) {
    await ensureWrongNotesTable();

    const blocks = Array.isArray(sheet?.content?.blocks) ? sheet.content.blocks : [];
    const scoredIndices = [];
    blocks.forEach((b, idx) => {
        if (SCORED_BLOCK_TYPES.has(b?.type)) scoredIndices.push(idx);
    });

    const submittedMap = new Map();
    if (Array.isArray(blockResults)) {
        blockResults.forEach((item) => {
            const idx = Number(item?.blockIndex);
            if (Number.isInteger(idx)) submittedMap.set(idx, item);
        });
    }

    if (scoredIndices.length > 0 && submittedMap.size === 0) {
        const err = new Error('아직 풀지 않은 문제가 있어요! 문제를 모두 푼 뒤 채점해 주세요.');
        err.statusCode = 400;
        throw err;
    }

    const gradedResults = [];
    const wrongBlocks = [];

    for (const idx of scoredIndices) {
        const blk = blocks[idx];
        const submitted = submittedMap.get(idx);
        const evalItem = evaluateSubmittedBlock(blk, idx, submitted);
        gradedResults.push(evalItem);

        if (evalItem.status === 'wrong') {
            await upsertWrongNoteFromBlock(sheet, idx, blk, evalItem);
            wrongBlocks.push(evalItem);
        } else {
            await dbRun(
                `UPDATE study_wrong_notes
                 SET status = 'resolved', resolved_at = COALESCE(resolved_at, datetime('now', 'localtime'))
                 WHERE child_id = ? AND sheet_id = ? AND block_index = ? AND status = 'pending'`,
                [normalizeChildId(sheet.child_id), Number(sheet.id), Number(idx)]
            );
        }
    }

    const totalScored = gradedResults.length;
    const wrongCount = wrongBlocks.length;
    const correctCount = Math.max(0, totalScored - wrongCount);
    const nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');

    const lastResultPayload = {
        totalScored,
        correctCount,
        wrongCount,
        blockResults: gradedResults,
        gradedAt: nowStr
    };

    await dbRun(
        'UPDATE study_sheets SET last_result_json = ? WHERE id = ?',
        [JSON.stringify(lastResultPayload), Number(sheet.id)]
    );

    if (wrongCount > 0) {
        const stats = await getWrongNoteStats(sheet.child_id);
        return {
            stampAwarded: false,
            starDenied: true,
            alreadyAwarded: false,
            reachedTen: false,
            totalScored,
            correctCount,
            wrongCount,
            blockResults: gradedResults,
            wrongBlocks,
            wrongNoteStats: stats,
            message: `틀린 문제가 ${wrongCount}개 있어 이번엔 별을 못 받았어요! 다시 풀어서 맞추면 바로 별을 받을 수 있어요 📝`
        };
    }

    const stampRes = await awardStamp({
        childId: sheet.child_id,
        sourceType: 'online',
        sheetId: sheet.id,
        note: `${sheet.title} 완료 🌟`
    });

    const stats = await getWrongNoteStats(sheet.child_id);

    return {
        stampAwarded: true,
        starDenied: false,
        totalScored,
        correctCount,
        wrongCount: 0,
        blockResults: gradedResults,
        wrongBlocks: [],
        wrongNoteStats: stats,
        ...stampRes,
        message: stampRes.reachedTen
            ? '축하해요! 모든 문제를 맞춰 도장판 10칸을 완성했어요! 🎉'
            : (stampRes.alreadyAwarded
                ? '이미 별(도장)을 받은 학습지예요! 이번에도 모두 맞췄어요 ⭐'
                : '와! 모든 문제를 다 맞춰서 별(칭찬 도장)을 받았어요! 🌟')
    };
}

async function listWrongNotes(childId, { status = 'pending', subject = 'all', limit = 60 } = {}) {
    await ensureWrongNotesTable();
    const cid = normalizeChildId(childId);
    const cleanStatus = status === 'resolved' ? 'resolved' : (status === 'all' ? 'all' : 'pending');
    const cleanSubj = ['korean', 'math', 'english'].includes(subject) ? subject : 'all';

    const where = ['n.child_id = ?'];
    const params = [cid];
    if (cleanStatus !== 'all') {
        where.push('n.status = ?');
        params.push(cleanStatus);
    }
    if (cleanSubj !== 'all') {
        where.push('n.subject = ?');
        params.push(cleanSubj);
    }
    params.push(Math.min(100, Math.max(1, Number(limit) || 60)));

    const rows = await dbAll(
        `SELECT n.*, s.title AS sheet_title, s.completed_at AS sheet_completed_at,
                (SELECT COUNT(*) FROM study_stamps st WHERE st.child_id = n.child_id AND st.sheet_id = n.sheet_id) AS sheet_stamp_count
         FROM study_wrong_notes n
         LEFT JOIN study_sheets s ON s.id = n.sheet_id
         WHERE ${where.join(' AND ')}
         ORDER BY CASE WHEN n.status = 'pending' THEN 0 ELSE 1 END, n.last_wrong_at DESC, n.id DESC
         LIMIT ?`,
        params
    );

    const items = rows.map((r) => {
        let block = null;
        try { block = JSON.parse(r.block_json); } catch (_) { block = null; }
        return {
            id: r.id,
            childId: r.child_id,
            sheetId: r.sheet_id,
            sheetTitle: r.sheet_title || `${r.theme || ''} 학습지`,
            sheetHasStamp: Number(r.sheet_stamp_count || 0) > 0,
            blockIndex: r.block_index,
            blockId: r.block_id,
            subject: r.subject,
            level: r.level,
            theme: r.theme,
            blockType: r.block_type,
            promptText: r.prompt_text,
            lastWrongAnswer: r.last_wrong_answer,
            wrongCount: Number(r.wrong_count || 1),
            status: r.status,
            firstWrongAt: r.first_wrong_at,
            lastWrongAt: r.last_wrong_at,
            resolvedAt: r.resolved_at,
            block
        };
    });

    const stats = await getWrongNoteStats(cid);
    return { items, stats };
}

async function syncSheetLastResultOnNoteResolve(sheetId, blockIndex) {
    if (!sheetId) return;
    const row = await dbGet('SELECT last_result_json FROM study_sheets WHERE id = ?', [Number(sheetId)]);
    if (!row || !row.last_result_json) return;
    try {
        const parsed = JSON.parse(row.last_result_json);
        if (!Array.isArray(parsed.blockResults)) return;
        let changed = false;
        parsed.blockResults = parsed.blockResults.map((br) => {
            if (Number(br.blockIndex) === Number(blockIndex) && br.status !== 'correct') {
                changed = true;
                return { ...br, status: 'correct' };
            }
            return br;
        });
        if (!changed) return;
        parsed.wrongCount = parsed.blockResults.filter((b) => b.status === 'wrong').length;
        parsed.correctCount = parsed.blockResults.filter((b) => b.status === 'correct').length;
        await dbRun('UPDATE study_sheets SET last_result_json = ? WHERE id = ?', [JSON.stringify(parsed), Number(sheetId)]);
    } catch (_) {}
}

async function recordWrongNoteAttempt(noteId, childId, { isCorrect, selectedAnswer = '' }) {
    await ensureWrongNotesTable();
    const idNum = Number(noteId);
    const cid = normalizeChildId(childId);
    const note = await dbGet('SELECT * FROM study_wrong_notes WHERE id = ? AND child_id = ?', [idNum, cid]);
    if (!note) {
        const err = new Error('해당 복습 문제를 찾을 수 없어요.');
        err.statusCode = 404;
        throw err;
    }

    let blk = null;
    try { blk = JSON.parse(note.block_json); } catch (_) { blk = null; }

    let verifiedCorrect = Boolean(isCorrect);
    if (verifiedCorrect && blk && (blk.type === 'quiz' || blk.type === 'count')) {
        const expected = String(blk.answer || '').trim().toUpperCase();
        const actual = String(selectedAnswer || '').trim().toUpperCase();
        if (expected && actual && expected !== actual) {
            verifiedCorrect = false;
        }
    }

    if (!verifiedCorrect) {
        await dbRun(
            `UPDATE study_wrong_notes
             SET wrong_count = wrong_count + 1,
                 last_wrong_answer = ?,
                 last_wrong_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [String(selectedAnswer || '').trim().slice(0, 80), idNum]
        );
        const stats = await getWrongNoteStats(cid);
        return {
            resolved: false,
            stampAwarded: false,
            reachedTen: false,
            stats,
            message: '아쉬워요! 다시 한 번 천천히 풀어서 맞춰 보아요 💪'
        };
    }

    await dbRun(
        `UPDATE study_wrong_notes
         SET status = 'resolved', resolved_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [idNum]
    );
    await syncSheetLastResultOnNoteResolve(note.sheet_id, note.block_index);

    let stampResult = null;
    let stampAwarded = false;
    let unlockedSheetTitle = '';

    if (note.sheet_id) {
        const remRow = await dbGet(
            "SELECT COUNT(*) AS cnt FROM study_wrong_notes WHERE child_id = ? AND sheet_id = ? AND status = 'pending'",
            [cid, Number(note.sheet_id)]
        );
        const existingStamp = await dbGet(
            'SELECT id FROM study_stamps WHERE child_id = ? AND sheet_id = ? LIMIT 1',
            [cid, Number(note.sheet_id)]
        );
        const sheetRow = await dbGet(
            'SELECT id, title, subject, level FROM study_sheets WHERE id = ?',
            [Number(note.sheet_id)]
        );

        if (Number(remRow?.cnt || 0) === 0 && !existingStamp && sheetRow && sheetRow.subject !== 'coloring') {
            unlockedSheetTitle = sheetRow.title || '맞춤 학습지';
            stampResult = await awardStamp({
                childId: cid,
                sourceType: 'online',
                sheetId: sheetRow.id,
                note: `${unlockedSheetTitle} (오답 복습 완료 🌟)`
            });
            stampAwarded = true;
            const { notifyWorksheetCompletedToParents } = require('./studyTelegramNotify.service');
            setImmediate(() => {
                notifyWorksheetCompletedToParents({
                    childId: cid,
                    sheetTitle: `${unlockedSheetTitle} (오답 복습 완료)`,
                    subject: sheetRow.subject,
                    level: sheetRow.level,
                    earnedCount: stampResult.board?.earnedCount || 0,
                    alreadyAwarded: stampResult.alreadyAwarded
                }).catch(() => {});
            });
        }
    }

    const stats = await getWrongNoteStats(cid);
    const reachedTen = Boolean(stampResult?.reachedTen);
    let message = '정답이에요! 복습 노트를 멋지게 해결했어요! ⭐';
    if (stampAwarded) {
        message = reachedTen
            ? `🎉 복습 완료! '${unlockedSheetTitle}'의 별(도장)을 받아 10칸을 모두 채웠어요!`
            : `🌟 멋져요! '${unlockedSheetTitle}'의 틀린 문제를 모두 맞춰 별(칭찬 도장)을 받았어요!`;
    }

    return {
        resolved: true,
        stampAwarded,
        reachedTen,
        unlockedSheetTitle,
        board: stampResult?.board || null,
        pokemonEggResult: stampResult?.pokemonEggResult || null,
        stats,
        message
    };
}

module.exports = {
    SCORED_BLOCK_TYPES,
    ensureWrongNotesTable,
    getWrongNoteStats,
    gradeAndSubmitWorksheet,
    listWrongNotes,
    recordWrongNoteAttempt
};
