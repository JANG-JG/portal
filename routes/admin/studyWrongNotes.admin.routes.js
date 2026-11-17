/**
 * ==============================================================================
 * 관리자 학습실 오답 노트 · 복습 모니터링 API (studyWrongNotes.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 11] 관리자 페이지 아이별 오답 현황 조회 및 정리 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { dbAll, dbRun, normalizeChildId, getProfiles } = require('../../services/study/studyDb.service');
const { ensureWrongNotesTable } = require('../../services/study/studyWrongNote.service');

router.get('/', async (req, res) => {
    try {
        await ensureWrongNotesTable();
        const childId = String(req.query.childId || 'all');
        const status = String(req.query.status || 'all');
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));

        const [profiles, countRows] = await Promise.all([
            getProfiles(),
            dbAll('SELECT child_id, status, COUNT(*) AS cnt FROM study_wrong_notes GROUP BY child_id, status')
        ]);

        const summaryByChild = profiles.map((p) => {
            const pending = countRows.find((r) => r.child_id === p.id && r.status === 'pending')?.cnt || 0;
            const resolved = countRows.find((r) => r.child_id === p.id && r.status === 'resolved')?.cnt || 0;
            return {
                childId: p.id,
                displayName: p.display_name,
                avatarEmoji: p.avatar_emoji || '🧒',
                pendingCount: Number(pending),
                resolvedCount: Number(resolved)
            };
        });

        const where = [];
        const params = [];
        if (childId && childId !== 'all') {
            where.push('n.child_id = ?');
            params.push(normalizeChildId(childId));
        }
        if (status === 'pending' || status === 'resolved') {
            where.push('n.status = ?');
            params.push(status);
        }
        params.push(limit);

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const recent = await dbAll(
            `SELECT n.id, n.child_id, n.sheet_id, n.subject, n.level, n.theme, n.block_type,
                    n.prompt_text, n.last_wrong_answer, n.wrong_count, n.status, n.last_wrong_at, n.resolved_at,
                    p.display_name AS child_name, p.avatar_emoji AS child_emoji, s.title AS sheet_title
             FROM study_wrong_notes n
             LEFT JOIN study_profiles p ON p.id = n.child_id
             LEFT JOIN study_sheets s ON s.id = n.sheet_id
             ${whereSql}
             ORDER BY CASE WHEN n.status = 'pending' THEN 0 ELSE 1 END, n.last_wrong_at DESC, n.id DESC
             LIMIT ?`,
            params
        );

        res.json({ success: true, summaryByChild, recent });
    } catch (err) {
        console.error('관리자 오답 노트 조회 오류:', err);
        res.status(500).json({ success: false, message: '오답 노트 현황을 불러오지 못했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await ensureWrongNotesTable();
        const result = await dbRun('DELETE FROM study_wrong_notes WHERE id = ?', [Number(req.params.id)]);
        if (!result.changes) {
            return res.status(404).json({ success: false, message: '삭제할 오답 기록을 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '오답 기록을 삭제했습니다.' });
    } catch (err) {
        console.error('관리자 오답 노트 삭제 오류:', err);
        res.status(500).json({ success: false, message: '오답 기록 삭제에 실패했습니다.' });
    }
});

module.exports = router;
