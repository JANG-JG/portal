/**
 * JG Portal 통합 관리자 센터 - 혈압 & 자산 관리 서비스 제어 모듈
 * admin-health-asset.js
 */

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
        const cacheEl = document.getElementById('assetAdminCacheInfo');
        if (totalEl) totalEl.textContent = data.totalKrw;
        if (countEl) countEl.textContent = `${data.accounts.length}개`;
        if (cacheEl && data.cacheStatus) {
            const rateTxt = data.cacheStatus.exchangeRate ? `₩${Math.round(data.cacheStatus.exchangeRate).toLocaleString()}` : '-';
            cacheEl.textContent = `${rateTxt} · ${data.cacheStatus.quoteCacheCount || 0}종목 캐시`;
        }

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

// 2-2. 시세 및 환율 캐시 즉시 새로고침
async function refreshAssetQuotesCache() {
    const btn = document.getElementById('btnRefreshAssetQuotes');
    const origText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 실시간 시세·환율 불러오는 중...';
    }
    try {
        const res = await fetch('/api/admin/asset/refresh-quotes', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast(data.message || '시세 캐시가 새로고침되었습니다.');
            loadAssetData();
            if (document.getElementById('subpane-asset-events') && !document.getElementById('subpane-asset-events').classList.contains('hidden-pane')) {
                loadAssetEvents();
            }
        } else if (typeof window.showToast === 'function') {
            window.showToast(data.message || '시세 갱신 실패', true);
        }
    } catch (err) {
        if (typeof window.showToast === 'function') window.showToast('시세 갱신 오류: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origText || '🔄 실시간 시세·환율 즉시 새로고침';
        }
    }
}

