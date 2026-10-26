const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { formatUptime } = require('./format.util');
const {
    getSecondaryServerStatus,
    performSecondaryServerCheck,
    refreshSecondaryServerInBackground
} = require('./secondary.service');

// 1) 실시간 호스트 CPU 사용률 백그라운드 계산기 (/proc/stat 직접 파싱 - 프로세스 포크 부하 0)
let currentCpuPercent = 0;
let latestPidCpuMap = {};
let prevCpuTimes = null;

function updateCpuUsage() {
    fs.readFile('/proc/stat', 'utf8', (err, data) => {
        if (!err && data) {
            const firstLine = data.split('\n')[0];
            if (firstLine && firstLine.startsWith('cpu ')) {
                const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);
                const idle = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
                const total = parts.reduce((acc, val) => acc + (val || 0), 0);

                if (prevCpuTimes) {
                    const idleDiff = idle - prevCpuTimes.idle;
                    const totalDiff = total - prevCpuTimes.total;
                    if (totalDiff > 0) {
                        const usage = Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
                        currentCpuPercent = Math.max(1, usage);
                    }
                }
                prevCpuTimes = { idle, total };
                return;
            }
        }
        // Fallback: os.loadavg
        const load = os.loadavg()[0];
        const cpus = os.cpus().length || 8;
        currentCpuPercent = Math.max(1, Math.min(100, Math.round((load / cpus) * 100)));
    });
}
updateCpuUsage();
setInterval(updateCpuUsage, 10000);

// 실시간 메모리(RAM) /proc/meminfo 정밀 수집기
function getRealMemoryInfo() {
    try {
        if (fs.existsSync('/proc/meminfo')) {
            const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
            let totalKb = 0, availKb = 0, freeKb = 0, buffersKb = 0, cachedKb = 0;
            meminfo.split('\n').forEach(line => {
                if (line.startsWith('MemTotal:')) totalKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('MemAvailable:')) availKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('MemFree:')) freeKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('Buffers:')) buffersKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                else if (line.startsWith('Cached:')) cachedKb = parseInt(line.split(/\s+/)[1], 10) || 0;
            });

            if (totalKb > 0) {
                const available = availKb > 0 ? availKb : (freeKb + buffersKb + cachedKb);
                const usedKb = totalKb - available;
                const pct = Math.max(1, Math.min(100, Math.round((usedKb / totalKb) * 1000) / 10));
                return {
                    percent: `${pct.toFixed(1)}%`,
                    percentNum: pct,
                    used: `${(usedKb / 1024 / 1024).toFixed(2)} GB`,
                    total: `${(totalKb / 1024 / 1024).toFixed(2)} GB`,
                    free: `${(available / 1024 / 1024).toFixed(2)} GB`
                };
            }
        }
    } catch (e) {}

    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const pct = Math.max(1, Math.min(100, Math.round((used / total) * 1000) / 10));
    return {
        percent: `${pct.toFixed(1)}%`,
        percentNum: pct,
        used: `${(used / 1024 / 1024 / 1024).toFixed(2)} GB`,
        total: `${(total / 1024 / 1024 / 1024).toFixed(2)} GB`,
        free: `${(free / 1024 / 1024 / 1024).toFixed(2)} GB`
    };
}

