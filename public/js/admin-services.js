/**
 * JG Portal 통합 관리자 센터 - 서브 서비스(혈압/자산/뉴스/보안) 제어 모듈
 * admin-services.js (v20261017_v2)
 */
const ADMIN_SERVICES_VERSION = '20261017_v2';


// ========================================================
// 1. 혈압 관리 서비스 제어
// ========================================================

// 1-1. 혈압 관리 데이터 로드
async function loadBloodData() {
    try {
        const res = await fetch('/api/admin/blood/recent');
        const data = await res.json();
        if (!data.success) return;

        const tbody = document.getElementById('bloodRecentTableBody');
        if (!tbody) return;
        if (!data.records || data.records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#64748b;">측정 기록이 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = data.records.map(r => `
            <tr>
                <td><strong>${(r.measured_at || '').replace('T', ' ')}</strong></td>
                <td style="color:${r.systolic >= 135 ? '#ef4444' : '#1e293b'}; font-weight:700;">${r.systolic}</td>
                <td style="color:${r.diastolic >= 85 ? '#ef4444' : '#1e293b'}; font-weight:700;">${r.diastolic}</td>
                <td>${r.pulse}</td>
                <td>${r.medication_time ? `<span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.8rem;">${r.medication_time.replace('T', ' ')}</span>` : '<span style="color:#94a3b8;">-</span>'}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('혈압 데이터 로드 실패:', err);
    }
}

// 1-2. 혈압 SMTP 메일 테스트
async function testBloodSmtpEmail() {
    const btn = document.getElementById('btnTestEmail');
    const resultDiv = document.getElementById('emailTestResult');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '메일 발송 중...';
    }
    if (resultDiv) {
        resultDiv.innerHTML = '<span style="color:#64748b;">구글 SMTP 서버로 테스트 발송 중...</span>';
    }

    try {
        const res = await fetch('/api/admin/blood/test-email', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:#059669; font-weight:600;">✅ ${data.message}</span>`;
            if (typeof window.showToast === 'function') window.showToast('테스트 메일이 성공적으로 전송되었습니다!');
        } else {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:#dc2626; font-weight:600;">❌ ${data.message}</span>`;
        }
    } catch (err) {
        if (resultDiv) resultDiv.innerHTML = `<span style="color:#dc2626;">❌ 요청 오류: ${err.message}</span>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📨 메일 전송 테스트 실행';
        }
    }
}

// 1-3. 혈압 CSV 데이터 복구
async function importBloodCsv() {
    const csvInput = document.getElementById('importCsvText');
    if (!csvInput) return;
    const csvData = csvInput.value.trim();
    if (!csvData) return alert('붙여넣을 CSV 데이터를 입력해주세요.');
    if (!confirm('기존 데이터와 대조하여 복구를 진행하시겠습니까?')) return;

    try {
        const res = await fetch('/api/admin/blood/import-csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvData })
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast(`성공적으로 복구되었습니다! (추가된 건수: ${data.count}건)`);
            csvInput.value = '';
            loadBloodData();
        } else {
            if (typeof window.showToast === 'function') window.showToast(data.message, true);
        }
    } catch (err) {
        if (typeof window.showToast === 'function') window.showToast('복구 오류: ' + err.message, true);
    }
}

// 1-4. 혈압 대시보드 환경설정 로드
async function fetchBloodConfigs() {
    try {
        const res = await fetch('/api/admin/blood/configs');
        const data = await res.json();
        if (data.success && data.configs) {
            const c = data.configs;
            const highSys = document.getElementById('cfgHighSys');
            const highDia = document.getElementById('cfgHighDia');
            const lowSys = document.getElementById('cfgLowSys');
            const lowDia = document.getElementById('cfgLowDia');

            if (highSys) highSys.value = c.high_systolic || '135';
            if (highDia) highDia.value = c.high_diastolic || '85';
            if (lowSys) lowSys.value = c.low_systolic || '90';
            if (lowDia) lowDia.value = c.low_diastolic || '60';
        }
    } catch (err) {
        console.error('혈압 환경설정 로드 오류:', err);
    }
}

// 1-5. 혈압 대시보드 환경설정 저장
async function saveBloodConfigs(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btnSaveBloodConfig');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 저장 중...';
    }

    const payload = {
        high_systolic: document.getElementById('cfgHighSys') ? document.getElementById('cfgHighSys').value : '135',
        high_diastolic: document.getElementById('cfgHighDia') ? document.getElementById('cfgHighDia').value : '85',
        low_systolic: document.getElementById('cfgLowSys') ? document.getElementById('cfgLowSys').value : '90',
        low_diastolic: document.getElementById('cfgLowDia') ? document.getElementById('cfgLowDia').value : '60'
    };

    try {
        const res = await fetch('/api/admin/blood/configs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast(data.message || '대시보드 환경설정이 성공적으로 저장되었습니다!');
        } else {
            if (typeof window.showToast === 'function') window.showToast(data.message || '저장 실패', true);
        }
    } catch (err) {
        if (typeof window.showToast === 'function') window.showToast('설정 저장 오류: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

// ========================================================
// 2. 자산 관리 서비스 제어
// ========================================================

async function loadAssetData() {
    try {
        const res = await fetch('/api/admin/asset/summary');
        const data = await res.json();
        if (!data.success) return;

        const totalEl = document.getElementById('assetAdminTotalKrw');
        const countEl = document.getElementById('assetAdminAccountCount');
        if (totalEl) totalEl.textContent = data.totalKrw;
        if (countEl) countEl.textContent = `${data.accounts.length}개`;

        // 계좌 목록
        const accTbody = document.getElementById('assetAccountsTableBody');
        if (accTbody) {
            accTbody.innerHTML = data.accounts.map(a => `
                <tr>
                    <td><strong>${escapeHtml(a.account_name)}</strong></td>
                    <td>${escapeHtml(a.broker || '-')}</td>
                    <td>${a.stockCount}개</td>
                    <td style="font-weight:700; color:#0f172a;">${a.totalFormatted}</td>
                </tr>
            `).join('');
        }

        // 종목 목록
        const stockTbody = document.getElementById('assetStocksTableBody');
        if (stockTbody) {
            stockTbody.innerHTML = data.assets.map(s => `
                <tr>
                    <td><strong style="color:#1e293b;">${escapeHtml(s.koreanName)}</strong></td>
                    <td><span style="font-size:0.8rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${escapeHtml(s.symbol)}</span></td>
                    <td>${escapeHtml(s.asset_type || 'Stock')}</td>
                    <td>${s.quantity}</td>
                    <td>${s.formattedAvg}</td>
                    <td style="font-weight:700; color:#059669;">${s.formattedTotal}</td>
                </tr>
            `).join('');
        }
    } catch (err) {
        console.error('자산 데이터 로드 오류:', err);
    }
}

// ========================================================
// 3. 뉴스 브리핑 서비스 제어
// ========================================================

async function loadNewsData() {
    try {
        const res = await fetch('/api/admin/news/stats');
        const data = await res.json();
        if (!data.success) return;

        const totalCount = document.getElementById('newsTotalCount');
        const logsTotalCount = document.getElementById('newsLogsTotalCount');
        const dbSize = document.getElementById('newsDbSize');
        const statusBadge = document.getElementById('newsStatusBadge');
        if (totalCount) totalCount.textContent = `${(data.totalArticles || 0).toLocaleString()}건`;
        if (logsTotalCount) logsTotalCount.textContent = `${(data.totalLogs || 0).toLocaleString()}회`;
        if (dbSize) dbSize.textContent = `${(data.dbSizeKb || 0).toLocaleString()} KB`;
        if (statusBadge) {
            statusBadge.innerHTML = data.collectionEnabled
                ? '<span class="badge badge-success">정상 가동</span>'
                : '<span class="badge badge-warning" style="background:#fef3c7; color:#92400e;">일시 정지</span>';
        }

        if (data.weather) {
            const wIcon = document.getElementById('newsWeatherIcon');
            const wCity = document.getElementById('newsWeatherCity');
            const wToday = document.getElementById('newsTodayWeather');
            if (wIcon && data.weather.icon) wIcon.textContent = data.weather.icon;
            if (wCity && data.weather.city) wCity.textContent = data.weather.city;
            if (wToday) wToday.textContent = `${data.weather.temp} (${data.weather.condition})`;
        } else {
            const wToday = document.getElementById('newsTodayWeather');
            if (wToday) wToday.textContent = '조회 중';
        }

        const tbody = document.getElementById('newsArticlesTableBody');
        if (tbody) {
            tbody.innerHTML = (data.recentArticles || []).map(a => {
                const rawLink = (a.link || '').trim();
                const isSafeUrl = /^https?:\/\//i.test(rawLink);
                const safeLink = isSafeUrl ? encodeURI(rawLink) : '#';
                return `
                <tr>
                    <td><span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700;">${escapeHtml(a.category_name)}</span></td>
                    <td style="font-weight:600; color:#475569;">${escapeHtml(a.media_name)}</td>
                    <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(a.title)}">
                        ${escapeHtml(a.title)}
                    </td>
                    <td style="font-size:0.8rem; color:#64748b;">${(a.published_at || '').substring(0, 16)}</td>
                    <td><a href="${safeLink}" ${isSafeUrl ? 'target="_blank" rel="noopener noreferrer"' : ''} class="btn-admin btn-admin-outline btn-admin-sm">원문 ↗</a></td>
                </tr>
            `;
            }).join('');
        }

        if (data.telegramBriefingTimes) {
            currentAdminBriefingTimes = Array.isArray(data.telegramBriefingTimes) ? data.telegramBriefingTimes : ['07:30'];
            renderAdminBriefingChips();
        }

        if (data.excludeKeywords) {
            currentAdminExcludeKeywords = Array.isArray(data.excludeKeywords) ? data.excludeKeywords : [];
            renderAdminExcludeChips();
        }
    } catch (err) {
        console.error('뉴스 데이터 로드 오류:', err);
    }
}

// 3-2. 뉴스 수집 및 발송 이력 로드 (최근 50회)
async function loadNewsLogs() {
    const tbody = document.getElementById('newsLogsTableBody');
    if (!tbody) return;
    try {
        const res = await fetch('/api/admin/logs/news');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        if (!data.logs || data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">기록된 수집 이력이 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = data.logs.map(log => {
            const isSuccess = (log.status || '').includes('SUCCESS');
            const badge = isSuccess 
                ? `<span class="badge-success">${escapeHtml(log.status)}</span>` 
                : `<span class="badge-failed">${escapeHtml(log.status || 'FAILED')}</span>`;
            const teleBadge = log.telegram_sent 
                ? '<span class="badge-success">발송 완료</span>' 
                : '<span class="badge-neutral">미발송</span>';

            return `
                <tr>
                    <td><small>${log.run_at || '-'}</small></td>
                    <td>${badge}</td>
                    <td style="text-align:center;"><strong>${log.total_collected || 0}</strong>건 / <strong>${log.saved_count || 0}</strong>건</td>
                    <td style="text-align:center;">${teleBadge}</td>
                    <td><span style="font-size:0.8rem; color:#475569;">${log.weather_info ? escapeHtml(log.weather_info.slice(0, 30)) + '...' : '-'}</span></td>
                    <td><span style="font-size:0.8rem; color:#334155;">${escapeHtml(log.details || '-')}</span></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#dc2626;">수집 로그 조회 실패: ${escapeHtml(err.message)}</td></tr>`;
    }
}

