/**
 * ==============================================================================
 * 관리자 학습실 Phase 4 (공교육 커리큘럼 · 공공 API 키 상태 · 사전 캐시 로그)
 * (admin-study-growth.js)
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
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, data };
    }

    function renderGrowthPanel(mount, data) {
        const cfg = data.config || {};
        const providers = data.providers || {};
        const cache = data.cache || { wordCount: 0, totalHits: 0, localBankCount: 0 };

        const providerCards = Object.entries(providers).map(([key, p]) => {
            const badge = p.configured
                ? `<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:999px; font-size:0.74rem; font-weight:800;">✅ 연결됨 (${esc(p.masked)})</span>`
                : `<span style="background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:999px; font-size:0.74rem; font-weight:700;">⚪ 미설정 (로컬 폴백)</span>`;
            const testBtn = (key === 'urimalsam' || key === 'stdtdic' || key === 'arasaac' || key === 'freedict')
                ? `<button type="button" class="btn-admin btn-admin-outline btn-admin-sm" data-test-provider="${esc(key)}">🧪 연동 테스트</button>`
                : '';
            return `
                <div style="border:1px solid #e2e8f0; border-radius:0.7rem; padding:0.7rem; background:#ffffff; display:flex; flex-direction:column; gap:6px; justify-content:space-between;">
                    <div>
                        <div style="font-size:0.84rem; font-weight:800; color:#0f172a; margin-bottom:4px;">${esc(p.label)}</div>
                        ${badge}
                    </div>
                    ${testBtn}
                </div>
            `;
        }).join('');

        const childCards = (data.childrenCurriculum || []).map((c) => {
            const subjLines = (c.subjects || []).map((s) =>
                `<div style="font-size:0.78rem; color:#334155;">${esc(s.label)} <strong>Lv.${s.currentLevel}</strong> · ${esc(s.activeUnitTitle)} (완료 ${s.completedSheets}장)</div>`
            ).join('');
            return `
                <div style="border:1px solid #bbf7d0; border-radius:0.7rem; padding:0.75rem; background:#f0fdf4;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <strong style="font-size:0.88rem;">${esc(c.avatarEmoji)} ${esc(c.displayName)}</strong>
                        <span style="font-size:0.78rem; font-weight:800; color:#166534;">기초학력 ${c.overallPercent}%</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:3px;">${subjLines}</div>
                </div>
            `;
        }).join('');

        const logRows = (data.recentLogs || []).slice(0, 12).map((l) => `
            <tr>
                <td>${esc(l.provider)}</td>
                <td>${esc(l.query_text)}</td>
                <td>${esc(l.status)}${l.hit_cache ? ' (캐시)' : ''}</td>
                <td style="font-size:0.76rem; color:#64748b;">${esc(l.error_message || '-')}</td>
                <td style="font-size:0.75rem; white-space:nowrap;">${esc(l.created_at || '')}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center; padding:0.9rem; color:#64748b;">아직 외부 사전 조회 기록이 없습니다.</td></tr>';

        mount.innerHTML = `
            <div class="admin-card-header" style="flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <h3 style="margin:0;">🌱 공교육 커리큘럼 · 우리말샘/사전 Open API &amp; 캐시 관제</h3>
                    <p style="margin:0.2rem 0 0; font-size:0.78rem; color:#64748b;">
                        국가기초학력지원포털 연계 진도표와 국립국어원(우리말샘·표준국어대사전) API 연동 상태, SQLite 낱말 캐시(${cache.wordCount}개 · 적중 ${cache.totalHits}회)를 확인합니다.
                    </p>
                </div>
                <button type="button" id="btnReloadAdminGrowth" class="btn-admin btn-admin-outline btn-admin-sm">🔄 새로고침</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:1rem; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.7rem; padding:0.75rem; margin-top:0.65rem;">
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                    <input type="checkbox" id="chkAdminCurriculumTree" ${cfg.curriculumTreeEnabled !== false ? 'checked' : ''}> 🌱 대시보드 내 실력 자람 나무 표시
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                    <input type="checkbox" id="chkAdminPublicDict" ${cfg.publicDictEnabled !== false ? 'checked' : ''}> 📖 우리말 낱말 사전 Open API 조회 사용
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                    <input type="checkbox" id="chkAdminArasaac" ${cfg.arasaacEnabled !== false ? 'checked' : ''}> 🎨 유아 픽토그램 일러스트(ARASAAC)
                </label>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                    <input type="checkbox" id="chkAdminFreedict" ${cfg.freedictEnabled !== false ? 'checked' : ''}> 🔊 영어 원어민 발음(FreeDict)
                </label>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(195px, 1fr)); gap:0.65rem; margin-top:0.75rem;">
                ${providerCards}
            </div>
            <div id="adminGrowthTestResult" style="display:none; margin-top:0.75rem; padding:0.7rem; border-radius:0.65rem; font-size:0.82rem;"></div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:0.75rem; margin-top:0.75rem;">
                ${childCards}
            </div>
            <div class="admin-table-container admin-table-scroll" style="margin-top:0.85rem;">
                <table class="admin-table">
                    <thead><tr><th>제공처</th><th>검색어</th><th>상태</th><th>상세</th><th>시각</th></tr></thead>
                    <tbody>${logRows}</tbody>
                </table>
            </div>
        `;

        mount.querySelector('#btnReloadAdminGrowth')?.addEventListener('click', loadAdminStudyGrowth);
        const onCfgChange = async () => {
            const payload = {
                curriculumTreeEnabled: Boolean(mount.querySelector('#chkAdminCurriculumTree')?.checked),
                publicDictEnabled: Boolean(mount.querySelector('#chkAdminPublicDict')?.checked),
                arasaacEnabled: Boolean(mount.querySelector('#chkAdminArasaac')?.checked),
                freedictEnabled: Boolean(mount.querySelector('#chkAdminFreedict')?.checked)
            };
            const { ok, data: resData } = await apiAdmin('/api/admin/study/growth/config', 'POST', payload);
            toast(resData.message || (ok ? '저장되었습니다.' : '저장 실패'), !ok);
        };
        mount.querySelector('#chkAdminCurriculumTree')?.addEventListener('change', onCfgChange);
        mount.querySelector('#chkAdminPublicDict')?.addEventListener('change', onCfgChange);
        mount.querySelector('#chkAdminArasaac')?.addEventListener('change', onCfgChange);
        mount.querySelector('#chkAdminFreedict')?.addEventListener('change', onCfgChange);

        mount.querySelectorAll('[data-test-provider]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const provider = btn.dataset.testProvider;
                btn.disabled = true;
                btn.textContent = '🧪 점검 중...';
                const query = provider === 'freedict' ? 'apple' : '사과';
                const { data: testRes } = await apiAdmin('/api/admin/study/growth/test-api', 'POST', { provider, query });
                const resultEl = mount.querySelector('#adminGrowthTestResult');
                if (resultEl) {
                    resultEl.style.display = 'block';
                    const r = testRes.result || {};
                    if (r.ok && r.entry) {
                        resultEl.style.background = '#ecfdf5';
                        resultEl.style.border = '1px solid #6ee7b7';
                        resultEl.style.color = '#065f46';
                        resultEl.innerHTML = `✅ <strong>${esc(r.entry.providerLabel)}</strong> 연결 성공 (${r.elapsedMs}ms) — <strong>${esc(r.entry.word)}</strong>: ${esc(r.entry.definition)}`;
                    } else if (r.ok) {
                        resultEl.style.background = '#ecfdf5';
                        resultEl.style.border = '1px solid #6ee7b7';
                        resultEl.style.color = '#065f46';
                        resultEl.textContent = `✅ ${r.message || '연동 성공'} (${r.elapsedMs}ms)`;
                    } else {
                        resultEl.style.background = '#fff7ed';
                        resultEl.style.border = '1px solid #fdba74';
                        resultEl.style.color = '#9a3412';
                        resultEl.textContent = `⚠️ ${r.message || 'API 확인 필요'}`;
                    }
                }
                await loadAdminStudyGrowth();
            });
        });
    }

    async function loadAdminStudyGrowth() {
        const mount = document.getElementById('studyGrowthAdminPanel');
        if (!mount) return;
        const { ok, data } = await apiAdmin('/api/admin/study/growth');
        if (!ok) {
            mount.innerHTML = '<p style="margin:0; font-size:0.84rem; color:#dc2626;">커리큘럼·공공 API 현황을 불러오지 못했습니다.</p>';
            return;
        }
        renderGrowthPanel(mount, data);
    }

    window.loadAdminStudyGrowth = loadAdminStudyGrowth;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (document.getElementById('studyGrowthAdminPanel')) loadAdminStudyGrowth();
        }, 650);
    });
})();
