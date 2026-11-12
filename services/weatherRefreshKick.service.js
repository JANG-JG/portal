/**
 * 저장된 기상청 스냅샷(briefing.db daily_weather)이 10분 이상 경과 시
 * 뉴스룸(news-dashboard)에 백그라운드 갱신을 요청한다. (1분 쿨다운 → 외부 API 한도 보호)
 * 실제 외부 API 호출 여부는 뉴스룸 SWR 캐시(10분)가 최종 판단한다.
 */
const { JWT_SECRET } = require('../config/constants');

const KMA_STALE_MS = 10 * 60 * 1000;
const KICK_COOLDOWN_MS = 60 * 1000;
let lastKick = 0;

function kickNewsWeatherRefreshIfStale(updatedAt) {
    const m = String(updatedAt || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    const ts = m ? Date.parse(`${m[1]}T${m[2]}+09:00`) : NaN;
    const now = Date.now();
    if (!Number.isNaN(ts) && now - ts < KMA_STALE_MS) return false;
    if (now - lastKick < KICK_COOLDOWN_MS) return false;
    lastKick = now;
    const base = process.env.NEWS_INTERNAL_URL || 'http://127.0.0.1:5050';
    fetch(`${base}/api/internal/weather/refresh`, {
        method: 'POST',
        headers: JWT_SECRET ? { 'X-Internal-Secret': JWT_SECRET } : {},
        signal: AbortSignal.timeout(4000)
    }).catch(() => {});
    return true;
}

module.exports = { kickNewsWeatherRefreshIfStale };
