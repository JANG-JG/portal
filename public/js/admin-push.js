/**
 * 🔔 JG 관리자 센터 - 웹 푸시 구독 기기 & 실시간 발송·수신 진단 모듈 (admin-push.js)
 */
(function() {
    'use strict';

    function esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.loadAdminPushSubscriptions = async function() {
        const devBody = document.getElementById('adminPushDevicesTbody');
        const evtBody = document.getElementById('adminPushEventsTbody');
        const countBadge = document.getElementById('adminPushDeviceCountBadge');
        if (!devBody) return;

        try {
            const res = await fetch('/api/admin/push/overview', { credentials: 'include' });
            if (!res.ok) throw new Error('상태 조회 실패');
            const data = await res.json();
            const devices = data.devices || [];
            const events = data.recentEvents || [];

            if (countBadge) countBadge.textContent = `등록 기기 ${devices.length}대`;

            if (devices.length === 0) {
                devBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">현재 등록된 웹 푸시 수신 기기가 없습니다.</td></tr>';
            } else {
                devBody.innerHTML = devices.map((d) => {
                    const modeTxt = d.clientType === 'pwa' ? '📲 설치형 웹앱' : '🌐 브라우저';
                    const devTxt = d.deviceType === 'mobile' ? '모바일' : 'PC';
                    const statusHtml = d.lastError
                        ? `<span style="color:#dc2626; font-weight:600; font-size:0.78rem;">⚠️ ${esc(d.lastError)}</span>`
                        : (d.lastSuccessAt
                            ? `<span style="color:#059669; font-weight:600; font-size:0.78rem;">✅ 성공 (${esc(d.lastSuccessAt.slice(5, 16))})</span>`
                            : '<span style="color:#64748b; font-size:0.78rem;">대기 중 (발송 전)</span>');
                    return `
                        <tr>
                            <td style="font-weight:700;">${esc(d.userId)}</td>
                            <td>${modeTxt} · ${esc(d.browserName)} <span style="color:#64748b; font-size:0.76rem;">(${devTxt})</span></td>
                            <td style="font-size:0.78rem; color:#475569;">${esc((d.updatedAt || '').slice(0, 16))}</td>
                            <td>${statusHtml}</td>
                            <td style="font-family:monospace; font-size:0.74rem; color:#64748b;">${esc(d.endpointShort)}</td>
                            <td style="text-align:right; white-space:nowrap;">
                                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="sendAdminPushTest('${esc(d.userId)}')" style="padding:3px 8px; font-size:0.75rem;">🔔 점검 발송</button>
                                <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" onclick="deleteAdminPushDevice(${d.id})" style="padding:3px 8px; font-size:0.75rem;">삭제</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            if (evtBody) {
                if (events.length === 0) {
                    evtBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.2rem; color:#94a3b8;">서버 재시작 이후 기록된 실시간 발송·수신 로그가 없습니다.</td></tr>';
                } else {
                    evtBody.innerHTML = events.slice(0, 20).map((ev) => {
                        const timeTxt = (ev.timestamp || '').replace('T', ' ').slice(5, 19);
                        let kindBadge = '📨 발송';
                        let detail = '';
                        if (ev.kind === 'send') {
                            kindBadge = '📨 서버 발송';
                            detail = `${esc(ev.title || '-')} (성공 ${ev.successCount}/${ev.targetCount})`;
                        } else if (ev.kind === 'sw-ack') {
                            kindBadge = ev.status === 'error' ? '❌ 기기 오류' : '📲 기기 표시 확인';
                            detail = `${esc(ev.title || '-')} ${ev.error ? '— ' + esc(ev.error) : ''}`;
                        } else if (ev.kind === 'subscribe') {
                            kindBadge = '📥 기기 등록';
                            detail = `${esc(ev.userId)} · ${ev.clientType === 'pwa' ? '웹앱' : '브라우저'} (${esc(ev.browserName || '-')})`;
                        }
                        return `
                            <tr>
                                <td style="font-size:0.76rem; color:#64748b; white-space:nowrap;">${esc(timeTxt)}</td>
                                <td style="font-weight:700; font-size:0.8rem; white-space:nowrap;">${kindBadge}</td>
                                <td colspan="2" style="font-size:0.8rem; color:#1e293b;">${detail}</td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        } catch (err) {
            devBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.2rem; color:#ef4444;">데이터를 불러오지 못했습니다: ${esc(err.message)}</td></tr>`;
        }
    };

    window.deleteAdminPushDevice = async function(id) {
        if (!confirm('선택한 푸시 수신 기기 등록을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/admin/push/devices/${id}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                window.loadAdminPushSubscriptions();
            } else {
                alert(data.message || '삭제 실패');
            }
        } catch (e) {
            alert('기기 삭제 오류: ' + e.message);
        }
    };

    window.sendAdminPushTest = async function(userId) {
        try {
            const res = await fetch(`/api/admin/push/test/${encodeURIComponent(userId)}`, { method: 'POST', credentials: 'include' });
            const data = await res.json();
            setTimeout(() => window.loadAdminPushSubscriptions(), 500);
            if (data.success && data.successCount > 0) {
                alert(`✅ ${userId} 계정의 기기(${data.successCount}대)로 점검 푸시를 발송했습니다.`);
            } else {
                alert(`⚠️ 발송 성공 기기가 없습니다 (대상 ${data.targetCount || 0}대).`);
            }
        } catch (e) {
            alert('점검 발송 오류: ' + e.message);
        }
    };
})();
