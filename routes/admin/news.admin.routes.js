const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { NEWS_DIR, NEWS_DB_PATH } = require('../../config/constants');
const { db, newsDb } = require('../../services/db');
const { getLiveWeatherData } = require('../../services/weather.service');
const { getChatModel } = require('../../services/aiModelRouter.service');

// 1. 뉴스 브리핑 현황 통계
router.get('/stats', async (req, res) => {
    try {
        const totalRow = await new Promise(r => newsDb.get('SELECT COUNT(*) as cnt FROM news_articles', (e, row) => r(row || { cnt: 0 })));
        const logsCountRow = await new Promise(r => newsDb.get('SELECT COUNT(*) as cnt FROM collection_logs', (e, row) => r(row || { cnt: 0 })));
        const recentArticles = await new Promise(r => newsDb.all('SELECT id, title, link, media_name, category_name, published_at FROM news_articles ORDER BY id DESC LIMIT 10', (e, rows) => r(rows || [])));
        const settingRow = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'collection_enabled'", (e, row) => r(row || null)));
        const briefingTimesRow = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'telegram_briefing_times'", (e, row) => r(row || null)));
        let briefingTimes = ['07:30'];
        if (briefingTimesRow && briefingTimesRow.value) {
            try {
                const parsed = JSON.parse(briefingTimesRow.value);
                if (Array.isArray(parsed) && parsed.length > 0) briefingTimes = parsed;
            } catch (e) {}
        }

        const excludeRow = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'exclude_keywords'", (e, row) => r(row || null)));
        let excludeKeywords = [];
        if (excludeRow && excludeRow.value) {
            try {
                const parsed = JSON.parse(excludeRow.value);
                if (Array.isArray(parsed)) excludeKeywords = parsed;
            } catch (e) {}
        }

        const modelRow = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'news_ai_summary_model'", (e, row) => r(row || null)));
        const summaryModel = (modelRow && modelRow.value) ? modelRow.value.trim() : 'gemini-3.1-flash-lite';

        let dbSizeKb = 0;
        try {
            if (fs.existsSync(NEWS_DB_PATH)) {
                dbSizeKb = Math.round(fs.statSync(NEWS_DB_PATH).size / 1024);
            }
        } catch (e) {}

        const weather = await getLiveWeatherData();

        res.json({
            success: true,
            totalArticles: totalRow.cnt,
            totalLogs: logsCountRow.cnt,
            dbSizeKb,
            collectionEnabled: !settingRow || settingRow.value !== '0',
            telegramBriefingTimes: briefingTimes,
            excludeKeywords,
            summaryModel,
            ollamaModel: getChatModel(),
            recentArticles,
            weather
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '뉴스 데이터 조회 실패: ' + e.message });
    }
});

