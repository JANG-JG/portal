/**
 * ==============================================================================
 * 어린이 학습실 포켓몬 알 부화 & 단짝 도감 프론트엔드 모듈 (study-pokemon.js)
 * ------------------------------------------------------------------------------
 * - 10칸 칭찬 도장판 진행도(0~10)에 맞춰 알 흔들림/금감/부화 연출 동기화
 * - 단짝 포켓몬 움직이는 스프라이트 + 터치 시 물리 스프링 점프 & 하트 파티클
 * - 모션 일시정지 토글(aria-pressed 미사용) & 네이티브 <dialog> returnValue 규격 준수
 * ==============================================================================
 */
(function () {
    'use strict';

    const STORAGE_MOTION_KEY = 'study_pokemon_motion_paused';
    let boundCtx = null;
    let currentPokemon = null;
    let currentChild = null;
    let currentMeadow = null;
    let dexFilter = 'all';
    const hatchAutoShownKeys = new Set();

    function esc(str) {
        if (boundCtx && typeof boundCtx.escapeHtml === 'function') {
            return boundCtx.escapeHtml(str);
        }
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function notify(msg) {
        if (boundCtx && typeof boundCtx.showToast === 'function') {
            boundCtx.showToast(msg);
        }
    }

    function openNativeDialog(dlg) {
        if (!dlg || dlg.open) return;
        if (typeof dlg.showModal === 'function') {
            dlg.showModal();
        } else {
            dlg.setAttribute('open', 'open');
        }
    }

    function buildEggSvg(eggColor, eggSpot) {
        const base = esc(eggColor || '#fde68a');
        const spot = esc(eggSpot || '#f59e0b');
        return `
        <svg class="pokemon-egg-svg" viewBox="0 0 100 112" aria-hidden="true">
            <defs>
                <radialGradient id="pokeEggGrad" cx="35%" cy="28%" r="72%">
                    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
                    <stop offset="45%" stop-color="${base}"/>
                    <stop offset="100%" stop-color="${spot}" stop-opacity="0.72"/>
                </radialGradient>
            </defs>
            <ellipse cx="50" cy="102" rx="28" ry="6" fill="rgba(15,23,42,0.12)"/>
            <path d="M50 10 C74 10 86 42 86 68 C86 90 71 102 50 102 C29 102 14 90 14 68 C14 42 26 10 50 10 Z"
                  fill="url(#pokeEggGrad)" stroke="#b45309" stroke-width="2.5"/>
            <circle cx="34" cy="48" r="7" fill="${spot}" fill-opacity="0.35"/>
            <circle cx="67" cy="60" r="9" fill="${spot}" fill-opacity="0.32"/>
            <circle cx="46" cy="79" r="6" fill="${spot}" fill-opacity="0.28"/>
            <path class="pokemon-egg-crack pokemon-egg-crack--1" d="M36 42 L48 51 L43 59 L55 66"
                  fill="none" stroke="#78350f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path class="pokemon-egg-crack pokemon-egg-crack--2" d="M68 38 L58 48 L64 56 L53 63"
                  fill="none" stroke="#78350f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path class="pokemon-egg-crack pokemon-egg-crack--3" d="M40 72 L50 67 L60 75"
                  fill="none" stroke="#b45309" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    function isMotionPaused() {
        try {
            return window.localStorage.getItem(STORAGE_MOTION_KEY) === '1';
        } catch (_) {
            return false;
        }
    }

    function applyMotionPausedState() {
        const card = document.getElementById('pokemonCompanionCard');
        const btn = document.getElementById('btnPokemonMotionToggle');
        if (!card || !btn) return;
        const paused = isMotionPaused();
        card.classList.toggle('pokemon-motion-paused', paused);
        btn.textContent = paused ? '▶️ 움직임 켜기' : '⏸️ 멈춤';
        currentMeadow?.setPaused(paused);
    }

    function triggerTapFx(stageBtn, icons) {
        if (!stageBtn) return;
        stageBtn.classList.remove('is-tapped');
        void stageBtn.offsetWidth;
        stageBtn.classList.add('is-tapped');
        window.setTimeout(() => stageBtn.classList.remove('is-tapped'), 560);

        const fxLayer = stageBtn.querySelector('.pokemon-fx-layer');
        if (fxLayer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const list = icons || ['✨', '❤️', '⭐'];
            list.forEach((glyph, idx) => {
                const span = document.createElement('span');
                span.className = 'pokemon-float-particle';
                span.textContent = glyph;
                span.style.setProperty('--dx', `${(idx - 1) * 24}px`);
                fxLayer.appendChild(span);
                window.setTimeout(() => span.remove(), 900);
            });
        }
        if (window.StudyFx && typeof window.StudyFx.playTone === 'function') {
            window.StudyFx.playTone(587.33, 0.08, 'triangle');
        }
    }

    function render(pokemonData, childProfile) {
        currentPokemon = pokemonData || null;
        currentChild = childProfile || null;

        const card = document.getElementById('pokemonCompanionCard');
        if (!card) return;
        if (!pokemonData || pokemonData.enabled === false) {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        applyMotionPausedState();

        const badge = document.getElementById('pokemonDexCountBadge');
        if (badge) {
            badge.textContent = `도감 ${pokemonData.collectedCount || 0}/${pokemonData.totalCatalogCount || 150}`;
        }

        const eggBtn = document.getElementById('btnPokemonEggStage');
        const egg = pokemonData.activeEgg;
        if (eggBtn && egg) {
            eggBtn.dataset.stage = String(egg.stage || 0);
            const pct = Math.min(1, Math.max(0, Number(egg.steps || 0) / 10));
            const titleText = egg.hatched
                ? (egg.rewardApproved ? '🎁 부모님이 선물을 승인했어요!' : '🎉 알이 부화했어요! 눌러서 열기')
                : `신비한 알 (${egg.steps || 0}/10칸)`;
            const statusSub = egg.hatched && egg.rewardApproved
                ? `축하해요! ${esc(egg.rewardApprovedBy || '부모님')}이(가) 보상 약속을 확인해 주셨어요 ✨`
                : (egg.statusLine || '');
            eggBtn.innerHTML = `
                <span class="pokemon-stage__tag">${esc(egg.cycleNo || 1)}번째 알 · ${esc(egg.stageLabel || '둥지')}</span>
                <div class="pokemon-actor-wrap">
                    <div class="pokemon-egg-aura"></div>
                    ${buildEggSvg(egg.eggColor, egg.eggSpot)}
                </div>
                <div style="width:100%;">
                    <div class="pokemon-stage__label">${esc(titleText)}</div>
                    <div class="pokemon-stage__sub">${esc(statusSub)}</div>
                    <div class="pokemon-progress" aria-hidden="true">
                        <div class="pokemon-progress__bar" style="transform:scaleX(${pct});"></div>
                    </div>
                </div>
                <div class="pokemon-fx-layer" aria-hidden="true"></div>
            `;
        }

        const partnerBtn = document.getElementById('btnPokemonPartnerStage');
        const partner = pokemonData.partnerPokemon;
        if (partnerBtn) {
            const cond = pokemonData.condition;
            if (partner) {
                const lv = Number(partner.level || 1);
                const skills = Array.isArray(partner.skills) ? partner.skills : [];
                const shinyBadge = partner.isShiny ? '<span class="pokemon-shiny-badge">✨ 반짝이</span>' : '';
                const condBadge = cond ? `<span class="pokemon-condition-pill is-${esc(cond.statusKey)}">${esc(cond.label)}</span>` : '';
                const subText = cond?.statusKey && cond.statusKey !== 'happy' ? cond.bubble : '톡 누르면 반갑게 점프해요! ✨';
                partnerBtn.classList.toggle('is-shiny-pokemon', Boolean(partner.isShiny));
                partnerBtn.classList.toggle('is-sleepy-pokemon', cond?.statusKey === 'sleepy');
                partnerBtn.innerHTML = `
                    <span class="pokemon-stage__tag">⭐ Lv.${lv} 단짝 · ${esc(partner.typeEmoji)} ${esc(partner.typeLabel)} ${shinyBadge}</span>
                    ${condBadge}
                    <div class="pokemon-actor-wrap">
                        <img class="pokemon-sprite-img ${partner.isShiny ? 'is-shiny-sprite' : ''}"
                             src="${esc(partner.artworkUrl || partner.animatedUrl)}"
                             data-fallback="${esc(partner.animatedUrl || '')}"
                             alt="${esc(partner.nameKo)}">
                    </div>
                    <div>
                        <div class="pokemon-stage__label">${esc(partner.nameKo)}</div>
                        <div class="pokemon-stage__sub">${esc(subText)}</div>
                    </div>
                    <div class="pokemon-fx-layer" aria-hidden="true"></div>
                `;
                let skillBar = partnerBtn.parentElement?.querySelector('.pokemon-skill-bar');
                if (!skillBar && partnerBtn.parentElement && skills.length > 0) {
                    skillBar = document.createElement('div');
                    skillBar.className = 'pokemon-skill-bar';
                    partnerBtn.insertAdjacentElement('afterend', skillBar);
                }
                if (skillBar) {
                    skillBar.hidden = skills.length === 0;
                    skillBar.innerHTML = skills.map((sk) => `
                        <button type="button" class="pokemon-skill-btn ${sk.unlocked ? '' : 'is-locked'}"
                                data-skill-id="${esc(sk.id)}" ${sk.unlocked ? '' : 'disabled'}
                                title="${sk.unlocked ? `${sk.name} 초원에서 사용하기` : `Lv.${sk.minLevel}에 해금돼요!`}">
                            ${esc(sk.emoji)} ${esc(sk.name)}${sk.unlocked ? '' : ` <small>Lv.${sk.minLevel}</small>`}
                        </button>
                    `).join('');
                    skillBar.querySelectorAll('.pokemon-skill-btn:not([disabled])').forEach((btn) => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const sk = skills.find((s) => s.id === btn.dataset.skillId);
                            if (sk) {
                                currentMeadow?._playApi?.triggerSkill?.(sk);
                                document.getElementById('pokemonMeadowStage')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        });
                    });
                }
                const img = partnerBtn.querySelector('img');
                if (img) {
                    img.addEventListener('error', () => {
                        if (img.dataset.triedFallback === '1') return;
                        img.dataset.triedFallback = '1';
                        if (img.dataset.fallback) img.src = img.dataset.fallback;
                    });
                }
            } else {
                partnerBtn.classList.remove('is-shiny-pokemon', 'is-sleepy-pokemon');
                const oldSkillBar = partnerBtn.parentElement?.querySelector('.pokemon-skill-bar');
                if (oldSkillBar) oldSkillBar.hidden = true;
                partnerBtn.innerHTML = `
                    <span class="pokemon-stage__tag">🐾 첫 단짝 기다리는 중</span>
                    <div class="pokemon-actor-wrap">
                        <div class="pokemon-empty-partner" aria-hidden="true">🥚</div>
                    </div>
                    <div>
                        <div class="pokemon-stage__label">아직 단짝이 없어요</div>
                        <div class="pokemon-stage__sub">도장 10칸을 모으면 첫 포켓몬이 깨어나요!</div>
                    </div>
                    <div class="pokemon-fx-layer" aria-hidden="true"></div>
                `;
            }
        }

        const meadowMount = document.getElementById('pokemonMeadowStage');
        const mountPersonalMeadow = () => {
            if (!meadowMount || !window.PokemonMeadow) return null;
            const collected = Array.isArray(pokemonData.collected) ? pokemonData.collected : [];
            const guests = Array.isArray(pokemonData.visitingGuests) ? pokemonData.visitingGuests : [];
            const sorted = [];
            if (partner) sorted.push(partner);
            for (const c of collected) {
                if (sorted.length >= 6) break;
                if (!sorted.some((s) => Number(s.id) === Number(c.id))) {
                    sorted.push(c);
                }
            }
            const childName = childProfile?.display_name || '친구';
            const localActors = sorted.map((p) => ({
                id: p.id, nameKo: p.nameKo, label: p.nameKo,
                isPartner: Boolean(partner && Number(p.id) === Number(partner.id)),
                animatedUrl: p.animatedUrl, artworkUrl: p.artworkUrl,
                cheers: [`${childName}야, 오늘도 멋져요! ✨`, `${p.nameKo}와(과) 초원 산책 중! 🌿`, '칭찬 도장 모아서 간식도 챙기자! 🍎']
            }));
            const guestActors = guests.map((g) => ({
                id: g.id, nameKo: g.nameKo, label: g.label, isGuest: true, greetingMsg: g.greetingMsg,
                animatedUrl: g.animatedUrl, artworkUrl: g.artworkUrl,
                cheers: [`${g.guestOwnerName}네 ${g.nameKo} 놀러왔어요! 🏠`, g.greetingMsg || '같이 놀자! ✨']
            }));
            const allActors = [...localActors, ...guestActors].slice(0, 8);
            const randomTheme = window.StudyPlazaShop?.getSessionTheme?.() || 'meadow';
            const themeMeta = (window.PokemonMeadowThemes?.THEME_CATALOG || []).find((t) => t.id === randomTheme);
            const ctrl = window.PokemonMeadow.mount(meadowMount, {
                buddies: allActors, spacious: true, theme: randomTheme, paused: isMotionPaused(),
                title: `${themeMeta ? themeMeta.emoji : '🌿'} ${childName}의 포켓몬 놀이터`,
                emptyText: '칭찬 도장 10칸을 모으면 첫 포켓몬이 초원에서 뛰어놀아요!',
                footerHint: allActors.length > 0 ? '초원이나 포켓몬을 톡 누르고 공놀이·방울톡·간식 던지기로 놀아보세요!' : ''
            });
            window.StudyPokemonSocial?.attachMeadowPlay?.(ctrl);
            return ctrl;
        };
        const remountMeadow = () => {
            currentMeadow = window.StudyPlazaShop?.mountCurrentMeadow
                ? window.StudyPlazaShop.mountCurrentMeadow(mountPersonalMeadow)
                : mountPersonalMeadow();
        };
        remountMeadow();
        window.StudyPokemonSocial?.renderForChild?.({
            childProfile,
            partnerPokemon: partner,
            showToast: boundCtx?.showToast,
            onRefreshAll: boundCtx?.reloadDashboard
        });
        window.StudyPlazaShop?.renderForChild?.({
            childProfile, pokemonData, isMotionPaused,
            showToast: boundCtx?.showToast,
            onRefreshAll: boundCtx?.reloadDashboard,
            onRemountMeadow: remountMeadow
        });

        if (egg && egg.hatched && egg.revealedPokemon && !egg.hatchAcknowledged) {
            const key = `${childProfile?.id || 'first'}:${egg.cycleNo}`;
            if (!hatchAutoShownKeys.has(key)) {
                hatchAutoShownKeys.add(key);
                window.setTimeout(() => openHatchDialog(egg), 320);
            }
        }
    }

    function openHatchDialog(egg) {
        const dlg = document.getElementById('pokemonHatchDialog');
        const hero = document.getElementById('pokemonHatchHero');
        if (!dlg || !hero || !egg?.revealedPokemon) return;

        const poke = egg.revealedPokemon;
        dlg.dataset.cycleNo = String(egg.cycleNo || 1);
        dlg.dataset.pokemonId = String(poke.id);
        const approvedBanner = egg.rewardApproved
            ? `<div style="margin-top:0.55rem; padding:0.35rem 0.75rem; border-radius:999px; background:#dcfce7; color:#15803d; font-size:0.82rem; font-weight:800; display:inline-block;">🎁 ${esc(egg.rewardApprovedBy || '부모님')}이(가) 보상 선물을 승인했어요!</div>`
            : '';
        hero.innerHTML = `
            <div style="font-size:0.86rem; font-weight:800; color:#b45309;">🎉 ${esc(egg.cycleNo || 1)}번째 도장판 완성! 알이 부화했어요!</div>
            <img src="${esc(poke.artworkUrl || poke.animatedUrl)}" alt="${esc(poke.nameKo)}">
            <h3 style="margin:0.25rem 0; font-size:1.35rem; color:#0f172a;">${esc(poke.nameKo)}</h3>
            <span style="display:inline-block; padding:0.2rem 0.65rem; border-radius:999px; font-size:0.8rem; font-weight:800; background:${esc(poke.bgSoft || '#fef3c7')}; color:${esc(poke.color || '#b45309')};">
                ${esc(poke.typeEmoji)} ${esc(poke.typeLabel)}
            </span>
            ${approvedBanner}
            <p style="margin:0.6rem 0 0; font-size:0.88rem; color:#475569; line-height:1.45;">${esc(poke.flavorKo || '')}</p>
        `;
        if (window.StudyFx) {
            window.StudyFx.fanfare();
            window.StudyFx.celebrate({ big: true });
        }
        openNativeDialog(dlg);
    }

    function renderDexBody() {
        const body = document.getElementById('pokemonDexBody');
        const subtitle = document.getElementById('pokemonDexSubtitle');
        if (!body || !currentPokemon) return;

        if (subtitle) {
            subtitle.textContent = `${currentPokemon.collectedCount || 0}/${currentPokemon.totalCatalogCount || 150}마리 수집`;
        }
        const catalog = Array.isArray(currentPokemon.catalog) ? currentPokemon.catalog : [];
        const filtered = catalog.filter((item) => {
            if (dexFilter === 'owned') return item.unlocked;
            if (dexFilter === 'locked') return !item.unlocked;
            return true;
        });

        body.innerHTML = `
            <div class="pokemon-dex-tabs">
                <button type="button" class="pokemon-dex-tab ${dexFilter === 'all' ? 'is-active' : ''}" data-dex-filter="all">전체 (${catalog.length})</button>
                <button type="button" class="pokemon-dex-tab ${dexFilter === 'owned' ? 'is-active' : ''}" data-dex-filter="owned">만난 포켓몬 (${currentPokemon.collectedCount || 0})</button>
                <button type="button" class="pokemon-dex-tab ${dexFilter === 'locked' ? 'is-active' : ''}" data-dex-filter="locked">수수께끼 (${Math.max(0, catalog.length - (currentPokemon.collectedCount || 0))})</button>
            </div>
            <div class="pokemon-dex-grid">
                ${filtered.map((item) => {
                    if (!item.unlocked) {
                        return `
                        <div class="pokemon-dex-card">
                            <div class="pokemon-dex-silhouette">?</div>
                            <strong style="font-size:0.86rem; color:#64748b;">???</strong>
                            <span style="font-size:0.74rem; color:#94a3b8;">${esc(item.typeEmoji)} ${esc(item.typeLabel)}</span>
                        </div>`;
                    }
                    return `
                    <div class="pokemon-dex-card is-unlocked ${item.isPartner ? 'is-partner' : ''} ${item.isShiny ? 'is-shiny-pokemon' : ''}">
                        ${item.isShiny ? '<span class="pokemon-shiny-badge">✨ 반짝이</span>' : ''}
                        <img class="${item.isShiny ? 'is-shiny-sprite' : ''}" src="${esc(item.artworkUrl || item.animatedUrl)}" alt="${esc(item.nameKo)}">
                        <strong style="font-size:0.88rem; color:#0f172a;">${esc(item.nameKo)} ${item.count > 1 ? `<small style="color:#6366f1;">x${item.count}</small>` : ''}</strong>
                        <span style="font-size:0.74rem; color:${esc(item.color || '#475569')}; font-weight:700;">${esc(item.typeEmoji)} ${esc(item.typeLabel)}</span>
                        <button type="button" class="pokemon-dex-partner-btn" data-select-partner="${esc(item.id)}" ${item.isPartner ? 'disabled' : ''}>
                            ${item.isPartner ? '⭐ 지금 내 단짝!' : '단짝으로 정하기'}
                        </button>
                    </div>`;
                }).join('')}
            </div>
        `;
    }

    function openDexDialog() {
        if (!currentPokemon) return;
        renderDexBody();
        openNativeDialog(document.getElementById('pokemonDexDialog'));
    }

    async function postPokemonAction(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body || {})
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || '처리에 실패했어요.');
        }
        return data;
    }

    function bindEvents(ctx) {
        boundCtx = ctx || {};

        document.getElementById('btnPokemonMotionToggle')?.addEventListener('click', () => {
            const card = document.getElementById('pokemonCompanionCard');
            if (!card) return;
            const nextPaused = !card.classList.contains('pokemon-motion-paused');
            try {
                window.localStorage.setItem(STORAGE_MOTION_KEY, nextPaused ? '1' : '0');
            } catch (_) {}
            applyMotionPausedState();
            notify(nextPaused ? '포켓몬과 알의 움직임을 잠시 멈췄어요.' : '포켓몬과 알이 다시 신나게 움직여요!');
        });

        document.getElementById('btnPokemonOpenDex')?.addEventListener('click', openDexDialog);

        document.getElementById('btnPokemonEggStage')?.addEventListener('click', (e) => {
            const egg = currentPokemon?.activeEgg;
            triggerTapFx(e.currentTarget, ['✨', '🥚', '🌟']);
            if (!egg) return;
            if (egg.hatched && egg.revealedPokemon) {
                openHatchDialog(egg);
                return;
            }
            notify(`${egg.typeHint || '신비한 포켓몬 기운이 느껴져요!'} (${10 - (egg.steps || 0)}칸 남았어요)`);
        });

        document.getElementById('btnPokemonPartnerStage')?.addEventListener('click', (e) => {
            triggerTapFx(e.currentTarget, ['❤️', '✨', '💛']);
            const partner = currentPokemon?.partnerPokemon;
            if (partner) {
                notify(`${partner.nameKo}: "${currentChild?.display_name || '친구'}야, 오늘도 멋지게 공부해 보자!" ❤️`);
            } else {
                notify('칭찬 도장 10칸을 다 모으면 첫 단짝 포켓몬이 태어나요! 🥚');
            }
        });

        const dexDlg = document.getElementById('pokemonDexDialog');
        if (dexDlg) {
            dexDlg.addEventListener('click', async (e) => {
                const filterBtn = e.target.closest('[data-dex-filter]');
                if (filterBtn) {
                    dexFilter = filterBtn.dataset.dexFilter || 'all';
                    renderDexBody();
                    return;
                }
                const partnerBtn = e.target.closest('[data-select-partner]');
                if (partnerBtn) {
                    partnerBtn.disabled = true;
                    try {
                        const out = await postPokemonAction('/api/study/pokemon/partner', {
                            childId: currentChild?.id || 'first',
                            pokemonId: Number(partnerBtn.dataset.selectPartner)
                        });
                        render(out.pokemon, currentChild);
                        renderDexBody();
                        notify(out.message || '단짝 포켓몬을 바꿨어요!');
                    } catch (err) {
                        notify(err.message);
                        partnerBtn.disabled = false;
                    }
                }
            });
            dexDlg.addEventListener('close', () => {
                dexDlg.returnValue = '';
            });
        }

        const hatchDlg = document.getElementById('pokemonHatchDialog');
        if (hatchDlg) {
            hatchDlg.addEventListener('close', async () => {
                const action = hatchDlg.returnValue;
                hatchDlg.returnValue = '';
                const cycleNo = Number(hatchDlg.dataset.cycleNo || 1);
                const pokemonId = Number(hatchDlg.dataset.pokemonId || 0);
                try {
                    let out = await postPokemonAction('/api/study/pokemon/ack-hatch', {
                        childId: currentChild?.id || 'first',
                        cycleNo
                    });
                    if (action === 'partner' && pokemonId > 0) {
                        out = await postPokemonAction('/api/study/pokemon/partner', {
                            childId: currentChild?.id || 'first',
                            pokemonId
                        });
                        notify(out.message || '새 단짝 포켓몬으로 정했어요!');
                    }
                    if (out?.pokemon) {
                        render(out.pokemon, currentChild);
                    }
                } catch (_) {}
            });
        }
    }

    window.StudyPokemon = { render, bindEvents, openDexDialog };
})();
