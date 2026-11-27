/**
 * 🔎 JG 포털 메인 상단 인라인 스마트 검색바 위젯 (search-bar-widget.js)
 * - 실시간 자동완성(최근 검색어·내 사이트·스마트 추천) + IME 안전 엔터 제출 -> /search?q=... 이동
 */
(function () {
    'use strict';

    let suggestTimer = null;
    let suggestions = [];
    let activeIdx = -1;

    function navigateToSearch(q) {
        const trimmed = (q || '').trim();
        window.location.href = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search';
    }

    function safeHref(url) {
        if (!url || typeof url !== 'string') return '/search';
        const trimmed = url.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
            return trimmed;
        }
        return '/search';
    }

    function renderSuggestBox(box, list) {
        box.replaceChildren();
        suggestions = list || [];
        activeIdx = -1;
        if (!suggestions.length) {
            box.style.display = 'none';
            return;
        }
        suggestions.forEach((s) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'jg-suggest-item';
            const txt = document.createElement('span');
            txt.className = 'jg-suggest-text';
            txt.textContent = s.text;
            const badge = document.createElement('span');
            badge.className = 'jg-suggest-badge';
            badge.textContent = s.badge || '';
            btn.append(txt, badge);
            btn.addEventListener('click', () => {
                box.style.display = 'none';
                if (s.type === 'shortcut' && s.url) {
                    window.location.href = safeHref(s.url);
                } else {
                    navigateToSearch(s.text);
                }
            });
            box.appendChild(btn);
        });
        box.style.display = 'block';
    }

    function highlightItem(box) {
        box.querySelectorAll('.jg-suggest-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === activeIdx);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('jgPortalInlineSearchForm');
        const input = document.getElementById('jgPortalInlineSearchInput');
        const box = document.getElementById('jgPortalInlineSuggest');
        if (!form || !input || !box) return;

        const suggestCache = new Map();
        let suggestAbortCtrl = null;

        async function loadSuggest(prefix) {
            const key = (prefix || '').toLowerCase();
            const cached = suggestCache.get(key);
            if (cached && cached.expiresAt > Date.now()) {
                renderSuggestBox(box, cached.items);
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
                    renderSuggestBox(box, data.suggestions);
                }
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }

        input.addEventListener('input', () => {
            clearTimeout(suggestTimer);
            suggestTimer = setTimeout(() => loadSuggest(input.value.trim()), 90);
        });

        input.addEventListener('focus', () => {
            loadSuggest(input.value.trim());
        });

        input.addEventListener('keydown', (e) => {
            const isOpen = box.style.display === 'block' && suggestions.length > 0;
            if (e.key === 'ArrowDown' && isOpen) {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % suggestions.length;
                highlightItem(box);
                return;
            }
            if (e.key === 'ArrowUp' && isOpen) {
                e.preventDefault();
                activeIdx = (activeIdx - 1 + suggestions.length) % suggestions.length;
                highlightItem(box);
                return;
            }
            if (e.key === 'Escape') {
                box.style.display = 'none';
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.isComposing || e.keyCode === 229) return;
                if (isOpen && activeIdx >= 0) {
                    const chosen = suggestions[activeIdx];
                    box.style.display = 'none';
                    if (chosen.type === 'shortcut' && chosen.url) {
                        window.location.href = safeHref(chosen.url);
                        return;
                    }
                    navigateToSearch(chosen.text);
                    return;
                }
                form.requestSubmit();
            }
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            navigateToSearch(input.value);
        });

        document.addEventListener('click', (e) => {
            if (!form.contains(e.target)) box.style.display = 'none';
        });
    });
})();
