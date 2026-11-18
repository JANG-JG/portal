/**
 * ==============================================================================
 * 관리자 학습실 Phase 3(오늘의 3종 미션 · 오답 섞기 · 신규 영역) 관제 라우터
 * (studyPhase3.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { setSystemConfig } = require('../../services/study/studyDb.service');
const { getAdminMissionsOverview } = require('../../services/study/studyMissions.service');

router.get('/phase3', async (req, res) => {
    try {
        const overview = await getAdminMissionsOverview();
        res.json({ success: true, ...overview });
    } catch (err) {
        console.error('관리자 Phase3 조회 오류:', err);
        res.status(500).json({ success: false, message: '오늘의 미션 및 신규 영역 현황을 불러오지 못했습니다.' });
    }
});

router.post('/phase3/config', async (req, res) => {
    try {
        const body = req.body || {};
        const pairs = [
            ['dailyMissionsEnabled', 'study_daily_missions_enabled'],
            ['phase3SubjectsEnabled', 'study_phase3_subjects_enabled'],
            ['wrongReviewMixEnabled', 'study_wrong_review_mix_enabled']
        ];
        for (const [prop, dbKey] of pairs) {
            if (typeof body[prop] === 'boolean') {
                await setSystemConfig(dbKey, body[prop] ? '1' : '0');
            }
        }
        const overview = await getAdminMissionsOverview();
        res.json({ success: true, message: '오늘의 미션·신규 영역·오답 자동 복습 설정이 저장되었습니다.', ...overview });
    } catch (err) {
        console.error('관리자 Phase3 설정 저장 오류:', err);
        res.status(500).json({ success: false, message: '설정을 저장하지 못했습니다.' });
    }
});

router.use('/', require('./studyPlazaRewards.admin.routes'));
router.use('/', require('./studyGrowth.admin.routes'));

module.exports = router;
