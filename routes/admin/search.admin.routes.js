const express = require('express');
const router = express.Router();
const {
    getSearchEngineStatus,
    setEngineToggle,
    clearExternalCache
} = require('../../services/search/externalSearch.service');

router.get('/status', async (req, res) => {
    try {
        const status = await getSearchEngineStatus();
        res.json({ success: true, ...status });
    } catch (e) {
        console.error('[Admin search status err]:', e);
        res.status(500).json({ success: false, message: '검색 엔진 상태 조회 실패' });
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

router.post('/clear-cache', (req, res) => {
    const cleared = clearExternalCache();
    res.json({ success: true, cleared, message: `외부 검색 캐시 ${cleared}건을 비웠습니다.` });
});

module.exports = router;
