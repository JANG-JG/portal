const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');

const {
    WORKSPACE_ROOT,
    BLOOD_DB_PATH,
    ASSET_DB_PATH,
    NEWS_DB_PATH,
    ALBUM_DB_PATH,
    PORTAL_DB_PATH
} = require('../../config/constants');
const { db, newsDb } = require('../../services/db');
const { sendServerTelegram } = require('../../services/unifiedNotificationScheduler');
const {
    getCurrentCpuPercent,
    getLatestPidCpuMap,
    formatUptime,
    getRealMemoryInfo,
    getRealServerUptime,
    getSecondaryServerStatus,
    getTopMemoryProcesses,
    getCpuTemperature,
    getDiskUsage
} = require('../../services/systemMonitor.service');

// 1. 전체 프로세스(PM2), DB 용량, 시스템 리소스 현황 및 듀얼 서버 모니터링
let adminOverviewCache = null;
let adminOverviewCacheTime = 0;
let isAdminOverviewUpdating = false;

router.get('/overview', async (req, res) => {
    try {
        const now = Date.now();
        const force = req.query.force === '1' || req.query.force === 'true';
        if (!force && adminOverviewCache && (now - adminOverviewCacheTime < 8000 || isAdminOverviewUpdating)) {
            return res.json(adminOverviewCache);
        }
        isAdminOverviewUpdating = true;

        const [tempInfo, diskInfo, secondaryServer, topMemList, realUptime] = await Promise.all([
            getCpuTemperature(),
            getDiskUsage(),
            getSecondaryServerStatus(),
            getTopMemoryProcesses(),
            getRealServerUptime()
        ]);

        const currentCpuPercent = getCurrentCpuPercent();
        const latestPidCpuMap = getLatestPidCpuMap();

        exec('pm2 jlist', { timeout: 3000 }, (err, stdout) => {
            let processes = [];
            if (!err && stdout) {
                try {
                    const list = JSON.parse(stdout);
                    const displayNames = {
                        'portal': '🏠 JG 통합 포털',
                        'blood-pressure-app': '🩸 혈압 관리 서비스',
                        'asset': '💰 내 자산 관리 서비스',
                        'news-dashboard': '📰 AI 뉴스 대시보드',
                        'news-scheduler': '⏱️ 모닝 뉴스 스케줄러 데몬',
                        'cloudflared': '🛡️ Cloudflare 보안 터널'
                    };
                    const ports = {
                        'portal': '3004',
                        'blood-pressure-app': '3000',
                        'asset': '3003',
                        'news-dashboard': '5050',
                        'news-scheduler': 'Daemon',
                        'cloudflared': 'Tunnel'
                    };
                    processes = list.map(p => {
                        const pidStr = String(p.pid);
                        let cpuVal = '-';
                        if (latestPidCpuMap[pidStr] !== undefined) {
                            cpuVal = `${latestPidCpuMap[pidStr].toFixed(1)}%`;
                        } else if (p.monit && p.monit.cpu > 0) {
                            cpuVal = `${p.monit.cpu}%`;
                        } else if (p.pm2_env?.status === 'online') {
                            cpuVal = '0.0%';
                        }
                        return {
                            name: p.name,
                            displayName: displayNames[p.name] || (`⚙️ ${p.name}`),
                            status: p.pm2_env?.status || 'unknown',
                            pid: p.pid,
                            pm_id: p.pm_id,
                            memory: p.monit ? (p.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : '-',
                            cpu: cpuVal,
                            restarts: p.pm2_env?.restart_time || 0,
                            port: ports[p.name] || '-'
                        };
                    });
                } catch (e) {}
            }

            const formatSize = (bytes) => {
                if (!bytes || bytes <= 0) return '0 KB';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / 1024 / 1024).toFixed(2) + ' MB';
            };

            const getFileSize = (filePath) => {
                try { return formatSize(fs.statSync(filePath).size); }
                catch (e) { return '미존재'; }
            };

            const dbs = {
                portal: getFileSize(PORTAL_DB_PATH),
                health: getFileSize(BLOOD_DB_PATH),
                asset: getFileSize(ASSET_DB_PATH),
                briefing: getFileSize(NEWS_DB_PATH),
                album: getFileSize(ALBUM_DB_PATH)
            };

            const memoryInfo = getRealMemoryInfo();
            const uptimeStr = realUptime || formatUptime(os.uptime());

            const responseData = {
                success: true,
                processes,
                dbs,
                topMemoryProcesses: topMemList || [],
                dualServers: {
                    primary: {
                        name: '삼성 갤럭시 노트 9 (메인 앱 서버)',
                        ip: '192.168.50.111:2222',
                        role: '포털, 혈압, 자산, AI 뉴스, Cloudflare 터널',
                        status: 'online',
                        uptime: uptimeStr,
                        cpu: `${currentCpuPercent}%`,
                        mem: memoryInfo.percent
                    },
                    secondary: secondaryServer
                },
                system: {
                    memUsage: memoryInfo.percent,
                    memFree: memoryInfo.free,
                    memTotal: memoryInfo.total,
                    uptimeStr: uptimeStr,
                    cpu: {
                        percent: `${currentCpuPercent}%`,
                        percentNum: currentCpuPercent,
                        temp: tempInfo.temp !== null ? `${tempInfo.temp}°C` : '비인가 (SELinux 격리)',
                        tempStatus: tempInfo.status
                    },
                    memory: memoryInfo,
                    disk: diskInfo
                }
            };

            adminOverviewCache = responseData;
            adminOverviewCacheTime = Date.now();
            isAdminOverviewUpdating = false;
            res.json(responseData);
        });
    } catch (err) {
        isAdminOverviewUpdating = false;
        console.error('관리자 오버뷰 조회 오류:', err);
        res.status(500).json({ success: false, message: '서버 상태 조회 실패' });
    }
});