// 2. 뉴스 텔레그램 브리핑 시각 목록 저장 API
router.post('/briefing-times', (req, res) => {
    const { times } = req.body;
    let cleanBriefingTimes = Array.isArray(times)
        ? times.filter(t => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t.trim())).map(t => t.trim())
        : ['07:30'];
    cleanBriefingTimes = Array.from(new Set(cleanBriefingTimes)).sort();
    if (cleanBriefingTimes.length === 0) cleanBriefingTimes = ['07:30'];

    const jsonStr = JSON.stringify(cleanBriefingTimes);

    if (newsDb) {
        newsDb.run(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('telegram_briefing_times', ?, datetime('now', '+9 hours'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `, [jsonStr], (err) => {
            if (err) console.error('[NewsDB] telegram_briefing_times 동기화 실패:', err);
        });
    }

    const userId = req.user.username || 'admin';
    db.run(`
        UPDATE notification_settings 
        SET telegram_briefing_times = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? OR user_id = 'admin'
    `, [jsonStr, userId], () => {});

    res.json({ success: true, times: cleanBriefingTimes, message: '텔레그램 브리핑 전송 시각이 저장되었습니다.' });
});

// 3. 뉴스 수집 제외 키워드 목록 조회 및 저장 API
router.get('/exclude-keywords', async (req, res) => {
    try {
        if (!newsDb) return res.json({ success: true, keywords: [] });
        const row = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'exclude_keywords'", (e, rRow) => r(rRow || null)));
        let keywords = [];
        if (row && row.value) {
            try {
                const parsed = JSON.parse(row.value);
                if (Array.isArray(parsed)) keywords = parsed;
            } catch (e) {}
        }
        res.json({ success: true, keywords });
    } catch (e) {
        res.status(500).json({ success: false, message: '제외 키워드 조회 실패: ' + e.message });
    }
});

router.post('/exclude-keywords', (req, res) => {
    const { keywords } = req.body;
    let cleanKws = Array.isArray(keywords)
        ? keywords.filter(k => typeof k === 'string' && k.trim().length > 0).map(k => k.trim())
        : [];
    cleanKws = Array.from(new Set(cleanKws));
    const jsonStr = JSON.stringify(cleanKws);

    if (newsDb) {
        newsDb.run(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('exclude_keywords', ?, datetime('now', '+9 hours'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `, [jsonStr], (err) => {
            if (err) {
                console.error('[NewsDB] exclude_keywords 저장 실패:', err);
                return res.status(500).json({ success: false, message: '저장 실패: ' + err.message });
            }
            res.json({ success: true, keywords: cleanKws, message: '수집 제외 키워드가 저장되었습니다.' });
        });
    } else {
        res.status(500).json({ success: false, message: 'newsDb가 연결되지 않았습니다.' });
    }
});

// 3-1. 뉴스 AI 요약 모델 조회 및 설정 API
const ALLOWED_SUMMARY_MODELS = [
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite (초경량 · 최저비용 권장)', desc: '구글 최저비용 초고속 요약 모델' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (요약 특화 경량)', desc: '문맥 이해력 강화 차세대 경량 모델' },
    { id: 'gemini-3.0-flash', name: 'Gemini 3 Flash (고성능 표준)', desc: '심층 문맥 이해 및 고품질 요약' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (최신 플래그십 플래시)', desc: '최고 성능의 최신 범용 플래시 모델' }
];

router.get('/summary-model', async (req, res) => {
    try {
        let currentModel = 'gemini-3.1-flash-lite';
        if (newsDb) {
            const row = await new Promise(r => newsDb.get("SELECT value FROM system_settings WHERE key = 'news_ai_summary_model'", (e, rRow) => r(rRow || null)));
            if (row && row.value) currentModel = row.value.trim();
        }
        res.json({ success: true, currentModel, supportedModels: ALLOWED_SUMMARY_MODELS });
    } catch (e) {
        res.status(500).json({ success: false, message: '요약 모델 조회 실패: ' + e.message });
    }
});

router.post('/summary-model', (req, res) => {
    const { model } = req.body;
    const validIds = ALLOWED_SUMMARY_MODELS.map(m => m.id);
    if (!model || !validIds.includes(model)) {
        return res.status(400).json({ success: false, message: '유효한 요약 모델을 선택해 주세요.' });
    }

    if (newsDb) {
        newsDb.run(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('news_ai_summary_model', ?, datetime('now', '+9 hours'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `, [model], (err) => {
            if (err) {
                console.error('[NewsDB] news_ai_summary_model 저장 실패:', err);
                return res.status(500).json({ success: false, message: '저장 실패: ' + err.message });
            }
            res.json({ success: true, model, message: `뉴스 AI 요약 모델이 '${model}'(으)로 저장되었습니다.` });
        });
    } else {
        res.status(500).json({ success: false, message: 'newsDb가 연결되지 않았습니다.' });
    }
});

// 4. 뉴스 수집기 및 스케줄러 로그 파일 실시간 조회 API
router.get('/file-logs', (req, res) => {
    const logType = req.query.type || 'collector';
    const allowed = ['collector', 'scheduler'];
    if (!allowed.includes(logType)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 로그 타입입니다.' });
    }

    const logFile = logType === 'scheduler' ? 'scheduler.log' : 'collector.log';
    const homeDir = require('os').homedir();
    const candidatePaths = [
        path.join(NEWS_DIR, 'logs', logFile),
        path.join(homeDir, 'workspace/news-dashboard/logs', logFile),
        path.join(homeDir, 'news-dashboard/logs', logFile)
    ];

    const filePath = candidatePaths.find(p => fs.existsSync(p));
    const linesCount = Math.min(Math.max(parseInt(req.query.lines, 10) || 120, 10), 300);

    if (!filePath) {
        return res.json({ success: true, logs: `[알림] ${logFile} 파일이 아직 생성되지 않았거나 비어 있습니다.\n(확인 경로: ${path.join(NEWS_DIR, 'logs', logFile)})` });
    }

    exec(`tail -n ${linesCount} "${filePath}"`, (err, stdout, stderr) => {
        if (err) {
            return res.json({ success: true, logs: `로그 파일 읽기 오류: ${err.message}` });
        }
        res.json({ success: true, logs: stdout || '(기록된 로그 내용이 없습니다.)' });
    });
});

// 5. 뉴스 수집 및 모닝 브리핑 즉시 실행 (트리거)
router.post('/trigger', (req, res) => {
    const { mode } = req.body;
    const isBriefing = mode === 'briefing';
    const flag = isBriefing ? '--run-briefing-now' : '--run-collect-now';
    
    const homeDir = require('os').homedir();
    const pyCandidates = [
        path.join(NEWS_DIR, 'venv/bin/python3'),
        path.join(NEWS_DIR, 'venv/bin/python'),
        path.join(homeDir, 'workspace/news-dashboard/venv/bin/python3'),
        'python3'
    ];
    const pyPath = pyCandidates.find(p => fs.existsSync(p)) || 'python3';
    const scriptPath = path.join(NEWS_DIR, 'scheduler.py');

    exec(`"${pyPath}" "${scriptPath}" ${flag}`, { cwd: NEWS_DIR }, (err, stdout, stderr) => {
        if (err) console.error('[NEWS_TRIGGER_ERR]', err, stderr);
    });

    res.json({
        success: true,
        message: isBriefing ? '뉴스 수집 및 텔레그램 모닝 브리핑 발송이 백그라운드에서 시작되었습니다.' : '뉴스 기사 최신 수집(DB 최신화 전용)이 백그라운드에서 시작되었습니다.'
    });
});

module.exports = router;
