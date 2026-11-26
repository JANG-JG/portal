const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');
const { getRealMemoryInfo } = require('../systemMonitor.service');
const { ipv4HttpsAgent } = require('../telegramAlert.service');
const { sendGuidedServerTelegram, isAlertCategoryEnabled } = require('./serverAlertConfig.service');

const COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3시간 쿨다운

let ramHighStreak = 0;
let lastRamAlertAt = 0;

let batteryLowStreak = 0;
let lastBatteryAlertAt = 0;

let tempHighStreak = 0;
let lastTempAlertAt = 0;

let tunnelFailStreak = 0;
let tunnelAlertActive = false;

let lastDailySummaryDate = '';

function notifyAdminPush(sendBroadcastPush, { title, body, tag }) {
    if (typeof sendBroadcastPush !== 'function') return;
    sendBroadcastPush({
        title,
        body,
        url: 'https://j-jg.cc/admin#tab-overview',
        type: 'system',
        tag: tag || 'jg-system-health',
        adminOnly: true,
        meta: { skipTelegram: true }
    });
}

function readBatteryInfo() {
    const candidates = ['battery', 'Battery', 'bms'];
    for (const name of candidates) {
        const capPath = `/sys/class/power_supply/${name}/capacity`;
        const statusPath = `/sys/class/power_supply/${name}/status`;
        try {
            if (fs.existsSync(capPath)) {
                const cap = parseInt(fs.readFileSync(capPath, 'utf8').trim(), 10);
                const status = fs.existsSync(statusPath)
                    ? fs.readFileSync(statusPath, 'utf8').trim()
                    : 'Unknown';
                if (!isNaN(cap) && cap >= 0 && cap <= 100) {
                    return { capacity: cap, status };
                }
            }
        } catch (e) {}
    }
    return null;
}

function readMaxThermalCelsius() {
    let maxTemp = null;
    try {
        if (!fs.existsSync('/sys/class/thermal')) return null;
        const dirs = fs.readdirSync('/sys/class/thermal').filter(d => d.startsWith('thermal_zone'));
        for (const dir of dirs.slice(0, 12)) {
            try {
                const raw = parseInt(fs.readFileSync(`/sys/class/thermal/${dir}/temp`, 'utf8').trim(), 10);
                if (isNaN(raw)) continue;
                const celsius = raw > 1000 ? raw / 1000 : raw;
                if (celsius > 10 && celsius < 120) {
                    if (maxTemp === null || celsius > maxTemp) maxTemp = celsius;
                }
            } catch (e) {}
        }
    } catch (e) {}
    return maxTemp;
}

function checkRamAndHardwareHealth(currentTargetDateTime, sendBroadcastPush) {
    const now = Date.now();

    // 1. RAM 사용률 90% 이상 3회 연속 감시
    if (isAlertCategoryEnabled('resourceAlerts')) {
        const mem = getRealMemoryInfo();
        if (mem && mem.percentNum >= 90) {
            ramHighStreak += 1;
            if (ramHighStreak >= 3 && now - lastRamAlertAt >= COOLDOWN_MS) {
                lastRamAlertAt = now;
                sendGuidedServerTelegram({
                    category: 'resourceAlerts',
                    title: '메모리(RAM) 부족 경보',
                    tgText: `⚠️ *[JG Server 메모리(RAM) 부족 경보]*\n\n• *사용률*: *${mem.percent}* (${mem.used} / ${mem.total})\n• *잔여 메모리*: ${mem.free}\n• *감지 시각*: ${currentTargetDateTime}`,
                    guide: '점유율 높은 프로세스를 확인하고 재시작하세요:\n`pm2 list` → `pm2 restart <앱이름>`'
                });
                notifyAdminPush(sendBroadcastPush, {
                    title: '⚠️ 메모리(RAM) 부족 경보',
                    body: `메인 서버 RAM 사용률 ${mem.percent} 도달 (잔여 ${mem.free})`,
                    tag: 'jg-main-ram'
                });
            }
        } else {
            ramHighStreak = 0;
        }
    }

    // 2. 노트 9 배터리 & 발열 감시 (sysfs 접근 가능 시)
    if (isAlertCategoryEnabled('hardwareAlerts')) {
        const bat = readBatteryInfo();
        if (bat && bat.capacity <= 30 && bat.status !== 'Charging' && bat.status !== 'Full') {
            batteryLowStreak += 1;
            if (batteryLowStreak >= 3 && now - lastBatteryAlertAt >= COOLDOWN_MS) {
                lastBatteryAlertAt = now;
                sendGuidedServerTelegram({
                    category: 'hardwareAlerts',
                    title: '노트 9 배터리 저하 경보',
                    tgText: `🔋 *[JG Server 노트 9 배터리 주의]*\n\n• *배터리 잔량*: *${bat.capacity}%* (${bat.status})\n• *감지 시각*: ${currentTargetDateTime}`,
                    guide: '노트 9 충전 케이블·어댑터·멀티탭 전원을 확인하세요. (과열로 충전이 일시 차단됐는지도 확인)'
                });
                notifyAdminPush(sendBroadcastPush, {
                    title: '🔋 노트 9 배터리 주의',
                    body: `배터리 잔량 ${bat.capacity}% (${bat.status}) — 전원 연결 확인 필요`,
                    tag: 'jg-main-battery'
                });
            }
        } else {
            batteryLowStreak = 0;
        }

        const tempC = readMaxThermalCelsius();
        if (tempC !== null && tempC >= 52) {
            tempHighStreak += 1;
            if (tempHighStreak >= 3 && now - lastTempAlertAt >= COOLDOWN_MS) {
                lastTempAlertAt = now;
                sendGuidedServerTelegram({
                    category: 'hardwareAlerts',
                    title: '노트 9 발열 경보',
                    tgText: `🌡️ *[JG Server 노트 9 발열 경보]*\n\n• *최고 센서 온도*: *${tempC.toFixed(1)}°C*\n• *감지 시각*: ${currentTargetDateTime}`,
                    guide: '노트 9 주변 통풍(케이스·충전 열기)을 확보하고 고부하 프로세스가 있는지 확인하세요.'
                });
                notifyAdminPush(sendBroadcastPush, {
                    title: '🌡️ 노트 9 발열 경보',
                    body: `센서 온도 ${tempC.toFixed(1)}°C 도달 — 통풍 확인 필요`,
                    tag: 'jg-main-temp'
                });
            }
        } else {
            tempHighStreak = 0;
        }
    }
}