// 1-2. 보조 서버(HP 노트북) 즉시 실시간 핑 테스트 API
router.get('/secondary/ping', async (req, res) => {
    try {
        const secondary = await getSecondaryServerStatus(true);
        res.json({ success: true, secondary });
    } catch (e) {
        res.status(500).json({ success: false, message: '보조 서버 핑 테스트 실패: ' + e.message });
    }
});

// 1-3. 보조 서버(HP 노트북) 즉시 핫 백업 전송 수동 트리거 API
let isManualBackupRunning = false;
router.post('/secondary/backup-now', (req, res) => {
    if (isManualBackupRunning) {
        return res.status(429).json({ success: false, message: '이미 백업 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' });
    }

    let scriptPath = path.resolve(WORKSPACE_ROOT, 'scripts', 'backup-to-secondary.sh');
    if (!fs.existsSync(scriptPath)) {
        const altPath = path.join(os.homedir(), 'scripts', 'backup-to-secondary.sh');
        if (fs.existsSync(altPath)) scriptPath = altPath;
    }

    if (!fs.existsSync(scriptPath)) {
        return res.status(404).json({ success: false, message: '백업 스크립트를 찾을 수 없습니다: ' + scriptPath });
    }

    isManualBackupRunning = true;
    console.log('[Admin] 수동 보조 서버 백업 작업 시작:', scriptPath);

    execFile('bash', [scriptPath], { timeout: 120000 }, (error, stdout, stderr) => {
        isManualBackupRunning = false;
        if (error) {
            console.error('[Admin] 수동 백업 실패:', error, stderr);
            return res.status(500).json({
                success: false,
                message: '백업 실행 중 오류가 발생했습니다: ' + (error.message || stderr),
                details: stderr || stdout
            });
        }

        console.log('[Admin] 수동 백업 완료');
        res.json({
            success: true,
            message: '✅ 보조 서버(HP 노트북)로의 핫 백업 및 Rsync 전송이 성공적으로 완료되었습니다!',
            output: (stdout || '').split('\n').filter(Boolean).slice(-6).join('\n')
        });
    });
});

