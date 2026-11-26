const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { sendGuidedServerTelegram } = require('./serverAlertConfig.service');
const { checkExtendedHealth } = require('./remoteHealth.service');
const { checkRamAndHardwareHealth, checkDailyServerSummary } = require('./hardwareHealth.service');

const pm2DownAlertState = {};
const restartAlertCooldown = {};
const restartHistoryTimestamps = {};
const crashLoopAlertCooldown = {};
let lastDiskAlertDate = '';
let lastPm2CheckTimestamp = 0;

const HEALTH_STATE_FILE = path.join(os.homedir(), '.pm2', 'jg_health_state.json');

function loadRestartState() {
    try {
        if (fs.existsSync(HEALTH_STATE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(HEALTH_STATE_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) {}
    return {};
}

function saveRestartState(state) {
    try {
        fs.mkdirSync(path.dirname(HEALTH_STATE_FILE), { recursive: true });
        fs.writeFileSync(HEALTH_STATE_FILE, JSON.stringify(state), { mode: 0o600 });
    } catch (e) {}
}

let savedRestartCounts = loadRestartState();

function checkPm2Health(currentTargetDateTime, sendBroadcastPush) {
    const now = Date.now();
    if (now - lastPm2CheckTimestamp < 30000) return;
    lastPm2CheckTimestamp = now;

    exec('pm2 jlist', { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout) return;
        try {
            const procList = JSON.parse(stdout);
            const monitoredApps = [
                'portal',
                'blood-pressure-app',
                'asset',
                'family-album',
                'news-dashboard',
                'news-scheduler',
                'cloudflared'
            ];
            let stateDirty = false;

            monitoredApps.forEach(appName => {
                const proc = procList.find(p => p.name === appName);
                if (proc) {
                    const status = proc.pm2_env.status;
                    const isOnline = status === 'online';
                    const restarts = Number(proc.pm2_env.restart_time || 0);
                    const prevRestarts = savedRestartCounts[appName];

                    // 0. 자동 재시작(autorestart)으로 30초 폴링 사이에 복구된 크래시 또는 portal 자체 재기동 감지
                    if (prevRestarts === undefined) {
                        savedRestartCounts[appName] = restarts;
                        stateDirty = true;
                    } else if (restarts > prevRestarts && isOnline && !pm2DownAlertState[appName]) {
                        const cooldownAt = restartAlertCooldown[appName] || 0;
                        const delta = restarts - prevRestarts;
                        savedRestartCounts[appName] = restarts;
                        stateDirty = true;

                        // Crash Loop 추적 (10분 내 5회 이상 재시작 시 긴급 경보)
                        const hist = restartHistoryTimestamps[appName] || [];
                        for (let i = 0; i < Math.min(delta, 10); i++) hist.push(now);
                        const recentHist = hist.filter(ts => now - ts <= 10 * 60 * 1000);
                        restartHistoryTimestamps[appName] = recentHist;

                        if (recentHist.length >= 5 && now - (crashLoopAlertCooldown[appName] || 0) >= 30 * 60 * 1000) {
                            crashLoopAlertCooldown[appName] = now;
                            restartAlertCooldown[appName] = now;
                            sendGuidedServerTelegram({
                                category: 'pm2Alerts',
                                title: `반복 크래시(Crash Loop) 경보: ${appName}`,
                                tgText: `🔥 *[JG Server 반복 크래시(Crash Loop) 경보]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: 최근 10분간 *${recentHist.length}회* 연속 재시작\n• *감지 시각*: ${currentTargetDateTime}`,
                                guide: `최근 코드/DB 오류 또는 메모리 부족이 의심됩니다.\n관리자 콘솔 또는 SSH로 에러 로그를 확인하세요:\n\`pm2 logs ${appName} --err --lines 30\``
                            });
                            sendBroadcastPush({
                                title: '🔥 반복 크래시(Crash Loop)',
                                body: `${appName} 최근 10분간 ${recentHist.length}회 재시작`,
                                url: 'https://j-jg.cc/admin#tab-overview',
                                type: 'system',
                                tag: `jg-pm2-crashloop-${appName}`,
                                adminOnly: true,
                                meta: { skipTelegram: true }
                            });
                        } else if (now - cooldownAt >= 60000) {
                            restartAlertCooldown[appName] = now;
                            sendGuidedServerTelegram({
                                category: 'pm2Alerts',
                                title: `프로세스 재시작 감지: ${appName}`,
                                tgText: `⚠️ *[JG Server 프로세스 재시작 감지]*\n\n• *프로세스*: \`${appName}\`\n• *변경*: 재시작 누적 ${prevRestarts}회 → ${restarts}회 (+${delta})\n• *감지 시각*: ${currentTargetDateTime}\n\n_PM2 자동 재기동으로 현재 \`online\` 상태입니다._`,
                                guide: `단발성 재시작이면 추가 조치는 불필요합니다. 반복될 경우 로그 확인:\n\`pm2 logs ${appName} --lines 20\``
                            });
                            sendBroadcastPush({
                                title: '⚠️ 프로세스 재시작 감지',
                                body: `${appName} 재시작 감지 (${prevRestarts} → ${restarts}회)`,
                                url: 'https://j-jg.cc/admin#tab-overview',
                                type: 'system',
                                tag: `jg-pm2-restart-${appName}`,
                                adminOnly: true,
                                meta: { skipTelegram: true }
                            });
                        }
                    } else if (restarts < prevRestarts) {
                        savedRestartCounts[appName] = restarts;
                        stateDirty = true;
                    }

                    // 1. 장애 감지 (최초 다운 시 1회 발송 및 자동 재기동 시도)
                    if (!isOnline && !pm2DownAlertState[appName]) {
                        pm2DownAlertState[appName] = true;
                        console.warn(`🚨 [PM2 ALERT] ${appName} 프로세스 비정상 상태 감지 (${status})`);

                        // [텔레그램 경보 발송]
                        sendGuidedServerTelegram({
                            category: 'pm2Alerts',
                            title: `프로세스 장애 경보: ${appName}`,
                            tgText: `🚨 *[JG Server 프로세스 장애 경보]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: \`${status}\` (비정상 다운 감지)\n• *감지 시각*: ${currentTargetDateTime}\n\n⚙️ *자동 복구(pm2 restart)를 1회 시도합니다...*`
                        });

                        // [웹 푸시 발송 (관리자 전용)]
                        sendBroadcastPush({
                            title: '🚨 서버 경보',
                            body: `${appName} 장애 발생 (${status}). 자동 복구를 시도합니다.`,
                            url: 'https://j-jg.cc/admin#tab-overview',
                            type: 'system',
                            tag: `jg-pm2-${appName}`,
                            adminOnly: true,
                            meta: { skipTelegram: true }
                        });

                        // [1회 자동 복구 시도: pm2 restart]
                        exec(`pm2 restart ${appName}`, (restartErr) => {
                            if (restartErr) {
                                console.error(`[PM2 AUTO-RESTART] ${appName} 재기동 오류:`, restartErr.message);
                            }
                            // 재기동 후 4초 뒤 상태 재점검
                            setTimeout(() => {
                                exec('pm2 jlist', (chkErr, chkStdout) => {
                                    if (chkErr || !chkStdout) return;
                                    try {
                                        const updatedProcs = JSON.parse(chkStdout);
                                        const target = updatedProcs.find(p => p.name === appName);
                                        if (target && target.pm2_env.status === 'online') {
                                            pm2DownAlertState[appName] = false;
                                            savedRestartCounts[appName] = Number(target.pm2_env.restart_time || restarts);
                                            saveRestartState(savedRestartCounts);
                                            sendGuidedServerTelegram({
                                                category: 'pm2Alerts',
                                                title: `자동 복구 성공: ${appName}`,
                                                tgText: `✅ *[JG Server 자동 복구 성공]*\n\n• *프로세스*: \`${appName}\`\n• *현재 상태*: \`online\`\n• *복구 완료*: 정상 가동 중입니다.`
                                            });
                                            sendBroadcastPush({
                                                title: '✅ 서버 복구 성공',
                                                body: `${appName} 프로세스가 자동 재기동되어 정상 복구되었습니다.`,
                                                url: 'https://j-jg.cc/admin#tab-overview',
                                                type: 'system',
                                                tag: `jg-pm2-${appName}`,
                                                adminOnly: true,
                                                meta: { skipTelegram: true }
                                            });
                                        } else {
                                            sendGuidedServerTelegram({
                                                category: 'pm2Alerts',
                                                title: `자동 복구 실패: ${appName}`,
                                                tgText: `❌ *[JG Server 자동 복구 실패]*\n\n• *프로세스*: \`${appName}\`\n• *현재 상태*: \`${target ? target.pm2_env.status : 'unknown'}\`\n• *경고*: 재기동 후에도 online 상태가 아닙니다.`,
                                                guide: `관리자 페이지(https://j-jg.cc/admin#tab-overview) 또는 SSH에서 에러 로그를 확인하고 수동 재기동하세요:\n\`pm2 logs ${appName} --err --lines 30\``
                                            });
                                        }
                                    } catch (parseChkErr) {}
                                });
                            }, 4000);
                        });
                    }
                    // 2. 수동 복구 또는 다음 주기에서 정상 복구 확인된 경우
                    else if (isOnline && pm2DownAlertState[appName]) {
                        pm2DownAlertState[appName] = false;
                        savedRestartCounts[appName] = restarts;
                        stateDirty = true;
                        console.log(`✅ [PM2 RECOVERY] ${appName} 프로세스 정상 복구 확인`);

                        sendGuidedServerTelegram({
                            category: 'pm2Alerts',
                            title: `프로세스 정상 복구: ${appName}`,
                            tgText: `✅ *[JG Server 프로세스 정상 복구]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: \`online\`\n• *복구 시각*: ${currentTargetDateTime}`
                        });
                        sendBroadcastPush({
                            title: '✅ 서버 복구',
                            body: `${appName} 프로세스가 다시 온라인(online) 상태로 정상 복구되었습니다.`,
                            url: 'https://j-jg.cc/admin#tab-overview',
                            type: 'system',
                            tag: `jg-pm2-${appName}`,
                            adminOnly: true,
                            meta: { skipTelegram: true }
                        });
                    }
                }
            });

            if (stateDirty) {
                saveRestartState(savedRestartCounts);
            }
        } catch (parseErr) {}
    });
}

function checkDiskHealth(kstDateStr, kstTimeStr, currentTargetDateTime, sendBroadcastPush) {
    // 1. 로컬 HTTP, 외부 터널 및 보조 서버(192.168.50.75) 상태 주기적 점검 (60초 스로틀 내장)
    checkExtendedHealth(kstDateStr, currentTargetDateTime, sendBroadcastPush);

    // 1-1. RAM 90%, 노트 9 배터리/발열, 일일 상태 브리핑 점검
    checkRamAndHardwareHealth(currentTargetDateTime, sendBroadcastPush);
    checkDailyServerSummary(kstDateStr, kstTimeStr, currentTargetDateTime);

    // 2. 메인 서버 루트 디스크 용량 점검 (5분마다)
    if (kstTimeStr.endsWith('0') || kstTimeStr.endsWith('5')) {
        exec("df -k / | awk 'NR==2 {print $2, $3, $4, $5}'", (dfErr, dfStdout) => {
            if (dfErr || !dfStdout) return;
            try {
                const [totalBlocks, usedBlocks, availBlocks, usePercentStr] = dfStdout.trim().split(/\s+/);
                const usePercent = parseInt(usePercentStr.replace('%', ''), 10);
                if (!isNaN(usePercent) && usePercent >= 90) {
                    // 일 1회 제한 (하루 1번만 발송하여 도배 방지)
                    if (lastDiskAlertDate !== kstDateStr) {
                        lastDiskAlertDate = kstDateStr;
                        const totalGB = (parseInt(totalBlocks, 10) / 1024 / 1024).toFixed(1);
                        const availGB = (parseInt(availBlocks, 10) / 1024 / 1024).toFixed(1);

                        const diskAlertMsg = `⚠️ *[JG Server 디스크 용량 경보]*\n\n• *루트 저장소(/)*: *${usePercent}%* 사용 중!\n• *잔여 용량*: ${availGB} GB / 전체: ${totalGB} GB\n• *감지 시각*: ${currentTargetDateTime}\n\n_디스크 풀(100%) 발생 시 DB 락 및 서버 크래시가 발생할 수 있습니다._`;
                        sendGuidedServerTelegram({
                            category: 'resourceAlerts',
                            title: '디스크 용량 경보',
                            tgText: diskAlertMsg,
                            guide: 'PM2 로그 비우기(`pm2 flush`) 및 오래된 백업/임시파일을 정리하세요 (`df -h`).'
                        });
                        if (typeof sendBroadcastPush === 'function') {
                            sendBroadcastPush({
                                title: '⚠️ 디스크 용량 경보',
                                body: `메인 서버 저장소(/) 사용률 ${usePercent}% 도달 (잔여 ${availGB}GB)`,
                                url: 'https://j-jg.cc/admin#tab-overview',
                                type: 'system',
                                tag: 'jg-main-disk',
                                adminOnly: true,
                                meta: { skipTelegram: true }
                            });
                        }
                        console.warn(`⚠️ [DISK ALERT] 루트 디스크 사용량 ${usePercent}% 초과 경보 발송`);
                    }
                }
            } catch (dfParseErr) {}
        });
    }
}

module.exports = {
    checkPm2Health,
    checkDiskHealth
};
