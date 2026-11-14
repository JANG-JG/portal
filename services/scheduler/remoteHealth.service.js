const http = require('http');
const os = require('os');
const { exec } = require('child_process');
const { SECONDARY_HOST } = require('../../config/constants');
const { sendServerTelegram } = require('../telegramAlert.service');

const LOCAL_HTTP_TARGETS = [
    { name: 'portal', label: 'JG 통합 포털', port: 3004, path: '/health' },
    { name: 'blood-pressure-app', label: '혈압·건강 관리', port: 3000, path: '/' },
    { name: 'asset', label: '내 자산 관리', port: 3003, path: '/' },
    { name: 'family-album', label: '가족 앨범', port: 3005, path: '/health' },
    { name: 'news-dashboard', label: 'AI 뉴스룸', port: 5050, path: '/' }
];

const SECONDARY_APPS = ['family-wiki', 'ssd-https-agent'];

const failStreaks = {};
const alertActive = {};
const secondaryRestartCounts = {};
let lastSecondaryDiskAlertDate = '';
let lastProbeTimestamp = 0;

function probeLocalHttp(port, reqPath, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: timeoutMs }, (res) => {
            res.resume();
            resolve({ ok: res.statusCode > 0 && res.statusCode < 500, statusCode: res.statusCode });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, error: 'TIMEOUT' });
        });
        req.on('error', (err) => {
            resolve({ ok: false, error: err.code || err.message });
        });
    });
}

function emitSystemAlert(sendBroadcastPush, { title, body, tgText, url, tag }) {
    sendServerTelegram(tgText);
    if (typeof sendBroadcastPush === 'function') {
        sendBroadcastPush({
            title,
            body,
            url: url || 'https://j-jg.cc/admin#tab-overview',
            type: 'system',
            tag: tag || 'jg-system-health',
            adminOnly: true
        });
    }
}

function handleThresholdCheck(key, isHealthy, currentTargetDateTime, sendBroadcastPush, alertPayload, recoverPayload) {
    if (!isHealthy) {
        failStreaks[key] = (failStreaks[key] || 0) + 1;
        if (failStreaks[key] >= 2 && !alertActive[key]) {
            alertActive[key] = true;
            emitSystemAlert(sendBroadcastPush, {
                ...alertPayload,
                tgText: `${alertPayload.tgText}\n• *감지 시각*: ${currentTargetDateTime}`
            });
        }
        return;
    }

    failStreaks[key] = 0;
    if (alertActive[key]) {
        alertActive[key] = false;
        emitSystemAlert(sendBroadcastPush, {
            ...recoverPayload,
            tgText: `${recoverPayload.tgText}\n• *복구 시각*: ${currentTargetDateTime}`
        });
    }
}

async function checkLocalHttpEndpoints(currentTargetDateTime, sendBroadcastPush) {
    await Promise.all(LOCAL_HTTP_TARGETS.map(async (target) => {
        const res = await probeLocalHttp(target.port, target.path);
        const key = `http:${target.name}`;
        const errDetail = res.statusCode ? `HTTP ${res.statusCode}` : (res.error || '연결 실패');
        handleThresholdCheck(
            key,
            res.ok,
            currentTargetDateTime,
            sendBroadcastPush,
            {
                title: '🚨 서비스 응답 장애',
                body: `${target.label}(:${target.port}) 응답 이상 (${errDetail})`,
                tag: `jg-http-${target.name}`,
                tgText: `🚨 *[JG Server HTTP 응답 이상]*\n\n• *서비스*: \`${target.name}\` (${target.label})\n• *포트*: \`${target.port}${target.path}\`\n• *원인*: \`${errDetail}\``
            },
            {
                title: '✅ 서비스 응답 복구',
                body: `${target.label}(:${target.port}) HTTP 응답이 정상 복구되었습니다.`,
                tag: `jg-http-${target.name}`,
                tgText: `✅ *[JG Server HTTP 응답 복구]*\n\n• *서비스*: \`${target.name}\` (${target.label})\n• *포트*: \`${target.port}${target.path}\`\n• *상태*: 정상 응답`
            }
        );
    }));
}

