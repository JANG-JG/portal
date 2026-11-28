/**
 * ✨ JG 통합 검색 - 리치 자동완성 드롭다운 공통 모듈 (search-suggest.js)
 * - 바로 답(Instant Answer) 미리보기, 검색어 하이라이트(<mark>), 아이콘·부제목
 * - 빈 검색창 포커스 시 최근 검색어(개별 삭제) + 추천어 표시
 * - 90ms 디바운스 + AbortController + 30초 클라이언트 캐시
 */
(function (global) {
    'use strict';

    const SUGGEST_CACHE_TTL_MS = 30000;

    function buildHighlightedNode(text, query) {
        const span = document.createElement('span');
        span.className = 'jg-suggest-main-text';
        const str = String(text || '');
        const q = String(query || '').trim();
        if (!q) {
            span.textContent = str;
            return span;
        }
        const idx = str.toLowerCase().indexOf(q.toLowerCase());
        if (idx < 0) {
            span.textContent = str;
            return span;
        }
        if (idx > 0) span.appendChild(document.createTextNode(str.slice(0, idx)));
        const mark = document.createElement('mark');
        mark.className = 'jg-suggest-hl';
        mark.textContent = str.slice(idx, idx + q.length);
        span.appendChild(mark);
        if (idx + q.length < str.length) {
            span.appendChild(document.createTextNode(str.slice(idx + q.length)));
        }
        return span;
    }

    function attach(opts) {
        const input = opts && opts.input;
        const dropdown = opts && opts.dropdown;
        const onSelect = (opts && opts.onSelect) || (() => {});
        const showOnEmptyFocus = opts && opts.showOnEmptyFocus !== false;
        const maxItems = (opts && opts.maxItems) || 10;

        if (!input || !dropdown) return null;

        let activeIdx = -1;
        let currentItems = [];
        let timer = null;
        let abortCtrl = null;
        let suppressUntil = 0;
        const cache = new Map();

        function close(closeOpts = {}) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (abortCtrl) {
                try { abortCtrl.abort(); } catch (_) {}
                abortCtrl = null;
            }
            if (closeOpts.suppressMs > 0) {
                suppressUntil = Date.now() + closeOpts.suppressMs;
            }
            dropdown.style.display = 'none';
            dropdown.replaceChildren();
            activeIdx = -1;
            currentItems = [];
            if (closeOpts.blur && typeof input.blur === 'function') {
                input.blur();
            }
        }

        function updateActiveClass() {
            const rows = dropdown.querySelectorAll('.jg-suggest-item');
            rows.forEach((el, idx) => el.classList.toggle('active', idx === activeIdx));
        }

        async function deleteHistory(historyId, ev) {
            ev.preventDefault();
            ev.stopPropagation();
            try {
                await fetch(`/api/search/history/${encodeURIComponent(historyId)}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                cache.clear();
                loadAndRender(input.value.trim());
            } catch (_) {}
        }

        function render(items, rawQuery) {
            currentItems = Array.isArray(items) ? items.slice(0, maxItems) : [];
            activeIdx = -1;
            if (currentItems.length === 0) {
                close();
                return;
            }

            dropdown.replaceChildren();

            if (!rawQuery) {
                const header = document.createElement('div');
                header.className = 'jg-suggest-header';
                header.textContent = '최근 검색어 · 추천 키워드';
                dropdown.appendChild(header);
            }

            currentItems.forEach((item) => {
                const row = document.createElement('div');
                row.className = item.isInstant ? 'jg-suggest-item jg-suggest-instant' : 'jg-suggest-item';
                row.setAttribute('role', 'option');
                row.tabIndex = -1;

                const iconEl = document.createElement('span');
                iconEl.className = 'jg-suggest-icon';
                iconEl.textContent = item.icon || '🔎';

                const textWrap = document.createElement('div');
                textWrap.className = 'jg-suggest-text-wrap';

                if (item.isInstant) {
                    const ansEl = document.createElement('div');
                    ansEl.className = 'jg-suggest-instant-ans';
                    ansEl.textContent = item.subtitle || item.text;
                    const qEl = document.createElement('div');
                    qEl.className = 'jg-suggest-sub';
                    qEl.textContent = item.text;
                    textWrap.append(ansEl, qEl);
                } else {
                    textWrap.appendChild(buildHighlightedNode(item.text, rawQuery));
                    if (item.subtitle && item.type === 'shortcut') {
                        const subEl = document.createElement('div');
                        subEl.className = 'jg-suggest-sub';
                        subEl.textContent = item.subtitle;
                        textWrap.appendChild(subEl);
                    }
                }

                const rightWrap = document.createElement('div');
                rightWrap.className = 'jg-suggest-right';

                const badgeEl = document.createElement('span');
                badgeEl.className = item.isInstant ? 'jg-suggest-badge instant' : 'jg-suggest-badge';
                badgeEl.textContent = item.badge || '';
                rightWrap.appendChild(badgeEl);

                if (item.historyId) {
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'jg-suggest-del';
                    delBtn.title = '최근 검색어 삭제';
                    delBtn.textContent = '×';
                    delBtn.addEventListener('mousedown', (e) => deleteHistory(item.historyId, e));
                    rightWrap.appendChild(delBtn);
                }

                row.append(iconEl, textWrap, rightWrap);
                row.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    close();
                    onSelect(item);
                });
                dropdown.appendChild(row);
            });

            dropdown.style.display = 'block';
        }

        async function loadAndRender(q) {
            const cacheKey = q.toLowerCase();
            const hit = cache.get(cacheKey);
            if (hit && Date.now() - hit.ts < SUGGEST_CACHE_TTL_MS) {
                render(hit.list, q);
                return;
            }
            if (abortCtrl) abortCtrl.abort();
            abortCtrl = new AbortController();
            try {
                const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
                    credentials: 'include',
                    signal: abortCtrl.signal
                });
                const data = await res.json();
                const list = data.success ? (data.suggestions || []) : [];
                cache.set(cacheKey, { ts: Date.now(), list });
                if (input.value.trim() === q) {
                    render(list, q);
                }
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                close();
            }
        }

        input.addEventListener('input', () => {
            if (Date.now() < suppressUntil) return;
            const q = input.value.trim();
            clearTimeout(timer);
            if (!q) {
                if (showOnEmptyFocus) loadAndRender('');
                else close();
                return;
            }
            timer = setTimeout(() => loadAndRender(q), 90);
        });

        input.addEventListener('focus', () => {
            if (Date.now() < suppressUntil) return;
            const q = input.value.trim();
            if (!q) {
                if (showOnEmptyFocus) loadAndRender('');
            } else {
                loadAndRender(q);
            }
        });

        input.addEventListener('keydown', (e) => {
            if (dropdown.style.display === 'none' || currentItems.length === 0) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % currentItems.length;
                updateActiveClass();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIdx = activeIdx <= 0 ? currentItems.length - 1 : activeIdx - 1;
                updateActiveClass();
            } else if (e.key === 'Escape') {
                close();
            } else if (e.key === 'Enter' && activeIdx >= 0 && currentItems[activeIdx]) {
                e.preventDefault();
                const chosen = currentItems[activeIdx];
                close({ blur: true, suppressMs: 450 });
                onSelect(chosen);
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input && !dropdown.contains(e.target)) {
                close();
            }
        });

        global.addEventListener('pageshow', () => close());

        return { close, clearCache: () => cache.clear() };
    }

    global.JGSearchSuggest = { attach };
})(window);