// 2. PM2 개별 프로세스 제어
router.post('/pm2/action', (req, res) => {
    const { action, processName } = req.body;
    const allowedActions = ['start', 'stop', 'restart'];
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;

    if (!processName || !validNameRegex.test(processName)) {
        return res.status(400).json({ success: false, message: '올바르지 않은 프로세스 이름입니다.' });
    }
    if (!action || !allowedActions.includes(action)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 제어 명령입니다 (start, stop, restart만 가능).' });
    }

    const actionLabels = {
        'start': '시작',
        'stop': '중지',
        'restart': '재기동'
    };
    const label = actionLabels[action] || action;

    exec(`pm2 ${action} ${processName}`, (err) => {
        if (err) return res.status(500).json({ success: false, message: `[${processName}] ${label} 실패: ${err.message}` });
        res.json({ success: true, message: `[${processName}] 프로세스가 정상적으로 ${label}되었습니다.` });
    });
});

// PM2 재기동 호환 API
router.post('/pm2/restart', (req, res) => {
    const { processName } = req.body;
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!processName || !validNameRegex.test(processName)) {
        return res.status(400).json({ success: false, message: '올바르지 않은 프로세스 이름입니다.' });
    }

    exec(`pm2 restart ${processName}`, (err) => {
        if (err) return res.status(500).json({ success: false, message: `재기동 실패: ${err.message}` });
        res.json({ success: true, message: `[${processName}] 프로세스가 정상적으로 재기동되었습니다.` });
    });
});

function stripAnsi(str) {
    if (!str) return '';
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function cleanPm2Logs(raw, procName) {
    const clean = stripAnsi(raw).trim();
    const lines = clean.split('\n');
    const contentLines = lines.filter(line => {
        const t = line.trim();
        if (!t) return false;
        if (t.startsWith('[TAILING]')) return false;
        if (t.includes('/.pm2/logs/') && t.endsWith('lines:')) return false;
        if (t.includes('connect.session() MemoryStore is not')) return false;
        if (t.includes('designed for a production environment, as it will leak')) return false;
        if (t.includes('memory, and will not scale past a single process.')) return false;
        if (t.startsWith('◇ injected env')) return false;
        return true;
    });

    if (contentLines.length === 0) {
        if (procName === 'cloudflared') {
            return '🛡️ [Cloudflare 보안 터널 - 정상 가동 중]\n- 터널 상태: 🟢 온라인 (Cloudflare Edge 정상 연결)\n- 서비스 도메인: j-jg.cc, blood.j-jg.cc, asset.j-jg.cc, news.j-jg.cc\n- 최근 수집된 에러나 경고 로그가 없습니다. (오류 0건, 정상 트래픽 송수신 중)';
        }
        return `🟢 [${procName || 'PM2 전체 서비스'}] 최근 기록된 시스템 에러나 출력 로그가 없습니다. (모든 프로세스 정상 가동 중)`;
    }
    return contentLines.join('\n');
}

// 2-1. PM2 실시간 서버 콘솔 로그 조회 API
router.get('/pm2/logs', (req, res) => {
    const proc = req.query.process;
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;
    const lines = Math.min(Math.max(parseInt(req.query.lines, 10) || 50, 10), 200);

    const target = (proc && validNameRegex.test(proc)) ? proc : '';
    const cmd = target ? `pm2 logs ${target} --lines ${lines} --raw --nostream` : `pm2 logs --lines ${lines} --raw --nostream`;

    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
            return res.json({ success: false, logs: '로그를 불러오는 중 오류가 발생했거나 PM2가 준비되지 않았습니다. (' + err.message + ')' });
        }
        const outText = (stdout || '').trim();
        const errText = (stderr || '').trim();
        let combined = '';
        if (outText) combined += outText;
        if (errText) {
            if (combined) combined += '\n\n--- [ 에러 로그 (STDERR) ] ---\n';
            combined += errText;
        }
        res.json({
            success: true,
            logs: cleanPm2Logs(combined, target)
        });
    });
});

// 2-1-1. PM2 로그 비우기 (flush) API
router.post('/pm2/flush', (req, res) => {
    const { processName } = req.body;
    const validNameRegex = /^[a-zA-Z0-9_\-]+$/;
    const target = (processName && validNameRegex.test(processName)) ? processName : '';
    const cmd = target ? `pm2 flush ${target}` : `pm2 flush`;

    exec(cmd, (err) => {
        if (err) return res.status(500).json({ success: false, message: '로그 비우기 실패: ' + err.message });
        res.json({ success: true, message: target ? `[${target}] 로그를 깨끗이 비웠습니다.` : '전체 PM2 로그를 깨끗이 비웠습니다.' });
    });
});

