/**
 * ==============================================================================
 * 포켓몬 API (#1~150 초기 관동 도감) 색칠 도안 선택기 & 도안 로더
 * (study-pokemon-coloring.js)
 * ------------------------------------------------------------------------------
 * - 대시보드 색칠놀이 패널 내 1~150 포켓몬 도감 검색·속성 필터·선택기 제공
 * - 학습지 화면에서 PokéAPI 기반 선화 SVG 안전 마운트 + '👀 원래 색깔 힌트' 토글
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px·터치 최적화
 * ==============================================================================
 */
(function () {
    'use strict';

    let cachedGen1List = null;
    let pickerState = { query: '', type: 'popular', initialized: false };

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function fetchGen1List() {
        if (cachedGen1List) return cachedGen1List;
        const res = await fetch('/api/study/pokemon/gen1-list', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok || !data.success) return { enabled: false, list: [] };
        cachedGen1List = { enabled: data.enabled !== false, list: Array.isArray(data.list) ? data.list : [] };
        return cachedGen1List;
    }

    function filterGen1(list, query, typeKey) {
        const q = String(query || '').trim().toLowerCase();
        const numQ = q.replace(/^#?0*/, '');
        return list.filter((p) => {
            if (!q && typeKey === 'popular') return Boolean(p.isPopular);
            if (!q && typeKey && typeKey !== 'all' && typeKey !== 'popular') {
                if (p.typeKey !== typeKey) return false;
            }
            if (!q) return true;
            return p.nameKo.toLowerCase().includes(q) || String(p.id) === numQ || String(p.typeLabel || '').includes(q);
        });
    }

    async function initDashboardPicker({ onSelectMode, getSelectedMode }) {
        const mount = document.getElementById('pokemonColoringMount');
        if (!mount) return;
        if (!pickerState.initialized) {
            pickerState.initialized = true;
            mount.innerHTML = '<p class="pokemon-color-status">⚡ 1세대 포켓몬(#1~150) 도안을 불러오는 중...</p>';
        }

        try {
            const payload = await fetchGen1List();
            if (!payload.enabled || !payload.list.length) {
                mount.hidden = true;
                return;
            }
            mount.hidden = false;

            const presets = [
                { mode: 'pokemon_random_3', label: '⚡ 랜덤 포켓몬 3마리 (1~150)' },
                { mode: 'pokemon_starters', label: '🐣 초기 스타터 4마리 (이상해씨·파이리·꼬부기·피카츄)' },
                { mode: 'pokemon_random_1', label: '🎲 포켓몬 1마리 랜덤' }
            ];
            const typeTabs = [
                { key: 'popular', label: '⭐ 인기 1세대' },
                { key: 'all', label: '📖 전체 150' },
                { key: 'electric', label: '⚡ 전기' },
                { key: 'fire', label: '🔥 불꽃' },
                { key: 'water', label: '💧 물' },
                { key: 'grass', label: '🌿 풀' },
                { key: 'fairy', label: '🌸 페어리' },
                { key: 'normal', label: '⭐ 노말' }
            ];

            mount.innerHTML = `
                <div class="pokemon-color-head">
                    <strong>🎮 포켓몬 도감 색칠하기 (초창기 #1~150)</strong>
                    <small>PokéAPI 1세대 150마리 중 원하는 포켓몬을 골라 색칠할 수 있어요!</small>
                </div>
                <div class="pokemon-color-presets" role="group" aria-label="포켓몬 색칠 묶음 선택">
                    ${presets.map((p) => `<button type="button" class="coloring-tpl-pill pokemon-preset-pill" data-coloring-mode="${esc(p.mode)}">${esc(p.label)}</button>`).join('')}
                </div>
                <div class="pokemon-color-controls">
                    <label for="pokeColorSearchInput" class="visually-hidden">포켓몬 이름 또는 번호(1~150) 검색</label>
                    <input type="search" id="pokeColorSearchInput" class="study-input pokemon-color-search" maxlength="20" placeholder="이름 또는 번호 검색 (예: 피카츄, 25, 망나뇽)">
                    <div class="pokemon-type-filters" role="group" aria-label="포켓몬 속성 필터">
                        ${typeTabs.map((t) => `<button type="button" class="pokemon-type-btn${t.key === pickerState.type ? ' active' : ''}" data-poke-type="${esc(t.key)}" aria-pressed="${t.key === pickerState.type ? 'true' : 'false'}">${esc(t.label)}</button>`).join('')}
                    </div>
                </div>
                <div id="pokeColorGrid" class="pokemon-color-grid" role="group" aria-label="1세대 포켓몬 1~150 선택 목록"></div>
            `;

            const grid = mount.querySelector('#pokeColorGrid');
            const searchInput = mount.querySelector('#pokeColorSearchInput');

            const syncSelectionUi = () => {
                const currentMode = typeof getSelectedMode === 'function' ? getSelectedMode() : '';
                mount.querySelectorAll('.pokemon-preset-pill').forEach((b) => {
                    b.classList.toggle('active', b.dataset.coloringMode === currentMode);
                });
                grid.querySelectorAll('.pokemon-color-card').forEach((b) => {
                    const active = b.dataset.coloringMode === currentMode;
                    b.classList.toggle('active', active);
                    b.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
            };

            const renderGrid = () => {
                const items = filterGen1(payload.list, pickerState.query, pickerState.type);
                if (!items.length) {
                    grid.innerHTML = '<p class="pokemon-color-status">검색 조건에 맞는 1~150번 포켓몬이 없어요.</p>';
                    return;
                }
                grid.innerHTML = items.map((p) => {
                    const numText = `#${String(p.id).padStart(3, '0')}`;
                    const mode = `pokemon:${p.id}`;
                    return `
                        <button type="button" class="pokemon-color-card" data-coloring-mode="${esc(mode)}" aria-pressed="false">
                            <img src="${esc(p.artworkUrl)}" alt="" loading="lazy">
                            <span class="pokemon-color-card__num">${numText}</span>
                            <span class="pokemon-color-card__name">${esc(p.nameKo)}</span>
                        </button>
                    `;
                }).join('');
                syncSelectionUi();
            };

            mount.addEventListener('click', (e) => {
                const presetBtn = e.target.closest('.pokemon-preset-pill');
                if (presetBtn && typeof onSelectMode === 'function') {
                    onSelectMode(presetBtn.dataset.coloringMode, presetBtn.textContent.trim());
                    syncSelectionUi();
                    return;
                }
                const typeBtn = e.target.closest('.pokemon-type-btn');
                if (typeBtn) {
                    pickerState.type = typeBtn.dataset.pokeType || 'popular';
                    mount.querySelectorAll('.pokemon-type-btn').forEach((b) => {
                        const on = b === typeBtn;
                        b.classList.toggle('active', on);
                        b.setAttribute('aria-pressed', on ? 'true' : 'false');
                    });
                    renderGrid();
                    return;
                }
                const pokeBtn = e.target.closest('.pokemon-color-card');
                if (pokeBtn && typeof onSelectMode === 'function') {
                    const name = pokeBtn.querySelector('.pokemon-color-card__name')?.textContent?.trim() || '';
                    const num = pokeBtn.querySelector('.pokemon-color-card__num')?.textContent?.trim() || '';
                    onSelectMode(pokeBtn.dataset.coloringMode, `${num} ${name}`.trim());
                    syncSelectionUi();
                }
            });

            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    pickerState.query = searchInput.value || '';
                    renderGrid();
                });
            }

            renderGrid();
            mount._syncSelectionUi = syncSelectionUi;
        } catch (_) {
            mount.innerHTML = '<p class="pokemon-color-status">포켓몬 색칠 목록을 잠시 불러오지 못했어요.</p>';
        }
    }

    function syncDashboardSelection() {
        const mount = document.getElementById('pokemonColoringMount');
        if (mount && typeof mount._syncSelectionUi === 'function') mount._syncSelectionUi();
    }

    async function mountPokemonColoringSvg({ wrap, blk, onSvgReady, hintHost }) {
        const pid = Number(blk?.pokemonId);
        if (!wrap || !Number.isInteger(pid) || pid < 1 || pid > 150) return;

        wrap.innerHTML = '<div class="pokemon-svg-loading">⚡ 포켓몬 색칠 도안을 준비하고 있어요...</div>';
        try {
            const [svgRes, speciesRes] = await Promise.all([
                fetch(`/api/study/pokemon/coloring-svg/${pid}`, { credentials: 'include' }),
                fetch(`/api/study/pokemon/species/${pid}`, { credentials: 'include' }).catch(() => null)
            ]);
            if (!svgRes.ok) throw new Error('SVG_FETCH_FAILED');
            const svgText = await svgRes.text();
            const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
            const root = parsed && parsed.documentElement;
            if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('INVALID_SVG');

            const imported = document.importNode(root, true);
            imported.classList.add('coloring-svg');
            wrap.innerHTML = '';
            wrap.appendChild(imported);

            if (typeof onSvgReady === 'function') onSvgReady(imported);

            if (hintHost) {
                let species = null;
                if (speciesRes && speciesRes.ok) {
                    const json = await speciesRes.json().catch(() => null);
                    if (json && json.success) species = json.species;
                }
                const title = species?.nameKo || blk.pokemonNameKo || `포켓몬 #${pid}`;
                const genus = species?.genusKo ? ` · ${species.genusKo}` : '';
                const flavor = species?.flavorKo || '';
                const artUrl = species?.artworkUrl || blk.artworkUrl || `/api/study/pokemon/sprite/${pid}?kind=artwork`;

                const box = document.createElement('div');
                box.className = 'pokemon-hint-box no-print';
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'study-btn study-btn-outline pokemon-hint-toggle';
                toggleBtn.setAttribute('aria-expanded', 'false');
                toggleBtn.textContent = '👀 원래 색깔 힌트 보기';

                const panel = document.createElement('div');
                panel.className = 'pokemon-hint-panel';
                panel.hidden = true;
                panel.innerHTML = `
                    <img src="${esc(artUrl)}" alt="${esc(title)} 원래 색깔 모습" class="pokemon-hint-img">
                    <div class="pokemon-hint-meta">
                        <strong>#${String(pid).padStart(3, '0')} ${esc(title)}${esc(genus)}</strong>
                        ${flavor ? `<p>${esc(flavor)}</p>` : ''}
                    </div>
                `;
                toggleBtn.addEventListener('click', () => {
                    const nextOpen = panel.hidden;
                    panel.hidden = !nextOpen;
                    toggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
                    toggleBtn.textContent = nextOpen ? '🙈 원래 색깔 힌트 닫기' : '👀 원래 색깔 힌트 보기';
                    if (window.StudyFx) window.StudyFx.tap();
                });
                box.append(toggleBtn, panel);
                hintHost.appendChild(box);
            }
        } catch (_) {
            wrap.innerHTML = '<div class="pokemon-svg-loading">도안을 불러오지 못했어요. 🔄 다른 그림으로 버튼을 눌러 보세요!</div>';
        }
    }

    function bindAccessibleTablist(tablistEl, onSelectTab) {
        if (!tablistEl || tablistEl._tabsBound) return;
        tablistEl._tabsBound = true;
        const tabs = Array.from(tablistEl.querySelectorAll('[role="tab"]'));
        const activate = (tab, moveFocus = false) => {
            if (!tab) return;
            tabs.forEach((t) => {
                const selected = t === tab;
                t.setAttribute('aria-selected', selected ? 'true' : 'false');
                t.tabIndex = selected ? 0 : -1;
            });
            if (moveFocus) tab.focus();
            if (typeof onSelectTab === 'function') onSelectTab(tab);
        };
        tablistEl.addEventListener('click', (e) => {
            const tab = e.target.closest('[role="tab"]');
            if (tab) activate(tab, false);
        });
        tablistEl.addEventListener('keydown', (e) => {
            const current = e.target.closest('[role="tab"]');
            if (!current) return;
            const idx = tabs.indexOf(current);
            if (idx < 0) return;
            let nextIdx = -1;
            if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') nextIdx = 0;
            else if (e.key === 'End') nextIdx = tabs.length - 1;
            if (nextIdx >= 0) {
                e.preventDefault();
                activate(tabs[nextIdx], true);
            }
        });
    }

    function initColoringCategoryTabs({ getSelectedMode, onSelectMode }) {
        const catTablist = document.querySelector('.coloring-cat-tabs[role="tablist"]');
        const themePanel = document.getElementById('panelColorCatTheme');
        const pokemonPanel = document.getElementById('panelColorCatPokemon');
        const summaryEl = document.getElementById('coloringSelectedSummary');

        const remembered = {
            theme: { mode: 'auto_3', label: '🎲 테마 맞춤 3장 모음' },
            pokemon: { mode: 'pokemon_random_3', label: '⚡ 랜덤 포켓몬 3마리 (1~150)' }
        };
        let activeCat = 'theme';

        const updateSummary = (labelText) => {
            if (!summaryEl) return;
            summaryEl.innerHTML = `선택한 도안: <strong>${esc(labelText || '테마 맞춤 3장 모음')}</strong>`;
        };

        const applySelection = (cat, mode, label) => {
            remembered[cat] = { mode, label };
            if (typeof onSelectMode === 'function') onSelectMode(mode);
            updateSummary(label);
        };

        document.querySelectorAll('#panelColorCatTheme .coloring-tpl-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.coloringMode || 'auto_3';
                document.querySelectorAll('#panelColorCatTheme .coloring-tpl-pill').forEach((p) => p.classList.toggle('active', p === btn));
                applySelection('theme', mode, btn.textContent.trim());
            });
        });

        bindAccessibleTablist(catTablist, (tab) => {
            activeCat = tab.dataset.colorCat === 'pokemon' ? 'pokemon' : 'theme';
            if (themePanel) themePanel.hidden = activeCat !== 'theme';
            if (pokemonPanel) pokemonPanel.hidden = activeCat !== 'pokemon';

            const saved = remembered[activeCat];
            if (typeof onSelectMode === 'function') onSelectMode(saved.mode);
            updateSummary(saved.label);

            if (activeCat === 'pokemon') {
                initDashboardPicker({
                    getSelectedMode,
                    onSelectMode: (mode, label) => applySelection('pokemon', mode, label || mode)
                }).then(() => syncDashboardSelection());
            }
        });
    }

    window.StudyPokemonColoring = {
        bindAccessibleTablist,
        initColoringCategoryTabs,
        initDashboardPicker,
        syncDashboardSelection,
        mountPokemonColoringSvg
    };
})();
