const express = require('express');
const router = express.Router();
const { assetDb } = require('../../services/db');
const { getKoreanStockName, enrichAssetsWithQuotes } = require('../../services/market.service');

// 자산 관리 상세 요약 (실시간 시세 및 환율 반영)
router.get('/summary', async (req, res) => {
    try {
        const accounts = await new Promise(r => assetDb.all('SELECT id, account_name, broker, note FROM accounts', (e, rows) => r(rows || [])));
        const rawAssets = await new Promise(r => assetDb.all('SELECT id, account_id, symbol, full_name, asset_type, quantity, avg_price, currency FROM assets WHERE quantity > 0 ORDER BY id DESC', (e, rows) => r(rows || [])));
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
            accounts: formattedAccounts,
            assets: formattedAssets
        });
    } catch (e) {
        res.status(500).json({ success: false, message: '자산 데이터 조회 실패: ' + e.message });
    }
});

module.exports = router;
