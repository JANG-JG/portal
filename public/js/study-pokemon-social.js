/**
 * ==============================================================================
 * 포켓몬 초원 소셜·간식 교환·놀러가기·협동 미션 UI 모듈 (study-pokemon-social.js)
 * ------------------------------------------------------------------------------
 * - 형제 협동 미션 바, 간식 먹이기/진화, 간식 교환·선물 & 수학 레벨 퀴즈 모달, 초원 놀러가기
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px·터치 최적화
 * ==============================================================================
 */
(function () {
    'use strict';

    let ctxState = { childId: 'first', partnerPokemon: null, social: null, selectedSnack: 'apple', showToast: null, onRefreshAll: null };
    let activeTradeCtx = null;

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function snackLabel(type, qty = 1) {
        const map = { apple: '🍎 사과열매', berry: '🍓 딸기베리', cookie: '🍪 포켓몬쿠키', star_candy: '🍬 별사탕' };
        return `${map[type] || '🍎 간식'} ${qty}개`;
    }

    function toast(msg) {
        if (typeof ctxState.showToast === 'function') ctxState.showToast(msg);
    }

    async function apiJson(url, method = 'GET', body = null) {
        const opts = { method, credentials: 'include', headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success !== false, data };
    }

    function bindDialogLightDismissFallback() {
        const dlg = document.getElementById('pokemonTradeQuizDialog');
        if (!dlg || dlg._socialBound) return;
        dlg._socialBound = true;
        dlg.addEventListener('close', () => { dlg.returnValue = ''; });
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const outside = (e) => {
                const r = dlg.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            let pressedOut = false;
            dlg.addEventListener('pointerdown', (e) => { pressedOut = outside(e); });
            dlg.addEventListener('pointerup', (e) => { if (pressedOut && outside(e)) dlg.close(); });
        }
    }

    async function openTradeQuizModal(trade) {
        const dlg = document.getElementById('pokemonTradeQuizDialog');
        const bodyEl = document.getElementById('tradeQuizBody');
        if (!dlg || !bodyEl) return;

        bindDialogLightDismissFallback();
        bodyEl.innerHTML = '<p style="text-align:center; padding:16px;">수학 확인 문제를 준비하고 있어요...</p>';
        dlg.showModal();

        const { ok, data } = await apiJson(`/api/study/pokemon/trades/${trade.id}/quiz?childId=${encodeURIComponent(ctxState.childId)}`);
        if (!ok || !data.quiz) {
            bodyEl.innerHTML = `<p style="color:#b91c1c; font-weight:800;">${esc(data.message || '문제를 불러오지 못했어요.')}</p>`;
            return;
        }

        const q = data.quiz;
        let pickedAnswer = '';
        const replies = ctxState.social?.replyPresets || ['정말 고마워! ❤️', '맛있게 잘 먹을게! 😋'];
        let pickedReply = replies[0];

        const offerTxt = snackLabel(trade.offer_snack, trade.offer_qty);
        const reqTxt = Number(trade.request_qty) > 0 ? `${snackLabel(trade.request_snack, trade.request_qty)}과 바꾸기` : '선물 받기 🎁';

        bodyEl.innerHTML = `
            <p style="margin:0 0 6px; font-weight:800; color:#475569;">${esc(trade.from_name || trade.from_child_id)} → 나: <strong>${esc(offerTxt)}</strong> (${esc(reqTxt)})</p>
            <div style="background:#fefce8; border:1.5px solid #fde047; border-radius:12px; padding:10px; margin-bottom:8px;">
                <span style="font-size:0.78rem; font-weight:800; color:#a16207;">🧮 내 수학 실력(Lv.${q.mathLevel}) 확인 문제</span>
                <p style="margin:4px 0; font-weight:900; color:#0f172a;">${esc(q.prompt)}</p>
                <div class="trade-quiz-visual">${esc(q.visual)}</div>
            </div>
            <div class="trade-quiz-choices" role="group" aria-label="정답 선택">
                ${q.choices.map((c) => `<button type="button" class="trade-quiz-choice-btn" data-ans="${esc(c)}">${esc(c)}</button>`).join('')}
            </div>
            <label style="display:block; font-size:0.84rem; font-weight:800; color:#475569; margin:8px 0 4px;">💌 보낼 감사 한마디</label>
            <select id="tradeReplySelect" class="social-select">
                ${replies.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>
            <p id="tradeQuizFeedback" style="min-height:20px; margin:8px 0; font-size:0.88rem; font-weight:800; color:#b45309;"></p>
            <button type="button" id="btnSubmitTradeQuiz" class="study-btn study-btn-primary" style="width:100%; min-block-size:48px;">✅ 정답 확인하고 교환 완료하기!</button>
        `;

        activeTradeCtx = trade.id;
        bodyEl.querySelectorAll('.trade-quiz-choice-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                pickedAnswer = btn.dataset.ans || '';
                bodyEl.querySelectorAll('.trade-quiz-choice-btn').forEach((b) => b.classList.toggle('active', b === btn));
            });
        });
        bodyEl.querySelector('#tradeReplySelect')?.addEventListener('change', (e) => { pickedReply = e.target.value; });

        bodyEl.querySelector('#btnSubmitTradeQuiz')?.addEventListener('click', async () => {
            if (!pickedAnswer) {
                bodyEl.querySelector('#tradeQuizFeedback').textContent = '위 숫자 보기 중 정답을 먼저 골라 주세요!';
                return;
            }
            const res = await apiJson(`/api/study/pokemon/trades/${activeTradeCtx}/respond`, 'POST', {
                childId: ctxState.childId, action: 'accept', answer: pickedAnswer, replyMsg: pickedReply
            });
            if (res.data?.quizRetry) {
                window.StudyFx?.wrong?.();
                bodyEl.querySelector('#tradeQuizFeedback').textContent = res.data.message || '다시 한 번 계산해 볼까요?';
                return;
            }
            if (!res.ok) {
                bodyEl.querySelector('#tradeQuizFeedback').textContent = res.data?.message || '교환에 실패했어요.';
                return;
            }
            dlg.close('accepted');
            window.StudyFx?.celebrate?.();
            toast(res.data.message || '간식 교환이 완료되었어요! 🎉');
            ctxState.social = res.data.social || ctxState.social;
            renderSocialCard();
            if (typeof ctxState.onRefreshAll === 'function') ctxState.onRefreshAll();
        });
    }

    function renderSocialCard() {
        const mount = document.getElementById('pokemonSocialMount');
        if (!mount) return;
        const s = ctxState.social;
        if (!s || !s.enabled) { mount.hidden = true; return; }
        mount.hidden = false;

        const partner = ctxState.partnerPokemon;
        const partnerAff = partner ? (s.affection?.[partner.id] || { level: 1, exp: 0, evolution: null }) : null;
        const coop = s.coop || { currentStars: 0, goalStars: 4, reached: false, canClaim: false, claimed: false };
        const pct = Math.min(100, Math.round((coop.currentStars / Math.max(1, coop.goalStars)) * 100));
        const siblings = Array.isArray(s.siblings) ? s.siblings : [];
        const hasSiblings = siblings.length > 0;

        mount.innerHTML = `
            <div class="study-card-head">
                <h2 class="study-card-title">🍎 포켓몬 간식 가방 &amp; 친구 초원</h2>
                <span class="level-badge">경제·협동 놀이</span>
            </div>

            <div class="social-coop-box">
                <div class="social-coop-top">
                    <span>🤝 오늘의 형제 협동 미션 (도장 ${coop.currentStars} / ${coop.goalStars}칸)</span>
                    <span>${coop.claimed ? '🎁 보상 수령 완료!' : (coop.reached ? '🎉 달성 완료!' : '함께 채워 보아요!')}</span>
                </div>
                <div class="social-progress-track"><div class="social-progress-fill" style="width:${pct}%"></div></div>
                ${coop.canClaim ? `<button type="button" id="btnClaimCoop" class="study-btn study-btn-primary" style="width:100%;">🎁 형제 협동 보상 받기 (🍬 별사탕 2개 + 친밀도 +15)</button>` : ''}
            </div>

            <div class="social-subcard">
                <h3>🍬 내 간식 주머니 &amp; 단짝 돌보기</h3>
                <div class="snack-bag-grid">
                    ${(s.snacks || []).map((sn) => `
                        <button type="button" class="snack-pill-btn${ctxState.selectedSnack === sn.id ? ' active' : ''}" data-snack-id="${esc(sn.id)}">
                            <span>${sn.emoji} ${esc(sn.name)}</span>
                            <span class="snack-qty-badge">${sn.qty}개</span>
                        </button>
                    `).join('')}
                </div>
                ${partner ? `
                    <div class="social-list-item">
                        <div class="social-list-item__meta">
                            ⭐ 단짝 <strong>${esc(partner.nameKo)}</strong> · 친밀도 Lv.${partnerAff.level} (EXP ${partnerAff.exp}${partnerAff.evolution ? ` / 진화 ${partnerAff.evolution.needExp}` : ''})
                        </div>
                        <div class="social-list-item__actions">
                            <button type="button" id="btnFeedPartner" class="study-btn study-btn-secondary">🍎 선택한 간식 주기</button>
                            ${partnerAff.evolution?.canEvolve ? `<button type="button" id="btnEvolvePartner" class="study-btn study-btn-primary">✨ ${esc(partnerAff.evolution.nextNameKo)}(으)로 진화!</button>` : ''}
                        </div>
                    </div>
                ` : '<p style="margin:0; font-size:0.86rem; color:#64748b; font-weight:700;">도장 10칸을 모아 첫 포켓몬이 깨어나면 간식을 줄 수 있어요! 🥚</p>'}
            </div>

            ${hasSiblings ? `
                <div class="social-subcard">
                    <h3>📦 형제·친구와 간식 나누기 &amp; 교환</h3>
                    <div class="social-form-grid">
                        <select id="tradeTargetSelect" class="social-select" aria-label="받을 친구 선택">
                            ${siblings.map((sib) => `<option value="${esc(sib.id)}">${esc(sib.avatar_emoji || '🧒')} ${esc(sib.display_name)}</option>`).join('')}
                        </select>
                        <select id="tradeOfferSnack" class="social-select" aria-label="줄 간식">
                            ${(s.snacks || []).map((sn) => `<option value="${esc(sn.id)}">줄 것: ${sn.emoji} ${esc(sn.name)} (${sn.qty})</option>`).join('')}
                        </select>
                        <select id="tradeOfferQty" class="social-select" aria-label="줄 개수">
                            <option value="1">1개 주기</option><option value="2">2개 주기</option><option value="3">3개 주기</option>
                        </select>
                        <select id="tradeRequestMode" class="social-select" aria-label="받을 간식 선택">
                            <option value="">🎁 그냥 선물만 줄래요</option>
                            ${(s.snacks || []).map((sn) => `<option value="${esc(sn.id)}:1">바꿀 것: ${sn.emoji} ${esc(sn.name)} 1개</option>`).join('')}
                            ${(s.snacks || []).map((sn) => `<option value="${esc(sn.id)}:2">바꿀 것: ${sn.emoji} ${esc(sn.name)} 2개</option>`).join('')}
                        </select>
                    </div>
                    <select id="tradeGreetingSelect" class="social-select" aria-label="인사말 고르기">
                        ${(s.greetingPresets || []).map((g) => `<option value="${esc(g)}">💬 ${esc(g)}</option>`).join('')}
                    </select>
                    <button type="button" id="btnSendTrade" class="study-btn study-btn-primary" style="width:100%;">💌 교환·선물 쪽지 보내기</button>
                    ${renderInboxHtml(s)}
                </div>

                <div class="social-subcard">
                    <h3>🐾 포켓몬 초원 놀러가기 (24시간)</h3>
                    ${renderVisitHtml(s, siblings, partner)}
                </div>
            ` : ''}
        `;

        bindSocialCardEvents(mount);
    }

    function renderInboxHtml(s) {
        const inc = s.incomingTrades || [];
        const out = s.outgoingTrades || [];
        if (!inc.length && !out.length) return '';
        return `
            <div class="social-list">
                ${inc.map((t) => {
                    const what = Number(t.request_qty) > 0
                        ? `${snackLabel(t.offer_snack, t.offer_qty)} ⇄ ${snackLabel(t.request_snack, t.request_qty)}`
                        : `${snackLabel(t.offer_snack, t.offer_qty)} 🎁 선물`;
                    return `
                        <div class="social-list-item">
                            <div class="social-list-item__meta">
                                📩 <strong>${esc(t.from_name || t.from_child_id)}</strong>: ${esc(what)}<br>
                                <small style="color:#64748b;">"${esc(t.greeting_msg)}"</small>
                            </div>
                            <div class="social-list-item__actions">
                                <button type="button" class="study-btn study-btn-primary btn-trade-quiz" data-trade-id="${t.id}">🧮 퀴즈 풀고 받기</button>
                                <button type="button" class="study-btn study-btn-outline btn-trade-decline" data-trade-id="${t.id}">거절</button>
                            </div>
                        </div>
                    `;
                }).join('')}
                ${out.slice(0, 3).map((t) => {
                    const st = t.status === 'accepted' ? `✅ 완료 ("${esc(t.reply_msg)}")` : (t.status === 'pending' ? '⏳ 응답 대기 중' : '❌ 거절/취소');
                    return `<div class="social-list-item"><div class="social-list-item__meta">📤 <strong>${esc(t.to_name || t.to_child_id)}</strong>에게 ${esc(snackLabel(t.offer_snack, t.offer_qty))} · ${st}</div></div>`;
                }).join('')}
            </div>
        `;
    }

    function renderVisitHtml(s, siblings, partner) {
        const outVisit = s.outgoingVisit;
        const incVisits = s.incomingVisits || [];
        let html = '';
        if (outVisit) {
            html += `
                <div class="social-list-item">
                    <div class="social-list-item__meta">🏃 <strong>${esc(outVisit.guest_pokemon_name)}</strong>이(가) <strong>${esc(outVisit.host_name || outVisit.host_child_id)}</strong> 초원에서 신나게 노는 중!</div>
                    <button type="button" class="study-btn study-btn-secondary btn-end-visit" data-visit-id="${outVisit.id}">🏠 집으로 부르기 (🍬 답례 1개)</button>
                </div>
            `;
        } else if (partner) {
            html += `
                <div class="social-form-grid">
                    <select id="visitHostSelect" class="social-select" aria-label="놀러갈 친구 초원 선택">
                        ${siblings.map((sib) => `<option value="${esc(sib.id)}">${esc(sib.display_name)}의 초원으로</option>`).join('')}
                    </select>
                    <button type="button" id="btnSendVisit" class="study-btn study-btn-secondary">🐾 ${esc(partner.nameKo)} 놀러보내기!</button>
                </div>
            `;
        }
        incVisits.forEach((v) => {
            html += `<div class="social-list-item"><div class="social-list-item__meta">🏠 <strong>${esc(v.guest_name || v.guest_child_id)}</strong>네 <strong>${esc(v.guest_pokemon_name)}</strong>이(가) 지금 우리 초원에서 놀고 있어요! ("${esc(v.greeting_msg)}")</div></div>`;
        });
        return html || '<p style="margin:0; font-size:0.84rem; color:#64748b;">단짝 포켓몬을 정하면 친구 초원에 놀러갈 수 있어요!</p>';
    }

    function bindSocialCardEvents(mount) {
        mount.querySelectorAll('.snack-pill-btn').forEach((b) => {
            b.addEventListener('click', () => { ctxState.selectedSnack = b.dataset.snackId; renderSocialCard(); });
        });
        mount.querySelector('#btnClaimCoop')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/pokemon/coop/claim', 'POST', { childId: ctxState.childId });
            toast(res.data?.message || '협동 보상을 받았어요!');
            if (res.ok) { window.StudyFx?.celebrate?.(); ctxState.social = res.data.social; renderSocialCard(); }
        });
        mount.querySelector('#btnFeedPartner')?.addEventListener('click', async () => {
            if (!ctxState.partnerPokemon) return;
            const res = await apiJson('/api/study/pokemon/feed', 'POST', { childId: ctxState.childId, pokemonId: ctxState.partnerPokemon.id, snackType: ctxState.selectedSnack });
            toast(res.data?.message || '간식을 주었어요!');
            if (res.ok) { window.StudyFx?.correct?.(); ctxState.social = res.data.social; renderSocialCard(); }
        });
        mount.querySelector('#btnEvolvePartner')?.addEventListener('click', async () => {
            if (!ctxState.partnerPokemon) return;
            const res = await apiJson('/api/study/pokemon/evolve', 'POST', { childId: ctxState.childId, pokemonId: ctxState.partnerPokemon.id });
            toast(res.data?.message || '진화 완료!');
            if (res.ok) { window.StudyFx?.fanfare?.(); window.StudyFx?.celebrate?.({ big: true }); ctxState.onRefreshAll?.(); }
        });
        mount.querySelector('#btnSendTrade')?.addEventListener('click', async () => {
            const reqVal = mount.querySelector('#tradeRequestMode')?.value || '';
            const [reqSnack, reqQty] = reqVal ? reqVal.split(':') : ['', '0'];
            const res = await apiJson('/api/study/pokemon/trades', 'POST', {
                childId: ctxState.childId,
                toChildId: mount.querySelector('#tradeTargetSelect')?.value,
                offerSnack: mount.querySelector('#tradeOfferSnack')?.value,
                offerQty: Number(mount.querySelector('#tradeOfferQty')?.value || 1),
                requestSnack: reqSnack,
                requestQty: Number(reqQty || 0),
                greetingMsg: mount.querySelector('#tradeGreetingSelect')?.value
            });
            toast(res.data?.message || '교환 요청 완료!');
            if (res.ok) { window.StudyFx?.tap?.(); ctxState.social = res.data.social; renderSocialCard(); }
        });
        mount.querySelectorAll('.btn-trade-quiz').forEach((b) => {
            b.addEventListener('click', () => {
                const trade = (ctxState.social?.incomingTrades || []).find((t) => Number(t.id) === Number(b.dataset.tradeId));
                if (trade) openTradeQuizModal(trade);
            });
        });
        mount.querySelectorAll('.btn-trade-decline').forEach((b) => {
            b.addEventListener('click', async () => {
                const res = await apiJson(`/api/study/pokemon/trades/${b.dataset.tradeId}/respond`, 'POST', { childId: ctxState.childId, action: 'decline' });
                toast(res.data?.message || '정중히 거절했어요.');
                if (res.ok) { ctxState.social = res.data.social; renderSocialCard(); }
            });
        });
        mount.querySelector('#btnSendVisit')?.addEventListener('click', async () => {
            const res = await apiJson('/api/study/pokemon/visits', 'POST', {
                childId: ctxState.childId,
                hostChildId: mount.querySelector('#visitHostSelect')?.value,
                pokemonId: ctxState.partnerPokemon?.id || 0
            });
            toast(res.data?.message || '초원 나들이 출발!');
            if (res.ok) { window.StudyFx?.correct?.(); ctxState.social = res.data.social; renderSocialCard(); ctxState.onRefreshAll?.(); }
        });
        mount.querySelectorAll('.btn-end-visit').forEach((b) => {
            b.addEventListener('click', async () => {
                const res = await apiJson(`/api/study/pokemon/visits/${b.dataset.visitId}/end`, 'POST', { childId: ctxState.childId });
                toast(res.data?.message || '집으로 돌아왔어요!');
                if (res.ok) { window.StudyFx?.correct?.(); ctxState.social = res.data.social; renderSocialCard(); ctxState.onRefreshAll?.(); }
            });
        });
    }

    async function renderForChild({ childProfile, partnerPokemon, showToast, onRefreshAll }) {
        const mount = document.getElementById('pokemonSocialMount');
        if (!mount) return;
        ctxState.childId = childProfile?.id || 'first';
        ctxState.partnerPokemon = partnerPokemon || null;
        if (showToast) ctxState.showToast = showToast;
        if (onRefreshAll) ctxState.onRefreshAll = onRefreshAll;

        const { ok, data } = await apiJson(`/api/study/pokemon/social?childId=${encodeURIComponent(ctxState.childId)}`);
        if (ok && data.social) {
            ctxState.social = data.social;
            renderSocialCard();
        } else {
            mount.hidden = true;
        }
    }

    window.StudyPokemonSocial = { renderForChild };
})();
