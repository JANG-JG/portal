const express = require('express');
const router = express.Router();
const {
    getSearchEngineStatus,
    setEngineToggle,
    setNaverSubApi,
    removeNaverSubApi,
    clearExternalCache
} = require('../../services/search/externalSearch.service');
const { clearExternalSuggestCache } = require('../../services/search/suggestExternal.service');

const {
    getWebBotAdminSnapshot,
    upsertSeed,
    deleteSeed,
    runScheduledOrManualSeedCrawl,
    clearAllWebBotCaches
} = require('../../services/search/webBotScheduler.service');

router.get('/status', async (req, res) => {
    try {
        const [status, webBot] = await Promise.all([
            getSearchEngineStatus(),
            getWebBotAdminSnapshot()
        ]);
        res.json({ success: true, ...status, webBot });
    } catch (e) {
        console.error('[Admin search status err]:', e);
        res.status(500).json({ success: false, message: '검색 엔진 상태 조회 실패' });
    }
});

router.get('/webbot', async (req, res) => {
    try {
        const snapshot = await getWebBotAdminSnapshot();
        res.json({ success: true, webBot: snapshot });
    } catch (_) {
        res.status(500).json({ success: false, message: '웹봇 상태 조회에 실패했습니다.' });
    }
});

router.post('/webbot/seeds', async (req, res) => {
    const body = req.body || {};
    try {
        const result = await upsertSeed({
            id: body.id || null,
            label: body.label,
            url: body.url,
            seedType: body.seedType || 'rss',
            category: body.category || '정보',
            enabled: body.enabled !== false,
            intervalMin: body.intervalMin || 240
        });
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (_) {
        res.status(500).json({ success: false, message: '웹봇 시드 저장 중 오류가 발생했습니다.' });
    }
});

router.delete('/webbot/seeds/:id', async (req, res) => {
    try {
        const result = await deleteSeed(req.params.id);
        if (!result.success) return res.status(404).json({ success: false, message: '삭제할 시드를 찾지 못했습니다.' });
        res.json(result);
    } catch (_) {
        res.status(500).json({ success: false, message: '웹봇 시드 삭제 중 오류가 발생했습니다.' });
    }
});

router.post('/webbot/crawl-now', async (req, res) => {
    const seedId = req.body?.seedId || null;
    try {
        const result = await runScheduledOrManualSeedCrawl(seedId, true);
        if (!result.success) return res.status(409).json(result);
        res.json({
            success: true,
            ...result,
            message: `웹봇 수집 완료 (${result.crawledSeeds}개 시드 · ${result.totalSaved}건 색인)`
        });
    } catch (_) {
        res.status(500).json({ success: false, message: '웹봇 즉시 수집 실행 중 오류가 발생했습니다.' });
    }
});

router.post('/toggle', async (req, res) => {
    const { engineId, enabled } = req.body || {};
    if (!engineId || typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: '잘못된 요청 파라미터입니다.' });
    }
    try {
        const result = await setEngineToggle(engineId, enabled);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '검색 엔진 설정 변경 실패' });
    }
});

router.post('/naver-subapi', async (req, res) => {
    const { code, label, tab, enabled } = req.body || {};
    if (!code) {
        return res.status(400).json({ success: false, message: 'API 코드를 입력해 주세요.' });
    }
    try {
        const result = await setNaverSubApi({ code, label, tab, enabled: enabled !== false });
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '네이버 세부 API 설정 실패' });
    }
});

router.delete('/naver-subapi/:code', async (req, res) => {
    try {
        const result = await removeNaverSubApi(req.params.code);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: '네이버 세부 API 삭제 실패' });
    }
});

router.post('/clear-cache', async (req, res) => {
    const clearedExt = clearExternalCache();
    const clearedSuggest = clearExternalSuggestCache();
    const { clearMapWidgetCache } = require('../../services/search/kakaoMapWidget.service');
    const { clearRegionCompositeCache } = require('../../services/search/regionComposite.service');
    const { clearAiSummaryCache } = require('../../services/search/searchAiBriefing.service');
    const clearedMap = clearMapWidgetCache() + clearRegionCompositeCache();
    const clearedAi = clearAiSummaryCache();
    const clearedBot = await clearAllWebBotCaches().catch(() => 0);
    const cleared = clearedExt + clearedSuggest + clearedMap + clearedAi + clearedBot;
    res.json({ success: true, cleared, message: `검색·추천·지역·지도·AI·웹봇 캐시 ${cleared}건을 비웠습니다.` });
});

module.exports = router;
