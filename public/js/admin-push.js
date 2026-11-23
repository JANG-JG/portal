/**
 * 🔔 JG 관리자 센터 - 알림 허브 정책 제어 · 웹 푸시 구독 기기 & 실시간 진단 모듈 (admin-push.js)
 */
(function() {
    'use strict';

    function esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderServicesTable(services, iconPresets) {
        const svcBody = document.getElementById('adminNotifServicesTbody');
        if (!svcBody) return;

        if (!services || services.length === 0) {
            svcBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.2rem; color:#94a3b8;">등록된 알림 서비스 정책이 없습니다.</td></tr>';
            return;
        }

        const presets = Array.isArray(iconPresets) && iconPresets.length > 0 ? iconPresets : [
            { label: '기본 포털', path: '/icons/notif/default-192.png' }
        ];

        svcBody.innerHTML = services.map((s) => {
            const key = esc(s.service_key);
            const iconOptions = presets.map((p) =>
                `<option value="${esc(p.path)}" ${s.icon_path === p.path ? 'selected' : ''}>${esc(p.label)}</option>`
            ).join('');

            return `
                <tr data-service-key="${key}">
                    <td style="font-weight:700; white-space:nowrap;">
                        <img src="${esc(s.icon_path || '/icons/notif/default-192.png')}" alt="" width="22" height="22" style="border-radius:6px; vertical-align:middle; margin-right:6px;">
                        ${esc(s.icon_emoji || '🔔')} ${esc(s.display_name)}
                    </td>
                    <td>
                        <input type="checkbox" id="svcActive_${key}" ${s.is_active ? 'checked' : ''} aria-label="서비스 활성">
                    </td>
                    <td>
                        <select id="svcScope_${key}" style="padding:4px 6px; font-size:0.78rem; border:1px solid #cbd5e1; border-radius:6px;">
                            <option value="admin_only" ${s.scope_policy === 'admin_only' ? 'selected' : ''}>관리자 전용</option>
                            <option value="family_opt_in" ${s.scope_policy === 'family_opt_in' ? 'selected' : ''}>가족 선택(기본 꺼짐)</option>
                            <option value="family_default_on" ${s.scope_policy === 'family_default_on' ? 'selected' : ''}>가족 기본 켜짐</option>
                        </select>
                    </td>
                    <td>
                        <select id="svcTgMode_${key}" style="padding:4px 6px; font-size:0.78rem; border:1px solid #cbd5e1; border-radius:6px;">
                            <option value="both" ${s.messenger_mode === 'both' ? 'selected' : ''}>항상 동시 발송</option>
                            <option value="fallback" ${s.messenger_mode === 'fallback' ? 'selected' : ''}>웹푸시 실패 시 백업</option>
                            <option value="off" ${s.messenger_mode === 'off' ? 'selected' : ''}>사용 안 함</option>
                        </select>
                    </td>
                    <td>
                        <select id="svcIcon_${key}" style="padding:4px 6px; font-size:0.78rem; border:1px solid #cbd5e1; border-radius:6px;">
                            ${iconOptions}
                        </select>
                    </td>
                    <td style="text-align:right; white-space:nowrap;">
                        <button type="button" class="btn-admin btn-admin-primary btn-admin-sm" onclick="saveAdminNotifService('${key}')" style="padding:3px 10px; font-size:0.75rem;">저장</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderDeviceStatusHtml(d, fmt) {
        const httpTxt = d.lastHttpCode ? ` (HTTP ${d.lastHttpCode})` : '';
        if (d.status === 'expired' || d.status === 'revoked') {
            return `<span style="color:#dc2626; font-weight:700; font-size:0.78rem;">🔴 만료/재구독 대기${esc(httpTxt)}</span>` +
                (d.lastError ? `<div style="font-size:0.72rem; color:#991b1b;">${esc(d.lastError)}</div>` : '');
        }
        if (d.status === 'degraded' || d.lastError) {
            return `<span style="color:#d97706; font-weight:600; font-size:0.78rem;">⚠️ 지연(${d.failCount || 1}회)${esc(httpTxt)}</span>` +
                (d.lastError ? `<div style="font-size:0.72rem; color:#92400e;">${esc(d.lastError)}</div>` : '');
        }
        if (d.lastSuccessAt) {
            return `<span style="color:#059669; font-weight:600; font-size:0.78rem;">✅ 정상 (${esc(fmt(d.lastSuccessAt, 'short-min'))})</span>`;
        }
        return '<span style="color:#64748b; font-size:0.78rem;">🟢 대기 중 (발송 전)</span>';
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

            renderServicesTable(data.services || [], data.iconPresets || []);

            const activeCnt = devices.filter((d) => d.status === 'active' || d.status === 'degraded').length;
            if (countBadge) countBadge.textContent = `활성 ${activeCnt}대 / 전체 ${devices.length}대`;

            if (devices.length === 0) {
                devBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">현재 등록된 웹 푸시 수신 기기가 없습니다.</td></tr>';
            } else {
                const fmt = typeof window.formatAdminKst === 'function'
                    ? window.formatAdminKst
                    : (v, m) => String(v || '').replace('T', ' ').slice(m === 'short-min' ? 5 : 0, 16);

                devBody.innerHTML = devices.map((d) => {
                    const modeTxt = d.clientType === 'pwa' ? '📲 설치형 웹앱' : '🌐 브라우저';
                    const devTxt = d.deviceType === 'mobile' ? '모바일' : 'PC';
                    const encBadge = d.contentEncoding ? ` · ${esc(d.contentEncoding)}` : '';
                    const statusHtml = renderDeviceStatusHtml(d, fmt);
                    return `
                        <tr>
                            <td style="font-weight:700;">${esc(d.userId)}</td>
                            <td>${modeTxt} · ${esc(d.browserName)} <span style="color:#64748b; font-size:0.75rem;">(${devTxt}${encBadge})</span></td>
                            <td style="font-size:0.78rem; color:#475569;">${esc(fmt(d.updatedAt, 'minute'))}</td>
                            <td>${statusHtml}</td>
                            <td style="font-family:monospace; font-size:0.74rem; color:#64748b;">${esc(d.endpointShort)}</td>
                            <td style="text-align:right; white-space:nowrap;">
                                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="sendAdminPushTest('${esc(d.userId)}')" style="padding:3px 7px; font-size:0.74rem;">🔔 점검</button>
                                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="forceExpireAdminPushDevice(${d.id})" style="padding:3px 7px; font-size:0.74rem;">🔄 재연결</button>
                                <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" onclick="deleteAdminPushDevice(${d.id})" style="padding:3px 7px; font-size:0.74rem;">삭제</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            if (evtBody) {
                if (events.length === 0) {
                    evtBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.2rem; color:#94a3b8;">서버 재시작 이후 기록된 실시간 발송·수신 로그가 없습니다.</td></tr>';
                } else {
                    const fmtEvt = typeof window.formatAdminKst === 'function'
                        ? (v) => window.formatAdminKst(v, 'short')
                        : (v) => String(v || '').replace('T', ' ').slice(5, 19);
                    evtBody.innerHTML = events.slice(0, 20).map((ev) => {
                        const timeTxt = fmtEvt(ev.timestamp);
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

    window.saveAdminNotifService = async function(serviceKey) {
        const isActive = document.getElementById(`svcActive_${serviceKey}`)?.checked ? 1 : 0;
        const scopePolicy = document.getElementById(`svcScope_${serviceKey}`)?.value;
        const messengerMode = document.getElementById(`svcTgMode_${serviceKey}`)?.value;
        const iconPath = document.getElementById(`svcIcon_${serviceKey}`)?.value;

        try {
            const res = await fetch(`/api/admin/push/services/${encodeURIComponent(serviceKey)}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    is_active: isActive,
                    scope_policy: scopePolicy,
                    messenger_mode: messengerMode,
                    icon_path: iconPath
                })
            });
            const data = await res.json();
            if (data.success) {
                alert('✅ 서비스 알림 정책이 저장되었습니다.');
                window.loadAdminPushSubscriptions();
            } else {
                alert('⚠️ 저장 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            alert('정책 저장 오류: ' + e.message);
        }
    };

    window.forceExpireAdminPushDevice = async function(id) {
        if (!confirm('이 기기의 푸시 토큰을 만료 처리하여 다음 포털 접속 시 자동으로 새 토큰을 재발급받도록 유도할까요?')) return;
        try {
            const res = await fetch(`/api/admin/push/devices/${id}/force-expire`, { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                alert('✅ ' + (data.message || '재연결 유도 처리 완료'));
                window.loadAdminPushSubscriptions();
            } else {
                alert(data.message || '처리 실패');
            }
        } catch (e) {
            alert('처리 오류: ' + e.message);
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
