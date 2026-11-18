/**
 * ==============================================================================
 * 포켓몬 초원 장난감 물리 & 캔버스 렌더러 (pokemon-meadow-toys.js)
 * ------------------------------------------------------------------------------
 * - 공놀이 2D 바운스 + 포켓몬 패스, 비눗방울 톡톡, 간식 포물선 던지기, 파티클 효과
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    const BALL_COLORS = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f97316', '#ec4899'];
    const BALL_CHANTS = ['이얍! ⚽', '받아라! ✨', '영차! 🐾', '나이스! 🌟', '신난다! ❤️'];
    const BUBBLE_CHANTS = ['톡! 🫧', '잡았다! ✨', '무지개 방울! 🌈', '팡팡! 😄'];

    function drawBeachBall(ctx, ball) {
        const shadowScale = Math.max(0.42, 1 - (ball.groundY - ball.y) / 140);
        ctx.save();
        ctx.fillStyle = 'rgba(21, 128, 61, 0.24)';
        ctx.beginPath();
        ctx.ellipse(ball.x, ball.groundY + ball.r * 0.82, ball.r * shadowScale, ball.r * 0.32 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.translate(ball.x, ball.y);
        ctx.scale(1 + ball.squash * 0.35, 1 - ball.squash * 0.45);
        ctx.rotate(ball.angle);
        for (let k = 0; k < 6; k++) {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, ball.r, (k * Math.PI) / 3, ((k + 1) * Math.PI) / 3);
            ctx.closePath();
            ctx.fillStyle = BALL_COLORS[k];
            ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, ball.r * 0.28, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.beginPath(); ctx.arc(-ball.r * 0.28, -ball.r * 0.28, ball.r * 0.22, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(15,23,42,0.22)'; ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    function createWorld({ stageEl, meadowCtrl, getCenter, onScoreUpdate, onEatSnack }) {
        const bubbles = [];
        const rings = [];
        const particles = [];
        const droppedSnacks = [];
        let ball = null;
        let bubbleSpawnTimer = 0;
        let rallyScore = 0;
        let bubbleCombo = 0;

        function spawnParticles(x, y, glyphs, count = 7) {
            const pool = Array.isArray(glyphs) && glyphs.length ? glyphs : ['✨', '⭐', '❤️'];
            for (let i = 0; i < count; i++) {
                const ang = (-Math.PI * 0.9) + Math.random() * (Math.PI * 0.8);
                const spd = 65 + Math.random() * 110;
                particles.push({
                    x, y, vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 40, vy: Math.sin(ang) * spd - 35,
                    life: 0.75 + Math.random() * 0.3, glyph: pool[i % pool.length], size: 16 + Math.random() * 7
                });
            }
        }

        function addRing(x, y, color = '#facc15') {
            rings.push({ x, y, r: 8, maxR: 46, life: 0.55, color });
        }

        function spawnBall(x, y) {
            const w = stageEl.clientWidth || 320;
            const h = stageEl.clientHeight || 260;
            ball = {
                x: Number.isFinite(x) ? x : w * 0.5, y: Number.isFinite(y) ? y : h * 0.35,
                vx: (Math.random() - 0.5) * 140, vy: -140, r: Math.max(19, Math.min(26, w * 0.045)),
                angle: 0, groundY: Math.max(h * 0.62, Math.min(h - 28, (Number.isFinite(y) ? y : h * 0.78))),
                cooldown: 0, squash: 0
            };
        }

        function spawnBubble(randomY = false) {
            const w = stageEl.clientWidth || 320;
            const h = stageEl.clientHeight || 260;
            if (bubbles.length >= 9) return;
            bubbles.push({
                x: 28 + Math.random() * Math.max(60, w - 56),
                y: randomY ? (52 + Math.random() * (h - 90)) : (h - 24),
                r: 18 + Math.random() * 11, vy: -(24 + Math.random() * 20),
                wobblePhase: Math.random() * Math.PI * 2, hue: Math.floor(Math.random() * 360), popped: false
            });
        }

        function popBubble(b) {
            if (!b || b.popped) return;
            b.popped = true;
            bubbleCombo += 1;
            onScoreUpdate?.({ rallyScore, bubbleCombo });
            window.StudyFx?.bubblePop?.(bubbleCombo);
            addRing(b.x, b.y, '#7dd3fc');
            spawnParticles(b.x, b.y, ['🫧', '✨', '🌈'], 5);
        }

        function kickBallToward(px, py) {
            if (!ball) spawnBall(px, py);
            const h = stageEl.clientHeight || 260;
            const dx = (ball.x - px) || (Math.random() - 0.5) * 40;
            const dy = (ball.y - py) || -30;
            const len = Math.max(12, Math.hypot(dx, dy));
            ball.vx = Math.max(-340, Math.min(340, (dx / len) * 195));
            ball.vy = Math.max(-390, Math.min(-180, -240 + (dy / len) * 80));
            ball.groundY = Math.max(h * 0.62, Math.min(h - 24, py + 24));
            ball.squash = 0.28;
            window.StudyFx?.bounce?.();
            addRing(ball.x, ball.y, '#fb923c');
        }

        function stepBall(ctx, dt, w, h, actors, metrics, ballDragging) {
            if (!ball) return;
            if (ball.cooldown > 0) ball.cooldown -= dt;
            if (ball.squash > 0) ball.squash = Math.max(0, ball.squash - dt * 1.8);

            if (!ballDragging) {
                ball.vy += 540 * dt;
                ball.x += ball.vx * dt;
                ball.y += ball.vy * dt;
                ball.vx *= Math.pow(0.82, dt);
                ball.angle += (ball.vx * 0.025) * dt;
                const pad = ball.r + 6;
                if (ball.x < pad) { ball.x = pad; ball.vx = Math.abs(ball.vx) * 0.84; window.StudyFx?.bounce?.(); }
                if (ball.x > w - pad) { ball.x = w - pad; ball.vx = -Math.abs(ball.vx) * 0.84; window.StudyFx?.bounce?.(); }
                if (ball.y < 36 + pad) { ball.y = 36 + pad; ball.vy = Math.abs(ball.vy) * 0.72; }
                if (ball.y >= ball.groundY) {
                    ball.y = ball.groundY;
                    if (Math.abs(ball.vy) > 65) { ball.vy = -Math.abs(ball.vy) * 0.68; ball.squash = 0.24; window.StudyFx?.bounce?.(); }
                    else ball.vy = 0;
                }
            }

            if (actors.length > 0 && ball.cooldown <= 0) {
                let chaser = null; let bestD = Infinity;
                for (const a of actors) {
                    if (a.lockedPos) continue;
                    const c = getCenter(a);
                    const d = Math.hypot(c.cx - ball.x, c.cy - ball.y);
                    if (d < bestD) { bestD = d; chaser = a; }
                }
                if (chaser) {
                    meadowCtrl.steerActorTo(chaser, ball.x - metrics.actorsOffsetLeft, Math.max(20, ball.groundY - metrics.actorsOffsetTop), 2.15);
                    if (bestD < 36) {
                        ball.cooldown = 0.65;
                        const targetX = ball.x < w * 0.5 ? w * (0.55 + Math.random() * 0.32) : w * (0.14 + Math.random() * 0.32);
                        ball.vx = (targetX - ball.x) * 1.45;
                        ball.vy = -(250 + Math.random() * 90);
                        ball.groundY = Math.max(h * 0.58, Math.min(h - 24, h * 0.62 + Math.random() * h * 0.28));
                        ball.squash = 0.32;
                        rallyScore += 1;
                        onScoreUpdate?.({ rallyScore, bubbleCombo });
                        meadowCtrl.celebrateActor(chaser);
                        meadowCtrl.showBubble(chaser, BALL_CHANTS[rallyScore % BALL_CHANTS.length], 1.7);
                        window.StudyFx?.bounce?.();
                        if (rallyScore % 5 === 0) window.StudyFx?.correct?.();
                        spawnParticles(ball.x, ball.y - 10, ['⭐', '✨', '⚽'], 6);
                    }
                }
            }
            drawBeachBall(ctx, ball);
        }

        function stepBubbles(ctx, dt, h, actors) {
            bubbleSpawnTimer += dt;
            if (bubbleSpawnTimer >= 0.72) { bubbleSpawnTimer = 0; spawnBubble(false); }
            for (let i = bubbles.length - 1; i >= 0; i--) {
                const b = bubbles[i];
                b.wobblePhase += dt * 2.6;
                b.x += Math.sin(b.wobblePhase) * 16 * dt;
                b.y += b.vy * dt;
                if (!b.popped && b.y > h * 0.46) {
                    for (const a of actors) {
                        const c = getCenter(a);
                        if (Math.hypot(c.cx - b.x, c.cy - b.y) < b.r + 24) {
                            popBubble(b); meadowCtrl.celebrateActor(a);
                            if (Math.random() < 0.45) meadowCtrl.showBubble(a, BUBBLE_CHANTS[bubbleCombo % BUBBLE_CHANTS.length], 1.5);
                            break;
                        }
                    }
                }
                if (b.popped || b.y < -b.r - 10) { bubbles.splice(i, 1); continue; }
                ctx.save();
                const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, 2, b.x, b.y, b.r);
                grad.addColorStop(0, 'rgba(255,255,255,0.92)');
                grad.addColorStop(0.55, `hsla(${b.hue}, 90%, 75%, 0.32)`);
                grad.addColorStop(1, `hsla(${(b.hue + 60) % 360}, 95%, 68%, 0.62)`);
                ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
                ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
                ctx.restore();
            }
        }

        function stepSnacks(ctx, dt, metrics) {
            for (let i = droppedSnacks.length - 1; i >= 0; i--) {
                const sn = droppedSnacks[i];
                if (!sn.landed) {
                    sn.t += dt / sn.flightDur;
                    const p = Math.min(1, sn.t);
                    sn.x = sn.sx + (sn.ex - sn.sx) * p;
                    sn.y = sn.sy + (sn.ey - sn.sy) * p - Math.sin(p * Math.PI) * 58;
                    if (p >= 1) { sn.landed = true; sn.x = sn.ex; sn.y = sn.ey; addRing(sn.x, sn.y, '#f97316'); }
                } else if (!sn.eaten) {
                    const c = getCenter(sn.eater);
                    if (Math.hypot(c.cx - sn.x, c.cy - sn.y) < 38 || sn.waitSec > 1.8) {
                        sn.eaten = true;
                        window.StudyFx?.munch?.();
                        meadowCtrl.celebrateActor(sn.eater);
                        meadowCtrl.showBubble(sn.eater, `${sn.emoji} 냠냠! 최고예요! ❤️`, 2.3);
                        spawnParticles(sn.x, sn.y - 12, [sn.emoji, '❤️', '✨'], 7);
                        onEatSnack?.(sn);
                        droppedSnacks.splice(i, 1);
                        continue;
                    }
                    sn.waitSec = (sn.waitSec || 0) + dt;
                    meadowCtrl.steerActorTo(sn.eater, sn.x - metrics.actorsOffsetLeft, sn.y - metrics.actorsOffsetTop, 2.35);
                }
                ctx.save();
                ctx.fillStyle = 'rgba(21,128,61,0.22)'; ctx.beginPath(); ctx.ellipse(sn.ex, sn.ey + 10, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
                ctx.font = '28px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sn.emoji, sn.x, sn.y);
                ctx.restore();
            }
        }

        function stepFxLayer(ctx, dt) {
            for (let i = rings.length - 1; i >= 0; i--) {
                const r = rings[i]; r.life -= dt;
                if (r.life <= 0) { rings.splice(i, 1); continue; }
                const prog = 1 - r.life / 0.55;
                ctx.save(); ctx.globalAlpha = Math.max(0, 1 - prog); ctx.strokeStyle = r.color; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(r.x, r.y, r.r + (r.maxR - r.r) * prog, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            }
            for (let i = particles.length - 1; i >= 0; i--) {
                const pt = particles[i]; pt.life -= dt;
                if (pt.life <= 0) { particles.splice(i, 1); continue; }
                pt.vy += 260 * dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
                ctx.save(); ctx.globalAlpha = Math.min(1, pt.life * 1.4);
                ctx.font = `${Math.round(pt.size)}px system-ui, "Apple Color Emoji", sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pt.glyph, pt.x, pt.y); ctx.restore();
            }
        }

        return {
            bubbles, droppedSnacks,
            getBall: () => ball,
            getScores: () => ({ rallyScore, bubbleCombo }),
            resetBall() { rallyScore = 0; spawnBall(); },
            clearBall() { ball = null; },
            resetBubbles() { bubbles.length = 0; for (let i = 0; i < 5; i++) spawnBubble(true); },
            clearBubbles() { bubbles.length = 0; },
            spawnBubble, popBubble, spawnParticles, addRing, kickBallToward,
            addSnack(s) { droppedSnacks.push(s); },
            renderFrame(ctx, mode, dt, w, h, actors, metrics, ballDragging) {
                if (mode === 'ball') stepBall(ctx, dt, w, h, actors, metrics, ballDragging);
                if (mode === 'bubble') stepBubbles(ctx, dt, h, actors);
                stepSnacks(ctx, dt, metrics);
                stepFxLayer(ctx, dt);
            }
        };
    }

    window.PokemonMeadowToys = { createWorld };
})();
