/**
 * ==============================================================================
 * 관리자 학습실 가족 광장 · 포인트 · 보상 쿠폰 상점 · 엄마아빠 포켓몬 관제 스크립트
 * (admin-study-plaza.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const toast = (msg, isErr = false) => {
        if (typeof window.showAdminToast === 'function') window.showAdminToast(msg, isErr ? 'error' : 'success');
    };

    async function apiAdmin(url, method = 'GET', body = null) {
        const opts = { method, credentials: 'same-origin', headers: {} };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, data };
    }

    function renderPlazaOverview(data) {
        const cfg = data.config || {};
        const c1 = document.getElementById('chkAdminPlazaEnabled');
        const c2 = document.getElementById('chkAdminCouponShopEnabled');
        const c3 = document.getElementById('chkAdminParentPokemonEnabled');
        if (c1) c1.checked = cfg.plazaEnabled !== false;
        if (c2) c2.checked = cfg.couponShopEnabled !== false;
        if (c3) c3.checked = cfg.parentPokemonEnabled !== false;

        const childrenMount = document.getElementById('adminPlazaChildrenGrid');
        if (childrenMount) {
            const kidsHtml = (data.children || []).map((c) => `
                <div style="border:1px solid #e2e8f0; border-radius:0.75rem; padding:0.75rem; background:#f8fafc;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px;">
                        <strong style="font-size:0.9rem;">${esc(c.avatarEmoji)} ${esc(c.displayName)}</strong>
                        <span style="padding:2px 8px; border-radius:999px; background:#fef3c7; color:#92400e; font-size:0.8rem; font-weight:800;">⭐ ${Number(c.points || 0)}P</span>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px;">
                        <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="grantAdminStudyPoints('${esc(c.childId)}', 20)">+20P 칭찬</button>
                        <button type="button" class="btn-admin btn-admin-primary btn-admin-sm" onclick="grantAdminStudyPoints('${esc(c.childId)}', 50)">+50P 보너스</button>
                    </div>
                </div>`).join('');
            const parentsHtml = (data.parentTrainers || []).map((t) => `
                <div style="border:1px solid #f5d0fe; border-radius:0.75rem; padding:0.75rem; background:#fdf4ff;">
                    <strong style="font-size:0.88rem;">${esc(t.avatarEmoji)} ${esc(t.displayName)} 포켓몬</strong>
                    <p style="margin:4px 0 0; font-size:0.8rem; color:#6b21a8;">
                        단짝: <strong>${esc(t.partnerPokemon?.nameKo || '-')}</strong> (Lv.${t.partnerPokemon?.level || 1} · 돌봄 ${t.careProgress || 0}/3)
                    </p>
                </div>`).join('');
            childrenMount.innerHTML = kidsHtml + parentsHtml;
        }

        const reqBody = document.getElementById('adminPlazaPurchasesBody');
        if (reqBody) {
            const rows = data.purchases || [];
            reqBody.innerHTML = rows.length ? rows.map((p) => {
                const st = p.status === 'requested' ? '<span style="color:#be185d; font-weight:800;">⏳ 확인 대기</span>'
                    : (p.status === 'approved' ? '<span style="color:#047857; font-weight:700;">✅ 사용 완료</span>'
                        : (p.status === 'owned' ? '<span style="color:#1d4ed8;">🎫 보유 중</span>' : '<span style="color:#64748b;">↩️ 환불됨</span>'));
                const actions = (p.status === 'requested' || p.status === 'owned')
                    ? `<button type="button" class="btn-admin btn-admin-primary btn-admin-sm" onclick="resolveAdminCoupon(${p.id}, 'approve')">✅ 확인</button>
                       <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="resolveAdminCoupon(${p.id}, 'refund')">↩️ 환불</button>`
                    : `<span style="font-size:0.76rem; color:#64748b;">${esc(p.resolved_by || '-')}</span>`;
                return `<tr>
                    <td>${esc(p.avatar_emoji || '🧒')} ${esc(p.display_name || p.child_id)}</td>
                    <td>${esc(p.coupon_emoji)} ${esc(p.coupon_title)}</td>
                    <td>${p.cost_points}P</td>
                    <td>${st}</td>
                    <td style="white-space:nowrap;">${actions}</td>
                </tr>`;
            }).join('') : '<tr><td colspan="5" style="text-align:center; padding:0.9rem; color:#64748b;">아직 쿠폰 교환 내역이 없습니다.</td></tr>';
        }

        const cList = document.getElementById('adminPlazaCouponsList');
        if (cList) {
            cList.innerHTML = (data.coupons || []).map((c) => `
                <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.55rem 0.7rem; background:#ffffff;">
                    <div style="min-width:0;">
                        <strong style="font-size:0.86rem;">${esc(c.emoji)} ${esc(c.title)}</strong>
                        <span style="margin-left:6px; font-size:0.8rem; color:#b45309; font-weight:800;">${c.cost_points}P</span>
                        <div style="font-size:0.75rem; color:#64748b;">${esc(c.description || '')}</div>
                    </div>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="deleteAdminStudyCoupon(${c.id})">🗑️ 삭제</button>
                </div>`).join('');
        }
    }

    async function loadAdminStudyPlaza() {
        const mount = document.getElementById('adminPlazaChildrenGrid');
        if (!mount) return;
        const { ok, data } = await apiAdmin('/api/admin/study/plaza-rewards');
        if (!ok) {
            mount.innerHTML = '<p style="margin:0; font-size:0.82rem; color:#dc2626;">가족 광장·쿠폰 현황을 불러오지 못했습니다.</p>';
            return;
        }
        renderPlazaOverview(data);
    }

    async function saveAdminPlazaConfig() {
        const body = {
            plazaEnabled: Boolean(document.getElementById('chkAdminPlazaEnabled')?.checked),
            couponShopEnabled: Boolean(document.getElementById('chkAdminCouponShopEnabled')?.checked),
            parentPokemonEnabled: Boolean(document.getElementById('chkAdminParentPokemonEnabled')?.checked)
        };
        const { ok, data } = await apiAdmin('/api/admin/study/plaza-rewards/config', 'POST', body);
        toast(data.message || (ok ? '저장되었습니다.' : '저장 실패'), !ok);
        if (ok) renderPlazaOverview(data);
    }

    async function addAdminStudyCoupon(event) {
        event.preventDefault();
        const emoji = document.getElementById('adminCouponEmojiInput')?.value || '🎁';
        const title = document.getElementById('adminCouponTitleInput')?.value || '';
        const costPoints = Number(document.getElementById('adminCouponCostInput')?.value || 100);
        const description = document.getElementById('adminCouponDescInput')?.value || '';
        const { ok, data } = await apiAdmin('/api/admin/study/plaza-rewards/coupons', 'POST', { emoji, title, costPoints, description, isActive: true });
        toast(data.message || (ok ? '쿠폰 추가됨' : '추가 실패'), !ok);
        if (ok) {
            event.target.reset();
            const em = document.getElementById('adminCouponEmojiInput');
            if (em) em.value = '🎁';
            loadAdminStudyPlaza();
        }
    }

    async function deleteAdminStudyCoupon(id) {
        const { ok, data } = await apiAdmin(`/api/admin/study/plaza-rewards/coupons/${id}`, 'DELETE');
        toast(data.message || '처리됨', !ok);
        if (ok) loadAdminStudyPlaza();
    }

    async function resolveAdminCoupon(id, action) {
        const { ok, data } = await apiAdmin(`/api/admin/study/plaza-rewards/purchases/${id}/resolve`, 'POST', { action });
        toast(data.message || '처리됨', !ok);
        if (ok) renderPlazaOverview(data);
    }

    async function grantAdminStudyPoints(childId, delta) {
        const { ok, data } = await apiAdmin('/api/admin/study/plaza-rewards/points/grant', 'POST', { childId, delta });
        toast(data.message || '반영됨', !ok);
        if (ok) renderPlazaOverview(data);
    }

    window.loadAdminStudyPlaza = loadAdminStudyPlaza;
    window.saveAdminPlazaConfig = saveAdminPlazaConfig;
    window.addAdminStudyCoupon = addAdminStudyCoupon;
    window.deleteAdminStudyCoupon = deleteAdminStudyCoupon;
    window.resolveAdminCoupon = resolveAdminCoupon;
    window.grantAdminStudyPoints = grantAdminStudyPoints;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (document.getElementById('adminPlazaChildrenGrid')) loadAdminStudyPlaza();
        }, 550);
    });
})();