function checkSecondaryServerHealth(kstDateStr, currentTargetDateTime, sendBroadcastPush) {
    if (!SECONDARY_HOST) return;

    const sshUser = process.env.SECONDARY_USER || os.userInfo().username;
    const remoteScript = [
        'echo "___PM2___" && (export PATH=$PATH:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin; [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; pm2 jlist 2>/dev/null || echo "[]")',
        'echo "___WIKI___" && (curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:5060/health 2>/dev/null || echo "000")',
        'echo "___DISK___" && (df -k / | awk "NR==2 {print \\$5}" 2>/dev/null || echo "0%")',
        'echo "___SSD___" && ((mountpoint -q /media/external_ssd 2>/dev/null || df -k /media/external_ssd >/dev/null 2>&1) && echo "MOUNTED" || echo "UNMOUNTED")'
    ].join(' && ');

    const sshCmd = `ssh -p 22 -o ConnectTimeout=3 -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${sshUser}@${SECONDARY_HOST} '${remoteScript}'`;
    exec(sshCmd, { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) {
            handleThresholdCheck(
                'sec:ssh',
                false,
                currentTargetDateTime,
                sendBroadcastPush,
                {
                    title: '🚨 보조 서버 연결 끊김',
                    body: `보조 서버(${SECONDARY_HOST}) SSH 응답이 없습니다. 위키/사진 외장 SSD 확인이 필요합니다.`,
                    tag: 'jg-sec-host',
                    tgText: `🚨 *[보조 서버(${SECONDARY_HOST}) 오프라인 경보]*\n\n• *대상*: 보조 서버 (\`${SECONDARY_HOST}\`)\n• *원인*: SSH 연결 실패 또는 전원 꺼짐\n• *영향*: \`family-wiki\`, \`ssd-https-agent\`, 외장 SSD 접근 불가`
                },
                { title: '', body: '', tag: 'jg-sec-host', tgText: '' }
            );
            return;
        }

        handleThresholdCheck(
            'sec:ssh',
            true,
            currentTargetDateTime,
            sendBroadcastPush,
            { title: '', body: '', tag: 'jg-sec-host', tgText: '' },
            {
                title: '✅ 보조 서버 연결 복구',
                body: `보조 서버(${SECONDARY_HOST}) 연결이 정상 복구되었습니다.`,
                tag: 'jg-sec-host',
                tgText: `✅ *[보조 서버(${SECONDARY_HOST}) 온라인 복구]*\n\n• *상태*: SSH 및 원격 감시 연결 정상 복구`
            }
        );

        const pm2Match = stdout.match(/___PM2___\s*([\s\S]*?)___WIKI___/);
        const wikiMatch = stdout.match(/___WIKI___\s*(\d{3})/);
        const diskMatch = stdout.match(/___DISK___\s*(\d+)%/);
        const ssdMatch = stdout.match(/___SSD___\s*(MOUNTED|UNMOUNTED)/);

        if (pm2Match) {
            try {
                const procs = JSON.parse(pm2Match[1].trim() || '[]');
                SECONDARY_APPS.forEach((appName) => {
                    const proc = procs.find(p => p.name === appName);
                    const status = proc ? (proc.pm2_env?.status || 'unknown') : 'missing';
                    const isOnline = status === 'online';
                    const restarts = proc ? (proc.pm2_env?.restart_time || 0) : 0;

                    if (secondaryRestartCounts[appName] !== undefined && restarts > secondaryRestartCounts[appName] && isOnline) {
                        emitSystemAlert(sendBroadcastPush, {
                            title: '⚠️ 보조 서버 재시작 감지',
                            body: `${appName}(${SECONDARY_HOST}) 재시작 감지 (${secondaryRestartCounts[appName]} → ${restarts}회)`,
                            tag: `jg-sec-restart-${appName}`,
                            tgText: `⚠️ *[보조 서버 프로세스 재시작 감지]*\n\n• *서버*: \`${SECONDARY_HOST}\`\n• *프로세스*: \`${appName}\`\n• *재시작 누적*: ${secondaryRestartCounts[appName]} → ${restarts}회\n• *감지 시각*: ${currentTargetDateTime}`
                        });
                    }
                    secondaryRestartCounts[appName] = restarts;

                    handleThresholdCheck(
                        `sec:pm2:${appName}`,
                        isOnline,
                        currentTargetDateTime,
                        sendBroadcastPush,
                        {
                            title: '🚨 보조 서버 프로세스 장애',
                            body: `${appName}(${SECONDARY_HOST}) 상태 이상 (${status})`,
                            tag: `jg-sec-pm2-${appName}`,
                            tgText: `🚨 *[보조 서버 프로세스 장애]*\n\n• *서버*: \`${SECONDARY_HOST}\`\n• *프로세스*: \`${appName}\`\n• *상태*: \`${status}\``
                        },
                        {
                            title: '✅ 보조 서버 프로세스 복구',
                            body: `${appName}(${SECONDARY_HOST}) 상태가 online으로 복구되었습니다.`,
                            tag: `jg-sec-pm2-${appName}`,
                            tgText: `✅ *[보조 서버 프로세스 복구]*\n\n• *서버*: \`${SECONDARY_HOST}\`\n• *프로세스*: \`${appName}\`\n• *상태*: \`online\``
                        }
                    );
                });
            } catch (e) {}
        }

        if (wikiMatch) {
            const code = parseInt(wikiMatch[1], 10);
            handleThresholdCheck(
                'sec:wiki-http',
                code > 0 && code < 500,
                currentTargetDateTime,
                sendBroadcastPush,
                {
                    title: '🚨 가족 위키 응답 장애',
                    body: `family-wiki(${SECONDARY_HOST}:5060) HTTP 응답 오류 (${code})`,
                    tag: 'jg-sec-wiki-http',
                    tgText: `🚨 *[보조 서버 HTTP 응답 이상]*\n\n• *서비스*: \`family-wiki\` (\`${SECONDARY_HOST}:5060/health\`)\n• *응답 코드*: \`${code}\``
                },
                {
                    title: '✅ 가족 위키 응답 복구',
                    body: `family-wiki(${SECONDARY_HOST}:5060) HTTP 응답이 정상 복구되었습니다.`,
                    tag: 'jg-sec-wiki-http',
                    tgText: `✅ *[보조 서버 HTTP 응답 복구]*\n\n• *서비스*: \`family-wiki\` (\`${SECONDARY_HOST}:5060/health\`)`
                }
            );
        }

        if (ssdMatch) {
            const isMounted = ssdMatch[1] === 'MOUNTED';
            handleThresholdCheck(
                'sec:ssd',
                isMounted,
                currentTargetDateTime,
                sendBroadcastPush,
                {
                    title: '🚨 외장 SSD 마운트 해제',
                    body: `보조 서버(${SECONDARY_HOST}) /media/external_ssd 마운트가 해제되었습니다.`,
                    tag: 'jg-sec-ssd',
                    tgText: `🚨 *[보조 서버 외장 SSD 마운트 경보]*\n\n• *서버*: \`${SECONDARY_HOST}\`\n• *경로*: \`/media/external_ssd\`\n• *상태*: 언마운트(UNMOUNTED) 감지`
                },
                {
                    title: '✅ 외장 SSD 마운트 복구',
                    body: `보조 서버(${SECONDARY_HOST}) 외장 SSD 마운트가 정상 복구되었습니다.`,
                    tag: 'jg-sec-ssd',
                    tgText: `✅ *[보조 서버 외장 SSD 마운트 복구]*\n\n• *서버*: \`${SECONDARY_HOST}\`\n• *경로*: \`/media/external_ssd\``
                }
            );
        }

        if (diskMatch) {
            const pct = parseInt(diskMatch[1], 10);
            if (!isNaN(pct) && pct >= 90 && lastSecondaryDiskAlertDate !== kstDateStr) {
                lastSecondaryDiskAlertDate = kstDateStr;
                emitSystemAlert(sendBroadcastPush, {
                    title: '⚠️ 보조 서버 디스크 부족',
                    body: `보조 서버(${SECONDARY_HOST}) 디스크 사용량이 ${pct}%에 도달했습니다.`,
                    tag: 'jg-sec-disk',
                    tgText: `⚠️ *[보조 서버 디스크 용량 경보]*\n\n• *서버*: \`${SECONDARY_HOST}\`\n• *사용률*: *${pct}%*\n• *감지 시각*: ${currentTargetDateTime}`
                });
            }
        }
    });
}

function checkExtendedHealth(kstDateStr, currentTargetDateTime, sendBroadcastPush) {
    const now = Date.now();
    if (now - lastProbeTimestamp < 60000) return;
    lastProbeTimestamp = now;

    checkLocalHttpEndpoints(currentTargetDateTime, sendBroadcastPush).catch(() => {});
    checkSecondaryServerHealth(kstDateStr, currentTargetDateTime, sendBroadcastPush);
}

module.exports = {
    checkExtendedHealth
};
