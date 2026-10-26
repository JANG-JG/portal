/**
 * JG Portal 통합 관리자 센터 - 보조 서버(HP 노트북) 관제 및 핫 백업 모듈
 * admin-secondary.js
 */

// 1. 🌟 보조 서버 UI 및 실시간 리소스 상태바 게이지 통합 갱신
function updateSecondaryServerUI(s) {
    if (!s) return;
    const badgeEl = document.getElementById('secondaryServerBadge');
    const paneBadge = document.getElementById('secPaneServerBadge');
    const latEl = document.getElementById('secondaryServerLatency');
    const cardBadge = document.getElementById('secBadgeCard');
    const tabBadge = document.getElementById('secondaryTabBadge');
    const upEl = document.getElementById('secServerUptime');
    const upSummaryEl = document.getElementById('secServerUptimeSummary');
    const sourceEl = document.getElementById('secResourceSource');
    const secProcCount = document.getElementById('secActiveProcessCount');
    const secProcSummaryEl = document.getElementById('secActiveProcessCountSummary');
    const secProcStatus = document.getElementById('secActiveProcessStatus');

    // 1. 온라인 / 오프라인 상태 뱃지
    if (badgeEl) {
        badgeEl.className = s.online ? 'badge-online' : 'badge-stopped';
        badgeEl.textContent = s.online ? `🟢 ${s.latency || '연결됨'}` : '🔴 대기 중';
    }
    if (paneBadge) {
        paneBadge.className = s.online ? 'badge-online' : 'badge-stopped';
        paneBadge.textContent = s.online ? (s.sshConnected ? '🟢 온라인 (SSH 실시간 연동)' : '🟢 온라인 (소켓 헬스 정상)') : '🔴 오프라인 (대기)';
    }
    if (cardBadge) {
        cardBadge.className = s.online ? 'badge-online' : 'badge-stopped';
        cardBadge.textContent = s.online ? `SSH 22 (${s.sshConnected ? '실시간 연동' : '열림'})` : 'SSH 22 대기';
    }
    if (latEl) {
        latEl.textContent = s.online ? (s.latency || '정상') : '오프라인';
    }
    if (tabBadge) {
        tabBadge.textContent = s.online ? `🟢 ${s.latency || '온라인'}` : '🔴 오프라인';
        tabBadge.style.color = s.online ? '#7c3aed' : '#dc2626';
        tabBadge.style.background = s.online ? '#f3e8ff' : '#fee2e2';
        tabBadge.style.borderColor = s.online ? '#ddd6fe' : '#fecaca';
    }
    if (upEl) {
        upEl.textContent = s.uptimeStr || (s.online ? '정상 가동 중' : '오프라인 (대기)');
    }
    if (upSummaryEl) {
        upSummaryEl.textContent = s.uptimeStr || (s.online ? '정상 가동 중' : '대기 중');
    }
    if (sourceEl) {
        sourceEl.textContent = s.sshConnected ? 'SSH 실시간 OS' : (s.online ? '소켓 헬스 연동' : '오프라인 대기');
    }

    // 1-1. 실행 중인 서비스 수치
    const procList = s.processes || [];
    const onlineProcs = procList.filter(p => p.status === 'online').length;
    if (secProcCount) {
        secProcCount.textContent = s.online ? `${onlineProcs} / ${procList.length}` : `0 / ${procList.length || 3} (대기)`;
    }
    if (secProcSummaryEl) {
        secProcSummaryEl.textContent = s.online ? `${onlineProcs} / ${procList.length || 3}` : `0 / ${procList.length || 3}`;
    }
    if (secProcStatus) {
        secProcStatus.textContent = s.online ? '백업 및 원격 데몬 가동 중' : '보조 서버 오프라인 대기 중';
        secProcStatus.style.color = s.online ? '#10b981' : '#64748b';
    }

    // 2. ⚡ 보조 서버 CPU 게이지 & 하드웨어 온도
    if (s.cpu) {
        const secCpuVal = document.getElementById('gaugeSecCpuVal');
        const secCpuBar = document.getElementById('gaugeSecCpuBar');
        const secCpuTemp = document.getElementById('gaugeSecCpuTemp');
        const cpuPct = s.cpu.percentNum !== undefined ? s.cpu.percentNum : (parseFloat(s.cpu.percent) || 0);
        if (secCpuVal) secCpuVal.textContent = s.cpu.percent || `${cpuPct}%`;
        if (secCpuBar) {
            secCpuBar.style.width = Math.min(100, Math.max(0, cpuPct)) + '%';
            secCpuBar.classList.toggle('warn', cpuPct >= 80);
        }
        const secPaneTemp = document.getElementById('secPaneCpuTemp');
        const tVal = s.cpu.temp || (s.online ? '측정 대기' : '대기 중');
        const tStatus = s.cpu.tempStatus || 'normal';
        const formattedTemp = tVal.includes('°C') ? `🌡️ ${tVal}` : `🌡️ ${tVal}`;
        if (secCpuTemp) {
            secCpuTemp.textContent = formattedTemp;
            secCpuTemp.className = 'temp-badge temp-badge-' + tStatus;
        }
        if (secPaneTemp) {
            secPaneTemp.textContent = formattedTemp;
            secPaneTemp.className = 'temp-badge temp-badge-' + tStatus;
        }
    }

    // 3. 💾 보조 서버 RAM 게이지 & 상단 듀얼 요약 카드 갱신
    if (s.memory) {
        const memPct = s.memory.percentNum !== undefined ? s.memory.percentNum : (parseFloat(s.memory.percent) || 0);
        const memUsed = s.memory.used || '-';
        const memTotal = s.memory.total || '-';
        const dualMemSVal = document.getElementById('dualMemSecVal');
        const dualMemSBar = document.getElementById('dualMemSecBar');
        if (dualMemSVal) {
            dualMemSVal.textContent = s.online ? `${memUsed} / ${memTotal} (${memPct}%)` : '오프라인 대기';
            dualMemSVal.style.color = s.online ? '#0f172a' : '#64748b';
        }
        if (dualMemSBar) dualMemSBar.style.width = s.online ? Math.min(100, Math.max(0, memPct)) + '%' : '0%';
    }

    // 4. 𒒽 보조 서버 Disk 게이지 & 상단 듀얼 요약 카드 갱신 (500GB HDD)
    if (s.disk) {
        const diskPct = s.disk.percentNum !== undefined ? s.disk.percentNum : (parseFloat(s.disk.percent) || 0);
        const diskUsed = s.disk.used || '-';
        const diskTotal = s.disk.total || '-';
        const dualDiskSVal = document.getElementById('dualDiskSecVal');
        const dualDiskSBar = document.getElementById('dualDiskSecBar');
        if (dualDiskSVal) {
            dualDiskSVal.textContent = `${diskUsed} / ${diskTotal} (${diskPct}%)`;
        }
        if (dualDiskSBar) dualDiskSBar.style.width = Math.min(100, Math.max(0, diskPct)) + '%';
    }

    // 4-1. 📸 보조 서버 외장 SSD 게이지 갱신 (가족 사진 원본 보관소)
    if (s.externalSsd) {
        const ssdVal = document.getElementById('dualExternalSsdVal');
        const ssdBar = document.getElementById('dualExternalSsdBar');
        const ssd = s.externalSsd;
        const ssdPct = ssd.percentNum !== undefined ? ssd.percentNum : (parseFloat(ssd.percent) || 0);
        if (ssdVal) {
            if (s.online && ssd.mounted) {
                ssdVal.textContent = `${ssd.used} / ${ssd.total} (${ssd.percent})`;
                ssdVal.style.color = '#0284c7';
            } else if (s.online) {
                ssdVal.textContent = '마운트 대기 (/media/external_ssd)';
                ssdVal.style.color = '#eab308';
            } else {
                ssdVal.textContent = `${ssd.used || '14.2 GB'} / ${ssd.total || '931.5 GB'} (오프라인)`;
                ssdVal.style.color = '#64748b';
            }
        }
        if (ssdBar) {
            ssdBar.style.width = Math.min(100, Math.max(0, ssdPct)) + '%';
        }
    }

    // 5. 전체 서비스 프로세스 (백업 데몬 목록 카드 렌더링)
    const procContainer = document.getElementById('secProcessListContainer');
    if (procContainer && procList.length > 0) {
        procContainer.innerHTML = procList.map(p => {
            const isOnline = p.status === 'online';
            const badgeClass = isOnline ? 'badge-online' : 'badge-stopped';
            const badgeText = isOnline ? '정상 가동' : '대기 (스탠바이)';
            return `
                <div class="process-item-card" id="sec-proc-card-${p.name}">
                    <div class="process-info">
                        <h4>
                            ${p.displayName || p.name}
                            <span class="${badgeClass}">${badgeText}</span>
                        </h4>
                        <div class="process-meta">
                            <span>포트/데몬: <strong>${p.port || '-'}</strong></span>
                            <span>메모리: <strong>${p.memory || '-'}</strong></span>
                            <span>CPU: <strong>${p.cpu || '-'}</strong></span>
                            <span style="color:#64748b;">${p.desc || ''}</span>
                        </div>
                    </div>
                    <div class="process-actions">
                        <span class="badge-online" style="background:#f8fafc; color:#475569; border:1px solid #cbd5e1; font-size:0.75rem;">
                            ${isOnline ? '🟢 동기화 준비 완료' : '⚪ 스탠바이 대기'}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 6. RAM(메모리) 상위 점유 프로세스 (TOP 10) 테이블 갱신
    const secTopMemBody = document.getElementById('secTopMemProcessTableBody');
    if (secTopMemBody) {
        const topProcs = s.topMemoryProcesses || [];
        const escape = (typeof escapeHtml === 'function') ? escapeHtml : (str => str || '');
        if (topProcs.length === 0) {
            secTopMemBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">${s.online ? '수집된 프로세스 정보가 없습니다.' : '보조 서버가 오프라인 상태입니다. (전원 연결 시 SSH 자동 연결 및 실시간 프로세스 수집)'}</td></tr>`;
        } else {
            secTopMemBody.innerHTML = topProcs.map((proc, idx) => `
                <tr style="border-bottom:1px solid #e2e8f0;">
                    <td style="padding:0.55rem 0.75rem; font-weight:700; color:#64748b;">${idx + 1}</td>
                    <td style="padding:0.55rem 0.75rem; font-family:monospace; color:#334155;">${proc.pid}</td>
                    <td style="padding:0.55rem 0.75rem;">
                        <div style="font-weight:700; color:#0f172a;">${escape(proc.name || proc.command)}</div>
                        <div style="font-size:0.72rem; color:#64748b; font-family:monospace;" title="${escape(proc.fullCommand)}">${escape(proc.fullCommand)}</div>
                    </td>
                    <td style="padding:0.55rem 0.75rem; text-align:right; font-weight:700; color:#7c3aed;">${proc.rss}</td>
                    <td style="padding:0.55rem 0.75rem; text-align:right; font-weight:700; color:#0f172a;">${proc.mem}</td>
                    <td style="padding:0.55rem 0.75rem; text-align:right; font-weight:600; color:#475569;">${proc.cpu}</td>
                </tr>
            `).join('');
        }
    }

    // 7. 실시간 보조 서버 시스템 및 백업 로그 콘솔 (최근 50줄)
    if (s.logs !== undefined) {
        updateSecLogsDisplay(s.logs);
    }

    // 8. DB 백업본 보존 상태 업데이트
    if (s.dbs) {
        const elPortal = document.getElementById('secDbPortal');
        const elHealth = document.getElementById('secDbHealth');
        const elAsset = document.getElementById('secDbAsset');
        const elBriefing = document.getElementById('secDbBriefing');
        const elAlbum = document.getElementById('secDbAlbum');
        if (elPortal && s.dbs.portal) {
            elPortal.innerHTML = `<span class="badge-online" style="font-size:0.75rem;">${s.dbs.portal}</span>`;
        }
        if (elHealth && s.dbs.health) {
            elHealth.innerHTML = `<span class="badge-online" style="font-size:0.75rem;">${s.dbs.health}</span>`;
        }
        if (elAsset && s.dbs.asset) {
            elAsset.innerHTML = `<span class="badge-online" style="font-size:0.75rem;">${s.dbs.asset}</span>`;
        }
        if (elBriefing && s.dbs.briefing) {
            elBriefing.innerHTML = `<span class="badge-online" style="font-size:0.75rem;">${s.dbs.briefing}</span>`;
        }
        if (elAlbum && s.dbs.album) {
            elAlbum.innerHTML = `<span class="badge-online" style="font-size:0.75rem;">${s.dbs.album}</span>`;
        }
    }

    // 9. 공개키 복사 명령어 업데이트
    if (s.publicKey) {
        const cmdEl = document.getElementById('secSshRegisterCmd');
        if (cmdEl) {
            cmdEl.textContent = `mkdir -p ~/.ssh && echo "${s.publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
        }
    }
}

// 2. 🌟 주 서버 / 보조 서버 탭 전환 제어
function switchServerTab(serverType) {
    const isPrimary = serverType === 'primary';
    const btnPrimary = document.getElementById('serverTabBtnPrimary');
    const btnSecondary = document.getElementById('serverTabBtnSecondary');
    const panePrimary = document.getElementById('serverPanePrimary');
    const paneSecondary = document.getElementById('serverPaneSecondary');

    if (btnPrimary) btnPrimary.classList.toggle('active', isPrimary);
    if (btnSecondary) btnSecondary.classList.toggle('active', !isPrimary);
    if (panePrimary) panePrimary.classList.toggle('active', isPrimary);
    if (paneSecondary) paneSecondary.classList.toggle('active', !isPrimary);

    try {
        localStorage.setItem('admin_selected_server_tab', serverType);
    } catch (e) {}
}

// 3. 🌟 보조 서버(HP 노트북) 즉시 핑 테스트 실행
async function pingSecondaryServer() {
    const btn = document.getElementById('btnSecPing');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ 핑 측정 중...';
    }

    try {
        if (typeof showToast === 'function') showToast('💻 보조 서버(192.168.50.75:22) 핑 테스트 중...');
        const res = await fetch('/api/admin/secondary/ping');
        const data = await res.json();
        if (data.success && data.secondary) {
            updateSecondaryServerUI(data.secondary);
            if (typeof showToast === 'function') {
                showToast(data.secondary.online ? `✅ 보조 서버 연결 정상 (응답: ${data.secondary.latency})` : '⚠️ 보조 서버가 오프라인 상태입니다.', !data.secondary.online);
            }
        } else {
            if (typeof showToast === 'function') showToast('보조 서버 핑 응답 실패', true);
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('보조 서버 핑 오류: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔄 지금 핑 테스트';
        }
    }
}

// 4. 🌟 보조 서버(HP 노트북) 즉시 핫 백업 전송 수동 트리거
async function triggerSecondaryBackupNow() {
    const btn = document.getElementById('btnSecBackupNow');
    if (!confirm('지금 즉시 주 서버(노트 9)의 3대 SQLite DB 핫 스냅샷을 생성하여 보조 서버(HP 노트북)로 rsync 백업 전송하시겠습니까?')) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> 백업 생성 & rsync 전송 중...';
        btn.style.opacity = '0.7';
    }

    try {
        if (typeof showToast === 'function') showToast('📦 보조 서버로의 핫 백업 전송 파이프라인을 실행합니다...');
        const res = await fetch('/api/admin/secondary/backup-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            if (typeof showToast === 'function') showToast(data.message);
            if (typeof loadOverviewData === 'function') loadOverviewData();
        } else {
            if (typeof showToast === 'function') showToast(data.message || '백업 실행 실패', true);
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('백업 요청 오류: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>📦</span> 지금 수동 백업 전송';
            btn.style.opacity = '1';
        }
    }
}

// 5. 🌟 보조 서버 콘솔 로그 필터링
let rawSecLogs = '';
function updateSecLogsDisplay(logs) {
    if (logs !== undefined) rawSecLogs = logs;
    filterSecConsoleLogs();
}

function filterSecConsoleLogs() {
    const consoleEl = document.getElementById('secLogConsole');
    const searchInput = document.getElementById('secLogSearchInput');
    if (!consoleEl) return;
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!rawSecLogs) {
        consoleEl.textContent = '기록된 보조 서버 로그가 없습니다.';
        return;
    }
    const lines = rawSecLogs.split('\n');
    const filtered = keyword ? lines.filter(l => l.toLowerCase().includes(keyword)) : lines;
    if (filtered.length === 0) {
        consoleEl.textContent = `[검색어 '${keyword}'에 일치하는 로그 라인이 없습니다]`;
    } else {
        consoleEl.textContent = filtered.join('\n');
    }
}

// 전역 window 바인딩
window.updateSecondaryServerUI = updateSecondaryServerUI;
window.switchServerTab = switchServerTab;
window.pingSecondaryServer = pingSecondaryServer;
window.triggerSecondaryBackupNow = triggerSecondaryBackupNow;
window.updateSecLogsDisplay = updateSecLogsDisplay;
window.filterSecConsoleLogs = filterSecConsoleLogs;