// 2-3. 자산 웹훅·OCR·배당 이벤트 이력 로드
async function loadAssetEvents() {
    try {
        const res = await fetch('/api/admin/asset/events');
        const data = await res.json();
        if (!data.success) return;

        const whStat = data.webhookStats || {};
        const ocrStat = data.ocrStats || {};
        const divStat = data.dividendStats || {};
        const cs = data.cacheStatus || {};

        const setEl = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setEl('assetEvtWebhookStat', `${whStat.totalCount || 0}건 (반영 ${whStat.successCount || 0})`);
        setEl('assetEvtOcrStat', `${ocrStat.totalCount || 0}건 (${ocrStat.avgDurationMs ? (ocrStat.avgDurationMs / 1000).toFixed(1) + '초' : '0초'})`);
        setEl('assetEvtDivYearStat', `₩${(divStat.thisYearKrw || 0).toLocaleString()}`);
        setEl('assetEvtCacheStat', `₩${Math.round(cs.exchangeRate || 0).toLocaleString()} · ${cs.quoteCacheCount || 0}종목`);
        setEl('assetEvtDivMonthBadge', `이번 달 ₩${(divStat.thisMonthKrw || 0).toLocaleString()}`);

        const whBody = document.getElementById('assetWebhookLogsBody');
        if (whBody) {
            const logs = data.webhookLogs || [];
            if (logs.length === 0) {
                whBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#94a3b8;">아직 수신된 증권사 알림 내역이 없습니다.</td></tr>';
            } else {
                const badgeMap = {
                    BUY: ['매수 반영', '#dcfce7', '#166534'],
                    SELL: ['매도 반영', '#dbeafe', '#1e40af'],
                    DIVIDEND: ['배당 반영', '#fef3c7', '#92400e'],
                    TEST_SUCCESS: ['점검 성공', '#e0e7ff', '#3730a3'],
                    UNPARSED: ['미분류', '#f1f5f9', '#475569'],
                    TEMPLATE_ERROR: ['변수 점검', '#fef3c7', '#b45309'],
                    AUTH_ERROR: ['인증 차단', '#fee2e2', '#991b1b'],
                    ERROR: ['오류', '#fee2e2', '#991b1b']
                };
                whBody.innerHTML = logs.map(l => {
                    const [label, bg, fg] = badgeMap[l.parsed_status] || [l.parsed_status || '수신', '#f1f5f9', '#334155'];
                    let summary = '-';
                    try {
                        const pd = JSON.parse(l.parsed_data || '{}');
                        const p = pd.parse || pd;
                        if (p.symbol) summary = `${p.symbol}${p.quantity ? ' · ' + p.quantity + '주' : ''}${pd.targetAccId ? ' (계좌 #' + pd.targetAccId + ')' : ''}`;
                        else if (p.reason) summary = String(p.reason).slice(0, 50);
                    } catch (_) {}
                    return `<tr>
                        <td style="white-space:nowrap; font-size:0.8rem; color:#64748b;">${escapeHtml(l.created_at || '-')}</td>
                        <td><strong>${escapeHtml(l.sender || '-')}</strong></td>
                        <td><span style="background:${bg}; color:${fg}; padding:2px 7px; border-radius:999px; font-size:0.74rem; font-weight:700; white-space:nowrap;">${escapeHtml(label)}</span></td>
                        <td style="max-width:260px; word-break:break-word; font-size:0.82rem;">
                            ${l.title ? `<div style="font-weight:700; color:#1e293b;">${escapeHtml(l.title)}</div>` : ''}
                            <div style="color:#475569;">${escapeHtml((l.body || '').slice(0, 90))}</div>
                        </td>
                        <td style="font-size:0.8rem; color:#334155;">${escapeHtml(summary)}</td>
                    </tr>`;
                }).join('');
            }
        }

        const ocrBody = document.getElementById('assetOcrLogsBody');
        if (ocrBody) {
            const oLogs = data.ocrLogs || [];
            if (oLogs.length === 0) {
                ocrBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#94a3b8;">아직 계좌 사진·알림톡 판독 기록이 없습니다.</td></tr>';
            } else {
                ocrBody.innerHTML = oLogs.map(o => {
                    const isOk = o.status === 'completed' || o.status === 'partial';
                    const typeTxt = o.scan_type === 'quick_talk' ? '문자 붙여넣기' : `사진 OCR (${o.file_count || 1}장)`;
                    let detail = `${o.parsed_count || 0}건 추출`;
                    try {
                        const s = JSON.parse(o.summary_json || '{}');
                        if (Array.isArray(s.symbols) && s.symbols.length > 0) detail = s.symbols.join(', ');
                        else if (s.reason) detail = s.reason;
                    } catch (_) {}
                    return `<tr>
                        <td style="white-space:nowrap; font-size:0.78rem; color:#64748b;">${escapeHtml(o.created_at || '-')}</td>
                        <td style="font-size:0.82rem;">${escapeHtml(typeTxt)}</td>
                        <td><span style="background:${isOk ? '#dcfce7' : '#fee2e2'}; color:${isOk ? '#166534' : '#991b1b'}; padding:2px 6px; border-radius:999px; font-size:0.73rem; font-weight:700;">${isOk ? '성공' : '실패'}</span></td>
                        <td style="font-size:0.8rem;">${o.duration_ms ? (o.duration_ms / 1000).toFixed(2) + '초' : '-'}</td>
                        <td style="font-size:0.8rem; color:#334155;">${escapeHtml(detail)}</td>
                    </tr>`;
                }).join('');
            }
        }

        const divBody = document.getElementById('assetDividendsBody');
        if (divBody) {
            const divs = data.dividends || [];
            if (divs.length === 0) {
                divBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:#94a3b8;">등록된 배당금 입금 내역이 없습니다.</td></tr>';
            } else {
                divBody.innerHTML = divs.map(d => {
                    const isUsd = String(d.currency || 'KRW').toUpperCase() === 'USD';
                    const amtTxt = isUsd ? `$${Number(d.net_amount || 0).toFixed(2)}` : `₩${Math.round(Number(d.net_amount || 0)).toLocaleString()}`;
                    return `<tr>
                        <td style="white-space:nowrap; font-size:0.8rem;">${escapeHtml(d.dividend_date || '-')}</td>
                        <td><strong>${escapeHtml(d.koreanName || d.symbol)}</strong></td>
                        <td style="font-weight:700; color:#059669;">${escapeHtml(amtTxt)}</td>
                        <td style="font-size:0.8rem; color:#475569;">${escapeHtml(d.account_name || '-')}</td>
                    </tr>`;
                }).join('');
            }
        }
    } catch (err) {
        console.error('자산 이벤트 이력 로드 오류:', err);
    }
}

