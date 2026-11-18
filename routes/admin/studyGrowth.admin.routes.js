/**
 * ==============================================================================
 * 관리자 학습실 Phase 4 (공교육 커리큘럼 · 우리말샘/공공 API · 캐시 로그) 관제 라우터
 * (studyGrowth.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const {
    getProfiles,
    getChildLevels,
    getSystemConfig,
    setSystemConfig,
    dbAll
} = require('../../services/study/studyDb.service');
const { buildCurriculumStatus } = require('../../services/study/curriculumKorea.data');
const { getPublicEduOverview, testPublicEduProvider } = require('../../services/study/publicEduApi.service');

router.get('/growth', async (req, res) => {
    try {
        const [profiles, eduOverview, treeFlag, dictFlag] = await Promise.all([
            getProfiles(),
            getPublicEduOverview(),
            getSystemConfig('study_curriculum_tree_enabled', '1'),
            getSystemConfig('study_public_dict_enabled', '1')
        ]);

        const childrenCurriculum = [];
        for (const p of profiles) {
            const [levels, counts] = await Promise.all([
                getChildLevels(p.id),
                dbAll(
                    'SELECT subject, COUNT(*) AS cnt FROM study_worksheets WHERE child_id = ? AND completed_at IS NOT NULL GROUP BY subject',
                    [p.id]
                ).catch(() => [])
            ]);
            const map = {};
            for (const c of counts || []) map[c.subject] = Number(c.cnt || 0);
            const summary = buildCurriculumStatus({ levels, completedCounts: map });
            childrenCurriculum.push({
                childId: p.id,
                displayName: p.display_name || p.id,
                avatarEmoji: p.avatar_emoji || '🧒',
                overallPercent: summary.overallPercent,
                subjects: summary.subjects.map((s) => ({
                    id: s.id,
                    label: s.label,
                    currentLevel: s.currentLevel,
                    activeUnitTitle: s.activeUnit?.title || '',
                    completedSheets: s.completedSheets
                }))
            });
        }

        res.json({
            success: true,
            config: {
                curriculumTreeEnabled: treeFlag !== '0',
                publicDictEnabled: dictFlag !== '0'
            },
            ...eduOverview,
            childrenCurriculum
        });
    } catch (err) {
        console.error('관리자 Phase4 성장 관제 조회 오류:', err);
        res.status(500).json({ success: false, message: '커리큘럼 및 공공 API 현황을 불러오지 못했습니다.' });
    }
});

router.post('/growth/config', async (req, res) => {
    try {
        const body = req.body || {};
        if (typeof body.curriculumTreeEnabled === 'boolean') {
            await setSystemConfig('study_curriculum_tree_enabled', body.curriculumTreeEnabled ? '1' : '0');
        }
        if (typeof body.publicDictEnabled === 'boolean') {
            await setSystemConfig('study_public_dict_enabled', body.publicDictEnabled ? '1' : '0');
        }
        res.json({ success: true, message: '공교육 커리큘럼·우리말 사전 설정이 저장되었습니다.' });
    } catch (err) {
        console.error('관리자 Phase4 설정 저장 오류:', err);
        res.status(500).json({ success: false, message: '설정을 저장하지 못했습니다.' });
    }
});

router.post('/growth/test-api', async (req, res) => {
    try {
        const provider = String(req.body?.provider || 'urimalsam').trim();
        const query = String(req.body?.query || '사과').trim() || '사과';
        const result = await testPublicEduProvider({ provider, query });
        const overview = await getPublicEduOverview();
        res.json({
            success: result.ok,
            result,
            ...overview
        });
    } catch (err) {
        console.error('공공 API 테스트 오류:', err);
        res.status(500).json({ success: false, message: '외부 사전 API 연결 점검 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
