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
