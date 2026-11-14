/**
 * ==============================================================================
 * 관리자 센터 - 내부 Wi-Fi(LAN) 멀티 서비스 고속 HTTPS 게이트웨이 모니터링 & 제어
 * (admin-lan.js)
 * ==============================================================================
 */
(function () {
    'use strict';

    let currentLanStatus = null;

    function escLanHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function notifyLanAdmin(msg, isErr = false) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, isErr ? 'error' : 'success');
        } else {
            alert(msg);
        }
    }

    function renderAdminLanGateway(data) {
        currentLanStatus = data;
        const hostEl = document.getElementById('adminLanHostSummary');
        const badgeEl = document.getElementById('adminLanAutoStateBadge');
        const toggleBtn = document.getElementById('btnAdminLanAutoToggle');
        const expiryEl = document.getElementById('adminLanCertExpiryText');
        const gridEl = document.getElementById('adminLanServicesGrid');

        if (hostEl) {
            const activeCnt = (data.services || []).filter((s) => s.active).length;
            const totalCnt = (data.services || []).length;
            hostEl.textContent = data.active
                ? `내부 IP ${data.lanIp} · 게이트웨이 ${activeCnt}/${totalCnt}개 온라인`
                : `게이트웨이 대기 중 (${data.lastError || '비활성'})`;
        }

        const isAutoOn = data.autoRedirect !== false;
        if (badgeEl) {
            badgeEl.textContent = isAutoOn ? '⚡ 자동 전환 켜짐' : '⏸️ 수동 모드';
            badgeEl.style.color = isAutoOn ? '#059669' : '#d97706';
        }
        if (toggleBtn) {
            toggleBtn.textContent = isAutoOn ? '⏸️ 자동 전환 끄기' : '⚡ 자동 전환 켜기';
        }
        if (expiryEl) {
            expiryEl.textContent = data.expiresAt
                ? `로컬 인증서 만료 예정: ${data.expiresAt}`
                : '같은 Wi-Fi에서 루트 인증서(CA) 1회 설치 시 전체 서비스 즉시 연결';
        }

        if (gridEl) {
            const services = data.services || [];
            gridEl.innerHTML = services.map((svc) => {
                const badgeBg = svc.active ? '#dcfce7' : '#fef2f2';
                const badgeFg = svc.active ? '#15803d' : '#b91c1c';
                const badgeLabel = svc.active ? '● 가동 중' : '○ 대기';
                return `
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.65rem 0.75rem; min-width:0; box-sizing:border-box; display:flex; flex-direction:column; gap:0.35rem;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.4rem;">
                            <strong style="font-size:0.82rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escLanHtml(svc.label)}</strong>
                            <span style="font-size:0.7rem; font-weight:700; padding:1px 6px; border-radius:999px; background:${badgeBg}; color:${badgeFg}; flex-shrink:0;">${badgeLabel}</span>
                        </div>
                        <div style="font-size:0.75rem; color:#2563eb; word-break:break-all; font-family:monospace;">${escLanHtml(svc.url)}</div>
                        <div style="display:flex; gap:0.35rem; margin-top:auto;">
                            <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="flex:1; min-height:34px; font-size:0.75rem;" onclick="copyAdminLanUrl('${escLanHtml(svc.url)}')">📋 주소 복사</button>
                            <a href="${escLanHtml(svc.url)}" target="_blank" rel="noopener" class="btn-admin btn-admin-outline btn-admin-sm" style="min-height:34px; font-size:0.75rem; text-decoration:none; display:inline-flex; align-items:center;">열기 ↗</a>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    async function loadAdminLanGatewayStatus() {
        const gridEl = document.getElementById('adminLanServicesGrid');
        if (!gridEl) return;
        try {
            const res = await fetch('/api/admin/lan-gateway/status', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '조회 실패');
            renderAdminLanGateway(data);
        } catch (err) {
            gridEl.innerHTML = `<div style="color:#64748b; font-size:0.8rem;">내부망 상태 조회 실패: ${escLanHtml(err.message)}</div>`;
        }
    }

    async function toggleAdminLanAutoRedirect() {
        const nextFlag = currentLanStatus ? !(currentLanStatus.autoRedirect !== false) : false;
        const btn = document.getElementById('btnAdminLanAutoToggle');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/admin/lan-gateway/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ autoRedirect: nextFlag })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '변경 실패');
            renderAdminLanGateway(data);
            notifyLanAdmin(data.message || '설정이 변경되었습니다.');
        } catch (err) {
            notifyLanAdmin(err.message || '설정 변경에 실패했습니다.', true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function copyAdminLanUrl(url) {
        if (!url) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url)
                .then(() => notifyLanAdmin('내부 HTTPS 주소를 복사했습니다.'))
                .catch(() => notifyLanAdmin('주소: ' + url));
        } else {
            notifyLanAdmin('주소: ' + url);
        }
    }

    window.loadAdminLanGatewayStatus = loadAdminLanGatewayStatus;
    window.toggleAdminLanAutoRedirect = toggleAdminLanAutoRedirect;
    window.copyAdminLanUrl = copyAdminLanUrl;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(loadAdminLanGatewayStatus, 150);
    });
})();
