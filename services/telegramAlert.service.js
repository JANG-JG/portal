const https = require('https');
const axios = require('axios');

// 🌐 Node.js 18+ IPv6 바인딩 지연/타임아웃(ETIMEDOUT / ENETUNREACH) 방지 전용 IPv4 HTTPS 에이전트
const ipv4HttpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    timeout: 8000
});

// 서버 전용 텔레그램 알림 발송 헬퍼 함수 (IPv4 강제 적용 및 반환값 제공)
async function sendServerTelegram(text) {
    const token = process.env.SERVER_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.SERVER_TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.warn('[TelegramAlert] 텔레그램 설정 누락: SERVER_TELEGRAM_BOT_TOKEN 또는 SERVER_TELEGRAM_CHAT_ID 미설정');
        return { success: false, error: 'SERVER_TELEGRAM_BOT_TOKEN 또는 SERVER_TELEGRAM_CHAT_ID 환경변수가 설정되지 않았습니다.' };
    }

    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown'
        }, {
            httpsAgent: ipv4HttpsAgent,
            timeout: 8000
        });

        if (res.data && res.data.ok) {
            console.log('✅ [TelegramAlert] 텔레그램 서버 경보 발송 성공:', res.data.result?.message_id);
            return { success: true, messageId: res.data.result?.message_id };
        } else {
            console.error('[TelegramAlert] 텔레그램 응답 오류:', res.data);
            return { success: false, error: res.data?.description || '응답 오류' };
        }
    } catch (tgErr) {
        const errMsg = tgErr.response?.data?.description || tgErr.message;
        console.error('[TelegramAlert] 텔레그램 서버 경보 발송 실패:', errMsg);
        return { success: false, error: errMsg };
    }
}

module.exports = {
    ipv4HttpsAgent,
    sendServerTelegram
};
