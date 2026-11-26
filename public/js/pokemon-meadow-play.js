/**
 * ==============================================================================
 * 포켓몬 초원 인터랙티브 놀이터 컨트롤러 (pokemon-meadow-play.js)
 * ------------------------------------------------------------------------------
 * - 초원 터치/드래그/부르기/공놀이/비눗방울/간식 던지기 입력 및 100dvh 크게 놀기
 * - PokemonMeadowToys 물리 렌더러 + PokemonMeadow 단일 rAF 루프 연동
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 터치/가로모드 최적화
 * ==============================================================================
 */
(function () {
    'use strict';

    const COME_CHANTS = ['간다 가! 🐾', '여기 왔어요! ✨', '무슨 일이에요? ❤️', '같이 놀자! 🌿'];

    function attach(meadowCtrl, hooks) {
        if (!meadowCtrl || !meadowCtrl.stageEl || !meadowCtrl.actorsEl) return null;
        if (typeof meadowCtrl._playDetach === 'function') meadowCtrl._playDetach();

        const stageEl = meadowCtrl.stageEl;
        const opts = hooks || {};
        stageEl.classList.add('is-play-enabled');

        const canvas = document.createElement('canvas');
        canvas.className = 'pokemon-meadow__play-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        stageEl.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        const hudTopRight = document.createElement('div');
        hudTopRight.className = 'meadow-hud-top-right';
        hudTopRight.innerHTML = `<span class="meadow-score-pill" hidden></span><button type="button" class="meadow-expand-btn" aria-label="초원 크게 보기">⛶ 크게 놀기</button>`;
        stageEl.appendChild(hudTopRight);

        const scorePill = hudTopRight.querySelector('.meadow-score-pill');
        const expandBtn = hudTopRight.querySelector('.meadow-expand-btn');

        const showGiftChest = opts.showGiftChest !== false;
        const giftFloatBtn = document.createElement('button');
        giftFloatBtn.type = 'button';
        giftFloatBtn.className = 'meadow-gift-chest';
        giftFloatBtn.hidden = true;
        giftFloatBtn.setAttribute('aria-label', '친구가 보낸 선물 상자 열기');
        if (showGiftChest) stageEl.appendChild(giftFloatBtn);

        let mode = 'pet';
        let armedSnack = { id: 'apple', emoji: '🍎', name: '사과열매' };
        let feedBusy = false;
        let isFullscreen = false;
        const dragState = { active: false, actor: null, pointerId: null, startX: 0, startY: 0, actorStartX: 0, actorStartY: 0, moved: false };
        const ballDrag = { active: false, pointerId: null, lastX: 0, lastY: 0, vx: 0, vy: 0 };

        function getActorCenter(actor) {
            const m = meadowCtrl.getMetrics();
            return { cx: m.actorsOffsetLeft + actor.x + m.walkerWidth * 0.5, cy: m.actorsOffsetTop + actor.y + m.walkerHeight * 0.62 };
        }

        function updateScorePill(scores) {
            const sc = scores || world?.getScores?.() || { rallyScore: 0, bubbleCombo: 0 };
            if (mode === 'ball') { scorePill.hidden = false; scorePill.textContent = `⚽ ${sc.rallyScore}`; }
            else if (mode === 'bubble') { scorePill.hidden = false; scorePill.textContent = `🫧 ${sc.bubbleCombo}`; }
            else { scorePill.hidden = true; scorePill.textContent = ''; }
        }

        const world = window.PokemonMeadowToys?.createWorld?.({
            stageEl, meadowCtrl, getCenter: getActorCenter, onScoreUpdate: updateScorePill,
            onEatSnack(sn) {
                if (!feedBusy && typeof opts.onFeedSnack === 'function') {
                    feedBusy = true;
                    Promise.resolve(opts.onFeedSnack(sn.eater.buddy?.id, sn.snackId)).finally(() => { feedBusy = false; });
                }
            }
        }) || null;

        function resizeCanvas() {
            const w = Math.max(240, stageEl.clientWidth || 320);
            const h = Math.max(160, stageEl.clientHeight || 260);
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
                canvas.width = Math.round(w * dpr);
                canvas.height = Math.round(h * dpr);
            }
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            return { w, h };
        }

        function setMode(nextMode, snackMeta) {
            mode = nextMode || 'pet';
            if (snackMeta) armedSnack = snackMeta;
            stageEl.classList.toggle('is-mode-ball', mode === 'ball');
            stageEl.classList.toggle('is-mode-bubble', mode === 'bubble');
            stageEl.classList.toggle('is-mode-feed', mode === 'feed');
            if (mode === 'ball') world?.resetBall?.(); else world?.clearBall?.();
            if (mode === 'bubble') world?.resetBubbles?.(); else world?.clearBubbles?.();
            updateScorePill();
            if (typeof opts.onModeChange === 'function') opts.onModeChange(mode, armedSnack);
        }

        function summonAllTo(stageX, stageY) {
            const m = meadowCtrl.getMetrics();
            world?.addRing?.(stageX, stageY, '#fde047');
            window.StudyFx?.whistle?.();
            meadowCtrl.actors.forEach((a, idx) => {
                const offX = (idx - (meadowCtrl.actors.length - 1) * 0.5) * 26;
                const offY = ((idx % 2) - 0.5) * 14;
                meadowCtrl.steerActorTo(a, stageX - m.actorsOffsetLeft + offX, stageY - m.actorsOffsetTop + offY, 2.05);
                if (idx === 0 || Math.random() < 0.45) {
                    meadowCtrl.showBubble(a, COME_CHANTS[(idx + Math.floor(Math.random() * COME_CHANTS.length)) % COME_CHANTS.length], 1.8);
                }
            });
        }

        function throwSnackAt(stageX, stageY, preferredActor) {
            if (feedBusy || !world) return;
            const actors = meadowCtrl.actors || [];
            if (!actors.length) return;
            const m = meadowCtrl.getMetrics();
            const w = stageEl.clientWidth || 320;
            const h = stageEl.clientHeight || 260;

            let eater = (preferredActor && !preferredActor.buddy?.isGuest)
                ? preferredActor
                : (actors.find((a) => !a.buddy?.isGuest && a.buddy?.isPartner) || actors.find((a) => !a.buddy?.isGuest) || actors[0]);
            if ((!preferredActor || preferredActor.buddy?.isGuest) && actors.length > 1) {
                let bestDist = Infinity;
                for (const a of actors) {
                    if (a.buddy?.isGuest) continue;
                    const c = getActorCenter(a);
                    const d = Math.hypot(c.cx - stageX, c.cy - stageY) * (a.buddy?.isPartner ? 0.72 : 1);
                    if (d < bestDist) { bestDist = d; eater = a; }
                }
            }

            const ex = Math.max(28, Math.min(w - 28, stageX));
            const ey = Math.max(m.actorsOffsetTop + 28, Math.min(h - 22, stageY));
            window.StudyFx?.tap?.();
            world.addSnack({ sx: w * 0.5, sy: h - 10, x: w * 0.5, y: h - 10, ex, ey, t: 0, flightDur: 0.36, landed: false, eaten: false, emoji: armedSnack.emoji || '🍎', snackId: armedSnack.id || 'apple', eater });
            meadowCtrl.showBubble(eater, '와! 간식이다! 👀', 1.6);
            meadowCtrl.steerActorTo(eater, ex - m.actorsOffsetLeft, ey - m.actorsOffsetTop, 2.35);
        }

        function getStagePoint(e) {
            const rect = stageEl.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        const onPointerDown = (e) => {
            if (e.target.closest('button.meadow-expand-btn, button.meadow-gift-chest')) return;
            const pt = getStagePoint(e);
            if (mode === 'bubble' && world) {
                for (let i = world.bubbles.length - 1; i >= 0; i--) {
                    const b = world.bubbles[i];
                    if (Math.hypot(pt.x - b.x, pt.y - b.y) <= b.r + 22) { world.popBubble(b); return; }
                }
                world.spawnBubble(false); window.StudyFx?.tap?.(); return;
            }
            if (mode === 'ball' && world) {
                const ball = world.getBall();
                if (ball && Math.hypot(pt.x - ball.x, pt.y - ball.y) <= ball.r + 28) {
                    ballDrag.active = true; ballDrag.pointerId = e.pointerId; ballDrag.lastX = pt.x; ballDrag.lastY = pt.y;
                    stageEl.setPointerCapture?.(e.pointerId);
                } else {
                    world.kickBallToward(pt.x, pt.y);
                }
                return;
            }
            const walkerEl = e.target.closest('.pokemon-meadow__walker');
            if (mode === 'feed') {
                const clicked = walkerEl ? meadowCtrl.actors.find((a) => a.walker === walkerEl) : null;
                throwSnackAt(pt.x, pt.y, clicked);
                if (clicked) clicked._suppressClickUntil = performance.now() + 260;
                return;
            }
            if (walkerEl) {
                const actor = meadowCtrl.actors.find((a) => a.walker === walkerEl);
                if (!actor) return;
                dragState.active = true; dragState.actor = actor; dragState.pointerId = e.pointerId;
                dragState.startX = e.clientX; dragState.startY = e.clientY;
                dragState.actorStartX = actor.x; dragState.actorStartY = actor.y; dragState.moved = false;
                stageEl.setPointerCapture?.(e.pointerId);
                return;
            }
            summonAllTo(pt.x, pt.y);
        };

        const onPointerMove = (e) => {
            const ball = world?.getBall?.();
            if (ballDrag.active && e.pointerId === ballDrag.pointerId && ball) {
                const pt = getStagePoint(e);
                ballDrag.vx = (pt.x - ballDrag.lastX) * 28; ballDrag.vy = (pt.y - ballDrag.lastY) * 28;
                ball.x = pt.x; ball.y = pt.y; ballDrag.lastX = pt.x; ballDrag.lastY = pt.y;
                return;
            }
            if (!dragState.active || e.pointerId !== dragState.pointerId || !dragState.actor) return;
            const dx = e.clientX - dragState.startX; const dy = e.clientY - dragState.startY;
            if (!dragState.moved && Math.hypot(dx, dy) > 9) {
                dragState.moved = true; dragState.actor.lockedPos = true; dragState.actor.walker.classList.add('is-dragging');
            }
            if (dragState.moved) meadowCtrl.setActorPos(dragState.actor, dragState.actorStartX + dx, dragState.actorStartY + dy);
        };

        const finishDrag = (e) => {
            if (ballDrag.active && e.pointerId === ballDrag.pointerId) {
                ballDrag.active = false;
                const ball = world?.getBall?.();
                if (ball) { ball.vx = Math.max(-360, Math.min(360, ballDrag.vx)); ball.vy = Math.max(-380, Math.min(-160, ballDrag.vy || -240)); window.StudyFx?.bounce?.(); }
            }
            if (!dragState.active || e.pointerId !== dragState.pointerId) return;
            const a = dragState.actor; dragState.active = false; dragState.actor = null;
            if (a) {
                a.lockedPos = false; a.walker.classList.remove('is-dragging');
                if (dragState.moved) {
                    a._suppressClickUntil = performance.now() + 260;
                    meadowCtrl.celebrateActor(a); meadowCtrl.showBubble(a, '우와, 둥실둥실! ✨', 1.6); window.StudyFx?.bounce?.();
                }
            }
        };

        const toggleFullscreen = (forceVal) => {
            const card = document.getElementById('pokemonCompanionCard') || stageEl.closest('.study-card');
            if (!card) return;
            isFullscreen = typeof forceVal === 'boolean' ? forceVal : !isFullscreen;
            card.classList.toggle('is-meadow-fullscreen', isFullscreen);
            document.documentElement.classList.toggle('has-meadow-fullscreen', isFullscreen);
            expandBtn.textContent = isFullscreen ? '✖️ 줄이기' : '⛶ 크게 놀기';
            expandBtn.setAttribute('aria-label', isFullscreen ? '초원 크게 보기 닫기' : '초원 크게 보기');
            window.setTimeout(() => meadowCtrl.refresh(), 60);
        };

        const onKeyDown = (e) => { if (e.key === 'Escape' && isFullscreen) toggleFullscreen(false); };
        expandBtn.addEventListener('click', () => toggleFullscreen());
        giftFloatBtn.addEventListener('click', () => { window.StudyFx?.giftOpen?.(); opts.onOpenFirstGift?.(); });
        stageEl.addEventListener('pointerdown', onPointerDown);
        stageEl.addEventListener('pointermove', onPointerMove);
        stageEl.addEventListener('pointerup', finishDrag);
        stageEl.addEventListener('pointercancel', finishDrag);
        document.addEventListener('keydown', onKeyDown);

        meadowCtrl.setFrameHook((dt, _bounds, actors, metrics) => {
            const { w, h } = resizeCanvas();
            if (!ctx || !world) return;
            ctx.clearRect(0, 0, w, h);
            world.renderFrame(ctx, mode, dt, w, h, actors, metrics, ballDrag.active);
        });
        resizeCanvas();
        updateScorePill();

        const api = {
            setMode, setFullscreen: toggleFullscreen, getMode: () => mode,
            updateGiftChest(trades) {
                const list = Array.isArray(trades) ? trades : [];
                giftFloatBtn.hidden = list.length === 0;
                if (list.length > 0) {
                    giftFloatBtn.innerHTML = `<span class="meadow-gift-chest__box">🎁</span><span class="meadow-gift-chest__tag">${list.length}개 도착!</span>`;
                    giftFloatBtn.title = `${list[0].from_name || '친구'}의 선물 상자 열기`;
                }
            },
            throwSnackQuick(snackMeta) {
                armedSnack = snackMeta || armedSnack; mode = 'feed';
                stageEl.classList.remove('is-mode-ball', 'is-mode-bubble'); stageEl.classList.add('is-mode-feed');
                throwSnackAt((stageEl.clientWidth || 320) * (0.35 + Math.random() * 0.3), (stageEl.clientHeight || 260) * 0.68, null);
                updateScorePill();
            },
            triggerSkill(skill) {
                const actor = (meadowCtrl.actors || []).find((a) => a.isPartner) || (meadowCtrl.actors || [])[0];
                if (!actor || !skill) return;
                const c = getActorCenter(actor);
                const effMap = {
                    electric: ['#facc15', ['⚡', '✨', '💛']],
                    electric_max: ['#eab308', ['🌩️', '⚡', '💥', '✨']],
                    fire: ['#f97316', ['🔥', '✨', '🧡']],
                    fire_max: ['#ef4444', ['🌋', '🔥', '💥', '⭐']],
                    water: ['#38bdf8', ['💧', '🫧', '💙']],
                    water_max: ['#0284c7', ['🌊', '💧', '🫧', '✨']],
                    grass: ['#22c55e', ['🌿', '🍃', '💚']],
                    grass_max: ['#16a34a', ['☀️', '🌿', '🌸', '✨']],
                    psychic: ['#a855f7', ['🔮', '✨', '💜']],
                    psychic_max: ['#7e22ce', ['🌌', '🔮', '💫', '⭐']],
                    fairy: ['#ec4899', ['✨', '🌸', '💖']],
                    fairy_max: ['#db2777', ['🌈', '✨', '💖', '🌟']],
                    impact: ['#f59e0b', ['💫', '💥', '⭐']]
                };
                const [ringColor, glyphs] = effMap[skill.effect] || effMap.impact;
                const isMax = String(skill.effect || '').endsWith('_max');
                world.addRing(c.x, c.y, ringColor, isMax ? 105 : 68);
                if (isMax) world.addRing(c.x, c.y, '#ffffff', 130);
                world.spawnParticles(c.x, c.y - 10, glyphs, isMax ? 18 : 10);
                meadowCtrl.celebrateActor(actor);
                meadowCtrl.showBubble(actor, `${skill.name}! ${skill.emoji}`, 2.5);
            },
            destroy() {
                meadowCtrl.setFrameHook(null);
                stageEl.removeEventListener('pointerdown', onPointerDown);
                stageEl.removeEventListener('pointermove', onPointerMove);
                stageEl.removeEventListener('pointerup', finishDrag);
                stageEl.removeEventListener('pointercancel', finishDrag);
                document.removeEventListener('keydown', onKeyDown);
                if (isFullscreen) toggleFullscreen(false);
                canvas.remove(); hudTopRight.remove(); giftFloatBtn.remove();
                stageEl.classList.remove('is-play-enabled', 'is-mode-ball', 'is-mode-bubble', 'is-mode-feed');
            }
        };

        meadowCtrl._playDetach = () => api.destroy();
        meadowCtrl._playApi = api;
        return api;
    }

    window.PokemonMeadowPlay = { attach };
})();
