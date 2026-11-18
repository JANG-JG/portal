/**
 * ==============================================================================
 * 가족 포켓몬 광장 · 포인트 & 쿠폰 상점 · 엄마아빠 포켓몬 프론트엔드 모듈
 * (study-plaza-shop.js)
 * ------------------------------------------------------------------------------
 * - [🏡 내 초원 | 👨‍👩‍👧‍👦 우리 가족 광장] 1탭 전환 + 키보드 없는 그림 말풍선 소통
 * - 공부 포인트 적립 조회 + 수학 빼기 놀이 연동 보상 쿠폰 상점 & 엄마·아빠 제출함
 * - 엄마·아빠(mom/dad) 포켓몬 트레이너 키우기·간식주기·진화·알 열기
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 6] 터치/모바일 최적화
 * ==============================================================================
 */
(function () {
    'use strict';

    const plazaState = {
        childId: 'first',
        childProfile: null,
        pokemonData: null,
        meadowMode: 'personal', // 'personal' | 'plaza'
        shopTab: 'shop', // 'shop' | 'wallet' | 'ledger'
        activeTrainerId: 'mom',
        data: null,
        meadowCtrl: null,
        parentUnlocked: false,
        parentPin: '',
        isMotionPaused: () => false,
        showToast: null,
        onRefreshAll: null,
        onRemountMeadow: null
    };

    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const toast = (msg) => { if (typeof plazaState.showToast === 'function') plazaState.showToast(msg); };

    async function apiJson(url, method = 'GET', body = null) {
        const opts = { method, credentials: 'include', headers: {} };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, data };
    }

    function setupDialogFallback(dlg) {
        if (!dlg || dlg._plazaBound) return;
        dlg._plazaBound = true;
        dlg.addEventListener('close', () => { dlg.returnValue = ''; });
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const out = (e) => {
                const r = dlg.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            let downOut = false;
            dlg.addEventListener('pointerdown', (e) => { downOut = out(e); });
            dlg.addEventListener('pointerup', (e) => { if (downOut && out(e)) dlg.close(); });
        }
    }

    function openDialog(id) {
        const dlg = document.getElementById(id);
        if (!dlg) return null;
        setupDialogFallback(dlg);
        if (!dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
        return dlg;
    }

    function getPlazaMeadowActors() {
        const members = plazaState.data?.familyPlaza?.members || [];
        return members.map((m) => ({
            id: m.pokemonId,
            ownerId: m.ownerId,
            nameKo: m.nameKo,
            label: m.label,
            isPartner: Boolean(m.isPartner),
            isGuest: Boolean(m.isParent),
            animatedUrl: m.animatedUrl,
            artworkUrl: m.artworkUrl,
            cheers: [m.latestSpeech || `${m.ownerName}와(과) 가족 광장에서 놀아요! ✨`, `${m.nameKo}: 같이 놀자! 🐾`]
        }));
    }

    function mountCurrentMeadow(personalFallbackFn) {
        const stage = document.getElementById('pokemonMeadowStage');
        if (!stage || !window.PokemonMeadow) return null;

        if (plazaState.meadowMode === 'plaza' && plazaState.data?.config?.plazaEnabled !== false) {
            const actors = getPlazaMeadowActors();
            const ctrl = window.PokemonMeadow.mount(stage, {
                buddies: actors,
                spacious: true,
                paused: plazaState.isMotionPaused(),
                title: '👨‍👩‍👧‍👦 우리 가족 포켓몬 광장',
                emptyText: '가족 포켓몬 친구들이 모이고 있어요!',
                footerHint: '우리 가족 포켓몬이 한곳에 모였어요! 아래 인사 버튼을 눌러 말풍선을 띄워 보세요 ✨'
            });
            window.StudyPokemonSocial?.attachMeadowPlay?.(ctrl);
            plazaState.meadowCtrl = ctrl;
            return ctrl;
        }
        const ctrl = typeof personalFallbackFn === 'function' ? personalFallbackFn() : null;
        plazaState.meadowCtrl = ctrl;
        return ctrl;
    }

    function renderModeAndBar() {
        const modeMount = document.getElementById('plazaModeMount');
        const barMount = document.getElementById('plazaRewardsBarMount');
        const reactMount = document.getElementById('plazaReactionMount');
        const cfg = plazaState.data?.config || { plazaEnabled: true, couponShopEnabled: true, parentPokemonEnabled: true };
        const shop = plazaState.data?.shopState || { points: 0, ownedCount: 0, requestedCount: 0 };

        if (modeMount) {
            modeMount.hidden = !cfg.plazaEnabled;
            if (cfg.plazaEnabled) {
                const isPlaza = plazaState.meadowMode === 'plaza';
                modeMount.innerHTML = `
                    <div class="plaza-mode-strip">
                        <div class="plaza-seg-group" role="group" aria-label="초원 공간 선택">
                            <button type="button" class="plaza-seg-btn" data-meadow-mode="personal" aria-pressed="${!isPlaza}">🏡 내 초원</button>
                            <button type="button" class="plaza-seg-btn" data-meadow-mode="plaza" aria-pressed="${isPlaza}">👨‍👩‍👧‍👦 우리 가족 광장</button>
                        </div>
                        <span class="plaza-points-badge" title="공부해서 모은 내 포인트">⭐ ${esc(shop.points)}P</span>
                    </div>`;
                modeMount.querySelectorAll('[data-meadow-mode]').forEach((btn) => btn.addEventListener('click', () => {
                    const next = btn.dataset.meadowMode || 'personal';
                    if (plazaState.meadowMode === next) return;
                    plazaState.meadowMode = next;
                    window.StudyFx?.tap?.();
                    renderModeAndBar();
                    if (typeof plazaState.onRemountMeadow === 'function') plazaState.onRemountMeadow();
                }));
            }
        }

        if (reactMount) {
            const showReact = cfg.plazaEnabled && plazaState.meadowMode === 'plaza';
            reactMount.hidden = !showReact;
            if (showReact) {
                const presets = plazaState.data?.familyPlaza?.presets || [];
                const feed = (plazaState.data?.familyPlaza?.reactions || []).slice(0, 4);
                reactMount.innerHTML = `
                    <div class="plaza-reaction-bar" role="region" aria-label="광장 인사 말풍선">
                        <div class="plaza-reaction-head">
                            <span>💬 그림 인사 버튼 (타자 없이 톡 눌러 말해요!)</span>
                            <span>${esc(plazaState.childProfile?.display_name || '나')} 이름으로 인사하기</span>
                        </div>
                        <div class="plaza-reaction-pills">
                            ${presets.map((p) => `<button type="button" class="plaza-react-btn" data-react-id="${esc(p.id)}"><span>${p.sticker}</span><span>${esc(p.label)}</span></button>`).join('')}
                        </div>
                        ${feed.length ? `<div class="plaza-recent-feed">${feed.map((r) => `<span class="plaza-recent-chip">${esc(r.sender_emoji)} <strong>${esc(r.sender_name)}</strong>: ${esc(r.sticker)} ${esc(r.speech_text.replace(r.sticker, '').trim())}</span>`).join('')}</div>` : ''}
                    </div>`;
                reactMount.querySelectorAll('[data-react-id]').forEach((btn) => btn.addEventListener('click', async () => {
                    await sendReaction(plazaState.childId, btn.dataset.reactId);
                }));
            }
        }

        if (barMount) {
            barMount.hidden = !cfg.couponShopEnabled && !cfg.parentPokemonEnabled;
            const dotCnt = Number(shop.ownedCount || 0) + Number(shop.requestedCount || 0);
            barMount.innerHTML = `
                <div class="plaza-action-row">
                    ${cfg.couponShopEnabled ? `<button type="button" id="btnOpenCouponShop" class="plaza-action-btn plaza-action-btn--shop">
                        <span>🎁 포인트 · 쿠폰 상점</span>
                        ${dotCnt > 0 ? `<span class="plaza-pill-dot">${dotCnt}</span>` : ''}
                    </button>` : ''}
                    ${cfg.parentPokemonEnabled ? `<button type="button" id="btnOpenParentTrainers" class="plaza-action-btn plaza-action-btn--parents">
                        <span>👩‍👦 엄마·아빠 포켓몬 놀이터</span>
                    </button>` : ''}
                </div>`;
            barMount.querySelector('#btnOpenCouponShop')?.addEventListener('click', () => {
                window.StudyFx?.tap?.();
                openDialog('plazaShopDialog');
                renderShopModal();
            });
            barMount.querySelector('#btnOpenParentTrainers')?.addEventListener('click', () => {
                window.StudyFx?.tap?.();
                openDialog('parentPokemonDialog');
                renderParentTrainerModal();
            });
        }
    }

    async function sendReaction(senderId, reactionId) {
        window.StudyFx?.tap?.();
        const { ok, data } = await apiJson('/api/study/plaza/reaction', 'POST', { senderId, reactionId });
        if (!ok) { toast(data.message || '말풍선을 보내지 못했어요.'); return; }
        if (plazaState.data) plazaState.data.familyPlaza = data.familyPlaza;
        toast(data.message || '가족 광장에 인사를 보냈어요! 💬');
        renderModeAndBar();

        if (plazaState.meadowMode === 'plaza' && plazaState.meadowCtrl) {
            const target = (plazaState.meadowCtrl.actors || []).find((a) => a.buddy?.ownerId === senderId);
            const latest = (data.familyPlaza?.reactions || [])[0];
            if (target && latest) {
                plazaState.meadowCtrl.celebrateActor?.(target);
                plazaState.meadowCtrl.showBubble?.(target, latest.speech_text, 3.2);
            }
        }
    }

    async function openBuyQuizStep(couponId) {
        const body = document.getElementById('plazaShopBody');
        if (!body) return;
        const { ok, data } = await apiJson(`/api/study/shop/quiz?childId=${encodeURIComponent(plazaState.childId)}&couponId=${couponId}`);
        if (!ok || !data.quiz) { toast(data.message || '쿠폰을 확인하지 못했어요.'); return; }
        const q = data.quiz;
        let picked = '';
        body.innerHTML = `
            <div style="background:#fefce8; border:2px solid #fde047; border-radius:16px; padding:14px;">
                <p style="margin:0 0 6px; font-weight:900; color:#92400e;">🧮 포인트 계산하고 쿠폰 사기!</p>
                <p style="margin:0 0 10px; font-weight:800; color:#0f172a;">${esc(q.prompt)}</p>
                <div style="font-size:1.35rem; font-weight:900; text-align:center; padding:10px; background:#ffffff; border-radius:12px; border:1px solid #fde68a; margin-bottom:10px;">
                    ${esc(q.visual)}
                </div>
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;" role="group" aria-label="정답 선택">
                    ${q.choices.map((c) => `<button type="button" class="trade-quiz-choice-btn shop-quiz-ans" data-ans="${esc(c)}">${esc(c)}</button>`).join('')}
                </div>
                <p id="shopQuizHint" style="margin:10px 0 6px; font-size:0.84rem; font-weight:700; color:#b45309;">${esc(q.hint)}</p>
                <div style="display:flex; gap:8px; margin-top:10px;">
                    <button type="button" id="btnQuizBackShop" class="study-btn study-btn-outline" style="flex:1;">⬅️ 돌아가기</button>
                    <button type="button" id="btnQuizBuyConfirm" class="study-btn study-btn-primary" style="flex:2;" disabled>🎁 정답 맞히고 사기!</button>
                </div>
            </div>`;
        body.querySelectorAll('.shop-quiz-ans').forEach((b) => b.addEventListener('click', () => {
            picked = b.dataset.ans || '';
            window.StudyFx?.tap?.();
            body.querySelectorAll('.shop-quiz-ans').forEach((x) => x.classList.toggle('active', x === b));
            const cf = body.querySelector('#btnQuizBuyConfirm');
            if (cf) cf.disabled = false;
        }));
        body.querySelector('#btnQuizBackShop')?.addEventListener('click', () => renderShopModal());
        body.querySelector('#btnQuizBuyConfirm')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/shop/buy', 'POST', { childId: plazaState.childId, couponId, mathAnswer: picked });
            if (!res.ok) {
                window.StudyFx?.retry?.();
                const hintEl = body.querySelector('#shopQuizHint');
                if (hintEl) hintEl.textContent = res.data?.message || '다시 한번 세어볼까요?';
                return;
            }
            window.StudyFx?.celebrate?.({ big: true });
            window.StudyFx?.fanfare?.();
            toast(res.data.message);
            if (plazaState.data) plazaState.data.shopState = res.data.shopState;
            plazaState.shopTab = 'wallet';
            renderModeAndBar();
            renderShopModal();
        });
    }

    function renderShopModal() {
        const body = document.getElementById('plazaShopBody');
        if (!body || !plazaState.data) return;
        const s = plazaState.data.shopState || { points: 0, coupons: [], purchases: [], ledger: [] };
        const pts = Number(s.points || 0);
        const tab = plazaState.shopTab;
        const tabsHtml = `
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
                <span class="plaza-points-badge">⭐ 내 포인트: ${pts}P</span>
                <div class="plaza-seg-group" role="tablist" aria-label="상점 메뉴">
                    <button type="button" role="tab" class="plaza-seg-btn" data-shop-tab="shop" aria-selected="${tab === 'shop'}">🛒 쿠폰 사기</button>
                    <button type="button" role="tab" class="plaza-seg-btn" data-shop-tab="wallet" aria-selected="${tab === 'wallet'}">🎫 내 쿠폰함 (${(s.ownedCount || 0) + (s.requestedCount || 0)})</button>
                    <button type="button" role="tab" class="plaza-seg-btn" data-shop-tab="ledger" aria-selected="${tab === 'ledger'}">📜 내역</button>
                </div>
            </div>`;

        let panelHtml = '';
        if (tab === 'shop') {
            panelHtml = `<div class="shop-coupon-grid">${(s.coupons || []).map((c) => {
                const cost = Number(c.cost_points || 100);
                const canBuy = pts >= cost;
                const pct = Math.min(100, Math.round((pts / cost) * 100));
                const need = Math.max(0, cost - pts);
                return `<article class="shop-coupon-card">
                    <div>
                        <h3 class="shop-coupon-title">${esc(c.emoji)} ${esc(c.title)}</h3>
                        <p class="shop-coupon-desc">${esc(c.description || '')}</p>
                    </div>
                    <div>
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:800; color:#92400e; margin-bottom:4px;">
                            <span>필요 포인트: ${cost}P</span>
                            <span>${canBuy ? `남는 포인트: ${pts - cost}P` : `${need}P 더 필요!`}</span>
                        </div>
                        <div class="shop-progress-track"><div class="shop-progress-fill" style="width:${pct}%;"></div></div>
                    </div>
                    <button type="button" class="study-btn ${canBuy ? 'study-btn-primary' : 'study-btn-outline'} btn-shop-buy" data-coupon-id="${c.id}" ${canBuy ? '' : 'disabled'} style="width:100%;">
                        ${canBuy ? `🛍️ ${cost}P로 쿠폰 사기!` : `📚 공부 ${Math.ceil(need / 40)}번 더하면 살 수 있어요`}
                    </button>
                </article>`;
            }).join('')}</div>`;
        } else if (tab === 'wallet') {
            const list = s.purchases || [];
            panelHtml = list.length === 0
                ? '<p style="text-align:center; padding:24px 8px; color:#64748b; font-weight:700;">아직 산 쿠폰이 없어요! 공부해서 모은 포인트로 쿠폰을 골라 보세요 🎁</p>'
                : `<div class="shop-coupon-grid">${list.map((p) => {
                    const cls = p.status === 'requested' ? 'is-requested' : (p.status === 'approved' ? 'is-approved' : (p.status === 'owned' ? 'is-owned' : ''));
                    const statusLabel = p.status === 'owned' ? '🎫 사용 전 (엄마·아빠께 내기 가능!)'
                        : (p.status === 'requested' ? '⏳ 엄마·아빠께 제출됨! 확인 기다리는 중'
                            : (p.status === 'approved' ? `✅ 선물 사용 완료! (${esc(p.resolved_by || '부모님')})` : '↩️ 취소·환불됨'));
                    return `<article class="shop-coupon-card ${cls}">
                        <div>
                            <h3 class="shop-coupon-title">${esc(p.coupon_emoji)} ${esc(p.coupon_title)}</h3>
                            <p class="shop-coupon-desc">${statusLabel}</p>
                        </div>
                        ${p.status === 'owned' ? `<button type="button" class="study-btn study-btn-primary btn-use-coupon" data-purchase-id="${p.id}" style="width:100%;">🙋 엄마·아빠께 쿠폰 내기!</button>` : ''}
                        ${p.status === 'requested' ? `<div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button type="button" class="study-btn study-btn-primary btn-resolve-coupon" data-purchase-id="${p.id}" data-action="approve" style="flex:1;">✅ 부모 확인 완료</button>
                            <button type="button" class="study-btn study-btn-outline btn-resolve-coupon" data-purchase-id="${p.id}" data-action="refund" style="flex:1;">↩️ 돌려주기</button>
                        </div>` : ''}
                    </article>`;
                }).join('')}</div>`;
        } else {
            const logs = s.ledger || [];
            panelHtml = logs.length === 0
                ? '<p style="text-align:center; padding:24px 8px; color:#64748b; font-weight:700;">아직 포인트 내역이 없어요! 오늘의 학습지 1장을 풀어볼까요? ⭐</p>'
                : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px;">${logs.map((l) => `
                    <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0; font-size:0.85rem; font-weight:700;">
                        <span>${esc(l.reason)}</span>
                        <span style="color:${Number(l.delta) >= 0 ? '#047857' : '#b45309'}; font-weight:900;">${Number(l.delta) >= 0 ? `+${l.delta}` : l.delta}P</span>
                    </li>`).join('')}</ul>`;
        }

        body.innerHTML = tabsHtml + panelHtml;
        body.querySelectorAll('[data-shop-tab]').forEach((b) => b.addEventListener('click', () => {
            plazaState.shopTab = b.dataset.shopTab || 'shop';
            window.StudyFx?.tap?.();
            renderShopModal();
        }));
        body.querySelectorAll('.btn-shop-buy').forEach((b) => b.addEventListener('click', () => {
            window.StudyFx?.tap?.();
            openBuyQuizStep(b.dataset.couponId);
        }));
        body.querySelectorAll('.btn-use-coupon').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/shop/use', 'POST', { childId: plazaState.childId, purchaseId: b.dataset.purchaseId });
            toast(res.data?.message || '엄마·아빠께 보냈어요!');
            if (res.ok) {
                window.StudyFx?.giftOpen?.();
                plazaState.data.shopState = res.data.shopState;
                renderModeAndBar();
                renderShopModal();
            }
        }));
        body.querySelectorAll('.btn-resolve-coupon').forEach((b) => b.addEventListener('click', async () => {
            let pin = plazaState.parentPin || '';
            if (!plazaState.parentUnlocked) {
                pin = window.prompt('어른(엄마·아빠) PIN 번호가 있으면 입력해 주세요 (미설정 시 빈칸 확인):', '') || '';
            }
            const res = await apiJson('/api/study/shop/resolve', 'POST', {
                childId: plazaState.childId, purchaseId: b.dataset.purchaseId, action: b.dataset.action, parentPin: pin
            });
            toast(res.data?.message || '처리했어요.');
            if (res.ok) {
                window.StudyFx?.celebrate?.();
                plazaState.data.shopState = res.data.shopState;
                plazaState.data.parentTrainers = res.data.parentTrainers;
                renderModeAndBar();
                renderShopModal();
            }
        }));
    }

    function renderParentTrainerModal() {
        const body = document.getElementById('parentPokemonBody');
        if (!body || !plazaState.data) return;
        const trainers = plazaState.data.parentTrainers || [];
        const tr = trainers.find((t) => t.id === plazaState.activeTrainerId) || trainers[0];
        if (!tr) { body.innerHTML = '<p>엄마·아빠 트레이너 정보를 불러오는 중이에요...</p>'; return; }
        const partner = tr.partnerPokemon;
        const snacks = tr.snacks || [];
        const canAdopt = Number(tr.careProgress || 0) >= 3;

        body.innerHTML = `
            <div class="plaza-seg-group" role="tablist" aria-label="엄마 또는 아빠 선택" style="margin-bottom:10px;">
                ${trainers.map((t) => `<button type="button" role="tab" class="plaza-seg-btn" data-trainer-id="${esc(t.id)}" aria-selected="${t.id === tr.id}">${esc(t.avatarEmoji)} ${esc(t.displayName)} 포켓몬</button>`).join('')}
            </div>
            <div class="parent-trainer-hero">
                <img src="${esc(partner.artworkUrl || partner.animatedUrl)}" alt="${esc(partner.nameKo)}">
                <div style="flex:1; min-width:170px;">
                    <span style="font-size:0.78rem; font-weight:900; color:#be185d;">${esc(tr.roleLabel)} · ❤️ 친밀도 Lv.${partner.level}</span>
                    <h3 style="margin:2px 0 4px; font-size:1.15rem;">${esc(partner.nameKo)}</h3>
                    <p style="margin:0; font-size:0.82rem; color:#475569; font-weight:700;">
                        가족 돌봄 게이지: <strong>${tr.careProgress}/3</strong> ${partner.evolution ? `· 진화까지 ${partner.exp}/${partner.evolution.needExp}` : ''}
                    </p>
                    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                        ${canAdopt ? `<button type="button" id="btnParentAdoptEgg" class="study-btn study-btn-primary" style="min-height:38px;">🥚 새 가족 알 열기!</button>` : ''}
                        ${partner.evolution?.canEvolve ? `<button type="button" id="btnParentEvolve" class="study-btn study-btn-primary" style="min-height:38px;">✨ ${esc(partner.evolution.nextNameKo)} 진화!</button>` : ''}
                        <button type="button" id="btnParentPlazaCheer" class="study-btn study-btn-outline" style="min-height:38px;">💬 가족 광장에 응원 말풍선</button>
                    </div>
                </div>
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:10px; margin-bottom:10px;">
                <p style="margin:0 0 6px; font-size:0.84rem; font-weight:800; color:#334155;">🍎 엄마·아빠 포켓몬 간식 주기 (아이 쿠폰 확인 시 간식이 늘어나요!)</p>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${snacks.map((sn) => `<button type="button" class="meadow-snack-chip btn-parent-feed ${sn.qty <= 0 ? 'is-empty' : ''}" data-snack-id="${esc(sn.id)}" ${sn.qty <= 0 ? 'disabled' : ''}><span>${sn.emoji}</span><span>${esc(sn.name)} ×${sn.qty}</span></button>`).join('')}
                </div>
            </div>
            <div>
                <p style="margin:0 0 4px; font-size:0.84rem; font-weight:800; color:#334155;">🐾 ${esc(tr.displayName)}의 포켓몬 도감 (눌러서 광장 대표 단짝 바꾸기)</p>
                <div class="parent-dex-strip">
                    ${(tr.collected || []).map((c) => `<button type="button" class="parent-dex-chip ${c.isPartner ? 'is-partner' : ''}" data-parent-poke-id="${c.id}">
                        <img src="${esc(c.animatedUrl || c.artworkUrl)}" alt="${esc(c.nameKo)}">
                        <span>${esc(c.nameKo)}</span>
                    </button>`).join('')}
                </div>
            </div>`;

        body.querySelectorAll('[data-trainer-id]').forEach((b) => b.addEventListener('click', () => {
            plazaState.activeTrainerId = b.dataset.trainerId || 'mom';
            window.StudyFx?.tap?.();
            renderParentTrainerModal();
        }));
        body.querySelectorAll('.btn-parent-feed').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/feed', 'POST', { trainerId: tr.id, pokemonId: partner.id, snackType: b.dataset.snackId });
            toast(res.data?.message || '맛있게 먹었어요!');
            if (res.ok) { window.StudyFx?.correct?.(); plazaState.data.parentTrainers = res.data.parentTrainers; renderParentTrainerModal(); refreshPlazaStateOnly(); }
        }));
        body.querySelector('#btnParentAdoptEgg')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/adopt', 'POST', { trainerId: tr.id });
            toast(res.data?.message || '새 가족 포켓몬을 만났어요!');
            if (res.ok) { window.StudyFx?.fanfare?.(); window.StudyFx?.celebrate?.(); plazaState.data.parentTrainers = res.data.parentTrainers; renderParentTrainerModal(); refreshPlazaStateOnly(); }
        });
        body.querySelector('#btnParentEvolve')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/evolve', 'POST', { trainerId: tr.id, pokemonId: partner.id });
            toast(res.data?.message || '진화 완료!');
            if (res.ok) { window.StudyFx?.fanfare?.(); window.StudyFx?.celebrate?.({ big: true }); plazaState.data.parentTrainers = res.data.parentTrainers; renderParentTrainerModal(); refreshPlazaStateOnly(); }
        });
        body.querySelector('#btnParentPlazaCheer')?.addEventListener('click', async () => {
            await sendReaction(tr.id, tr.id === 'mom' ? 'love' : 'clap');
            plazaState.meadowMode = 'plaza';
            renderModeAndBar();
            plazaState.onRemountMeadow?.();
            document.getElementById('parentPokemonDialog')?.close?.();
        });
        body.querySelectorAll('[data-parent-poke-id]').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson('/api/study/parent-trainer/partner', 'POST', { trainerId: tr.id, pokemonId: Number(b.dataset.parentPokeId) });
            toast(res.data?.message || '단짝을 바꿨어요!');
            if (res.ok) { window.StudyFx?.tap?.(); plazaState.data.parentTrainers = res.data.parentTrainers; renderParentTrainerModal(); refreshPlazaStateOnly(); }
        }));
    }

    async function refreshPlazaStateOnly() {
        const { ok, data } = await apiJson(`/api/study/plaza/state?childId=${encodeURIComponent(plazaState.childId)}`);
        if (ok) {
            plazaState.data = data;
            renderModeAndBar();
            if (plazaState.meadowMode === 'plaza') plazaState.onRemountMeadow?.();
        }
    }

    async function renderForChild({ childProfile, pokemonData, isMotionPaused, showToast, onRefreshAll, onRemountMeadow }) {
        plazaState.childProfile = childProfile || null;
        plazaState.childId = childProfile?.id || 'first';
        plazaState.pokemonData = pokemonData || null;
        if (isMotionPaused) plazaState.isMotionPaused = isMotionPaused;
        if (showToast) plazaState.showToast = showToast;
        if (onRefreshAll) plazaState.onRefreshAll = onRefreshAll;
        if (onRemountMeadow) plazaState.onRemountMeadow = onRemountMeadow;

        const { ok, data } = await apiJson(`/api/study/plaza/state?childId=${encodeURIComponent(plazaState.childId)}`);
        if (ok) {
            plazaState.data = data;
            renderModeAndBar();
            if (plazaState.meadowMode === 'plaza' && typeof plazaState.onRemountMeadow === 'function') {
                plazaState.onRemountMeadow();
            }
        }
    }

    function syncLockUi(unlocked, pin = '') {
        plazaState.parentUnlocked = Boolean(unlocked);
        if (pin) plazaState.parentPin = pin;
        if (!plazaState.parentUnlocked) plazaState.parentPin = '';
    }

    window.StudyPlazaShop = {
        renderForChild,
        mountCurrentMeadow,
        isPlazaMode: () => plazaState.meadowMode === 'plaza',
        syncLockUi
    };
})();