// Android Host / Termux 실제 서버 가동 시간 측정
let uptimeCache = { value: '측정 중...', checkedAt: 0 };
async function getRealServerUptime() {
    const now = Date.now();
    if (now - uptimeCache.checkedAt < 10000) {
        return uptimeCache.value;
    }
    return new Promise((resolve) => {
        exec('/data/data/com.termux/files/usr/bin/uptime 2>/dev/null || uptime', { timeout: 1500 }, (err, stdout) => {
            if (!err && stdout) {
                const match = stdout.match(/up\s+([^,]+(?:,\s*[^,]+)?),\s*\d+\s+users?/);
                if (match) {
                    const part = match[1].trim();
                    const hmOnly = part.match(/^(\d+):(\d+)$/);
                    if (hmOnly) {
                        const val = `${parseInt(hmOnly[1], 10)}시간 ${parseInt(hmOnly[2], 10)}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    const dayHm = part.match(/^(\d+)\s+days?,\s*(\d+):(\d+)$/);
                    if (dayHm) {
                        const val = `${dayHm[1]}일 ${parseInt(dayHm[2], 10)}시간 ${parseInt(dayHm[3], 10)}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    const dayMin = part.match(/^(\d+)\s+days?,\s*(\d+)\s+min/);
                    if (dayMin) {
                        const val = `${dayMin[1]}일 ${dayMin[2]}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    const minOnly = part.match(/^(\d+)\s+min/);
                    if (minOnly) {
                        const val = `${minOnly[1]}분`;
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                    uptimeCache = { value: part, checkedAt: now };
                    return resolve(part);
                }
            }
            exec('ps -eo etimes | sort -nr | head -n 1', { timeout: 1000 }, (pErr, pStdout) => {
                if (!pErr && pStdout) {
                    const sec = parseInt(pStdout.trim(), 10);
                    if (sec > 0) {
                        const val = formatUptime(sec);
                        uptimeCache = { value: val, checkedAt: now };
                        return resolve(val);
                    }
                }
                const fallback = formatUptime(os.uptime());
                uptimeCache = { value: fallback, checkedAt: now };
                resolve(fallback);
            });
        });
    });
}

// 3) RAM(메모리) 상위 점유 프로세스 TOP 10 실시간 수집기
async function getTopMemoryProcesses() {
    return new Promise((resolve) => {
        exec('ps -eo pid,user,%cpu,%mem,rss,args --sort=-%mem | head -n 11', { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) return resolve([]);
            try {
                const lines = stdout.trim().split('\n').slice(1);
                const pidCpuMap = {};
                let cpuSum = 0;
                const list = lines.map(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 6) return null;
                    const pid = parts[0];
                    const user = parts[1];
                    const cpu = parseFloat(parts[2]) || 0;
                    const mem = parseFloat(parts[3]) || 0;
                    const rssKb = parseInt(parts[4], 10) || 0;
                    const fullCmd = parts.slice(5).join(' ');
                    let shortName = path.basename(parts[5]);
                    if (shortName === 'node' && parts[6]) {
                        shortName = 'node ' + path.basename(parts[6]);
                    } else if (shortName.startsWith('python') && parts[6]) {
                        shortName = 'python ' + path.basename(parts[parts.length - 1]);
                    }
                    pidCpuMap[String(pid)] = cpu;
                    cpuSum += cpu;
                    return {
                        pid,
                        user,
                        cpu: `${cpu.toFixed(1)}%`,
                        mem: `${mem.toFixed(1)}%`,
                        rss: `${(rssKb / 1024).toFixed(1)} MB`,
                        name: shortName,
                        fullCommand: fullCmd.slice(0, 80)
                    };
                }).filter(Boolean);
                latestPidCpuMap = pidCpuMap;
                if (cpuSum > 0) {
                    const cpus = os.cpus().length || 8;
                    currentCpuPercent = Math.max(1, Math.min(100, Math.round(cpuSum / cpus)));
                }
                resolve(list);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

// 4) CPU 하드웨어 온도 측정
let cpuTempCache = {
    timestamp: 0,
    temp: null,
    status: 'normal'
};

async function getCpuTemperature() {
    const now = Date.now();
    if (cpuTempCache.temp !== null && (now - cpuTempCache.timestamp < 60000)) {
        return cpuTempCache;
    }

    return new Promise((resolve) => {
        exec('sensors -j', { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) {
                return resolve(cpuTempCache);
            }
            try {
                const data = JSON.parse(stdout);
                let tempVal = null;

                for (const key of Object.keys(data)) {
                    if (key.includes('k10temp') || key.includes('coretemp')) {
                        const chip = data[key];
                        for (const sensorKey of Object.keys(chip)) {
                            if (chip[sensorKey]?.temp1_input !== undefined) {
                                tempVal = chip[sensorKey].temp1_input;
                                break;
                            }
                        }
                    }
                    if (tempVal !== null) break;
                }

                if (tempVal === null) {
                    for (const key of Object.keys(data)) {
                        if (key.includes('acpitz')) {
                            const chip = data[key];
                            for (const sensorKey of Object.keys(chip)) {
                                if (chip[sensorKey]?.temp1_input !== undefined) {
                                    tempVal = chip[sensorKey].temp1_input;
                                    break;
                                }
                            }
                        }
                        if (tempVal !== null) break;
                    }
                }

                if (tempVal !== null) {
                    const rounded = Math.round(tempVal * 10) / 10;
                    let status = 'normal';
                    if (rounded >= 75) status = 'hot';
                    else if (rounded >= 65) status = 'warn';

                    cpuTempCache = {
                        timestamp: now,
                        temp: rounded,
                        status
                    };
                }
            } catch (e) {}
            resolve(cpuTempCache);
        });
    });
}

// 5) 디스크 용량 측정
let diskCache = {
    timestamp: 0,
    used: '0 GB',
    total: '0 GB',
    percent: '0%',
    percentNum: 0
};

async function getDiskUsage() {
    const now = Date.now();
    if (diskCache.percentNum > 0 && (now - diskCache.timestamp < 5000)) {
        return diskCache;
    }

    return new Promise((resolve) => {
        exec(`df -m "${__dirname}"`, { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) return resolve(diskCache);
            try {
                const lines = stdout.trim().split('\n');
                if (lines.length >= 2) {
                    const parts = lines[1].trim().split(/\s+/);
                    const totalM = parseInt(parts[1], 10);
                    const usedM = parseInt(parts[2], 10);
                    const totalG = (totalM / 1024).toFixed(2);
                    const usedG = (usedM / 1024).toFixed(2);
                    const pct = Math.max(1, Math.min(100, Math.round((usedM / totalM) * 1000) / 10));
                    diskCache = {
                        timestamp: now,
                        used: `${usedG} GB`,
                        total: `${totalG} GB`,
                        percent: `${pct.toFixed(1)}%`,
                        percentNum: pct
                    };
                }
            } catch (e) {}
            resolve(diskCache);
        });
    });
}

module.exports = {
    getCurrentCpuPercent: () => currentCpuPercent,
    getLatestPidCpuMap: () => latestPidCpuMap,
    formatUptime,
    getRealMemoryInfo,
    getRealServerUptime,
    getSecondaryServerStatus,
    performSecondaryServerCheck,
    refreshSecondaryServerInBackground,
    getTopMemoryProcesses,
    getCpuTemperature,
    getDiskUsage
};