// 3-3. 뉴스 수집기 및 스케줄러 실시간 파일 로그 조회
async function fetchNewsFileLogs() {
    const consoleEl = document.getElementById('newsLogConsole');
    const selectEl = document.getElementById('newsLogTypeSelect');
    const titleEl = document.getElementById('newsTerminalTitle');
    if (!consoleEl || !selectEl) return;

    const logType = selectEl.value || 'collector';
    const logFileName = logType === 'scheduler' ? 'scheduler.log' : 'collector.log';
    if (titleEl) {
        titleEl.textContent = `tail -n 120 news-dashboard/logs/${logFileName}`;
    }

    consoleEl.textContent = `[${new Date().toLocaleTimeString()}] ${logFileName} 최신 로그를 불러오는 중입니다...`;

    try {
        const res = await fetch(`/api/admin/news/file-logs?type=${logType}&lines=120`);
        const data = await res.json();
        if (data.success) {
            consoleEl.textContent = data.logs || '(로그 파일이 비어 있습니다.)';
            consoleEl.scrollTop = consoleEl.scrollHeight;
        } else {
            consoleEl.textContent = '로그 로딩 실패: ' + (data.message || '오류 발생');
        }
    } catch (err) {
        consoleEl.textContent = '로그 통신 오류: ' + err.message;
    }
}

