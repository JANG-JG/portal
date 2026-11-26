// 서버 텔레그램 알림 설정 및 최근 발송 이력 관리 모듈
(function () {
    const CONFIG_FIELDS = [
        ['srvAlertPm2', 'pm2Alerts'],
        ['srvAlertHttp', 'httpAlerts'],
        ['srvAlertResource', 'resourceAlerts'],
        ['srvAlertHardware', 'hardwareAlerts'],
        ['srvAlertSecondary', 'secondaryAlerts'],
        ['srvAlertDaily', 'dailySummary']
    ];

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function loadServerAlertConfig() {
        const listEl = document.getElementById('srvAlertHistoryList');
        if (!document.getElementById('srvAlertPm2')) return;
        try {
            const res = await fetch('/api/admin/system/alert-config');
            const data = await res.json();
            if (!data.success) return;

            const cfg = data.config || {};
            CONFIG_FIELDS.forEach(([elId, key]) => {
                const el = document.getElementById(elId);
                if (el) el.checked = cfg[key] !== false;
            });

            if (listEl) {
                const hist = data.history || [];
                if (hist.length === 0) {
                    listEl.innerHTML = '<div style="color:#64748b; font-size:0.8rem; padding:0.5rem 0;">서버 기동 이후 발송된 텔레그램 경보가 없습니다.</div>';
                } else {
                    listEl.innerHTML = hist.slice(0, 12).map((item) => {
                        const badge = item.sent
                            ? '<span style="color:#16a34a; font-weight:700;">발송</span>'
                            : '<span style="color:#dc2626; font-weight:700;">실패</span>';
                        return `<div style="display:flex; justify-content:space-between; gap:0.5rem; padding:0.35rem 0; border-bottom:1px solid #f1f5f9; font-size:0.78rem; min-width:0;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; color:#1e293b;">${badge} · ${escapeHtml(item.title)}</span>
                            <span style="color:#64748b; flex-shrink:0; font-family:monospace;">${escapeHtml((item.time || '').slice(5, 16))}</span>
                        </div>`;
                    }).join('');
                }
            }
        } catch (e) {}
    }

    async function saveServerAlertConfig() {
        const payload = {};
        CONFIG_FIELDS.forEach(([elId, key]) => {
            const el = document.getElementById(elId);
            if (el) payload[key] = Boolean(el.checked);
        });
        try {
            const res = await fetch('/api/admin/system/alert-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (typeof showToast === 'function') {
                showToast(data.message || '설정이 저장되었습니다.', !data.success);
            }
        } catch (err) {
            if (typeof showToast === 'function') showToast('설정 저장 실패: ' + err.message, true);
        }
    }

    window.loadServerAlertConfig = loadServerAlertConfig;
    window.saveServerAlertConfig = saveServerAlertConfig;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(loadServerAlertConfig, 600);
    });
})();
