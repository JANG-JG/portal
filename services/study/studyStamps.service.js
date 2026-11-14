/**
 * ==============================================================================
 * 어린이 학습실 칭찬 도장판 & 종이 학습지 스티커 관리 서비스 (studyStamps.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스
 * [규칙 3] portalDb 통합 저장 & 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');
const { sendServerTelegram } = require('../telegramAlert.service');

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

function normalizeStampChildId(input) {
    const val = String(input || '').trim().toLowerCase();
    if (val === 'first' || val === '1' || val === '첫째') return 'first';
    if (val === 'second' || val === '2' || val === '둘째') return 'second';
    if (/^[a-z0-9_-]{2,32}$/.test(val)) return val;
    return 'first';
}

function escapeTelegramMarkdown(text) {
    return String(text || '').replace(/([_*`\[])/g, '\\$1');
}

async function syncSheetCompletedState(sheetId) {
    if (!sheetId) return;
    const remaining = await dbGet('SELECT id FROM study_stamps WHERE sheet_id = ? LIMIT 1', [Number(sheetId)]);
    if (!remaining) {
        await dbRun('UPDATE study_sheets SET completed_at = NULL WHERE id = ?', [Number(sheetId)]);
    }
}

async function getActiveStampBoard(childId) {
    const cid = normalizeStampChildId(childId);
    const maxRow = await dbGet(
        'SELECT MAX(cycle_no) as maxCycle, COUNT(*) as totalEarned FROM study_stamps WHERE child_id = ?',
        [cid]
    );
    const totalEarned = maxRow?.totalEarned || 0;
    const currentCycle = maxRow?.maxCycle || 1;
    const stamps = await dbAll(
        'SELECT id, cycle_no, source_type, sheet_id, note, earned_at FROM study_stamps WHERE child_id = ? AND cycle_no = ? ORDER BY id ASC',
        [cid, currentCycle]
    );
    return {
        cycleNo: currentCycle,
        earnedCount: stamps.length,
        totalEarned,
        completedCycles: Math.floor(totalEarned / 10),
        isFull: stamps.length >= 10,
        stamps
    };
}

async function notifyTenStamps(cid, boardAfter) {
    const profile = await dbGet('SELECT display_name, target_reward FROM study_profiles WHERE id = ?', [cid]);
    const childLabel = profile?.display_name || (cid === 'first' ? '첫째' : '둘째');
    const reward = profile?.target_reward || '칭찬 선물';
    const safeChildLabel = escapeTelegramMarkdown(childLabel);
    const safeReward = escapeTelegramMarkdown(reward);
    sendServerTelegram(
        `🎉 *[어린이 학습실] ${safeChildLabel} 칭찬 도장판 10칸 완성!*\n\n` +
        `• 총 누적 도장: *${boardAfter.totalEarned}개* (${boardAfter.completedCycles}번째 도장판 달성)\n` +
        `• 약속한 보상: *${safeReward}*\n` +
        `아이에게 크게 칭찬하고 선물을 챙겨주세요! 🌟`
    ).catch(() => {});
}

async function awardStamp({ childId, sourceType = 'online', sheetId = null, note = '', byParent = false }) {
    const cid = normalizeStampChildId(childId);
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

    const defaultPaperNote = byParent ? '종이 학습지 완료 칭찬 (부모 확인) 📄' : '종이 학습지 완료 📄';
    const cleanNote = String(note || '').trim()
        ? String(note).trim().slice(0, 80)
        : (cleanSource === 'paper' ? defaultPaperNote : '태블릿 학습지 완료 🌟');

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
        await notifyTenStamps(cid, boardAfter);
    }

    return { alreadyAwarded: false, reachedTen, board: boardAfter };
}

async function deleteStampById(childId, stampId) {
    const cid = normalizeStampChildId(childId);
    const idNum = Number(stampId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
        throw new Error('삭제할 도장 번호가 올바르지 않습니다.');
    }

    const target = await dbGet(
        'SELECT id, cycle_no, source_type, sheet_id, note, earned_at FROM study_stamps WHERE id = ? AND child_id = ?',
        [idNum, cid]
    );
    if (!target) {
        throw new Error('해당 도장 기록을 찾을 수 없습니다.');
    }

    await dbRun('DELETE FROM study_stamps WHERE id = ? AND child_id = ?', [idNum, cid]);
    await syncSheetCompletedState(target.sheet_id);

    const board = await getActiveStampBoard(cid);
    return { deletedStamp: target, board };
}

async function removeLastStamp(childId) {
    const cid = normalizeStampChildId(childId);
    const last = await dbGet(
        'SELECT id, cycle_no, source_type, sheet_id, note, earned_at FROM study_stamps WHERE child_id = ? ORDER BY cycle_no DESC, id DESC LIMIT 1',
        [cid]
    );
    if (!last) {
        const board = await getActiveStampBoard(cid);
        return { deletedStamp: null, board };
    }

    await dbRun('DELETE FROM study_stamps WHERE id = ?', [last.id]);
    await syncSheetCompletedState(last.sheet_id);
    const board = await getActiveStampBoard(cid);
    return { deletedStamp: last, board };
}

async function setStampBoardCount(childId, targetCount, { sourceType = 'paper', note = '' } = {}) {
    const cid = normalizeStampChildId(childId);
    const target = Math.min(10, Math.max(0, Math.round(Number(targetCount))));
    if (!Number.isFinite(target)) {
        throw new Error('도장 개수는 0~10 사이 숫자로 입력해 주세요.');
    }

    const boardBefore = await getActiveStampBoard(cid);
    const current = boardBefore.earnedCount;
    const diff = target - current;

    if (diff > 0) {
        const cleanSource = sourceType === 'online' ? 'online' : 'paper';
        const cleanNote = String(note || '').trim().slice(0, 80) || '부모 도장판 수정 (+추가) ✏️';
        for (let i = 0; i < diff; i++) {
            await dbRun(
                'INSERT INTO study_stamps (child_id, cycle_no, source_type, sheet_id, note) VALUES (?, ?, ?, NULL, ?)',
                [cid, boardBefore.cycleNo, cleanSource, cleanNote]
            );
        }
    } else if (diff < 0) {
        const toRemove = await dbAll(
            'SELECT id, sheet_id FROM study_stamps WHERE child_id = ? AND cycle_no = ? ORDER BY id DESC LIMIT ?',
            [cid, boardBefore.cycleNo, Math.abs(diff)]
        );
        for (const row of toRemove) {
            await dbRun('DELETE FROM study_stamps WHERE id = ?', [row.id]);
            await syncSheetCompletedState(row.sheet_id);
        }
    }

    const boardAfter = await getActiveStampBoard(cid);
    return { previousCount: current, currentCount: boardAfter.earnedCount, board: boardAfter };
}

async function resetCurrentStampBoard(childId) {
    const cid = normalizeStampChildId(childId);
    const boardBefore = await getActiveStampBoard(cid);
    const rows = await dbAll(
        'SELECT id, sheet_id FROM study_stamps WHERE child_id = ? AND cycle_no = ?',
        [cid, boardBefore.cycleNo]
    );
    await dbRun('DELETE FROM study_stamps WHERE child_id = ? AND cycle_no = ?', [cid, boardBefore.cycleNo]);
    for (const row of rows) {
        await syncSheetCompletedState(row.sheet_id);
    }
    const boardAfter = await getActiveStampBoard(cid);
    return { clearedCount: rows.length, cycleNo: boardBefore.cycleNo, board: boardAfter };
}

async function updateStampEntry(childId, stampId, { sourceType, note }) {
    const cid = normalizeStampChildId(childId);
    const idNum = Number(stampId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
        throw new Error('수정할 도장 번호가 올바르지 않습니다.');
    }

    const existing = await dbGet('SELECT id, source_type, note FROM study_stamps WHERE id = ? AND child_id = ?', [idNum, cid]);
    if (!existing) {
        throw new Error('해당 도장 기록을 찾을 수 없습니다.');
    }

    const nextSource = sourceType === 'paper' || sourceType === 'online' ? sourceType : existing.source_type;
    const nextNote = note !== undefined ? String(note).trim().slice(0, 80) : existing.note;

    await dbRun(
        'UPDATE study_stamps SET source_type = ?, note = ? WHERE id = ? AND child_id = ?',
        [nextSource, nextNote, idNum, cid]
    );
    const board = await getActiveStampBoard(cid);
    return { board };
}

async function listRecentStamps(childId = 'all', limit = 25) {
    const cleanLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const filterAll = !childId || childId === 'all';
    const params = filterAll ? [cleanLimit] : [normalizeStampChildId(childId), cleanLimit];
    const whereClause = filterAll ? '' : 'WHERE st.child_id = ?';

    return dbAll(
        `SELECT st.id, st.child_id, st.cycle_no, st.source_type, st.sheet_id, st.note, st.earned_at,
                p.display_name AS child_name, p.avatar_emoji AS child_emoji
         FROM study_stamps st
         LEFT JOIN study_profiles p ON p.id = st.child_id
         ${whereClause}
         ORDER BY st.id DESC
         LIMIT ?`,
        params
    );
}

module.exports = {
    getActiveStampBoard,
    awardStamp,
    deleteStampById,
    removeLastStamp,
    setStampBoardCount,
    resetCurrentStampBoard,
    updateStampEntry,
    listRecentStamps
};
