/**
 * ==============================================================================
 * 엄마·아빠 포켓몬 트레이너 전용 페이지 제어 스크립트 (study-parents.js)
 * ------------------------------------------------------------------------------
 * - 가족 광장 배경 테마 전환 + 공놀이/방울톡/응원 말풍선
 * - 엄마(mom)·아빠(dad) 포켓몬 파트너 교체·먹이주기·진화·가족 알 부화
 * - 아이들 학습 포인트 칭찬 선물 및 제출 쿠폰 확인·환불
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    let overview = null;
    let playApi = null;
    let toyMode = 'pet';
    const toastEl = document.getElementById('parentsToast');

    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function showToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.hidden = false;
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 3000);
    }

    async function apiJson(url, method = 'GET', body = null) {
        const opts = { method, credentials: 'include', headers: {} };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, data };
    }

    function renderPlazaStage() {
        const fp = overview?.familyPlaza || {};
        const themes = fp.themes || window.PokemonMeadowThemes?.THEME_CATALOG || [];
        const activeTheme = fp.plazaTheme || 'park';
        const themeMeta = themes.find((t) => t.id === activeTheme) || { emoji: '⛲', label: '햇살 분수 공원' };

        const labelEl = document.getElementById('parentsPlazaThemeLabel');
        if (labelEl) labelEl.textContent = `${themeMeta.emoji} ${themeMeta.label}`;

        const pillsEl = document.getElementById('parentsThemePills');
        if (pillsEl) {
            pillsEl.innerHTML = themes.map((t) => `<button type="button" class="plaza-theme-btn" data-theme-id="${esc(t.id)}" aria-pressed="${t.id === activeTheme}">${t.emoji} ${esc(t.label)}</button>`).join('');
            pillsEl.querySelectorAll('[data-theme-id]').forEach((btn) => btn.addEventListener('click', async () => {
                window.StudyFx?.tap?.();
                const res = await apiJson('/api/study/plaza/theme', 'POST', { theme: btn.dataset.themeId });
                if (!res.ok) { showToast(res.data?.message || '배경 변경 실패'); return; }
                overview.familyPlaza = res.data.familyPlaza;
                showToast(res.data.message);
                renderPlazaStage();
            }));
        }

        const stageEl = document.getElementById('parentsPlazaStage');
        if (!stageEl || !window.PokemonMeadow) return;
        const actors = (fp.members || []).map((m) => ({
            id: m.pokemonId, ownerId: m.ownerId, nameKo: m.nameKo, label: m.label,
            isPartner: m.ownerType === 'parent', isGuest: m.ownerType === 'kid',
            animatedUrl: m.animatedUrl, artworkUrl: m.artworkUrl,
            cheers: [m.latestSpeech || `${m.ownerName}와(과) 함께 놀아요! ✨`]
        }));
        const ctrl = window.PokemonMeadow.mount(stageEl, {
            buddies: actors, spacious: true, theme: activeTheme,
            title: `👨‍👩‍👧‍👦 우리 가족 광장 · ${themeMeta.emoji} ${themeMeta.label}`,
            footerHint: '엄마·아빠·아이 포켓몬이 모두 함께 뛰어노는 공간이에요!'
        });
        playApi = window.PokemonMeadowPlay?.attach?.(ctrl, {
            showGiftChest: false,
            onModeChange: (next) => {
                toyMode = next;
                document.querySelectorAll('[data-parent-toy]').forEach((b) => b.classList.toggle('is-active', b.dataset.parentToy === toyMode));
            }
        }) || null;
        playApi?.setMode?.(toyMode);
    }

    function renderTrainers() {
        const grid = document.getElementById('parentsTrainersGrid');
        if (!grid) return;
        const trainers = overview?.parentTrainers || [];
        grid.innerHTML = trainers.map((tr) => {
            const p = tr.partnerPokemon;
            const canAdopt = Number(tr.careProgress || 0) >= 3;
            const isMom = tr.id === 'mom';
            return `<article class="trainer-house-card ${isMom ? 'trainer-house-card--mom' : 'trainer-house-card--dad'}">
                <div class="trainer-house-hero">
                    <img src="${esc(p.artworkUrl || p.animatedUrl)}" alt="${esc(p.nameKo)}">
                    <div style="flex:1; min-width:150px;">
                        <span class="level-badge" style="display:inline-block; margin-bottom:4px;">${esc(tr.avatarEmoji)} ${esc(tr.roleLabel)}</span>
                        <h2 style="margin:0; font-size:1.25rem; color:#0f172a;">${esc(p.nameKo)} <small style="font-size:0.85rem; color:#be185d;">Lv.${p.level}</small></h2>
                        <p style="margin:4px 0 0; font-size:0.84rem; color:#475569; font-weight:700;">
                            가족 돌봄 게이지: <strong>${tr.careProgress}/3</strong>
                            ${p.evolution ? ` · 진화(${esc(p.evolution.nextNameKo)}) ${p.exp}/${p.evolution.needExp}` : ''}
                        </p>
                    </div>
                </div>
                <div class="trainer-house-actions">
                    ${canAdopt ? `<button type="button" class="study-btn study-btn-primary btn-tr-adopt" data-trainer="${tr.id}">🥚 새 가족 알 열기!</button>` : ''}
                    ${p.evolution?.canEvolve ? `<button type="button" class="study-btn study-btn-primary btn-tr-evolve" data-trainer="${tr.id}" data-poke="${p.id}">✨ ${esc(p.evolution.nextNameKo)} 진화!</button>` : ''}
                    <button type="button" class="study-btn study-btn-outline btn-tr-cheer" data-trainer="${tr.id}" data-react="${isMom ? 'love' : 'clap'}">${isMom ? '❤️ 사랑해 말풍선' : '👏 최고야 말풍선'}</button>
                    <button type="button" class="study-btn study-btn-outline btn-tr-cheer" data-trainer="${tr.id}" data-react="snack">🍎 간식먹자 말풍선</button>
                </div>
                <div>
                    <div style="font-size:0.82rem; font-weight:800; color:#334155; margin-bottom:6px;">🍎 간식 주기 (친밀도 UP · 돌봄 +1)</div>
                    <div class="trainer-house-snacks">
                        ${(tr.snacks || []).map((sn) => `<button type="button" class="meadow-snack-chip btn-tr-feed ${sn.qty <= 0 ? 'is-empty' : ''}" data-trainer="${tr.id}" data-poke="${p.id}" data-snack="${sn.id}" ${sn.qty <= 0 ? 'disabled' : ''}><span>${sn.emoji}</span><span>${esc(sn.name)} ×${sn.qty}</span></button>`).join('')}
                    </div>
                </div>
                <div>
                    <div style="font-size:0.82rem; font-weight:800; color:#334155; margin-bottom:4px;">🐾 ${esc(tr.displayName)}의 도감 (터치해서 단짝 바꾸기)</div>
                    <div class="parent-dex-strip">
                        ${(tr.collected || []).map((c) => `<button type="button" class="parent-dex-chip btn-tr-pick ${c.isPartner ? 'is-partner' : ''}" data-trainer="${tr.id}" data-poke="${c.id}">
                            <img src="${esc(c.animatedUrl || c.artworkUrl)}" alt="${esc(c.nameKo)}"><span>${esc(c.nameKo)}</span>
                        </button>`).join('')}
                    </div>
                </div>
            </article>`;
        }).join('');

        grid.querySelectorAll('.btn-tr-feed').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/feed', 'POST', { trainerId: b.dataset.trainer, pokemonId: b.dataset.poke, snackType: b.dataset.snack });
            showToast(res.data?.message || '먹이를 주었어요!');
            if (res.ok) { window.StudyFx?.correct?.(); await loadOverview(); }
        }));
        grid.querySelectorAll('.btn-tr-adopt').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/adopt', 'POST', { trainerId: b.dataset.trainer });
            showToast(res.data?.message || '새 가족 포켓몬!');
            if (res.ok) { window.StudyFx?.fanfare?.(); window.StudyFx?.celebrate?.(); await loadOverview(); }
        }));
        grid.querySelectorAll('.btn-tr-evolve').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/evolve', 'POST', { trainerId: b.dataset.trainer, pokemonId: b.dataset.poke });
            showToast(res.data?.message || '진화!');
            if (res.ok) { window.StudyFx?.fanfare?.(); window.StudyFx?.celebrate?.({ big: true }); await loadOverview(); }
        }));
        grid.querySelectorAll('.btn-tr-pick').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/partner', 'POST', { trainerId: b.dataset.trainer, pokemonId: b.dataset.poke });
            showToast(res.data?.message || '단짝 변경!');
            if (res.ok) { window.StudyFx?.tap?.(); await loadOverview(); }
        }));
        grid.querySelectorAll('.btn-tr-cheer').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/plaza/reaction', 'POST', { senderId: b.dataset.trainer, reactionId: b.dataset.react });
            showToast(res.data?.message || '광장에 응원 말풍선을 띄웠어요!');
            if (res.ok) { window.StudyFx?.tap?.(); overview.familyPlaza = res.data.familyPlaza; renderPlazaStage(); }
        }));
    }

    function askPinIfKid() {
        if (overview?.viewerRole !== 'kid') return '';
        return window.prompt('어른(부모) 확인 PIN이 있다면 입력해 주세요 (미설정 시 빈칸):', '') || '';
    }

    function renderKidsAndCoupons() {
        const kGrid = document.getElementById('parentsChildrenPointsGrid');
        const cGrid = document.getElementById('parentsCouponRequestsGrid');
        if (kGrid) {
            kGrid.innerHTML = (overview?.children || []).map((c) => `<article class="parents-kid-card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${esc(c.avatarEmoji)} ${esc(c.displayName)}</strong>
                    <span class="plaza-points-badge">⭐ ${Number(c.points || 0)}P</span>
                </div>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="study-btn study-btn-outline btn-kid-bonus" data-child="${esc(c.childId)}" data-delta="20" style="flex:1; min-height:38px;">+20P 칭찬</button>
                    <button type="button" class="study-btn study-btn-primary btn-kid-bonus" data-child="${esc(c.childId)}" data-delta="50" style="flex:1; min-height:38px;">+50P 보너스</button>
                </div>
            </article>`).join('');
            kGrid.querySelectorAll('.btn-kid-bonus').forEach((b) => b.addEventListener('click', async () => {
                const res = await apiJson('/api/study/parents/grant-points', 'POST', {
                    childId: b.dataset.child, delta: Number(b.dataset.delta), parentPin: askPinIfKid()
                });
                showToast(res.data?.message || '포인트 반영!');
                if (res.ok) { window.StudyFx?.celebrate?.(); await loadOverview(); }
            }));
        }

        if (cGrid) {
            const list = (overview?.purchases || []).slice(0, 12);
            cGrid.innerHTML = list.length ? list.map((p) => {
                const cls = p.status === 'requested' ? 'is-requested' : (p.status === 'approved' ? 'is-approved' : (p.status === 'owned' ? 'is-owned' : ''));
                const label = p.status === 'requested' ? '⏳ 아이가 제출함! 확인 대기 중'
                    : (p.status === 'approved' ? `✅ 선물 사용 완료 (${esc(p.resolved_by || '부모님')})`
                        : (p.status === 'owned' ? '🎫 아이가 보관 중' : '↩️ 환불 완료'));
                return `<article class="shop-coupon-card ${cls}">
                    <div>
                        <h3 class="shop-coupon-title">${esc(p.avatar_emoji || '🧒')} ${esc(p.display_name || p.child_id)} · ${esc(p.coupon_emoji)} ${esc(p.coupon_title)}</h3>
                        <p class="shop-coupon-desc">${p.cost_points}P · ${label}</p>
                    </div>
                    ${p.status === 'requested' || p.status === 'owned' ? `<div style="display:flex; gap:6px;">
                        <button type="button" class="study-btn study-btn-primary btn-parent-resolve" data-id="${p.id}" data-action="approve" style="flex:1; min-height:40px;">✅ 선물 확인 완료</button>
                        <button type="button" class="study-btn study-btn-outline btn-parent-resolve" data-id="${p.id}" data-action="refund" style="flex:1; min-height:40px;">↩️ 환불</button>
                    </div>` : ''}
                </article>`;
            }).join('') : '<p style="margin:0; color:#64748b; font-weight:700;">아직 아이들이 교환한 보상 쿠폰이 없어요.</p>';
            cGrid.querySelectorAll('.btn-parent-resolve').forEach((b) => b.addEventListener('click', async () => {
                const res = await apiJson('/api/study/shop/resolve', 'POST', {
                    purchaseId: b.dataset.id, action: b.dataset.action, parentPin: askPinIfKid()
                });
                showToast(res.data?.message || '처리했어요.');
                if (res.ok) { window.StudyFx?.celebrate?.(); await loadOverview(); }
            }));
        }
    }

    async function loadOverview() {
        const res = await fetch('/api/study/parents/overview', { credentials: 'include' });
        if (res.status === 403) {
            window.location.replace('/study');
            return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) { showToast(data.message || '정보를 불러오지 못했어요.'); return; }
        overview = data;
        const backPortal = document.getElementById('parentsPortalBackLink');
        if (backPortal) backPortal.hidden = data.viewerRole === 'kid';
        renderPlazaStage();
        renderTrainers();
        renderKidsAndCoupons();
    }

    document.getElementById('btnParentsRefresh')?.addEventListener('click', () => {
        window.StudyFx?.tap?.();
        loadOverview();
    });
    document.querySelectorAll('[data-parent-toy]').forEach((btn) => btn.addEventListener('click', () => {
        toyMode = btn.dataset.parentToy || 'pet';
        window.StudyFx?.tap?.();
        document.querySelectorAll('[data-parent-toy]').forEach((b) => b.classList.toggle('is-active', b === btn));
        playApi?.setMode?.(toyMode);
    }));

    loadOverview();
})();