// 1-6. 혈압계 사진 판독(OCR) 및 약 챙겨먹기·병원 일정 알림 발송 이력 로드
async function loadBloodEvents() {
    try {
        const res = await fetch('/api/admin/blood/events');
        const data = await res.json();
        if (!data.success) return;

        const os = data.ocrStats || {};
        const ns = data.notifStats || {};
        const setEl = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setEl('bloodEvtOcrTotal', `${os.totalCount || 0}건`);
        setEl('bloodEvtOcrRate', `${os.successRate ?? 100}%`);
        setEl('bloodEvtOcrAvgMs', os.avgDurationMs ? `${(os.avgDurationMs / 1000).toFixed(2)}초` : '0초');
        setEl('bloodEvtNotifTotal', `${ns.totalCount || 0}건`);
        setEl('bloodNotifSubSummary', `약 챙겨먹기 ${ns.medCount || 0}건 · 병원 일정 ${ns.hospCount || 0}건 · 혈압 재기 ${ns.bpCount || 0}건`);

        const ocrBody = document.getElementById('bloodOcrLogsBody');
        if (ocrBody) {
            const logs = data.ocrLogs || [];
            if (logs.length === 0) {
                ocrBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">아직 혈압계 사진 판독 기록이 없습니다.</td></tr>';
            } else {
                ocrBody.innerHTML = logs.map(l => {
                    const isOk = l.status === 'completed';
                    const bpTxt = (l.systolic || l.diastolic)
                        ? `${l.systolic ?? '-'} / ${l.diastolic ?? '-'} mmHg${l.pulse ? ` (${l.pulse}회)` : ''}`
                        : '-';
                    return `<tr>
                        <td style="white-space:nowrap; font-size:0.8rem; color:#64748b;">${escapeHtml(l.created_at || '-')}</td>
                        <td><strong>${escapeHtml(l.username || 'admin')}</strong></td>
                        <td><span style="background:${isOk ? '#dcfce7' : '#fee2e2'}; color:${isOk ? '#166534' : '#991b1b'}; padding:2px 7px; border-radius:999px; font-size:0.74rem; font-weight:700;">${isOk ? '인식 성공' : '재촬영 안내'}</span></td>
                        <td style="font-weight:700; color:#1e293b;">${escapeHtml(bpTxt)}</td>
                        <td style="font-size:0.8rem;">${l.duration_ms ? (l.duration_ms / 1000).toFixed(2) + '초' : '-'}</td>
                        <td style="font-size:0.8rem; color:#475569;">${escapeHtml(l.message || '-')}</td>
                    </tr>`;
                }).join('');
            }
        }

        const notifBody = document.getElementById('bloodNotifLogsBody');
        if (notifBody) {
            const nLogs = data.notificationLogs || [];
            if (nLogs.length === 0) {
                notifBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#94a3b8;">발송된 건강·병원 일정 알림 기록이 없습니다.</td></tr>';
            } else {
                const typeMap = {
                    medication: ['💊 약 챙겨먹기', '#e0e7ff', '#3730a3'],
                    hospital: ['🏥 병원 일정', '#dcfce7', '#166534'],
                    blood_pressure: ['🩸 혈압 재기', '#fce7f3', '#9d174d']
                };
                notifBody.innerHTML = nLogs.map(n => {
                    const [label, bg, fg] = typeMap[n.type] || ['🔔 건강 알림', '#f1f5f9', '#334155'];
                    return `<tr>
                        <td style="white-space:nowrap; font-size:0.8rem; color:#64748b;">${escapeHtml(n.created_at || '-')}</td>
                        <td><span style="background:${bg}; color:${fg}; padding:2px 7px; border-radius:999px; font-size:0.74rem; font-weight:700; white-space:nowrap;">${escapeHtml(label)}</span></td>
                        <td><strong>${escapeHtml(n.user_id || 'admin')}</strong></td>
                        <td style="max-width:280px; word-break:break-word; font-size:0.82rem;">
                            <div style="font-weight:700; color:#1e293b;">${escapeHtml(n.title || '-')}</div>
                            <div style="color:#475569;">${escapeHtml((n.body || '').slice(0, 90))}</div>
                        </td>
                        <td style="font-size:0.78rem;">${n.is_read ? '<span style="color:#059669; font-weight:600;">확인함</span>' : '<span style="color:#94a3b8;">발송됨</span>'}</td>
                    </tr>`;
                }).join('');
            }
        }
    } catch (err) {
        console.error('건강 이벤트 이력 로드 오류:', err);
    }
}

window.loadBloodEvents = loadBloodEvents;
window.loadAssetEvents = loadAssetEvents;
window.refreshAssetQuotesCache = refreshAssetQuotesCache;
