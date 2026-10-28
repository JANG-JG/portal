/**
 * JG Portal 통합 관리자 센터 - 서버 관제 & PM2 모니터링 모듈
 * admin-monitor.js
 */

// 1. 전체 개요 및 PM2 프로세스 로드 (실시간 모니터링)
async function loadOverviewData() {
    try {
        const res = await fetch('/api/admin/overview');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        // 1) 상단 통계 갱신
        const onlineCount = data.processes.filter(p => p.status === 'online').length;
        const activeProcEl = document.getElementById('activeProcessCount');
        const sysUptimeEl = document.getElementById('systemUptime');
        if (activeProcEl) activeProcEl.textContent = `${onlineCount} / ${data.processes.length}`;
        if (sysUptimeEl) sysUptimeEl.textContent = data.system.uptimeStr;

        // 2) 주 서버 리소스 수치 계산
        const cpuPct = data.system.cpu ? data.system.cpu.percentNum : 0;
        const memPct = data.system.memory ? data.system.memory.percentNum : 0;
        const memUsed = data.system.memory ? data.system.memory.used : '-';
        const memTotal = data.system.memory ? data.system.memory.total : '-';
        const diskPct = data.system.disk ? data.system.disk.percentNum : 0;
        const diskUsed = data.system.disk ? data.system.disk.used : '-';
        const diskTotal = data.system.disk ? data.system.disk.total : '-';

        // CPU 온도 (주 서버 요약 카드 & 배너)
        const tempEl = document.getElementById('gaugeCpuTemp');
        const primaryPaneTempEl = document.getElementById('primaryPaneCpuTemp');
        if (data.system.cpu) {
            const tVal = data.system.cpu.temp || '측정 불가';
            const tStatus = data.system.cpu.tempStatus || 'normal';
            if (tempEl) {
                tempEl.textContent = '🌡️ ' + tVal;
                tempEl.className = 'temp-badge temp-badge-' + tStatus;
            }
            if (primaryPaneTempEl) {
                primaryPaneTempEl.textContent = '🌡️ ' + tVal;
                primaryPaneTempEl.className = 'temp-badge temp-badge-' + tStatus;
            }
        }

        // 3) 보조 서버 리소스 수치 계산
        const sec = (data.dualServers && data.dualServers.secondary) || {};
        const isSecOnline = !!sec.online;
        const secCpuPct = sec.cpu ? (sec.cpu.percentNum !== undefined ? sec.cpu.percentNum : (parseFloat(sec.cpu.percent) || 0)) : 0;
        const secMemPct = sec.memory ? (sec.memory.percentNum !== undefined ? sec.memory.percentNum : (parseFloat(sec.memory.percent) || 0)) : 0;
        const secMemUsed = sec.memory ? sec.memory.used : '0 GB';
        const secMemTotal = sec.memory ? sec.memory.total : '4.0 GB';
        const secDiskPct = sec.disk ? (sec.disk.percentNum !== undefined ? sec.disk.percentNum : (parseFloat(sec.disk.percent) || 0)) : 0;
        const secDiskUsed = sec.disk ? sec.disk.used : '142.5 GB';
        const secDiskTotal = sec.disk ? sec.disk.total : '465.8 GB';

        // 4) 📈 uPlot 듀얼 서버 4개 시리즈 실시간 시계열 차트 데이터 푸시
        updateUPlotData(cpuPct, memPct, secCpuPct, secMemPct, isSecOnline);

        // 5) 💾 신규 듀얼 메모리 & 저장공간 자원 현황 카드 갱신
        // 메모리 카드
        const dualMemPVal = document.getElementById('dualMemPrimaryVal');
        const dualMemPBar = document.getElementById('dualMemPrimaryBar');
        const dualMemSVal = document.getElementById('dualMemSecVal');
        const dualMemSBar = document.getElementById('dualMemSecBar');
        if (dualMemPVal) dualMemPVal.textContent = `${memUsed} / ${memTotal} (${memPct}%)`;
        if (dualMemPBar) dualMemPBar.style.width = Math.min(100, Math.max(0, memPct)) + '%';
        if (dualMemSVal) {
            dualMemSVal.textContent = isSecOnline ? `${secMemUsed} / ${secMemTotal} (${secMemPct}%)` : '오프라인 대기';
            dualMemSVal.style.color = isSecOnline ? '#0f172a' : '#64748b';
        }
        if (dualMemSBar) dualMemSBar.style.width = isSecOnline ? Math.min(100, Math.max(0, secMemPct)) + '%' : '0%';

        // 저장공간 카드
        const dualDiskPVal = document.getElementById('dualDiskPrimaryVal');
        const dualDiskPBar = document.getElementById('dualDiskPrimaryBar');
        const dualDiskSVal = document.getElementById('dualDiskSecVal');
        const dualDiskSBar = document.getElementById('dualDiskSecBar');
        if (dualDiskPVal) dualDiskPVal.textContent = `${diskUsed} / ${diskTotal} (${diskPct}%)`;
        if (dualDiskPBar) dualDiskPBar.style.width = Math.min(100, Math.max(0, diskPct)) + '%';
        if (dualDiskSVal) {
            dualDiskSVal.textContent = `${secDiskUsed} / ${secDiskTotal} (${secDiskPct}%)`;
        }
        if (dualDiskSBar) dualDiskSBar.style.width = Math.min(100, Math.max(0, secDiskPct)) + '%';

        // 카드 3: ⚡ 가동 상태 & 데몬 요약 듀얼 반영
        const secProcList = sec.processes || [];
        const secOnlineProcs = secProcList.filter(p => p.status === 'online').length;
        const secUpEl = document.getElementById('secServerUptimeSummary');
        const secProcEl = document.getElementById('secActiveProcessCountSummary');
        const secBadge = document.getElementById('secondaryServerBadge');
        const overallBadge = document.getElementById('dualDaemonOverallBadge');
        const secTempEl = document.getElementById('gaugeSecCpuTemp');
        const secPaneTempEl = document.getElementById('secPaneCpuTemp');

        if (secUpEl) {
            secUpEl.textContent = sec.uptimeStr || (isSecOnline ? '정상 가동' : '대기 중');
        }
        if (secProcEl) {
            secProcEl.textContent = isSecOnline ? `${secOnlineProcs} / ${secProcList.length || 3}` : `0 / ${secProcList.length || 3}`;
        }
        if (secBadge) {
            secBadge.className = isSecOnline ? 'badge-online' : 'badge-stopped';
            secBadge.textContent = isSecOnline ? `🟢 ${sec.latency || '연결됨'}` : '🔴 대기 중';
        }

        // 보조 서버 CPU 온도 반영
        if (secTempEl || secPaneTempEl) {
            const rawTVal = sec.cpu && sec.cpu.temp ? sec.cpu.temp : (isSecOnline ? '측정 대기' : '대기 중');
            const formattedTVal = rawTVal.includes('°C') ? `🌡️ ${rawTVal}` : `🌡️ ${rawTVal}°C`;
            const tStatus = (sec.cpu && sec.cpu.tempStatus) || 'normal';
            if (secTempEl) {
                secTempEl.textContent = formattedTVal;
                secTempEl.className = 'temp-badge temp-badge-' + (isSecOnline ? tStatus : 'normal');
            }
            if (secPaneTempEl) {
                secPaneTempEl.textContent = formattedTVal;
                secPaneTempEl.className = 'temp-badge temp-badge-' + (isSecOnline ? tStatus : 'normal');
            }
        }

        if (overallBadge) {
            if (onlineCount === data.processes.length && isSecOnline) {
                overallBadge.className = 'badge-online';
                overallBadge.textContent = '🟢 듀얼 정상';
            } else if (onlineCount === data.processes.length) {
                overallBadge.className = 'badge-online';
                overallBadge.textContent = '🟢 주 정상 (보조 대기)';
            } else {
                overallBadge.className = 'badge-stopped';
                overallBadge.textContent = `⚠️ 프로세스 점검 (${onlineCount}/${data.processes.length})`;
            }
        }

        // 6) DB 크기
        const dbHealth = document.getElementById('dbSizeHealth');
        const dbAsset = document.getElementById('dbSizeAsset');
        const dbNews = document.getElementById('dbSizeNews');
        if (dbHealth) dbHealth.textContent = data.dbs.health;
        if (dbAsset) dbAsset.textContent = data.dbs.asset;
        if (dbNews) dbNews.textContent = data.dbs.briefing;

        // 4) 프로세스 카드 목록 렌더링 (시작 / 중지 / 재기동 3버튼 제어 및 실시간 상태 동기화)
        const container = document.getElementById('processListContainer');
        if (container) {
            const existingCards = container.querySelectorAll('.process-item-card');
            if (existingCards.length === data.processes.length) {
                data.processes.forEach(p => {
                    const memEl = document.getElementById(`proc-mem-${p.name}`);
                    const cpuEl = document.getElementById(`proc-cpu-${p.name}`);
                    const restartsEl = document.getElementById(`proc-restarts-${p.name}`);
                    const badgeEl = document.getElementById(`proc-badge-${p.name}`);
                    const btnStart = document.getElementById(`btn-start-${p.name}`);
                    const btnStop = document.getElementById(`btn-stop-${p.name}`);
                    const btnRestart = document.getElementById(`btn-restart-${p.name}`);

                    if (memEl) memEl.textContent = p.memory;
                    if (cpuEl) cpuEl.textContent = p.cpu;
                    if (restartsEl) restartsEl.textContent = `${p.restarts}회`;
                    if (badgeEl) {
                        const isOnline = p.status === 'online';
                        badgeEl.className = isOnline ? 'badge-online' : 'badge-stopped';
                        badgeEl.textContent = isOnline ? '온라인' : p.status;
                        if (btnStart) btnStart.disabled = isOnline;
                        if (btnStop) btnStop.disabled = !isOnline;
                        if (btnRestart) btnRestart.disabled = !isOnline;
                    }
                });
            } else {
                container.innerHTML = data.processes.map(p => {
                    const isOnline = p.status === 'online';
                    const badgeClass = isOnline ? 'badge-online' : 'badge-stopped';
                    const badgeText = isOnline ? '온라인' : p.status;

                    return `
                        <div class="process-item-card" id="proc-card-${p.name}">
                            <div class="process-info">
                                <h4>
                                    ${p.displayName || p.name}
                                    <span id="proc-badge-${p.name}" class="${badgeClass}">${badgeText}</span>
                                </h4>
                                <div class="process-meta">
                                    <span>PID: ${p.pid || '-'}</span>
                                    <span>메모리: <strong id="proc-mem-${p.name}">${p.memory}</strong></span>
                                    <span>CPU: <strong id="proc-cpu-${p.name}">${p.cpu}</strong></span>
                                    <span>재기동: <span id="proc-restarts-${p.name}">${p.restarts}회</span></span>
                                    <span>포트: ${p.port || '-'}</span>
                                </div>
                            </div>
                            <div class="process-actions">
                                <button class="btn-admin-xs btn-action-start" id="btn-start-${p.name}" ${isOnline ? 'disabled' : ''} onclick="executePm2Action('start', '${p.name}')" title="프로세스 시작">
                                    ▶️ 시작
                                </button>
                                <button class="btn-admin-xs btn-action-stop" id="btn-stop-${p.name}" ${!isOnline ? 'disabled' : ''} onclick="executePm2Action('stop', '${p.name}')" title="프로세스 중지">
                                    ⏹️ 중지
                                </button>
                                <button class="btn-admin-xs btn-action-restart" id="btn-restart-${p.name}" ${!isOnline ? 'disabled' : ''} onclick="executePm2Action('restart', '${p.name}')" title="프로세스 재기동">
                                    🔄 재기동
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 5) 듀얼 서버 인프라 상태 (주 서버 & 보조 서버) 갱신
        if (data.dualServers) {
            const p = data.dualServers.primary;
            if (p) {
                const upEl = document.getElementById('primaryServerUptime');
                const cpuEl = document.getElementById('primaryServerCpu');
                const memEl = document.getElementById('primaryServerMem');
                if (upEl) upEl.textContent = p.uptime || '-';
                if (cpuEl) cpuEl.textContent = p.cpu || '-%';
                if (memEl) memEl.textContent = p.mem || '-%';
            }
            if (data.dualServers.secondary) {
                updateSecondaryServerUI(data.dualServers.secondary);
            }
        }

        // 6) RAM(메모리) 상위 점유 프로세스 (TOP 10) 테이블 갱신
        const topMemBody = document.getElementById('topMemProcessTableBody');
        if (topMemBody && data.topMemoryProcesses) {
            if (data.topMemoryProcesses.length === 0) {
                topMemBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">수집된 프로세스 정보가 없습니다.</td></tr>';
            } else {
                topMemBody.innerHTML = data.topMemoryProcesses.map((proc, idx) => `
                    <tr style="border-bottom:1px solid #e2e8f0;">
                        <td style="padding:0.55rem 0.75rem; font-weight:700; color:#64748b;">${idx + 1}</td>
                        <td style="padding:0.55rem 0.75rem; font-family:monospace; color:#334155;">${proc.pid}</td>
                        <td style="padding:0.55rem 0.75rem;">
                            <div style="font-weight:700; color:#0f172a;">${escapeHtml(proc.name || proc.command)}</div>
                            <div style="font-size:0.72rem; color:#64748b; font-family:monospace;" title="${escapeHtml(proc.fullCommand)}">${escapeHtml(proc.fullCommand)}</div>
                        </td>
                        <td style="padding:0.55rem 0.75rem; text-align:right; font-weight:700; color:#2563eb;">${proc.rss}</td>
                        <td style="padding:0.55rem 0.75rem; text-align:right; font-weight:700; color:#0f172a;">${proc.mem}</td>
                        <td style="padding:0.55rem 0.75rem; text-align:right; font-weight:600; color:#475569;">${proc.cpu}</td>
                    </tr>
                `).join('');
            }
        }
    } catch (err) {
        console.error('관리자 상태 로드 오류:', err);
    }
}

// 5. 10초 주기 실시간 자동 갱신 폴링
let overviewPollTimer = null;
function startOverviewPolling() {
    if (overviewPollTimer) clearInterval(overviewPollTimer);
    overviewPollTimer = setInterval(() => {
        const overviewPane = document.getElementById('tab-overview');
        if (overviewPane && overviewPane.classList.contains('active')) {
            loadOverviewData();
        }
    }, 10000);
}

// 6. PM2 프로세스 개별 제어 (시작, 중지, 재기동)
async function executePm2Action(action, procName) {
    const actionLabels = {
        'start': '시작',
        'stop': '중지',
        'restart': '재기동'
    };
    const label = actionLabels[action] || action;
    if (!confirm(`[${procName}] 프로세스를 ${label}하시겠습니까?`)) return;

    try {
        showToast(`[${procName}] ${label} 요청 중...`);
        const res = await fetch('/api/admin/pm2/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, processName: procName })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message);
            loadOverviewData();
            setTimeout(fetchPm2Logs, 1500);
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast(`명령 전송 실패: ${err.message}`, true);
    }
}

// 기존 restartPm2Process 호환 래퍼
function restartPm2Process(procName) {
    executePm2Action('restart', procName);
}
// 7. PM2 실시간 서버 콘솔 로그 조회 (최신 50줄) 및 실시간 필터
let rawPm2Logs = '';
let currentPm2FilterLevel = 'all';

function setPm2LogFilter(level) {
    currentPm2FilterLevel = level;
    ['btnFilterAll', 'btnFilterError', 'btnFilterWarn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isActive = (id === 'btnFilterAll' && level === 'all') ||
                         (id === 'btnFilterError' && level === 'error') ||
                         (id === 'btnFilterWarn' && level === 'warn');
        btn.style.background = isActive ? (level === 'error' ? '#ef4444' : level === 'warn' ? '#d97706' : '#2563eb') : 'transparent';
        btn.style.color = isActive ? '#fff' : (id === 'btnFilterError' ? '#ef4444' : id === 'btnFilterWarn' ? '#d97706' : '#64748b');
    });
    filterPm2ConsoleLogs();
}

let currentPm2LogOrder = 'bottom'; // 'bottom' (터미널 방식: 아래가 최신) | 'top' (최신순: 위가 최신)

function togglePm2LogOrder() {
    currentPm2LogOrder = currentPm2LogOrder === 'bottom' ? 'top' : 'bottom';
    const btn = document.getElementById('btnToggleLogOrder');
    if (btn) {
        btn.textContent = currentPm2LogOrder === 'bottom' ? '⬇️ 터미널순' : '⬆️ 최신순';
    }
    filterPm2ConsoleLogs();
}

function scrollPm2LogsToBottom() {
    const consoleEl = document.getElementById('pm2LogConsole');
    if (!consoleEl) return;
    if (currentPm2LogOrder === 'bottom') {
        requestAnimationFrame(() => {
            consoleEl.scrollTop = consoleEl.scrollHeight;
            setTimeout(() => {
                consoleEl.scrollTop = consoleEl.scrollHeight;
            }, 50);
        });
    }
}

function filterPm2ConsoleLogs() {
    const consoleEl = document.getElementById('pm2LogConsole');
    const searchInput = document.getElementById('pm2LogSearchInput');
    if (!consoleEl) return;
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!rawPm2Logs) {
        consoleEl.textContent = '현재 기록된 로그가 없습니다.';
        return;
    }
    const lines = rawPm2Logs.split('\n');
    const filtered = lines.filter(line => {
        const lower = line.toLowerCase();
        if (currentPm2FilterLevel === 'error') {
            const isError = lower.includes('error') || lower.includes('err') || 
                            lower.includes('failed') || lower.includes('fail') || 
                            lower.includes('exception') || lower.includes('alert') || 
                            line.includes('🚨') || line.includes('❌') || 
                            line.includes('오류') || line.includes('경보') || line.includes('실패');
            if (!isError) return false;
        }
        if (currentPm2FilterLevel === 'warn') {
            const isWarn = lower.includes('warn') || lower.includes('warning') || 
                           lower.includes('caution') || line.includes('⚠️') || 
                           line.includes('주의') || line.includes('경고');
            if (!isWarn) return false;
        }
        if (keyword && !lower.includes(keyword)) return false;
        return true;
    });

    if (currentPm2LogOrder === 'top') {
        filtered = filtered.reverse();
    }

    if (filtered.length === 0) {
        consoleEl.textContent = `[조건에 일치하는 로그 라인이 없습니다 (필터: ${currentPm2FilterLevel}, 검색어: '${keyword}')]`;
    } else {
        consoleEl.textContent = filtered.join('\n');
        if (currentPm2LogOrder === 'bottom') {
            scrollPm2LogsToBottom();
        } else {
            consoleEl.scrollTop = 0;
        }
    }
}

async function fetchPm2Logs() {
    const consoleEl = document.getElementById('pm2LogConsole');
    const selectEl = document.getElementById('pm2LogProcessSelect');
    const proc = selectEl ? selectEl.value : 'all';
    if (!consoleEl) return;

    try {
        const url = proc && proc !== 'all' 
            ? `/api/admin/pm2/logs?process=${encodeURIComponent(proc)}&lines=50`
            : `/api/admin/pm2/logs?lines=50`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
            rawPm2Logs = stripAnsi(data.logs) || '현재 기록된 로그가 없습니다.';
            filterPm2ConsoleLogs();
        } else {
            consoleEl.textContent = '로그 로딩 실패: ' + (data.logs || '오류 발생');
        }
    } catch (err) {
        consoleEl.textContent = '로그 통신 오류: ' + err.message;
    }
}

// 8. PM2 로그 비우기 (flush)
async function clearPm2Logs() {
    const selectEl = document.getElementById('pm2LogProcessSelect');
    const proc = selectEl ? selectEl.value : 'all';
    const targetName = proc === 'all' ? '전체 PM2' : proc;
    if (!confirm(`[${targetName}] 로그 파일을 비우시겠습니까?`)) return;

    try {
        showToast(`[${targetName}] 로그 비우는 중...`);
        const res = await fetch('/api/admin/pm2/flush', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processName: proc === 'all' ? '' : proc })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message);
            fetchPm2Logs();
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast('로그 비우기 실패: ' + err.message, true);
    }
}

// 8-1. 서버 장애 텔레그램 알림 연동 테스트 발송
async function testTelegramAlert() {
    if (!confirm('서버 장애 경보 텔레그램 봇으로 테스트 메시지를 발송하시겠습니까?')) return;
    try {
        showToast('텔레그램 테스트 메시지 전송 중...');
        const res = await fetch('/api/admin/system/test-telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ ' + data.message);
        } else {
            showToast('❌ ' + data.message, true);
        }
    } catch (err) {
        showToast('텔레그램 테스트 실패: ' + err.message, true);
    }
}

// 9. 전체 DB 일괄 ZIP 다운로드
async function downloadAllDatabases() {
    showToast('전체 DB 백업 파일을 압축 생성 중입니다. 잠시만 기다려주세요...');
    try {
        const res = await fetch('/api/admin/backup/all');
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const nowStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        a.download = `jg_all_databases_${nowStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('✅ 전체 DB 백업 압축 파일(.zip) 다운로드가 완료되었습니다!');
    } catch (err) {
        console.error('[일괄 백업 다운로드 실패]', err);
        showToast('❌ 전체 DB 백업 실패: ' + err.message, true);
    }
}

// 전역 window 바인딩
window.loadOverviewData = loadOverviewData;
window.startOverviewPolling = startOverviewPolling;
window.executePm2Action = executePm2Action;
window.restartPm2Process = restartPm2Process;
window.fetchPm2Logs = fetchPm2Logs;
window.clearPm2Logs = clearPm2Logs;
window.setPm2LogFilter = setPm2LogFilter;
window.filterPm2ConsoleLogs = filterPm2ConsoleLogs;
window.togglePm2LogOrder = togglePm2LogOrder;
window.scrollPm2LogsToBottom = scrollPm2LogsToBottom;
window.downloadAllDatabases = downloadAllDatabases;
window.testTelegramAlert = testTelegramAlert;
