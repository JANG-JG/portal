/**
 * ==============================================================================
 * 포켓몬 초원 게임 도크 & 유치원 그림 소셜 모듈 (study-pokemon-social.js)
 * ------------------------------------------------------------------------------
 * - 초원 바로 아래 게임 도구 바(쓰다듬기/공놀이/방울톡/간식 던지기/친구초원)
 * - 드롭다운 0개 그림 카드 UI: 선물·교환, 24시간 놀러가기, 수학 퀴즈 선물 상자
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px·터치 최적화
 * ==============================================================================
 */
(function () {
    'use strict';

    const SNACK_LIST = [
        { id: 'apple', emoji: '🍎', name: '사과열매' },
        { id: 'berry', emoji: '🍓', name: '딸기베리' },
        { id: 'cookie', emoji: '🍪', name: '포켓몬쿠키' },
        { id: 'star_candy', emoji: '🍬', name: '별사탕' }
    ];

    let ctxState = {
        childId: 'first', partnerPokemon: null, social: null, selectedSnack: 'apple',
        playMode: 'pet', playApi: null, showToast: null, onRefreshAll: null
    };
    const friendForm = { targetChildId: '', mode: 'gift', offerSnack: 'apple', requestSnack: 'berry' };

    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const snackMeta = (id) => SNACK_LIST.find((s) => s.id === id) || SNACK_LIST[0];
    const snackLabel = (type, qty = 1) => `${snackMeta(type).emoji} ${snackMeta(type).name} ${qty}개`;
    const toast = (msg) => { if (typeof ctxState.showToast === 'function') ctxState.showToast(msg); };

    function picBtn(cls, dataAttr, emoji, label, active, disabled) {
        return `<button type="button" class="friend-pic-btn ${cls}${active ? ' is-active' : ''}" ${dataAttr}${disabled ? ' disabled style="opacity:0.45;"' : ''}>`
            + `<span class="friend-pic-btn__emoji">${emoji}</span><span>${esc(label)}</span></button>`;
    }

    async function apiJson(url, method = 'GET', body = null) {
        const opts = { method, credentials: 'include', headers: {} };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, data };
    }

    function bindDialogLightDismiss(dlg) {
        if (!dlg || dlg._socialBound) return;
        dlg._socialBound = true;
        dlg.addEventListener('close', () => { dlg.returnValue = ''; });
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const out = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
            let downOut = false;
            dlg.addEventListener('pointerdown', (e) => { downOut = out(e); });
            dlg.addEventListener('pointerup', (e) => { if (downOut && out(e)) dlg.close(); });
        }
    }

    async function openTradeQuizModal(trade) {
        const dlg = document.getElementById('pokemonTradeQuizDialog');
        const bodyEl = document.getElementById('tradeQuizBody');
        if (!dlg || !bodyEl || !trade) return;

        bindDialogLightDismiss(dlg);
        bodyEl.innerHTML = '<p style="text-align:center; padding:16px;">선물 상자 퀴즈를 열고 있어요...</p>';
        dlg.showModal();

        const { ok, data } = await apiJson(`/api/study/pokemon/trades/${trade.id}/quiz?childId=${encodeURIComponent(ctxState.childId)}`);
        if (!ok || !data.quiz) {
            bodyEl.innerHTML = `<p style="color:#b91c1c; font-weight:800;">${esc(data.message || '문제를 불러오지 못했어요.')}</p>`;
            return;
        }

        const q = data.quiz;
        const replies = ctxState.social?.replyPresets || ['고마워! ❤️', '맛있게 먹을게! 😋', '같이 놀자! 🐾'];
        let pickedAnswer = '';
        let pickedReply = replies[0];
        const offerTxt = snackLabel(trade.offer_snack, trade.offer_qty);
        const reqTxt = Number(trade.request_qty) > 0 ? `${snackLabel(trade.request_snack, trade.request_qty)}과 바꾸기` : '깜짝 선물 🎁';

        bodyEl.innerHTML = `
            <p style="margin:0 0 6px; font-weight:800; color:#475569;">${esc(trade.from_name || trade.from_child_id)} → 나: <strong>${esc(offerTxt)}</strong> (${esc(reqTxt)})</p>
            <div style="background:#fefce8; border:2px solid #fde047; border-radius:14px; padding:10px; margin-bottom:8px;">
                <span style="font-size:0.8rem; font-weight:900; color:#a16207;">🧮 선물 열기 숫자 놀이 (Lv.${q.mathLevel})</span>
                <p style="margin:4px 0; font-weight:900; color:#0f172a;">${esc(q.prompt)}</p>
                <div class="trade-quiz-visual">${esc(q.visual)}</div>
            </div>
            <div class="trade-quiz-choices" role="group" aria-label="정답 선택">
                ${q.choices.map((c) => `<button type="button" class="trade-quiz-choice-btn" data-ans="${esc(c)}">${esc(c)}</button>`).join('')}
            </div>
            <div class="friend-tile-row" style="margin:8px 0;" role="group" aria-label="고마운 말 고르기">
                ${replies.slice(0, 3).map((r, i) => `<button type="button" class="friend-pic-btn ${i === 0 ? 'is-active' : ''} quiz-reply-chip" data-reply="${esc(r)}">${esc(r)}</button>`).join('')}
            </div>
            <p id="tradeQuizFeedback" style="min-height:20px; margin:6px 0; font-size:0.88rem; font-weight:800; color:#b45309;"></p>
            <button type="button" id="btnSubmitTradeQuiz" class="study-btn study-btn-primary" style="width:100%; min-block-size:50px;">🎁 정답 확인하고 상자 열기!</button>`;

        bodyEl.querySelectorAll('.trade-quiz-choice-btn').forEach((btn) => btn.addEventListener('click', () => {
            pickedAnswer = btn.dataset.ans || ''; window.StudyFx?.tap?.();
            bodyEl.querySelectorAll('.trade-quiz-choice-btn').forEach((b) => b.classList.toggle('active', b === btn));
        }));
        bodyEl.querySelectorAll('.quiz-reply-chip').forEach((btn) => btn.addEventListener('click', () => {
            pickedReply = btn.dataset.reply || replies[0]; window.StudyFx?.tap?.();
            bodyEl.querySelectorAll('.quiz-reply-chip').forEach((b) => b.classList.toggle('is-active', b === btn));
        }));
        bodyEl.querySelector('#btnSubmitTradeQuiz')?.addEventListener('click', async () => {
            if (!pickedAnswer) { bodyEl.querySelector('#tradeQuizFeedback').textContent = '위의 큰 숫자 중 하나를 먼저 톡 눌러 주세요!'; return; }
            const res = await apiJson(`/api/study/pokemon/trades/${trade.id}/respond`, 'POST', { childId: ctxState.childId, action: 'accept', answer: pickedAnswer, replyMsg: pickedReply });
            if (res.data?.quizRetry) { window.StudyFx?.retry?.(); bodyEl.querySelector('#tradeQuizFeedback').textContent = res.data.message || '그림을 다시 세어 볼까요?'; return; }
            if (!res.ok) { bodyEl.querySelector('#tradeQuizFeedback').textContent = res.data?.message || '선물을 열지 못했어요.'; return; }
            dlg.close('accepted'); document.getElementById('pokemonFriendPlayDialog')?.close?.();
            window.StudyFx?.celebrate?.(); toast(res.data.message || '선물 상자를 열었어요! 🎉');
            ctxState.social = res.data.social || ctxState.social; renderAll(); ctxState.onRefreshAll?.();
        });
    }

    function openFriendPlayDialog() {
        const dlg = document.getElementById('pokemonFriendPlayDialog');
        const body = document.getElementById('friendPlayBody');
        const s = ctxState.social;
        if (!dlg || !body || !s) return;

        bindDialogLightDismiss(dlg);
        const siblings = Array.isArray(s.siblings) ? s.siblings : [];
        if (!friendForm.targetChildId || !siblings.some((x) => x.id === friendForm.targetChildId)) {
            friendForm.targetChildId = siblings[0]?.id || '';
        }
        const snacks = s.snacks || SNACK_LIST.map((x) => ({ ...x, qty: 0 }));
        const qtyOf = (id) => Number((snacks.find((x) => x.id === id) || {}).qty || 0);
        const partner = ctxState.partnerPokemon;
        const incTrades = s.incomingTrades || [];
        const outVisit = s.outgoingVisit;
        const incVisits = s.incomingVisits || [];
        const targetSib = siblings.find((x) => x.id === friendForm.targetChildId) || siblings[0];

        const giftsHtml = incTrades.length > 0 ? `<div class="friend-play-section" style="background:#fffbeb; border-color:#fcd34d;"><h3>🎁 도착한 선물 상자 (${incTrades.length}개)</h3>
            ${incTrades.map((t) => `<div class="social-list-item"><div class="social-list-item__meta"><strong>${esc(t.from_name || t.from_child_id)}</strong>: ${esc(Number(t.request_qty) > 0 ? `${snackLabel(t.offer_snack, t.offer_qty)} ⇄ ${snackLabel(t.request_snack, t.request_qty)}` : `${snackLabel(t.offer_snack, t.offer_qty)} 🎁`)}</div>
                <div class="social-list-item__actions"><button type="button" class="study-btn study-btn-primary btn-trade-quiz" data-trade-id="${t.id}">🎁 상자 열기</button><button type="button" class="study-btn study-btn-outline btn-trade-decline" data-trade-id="${t.id}">다음에</button></div></div>`).join('')}</div>` : '';

        const sibPickerHtml = siblings.length > 1 ? `<div class="friend-play-section"><h3>1. 누구에게 갈까요?</h3><div class="friend-tile-row">
            ${siblings.map((sib) => picBtn('friend-pick-sib', `data-sib-id="${esc(sib.id)}"`, esc(sib.avatar_emoji || '🧒'), sib.display_name, friendForm.targetChildId === sib.id)).join('')}</div></div>` : '';

        const visitHtml = `<div class="friend-play-section" style="background:#f0f9ff; border-color:#bae6fd;"><h3>🐾 ${esc(targetSib?.display_name || '친구')} 초원에 놀러가기</h3>
            ${outVisit ? `<p style="margin:0; font-weight:800; color:#0369a1;">🏃 ${esc(outVisit.guest_pokemon_name)}이(가) ${esc(outVisit.host_name || outVisit.host_child_id)} 초원에서 노는 중!</p>
                <button type="button" id="dlgBtnEndVisit" class="study-btn study-btn-secondary" style="width:100%; min-block-size:48px;">🏠 집으로 부르기 (🍬 답례 1개!)</button>`
            : (partner ? `<button type="button" id="dlgBtnSendVisit" class="study-btn study-btn-primary" style="width:100%; min-block-size:50px;">✈️ ${esc(partner.nameKo)} 놀러보내기!</button>`
            : `<p style="margin:0; font-size:0.86rem; color:#475569; font-weight:700;">알이 깨어나면 친구 초원에 놀러갈 수 있어요! 🥚</p>`)}
            ${incVisits.map((v) => `<div class="social-list-item"><div class="social-list-item__meta">🏠 <strong>${esc(v.guest_name)}</strong>네 ${esc(v.guest_pokemon_name)}이(가) 우리 초원에서 노는 중!</div></div>`).join('')}</div>`;

        const giftSendHtml = `<div class="friend-play-section"><h3>🍎 ${esc(targetSib?.display_name || '친구')}에게 간식 보내기</h3>
            <div class="friend-tile-row" style="grid-template-columns: repeat(2, 1fr);">
                ${picBtn('friend-mode-btn', 'data-mode="gift"', '🎁', '그냥 선물!', friendForm.mode === 'gift')}
                ${picBtn('friend-mode-btn', 'data-mode="swap"', '🔄', '하나씩 바꾸기', friendForm.mode === 'swap')}
            </div>
            <div class="friend-tile-row">${snacks.map((sn) => picBtn('friend-offer-btn', `data-snack="${esc(sn.id)}"`, sn.emoji, `${sn.qty}개`, friendForm.offerSnack === sn.id, sn.qty <= 0)).join('')}</div>
            ${friendForm.mode === 'swap' ? `<p style="margin:2px 0 0; font-size:0.82rem; font-weight:800; color:#475569;">🔄 대신 받고 싶은 간식:</p>
                <div class="friend-tile-row">${SNACK_LIST.map((sn) => picBtn('friend-req-btn', `data-snack="${esc(sn.id)}"`, sn.emoji, '1개', friendForm.requestSnack === sn.id)).join('')}</div>` : ''}
            <button type="button" id="dlgBtnSendGift" class="study-btn study-btn-green" style="width:100%; min-block-size:50px;" ${qtyOf(friendForm.offerSnack) <= 0 ? 'disabled' : ''}>💌 ${esc(snackMeta(friendForm.offerSnack).emoji)} 슝~ 보내기!</button></div>`;

        body.innerHTML = `${giftsHtml}${siblings.length > 0 ? `${sibPickerHtml}${visitHtml}${giftSendHtml}` : '<p style="text-align:center; color:#64748b; font-weight:800;">함께 놀 형제·친구 프로필이 등록되면 선물과 나들이를 할 수 있어요!</p>'}`;
        if (!dlg.open) dlg.showModal();

        const bindPick = (sel, key, attr) => body.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
            friendForm[key] = b.dataset[attr]; window.StudyFx?.tap?.(); openFriendPlayDialog();
        }));
        bindPick('.friend-pick-sib', 'targetChildId', 'sibId');
        bindPick('.friend-mode-btn', 'mode', 'mode');
        bindPick('.friend-offer-btn', 'offerSnack', 'snack');
        bindPick('.friend-req-btn', 'requestSnack', 'snack');

        body.querySelector('#dlgBtnSendVisit')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/pokemon/visits', 'POST', { childId: ctxState.childId, hostChildId: friendForm.targetChildId, pokemonId: partner?.id || 0 });
            toast(res.data?.message || '친구 초원으로 출발!');
            if (res.ok) { window.StudyFx?.correct?.(); ctxState.social = res.data.social; dlg.close(); renderAll(); ctxState.onRefreshAll?.(); }
        });
        body.querySelector('#dlgBtnEndVisit')?.addEventListener('click', async () => {
            const res = await apiJson(`/api/study/pokemon/visits/${outVisit.id}/end`, 'POST', { childId: ctxState.childId });
            toast(res.data?.message || '집으로 돌아왔어요!');
            if (res.ok) { window.StudyFx?.correct?.(); ctxState.social = res.data.social; dlg.close(); renderAll(); ctxState.onRefreshAll?.(); }
        });
        body.querySelector('#dlgBtnSendGift')?.addEventListener('click', async () => {
            const presets = s.greetingPresets || ['맛있게 먹어! ❤️'];
            const res = await apiJson('/api/study/pokemon/trades', 'POST', {
                childId: ctxState.childId, toChildId: friendForm.targetChildId, offerSnack: friendForm.offerSnack, offerQty: 1,
                requestSnack: friendForm.mode === 'swap' ? friendForm.requestSnack : '', requestQty: friendForm.mode === 'swap' ? 1 : 0, greetingMsg: presets[0]
            });
            toast(res.data?.message || '간식 선물을 보냈어요! 💌');
            if (res.ok) { window.StudyFx?.giftOpen?.(); ctxState.social = res.data.social; openFriendPlayDialog(); renderAll(); }
        });
        body.querySelectorAll('.btn-trade-quiz').forEach((b) => b.addEventListener('click', () => {
            const tr = incTrades.find((t) => Number(t.id) === Number(b.dataset.tradeId));
            if (tr) openTradeQuizModal(tr);
        }));
        body.querySelectorAll('.btn-trade-decline').forEach((b) => b.addEventListener('click', async () => {
            const res = await apiJson(`/api/study/pokemon/trades/${b.dataset.tradeId}/respond`, 'POST', { childId: ctxState.childId, action: 'decline' });
            toast(res.data?.message || '다음에 받기로 했어요.');
            if (res.ok) { ctxState.social = res.data.social; openFriendPlayDialog(); renderAll(); }
        }));
    }

    function renderGameDock() {
        const dockMount = document.getElementById('pokemonMeadowPlayMount');
        const s = ctxState.social;
        if (!dockMount) return;
        if (!s || !s.enabled) { dockMount.hidden = true; return; }
        dockMount.hidden = false;

        const partner = ctxState.partnerPokemon;
        const aff = partner ? (s.affection?.[partner.id] || { level: 1, exp: 0, evolution: null }) : null;
        const coop = s.coop || { currentStars: 0, goalStars: 4, reached: false, canClaim: false, claimed: false };
        const starsTxt = '⭐'.repeat(Math.min(coop.goalStars, coop.currentStars)) + '☆'.repeat(Math.max(0, coop.goalStars - coop.currentStars));
        const alertCount = (s.incomingTrades?.length || 0) + (s.incomingVisits?.length || 0);

        dockMount.innerHTML = `<div class="meadow-game-dock" role="region" aria-label="초원 놀이 도구">
            <div class="meadow-toy-bar">
                ${[['pet', '🖐️', '부르기'], ['ball', '⚽', '공놀이'], ['bubble', '🫧', '방울톡']].map(([m, em, lbl]) => `
                    <button type="button" class="meadow-toy-btn ${ctxState.playMode === m ? 'is-active' : ''}" data-play-mode="${m}">
                        <span class="meadow-toy-btn__emoji" aria-hidden="true">${em}</span><span>${lbl}</span></button>`).join('')}
                <button type="button" id="btnDockFriendPlay" class="meadow-toy-btn">
                    <span class="meadow-toy-btn__emoji" aria-hidden="true">🤝</span><span>친구초원</span>
                    ${alertCount > 0 ? `<span class="meadow-toy-btn__dot">${alertCount}</span>` : ''}</button>
            </div>
            <div class="meadow-snack-strip">
                <div class="meadow-snack-pills" role="group" aria-label="초원에 간식 던져주기">
                    ${(s.snacks || []).map((sn) => `<button type="button" class="meadow-snack-chip ${ctxState.playMode === 'feed' && ctxState.selectedSnack === sn.id ? 'is-armed' : ''} ${sn.qty <= 0 ? 'is-empty' : ''}" data-snack-id="${esc(sn.id)}" title="${esc(sn.name)} 초원에 던지기"><span>${sn.emoji}</span><span>×${sn.qty}</span></button>`).join('')}
                </div>
                ${partner ? `<div class="meadow-partner-heart"><span>❤️ Lv.${aff.level}${aff.evolution ? ` (${aff.exp}/${aff.evolution.needExp})` : ''}</span>
                    ${aff.evolution?.canEvolve ? `<button type="button" id="btnDockEvolve" class="meadow-evolve-btn">✨ ${esc(aff.evolution.nextNameKo)} 진화!</button>` : ''}</div>` : ''}
            </div>
            <div class="meadow-coop-ribbon">
                <span>🤝 형제 오늘 도장 ${starsTxt} (${coop.currentStars}/${coop.goalStars})</span>
                ${coop.canClaim ? `<button type="button" id="btnDockCoopClaim" class="study-btn study-btn-primary" style="min-block-size:38px; padding:4px 12px;">🎁 별사탕 받기!</button>` : `<span>${coop.claimed ? '🎁 보상 완료!' : '초원을 톡 눌러 놀아보세요!'}</span>`}
            </div></div>`;

        ctxState.playApi?.updateGiftChest?.(s.incomingTrades || []);
        dockMount.querySelectorAll('[data-play-mode]').forEach((btn) => btn.addEventListener('click', () => {
            ctxState.playMode = btn.dataset.playMode || 'pet'; window.StudyFx?.tap?.();
            ctxState.playApi?.setMode?.(ctxState.playMode, snackMeta(ctxState.selectedSnack)); renderGameDock();
        }));
        dockMount.querySelectorAll('.meadow-snack-chip').forEach((btn) => btn.addEventListener('click', () => {
            const sid = btn.dataset.snackId;
            const sn = (ctxState.social?.snacks || []).find((x) => x.id === sid);
            if (!sn || sn.qty <= 0) { window.StudyFx?.retry?.(); toast('도장을 모으거나 친구에게 선물받으면 간식이 생겨요! 🌟'); return; }
            const already = ctxState.playMode === 'feed' && ctxState.selectedSnack === sid;
            ctxState.selectedSnack = sid; ctxState.playMode = 'feed';
            if (already && ctxState.playApi?.throwSnackQuick) ctxState.playApi.throwSnackQuick(sn);
            else { ctxState.playApi?.setMode?.('feed', sn); toast(`${sn.emoji} 초원이나 포켓몬을 톡 눌러 던져주세요!`); }
            renderGameDock();
        }));
        dockMount.querySelector('#btnDockFriendPlay')?.addEventListener('click', () => { window.StudyFx?.tap?.(); openFriendPlayDialog(); });
        dockMount.querySelector('#btnDockEvolve')?.addEventListener('click', async () => {
            if (!partner) return;
            const res = await apiJson('/api/study/pokemon/evolve', 'POST', { childId: ctxState.childId, pokemonId: partner.id });
            toast(res.data?.message || '진화 완료!');
            if (res.ok) { window.StudyFx?.fanfare?.(); window.StudyFx?.celebrate?.({ big: true }); ctxState.onRefreshAll?.(); }
        });
        dockMount.querySelector('#btnDockCoopClaim')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/pokemon/coop/claim', 'POST', { childId: ctxState.childId });
            toast(res.data?.message || '별사탕 보상을 받았어요!');
            if (res.ok) { window.StudyFx?.celebrate?.(); ctxState.social = res.data.social; renderAll(); }
        });
    }

    function renderSocialSummaryCard() {
        const mount = document.getElementById('pokemonSocialMount');
        if (!mount) return;
        const s = ctxState.social;
        const hasNews = Boolean(s?.enabled && ((s.incomingTrades?.length || 0) > 0 || (s.incomingVisits?.length || 0) > 0 || s.outgoingVisit));
        if (!hasNews) { mount.hidden = true; mount.innerHTML = ''; return; }
        mount.hidden = false;
        const incTrades = s.incomingTrades || []; const incVisits = s.incomingVisits || [];
        mount.innerHTML = `<div class="social-list-item" style="border-color:#fde68a; background:#fffbeb;">
            <div class="social-list-item__meta">
                ${incTrades.length > 0 ? `🎁 <strong>선물 상자 ${incTrades.length}개</strong>가 초원에 도착했어요! ` : ''}
                ${incVisits.length > 0 ? `🐾 <strong>${esc(incVisits[0].guest_name)}</strong>네 ${esc(incVisits[0].guest_pokemon_name)}이(가) 놀러왔어요!` : ''}
                ${s.outgoingVisit && !incTrades.length && !incVisits.length ? `✈️ <strong>${esc(s.outgoingVisit.guest_pokemon_name)}</strong>이(가) 친구 초원 나들이 중!` : ''}
            </div>
            <button type="button" id="btnSocialSummaryOpen" class="study-btn study-btn-primary">🤝 친구 초원 열기</button></div>`;
        mount.querySelector('#btnSocialSummaryOpen')?.addEventListener('click', () => { window.StudyFx?.tap?.(); openFriendPlayDialog(); });
    }

    function renderAll() { renderGameDock(); renderSocialSummaryCard(); }

    async function feedInMeadow(pokemonId, snackType) {
        const targetId = Number(pokemonId) || Number(ctxState.partnerPokemon?.id || 0);
        if (!targetId) return false;
        const res = await apiJson('/api/study/pokemon/feed', 'POST', { childId: ctxState.childId, pokemonId: targetId, snackType: snackType || ctxState.selectedSnack });
        if (res.ok && res.data?.social) {
            ctxState.social = res.data.social; toast(res.data.message || '맛있게 먹었어요! 😋');
            const left = (ctxState.social.snacks || []).find((x) => x.id === (snackType || ctxState.selectedSnack))?.qty || 0;
            if (left <= 0) { ctxState.playMode = 'pet'; ctxState.playApi?.setMode?.('pet'); }
            renderAll(); return true;
        }
        if (res.data?.message) toast(res.data.message);
        return false;
    }

    function attachMeadowPlay(meadowCtrl) {
        if (!meadowCtrl || !window.PokemonMeadowPlay) { ctxState.playApi = null; return null; }
        ctxState.playApi = window.PokemonMeadowPlay.attach(meadowCtrl, {
            onFeedSnack: feedInMeadow,
            onOpenFirstGift: () => { const t = (ctxState.social?.incomingTrades || [])[0]; if (t) openTradeQuizModal(t); else openFriendPlayDialog(); },
            onModeChange: (next) => { if (ctxState.playMode !== next) { ctxState.playMode = next; renderGameDock(); } }
        });
        ctxState.playApi.setMode(ctxState.playMode, snackMeta(ctxState.selectedSnack));
        if (ctxState.social) ctxState.playApi.updateGiftChest(ctxState.social.incomingTrades || []);
        return ctxState.playApi;
    }

    async function renderForChild({ childProfile, partnerPokemon, showToast, onRefreshAll }) {
        ctxState.childId = childProfile?.id || 'first';
        ctxState.partnerPokemon = partnerPokemon || null;
        if (showToast) ctxState.showToast = showToast;
        if (onRefreshAll) ctxState.onRefreshAll = onRefreshAll;

        const { ok, data } = await apiJson(`/api/study/pokemon/social?childId=${encodeURIComponent(ctxState.childId)}`);
        if (ok && data.social) { ctxState.social = data.social; renderAll(); }
        else {
            ctxState.social = null;
            const dockMount = document.getElementById('pokemonMeadowPlayMount'); if (dockMount) dockMount.hidden = true;
            const mount = document.getElementById('pokemonSocialMount'); if (mount) mount.hidden = true;
        }
    }

    window.StudyPokemonSocial = { renderForChild, attachMeadowPlay, openFriendPlayDialog };
})();
