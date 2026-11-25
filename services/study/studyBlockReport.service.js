/**
 * ==============================================================================
 * 어린이 학습실 이상한 문제 신고 · 관리자 검수 서비스 (studyBlockReport.service.js)
 * ------------------------------------------------------------------------------
 * - 아이/부모가 학습지 블록의 '⚠️ 신고'를 누르면 해당 블록 스냅샷을 DB에 기록
 * - 관리자 페이지(Admin)에서 신고 내역을 조회하고 확인(해결) 처리 지원
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');

let tableReadyPromise = null;

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function ensureBlockReportTable() {
    if (tableReadyPromise) return tableReadyPromise;
    tableReadyPromise = dbRun(
        `CREATE TABLE IF NOT EXISTS study_block_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sheet_id INTEGER NOT NULL,
            child_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            level INTEGER NOT NULL DEFAULT 1,
            theme TEXT DEFAULT '',
            block_index INTEGER NOT NULL DEFAULT 0,
            block_type TEXT DEFAULT '',
            prompt TEXT DEFAULT '',
            answer TEXT DEFAULT '',
            reason TEXT DEFAULT '이상한 문제/오류',
            block_json TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`
    ).catch((err) => {
        tableReadyPromise = null;
        throw err;
    });
    return tableReadyPromise;
}

async function reportBlock({ sheet, blockIndex, reason = '이상한 문제/오류' }) {
    await ensureBlockReportTable();
    const idx = Number(blockIndex);
    const blk = sheet?.content?.blocks?.[idx] || {};
    const prompt = String(blk.prompt || '').trim().slice(0, 200);
    const answer = String(blk.answer ?? '').trim().slice(0, 120);
    const cleanReason = String(reason || '이상한 문제/오류').trim().slice(0, 120);

    let blockJson = '';
    try {
        blockJson = JSON.stringify(blk).slice(0, 2000);
    } catch (_) {
        blockJson = '';
    }

    const res = await dbRun(
        `INSERT INTO study_block_reports
            (sheet_id, child_id, subject, level, theme, block_index, block_type, prompt, answer, reason, block_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
            Number(sheet?.id || 0),
            String(sheet?.child_id || 'first'),
            String(sheet?.subject || 'korean'),
            Number(sheet?.level || 1),
            String(sheet?.theme || '').slice(0, 40),
            idx,
            String(blk.type || '').slice(0, 30),
            prompt,
            answer,
            cleanReason,
            blockJson
        ]
    );
    return { id: res.lastID, status: 'pending' };
}

async function listBlockReports({ status = 'all', limit = 40 } = {}) {
    await ensureBlockReportTable();
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 40));
    const whereClause = status === 'pending' || status === 'resolved'
        ? 'WHERE r.status = ?'
        : '';
    const params = whereClause ? [status, safeLimit] : [safeLimit];

    return dbAll(
        `SELECT r.id, r.sheet_id, r.child_id, r.subject, r.level, r.theme,
                r.block_index, r.block_type, r.prompt, r.answer, r.reason,
                r.status, r.created_at,
                p.display_name AS child_name, p.avatar_emoji AS child_emoji
         FROM study_block_reports r
         LEFT JOIN study_profiles p ON p.id = r.child_id
         ${whereClause}
         ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC
         LIMIT ?`,
        params
    );
}

async function resolveBlockReport(id, status = 'resolved') {
    await ensureBlockReportTable();
    const safeStatus = status === 'pending' ? 'pending' : 'resolved';
    const res = await dbRun(
        'UPDATE study_block_reports SET status = ? WHERE id = ?',
        [safeStatus, Number(id)]
    );
    return { updated: res.changes > 0, status: safeStatus };
}

module.exports = {
    reportBlock,
    listBlockReports,
    resolveBlockReport
};
