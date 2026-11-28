/**
 * 🧩 JG 통합 스마트 검색 - 에디토리얼 결과 카드·출처 파비콘·하이라이트·페이지네이션 헬퍼 (search-card-helpers.js)
 * - 모든 텍스트 및 키워드 강조(<mark>)를 순수 DOM 노드 분할로 생성하여 XSS 원천 차단
 */
(function (global) {
    'use strict';

    const SITE_NAME_MAP = {
        'namu.wiki': '나무위키',
        'ko.wikipedia.org': '위키백과',
        'en.wikipedia.org': 'Wikipedia',
        'blog.naver.com': '네이버 블로그',
        'm.blog.naver.com': '네이버 블로그',
        'cafe.naver.com': '네이버 카페',
        'terms.naver.com': '네이버 지식백과',
        'kin.naver.com': '네이버 지식iN',
        'news.naver.com': '네이버 뉴스',
        'n.news.naver.com': '네이버 뉴스',
        'brunch.co.kr': '브런치스토리',
        'velog.io': '벨로그',
        'youtube.com': '유튜브',
        'youtu.be': '유튜브',
        'github.com': 'GitHub'
    };

    function makeEl(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function safeHref(url) {
        if (!url || typeof url !== 'string') return '#';
        const trimmed = url.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
            return trimmed;
        }
        return '#';
    }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function extractKeywordTokens(query) {
        if (!query || typeof query !== 'string') return [];
        const parts = query
            .trim()
            .split(/\s+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 1 && !/^[\u3131-\u314E]+$/.test(t));
        const unique = Array.from(new Set(parts)).slice(0, 6);
        unique.sort((a, b) => b.length - a.length);
        return unique;
    }

    function appendHighlightedText(parent, rawText, query, markClass) {
        const text = String(rawText || '');
        if (!text) return;
        const tokens = extractKeywordTokens(query);
        if (!tokens.length) {
            parent.appendChild(document.createTextNode(text));
            return;
        }
        const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
        const chunks = text.split(pattern);
        const lowerSet = new Set(tokens.map((t) => t.toLowerCase()));

        chunks.forEach((chunk) => {
            if (!chunk) return;
            if (lowerSet.has(chunk.toLowerCase())) {
                const mark = document.createElement('mark');
                mark.className = markClass || 'jg-hl';
                mark.textContent = chunk;
                parent.appendChild(mark);
            } else {
                parent.appendChild(document.createTextNode(chunk));
            }
        });
    }

    function resolveSourceInfo(url, sourceLabel, badgeIcon) {
        if (!url || url.startsWith('/')) {
            return {
                isInternal: true,
                badgeIcon: badgeIcon || '🏠',
                siteName: sourceLabel || '우리 사이트',
                crumb: ''
            };
        }

        try {
            const parsed = new URL(url);
            const host = parsed.hostname.replace(/^www\./i, '');
            let siteName = sourceLabel || SITE_NAME_MAP[host] || '';
            if (!siteName) {
                if (host.endsWith('.tistory.com')) siteName = '티스토리';
                else if (host.endsWith('.go.kr')) siteName = '정부·공공기관';
                else siteName = host;
            }

            let crumb = '';
            if (siteName !== host) {
                crumb = host;
            } else {
                const seg = parsed.pathname.split('/').filter(Boolean)[0] || '';
                if (seg && seg.length <= 24) {
                    try {
                        crumb = decodeURIComponent(seg);
                    } catch (_) {
                        crumb = seg;
                    }
                }
            }

            return {
                isInternal: false,
                host,
                faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`,
                siteName,
                crumb
            };
        } catch (_) {
            return {
                isInternal: true,
                badgeIcon: badgeIcon || '🌐',
                siteName: sourceLabel || '웹 문서',
                crumb: ''
            };
        }
    }

    function createEditorialItem(info, query) {
        const article = makeEl('article', info.extraClass ? `jg-result-item ${info.extraClass}` : 'jg-result-item');

        if (info.thumbnail) {
            const img = makeEl('img', 'jg-card-media');
            img.src = safeHref(info.thumbnail);
            img.alt = info.title || '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.addEventListener('error', () => img.remove());
            article.appendChild(img);
        }

        const header = makeEl('header', 'jg-result-source');
        const src = resolveSourceInfo(info.url, info.source, info.badgeIcon);

        if (src.isInternal || !src.faviconUrl) {
            header.appendChild(makeEl('span', 'jg-source-badge-icon', src.badgeIcon || '🌐'));
        } else {
            const fav = makeEl('img', 'jg-source-favicon');
            fav.src = src.faviconUrl;
            fav.alt = '';
            fav.loading = 'lazy';
            fav.referrerPolicy = 'no-referrer';
            fav.addEventListener('error', () => {
                fav.replaceWith(makeEl('span', 'jg-source-badge-icon', '🌐'));
            });
            header.appendChild(fav);
        }

        header.appendChild(makeEl('span', 'jg-source-name', src.siteName));

        if (src.crumb) {
            header.appendChild(makeEl('span', 'jg-source-dot', '·'));
            header.appendChild(makeEl('span', 'jg-source-crumb', src.crumb));
        }

        if (info.date) {
            header.appendChild(makeEl('span', 'jg-source-dot', '·'));
            header.appendChild(makeEl('span', 'jg-source-date', info.date));
        }

        if (info.tag) {
            header.appendChild(makeEl('span', 'jg-source-tag', info.tag));
        }

        article.appendChild(header);

        const h4 = makeEl('h4', 'jg-result-title');
        const link = makeEl('a', 'jg-card-link');
        link.href = safeHref(info.url);
        if (info.external) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
        appendHighlightedText(link, info.title || '제목 없음', query, 'jg-hl');
        h4.appendChild(link);
        article.appendChild(h4);

        if (info.desc) {
            const p = makeEl('p', 'jg-result-desc');
            appendHighlightedText(p, info.desc, query, 'jg-hl-sub');
            article.appendChild(p);
        }

        return article;
    }

    function createSectionShell({ icon, title, countLabel, moreTab, moreChipText, onSwitchTab }) {
        const sec = makeEl('section', 'jg-section-card');
        const hdr = makeEl('div', 'jg-section-header');
        const left = makeEl('div', 'jg-section-heading-group');

        left.appendChild(makeEl('span', 'jg-section-dot'));
        left.appendChild(makeEl('h3', 'jg-section-title', `${icon} ${title}`));
        if (countLabel) {
            left.appendChild(makeEl('span', 'jg-section-count-pill', countLabel));
        }
        hdr.appendChild(left);

        if (moreTab && typeof onSwitchTab === 'function') {
            const chip = makeEl('button', 'jg-section-more-chip', moreChipText || '전체보기 ›');
            chip.type = 'button';
            chip.addEventListener('click', () => onSwitchTab(moreTab, 1));
            hdr.appendChild(chip);
        }

        sec.appendChild(hdr);
        return sec;
    }

    function appendMoreFooterButton(sec, label, targetTab, onSwitchTab) {
        if (!sec || !targetTab || typeof onSwitchTab !== 'function') return;
        const btn = makeEl('button', 'jg-section-more-btn', label);
        btn.type = 'button';
        btn.addEventListener('click', () => onSwitchTab(targetTab, 1));
        sec.appendChild(btn);
    }

    function appendPagination(sec, meta, onPageChange) {
        if (!sec || !meta || typeof onPageChange !== 'function') return;
        const totalPages = Number(meta.totalPages) || 0;
        const currentPage = Number(meta.page) || 1;
        if (totalPages <= 1) return;

        const nav = makeEl('nav', 'jg-pagination');
        nav.setAttribute('aria-label', '검색 결과 페이지 이동');

        const windowSize = 5;
        const blockStart = Math.floor((currentPage - 1) / windowSize) * windowSize + 1;
        const blockEnd = Math.min(totalPages, blockStart + windowSize - 1);

        const prevBtn = makeEl('button', 'jg-page-btn', '‹ 이전');
        prevBtn.type = 'button';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
        nav.appendChild(prevBtn);

        for (let p = blockStart; p <= blockEnd; p += 1) {
            const pBtn = makeEl('button', p === currentPage ? 'jg-page-btn active' : 'jg-page-btn', String(p));
            pBtn.type = 'button';
            if (p === currentPage) pBtn.setAttribute('aria-current', 'page');
            pBtn.addEventListener('click', () => {
                if (p !== currentPage) onPageChange(p);
            });
            nav.appendChild(pBtn);
        }

        const nextBtn = makeEl('button', 'jg-page-btn', '다음 ›');
        nextBtn.type = 'button';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
        nav.appendChild(nextBtn);

        sec.appendChild(nav);
    }

    function formatTotalCount(total, fallbackLen) {
        const n = Number(total) || Number(fallbackLen) || 0;
        if (n <= 0) return '';
        return n > 999999 ? `약 ${(n / 10000).toFixed(0)}만+건` : `약 ${n.toLocaleString()}건`;
    }

    async function streamAiSummary({ mount, aiBtn, query, tab }) {
        if (!mount || !aiBtn || !query || aiBtn.disabled) return;
        mount.replaceChildren();
        const card = makeEl('div', 'jg-ai-summary-card');
        const badge = makeEl('span', 'jg-smart-badge', '✨ AI 한눈에 요약');
        const body = makeEl('div', 'jg-ai-summary-body', '요약을 생성하고 있어요...');
        const note = makeEl('div', 'jg-muted-text');
        note.style.cssText = 'display:none;margin-top:8px;font-size:0.78rem;';
        card.append(badge, body, note);
        mount.appendChild(card);
        mount.style.display = 'block';
        aiBtn.disabled = true;

        let fullText = '';
        try {
            const res = await fetch('/api/search/ai-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ query, tab })
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
                        if (msg.meta) {
                            if (msg.meta.mode === 'cloud') {
                                badge.textContent = '⚡ AI 한눈에 요약 · 초고속 웹 요약';
                                if (msg.meta.internalSkippedCount > 0) {
                                    note.textContent = `🔒 내 사이트 결과 ${msg.meta.internalSkippedCount}건은 개인정보 보호를 위해 외부 AI에 전송하지 않았습니다.`;
                                    note.style.display = 'block';
                                }
                            } else if (msg.meta.mode === 'instant') {
                                badge.textContent = msg.meta.fallbackFromCloud
                                    ? '⚡ AI 한눈에 요약 · 핵심 즉시 정리'
                                    : '🔒 AI 한눈에 요약 · 내부 자료 즉시 정리';
                            } else if (msg.meta.mode === 'local') {
                                badge.textContent = '🔒 AI 한눈에 요약 · 로컬 보안 요약';
                            }
                        } else if (msg.token) {
                            fullText += msg.token;
                            global.JGSearchRenderers.renderAiSummaryText(body, fullText);
                        } else if (msg.error) {
                            body.textContent = msg.error;
                        }
                    } catch (_) {}
                }
            }
            if (!fullText.trim() && body.textContent === '요약을 생성하고 있어요...') {
                body.textContent = '요약할 검색 자료가 충분하지 않습니다.';
            }
        } catch (_) {
            body.textContent = 'AI 요약 생성 중 오류가 발생했습니다.';
        } finally {
            aiBtn.disabled = false;
        }
    }

    global.JGSearchCardHelpers = {
        safeHref,
        appendHighlightedText,
        createEditorialItem,
        createSectionShell,
        appendMoreFooterButton,
        appendPagination,
        formatTotalCount,
        streamAiSummary
    };
})(window);
