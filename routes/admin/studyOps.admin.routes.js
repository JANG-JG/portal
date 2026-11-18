/**
 * ==============================================================================
 * 관리자 학습실 세부 기능 On/Off · 간식 지급 · 미션 테마 · 소셜/AI 로그 라우터
 * (studyOps.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const {
    getStudyFeatureFlags,
    setStudyFeatureFlags,
    setTodayMissionTheme,
    grantBonusSnackToChild,
    forceEndPokemonVisit,
    getAdminOpsOverview
} = require('../../services/study/studyOpsAdmin.service');

router.get('/ops', async (req, res) => {
    try {
        const overview = await getAdminOpsOverview();
        res.json({ success: true, ...overview });
    } catch (err) {
        console.error('관리자 학습실 운영 로그 조회 오류:', err);
        res.status(500).json({ success: false, message: '소셜·AI 도안 운영 현황을 불러오지 못했습니다.' });
    }
});

router.post('/ops/flags', async (req, res) => {
    try {
        const flags = await setStudyFeatureFlags(req.body || {});
        const overview = await getAdminOpsOverview();
        res.json({
            success: true,
            message: '세부 기능 On/Off 설정이 저장되었습니다.',
            flags,
            ...overview
        });
    } catch (err) {
        console.error('관리자 학습실 세부 기능 저장 오류:', err);
        res.status(500).json({ success: false, message: '세부 기능 설정 저장에 실패했습니다.' });
    }
});

router.post('/ops/snacks/grant', async (req, res) => {
    try {
        const { childId, snackType, qty } = req.body || {};
        const result = await grantBonusSnackToChild({ childId, snackType, qty });
        const overview = await getAdminOpsOverview();
        res.json({
            success: true,
            message: `${result.snack.emoji} ${result.snack.name} ${result.qty}개를 지급했습니다!`,
            granted: result,
            ...overview
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '간식 지급에 실패했습니다.' });
    }
});

router.post('/ops/mission-theme', async (req, res) => {
    try {
        const { childId, theme, slot1Subject, slot2Subject, slot3Subject } = req.body || {};
        const missionTheme = await setTodayMissionTheme({
            childId,
            theme,
            slot1Subject,
            slot2Subject,
            slot3Subject
        });
        const overview = await getAdminOpsOverview();
        res.json({
            success: true,
            message: missionTheme.theme
                ? `오늘의 미션 테마를 "${missionTheme.theme}"(으)로 지정했습니다.`
                : '오늘의 미션 테마 설정을 반영했습니다.',
            missionTheme,
            ...overview
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '오늘의 미션 테마 지정에 실패했습니다.' });
    }
});

router.post('/ops/visits/:id/end', async (req, res) => {
    try {
        await forceEndPokemonVisit(Number(req.params.id));
        const overview = await getAdminOpsOverview();
        res.json({ success: true, message: '진행 중이던 방문 기록을 종료했습니다.', ...overview });
    } catch (err) {
        res.status(400).json({ success: false, message: err?.message || '방문 종료에 실패했습니다.' });
    }
});

router.get('/ops/flags', async (req, res) => {
    try {
        const flags = await getStudyFeatureFlags();
        res.json({ success: true, flags });
    } catch (err) {
        res.status(500).json({ success: false, message: '기능 플래그 조회에 실패했습니다.' });
    }
});

module.exports = router;
