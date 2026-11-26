/**
 * ==============================================================================
 * 관리자 학습실 세부 기능 On/Off · 보너스 간식 · 미션 테마 · 소셜/AI 도안 로그
 * (admin-study-ops.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 6] 360px 모바일 대응
 * [규칙 11] 관리자 모니터링 · 로그 · On/Off 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    const esc = (v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const toast = (msg, isErr = false) => {
        if (typeof window.showAdminToast === 'function') window.showAdminToast(msg, isErr ? 'error' : 'success');
        else if (typeof window.showToast === 'function') window.showToast(msg, isErr ? 'error' : 'success');
    };

    const SNACK_LABELS = {
        apple: '🍎 아삭 사과',
        berry: '🍓 달콤 베리',
        cookie: '🍪 바삭 쿠키',
        star_candy: '🍬 반짝 별사탕'
    };

    const TRADE_STATUS_BADGE = {
        pending: '<span style="color:#d97706; font-weight:700;">⏳ 대기 중</span>',
        accepted: '<span style="color:#059669; font-weight:800;">✅ 교환 완료</span>',
        declined: '<span style="color:#64748b;">🙅 거절됨</span>',
        cancelled: '<span style="color:#94a3b8;">🚫 취소됨</span>'
    };

    let lastOpsData = null;

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

    function fmtTime(dt) {
        return esc(String(dt || '-').replace('T', ' ').slice(0, 16));
    }

    function renderMissionOpsPanel(data) {
        const mount = document.getElementById('studyOpsTogglesMount');
        if (!mount) return;

        const flags = data.flags || {};
        const mt = data.missionTheme || { date: '', theme: '', presets: [] };
        const kids = data.childrenSnacks || [];
        const presets = Array.isArray(mt.presets) ? mt.presets : [];

        mount.innerHTML = `
            <div class="admin-card" style="margin-bottom:1rem; box-sizing:border-box; max-width:100%;">
                <div class="admin-card-header" style="flex-wrap:wrap; gap:0.5rem;">
                    <div>
                        <h3 style="margin:0;">🎛️ 세부 기능 On/Off &amp; 오늘의 미션 테마 지정</h3>
                        <p style="margin:0.2rem 0 0; font-size:0.78rem; color:#64748b;">
                            소셜 교류·AI 자유 도안·피아노/음성 말하기 기능을 개별 제어하고, 오늘 아이들의 미션 추천 테마·과목을 바로 지정합니다.
                        </p>
                    </div>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="loadAdminStudyOps()">🔄 새로고침</button>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:0.85rem; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.7rem; padding:0.8rem; margin-top:0.7rem; box-sizing:border-box;">
                    <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                        <input type="checkbox" id="chkOpsPokemonSocial" ${flags.pokemonSocialEnabled !== false ? 'checked' : ''} onchange="saveAdminStudyFeatureFlags()">
                        🐾 포켓몬 간식 교환·놀러가기
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                        <input type="checkbox" id="chkOpsAiCustomColoring" ${flags.aiCustomColoringEnabled !== false ? 'checked' : ''} onchange="saveAdminStudyFeatureFlags()">
                        🪄 AI 자유 도안 만들기
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.84rem; font-weight:700; cursor:pointer;">
                        <input type="checkbox" id="chkOpsPianoVoice" ${flags.pianoVoiceEnabled !== false ? 'checked' : ''} onchange="saveAdminStudyFeatureFlags()">
                        🎹 미니 피아노·음성 말하기
                    </label>
                </div>

                <form onsubmit="saveAdminMissionTheme(event)" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0.6rem; background:#eef2ff; border:1px solid #c7d2fe; border-radius:0.75rem; padding:0.85rem; margin-top:0.8rem; box-sizing:border-box;">
                    <div style="min-width:0;">
                        <label for="opsMissionChildSel" style="display:block; font-size:0.75rem; font-weight:700; color:#312e81; margin-bottom:0.25rem;">대상 아이</label>
                        <select id="opsMissionChildSel" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; background:#fff;">
                            <option value="all">👨‍👩‍👧 전체 아이</option>
                            ${kids.map((c) => `<option value="${esc(c.childId)}">${esc(c.avatarEmoji)} ${esc(c.displayName)}</option>`).join('')}
                        </select>
                    </div>
                    <div style="min-width:0;">
                        <label for="opsMissionThemeInput" style="display:block; font-size:0.75rem; font-weight:700; color:#312e81; margin-bottom:0.25rem;">오늘의 미션 테마 (${esc(mt.date)})</label>
                        <input id="opsMissionThemeInput" type="text" maxlength="24" value="${esc(mt.theme || '')}" placeholder="예: 공룡 탐험 (비우면 자동)" style="width:100%; box-sizing:border-box; padding:0.45rem 0.6rem; border:1px solid #cbd5e1; border-radius:0.45rem;">
                    </div>
                    <div style="min-width:0;">
                        <label for="opsMissionSlot1Sel" style="display:block; font-size:0.75rem; font-weight:700; color:#312e81; margin-bottom:0.25rem;">미션 1 (기초 언어)</label>
                        <select id="opsMissionSlot1Sel" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; background:#fff;">
                            <option value="">기존 유지</option>
                            <option value="korean">🇰🇷 한글</option>
                            <option value="english">🔤 영어</option>
                        </select>
                    </div>
                    <div style="min-width:0;">
                        <label for="opsMissionSlot2Sel" style="display:block; font-size:0.75rem; font-weight:700; color:#312e81; margin-bottom:0.25rem;">미션 2 (수리·논리)</label>
                        <select id="opsMissionSlot2Sel" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; background:#fff;">
                            <option value="">기존 유지</option>
                            <option value="math">🔢 수학</option>
                            <option value="logic">🧩 두뇌 퍼즐</option>
                        </select>
                    </div>
                    <div style="min-width:0;">
                        <label for="opsMissionSlot3Sel" style="display:block; font-size:0.75rem; font-weight:700; color:#312e81; margin-bottom:0.25rem;">미션 3 (탐구·예술)</label>
                        <select id="opsMissionSlot3Sel" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; background:#fff;">
                            <option value="">기존 유지</option>
                            <option value="reading">📖 그림동화</option>
                            <option value="science">🌱 자연과학</option>
                            <option value="music">🎹 피아노</option>
                            <option value="coloring">🎨 색칠놀이</option>
                        </select>
                    </div>
                    <div style="grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:0.35rem; align-items:center;">
                        <span style="font-size:0.74rem; color:#4338ca; font-weight:700;">추천 테마:</span>
                        ${presets.map((p) => `<button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="background:#fff; padding:0.2rem 0.55rem;" onclick="pickOpsMissionTheme('${esc(p)}')">${esc(p)}</button>`).join('')}
                        <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="background:#fff; padding:0.2rem 0.55rem;" onclick="pickOpsMissionTheme('')">🎲 자동(비움)</button>
                    </div>
                    <div style="grid-column:1 / -1;">
                        <button type="submit" class="btn-admin btn-admin-primary" style="width:100%; min-height:40px;">🧭 오늘의 미션 테마·과목 적용</button>
                    </div>
                </form>
            </div>
        `;
    }

    function renderSnacksAndSocialPanel(data) {
        const mount = document.getElementById('studyOpsSnacksSocialMount');
        if (!mount) return;

        const kids = data.childrenSnacks || [];
        const catalog = data.snackCatalog || [];
        const trades = data.trades || [];
        const visits = data.visits || [];

        const snackSummaryCards = kids.map((c) => {
            const pills = (c.snacks || []).map((s) =>
                `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; background:#fff; border:1px solid #e2e8f0; font-size:0.76rem; font-weight:700;">${esc(s.emoji)} ${esc(s.name)} ${Number(s.qty || 0)}</span>`
            ).join('');
            const condTxt = c.condition?.label ? esc(c.condition.label) : '상태 확인 중';
            return `
                <div style="border:1px solid #e2e8f0; border-radius:0.7rem; padding:0.7rem; background:#f8fafc; box-sizing:border-box;">
                    <div style="font-weight:800; font-size:0.88rem; margin-bottom:0.25rem;">${esc(c.avatarEmoji)} ${esc(c.displayName)} 보유 간식</div>
                    <div style="font-size:0.75rem; color:#475569; margin-bottom:0.4rem;">
                        단짝 <strong>Lv.${Number(c.partnerLevel || 1)}</strong> · ✨ 이로치 <strong>${Number(c.shinyCount || 0)}</strong> · ${condTxt}
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px;">${pills}</div>
                </div>
            `;
        }).join('');

        const tradesRows = trades.length ? trades.map((t) => {
            const offerTxt = `${SNACK_LABELS[t.offer_snack] || t.offer_snack} ×${t.offer_qty}`;
            const reqTxt = Number(t.request_qty || 0) > 0
                ? `${SNACK_LABELS[t.request_snack] || t.request_snack} ×${t.request_qty}`
                : '🎁 선물';
            const badge = TRADE_STATUS_BADGE[t.status] || esc(t.status);
            return `<tr>
                <td>${esc(t.from_emoji || '🧒')} ${esc(t.from_name || t.from_child_id)} → ${esc(t.to_emoji || '🧒')} ${esc(t.to_name || t.to_child_id)}</td>
                <td>${esc(offerTxt)} ↔ ${esc(reqTxt)}</td>
                <td style="max-width:180px; word-break:break-word;">${esc(t.greeting_msg || '-')}${t.reply_msg ? `<div style="font-size:0.74rem; color:#475569;">↳ ${esc(t.reply_msg)}</div>` : ''}</td>
                <td>${badge}</td>
                <td style="white-space:nowrap; font-size:0.76rem;">${fmtTime(t.created_at)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="5" style="text-align:center; padding:0.9rem; color:#64748b;">아직 간식 교환 이력이 없습니다.</td></tr>';

        const visitsRows = visits.length ? visits.map((v) => {
            const isActive = v.status === 'active';
            const statusHtml = isActive
                ? '<span style="color:#059669; font-weight:800;">🌿 놀러가는 중</span>'
                : '<span style="color:#64748b;">🏡 귀가 완료</span>';
            const actionHtml = isActive
                ? `<button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="forceEndAdminVisit(${v.id})">🏡 집으로 부르기</button>`
                : (v.souvenir_claimed ? '<span style="font-size:0.75rem; color:#b45309;">🍬 답례 지급됨</span>' : '-');
            return `<tr>
                <td>${esc(v.guest_emoji || '🧒')} ${esc(v.guest_name || v.guest_child_id)} · <strong>${esc(v.guest_pokemon_name)}</strong></td>
                <td>${esc(v.host_emoji || '🏡')} ${esc(v.host_name || v.host_child_id)} 초원</td>
                <td style="max-width:160px; word-break:break-word;">${esc(v.greeting_msg || '-')}</td>
                <td>${statusHtml}</td>
                <td style="white-space:nowrap; font-size:0.76rem;">${fmtTime(v.created_at)}</td>
                <td>${actionHtml}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="6" style="text-align:center; padding:0.9rem; color:#64748b;">아직 포켓몬 방문 기록이 없습니다.</td></tr>';

        mount.innerHTML = `
            <div class="admin-card" style="margin-bottom:1rem; box-sizing:border-box; max-width:100%;">
                <div class="admin-card-header" style="flex-wrap:wrap; gap:0.5rem;">
                    <div>
                        <h3 style="margin:0;">🍎 보너스 간식 직접 지급 &amp; 교환·방문 실시간 로그</h3>
                        <p style="margin:0.2rem 0 0; font-size:0.78rem; color:#64748b;">
                            칭찬 보상으로 특정 아이에게 포켓몬 간식을 바로 지급하고, 아이 간 교환 및 초원 놀러가기 기록을 확인합니다.
                        </p>
                    </div>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="loadAdminStudyOps()">🔄 로그 새로고침</button>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.65rem; margin-top:0.7rem;">
                    ${snackSummaryCards}
                </div>

                <form onsubmit="grantAdminBonusSnack(event)" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.55rem; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:0.7rem; padding:0.8rem; margin-top:0.8rem; box-sizing:border-box;">
                    <div style="min-width:0;">
                        <label for="opsSnackChildSel" style="display:block; font-size:0.74rem; font-weight:700; color:#065f46; margin-bottom:0.2rem;">아이 선택</label>
                        <select id="opsSnackChildSel" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; background:#fff;">
                            ${kids.map((c) => `<option value="${esc(c.childId)}">${esc(c.avatarEmoji)} ${esc(c.displayName)}</option>`).join('')}
                        </select>
                    </div>
                    <div style="min-width:0;">
                        <label for="opsSnackTypeSel" style="display:block; font-size:0.74rem; font-weight:700; color:#065f46; margin-bottom:0.2rem;">간식 종류</label>
                        <select id="opsSnackTypeSel" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; background:#fff;">
                            ${catalog.map((s) => `<option value="${esc(s.id)}">${esc(s.emoji)} ${esc(s.name)} (+${s.exp} EXP)</option>`).join('')}
                        </select>
                    </div>
                    <div style="min-width:0;">
                        <label for="opsSnackQtyInput" style="display:block; font-size:0.74rem; font-weight:700; color:#065f46; margin-bottom:0.2rem;">수량 (1~20)</label>
                        <input id="opsSnackQtyInput" type="number" min="1" max="20" value="2" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem;">
                    </div>
                    <div style="display:flex; align-items:flex-end;">
                        <button type="submit" class="btn-admin btn-admin-primary" style="width:100%; min-height:40px;">🎁 보너스 간식 지급</button>
                    </div>
                </form>

                <h4 style="margin:0.95rem 0 0.4rem; font-size:0.88rem; color:#1e293b;">💌 최근 간식 교환 이력 (최대 25건)</h4>
                <div class="admin-table-container admin-table-scroll">
                    <table class="admin-table">
                        <thead><tr><th>교환</th><th>간식 내용</th><th>인사말·답장</th><th>상태</th><th>시각</th></tr></thead>
                        <tbody>${tradesRows}</tbody>
                    </table>
                </div>

                <h4 style="margin:0.95rem 0 0.4rem; font-size:0.88rem; color:#1e293b;">🐾 최근 포켓몬 방문 기록 (최대 25건)</h4>
                <div class="admin-table-container admin-table-scroll">
                    <table class="admin-table">
                        <thead><tr><th>방문 포켓몬</th><th>방문 초원</th><th>인사말</th><th>상태</th><th>시작 시각</th><th>관리</th></tr></thead>
                        <tbody>${visitsRows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderAiColorLogsPanel(data) {
        const mount = document.getElementById('studyOpsAiColorLogsMount');
        if (!mount) return;

        const logs = data.customColoringLogs || [];
        const stats = data.customColoringStats || { totalToday: 0, blockedToday: 0 };

        const rowsHtml = logs.length ? logs.map((l) => {
            const blockedBadge = l.blocked
                ? `<span style="color:#dc2626; font-weight:800;">🛡️ 차단·순화</span>`
                : '<span style="color:#059669; font-weight:700;">✅ 정상</span>';
            const srcBadge = String(l.source_label || '').includes('gemini')
                ? '<span style="color:#7c3aed; font-weight:700;">✨ Gemini AI</span>'
                : '<span style="color:#0369a1;">🎨 안전 도안</span>';
            return `<tr>
                <td>${esc(l.child_emoji || '🧒')} ${esc(l.child_name || l.child_id)}</td>
                <td style="max-width:160px; word-break:break-word;">${esc(l.raw_prompt)}</td>
                <td style="max-width:160px; word-break:break-word;">${esc(l.safe_prompt)}</td>
                <td>${srcBadge}</td>
                <td>${blockedBadge}${l.block_reason ? `<div style="font-size:0.72rem; color:#dc2626;">${esc(l.block_reason)}</div>` : ''}</td>
                <td style="white-space:nowrap; font-size:0.76rem;">${fmtTime(l.created_at)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="6" style="text-align:center; padding:0.9rem; color:#64748b;">아직 AI 자유 도안 생성 기록이 없습니다.</td></tr>';

        mount.innerHTML = `
            <div class="admin-card" style="box-sizing:border-box; max-width:100%;">
                <div class="admin-card-header" style="flex-wrap:wrap; gap:0.5rem;">
                    <div>
                        <h3 style="margin:0;">🪄 AI 자유 도안 생성 로그 &amp; 부적절 프롬프트 차단 내역</h3>
                        <p style="margin:0.2rem 0 0; font-size:0.78rem; color:#64748b;">
                            아이가 직접 요청한 자유 색칠 도안 프롬프트와 금칙어 자동 순화·차단 내역을 확인합니다.
                        </p>
                    </div>
                    <div style="display:flex; gap:0.45rem; align-items:center; flex-wrap:wrap;">
                        <span style="font-size:0.78rem; font-weight:800; padding:0.25rem 0.6rem; border-radius:999px; background:#f3e8ff; color:#6b21a8;">
                            오늘 요청 ${stats.totalToday}건 · 차단 ${stats.blockedToday}건
                        </span>
                        <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="loadAdminStudyOps()">🔄 로그 새로고침</button>
                    </div>
                </div>
                <div class="admin-table-container admin-table-scroll" style="margin-top:0.75rem;">
                    <table class="admin-table">
                        <thead><tr><th>아이</th><th>요청 내용</th><th>적용 도안</th><th>생성 경로</th><th>안전 검사</th><th>시각</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderAllOpsPanels(data) {
        lastOpsData = data;
        renderMissionOpsPanel(data);
        renderSnacksAndSocialPanel(data);
        renderAiColorLogsPanel(data);
    }

    async function loadAdminStudyOps() {
        const { ok, data } = await apiAdmin('/api/admin/study/ops');
        if (!ok) {
            toast(data.message || '학습실 운영 로그를 불러오지 못했습니다.', true);
            return null;
        }
        renderAllOpsPanels(data);
        return data;
    }

    async function saveAdminStudyFeatureFlags() {
        const body = {
            pokemonSocialEnabled: Boolean(document.getElementById('chkOpsPokemonSocial')?.checked),
            aiCustomColoringEnabled: Boolean(document.getElementById('chkOpsAiCustomColoring')?.checked),
            pianoVoiceEnabled: Boolean(document.getElementById('chkOpsPianoVoice')?.checked)
        };
        const { ok, data } = await apiAdmin('/api/admin/study/ops/flags', 'POST', body);
        toast(data.message || (ok ? '저장되었습니다.' : '저장 실패'), !ok);
        if (ok) renderAllOpsPanels(data);
    }

    function pickOpsMissionTheme(themeText) {
        const input = document.getElementById('opsMissionThemeInput');
        if (input) input.value = themeText || '';
    }

    async function saveAdminMissionTheme(event) {
        event.preventDefault();
        const body = {
            childId: document.getElementById('opsMissionChildSel')?.value || 'all',
            theme: document.getElementById('opsMissionThemeInput')?.value || '',
            slot1Subject: document.getElementById('opsMissionSlot1Sel')?.value || '',
            slot2Subject: document.getElementById('opsMissionSlot2Sel')?.value || '',
            slot3Subject: document.getElementById('opsMissionSlot3Sel')?.value || ''
        };
        const { ok, data } = await apiAdmin('/api/admin/study/ops/mission-theme', 'POST', body);
        toast(data.message || (ok ? '미션 테마를 적용했습니다.' : '적용 실패'), !ok);
        if (ok) {
            renderAllOpsPanels(data);
            if (typeof window.loadAdminStudyPhase3 === 'function') window.loadAdminStudyPhase3();
        }
    }

    async function grantAdminBonusSnack(event) {
        event.preventDefault();
        const body = {
            childId: document.getElementById('opsSnackChildSel')?.value || 'first',
            snackType: document.getElementById('opsSnackTypeSel')?.value || 'apple',
            qty: Number(document.getElementById('opsSnackQtyInput')?.value || 1)
        };
        const { ok, data } = await apiAdmin('/api/admin/study/ops/snacks/grant', 'POST', body);
        toast(data.message || (ok ? '지급 완료' : '지급 실패'), !ok);
        if (ok) renderAllOpsPanels(data);
    }

    async function forceEndAdminVisit(visitId) {
        const { ok, data } = await apiAdmin(`/api/admin/study/ops/visits/${visitId}/end`, 'POST');
        toast(data.message || '방문 종료됨', !ok);
        if (ok) renderAllOpsPanels(data);
    }

    async function loadAdminStudyMissionsTab() {
        await Promise.all([
            loadAdminStudyOps(),
            typeof window.loadAdminStudyPhase3 === 'function' ? window.loadAdminStudyPhase3() : Promise.resolve(),
            typeof window.loadAdminStudyGrowth === 'function' ? window.loadAdminStudyGrowth() : Promise.resolve()
        ]);
    }

    async function loadAdminStudyPlazaTab() {
        await Promise.all([
            typeof window.loadAdminStudyPlaza === 'function' ? window.loadAdminStudyPlaza() : Promise.resolve(),
            loadAdminStudyOps()
        ]);
    }

    async function loadAdminStudyCreativeTab() {
        await Promise.all([
            typeof window.loadAdminStudyArtworks === 'function' ? window.loadAdminStudyArtworks() : Promise.resolve(),
            loadAdminStudyOps()
        ]);
    }

    window.loadAdminStudyOps = loadAdminStudyOps;
    window.loadAdminStudyMissionsTab = loadAdminStudyMissionsTab;
    window.loadAdminStudyPlazaTab = loadAdminStudyPlazaTab;
    window.loadAdminStudyCreativeTab = loadAdminStudyCreativeTab;
    window.saveAdminStudyFeatureFlags = saveAdminStudyFeatureFlags;
    window.pickOpsMissionTheme = pickOpsMissionTheme;
    window.saveAdminMissionTheme = saveAdminMissionTheme;
    window.grantAdminBonusSnack = grantAdminBonusSnack;
    window.forceEndAdminVisit = forceEndAdminVisit;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (document.getElementById('studyOpsTogglesMount')) loadAdminStudyOps();
        }, 650);
    });
})();
