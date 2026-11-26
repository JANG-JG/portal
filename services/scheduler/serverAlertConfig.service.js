const fs = require('fs');
const os = require('os');
const path = require('path');
const { sendServerTelegram } = require('../telegramAlert.service');

const CONFIG_FILE = path.join(os.homedir(), '.pm2', 'jg_server_alert_config.json');
const MAX_HISTORY = 50;

const DEFAULT_CONFIG = {
    pm2Alerts: true,
    httpAlerts: true,
    resourceAlerts: true,
    hardwareAlerts: true,
    secondaryAlerts: true,
    dailySummary: true
};

const alertHistory = [];

function loadAlertConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        }
    } catch (e) {}
    return { ...DEFAULT_CONFIG };
}

function saveAlertConfig(nextConfig) {
    const current = loadAlertConfig();
    const merged = { ...current };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (typeof nextConfig[key] === 'boolean') {
            merged[key] = nextConfig[key];
        }
    }
    try {
        fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
    } catch (e) {}
    return merged;
}

function isAlertCategoryEnabled(category) {
    if (!category) return true;
    const cfg = loadAlertConfig();
    return cfg[category] !== false;
}

function recordServerAlertHistory(entry) {
    alertHistory.unshift({
        time: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }),
        category: entry.category || 'system',
        title: entry.title || '서버 알림',
        sent: Boolean(entry.sent),
        detail: String(entry.detail || '').slice(0, 120)
    });
    if (alertHistory.length > MAX_HISTORY) {
        alertHistory.length = MAX_HISTORY;
    }
}

function getServerAlertHistory() {
    return alertHistory.slice();
}

/**
 * 카테고리 설정 확인 + 조치 가이드 부착 + 이력 기록을 통합 처리하는 서버 텔레그램 발송기
 */
async function sendGuidedServerTelegram({ category, title, tgText, guide }) {
    if (!isAlertCategoryEnabled(category)) {
        return { success: false, skipped: true };
    }
    const fullText = guide
        ? `${tgText}\n\n🛠 *조치 가이드*\n${guide}`
        : tgText;

    const res = await sendServerTelegram(fullText);
    recordServerAlertHistory({
        category,
        title,
        sent: Boolean(res && res.success),
        detail: res && res.success ? `msg_id=${res.messageId}` : (res && res.error)
    });
    return res;
}

module.exports = {
    DEFAULT_CONFIG,
    loadAlertConfig,
    saveAlertConfig,
    isAlertCategoryEnabled,
    recordServerAlertHistory,
    getServerAlertHistory,
    sendGuidedServerTelegram
};
