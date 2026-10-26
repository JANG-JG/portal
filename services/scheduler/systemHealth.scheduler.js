const { exec } = require('child_process');
const { sendServerTelegram } = require('../telegramAlert.service');

const pm2DownAlertState = {};
let lastDiskAlertDate = '';

function checkPm2Health(currentTargetDateTime, sendBroadcastPush) {
    exec('pm2 jlist', (err, stdout) => {
        if (err || !stdout) return;
        try {
            const procList = JSON.parse(stdout);
            const monitoredApps = ['portal', 'blood-pressure-app', 'asset', 'news-dashboard', 'news-scheduler', 'cloudflared'];

            monitoredApps.forEach(appName => {
                const proc = procList.find(p => p.name === appName);
                if (proc) {
                    const status = proc.pm2_env.status;
                    const isOnline = status === 'online';

                    // 1. 장애 감지 (최초 다운 시 1회 발송 및 자동 재기동 시도)
                    if (!isOnline && !pm2DownAlertState[appName]) {
                        pm2DownAlertState[appName] = true;
                        console.warn(`🚨 [PM2 ALERT] ${appName} 프로세스 비정상 상태 감지 (${status})`);

                        // [텔레그램 경보 발송]
                        const alertMsg = `🚨 *[JG Server 프로세스 장애 경보]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: \`${status}\` (비정상 다운 감지)\n• *감지 시각*: ${currentTargetDateTime}\n\n⚙️ *자동 복구(pm2 restart)를 1회 시도합니다...*`;
                        sendServerTelegram(alertMsg);

                        // [웹 푸시 발송 (관리자 전용)]
                        sendBroadcastPush({
                            title: '🚨 서버 경보',
                            body: `${appName} 장애 발생 (${status}). 자동 복구를 시도합니다.`,
                            url: 'https://j-jg.cc/admin#tab-overview',
                            type: 'system',
                            tag: `jg-pm2-${appName}`,
                            adminOnly: true
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
                                            const recoveryMsg = `✅ *[JG Server 자동 복구 성공]*\n\n• *프로세스*: \`${appName}\`\n• *현재 상태*: \`online\`\n• *복구 완료*: 정상 가동 중입니다.`;
                                            sendServerTelegram(recoveryMsg);
                                            sendBroadcastPush({
                                                title: '✅ 서버 복구 성공',
                                                body: `${appName} 프로세스가 자동 재기동되어 정상 복구되었습니다.`,
                                                url: 'https://j-jg.cc/admin#tab-overview',
                                                type: 'system',
                                                tag: `jg-pm2-${appName}`,
                                                adminOnly: true
                                            });
                                        } else {
                                            const failMsg = `❌ *[JG Server 자동 복구 실패]*\n\n• *프로세스*: \`${appName}\`\n• *현재 상태*: \`${target ? target.pm2_env.status : 'unknown'}\`\n• *경고*: 재기동 후에도 online 상태가 아닙니다. 관리자의 수동 확인이 필요합니다!`;
                                            sendServerTelegram(failMsg);
                                        }
                                    } catch (parseChkErr) {}
                                });
                            }, 4000);
                        });
                    }
                    // 2. 수동 복구 또는 다음 주기에서 정상 복구 확인된 경우
                    else if (isOnline && pm2DownAlertState[appName]) {
                        pm2DownAlertState[appName] = false;
                        console.log(`✅ [PM2 RECOVERY] ${appName} 프로세스 정상 복구 확인`);

                        sendServerTelegram(`✅ *[JG Server 프로세스 정상 복구]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: \`online\`\n• *복구 시각*: ${currentTargetDateTime}`);
                        sendBroadcastPush({
                            title: '✅ 서버 복구',
                            body: `${appName} 프로세스가 다시 온라인(online) 상태로 정상 복구되었습니다.`,
                            url: 'https://j-jg.cc/admin#tab-overview',
                            type: 'system',
                            tag: `jg-pm2-${appName}`,
                            adminOnly: true
                        });
                    }
                }
            });
        } catch (parseErr) {}
    });
}

function checkDiskHealth(kstDateStr, kstTimeStr, currentTargetDateTime) {
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

                        const diskAlertMsg = `⚠️ *[JG Server 디스크 용량 경보]*\n\n• *루트 저장소(/)*: *${usePercent}%* 사용 중!\n• *잔여 용량*: ${availGB} GB / 전체: ${totalGB} GB\n• *감지 시각*: ${currentTargetDateTime}\n\n_디스크 풀(100%) 발생 시 DB 락 및 서버 크래시가 발생할 수 있습니다. 불필요한 로그와 캐시 정리를 권장합니다._`;
                        sendServerTelegram(diskAlertMsg);
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