function checkExternalTunnelHealth(currentTargetDateTime, sendBroadcastPush) {
    if (!isAlertCategoryEnabled('httpAlerts')) return;

    const req = https.get('https://j-jg.cc/health', { agent: ipv4HttpsAgent, timeout: 6000 }, (res) => {
        res.resume();
        const isOk = res.statusCode > 0 && res.statusCode < 500;
        if (isOk) {
            tunnelFailStreak = 0;
            if (tunnelAlertActive) {
                tunnelAlertActive = false;
                sendGuidedServerTelegram({
                    category: 'httpAlerts',
                    title: '외부 터널 접속 복구',
                    tgText: `✅ *[JG Server 외부 터널 접속 복구]*\n\n• *주소*: \`https://j-jg.cc/health\`\n• *상태*: 정상 응답 (HTTP ${res.statusCode})\n• *복구 시각*: ${currentTargetDateTime}`
                });
                notifyAdminPush(sendBroadcastPush, {
                    title: '✅ 외부 접속 복구',
                    body: 'https://j-jg.cc 외부 터널 응답이 정상 복구되었습니다.',
                    tag: 'jg-external-tunnel'
                });
            }
        } else {
            handleTunnelFailure(`HTTP ${res.statusCode}`, currentTargetDateTime, sendBroadcastPush);
        }
    });
    req.on('timeout', () => {
        req.destroy();
        handleTunnelFailure('TIMEOUT', currentTargetDateTime, sendBroadcastPush);
    });
    req.on('error', (err) => {
        handleTunnelFailure(err.code || err.message, currentTargetDateTime, sendBroadcastPush);
    });
}

function handleTunnelFailure(reason, currentTargetDateTime, sendBroadcastPush) {
    tunnelFailStreak += 1;
    if (tunnelFailStreak >= 2 && !tunnelAlertActive) {
        tunnelAlertActive = true;
        sendGuidedServerTelegram({
            category: 'httpAlerts',
            title: '외부 터널 접속 불가',
            tgText: `🌐 *[JG Server 외부 터널 접속 불가]*\n\n• *주소*: \`https://j-jg.cc/health\`\n• *원인*: \`${reason}\`\n• *감지 시각*: ${currentTargetDateTime}`,
            guide: '노트 9 Wi-Fi 또는 Cloudflare 터널 이상입니다.\n집 Wi-Fi에서 SSH 접속 후 `pm2 restart cloudflared`를 실행하세요.'
        });
        notifyAdminPush(sendBroadcastPush, {
            title: '🌐 외부 접속 불가',
            body: `https://j-jg.cc 응답 이상 (${reason})`,
            tag: 'jg-external-tunnel'
        });
    }
}

function checkDailyServerSummary(kstDateStr, kstTimeStr, currentTargetDateTime) {
    if (kstTimeStr !== '08:00' || lastDailySummaryDate === kstDateStr) return;
    lastDailySummaryDate = kstDateStr;
    if (!isAlertCategoryEnabled('dailySummary')) return;

    const mem = getRealMemoryInfo();
    exec("df -k / | awk 'NR==2 {print $5}' && pm2 jlist", { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) return;
        const lines = stdout.trim().split('\n');
        const diskPct = lines[0] ? lines[0].trim() : '?';
        let onlineCount = 0;
        let totalCount = 0;
        let totalRestarts = 0;
        try {
            const procs = JSON.parse(lines.slice(1).join('\n'));
            totalCount = procs.length;
            procs.forEach(p => {
                if (p.pm2_env?.status === 'online') onlineCount += 1;
                totalRestarts += Number(p.pm2_env?.restart_time || 0);
            });
        } catch (e) {}

        const bat = readBatteryInfo();
        const tempC = readMaxThermalCelsius();
        const hwLine = (bat || tempC !== null)
            ? `\n• *하드웨어*: ${bat ? `배터리 ${bat.capacity}%` : ''}${bat && tempC !== null ? ' / ' : ''}${tempC !== null ? `온도 ${tempC.toFixed(1)}°C` : ''}`
            : '';

        sendGuidedServerTelegram({
            category: 'dailySummary',
            title: '일일 서버 상태 브리핑',
            tgText: `📊 *[JG Server 아침 상태 브리핑]*\n\n• *기준 시각*: ${currentTargetDateTime}\n• *PM2 프로세스*: ${onlineCount}/${totalCount} online (누적 재시작 ${totalRestarts}회)\n• *메모리(RAM)*: ${mem ? `${mem.percent} (${mem.used}/${mem.total})` : '확인 불가'}\n• *디스크(/)*: ${diskPct}${hwLine}\n\n_모든 핵심 서비스가 정상 가동 중입니다._`
        });
    });
}

module.exports = {
    checkRamAndHardwareHealth,
    checkExternalTunnelHealth,
    checkDailyServerSummary
};
