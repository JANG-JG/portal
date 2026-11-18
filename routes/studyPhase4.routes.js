/**
 * ==============================================================================
 * 어린이 학습실 Phase 4 라우터 (공교육 진도표 + 우리말 낱말 사전)
 * (studyPhase4.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    normalizeChildId,
    getChildLevels,
    getSystemConfig,
    dbAll
} = require('../services/study/studyDb.service');
const { buildCurriculumStatus } = require('../services/study/curriculumKorea.data');
const { lookupKoreanWord, pickCuratedKoreanWords } = require('../services/study/publicEduApi.service');

router.get('/api/study/curriculum', authenticateToken, async (req, res) => {
    try {
        const cid = normalizeChildId(req.query.childId);
        const [levels, countsRows, treeFlag, dictFlag] = await Promise.all([
            getChildLevels(cid),
            dbAll(
                `SELECT subject, COUNT(*) AS cnt FROM study_worksheets
                 WHERE child_id = ? AND completed_at IS NOT NULL GROUP BY subject`,
                [cid]
            ).catch(() => []),
            getSystemConfig('study_curriculum_tree_enabled', '1'),
            getSystemConfig('study_public_dict_enabled', '1')
        ]);

        const completedCounts = {};
        for (const r of countsRows || []) {
            completedCounts[r.subject] = Number(r.cnt || 0);
        }

        const curriculum = buildCurriculumStatus({ levels, completedCounts });
        const recommendedWords = await pickCuratedKoreanWords({ level: levels.korean || 1, limit: 4 }).catch(() => []);

        res.json({
            success: true,
            childId: cid,
            enabled: treeFlag !== '0',
            dictEnabled: dictFlag !== '0',
            curriculum,
            recommendedWords
        });
    } catch (err) {
        console.error('공교육 커리큘럼 조회 오류:', err);
        res.status(500).json({ success: false, message: '진도표 정보를 불러오지 못했어요.' });
    }
});

router.get('/api/study/dictionary/word', authenticateToken, async (req, res) => {
    try {
        const cid = normalizeChildId(req.query.childId);
        const queryWord = String(req.query.q || '').trim();
        if (!queryWord) {
            const levels = await getChildLevels(cid);
            const samples = await pickCuratedKoreanWords({ level: levels.korean || 1, limit: 6 });
            return res.json({ success: true, samples });
        }
        const levels = await getChildLevels(cid);
        const result = await lookupKoreanWord(queryWord, { level: levels.korean || 2 });
        if (!result.ok) {
            return res.status(404).json({ success: false, message: result.message || '낱말을 찾지 못했어요.' });
        }
        res.json({ success: true, entry: result.entry });
    } catch (err) {
        console.error('어린이 우리말 사전 조회 오류:', err);
        res.status(500).json({ success: false, message: '낱말 사전을 불러오지 못했어요.' });
    }
});

module.exports = router;
