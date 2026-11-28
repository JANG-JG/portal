/**
 * 🔍 JG 통합 스마트 검색 페이지 컨트롤러 (search-page.js)
 * - IME 안전 엔터 제출, 실시간 자동완성, 최근 검색어 관리, 스마트 즉답 카드 & 내부 통합 결과 렌더링
 */
(function () {
    'use strict';

    const state = {
        query: '',
        tab: 'all',
        page: 1,
        localCat: 'ALL',
        autoSave: true,
        basePayload: null,
        baseCounts: null,
        baseTotals: null,
        lastPayload: null
    };

    const TAB_LABELS = {
        all: '통합검색',
        web: '웹문서',
        blog: '블로그·카페',
        image: '이미지',
        encyc: '백과·지식',
        wikiNews: '위키·뉴스',
        local: '맛집·지역',
        internal: '우리 사이트',
        google: '구글 웹',
        memoCalendar: '메모·일정',
        album: '사진·앨범',
        healthAsset: '건강·자산'
    };

    const el = (id) => document.getElementById(id);
    const makeEl = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    };

    function safeHref(url) {
        if (!url || typeof url !== 'string') return '#';
        const trimmed = url.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
            return trimmed;
        }
        return '#';
    }

    function normalizeTab(rawTab) {
        const t = (rawTab || 'all').trim();
        return t === 'webBlog' ? 'web' : t;
    }

    function readUrlParams() {
        const sp = new URLSearchParams(window.location.search);
        const rawPage = parseInt(sp.get('page') || '1', 10);
        return {
            q: (sp.get('q') || '').trim(),
            tab: normalizeTab(sp.get('tab') || 'all'),
            page: Number.isFinite(rawPage) && rawPage > 1 ? Math.min(67, rawPage) : 1,
            cat: (sp.get('cat') || 'ALL').trim().toUpperCase()
        };
    }

    function updateUrl(q, tab, page = 1, replace = false) {
        const sp = new URLSearchParams();
        if (q) sp.set('q', q);
        if (tab && tab !== 'all') sp.set('tab', tab);
        if (tab === 'local' && state.localCat && state.localCat !== 'ALL') sp.set('cat', state.localCat);
        if (page && page > 1) sp.set('page', String(page));
        const qs = sp.toString();
        const nextUrl = qs ? `/search?${qs}` : '/search';
        if (replace) window.history.replaceState({ q, tab, page, cat: state.localCat }, '', nextUrl);
        else window.history.pushState({ q, tab, page, cat: state.localCat }, '', nextUrl);
    }

    async function loadHomeData() {
        try {
            const res = await fetch('/api/search/home', { credentials: 'include' });
            const data = await res.json();
            if (!data.success) return;

            state.autoSave = data.autoSave !== false;
            updateAutoSaveBtn();

            if (data.miniWeather && data.miniWeather.temp) {
                el('jgHomeWeatherIcon').textContent = data.miniWeather.icon || '🌤️';
                el('jgHomeWeatherCity').textContent = data.miniWeather.city || '서울';
                el('jgHomeWeatherTemp').textContent = data.miniWeather.temp;
                el('jgHomeWeatherPill').style.display = 'inline-flex';
            }

            renderHistoryChips(data.history || []);
            renderShortcutsGrid(data.shortcuts || []);
        } catch (_) {}
    }

    function updateAutoSaveBtn() {
        const btn = el('jgToggleAutoSaveBtn');
        if (btn) btn.textContent = state.autoSave ? '자동저장 켜짐' : '자동저장 꺼짐';
    }

    function renderHistoryChips(history) {
        const box = el('jgRecentHistoryList');
        if (!box) return;
        box.replaceChildren();
        if (!history.length) {
            box.appendChild(makeEl('span', 'jg-muted-text', state.autoSave ? '최근 검색 기록이 없습니다.' : '자동저장이 꺼져 있습니다.'));
            return;
        }
        history.forEach((item) => {
            const chip = makeEl('div', 'jg-history-chip');
            const qBtn = makeEl('button', 'jg-history-chip-btn', item.query);
            qBtn.type = 'button';
            qBtn.addEventListener('click', () => runSearch(item.query, 'all'));

            const delBtn = makeEl('button', 'jg-history-del-btn', '✕');
            delBtn.type = 'button';
            delBtn.title = '검색어 삭제';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await fetch(`/api/search/history/${item.id}`, { method: 'DELETE', credentials: 'include' });
                loadHomeData();
            });

            chip.append(qBtn, delBtn);
            box.appendChild(chip);
        });
    }

    function renderShortcutsGrid(shortcuts) {
        const grid = el('jgHomeShortcutsGrid');
        if (!grid) return;
        grid.replaceChildren();
        shortcuts.forEach((s) => {
            const card = makeEl('a', 'jg-shortcut-card');
            card.href = safeHref(s.url);
            const icon = makeEl('span', 'jg-shortcut-icon', s.icon || '🔗');
            const info = makeEl('div', 'jg-shortcut-info');
            info.append(makeEl('div', 'jg-shortcut-title', s.title), makeEl('div', 'jg-shortcut-desc', s.desc));
            card.append(icon, info);
            grid.appendChild(card);
        });
    }

    function showHomeMode() {
        state.query = '';
        state.page = 1;
        state.basePayload = null;
        state.baseCounts = null;
        state.baseTotals = null;
        state.lastPayload = null;
        el('jgSearchTabs').style.display = 'none';
        el('jgSearchResultsSection').style.display = 'none';
        el('jgSearchHomeSection').style.display = 'block';
        document.title = 'JG 통합 검색';
        loadHomeData();
    }

    function formatBadgeNum(val) {
        const n = Number(val) || 0;
        return n > 99 ? '99+' : String(n);
    }

    async function runSearch(rawQuery, rawTab = 'all', pushUrl = true, rawPage = 1, opts = {}) {
        const q = (rawQuery || '').trim();
        if (!q) {
            if (pushUrl) updateUrl('', 'all', 1);
            showHomeMode();
            return;
        }

        const nextTab = normalizeTab(rawTab);
        const nextPage = Math.max(1, Math.min(67, parseInt(rawPage, 10) || 1));
        if (state.query !== q) {
            state.basePayload = null;
            state.baseCounts = null;
            state.baseTotals = null;
            if (!opts.localCat) state.localCat = 'ALL';
        }
        if (opts.localCat) state.localCat = opts.localCat;

        state.query = q;
        state.tab = nextTab;
        state.page = nextPage;
        el('jgSearchInput').value = q;
        el('jgSearchClearBtn').style.display = 'inline-flex';
        hideSuggest({ blur: true, suppressMs: 450 });

        if (pushUrl) updateUrl(q, state.tab, state.page);
        document.title = `${q} - JG 통합 검색`;

        el('jgSearchHomeSection').style.display = 'none';
        el('jgSearchResultsSection').style.display = 'block';
        el('jgSearchTabs').style.display = 'flex';
        el('jgSearchLoading').style.display = 'block';
        el('jgEmptyResults').style.display = 'none';
        if (!opts.keepAiSummary) {
            el('jgAiSummaryMount').style.display = 'none';
            el('jgAiSummaryMount').replaceChildren();
        }
        el('jgSmartWidgetMount').replaceChildren();
        el('jgInternalResultsMount').replaceChildren();
        el('jgExternalResultsMount').replaceChildren();
        updateTabUI();

        if (opts.scrollTop) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        try {
            const saveParam = opts.saveHistory === false || state.page > 1 ? '&save=0' : '';
            const catParam = state.tab === 'local' && state.localCat !== 'ALL' ? `&cat=${encodeURIComponent(state.localCat)}` : '';
            const url = `/api/search/portal?q=${encodeURIComponent(q)}&tab=${encodeURIComponent(state.tab)}&page=${state.page}${catParam}${saveParam}`;
            const res = await fetch(url, { credentials: 'include' });
            const payload = await res.json();
            el('jgSearchLoading').style.display = 'none';
            if (!payload.success) {
                showEmpty(q);
                return;
            }
            state.lastPayload = payload;
            if (state.tab === 'all' && state.page === 1) {
                state.basePayload = payload;
                state.baseCounts = { ...(payload.counts || {}) };
                state.baseTotals = { ...(payload.totals || {}) };
            }
            updateTabCounts(payload.counts || {}, payload.totals || {});
            renderResults();
        } catch (_) {
            el('jgSearchLoading').style.display = 'none';
            showEmpty(q);
        }
    }

    function switchTab(nextRawTab, nextPage = 1, pushUrl = true) {
        const nextTab = normalizeTab(nextRawTab);
        if (!state.query) return;

        const internalOnlyTabs = ['internal', 'memoCalendar', 'album', 'healthAsset'];
        if (nextPage === 1 && state.basePayload && state.basePayload.query === state.query) {
            if (nextTab === 'all' || internalOnlyTabs.includes(nextTab)) {
                state.tab = nextTab;
                state.page = 1;
                state.lastPayload = state.basePayload;
                updateTabUI();
                if (pushUrl) updateUrl(state.query, state.tab, 1);
                renderResults();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
        }

        runSearch(state.query, nextTab, pushUrl, nextPage, {
            saveHistory: false,
            scrollTop: true,
            keepAiSummary: false
        });
    }

    function updateTabUI() {
        document.querySelectorAll('#jgSearchTabs .jg-tab-btn').forEach((btn) => {
            const active = btn.dataset.tab === state.tab;
            btn.classList.toggle('active', active);
            if (active) {
                btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest', container: 'nearest' });
            }
        });
    }

    function updateTabCounts(counts, totals = {}) {
        const mergedCnt = { ...(state.baseCounts || {}), ...(counts || {}) };
        const mergedTot = { ...(state.baseTotals || {}), ...(totals || {}) };
        if (state.tab !== 'all' && state.baseCounts) {
            Object.keys(state.baseCounts).forEach((k) => {
                if (k !== state.tab && state.baseCounts[k] > (mergedCnt[k] || 0)) {
                    mergedCnt[k] = state.baseCounts[k];
                }
            });
            Object.keys(state.baseTotals || {}).forEach((k) => {
                if (k !== state.tab && state.baseTotals[k] > (mergedTot[k] || 0)) {
                    mergedTot[k] = state.baseTotals[k];
                }
            });
        }

        const setCnt = (id, val) => { const n = el(id); if (n) n.textContent = formatBadgeNum(val); };
        setCnt('tabCntAll', mergedCnt.all);
        setCnt('tabCntWeb', mergedTot.web || mergedCnt.web);
        setCnt('tabCntBlog', mergedTot.blog || mergedCnt.blog);
        setCnt('tabCntImage', mergedTot.image || mergedCnt.image);
        setCnt('tabCntEncyc', mergedTot.encyc || mergedCnt.encyc);
        setCnt('tabCntWikiNews', mergedTot.wikiNews || mergedCnt.wikiNews);
        setCnt('tabCntLocal', mergedTot.local || mergedCnt.local);
        setCnt('tabCntInternal', mergedCnt.internal);
        setCnt('tabCntGoogle', mergedTot.google || mergedCnt.google);
        setCnt('tabCntMemoCal', mergedCnt.memoCalendar);
        setCnt('tabCntAlbum', mergedCnt.album);
        setCnt('tabCntHealthAsset', mergedCnt.healthAsset);
    }

    function showEmpty(q) {
        el('jgEmptyResultsText').textContent = `'${q}'에 대한 검색 결과가 없습니다.`;
        el('jgEmptyResults').style.display = 'block';
    }

    function renderResults() {
        const p = state.lastPayload;
        if (!p) return;
        const r = p.internal?.results || {};
        const tab = state.tab;
        const R = window.JGSearchRenderers;
        const H = window.JGSearchCardHelpers;
        const B = window.JGSearchBlendedView;

        const navHandlers = {
            activeLocalCat: state.localCat,
            onSwitchTab: (targetTab, targetPage = 1) => switchTab(targetTab, targetPage, true),
            onPageChange: (targetPage) => switchTab(state.tab, targetPage, true),
            onSwitchLocalCat: (catCode) => {
                state.localCat = catCode || 'ALL';
                runSearch(state.query, 'local', true, 1, { saveHistory: false, scrollTop: true, localCat: state.localCat });
            }
        };

        const showWidget = tab === 'all' && state.page === 1;
        if (showWidget) R.renderSmartWidget(el('jgSmartWidgetMount'), p.smartWidget, navHandlers);
        else el('jgSmartWidgetMount').replaceChildren();

        let shownCount = showWidget && p.smartWidget ? 1 : 0;
        if (tab === 'all' && state.page === 1 && B && typeof B.renderUnifiedAll === 'function') {
            shownCount += B.renderUnifiedAll(el('jgInternalResultsMount'), el('jgExternalResultsMount'), p, navHandlers);
        } else {
            if (state.page === 1 || ['internal', 'memoCalendar', 'album', 'healthAsset'].includes(tab)) {
                shownCount += R.renderInternalSections(el('jgInternalResultsMount'), r, tab, p.query, navHandlers);
            } else {
                el('jgInternalResultsMount').replaceChildren();
            }
            shownCount += R.renderExternalSections(el('jgExternalResultsMount'), p.external, tab, p.query, navHandlers);
        }

        const webTotal = p.totals?.web || p.external?.naver?.meta?.web?.total || 0;
        if (tab === 'all') {
            const totalHint = webTotal > 0 && H ? ` · 웹문서 ${H.formatTotalCount(webTotal, 0)}` : '';
            el('jgSearchStatusLine').textContent = `'${p.query}' 통합검색 (${p.internal?.isChosung ? '초성 검색 · ' : ''}분야 통합 스트림${totalHint})`;
        } else {
            const label = TAB_LABELS[tab] || '검색';
            const tabTotal = p.totals?.[tab] || p.counts?.[tab] || 0;
            const totalText = tabTotal > 0 && H ? ` · ${H.formatTotalCount(tabTotal, 0)}` : '';
            el('jgSearchStatusLine').textContent = `'${p.query}' · ${label} 결과 (${state.page}페이지${totalText})`;
        }

        el('jgEmptyResults').style.display = shownCount === 0 ? 'block' : 'none';
        if (shownCount === 0) showEmpty(p.query);
    }

    let suggestHandle = null;
    function hideSuggest(options) {
        if (suggestHandle) suggestHandle.close(options);
    }

    function initEvents() {
        const form = el('jgSearchForm');
        const input = el('jgSearchInput');
        const clearBtn = el('jgSearchClearBtn');

        input.addEventListener('input', () => {
            clearBtn.style.display = input.value ? 'inline-flex' : 'none';
        });

        if (window.JGSearchSuggest) {
            suggestHandle = window.JGSearchSuggest.attach({
                input,
                dropdown: el('jgSuggestDropdown'),
                showOnEmptyFocus: true,
                onSelect: (chosen) => {
                    if (chosen.type === 'shortcut' && chosen.url) {
                        window.location.href = safeHref(chosen.url);
                        return;
                    }
                    runSearch(chosen.text, 'all', true, 1);
                }
            });
        }

        // IME 조합 중 Enter 조기 제출 방지 (ime-safe-enter-submit 가이드 준수)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) {
                e.preventDefault();
            }
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            hideSuggest({ blur: true, suppressMs: 450 });
            runSearch(input.value, 'all', true, 1);
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.style.display = 'none';
            updateUrl('', 'all', 1);
            showHomeMode();
            input.focus();
        });

        document.querySelectorAll('#jgSearchTabs .jg-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                switchTab(btn.dataset.tab || 'all', 1, true);
            });
        });

        const aiBtn = el('jgAiSummaryBtn');
        if (aiBtn) {
            aiBtn.addEventListener('click', () => {
                if (window.JGSearchCardHelpers && window.JGSearchCardHelpers.streamAiSummary) {
                    window.JGSearchCardHelpers.streamAiSummary({
                        mount: el('jgAiSummaryMount'),
                        aiBtn,
                        query: state.query,
                        tab: state.tab
                    });
                }
            });
        }

        document.querySelectorAll('.jg-hint-chip').forEach((chip) => {
            chip.addEventListener('click', () => runSearch(chip.dataset.query || '', 'all', true, 1));
        });

        el('jgToggleAutoSaveBtn').addEventListener('click', async () => {
            const next = !state.autoSave;
            const res = await fetch('/api/search/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ autoSave: next })
            });
            const data = await res.json();
            if (data.success) {
                state.autoSave = Boolean(data.autoSave);
                updateAutoSaveBtn();
                loadHomeData();
            }
        });

        el('jgClearHistoryBtn').addEventListener('click', async () => {
            await fetch('/api/search/history', { method: 'DELETE', credentials: 'include' });
            loadHomeData();
        });

        window.addEventListener('popstate', () => {
            const { q, tab, page, cat } = readUrlParams();
            if (q) runSearch(q, tab, false, page, { localCat: cat });
            else showHomeMode();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initEvents();
        const { q, tab, page, cat } = readUrlParams();
        if (q) {
            runSearch(q, tab, false, page, { localCat: cat });
        } else {
            showHomeMode();
        }
    });
})();
