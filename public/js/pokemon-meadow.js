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
        return `
        <div class="pokemon-meadow__sky" aria-hidden="true">
            <div class="pokemon-meadow__sun"></div>
            <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--1" viewBox="0 0 80 30">
                <path d="M16 25 H65 C72 25 76 20 75 15 C74 10 68 8 63 10 C60 4 51 2 44 6 C38 2 27 4 24 11 C17 10 10 14 10 19 C10 23 13 25 16 25 Z" fill="#ffffff" fill-opacity="0.92"/>
            </svg>
            <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--2" viewBox="0 0 80 30">
                <path d="M15 24 H64 C70 24 73 20 72 15 C71 11 66 9 61 11 C58 5 49 4 42 8 C36 4 26 6 23 12 C16 11 11 15 11 19 C11 22 13 24 15 24 Z" fill="#ffffff" fill-opacity="0.86"/>
            </svg>
        </div>
        <svg class="pokemon-meadow__hills" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 44 Q130 12 270 38 T540 28 L600 32 L600 110 L0 110 Z" fill="#86efac" fill-opacity="0.55"/>
            <path d="M0 62 Q160 36 330 60 T600 50 L600 110 L0 110 Z" fill="#4ade80" fill-opacity="0.48"/>
            <path d="M0 84 Q180 72 340 86 T600 80 L600 110 L0 110 Z" fill="#bef264" fill-opacity="0.45"/>
            <!-- 들판 풀잎 & 작은 꽃들 -->
            <g stroke="#16a34a" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.58">
                <path d="M46 98 L42 88 M46 98 L48 86 M46 98 L52 90"/>
                <path d="M188 94 L184 85 M188 94 L190 83 M188 94 L194 87"/>
                <path d="M362 96 L358 86 M362 96 L364 84 M362 96 L369 89"/>
                <path d="M518 92 L514 83 M518 92 L520 81 M518 92 L524 85"/>
            </g>
            <g>
                <circle cx="94" cy="86" r="3.5" fill="#fef08a"/>
                <circle cx="94" cy="86" r="1.4" fill="#f97316"/>
                <circle cx="256" cy="92" r="3.5" fill="#fbcfe8"/>
                <circle cx="256" cy="92" r="1.4" fill="#db2777"/>
                <circle cx="430" cy="84" r="3.5" fill="#ffffff"/>
                <circle cx="430" cy="84" r="1.4" fill="#facc15"/>
                <circle cx="558" cy="96" r="3.2" fill="#fde047"/>
                <circle cx="558" cy="96" r="1.3" fill="#ea580c"/>
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
        const title = opts.title || '🌿 포켓몬 초원 놀이터';
        const emptyText = opts.emptyText || '도장 10칸을 모으면 첫 포켓몬이 초원에서 뛰어놀아요!';
        const footerHint = opts.footerHint || '포켓몬을 톡 눌러 인사해 보세요!';

        containerEl.innerHTML = `
            <div class="pokemon-meadow ${compact ? 'pokemon-meadow--compact' : ''} ${opts.paused ? 'is-motion-paused' : ''}" role="region" aria-label="${esc(title)}">
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

        const walkerWidth = window.innerWidth <= 420 ? 70 : 78;
        const actors = buddies.map((buddy, index) => {
            const walker = document.createElement('div');
            walker.className = `pokemon-meadow__walker is-resting ${buddy.isPartner ? 'is-partner' : ''}`;
            walker.dataset.lane = index % 2 === 0 ? 'front' : 'back';
            const tagText = buddy.label || buddy.nameKo || '포켓몬';
            const spriteAlt = buddy.nameKo || '포켓몬';

            walker.innerHTML = `
                <div class="pokemon-meadow__bubble" aria-hidden="true"></div>
                <button type="button" class="pokemon-meadow__btn" aria-label="${esc(tagText)} — 눌러서 인사하기">
                    <div class="pokemon-meadow__shadow" aria-hidden="true"></div>
                    <div class="pokemon-meadow__sprite-flip">
                        <img class="pokemon-meadow__sprite-img"
                             src="${esc(buddy.artworkUrl || buddy.animatedUrl)}"
                             data-fallback="${esc(buddy.animatedUrl || '')}"
                             alt="${esc(spriteAlt)}">
                    </div>
                </button>
                <span class="pokemon-meadow__tag">${buddy.isPartner ? '⭐ ' : ''}${esc(tagText)}</span>
            `;

            const img = walker.querySelector('img');
            if (img) {
                img.addEventListener('error', () => {
                    if (img.dataset.triedFallback === '1') return;
                    img.dataset.triedFallback = '1';
                    if (img.dataset.fallback) img.src = img.dataset.fallback;
                });
            }

            const flipEl = walker.querySelector('.pokemon-meadow__sprite-flip');
            const bubbleEl = walker.querySelector('.pokemon-meadow__bubble');
            const btnEl = walker.querySelector('.pokemon-meadow__btn');

            const actor = {
                buddy,
                walker,
                flipEl,
                bubbleEl,
                x: 12 + index * 54,
                targetX: 20 + index * 54,
                facing: index % 2 === 0 ? -1 : 1, // 1: 우측, -1: 좌측
                speed: 22 + ((index * 7) % 15),
                mode: 'rest',
                restTimer: 0.4 + index * 0.55,
                bubbleTimer: 0
            };

            btnEl?.addEventListener('click', () => {
                walker.classList.remove('is-tapped');
                void walker.offsetWidth;
                walker.classList.add('is-tapped');
                window.setTimeout(() => walker.classList.remove('is-tapped'), 540);

                const cheers = Array.isArray(buddy.cheers) && buddy.cheers.length > 0 ? buddy.cheers : DEFAULT_CHEERS;
                const msg = cheers[Math.floor(Math.random() * cheers.length)];
                if (bubbleEl) {
                    bubbleEl.textContent = msg;
                    walker.classList.add('has-bubble');
                    actor.bubbleTimer = 2.4;
                }
                spawnSparks(fxEl, actor.x + walkerWidth * 0.5, walker.dataset.lane === 'back' ? 56 : 42);

                if (window.StudyFx && typeof window.StudyFx.playTone === 'function') {
                    window.StudyFx.playTone(659.25, 0.07, 'triangle');
                }
                if (typeof opts.onTap === 'function') {
                    opts.onTap(buddy, msg);
                }
            });

            actorsEl.appendChild(walker);
            return actor;
        });

        let manualPaused = Boolean(opts.paused);
        let stageWidth = Math.max(240, stageEl.clientWidth || containerEl.clientWidth || 320);
        let rafId = 0;
        let lastTs = 0;
        let disposed = false;

        function getMaxX() {
            return Math.max(8, stageWidth - walkerWidth - 6);
        }

        function layoutInitialPositions() {
            const maxX = getMaxX();
            const count = actors.length;
            if (count === 0) return;
            const span = Math.max(1, maxX - 8);
            actors.forEach((a, idx) => {
                const ratio = count === 1 ? 0.5 : idx / (count - 1);
                a.x = Math.min(maxX, Math.max(6, 6 + span * ratio));
                a.targetX = a.x;
                a.walker.style.transform = `translate3d(${a.x.toFixed(1)}px, 0, 0)`;
                if (a.flipEl) {
                    a.flipEl.style.transform = `scaleX(${a.facing === 1 ? -1 : 1})`;
                }
            });
        }

        function pickNextTarget(actor) {
            const maxX = getMaxX();
            const minX = 6;
            if (maxX <= minX + 12) return minX;
            let candidate = minX + Math.random() * (maxX - minX);
            if (Math.abs(candidate - actor.x) < 36) {
                candidate = actor.x < (minX + maxX) * 0.5
                    ? Math.min(maxX, actor.x + 64 + Math.random() * 60)
                    : Math.max(minX, actor.x - 64 - Math.random() * 60);
            }
            return Math.min(maxX, Math.max(minX, candidate));
        }

        function isMotionActive() {
            return !disposed && !manualPaused && !prefersReducedMotion() && !document.hidden && stageEl.offsetParent !== null;
        }

        function step(ts) {
            rafId = 0;
            if (disposed || actors.length === 0) return;
            if (!lastTs) lastTs = ts;
            const dt = Math.min(0.08, Math.max(0.008, (ts - lastTs) / 1000));
            lastTs = ts;

            if (!isMotionActive()) {
                return;
            }

            const maxX = getMaxX();
            for (const a of actors) {
                if (a.bubbleTimer > 0) {
                    a.bubbleTimer -= dt;
                    if (a.bubbleTimer <= 0) {
                        a.walker.classList.remove('has-bubble');
                    }
                }

                if (a.mode === 'rest') {
                    a.restTimer -= dt;
                    if (a.restTimer <= 0) {
                        a.targetX = pickNextTarget(a);
                        a.mode = 'walk';
                        a.walker.classList.remove('is-resting');
                        a.walker.classList.add('is-walking');
                    }
                } else {
                    const dx = a.targetX - a.x;
                    if (Math.abs(dx) <= 2.5) {
                        a.x = Math.min(maxX, Math.max(6, a.targetX));
                        a.mode = 'rest';
                        a.restTimer = 1.1 + Math.random() * 2.2;
                        a.walker.classList.remove('is-walking');
                        a.walker.classList.add('is-resting');
                    } else {
                        const dir = dx > 0 ? 1 : -1;
                        if (a.facing !== dir) {
                            a.facing = dir;
                            if (a.flipEl) {
                                // Showdown 정면 스프라이트는 기본 좌향이므로 우측 이동 시 좌우 반전
                                a.flipEl.style.transform = `scaleX(${dir === 1 ? -1 : 1})`;
                            }
                        }
                        a.x += dir * a.speed * dt;
                        a.x = Math.min(maxX, Math.max(6, a.x));
                    }
                }
                a.walker.style.transform = `translate3d(${a.x.toFixed(1)}px, 0, 0)`;
            }

            rafId = window.requestAnimationFrame(step);
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
                    const w = entry.contentRect?.width;
                    if (w && w > 80) {
                        stageWidth = w;
                        const maxX = getMaxX();
                        actors.forEach((a) => {
                            a.x = Math.min(maxX, Math.max(6, a.x));
                            a.targetX = Math.min(maxX, Math.max(6, a.targetX));
                            a.walker.style.transform = `translate3d(${a.x.toFixed(1)}px, 0, 0)`;
                        });
                    }
                }
                syncLoopState();
            });
            resizeObserver.observe(stageEl);
        }

        const onVisibility = () => syncLoopState();
        document.addEventListener('visibilitychange', onVisibility);

        layoutInitialPositions();
        syncLoopState();

        const controller = {
            setPaused(paused) {
                manualPaused = Boolean(paused);
                syncLoopState();
            },
            refresh() {
                stageWidth = Math.max(240, stageEl.clientWidth || containerEl.clientWidth || 320);
                syncLoopState();
            },
            destroy() {
                disposed = true;
                if (rafId) {
                    window.cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                if (resizeObserver) {
                    resizeObserver.disconnect();
                    resizeObserver = null;
                }
                document.removeEventListener('visibilitychange', onVisibility);
            }
        };

        containerEl._meadowCleanup = () => controller.destroy();
        containerEl._meadowController = controller;
        return controller;
    }

    window.PokemonMeadow = { mount };
})();
