/**
 * 🔍 JG 통합 스마트 검색 페이지 컨트롤러 (search-page.js)
 * - IME 안전 엔터 제출, 실시간 자동완성, 최근 검색어 관리, 스마트 즉답 카드 & 내부 통합 결과 렌더링
 */
(function () {
    'use strict';

    const state = {
        query: '',
        tab: 'all',
        autoSave: true,
        lastPayload: null,
        suggestTimer: null,
        suggestIndex: -1,
        suggestions: []
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

    function readUrlParams() {
        const sp = new URLSearchParams(window.location.search);
        return {
            q: (sp.get('q') || '').trim(),
            tab: (sp.get('tab') || 'all').trim()
        };
    }

    function updateUrl(q, tab, replace = false) {
        const sp = new URLSearchParams();
        if (q) sp.set('q', q);
        if (tab && tab !== 'all') sp.set('tab', tab);
        const qs = sp.toString();
        const nextUrl = qs ? `/search?${qs}` : '/search';
        if (replace) window.history.replaceState({ q, tab }, '', nextUrl);
        else window.history.pushState({ q, tab }, '', nextUrl);
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
        state.lastPayload = null;
        el('jgSearchTabs').style.display = 'none';
        el('jgSearchResultsSection').style.display = 'none';
        el('jgSearchHomeSection').style.display = 'block';
        document.title = 'JG 통합 검색';
        loadHomeData();
    }

    async function runSearch(rawQuery, tab = 'all', pushUrl = true) {
        const q = (rawQuery || '').trim();
        if (!q) {
            if (pushUrl) updateUrl('', 'all');
            showHomeMode();
            return;
        }

        state.query = q;
        state.tab = tab || 'all';
        el('jgSearchInput').value = q;
        el('jgSearchClearBtn').style.display = 'inline-flex';
        hideSuggest();

        if (pushUrl) updateUrl(q, state.tab);
        document.title = `${q} - JG 통합 검색`;

        el('jgSearchHomeSection').style.display = 'none';
        el('jgSearchResultsSection').style.display = 'block';
        el('jgSearchTabs').style.display = 'flex';
        el('jgSearchLoading').style.display = 'block';
        el('jgEmptyResults').style.display = 'none';
        el('jgAiSummaryMount').style.display = 'none';
        el('jgAiSummaryMount').replaceChildren();
        el('jgSmartWidgetMount').replaceChildren();
        el('jgInternalResultsMount').replaceChildren();
        el('jgExternalResultsMount').replaceChildren();
        updateTabUI();

        try {
            const res = await fetch(`/api/search/portal?q=${encodeURIComponent(q)}&tab=${encodeURIComponent(state.tab)}`, { credentials: 'include' });
            const payload = await res.json();
            el('jgSearchLoading').style.display = 'none';
            if (!payload.success) {
                showEmpty(q);
                return;
            }
            state.lastPayload = payload;
            updateTabCounts(payload.counts || {});
            renderResults();
        } catch (_) {
            el('jgSearchLoading').style.display = 'none';
            showEmpty(q);
        }
    }

    function updateTabUI() {
        document.querySelectorAll('#jgSearchTabs .jg-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === state.tab);
        });
    }

    function updateTabCounts(counts) {
        const setCnt = (id, val) => { const n = el(id); if (n) n.textContent = val || 0; };
        setCnt('tabCntAll', counts.all);
        setCnt('tabCntInternal', counts.internal);
        setCnt('tabCntWebBlog', counts.webBlog);
        setCnt('tabCntEncyc', counts.encyc);
        setCnt('tabCntLocal', counts.local);
        setCnt('tabCntGoogle', counts.google);
        setCnt('tabCntMemoCal', counts.memoCalendar);
        setCnt('tabCntWikiNews', counts.wikiNews);
        setCnt('tabCntAlbum', counts.album);
        setCnt('tabCntHealthAsset', counts.healthAsset);
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

        if (tab === 'all') R.renderSmartWidget(el('jgSmartWidgetMount'), p.smartWidget);
        else el('jgSmartWidgetMount').replaceChildren();

        let shownCount = tab === 'all' && p.smartWidget ? 1 : 0;
        shownCount += R.renderInternalSections(el('jgInternalResultsMount'), r, tab);
        shownCount += R.renderExternalSections(el('jgExternalResultsMount'), p.external, tab);

        el('jgSearchStatusLine').textContent = `'${p.query}' 검색 결과 (${p.internal?.isChosung ? '초성 검색 · ' : ''}총 ${p.counts?.all || 0}건)`;
        el('jgEmptyResults').style.display = shownCount === 0 ? 'block' : 'none';
        if (shownCount === 0) showEmpty(p.query);
    }

    // 자동완성 제어
    function hideSuggest() {
        el('jgSuggestDropdown').style.display = 'none';
        state.suggestIndex = -1;
    }

    function renderSuggestions(list) {
        const box = el('jgSuggestDropdown');
        box.replaceChildren();
        state.suggestions = list || [];
        state.suggestIndex = -1;
        if (!state.suggestions.length) {
            box.style.display = 'none';
            return;
        }
        state.suggestions.forEach((s, idx) => {
            const btn = makeEl('button', 'jg-suggest-item');
            btn.type = 'button';
            btn.dataset.idx = String(idx);
            btn.append(makeEl('span', 'jg-suggest-text', s.text), makeEl('span', 'jg-suggest-badge', s.badge || ''));
            btn.addEventListener('click', () => {
                hideSuggest();
                if (s.type === 'shortcut' && s.url) {
                    window.location.href = safeHref(s.url);
                } else {
                    runSearch(s.text, 'all');
                }
            });
            box.appendChild(btn);
        });
        box.style.display = 'block';
    }

    const suggestCache = new Map();
    let suggestAbortCtrl = null;

    async function fetchSuggestions(prefix) {
        const key = (prefix || '').toLowerCase();
        const cached = suggestCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            renderSuggestions(cached.items);
            return;
        }
        if (suggestAbortCtrl) suggestAbortCtrl.abort();
        suggestAbortCtrl = new AbortController();
        try {
            const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(prefix)}`, {
                credentials: 'include',
                signal: suggestAbortCtrl.signal
            });
            const data = await res.json();
            if (data.success) {
                suggestCache.set(key, { items: data.suggestions, expiresAt: Date.now() + 30000 });
                renderSuggestions(data.suggestions);
            }
        } catch (err) {
            if (err && err.name === 'AbortError') return;
        }
    }

    function initEvents() {
        const form = el('jgSearchForm');
        const input = el('jgSearchInput');
        const clearBtn = el('jgSearchClearBtn');

        input.addEventListener('input', () => {
            const val = input.value;
            clearBtn.style.display = val ? 'inline-flex' : 'none';
            clearTimeout(state.suggestTimer);
            state.suggestTimer = setTimeout(() => fetchSuggestions(val.trim()), 90);
        });

        input.addEventListener('focus', () => {
            fetchSuggestions(input.value.trim());
        });

        // IME 조합 중 Enter 조기 제출 방지 (ime-safe-enter-submit 가이드 준수)
        input.addEventListener('keydown', (e) => {
            const dropdown = el('jgSuggestDropdown');
            const isOpen = dropdown.style.display === 'block' && state.suggestions.length > 0;

            if (e.key === 'ArrowDown' && isOpen) {
                e.preventDefault();
                state.suggestIndex = (state.suggestIndex + 1) % state.suggestions.length;
                highlightSuggest();
                return;
            }
            if (e.key === 'ArrowUp' && isOpen) {
                e.preventDefault();
                state.suggestIndex = (state.suggestIndex - 1 + state.suggestions.length) % state.suggestions.length;
                highlightSuggest();
                return;
            }
            if (e.key === 'Escape') {
                hideSuggest();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.isComposing || e.keyCode === 229) return;
                if (isOpen && state.suggestIndex >= 0) {
                    const chosen = state.suggestions[state.suggestIndex];
                    hideSuggest();
                    if (chosen.type === 'shortcut' && chosen.url) {
                        window.location.href = safeHref(chosen.url);
                        return;
                    }
                    runSearch(chosen.text, 'all');
                    return;
                }
                form.requestSubmit();
            }
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            runSearch(input.value, 'all');
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.style.display = 'none';
            input.focus();
            updateUrl('', 'all');
            showHomeMode();
        });

        document.addEventListener('click', (e) => {
            if (!form.contains(e.target)) hideSuggest();
        });

        document.querySelectorAll('#jgSearchTabs .jg-tab-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                state.tab = btn.dataset.tab || 'all';
                updateTabUI();
                updateUrl(state.query, state.tab, true);

                if (state.tab === 'google' && state.lastPayload?.external?.google?.skipped && state.query) {
                    el('jgSearchLoading').style.display = 'block';
                    try {
                        const res = await fetch(`/api/search/external?q=${encodeURIComponent(state.query)}&mode=google`, { credentials: 'include' });
                        const data = await res.json();
                        if (data.success && data.external) {
                            state.lastPayload.external.google = data.external.google;
                            const ggCnt = data.external.google?.items?.length || 0;
                            if (state.lastPayload.counts) state.lastPayload.counts.google = ggCnt;
                            updateTabCounts(state.lastPayload.counts || {});
                        }
                    } catch (_) {}
                    el('jgSearchLoading').style.display = 'none';
                }
                renderResults();
            });
        });

        const aiBtn = el('jgAiSummaryBtn');
        if (aiBtn) {
            aiBtn.addEventListener('click', async () => {
                if (!state.query || aiBtn.disabled) return;
                const mount = el('jgAiSummaryMount');
                mount.replaceChildren();
                const card = makeEl('div', 'jg-ai-summary-card');
                card.appendChild(makeEl('span', 'jg-smart-badge', '✨ AI 한눈에 요약'));
                const body = makeEl('div', 'jg-ai-summary-body', '요약을 생성하고 있어요...');
                card.appendChild(body);
                mount.appendChild(card);
                mount.style.display = 'block';
                aiBtn.disabled = true;

                let fullText = '';
                try {
                    const res = await fetch('/api/search/ai-summary', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ query: state.query })
                    });
                    if (!res.ok || !res.body) throw new Error('STREAM_ERR');
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let buf = '';
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        const lines = buf.split('\n');
                        buf = lines.pop() || '';
                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            try {
                                const msg = JSON.parse(line.slice(6));
                                if (msg.token) {
                                    fullText += msg.token;
                                    window.JGSearchRenderers.renderAiSummaryText(body, fullText);
                                } else if (msg.error) {
                                    body.textContent = msg.error;
                                }
                            } catch (_) {}
                        }
                    }
                } catch (_) {
                    body.textContent = 'AI 요약 생성 중 오류가 발생했습니다.';
                } finally {
                    aiBtn.disabled = false;
                }
            });
        }

        document.querySelectorAll('.jg-hint-chip').forEach((chip) => {
            chip.addEventListener('click', () => runSearch(chip.dataset.query || '', 'all'));
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
            const { q, tab } = readUrlParams();
            if (q) runSearch(q, tab, false);
            else showHomeMode();
        });
    }

    function highlightSuggest() {
        document.querySelectorAll('#jgSuggestDropdown .jg-suggest-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === state.suggestIndex);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initEvents();
        const { q, tab } = readUrlParams();
        if (q) {
            runSearch(q, tab, false);
        } else {
            showHomeMode();
        }
    });
})();