// 3-4. 뉴스 즉시 수집 트리거
async function triggerNewsCollection(mode) {
    const promptMsg = mode === 'briefing'
        ? '뉴스 기사 수집 및 AI 요약 텔레그램 모닝 브리핑 발송을 즉시 실행하시겠습니까?'
        : '텔레그램 발송 없이 최신 뉴스 기사만 DB로 수집하시겠습니까?';
    if (!confirm(promptMsg)) return;

    try {
        const res = await fetch('/api/admin/news/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast(data.message);
            setTimeout(() => {
                loadNewsData();
                loadNewsLogs();
                fetchNewsFileLogs();
            }, 4000);
        } else {
            if (typeof window.showToast === 'function') window.showToast(data.message, true);
        }
    } catch (err) {
        if (typeof window.showToast === 'function') window.showToast('트리거 요청 실패: ' + err.message, true);
    }
}

// ========================================================
// 4. 보안 및 감사 로그 서비스 제어
// ========================================================

async function loadSecurityLogs() {
    const tbody = document.getElementById('securityLogsTableBody');
    const timeline = document.getElementById('securityTimelineFeed');
    if (!tbody && !timeline) return;

    try {
        const res = await fetch('/api/admin/logs/login');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        const logs = data.logs || [];

        // ⏱️ 1. Tabler 스타일 보안 감사 타임라인 피드 렌더링 (최근 15건)
        if (timeline) {
            if (logs.length === 0) {
                timeline.innerHTML = '<div style="text-align:center; padding:1.2rem; color:#64748b;">기록된 보안 감사 로그가 없습니다.</div>';
            } else {
                timeline.innerHTML = logs.slice(0, 15).map(log => {
                    const isRegister = log.status === 'REGISTER_SUCCESS';
                    const isSuccess = String(log.status).startsWith('SUCCESS') || isRegister;
                    const badgeClass = isSuccess ? 'badge-success' : 'badge-failed';
                    let statusText = '인증 실패';
                    if (isRegister) statusText = '가족 회원가입';
                    else if (log.status === 'SUCCESS_FAMILY_PIN') statusText = '가족 PIN 입장';
                    else if (log.status === 'SUCCESS_PASSWORD') statusText = '비밀번호 로그인';
                    else if (log.status === 'SUCCESS_ADMIN_SESSION') statusText = '관리자 세션';
                    else if (isSuccess) statusText = '정상 로그인';
                    else if (log.status === 'LOCKED_PIN_LIMIT') statusText = '5회 오류 잠금';
                    else if (log.status === 'FAIL_PIN_MISMATCH') statusText = 'PIN 불일치';
                    else if (log.status === 'FAIL_PASSWORD_MISMATCH') statusText = '비밀번호 불일치';

                    const icon = isRegister ? '🎉' : (isSuccess ? '🛡️' : '🚨');
                    const memoText = log.admin_memo ? `[${escapeHtml(log.admin_memo)}] ` : '';
                    const userLabel = log.nickname 
                        ? `${memoText}${escapeHtml(log.nickname)} (${escapeHtml(log.username)})` 
                        : (log.admin_memo ? `${escapeHtml(log.admin_memo)} (${escapeHtml(log.username || 'unknown')})` : escapeHtml(log.username || 'unknown'));
                    return `
                        <div class="admin-timeline-item">
                            <div class="admin-timeline-badge ${badgeClass}"></div>
                            <div class="admin-timeline-content">
                                <div class="admin-timeline-header">
                                    <span class="admin-timeline-title">
                                        <span>${icon}</span>
                                        <strong>${userLabel}</strong>
                                        <span class="${isSuccess ? 'badge-online' : 'badge-stopped'}" style="font-size:0.7rem; padding:1px 6px;">${statusText}</span>
                                    </span>
                                    <span class="admin-timeline-time">${log.attempted_at || '-'}</span>
                                </div>
                                <div class="admin-timeline-desc">
                                    접속 IP: <code style="font-size:0.78rem; background:#e2e8f0; padding:1px 5px; border-radius:3px; color:#0f172a;">${escapeHtml(log.ip || '-')}</code>
                                    ${!isSuccess ? '<span style="color:#ef4444; margin-left:6px; font-weight:600;">(인증 거부됨)</span>' : (isRegister ? '<span style="color:#10b981; margin-left:6px;">(가입 완료)</span>' : '<span style="color:#10b981; margin-left:6px;">(세션 발급 완료)</span>')}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 📋 2. 상세 로그인 이력 테이블 렌더링
        if (tbody) {
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:#64748b;">기록된 로그인 이력이 없습니다.</td></tr>';
                return;
            }

            tbody.innerHTML = logs.map(log => {
                const isRegister = log.status === 'REGISTER_SUCCESS';
                const isSuccess = String(log.status).startsWith('SUCCESS') || isRegister;
                const badge = isRegister
                    ? `<span style="display:inline-block; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:9999px; background:#dcfce7; color:#15803d;">가입완료</span>`
                    : (isSuccess 
                        ? `<span class="badge-success">${log.status === 'SUCCESS_FAMILY_PIN' ? '가족 PIN' : '성공'}</span>` 
                        : `<span class="badge-failed">${log.status === 'LOCKED_PIN_LIMIT' ? '잠금' : '실패'}</span>`);
                const memoText = log.admin_memo ? `<span style="font-weight:700; color:#1e293b;">[${escapeHtml(log.admin_memo)}]</span> ` : '';
                const userLabel = log.nickname 
                    ? `${memoText}${escapeHtml(log.nickname)} <small style="color:#64748b;">(${escapeHtml(log.username)})</small>` 
                    : `${memoText}<strong>${escapeHtml(log.username || '-')}</strong>`;
                return `
                    <tr>
                        <td><small>${log.attempted_at || '-'}</small></td>
                        <td>${userLabel}</td>
                        <td><code>${escapeHtml(log.ip || '-')}</code></td>
                        <td>${badge}</td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        if (timeline) {
            timeline.innerHTML = `<div style="text-align:center; padding:1.2rem; color:#dc2626;">타임라인 로드 실패: ${escapeHtml(err.message)}</div>`;
        }
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:#dc2626;">로그 조회 실패: ${escapeHtml(err.message)}</td></tr>`;
        }
    }
}

// 3-5. 텔레그램 뉴스 브리핑 시간표 관리 로직
let currentAdminBriefingTimes = ['07:30'];

function renderAdminBriefingChips() {
    const container = document.getElementById('adminBriefingChipsContainer');
    if (!container) return;
    if (!currentAdminBriefingTimes || currentAdminBriefingTimes.length === 0) {
        container.innerHTML = '<span style="font-size:0.8rem; color:#94a3b8;">등록된 브리핑 시간이 없습니다.</span>';
        return;
    }
    container.innerHTML = currentAdminBriefingTimes.map((t, idx) => `
        <span style="display:inline-flex; align-items:center; gap:0.35rem; padding:0.25rem 0.55rem; background:#eff6ff; border:1px solid #bfdbfe; border-radius:9999px; font-size:0.8rem; font-weight:700; color:#1d4ed8;">
            <span>⏰ ${t}</span>
            <button type="button" onclick="removeAdminBriefingTime(${idx})" style="background:none; border:none; color:#dc2626; font-size:0.9rem; cursor:pointer; padding:0; line-height:1; font-weight:bold;" title="삭제">✕</button>
        </span>
    `).join('');
}

function addAdminBriefingTime() {
    const inputEl = document.getElementById('adminInputBriefingTime');
    if (!inputEl || !inputEl.value) {
        alert('추가할 브리핑 발송 시간을 먼저 선택해 주세요.');
        return;
    }
    const val = inputEl.value.trim();
    if (currentAdminBriefingTimes.includes(val)) {
        alert('이미 등록된 브리핑 시간입니다.');
        return;
    }
    currentAdminBriefingTimes.push(val);
    currentAdminBriefingTimes.sort();
    renderAdminBriefingChips();
}

function removeAdminBriefingTime(idx) {
    if (currentAdminBriefingTimes && currentAdminBriefingTimes.length > idx) {
        currentAdminBriefingTimes.splice(idx, 1);
        renderAdminBriefingChips();
    }
}

async function saveAdminBriefingTimes() {
    if (!currentAdminBriefingTimes || currentAdminBriefingTimes.length === 0) {
        if (!confirm('설정된 브리핑 시간이 없습니다. 07:30 기본값으로 저장할까요?')) return;
        currentAdminBriefingTimes = ['07:30'];
    }
    try {
        const res = await fetch('/api/admin/news/briefing-times', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ times: currentAdminBriefingTimes })
        });
        const data = await res.json();
        if (data.success) {
            alert('텔레그램 브리핑 발송 시간표가 저장되었습니다.\n(스케줄러가 새 시간대에 맞춰 자동 발송합니다)');
            loadNewsData();
        } else {
            alert('저장 실패: ' + (data.message || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('시간표 저장 중 통신 오류 발생: ' + e.message);
    }
}

// 3-6. 뉴스 수집 제외 키워드 필터 관리 로직
let currentAdminExcludeKeywords = [];

function renderAdminExcludeChips() {
    const container = document.getElementById('adminExcludeChipsContainer');
    if (!container) return;
    if (!currentAdminExcludeKeywords || currentAdminExcludeKeywords.length === 0) {
        container.innerHTML = '<span style="font-size:0.8rem; color:#94a3b8;">등록된 제외 키워드가 없습니다.</span>';
        return;
    }
    container.innerHTML = currentAdminExcludeKeywords.map((kw, idx) => `
        <span style="display:inline-flex; align-items:center; gap:0.35rem; padding:0.25rem 0.55rem; background:#fee2e2; border:1px solid #fecaca; border-radius:9999px; font-size:0.8rem; font-weight:700; color:#b91c1c;">
            <span>🚫 ${escapeHtml(kw)}</span>
            <button type="button" onclick="removeAdminExcludeKeyword(${idx})" style="background:none; border:none; color:#ef4444; font-size:0.9rem; cursor:pointer; padding:0; line-height:1; font-weight:bold;" title="삭제">✕</button>
        </span>
    `).join('');
}

function addAdminExcludeKeyword() {
    const inputEl = document.getElementById('adminInputExcludeKeyword');
    if (!inputEl || !inputEl.value) {
        alert('추가할 제외 키워드를 먼저 입력해 주세요.');
        return;
    }
    const val = inputEl.value.trim();
    if (!val) return;
    if (currentAdminExcludeKeywords.includes(val)) {
        alert('이미 등록된 제외 키워드입니다: ' + val);
        inputEl.value = '';
        inputEl.focus();
        return;
    }
    currentAdminExcludeKeywords.push(val);
    inputEl.value = '';
    inputEl.focus();
    renderAdminExcludeChips();
}

function removeAdminExcludeKeyword(idx) {
    if (currentAdminExcludeKeywords && currentAdminExcludeKeywords.length > idx) {
        currentAdminExcludeKeywords.splice(idx, 1);
        renderAdminExcludeChips();
    }
}

async function saveAdminExcludeKeywords() {
    try {
        const res = await fetch('/api/admin/news/exclude-keywords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: currentAdminExcludeKeywords })
        });
        const data = await res.json();
        if (data.success) {
            alert('수집 제외 키워드가 저장되었습니다.\n(다음 뉴스 수집 시 해당 단어가 포함된 기사는 자동 차단됩니다)');
            loadNewsData();
        } else {
            alert('저장 실패: ' + (data.message || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('제외 키워드 저장 중 통신 오류 발생: ' + e.message);
    }
}

// 전역 window 바인딩
window.loadBloodData = loadBloodData;
window.testBloodSmtpEmail = testBloodSmtpEmail;
window.importBloodCsv = importBloodCsv;
window.fetchBloodConfigs = fetchBloodConfigs;
window.saveBloodConfigs = saveBloodConfigs;
window.loadAssetData = loadAssetData;
window.loadNewsData = loadNewsData;
window.loadNewsLogs = loadNewsLogs;
window.fetchNewsFileLogs = fetchNewsFileLogs;
window.triggerNewsCollection = triggerNewsCollection;
window.loadSecurityLogs = loadSecurityLogs;
window.addAdminBriefingTime = addAdminBriefingTime;
window.removeAdminBriefingTime = removeAdminBriefingTime;
window.saveAdminBriefingTimes = saveAdminBriefingTimes;
window.addAdminExcludeKeyword = addAdminExcludeKeyword;
window.removeAdminExcludeKeyword = removeAdminExcludeKeyword;
window.saveAdminExcludeKeywords = saveAdminExcludeKeywords;

