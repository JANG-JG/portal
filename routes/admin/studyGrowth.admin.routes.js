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
const { testRichMediaProvider, getRichMediaStats } = require('../../services/study/studyRichMediaApi.service');
const { listBlockReports, resolveBlockReport } = require('../../services/study/studyBlockReport.service');

router.get('/growth', async (req, res) => {
    try {
        const [profiles, eduOverview, richStats, treeFlag, dictFlag, arasaacFlag, freedictFlag] = await Promise.all([
            getProfiles(),
            getPublicEduOverview(),
            getRichMediaStats(),
            getSystemConfig('study_curriculum_tree_enabled', '1'),
            getSystemConfig('study_public_dict_enabled', '1'),
            getSystemConfig('study_arasaac_enabled', '1'),
            getSystemConfig('study_freedict_enabled', '1')
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
                publicDictEnabled: dictFlag !== '0',
                arasaacEnabled: arasaacFlag !== '0',
                freedictEnabled: freedictFlag !== '0'
            },
            richMediaStats: richStats,
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
        if (typeof body.arasaacEnabled === 'boolean') {
            await setSystemConfig('study_arasaac_enabled', body.arasaacEnabled ? '1' : '0');
        }
        if (typeof body.freedictEnabled === 'boolean') {
            await setSystemConfig('study_freedict_enabled', body.freedictEnabled ? '1' : '0');
        }
        res.json({ success: true, message: '공교육 커리큘럼·외부 API 설정이 저장되었습니다.' });
    } catch (err) {
        console.error('관리자 Phase4 설정 저장 오류:', err);
        res.status(500).json({ success: false, message: '설정을 저장하지 못했습니다.' });
    }
});

router.post('/growth/test-api', async (req, res) => {
    try {
        const provider = String(req.body?.provider || 'urimalsam').trim();
        const query = String(req.body?.query || (provider === 'freedict' ? 'apple' : '')).trim();
        const { testHeritageOrNatureProvider } = require('../../services/study/studyHeritageNatureApi.service');
        let result;
        if (provider === 'arasaac' || provider === 'freedict') {
            result = await testRichMediaProvider({ provider, query });
        } else if (provider === 'khs' || provider === 'inaturalist' || provider === 'nasa') {
            result = await testHeritageOrNatureProvider(provider, query);
        } else {
            result = await testPublicEduProvider({ provider, query });
        }
        const overview = await getPublicEduOverview();
        res.json({
            success: result.ok,
            result,
            ...overview
        });
    } catch (err) {
        console.error('공공 API 테스트 오류:', err);
        res.status(500).json({ success: false, message: '외부 API 연결 점검 중 오류가 발생했습니다.' });
    }
});

router.get('/block-reports', async (req, res) => {
    try {
        const status = String(req.query.status || 'all').trim();
        const reports = await listBlockReports({ status, limit: 40 });
        res.json({ success: true, reports });
    } catch (err) {
        console.error('관리자 문제 신고 내역 조회 오류:', err);
        res.status(500).json({ success: false, message: '문제 신고 내역을 불러오지 못했습니다.' });
    }
});

router.post('/block-reports/:id/resolve', async (req, res) => {
    try {
        const nextStatus = req.body?.status === 'pending' ? 'pending' : 'resolved';
        const out = await resolveBlockReport(req.params.id, nextStatus);
        res.json({ success: out.updated, ...out });
    } catch (err) {
        console.error('관리자 문제 신고 처리 오류:', err);
        res.status(500).json({ success: false, message: '신고 상태를 변경하지 못했습니다.' });
    }
});

router.post('/weekly-digest', async (req, res) => {
    try {
        const { sendWeeklyStudyDigestToParents } = require('../../services/study/studyTelegramNotify.service');
        const out = await sendWeeklyStudyDigestToParents({ force: true });
        res.json({
            success: true,
            sentCount: out.sentCount || 0,
            message: `주간 학습 요약 리포트를 발송했습니다. (텔레그램 ${out.sentCount || 0}건)`
        });
    } catch (err) {
        console.error('주간 학습 리포트 수동 발송 오류:', err);
        res.status(500).json({ success: false, message: '주간 리포트 발송 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
