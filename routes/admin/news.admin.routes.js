const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { NEWS_DIR, NEWS_DB_PATH } = require('../../config/constants');
const { db, newsDb } = require('../../services/db');
const { getLiveWeatherData } = require('../../services/weather.service');

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

// 4. 뉴스 수집기 및 스케줄러 로그 파일 실시간 조회 API
router.get('/file-logs', (req, res) => {
    const logType = req.query.type || 'collector';
    const allowed = ['collector', 'scheduler'];
    if (!allowed.includes(logType)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 로그 타입입니다.' });
    }

    const logFile = logType === 'scheduler' ? 'scheduler.log' : 'collector.log';
    const candidatePaths = [
        path.join(NEWS_DIR, 'logs', logFile),
        path.join('/home/upt0731/workspace/news-dashboard/logs', logFile),
        path.join('/home/upt0731/news-dashboard/logs', logFile)
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
    
    const pyCandidates = [
        path.join(NEWS_DIR, 'venv/bin/python3'),
        path.join(NEWS_DIR, 'venv/bin/python'),
        '/home/upt0731/workspace/news-dashboard/venv/bin/python3',
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
