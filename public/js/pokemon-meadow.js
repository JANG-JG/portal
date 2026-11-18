/**
 * ==============================================================================
 * 포켓몬 초원 들판 산책 엔진 (pokemon-meadow.js)
 * ------------------------------------------------------------------------------
 * - 학습실(/study) & 포털 메인(/) 공용 초원 들판 스테이지
 * - translate3d + scaleX 기반 컴포지터 무브먼트 (리플로우 0%)
 * - prefers-reduced-motion / 수동 멈춤 / 백그라운드 탭 자동 정지
 * ==============================================================================
 */
(function () {
    'use strict';

    const DEFAULT_CHEERS = [
        '오늘도 힘차게 출발!',
        '같이 초원을 산책해요 🌿',
        '칭찬 도장 모으자 ✨',
        '반가워요! ❤️',
        '햇살이 정말 따뜻해요 ☀️'
    ];

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function prefersReducedMotion() {
        try {
            return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_) {
            return false;
        }
    }

    function buildMeadowBackdropSvg() {
        return `<div class="pokemon-meadow__sky" aria-hidden="true"><div class="pokemon-meadow__sun"></div>
            <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--1" viewBox="0 0 80 30"><path d="M16 25 H65 C72 25 76 20 75 15 C74 10 68 8 63 10 C60 4 51 2 44 6 C38 2 27 4 24 11 C17 10 10 14 10 19 C10 23 13 25 16 25 Z" fill="#ffffff" fill-opacity="0.92"/></svg>
            <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--2" viewBox="0 0 80 30"><path d="M15 24 H64 C70 24 73 20 72 15 C71 11 66 9 61 11 C58 5 49 4 42 8 C36 4 26 6 23 12 C16 11 11 15 11 19 C11 22 13 24 15 24 Z" fill="#ffffff" fill-opacity="0.86"/></svg></div>
        <svg class="pokemon-meadow__hills" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 44 Q130 12 270 38 T540 28 L600 32 L600 110 L0 110 Z" fill="#86efac" fill-opacity="0.55"/>
            <path d="M0 62 Q160 36 330 60 T600 50 L600 110 L0 110 Z" fill="#4ade80" fill-opacity="0.48"/>
            <path d="M0 84 Q180 72 340 86 T600 80 L600 110 L0 110 Z" fill="#bef264" fill-opacity="0.45"/>
            <g stroke="#16a34a" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.58">
                <path d="M46 98 L42 88 M46 98 L48 86 M46 98 L52 90"/><path d="M188 94 L184 85 M188 94 L190 83 M188 94 L194 87"/>
                <path d="M362 96 L358 86 M362 96 L364 84 M362 96 L369 89"/><path d="M518 92 L514 83 M518 92 L520 81 M518 92 L524 85"/>
            </g>
            <g>
                <circle cx="94" cy="86" r="3.5" fill="#fef08a"/><circle cx="94" cy="86" r="1.4" fill="#f97316"/>
                <circle cx="256" cy="92" r="3.5" fill="#fbcfe8"/><circle cx="256" cy="92" r="1.4" fill="#db2777"/>
                <circle cx="430" cy="84" r="3.5" fill="#ffffff"/><circle cx="430" cy="84" r="1.4" fill="#facc15"/>
                <circle cx="558" cy="96" r="3.2" fill="#fde047"/><circle cx="558" cy="96" r="1.3" fill="#ea580c"/>
            </g>
        </svg>`;
    }

    function spawnSparks(fxLayer, xCenter, yBottom) {
        if (!fxLayer) return;
        const icons = ['❤️', '✨', '🍀'];
        icons.forEach((glyph, idx) => {
            const span = document.createElement('span');
            span.className = 'pokemon-meadow__spark';
            span.textContent = glyph;
            span.style.left = `${Math.round(xCenter)}px`;
            span.style.bottom = `${Math.round(yBottom)}px`;
            span.style.setProperty('--mdx', `${(idx - 1) * 16}px`);
            fxLayer.appendChild(span);
            window.setTimeout(() => span.remove(), 900);
        });
    }

    function mount(containerEl, options) {
        if (!containerEl) return null;
        if (typeof containerEl._meadowCleanup === 'function') {
            containerEl._meadowCleanup();
        }

        const opts = options || {};
        const buddies = Array.isArray(opts.buddies) ? opts.buddies.slice(0, 8) : [];
        const compact = Boolean(opts.compact);
        const spacious = Boolean(opts.spacious) || !compact;
        const sizeClass = compact ? 'pokemon-meadow--compact' : (spacious ? 'pokemon-meadow--spacious' : '');
        const title = opts.title || '🌿 포켓몬 초원 놀이터';
        const emptyText = opts.emptyText || '도장 10칸을 모으면 첫 포켓몬이 초원에서 뛰어놀아요!';
        const footerHint = opts.footerHint || '포켓몬을 톡 눌러 인사해 보세요!';

        containerEl.innerHTML = `
            <div class="pokemon-meadow ${sizeClass} ${opts.paused ? 'is-motion-paused' : ''}" role="region" aria-label="${esc(title)}">
                ${buildMeadowBackdropSvg()}
                <div class="pokemon-meadow__header">${esc(title)}</div>
                <div class="pokemon-meadow__actors"></div>
                ${buddies.length === 0 ? `
                    <div class="pokemon-meadow__empty">
                        <div class="pokemon-meadow__empty-nest" aria-hidden="true">🥚🌱</div>
                        <div class="pokemon-meadow__empty-text">${esc(emptyText)}</div>
                    </div>` : ''}
                <div class="pokemon-meadow__fx" aria-hidden="true"></div>
            </div>
            ${buddies.length > 0 && footerHint ? `<div class="pokemon-meadow__hint-footer">${esc(footerHint)}</div>` : ''}
        `;

        const stageEl = containerEl.querySelector('.pokemon-meadow');
        const actorsEl = containerEl.querySelector('.pokemon-meadow__actors');
        const fxEl = containerEl.querySelector('.pokemon-meadow__fx');
        if (!stageEl || !actorsEl) return null;

        let actorsWidth = 300;
        let actorsHeight = 180;
        let stageHeight = 256;
        let actorsOffsetLeft = 8;
        let actorsOffsetTop = 48;
        let walkerWidth = 82;
        let walkerHeight = 86;

        function measureBounds() {
            const smallScreen = window.innerWidth <= 420;
            walkerWidth = smallScreen ? 74 : (spacious && !compact ? 92 : 82);
            walkerHeight = smallScreen ? 82 : (spacious && !compact ? 96 : 86);
            stageHeight = Math.max(160, stageEl.clientHeight || 256);
            actorsWidth = Math.max(220, actorsEl.clientWidth || (stageEl.clientWidth - 16) || 300);
            actorsHeight = Math.max(108, actorsEl.clientHeight || (stageHeight - 56) || 180);
            actorsOffsetLeft = actorsEl.offsetLeft || 8;
            actorsOffsetTop = actorsEl.offsetTop || 48;
        }

        function getLimits() {
            const minX = 4;
            const minY = 6;
            const maxX = Math.max(minX + 8, actorsWidth - walkerWidth - 4);
            const maxY = Math.max(minY + 8, actorsHeight - walkerHeight - 2);
            return { minX, maxX, minY, maxY };
        }

        const showActorBubble = (actor, msg, sec = 2.4) => {
            if (!actor.bubbleEl) return;
            actor.bubbleEl.textContent = msg;
            actor.walker.classList.add('has-bubble');
            actor.bubbleTimer = sec;
        };

        const actors = buddies.map((buddy, index) => {
            const walker = document.createElement('div');
            walker.className = `pokemon-meadow__walker is-resting ${buddy.isPartner ? 'is-partner' : ''} ${buddy.isGuest ? 'is-guest' : ''}`;
            const tagText = buddy.label || buddy.nameKo || '포켓몬';
            const tagIcon = buddy.isGuest ? '🏠 ' : (buddy.isPartner ? '⭐ ' : '');
            walker.innerHTML = `
                <div class="pokemon-meadow__bubble" aria-hidden="true"></div>
                <button type="button" class="pokemon-meadow__btn" aria-label="${esc(tagText)} — 눌러서 인사하기">
                    <div class="pokemon-meadow__shadow" aria-hidden="true"></div>
                    <div class="pokemon-meadow__sprite-flip">
                        <img class="pokemon-meadow__sprite-img" src="${esc(buddy.artworkUrl || buddy.animatedUrl)}" data-fallback="${esc(buddy.animatedUrl || '')}" alt="${esc(buddy.nameKo || '포켓몬')}">
                    </div>
                </button>
                <span class="pokemon-meadow__tag ${buddy.isGuest ? 'pokemon-meadow__tag--guest' : ''}">${tagIcon}${esc(tagText)}</span>
            `;

            const img = walker.querySelector('img');
            img?.addEventListener('error', () => {
                if (img.dataset.triedFallback !== '1' && img.dataset.fallback) { img.dataset.triedFallback = '1'; img.src = img.dataset.fallback; }
            });

            const actor = {
                buddy, walker, flipEl: walker.querySelector('.pokemon-meadow__sprite-flip'), bubbleEl: walker.querySelector('.pokemon-meadow__bubble'),
                x: 12 + index * 54, y: 12 + (index % 3) * 32, targetX: 20 + index * 54, targetY: 12 + (index % 3) * 32,
                facing: index % 2 === 0 ? -1 : 1, speed: 28 + ((index * 9) % 16), speedBoost: 1, lockedPos: false,
                mode: 'rest', restTimer: 0.35 + index * 0.45, bubbleTimer: 0, greetCooldown: 0, lastZ: -1, edgeState: '', _suppressClickUntil: 0
            };

            walker.querySelector('.pokemon-meadow__btn')?.addEventListener('click', () => {
                if (actor._suppressClickUntil && performance.now() < actor._suppressClickUntil) return;
                walker.classList.remove('is-tapped');
                void walker.offsetWidth;
                walker.classList.add('is-tapped');
                window.setTimeout(() => walker.classList.remove('is-tapped'), 540);

                const cheers = Array.isArray(buddy.cheers) && buddy.cheers.length > 0 ? buddy.cheers : DEFAULT_CHEERS;
                const msg = cheers[Math.floor(Math.random() * cheers.length)];
                showActorBubble(actor, msg, 2.4);
                spawnSparks(fxEl, actorsOffsetLeft + actor.x + walkerWidth * 0.5, Math.max(36, stageHeight - (actorsOffsetTop + actor.y + walkerHeight * 0.5)));
                window.StudyFx?.playTone?.(659.25, 0.07, 'triangle');
                if (typeof opts.onTap === 'function') opts.onTap(buddy, msg, actor);
            });

            actorsEl.appendChild(walker);
            return actor;
        });

        let manualPaused = Boolean(opts.paused);
        let contentSkipped = false;
        let frameHook = typeof opts.onFrame === 'function' ? opts.onFrame : null;
        let rafId = 0;
        let lastTs = 0;
        let disposed = false;

        function applyActorPose(actor, bounds) {
            actor.walker.style.transform = `translate3d(${actor.x.toFixed(1)}px, ${actor.y.toFixed(1)}px, 0)`;
            const nextZ = 2 + Math.round(actor.y / 6);
            if (nextZ !== actor.lastZ) {
                actor.lastZ = nextZ;
                actor.walker.style.zIndex = String(nextZ);
            }
            const nextEdge = actor.x < bounds.minX + 36
                ? 'left'
                : (actor.x > bounds.maxX - 36 ? 'right' : '');
            if (nextEdge !== actor.edgeState) {
                actor.edgeState = nextEdge;
                actor.walker.classList.toggle('is-near-left', nextEdge === 'left');
                actor.walker.classList.toggle('is-near-right', nextEdge === 'right');
            }
        }

        function layoutInitialPositions() {
            const bounds = getLimits();
            const count = actors.length;
            if (count === 0) return;
            const spanX = Math.max(1, bounds.maxX - bounds.minX);
            const spanY = Math.max(1, bounds.maxY - bounds.minY);
            const yBands = count <= 2 ? [0.22, 0.78] : [0.12, 0.85, 0.48, 0.16, 0.82, 0.5, 0.24, 0.74];

            actors.forEach((a, idx) => {
                const ratioX = count === 1 ? 0.5 : (idx + 0.35) / (count - 0.3);
                const bandY = yBands[idx % yBands.length];
                a.x = Math.min(bounds.maxX, Math.max(bounds.minX, bounds.minX + spanX * Math.min(1, Math.max(0, ratioX))));
                a.y = Math.min(bounds.maxY, Math.max(bounds.minY, bounds.minY + spanY * bandY));
                a.targetX = a.x;
                a.targetY = a.y;
                applyActorPose(a, bounds);
                if (a.flipEl) {
                    a.flipEl.style.transform = `scaleX(${a.facing === 1 ? -1 : 1})`;
                }
            });
        }

        function pickNextTarget(actor, bounds) {
            const { minX, maxX, minY, maxY } = bounds;
            const spanX = Math.max(1, maxX - minX);
            const spanY = Math.max(1, maxY - minY);
            const sepX = walkerWidth * 1.08;
            const sepY = Math.max(58, walkerHeight * 0.72);
            const roll = Math.random(); // 대각선(50%), 위아래(25%), 좌우(25%)

            const candidates = [];
            for (let i = 0; i < 16; i++) {
                let cx;
                let cy;
                if (roll < 0.5) {
                    // 대각선 이동: X와 Y 모두 뚜렷하게 변화
                    cx = minX + Math.random() * spanX;
                    cy = minY + Math.random() * spanY;
                    if (Math.abs(cx - actor.x) < spanX * 0.18) {
                        cx = actor.x < (minX + maxX) * 0.5
                            ? Math.min(maxX, actor.x + spanX * (0.28 + Math.random() * 0.35))
                            : Math.max(minX, actor.x - spanX * (0.28 + Math.random() * 0.35));
                    }
                    if (Math.abs(cy - actor.y) < spanY * 0.28) {
                        cy = actor.y < (minY + maxY) * 0.5
                            ? Math.min(maxY, actor.y + spanY * (0.35 + Math.random() * 0.45))
                            : Math.max(minY, actor.y - spanY * (0.35 + Math.random() * 0.45));
                    }
                } else if (roll < 0.75) {
                    // 위아래 중심 이동 (약간의 좌우 변주 포함)
                    cx = Math.min(maxX, Math.max(minX, actor.x + (Math.random() - 0.5) * Math.min(80, spanX * 0.3)));
                    cy = actor.y < (minY + maxY) * 0.5
                        ? Math.min(maxY, minY + spanY * (0.55 + Math.random() * 0.45))
                        : Math.max(minY, minY + spanY * (Math.random() * 0.45));
                } else {
                    // 좌우 중심 이동 (약간의 위아래 변주 포함)
                    cx = actor.x < (minX + maxX) * 0.5
                        ? Math.min(maxX, actor.x + spanX * (0.32 + Math.random() * 0.45))
                        : Math.max(minX, actor.x - spanX * (0.32 + Math.random() * 0.45));
                    cy = Math.min(maxY, Math.max(minY, actor.y + (Math.random() - 0.5) * Math.min(60, spanY * 0.35)));
                }

                const travel = Math.hypot(cx - actor.x, cy - actor.y);
                let minSep = 99;
                for (const other of actors) {
                    if (other === actor) continue;
                    const curSep = Math.hypot((cx - other.x) / sepX, (cy - other.y) / sepY);
                    const tgtSep = Math.hypot((cx - other.targetX) / sepX, (cy - other.targetY) / sepY);
                    minSep = Math.min(minSep, curSep, tgtSep * 1.05);
                }
                const score = Math.min(minSep, 1.45) * 100 + Math.min(travel, 160) * 0.15;
                candidates.push({ x: cx, y: cy, score });
            }

            candidates.sort((a, b) => b.score - a.score);
            const pickPool = candidates.slice(0, Math.min(3, candidates.length));
            const chosen = pickPool[Math.floor(Math.random() * pickPool.length)] || { x: actor.x, y: actor.y };
            return {
                x: Math.min(maxX, Math.max(minX, chosen.x)),
                y: Math.min(maxY, Math.max(minY, chosen.y))
            };
        }

        function isMotionActive() {
            return !disposed && !manualPaused && !contentSkipped && !prefersReducedMotion() && !document.hidden && stageEl.offsetParent !== null;
        }

        function getMetrics() {
            return { stageHeight, actorsWidth, actorsHeight, actorsOffsetLeft, actorsOffsetTop, walkerWidth, walkerHeight };
        }

        function step(ts) {
            rafId = 0;
            if (disposed || actors.length === 0) return;
            if (!lastTs) lastTs = ts;
            const dt = Math.min(0.08, Math.max(0.008, (ts - lastTs) / 1000));
            lastTs = ts;
            if (!isMotionActive()) return;

            const bounds = getLimits();
            const avoidX = walkerWidth * 0.92;
            const avoidY = Math.max(52, walkerHeight * 0.64);
            if (typeof frameHook === 'function') frameHook(dt, bounds, actors, getMetrics());

            for (const a of actors) {
                if (a.greetCooldown > 0) a.greetCooldown -= dt;
                if (a.bubbleTimer > 0) {
                    a.bubbleTimer -= dt;
                    if (a.bubbleTimer <= 0) a.walker.classList.remove('has-bubble');
                }
                if (a.lockedPos) { applyActorPose(a, bounds); continue; }

                if (a.mode === 'rest') {
                    a.restTimer -= dt;
                    if (a.restTimer <= 0) {
                        const next = pickNextTarget(a, bounds);
                        a.targetX = next.x;
                        a.targetY = next.y;
                        a.speedBoost = 1;
                        a.walkTimer = 0;
                        a.mode = 'walk';
                        a.walker.classList.remove('is-resting');
                        a.walker.classList.add('is-walking');
                    }
                } else {
                    a.walkTimer = (a.walkTimer || 0) + dt;
                    const dx = a.targetX - a.x;
                    const dy = a.targetY - a.y;
                    const dist = Math.hypot(dx, dy);

                    if (dist <= 4.0 || a.walkTimer >= 7.5) {
                        if (dist <= 4.0) {
                            a.x = Math.min(bounds.maxX, Math.max(bounds.minX, a.targetX));
                            a.y = Math.min(bounds.maxY, Math.max(bounds.minY, a.targetY));
                        }
                        a.speedBoost = 1;
                        a.mode = 'rest';
                        a.restTimer = 0.8 + Math.random() * 1.8;
                        a.walker.classList.remove('is-walking');
                        a.walker.classList.add('is-resting');
                    } else {
                        const moveSpeed = a.speed * (a.speedBoost || 1);
                        let vx = (dx / dist) * moveSpeed;
                        let vy = (dy / dist) * moveSpeed;
                        for (const other of actors) {
                            if (other === a) continue;
                            const ox = (a.x - other.x) / avoidX;
                            const oy = (a.y - other.y) / avoidY;
                            const oDist = Math.hypot(ox, oy);
                            if (oDist > 0.01 && oDist < 1.0) {
                                const push = (1.0 - oDist) * moveSpeed * 0.85;
                                vx += (ox / oDist) * push;
                                vy += (oy / oDist) * push;
                            }
                        }
                        if (Math.abs(vx) > 4.5) {
                            const dir = vx > 0 ? 1 : -1;
                            if (a.facing !== dir) {
                                a.facing = dir;
                                if (a.flipEl) a.flipEl.style.transform = `scaleX(${dir === 1 ? -1 : 1})`;
                            }
                        }
                        a.x = Math.min(bounds.maxX, Math.max(bounds.minX, a.x + vx * dt));
                        a.y = Math.min(bounds.maxY, Math.max(bounds.minY, a.y + vy * dt));
                    }
                }
                applyActorPose(a, bounds);
            }

            for (let i = 0; i < actors.length; i++) {
                const a = actors[i];
                if (a.greetCooldown > 0 || a.bubbleTimer > 0) continue;
                for (let j = i + 1; j < actors.length; j++) {
                    const b = actors[j];
                    if (b.greetCooldown > 0 || b.bubbleTimer > 0) continue;
                    if (Math.hypot(a.x - b.x, a.y - b.y) <= walkerWidth * 0.96 && (a.buddy.isGuest || b.buddy.isGuest || Math.random() < 0.35)) {
                        a.greetCooldown = 9.0;
                        b.greetCooldown = 9.0;
                        showActorBubble(a, a.buddy.isGuest ? (a.buddy.greetingMsg || '놀러왔어! 반가워! 🏠') : '안녕! 같이 놀자! ✨', 2.6);
                        showActorBubble(b, b.buddy.isGuest ? (b.buddy.greetingMsg || '우리 같이 뛰어놀자! ✨') : '간식 나눠 먹자! 🍪', 2.6);
                        break;
                    }
                }
            }

            rafId = window.requestAnimationFrame(step);
        }

        function clampActorsToBounds(includeTarget) {
            const bounds = getLimits();
            actors.forEach((a) => {
                a.x = Math.min(bounds.maxX, Math.max(bounds.minX, a.x));
                a.y = Math.min(bounds.maxY, Math.max(bounds.minY, a.y));
                if (includeTarget) {
                    a.targetX = Math.min(bounds.maxX, Math.max(bounds.minX, a.targetX));
                    a.targetY = Math.min(bounds.maxY, Math.max(bounds.minY, a.targetY));
                }
                applyActorPose(a, bounds);
            });
        }

        function syncLoopState() {
            stageEl.classList.toggle('is-motion-paused', manualPaused || prefersReducedMotion());
            if (manualPaused || prefersReducedMotion()) {
                actors.forEach((a) => {
                    a.walker.classList.remove('is-walking');
                    a.walker.classList.add('is-resting');
                });
            }
            if (isMotionActive() && !rafId && actors.length > 0) {
                lastTs = 0;
                rafId = window.requestAnimationFrame(step);
            } else if (!isMotionActive() && rafId) {
                window.cancelAnimationFrame(rafId);
                rafId = 0;
            }
        }

        let resizeObserver = null;
        if (typeof ResizeObserver === 'function') {
            resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (entry.contentRect?.width > 80) {
                        measureBounds();
                        clampActorsToBounds(true);
                    }
                }
                syncLoopState();
            });
            resizeObserver.observe(stageEl);
        }

        const onVisibility = () => syncLoopState();
        const onCvState = (e) => { contentSkipped = Boolean(e && e.skipped); syncLoopState(); };
        document.addEventListener('visibilitychange', onVisibility);
        stageEl.addEventListener('contentvisibilityautostatechange', onCvState);

        measureBounds(); layoutInitialPositions(); syncLoopState();

        const controller = {
            stageEl, actorsEl, fxEl, actors, getMetrics, getLimits, syncLoopState,
            setPaused(paused) { manualPaused = Boolean(paused); syncLoopState(); },
            setFrameHook(fn) { frameHook = typeof fn === 'function' ? fn : null; },
            refresh() { measureBounds(); clampActorsToBounds(false); syncLoopState(); },
            showBubble(a, msg, sec = 2.4) { if (a) showActorBubble(a, msg, sec); },
            celebrateActor(a) {
                if (!a) return;
                a.walker.classList.remove('is-tapped'); void a.walker.offsetWidth; a.walker.classList.add('is-tapped');
                window.setTimeout(() => a.walker.classList.remove('is-tapped'), 540);
                spawnSparks(fxEl, actorsOffsetLeft + a.x + walkerWidth * 0.5, Math.max(36, stageHeight - (actorsOffsetTop + a.y + walkerHeight * 0.5)));
            },
            steerActorTo(a, centerX, centerY, boost = 1.9) {
                if (!a) return;
                const b = getLimits();
                a.targetX = Math.min(b.maxX, Math.max(b.minX, centerX - walkerWidth * 0.5));
                a.targetY = Math.min(b.maxY, Math.max(b.minY, centerY - walkerHeight * 0.65));
                a.speedBoost = boost; a.walkTimer = 0; a.mode = 'walk';
                a.walker.classList.remove('is-resting'); a.walker.classList.add('is-walking');
            },
            setActorPos(a, x, y) {
                const b = getLimits();
                a.x = Math.min(b.maxX, Math.max(b.minX, x)); a.y = Math.min(b.maxY, Math.max(b.minY, y));
                applyActorPose(a, b);
            },
            destroy() {
                disposed = true; frameHook = null;
                if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
                if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
                document.removeEventListener('visibilitychange', onVisibility);
                stageEl.removeEventListener('contentvisibilityautostatechange', onCvState);
            }
        };

        containerEl._meadowCleanup = () => controller.destroy();
        containerEl._meadowController = controller;
        return controller;
    }

    window.PokemonMeadow = { mount };
})();