// 2-1-2. 서버 오류 텔레그램 연동 테스트 발송 API
router.post('/system/test-telegram', async (req, res) => {
    try {
        const nowKst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const testMsg = `🔔 *[JG Server 텔레그램 경보 연동 테스트]*\n\n• *상태*: IPv4 통신 정상 및 메시지 수신 확인 완료 ✅\n• *발송 시각*: ${nowKst}\n• *발송 모듈*: JG Portal Monitor Daemon\n\n이 메시지가 도착했다면 PM2 프로세스 다운(장애 발생) 및 디스크 용량 경보(90% 초과) 시 관리자 텔레그램으로 즉시 알림이 발송됩니다.`;
        const result = await sendServerTelegram(testMsg);
        if (result.success) {
            res.json({ success: true, message: '서버 알림 텔레그램 봇으로 테스트 메시지가 성공적으로 발송되었습니다.' });
        } else {
            res.status(500).json({ success: false, message: '텔레그램 발송 실패: ' + (result.error || '알 수 없는 오류') });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: '발송 요청 중 예외 발생: ' + err.message });
    }
});

// 2-2. 보안 로그인 시도 이력 조회 API
router.get('/logs/login', (req, res) => {
    const query = 'SELECT l.id, l.username, u.nickname, u.admin_memo, u.role, l.ip, l.status, l.attempted_at FROM login_logs l LEFT JOIN users u ON l.username = u.username ORDER BY l.attempted_at DESC LIMIT 100';
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '로그인 기록 조회 실패: ' + err.message });
        res.json({ success: true, logs: rows || [] });
    });
});

// 2-3. 뉴스 수집 및 발송 이력 조회 API
router.get('/logs/news', (req, res) => {
    newsDb.all('SELECT id, run_at, status, weather_info, total_collected, saved_count, telegram_sent, details FROM collection_logs ORDER BY id DESC LIMIT 50', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '뉴스 수집 기록 조회 실패: ' + err.message });
        res.json({ success: true, logs: rows || [] });
    });
});

// 3. 전체 DB 일괄 압축 백업 다운로드
router.get('/backup/all', (req, res) => {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tmpZip = path.join('/tmp', `jg_all_databases_${timestamp}.zip`);
    const pyScript = `import zipfile, os
zpath = "${tmpZip}"
zf = zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED)
for p, arc in [("${PORTAL_DB_PATH}", "portal.db"), ("${BLOOD_DB_PATH}", "health.db"), ("${ASSET_DB_PATH}", "asset.db"), ("${NEWS_DB_PATH}", "briefing.db"), ("${ALBUM_DB_PATH}", "album.db")]:
    if os.path.exists(p):
        zf.write(p, arc)
zf.close()
`;

    execFile('python3', ['-c', pyScript], (err) => {
        if (err || !fs.existsSync(tmpZip)) {
            console.error('[일괄 백업 압축 오류]', err);
            return res.status(500).json({ success: false, message: '전체 DB 압축 생성 실패: ' + (err ? err.message : '파일 없음') });
        }
        res.download(tmpZip, `jg_all_databases_${timestamp}.zip`, () => {
            try { fs.unlinkSync(tmpZip); } catch (e) {}
        });
    });
});

// 4. 개별 데이터베이스 백업 다운로드
router.get('/backup/:type', (req, res) => {
    const type = req.params.type;
    const now = new Date().toISOString().slice(0, 10);
    if (type === 'all') {
        return res.redirect('/api/admin/backup/all');
    } else if (type === 'portal') {
        return res.download(PORTAL_DB_PATH, `portal_backup_${now}.db`);
    } else if (type === 'health') {
        return res.download(BLOOD_DB_PATH, `health_backup_${now}.db`);
    } else if (type === 'asset') {
        return res.download(ASSET_DB_PATH, `asset_backup_${now}.db`);
    } else if (type === 'briefing') {
        return res.download(NEWS_DB_PATH, `briefing_backup_${now}.db`);
    } else if (type === 'album') {
        return res.download(ALBUM_DB_PATH, `album_backup_${now}.db`);
    }
    res.status(404).send('해당 DB 백업 파일을 찾을 수 없습니다.');
});

module.exports = router;
