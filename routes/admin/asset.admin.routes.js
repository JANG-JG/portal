const express = require('express');
const router = express.Router();
const { assetDb } = require('../../services/db');
const {
    getKoreanStockName,
    enrichAssetsWithQuotes,
    getMarketCacheStatus,
    flushMarketCache
} = require('../../services/market.service');

const dbAll = (sql, params = []) => new Promise(r => assetDb.all(sql, params, (e, rows) => r(e ? [] : (rows || []))));
const dbGet = (sql, params = []) => new Promise(r => assetDb.get(sql, params, (e, row) => r(e ? null : row)));

// 1. 자산 관리 상세 요약 (실시간 시세 및 환율 반영)
router.get('/summary', async (req, res) => {
    try {
        const accounts = await dbAll('SELECT id, account_name, broker, note FROM accounts');
        const rawAssets = await dbAll('SELECT id, account_id, symbol, full_name, asset_type, quantity, avg_price, currency FROM assets WHERE quantity > 0 ORDER BY id DESC');
        const { enrichedAssets, exchangeRate } = await enrichAssetsWithQuotes(rawAssets);

        let totalUsd = 0;
        const accMap = {};
        accounts.forEach(a => { accMap[a.id] = { ...a, stockCount: 0, total: 0 }; });

        const formattedAssets = enrichedAssets.map(s => {
            const isUsd = (s.currency || '').toUpperCase() === 'USD';
            const curPrice = (typeof s.currentPrice === 'number' && s.currentPrice > 0) ? s.currentPrice : s.avg_price;
            const curVal = s.quantity * curPrice;
            const total = Math.round(isUsd ? (curVal * exchangeRate) : curVal);
            totalUsd += isUsd ? curVal : (curVal / exchangeRate);

            if (accMap[s.account_id]) {
                accMap[s.account_id].stockCount++;
                accMap[s.account_id].total += total;
            }

            return {
                id: s.id,
                symbol: s.symbol,
                koreanName: getKoreanStockName(s.symbol, s.full_name),
                asset_type: s.asset_type,
                quantity: s.quantity,
                formattedAvg: (isUsd ? '$' + Number(s.avg_price).toFixed(2) : '₩' + Math.round(s.avg_price).toLocaleString()),
                formattedTotal: '₩' + total.toLocaleString(),
                total
            };
        }).sort((a, b) => b.total - a.total);

        const totalKrw = Math.round(totalUsd * exchangeRate);
        const formattedAccounts = Object.values(accMap).map(a => ({
            ...a,
            totalFormatted: '₩' + Math.round(a.total).toLocaleString()
        }));

        res.json({
            success: true,
            totalKrw: '₩' + totalKrw.toLocaleString(),
            exchangeRate,
            cacheStatus: getMarketCacheStatus(),
            accounts: formattedAccounts,
            assets: formattedAssets
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '자산 데이터 조회 실패: ' + e.message });
    }
});

// 2. 증권사 알림(웹훅) · OCR 판독 이력 · 배당금 요약 통합 조회
router.get('/events', async (req, res) => {
    try {
        const [webhookLogs, webhookStatRow, ocrLogs, ocrStatRow, dividends, allDivs] = await Promise.all([
            dbAll('SELECT id, sender, title, body, parsed_status, parsed_data, created_at FROM webhook_logs ORDER BY id DESC LIMIT 40'),
            dbGet(`SELECT COUNT(*) as total_count,
                          COALESCE(SUM(CASE WHEN parsed_status IN ('BUY','SELL','DIVIDEND','SUCCESS','TEST_SUCCESS') THEN 1 ELSE 0 END), 0) as ok_count,
                          COALESCE(SUM(CASE WHEN parsed_status IN ('UNPARSED','TEMPLATE_ERROR','AUTH_ERROR','ERROR','TEST_FAIL') THEN 1 ELSE 0 END), 0) as fail_count
                   FROM webhook_logs`),
            dbAll('SELECT id, scan_type, file_count, parsed_count, status, duration_ms, summary_json, created_at FROM ocr_logs ORDER BY id DESC LIMIT 30'),
            dbGet(`SELECT COUNT(*) as total_count,
                          COALESCE(SUM(CASE WHEN status IN ('completed','partial') THEN 1 ELSE 0 END), 0) as ok_count,
                          COALESCE(AVG(duration_ms), 0) as avg_ms
                   FROM ocr_logs`),
            dbAll(`SELECT d.id, d.symbol, d.dividend_date, d.net_amount, d.currency, d.exchange_rate, COALESCE(acc.account_name, '미지정') as account_name
                   FROM dividends d LEFT JOIN accounts acc ON d.account_id = acc.id
                   ORDER BY d.dividend_date DESC, d.id DESC LIMIT 15`),
            dbAll('SELECT dividend_date, net_amount, currency, COALESCE(exchange_rate, 1350) as rate FROM dividends')
        ]);

        const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
        const curYear = nowKst.toISOString().slice(0, 4);
        const curMonth = nowKst.toISOString().slice(0, 7);
        let thisYearKrw = 0;
        let thisMonthKrw = 0;
        allDivs.forEach(d => {
            const krw = String(d.currency || 'KRW').toUpperCase() === 'USD'
                ? (Number(d.net_amount) || 0) * (Number(d.rate) > 100 ? Number(d.rate) : 1350)
                : (Number(d.net_amount) || 0);
            const dt = String(d.dividend_date || '');
            if (dt.startsWith(curYear)) thisYearKrw += krw;
            if (dt.startsWith(curMonth)) thisMonthKrw += krw;
        });

        res.json({
            success: true,
            webhookLogs,
            webhookStats: {
                totalCount: webhookStatRow ? webhookStatRow.total_count : 0,
                successCount: webhookStatRow ? webhookStatRow.ok_count : 0,
                failCount: webhookStatRow ? webhookStatRow.fail_count : 0
            },
            ocrLogs,
            ocrStats: {
                totalCount: ocrStatRow ? ocrStatRow.total_count : 0,
                successCount: ocrStatRow ? ocrStatRow.ok_count : 0,
                avgDurationMs: ocrStatRow ? Math.round(ocrStatRow.avg_ms) : 0
            },
            dividends: dividends.map(d => ({
                ...d,
                koreanName: getKoreanStockName(d.symbol, d.symbol)
            })),
            dividendStats: {
                totalCount: allDivs.length,
                thisYearKrw: Math.round(thisYearKrw),
                thisMonthKrw: Math.round(thisMonthKrw)
            },
            cacheStatus: getMarketCacheStatus()
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '자산 이벤트 이력 조회 실패: ' + e.message });
    }
});

// 3. 시세 및 환율 메모리 캐시 강제 갱신
router.post('/refresh-quotes', async (req, res) => {
    try {
        const cacheStatus = await flushMarketCache();
        res.json({
            success: true,
            message: `실시간 시세 및 환율(₩${Math.round(cacheStatus.exchangeRate || 0).toLocaleString()}) 캐시가 즉시 갱신되었습니다.`,
            cacheStatus
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '시세 캐시 갱신 실패: ' + e.message });
    }
});

module.exports = router;
