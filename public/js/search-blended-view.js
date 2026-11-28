/**
 * 🌐 JG 통합 검색 - 분야 혼합 유니버설 스트림 뷰 (search-blended-view.js)
 * - 통합검색(tab=all)에서 카테고리 칸막이 없이 [내 기록·보관함 + 백과·지식 + 웹문서 + 블로그·카페 + 뉴스]를
 *   다양성 가중 라운드로빈으로 골고루 배치하고 인라인 이미지 스트립 및 보관(📌) 버튼을 결합
 */
(function (global) {
    'use strict';

    const makeEl = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    };

    function canonicalizeUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return '';
        const trimmed = rawUrl.trim();
        if (trimmed.startsWith('/')) return trimmed;
        try {
            const u = new URL(trimmed);
            const host = u.hostname.replace(/^(www|m)\./i, '').toLowerCase();
            const path = u.pathname.replace(/\/+$/, '') || '/';
            return `${host}${path}${u.search || ''}`;
        } catch (_) {
            return trimmed.toLowerCase();
        }
    }

    function renderPriorityInternalStrips(internalMount, r, query, nav) {
        const R = global.JGSearchRenderers;
        const H = global.JGSearchCardHelpers;
        if (!internalMount || !R || !H) return 0;
        internalMount.replaceChildren();

        let count = 0;
        if (Array.isArray(r.shortcuts) && r.shortcuts.length > 0) {
            count += R.appendSection(internalMount, { icon: '⚡', title: '서비스 바로가기' }, r.shortcuts, (sec, items) => {
                R.renderListItems(sec, items, query, (s) => ({
                    title: s.title,
                    desc: s.desc,
                    url: s.url,
                    source: '포털 바로가기',
                    badgeIcon: s.icon || '⚡'
                }));
            });
        }

        if (Array.isArray(r.album) && r.album.length > 0) {
            count += R.appendSection(
                internalMount,
                { icon: '📸', title: '가족 앨범', moreTab: 'album', moreChipText: '앨범 더보기 ›', onSwitchTab: nav.onSwitchTab },
                r.album.slice(0, 4),
                (sec, items) => {
                    const grid = makeEl('div', 'jg-album-grid');
                    items.forEach((ph) => {
                        const card = makeEl('a', 'jg-album-card');
                        card.href = H.safeHref(ph.url);
                        const wrap = makeEl('div', 'jg-album-thumb-wrap');
                        if (ph.thumbUrl) {
                            const img = makeEl('img', 'jg-album-thumb');
                            img.src = H.safeHref(ph.thumbUrl);
                            img.alt = ph.caption || '가족 사진';
                            img.loading = 'lazy';
                            wrap.appendChild(img);
                        }
                        const info = makeEl('div', 'jg-album-info');
                        info.append(
                            makeEl('div', 'jg-album-caption', ph.caption || '가족 사진'),
                            makeEl('div', 'jg-album-date', `${ph.taken_at || ''} ${ph.location ? '· ' + ph.location : ''}`.trim())
                        );
                        card.append(wrap, info);
                        grid.appendChild(card);
                    });
                    sec.appendChild(grid);
                }
            );
        }

        return count;
    }

    function collectPools(payload) {
        const r = payload.internal?.results || {};
        const ext = payload.external || {};
        const nv = ext.naver || {};
        const gg = ext.google || {};
        const query = payload.query || '';

        const savedPool = (r.savedClips || []).map((c) => ({
            group: 'internal',
            title: c.title,
            desc: (c.snippet || '').slice(0, 180),
            source: c.site_name || '내 서버 보관함',
            badgeIcon: '📌',
            categoryBadge: { label: '📌 내 보관함', tone: 'clip' },
            thumbnail: c.thumbnail_url || null,
            url: c.url,
            external: true,
            clippable: true,
            clipped: true,
            clipCategory: 'clip'
        }));

        const internalPool = [];
        (r.memos || []).slice(0, 2).forEach((m) => internalPool.push({
            group: 'internal',
            title: m.title,
            desc: (m.content || '').slice(0, 160),
            source: '포털 메모',
            badgeIcon: '📝',
            categoryBadge: { label: '📝 내 메모', tone: 'internal' },
            date: (m.updated_at || '').slice(0, 10),
            url: m.url
        }));
        (r.calendar || []).slice(0, 2).forEach((c) => internalPool.push({
            group: 'internal',
            title: c.title,
            desc: c.memo || '',
            source: '스마트 캘린더',
            badgeIcon: '📅',
            categoryBadge: { label: '📅 일정', tone: 'internal' },
            date: `${c.event_date || ''} ${c.event_time || ''}`.trim(),
            url: c.url
        }));
        (r.wiki || []).slice(0, 2).forEach((w) => internalPool.push({
            group: 'internal',
            title: w.title,
            desc: w.excerpt || '',
            source: '가족 위키',
            badgeIcon: '📖',
            categoryBadge: { label: '📖 가족 위키', tone: 'internal' },
            url: w.url
        }));
        (r.news || []).slice(0, 2).forEach((n) => internalPool.push({
            group: 'news',
            title: n.title,
            desc: (n.summary || '').slice(0, 160),
            source: n.media_name || 'JG 뉴스룸',
            badgeIcon: '📰',
            categoryBadge: { label: '📰 뉴스룸', tone: 'news' },
            date: n.date || '',
            url: n.link || '/go/news',
            external: Boolean(n.link),
            clippable: Boolean(n.link)
        }));
        (r.botDocs || []).slice(0, 2).forEach((d) => internalPool.push({
            group: 'internal',
            title: d.title,
            desc: (d.snippet || '').slice(0, 180),
            source: d.site_name || '웹봇 수집',
            badgeIcon: '🤖',
            categoryBadge: { label: '🤖 웹봇 아카이브', tone: 'internal' },
            date: (d.published_at || '').slice(0, 10),
            thumbnail: d.og_image || null,
            url: d.url,
            external: true,
            clippable: true,
            clipCategory: 'web'
        }));
        (r.hospitals || []).slice(0, 1).forEach((h) => internalPool.push({
            group: 'internal',
            title: `${h.hospital_name} (${h.department || '진료'})`,
            desc: h.memo || '',
            source: '혈압·건강 관리',
            badgeIcon: '🏥',
            categoryBadge: { label: '🏥 병원 일정', tone: 'internal' },
            date: `방문 ${h.visit_date || '-'}`,
            url: 'https://blood.j-jg.cc/dashboard.html#hospital'
        }));
        (r.medications || []).slice(0, 1).forEach((m) => internalPool.push({
            group: 'internal',
            title: `${m.med_name} (${m.target_label})`,
            desc: m.dosage_note || '',
            source: '약 챙겨먹기',
            badgeIcon: '💊',
            categoryBadge: { label: '💊 복약 관리', tone: 'internal' },
            url: m.url
        }));
        (r.assets || []).slice(0, 1).forEach((a) => internalPool.push({
            group: 'internal',
            title: `${a.full_name || a.symbol} (${a.symbol})`,
            desc: `${a.asset_type || ''} · 수량 ${a.quantity}`,
            source: '자산 관리',
            badgeIcon: '💰',
            categoryBadge: { label: '💰 보유 자산', tone: 'internal' },
            url: 'https://asset.j-jg.cc'
        }));

        const encycPool = [];
        if (ext.wikipedia && payload.smartWidget?.type !== 'regionComposite') {
            const wk = ext.wikipedia;
            encycPool.push({
                group: 'web',
                title: wk.title,
                desc: wk.extract,
                source: '위키백과',
                categoryBadge: { label: '📚 백과·지식', tone: 'encyc' },
                tag: wk.description || '',
                thumbnail: wk.thumbnail || null,
                url: wk.url,
                external: true,
                clippable: true,
                clipped: Boolean(wk.clipped),
                clipCategory: 'encyc',
                extraAction: query ? { label: `🌳 나무위키 '${query}' ↗`, url: `https://namu.wiki/w/${encodeURIComponent(query)}` } : null
            });
        }
        (nv.encyc || []).slice(0, 3).forEach((it) => encycPool.push({
            group: 'web',
            title: it.title,
            desc: it.description,
            source: '네이버 지식백과',
            categoryBadge: { label: '📘 지식백과', tone: 'encyc' },
            thumbnail: it.thumbnail || null,
            url: it.link,
            external: true,
            clippable: true,
            clipped: Boolean(it.clipped),
            clipCategory: 'encyc'
        }));

        const webPool = (nv.web || []).map((it) => ({
            group: 'web',
            title: it.title,
            desc: it.description,
            source: it.siteName || '',
            categoryBadge: { label: it.link && it.link.includes('namu.wiki') ? '🌳 나무위키' : '🌐 웹문서', tone: 'web' },
            date: it.date || '',
            thumbnail: it.thumbnail || null,
            url: it.link,
            external: true,
            clippable: true,
            clipped: Boolean(it.clipped),
            clipCategory: 'web'
        }));

        const blogPool = (nv.blog || []).map((it) => ({
            group: 'blog',
            title: it.title,
            desc: it.description,
            source: it.bloggername || it.cafename || it.source || '블로그',
            categoryBadge: { label: it.provider === 'daum_cafe' ? '☕ 카페 후기' : '✍️ 블로그', tone: 'blog' },
            date: it.date || it.postdate || '',
            thumbnail: it.thumbnail || null,
            url: it.link,
            external: true,
            clippable: true,
            clipped: Boolean(it.clipped),
            clipCategory: 'blog'
        }));

        const newsPool = (nv.news || []).map((it) => ({
            group: 'news',
            title: it.title,
            desc: it.description,
            categoryBadge: { label: '🗞️ 뉴스', tone: 'news' },
            date: it.date || '',
            thumbnail: it.thumbnail || null,
            url: it.link,
            external: true,
            clippable: true,
            clipped: Boolean(it.clipped),
            clipCategory: 'news'
        }));

        const googlePool = (gg.items || []).map((it) => ({
            group: 'web',
            title: it.title,
            desc: it.description,
            categoryBadge: { label: '🔎 구글 웹', tone: 'web' },
            url: it.link,
            external: true,
            clippable: true,
            clipped: Boolean(it.clipped),
            clipCategory: 'web'
        }));

        return { savedPool, internalPool, encycPool, webPool, blogPool, newsPool, googlePool };
    }

    function interleaveStream(pools, maxItems = 18) {
        const seen = new Set();
        const stream = [];

        const pushUnique = (item) => {
            if (!item || !item.title || stream.length >= maxItems) return false;
            const key = canonicalizeUrl(item.url) || `${item.group}:${item.title}`;
            if (seen.has(key)) return false;
            seen.add(key);
            stream.push(item);
            return true;
        };

        // 0순위: 사용자가 직접 보관한 내 서버 스크랩 상위 2건 우선 노출
        pools.savedPool.slice(0, 2).forEach(pushUnique);

        const queues = [
            pools.internalPool.slice(),
            pools.encycPool.slice(),
            pools.webPool.slice(),
            pools.blogPool.slice(),
            pools.newsPool.slice(),
            pools.googlePool.slice()
        ];

        let progressed = true;
        while (progressed && stream.length < maxItems) {
            progressed = false;
            for (const q of queues) {
                while (q.length > 0) {
                    const candidate = q.shift();
                    if (pushUnique(candidate)) {
                        progressed = true;
                        break;
                    }
                }
                if (stream.length >= maxItems) break;
            }
        }

        return stream;
    }

    function renderUnifiedAll(internalMount, externalMount, payload, nav = {}) {
        const H = global.JGSearchCardHelpers;
        const M = global.JGSearchMediaModal;
        if (!externalMount || !H) return 0;

        externalMount.replaceChildren();
        const query = payload.query || '';
        let totalShown = renderPriorityInternalStrips(internalMount, payload.internal?.results || {}, query, nav);

        const pools = collectPools(payload);
        const blendedItems = interleaveStream(pools, 18);
        const imageItems = payload.external?.images?.items || [];

        if (blendedItems.length === 0 && imageItems.length === 0) {
            return totalShown;
        }

        const sec = makeEl('section', 'jg-section-card jg-blended-card');
        const hdr = makeEl('div', 'jg-section-header jg-blended-header');
        const titleGrp = makeEl('div', 'jg-section-heading-group');
        titleGrp.append(
            makeEl('span', 'jg-section-dot'),
            makeEl('h3', 'jg-section-title', '✨ 통합 유니버설 스트림'),
            makeEl('span', 'jg-section-count-pill', `${blendedItems.length}건 핵심 교차 편집`)
        );
        hdr.appendChild(titleGrp);

        const filterDefs = [
            { id: 'all', label: '전체 골고루' },
            { id: 'internal', label: '🏠 내 기록·보관함' },
            { id: 'web', label: '🌐 웹·백과' },
            { id: 'blog', label: '✍️ 블로그·카페' },
            { id: 'news', label: '🗞️ 뉴스' }
        ];
        const filterBar = makeEl('div', 'jg-blended-filter-bar');
        const listWrap = makeEl('div', 'jg-result-list jg-blended-list');

        const renderStreamWithFilter = (activeGroup) => {
            listWrap.replaceChildren();
            const filtered = activeGroup === 'all'
                ? blendedItems
                : blendedItems.filter((it) => it.group === activeGroup);

            if (!filtered.length && !(activeGroup === 'all' && imageItems.length)) {
                listWrap.appendChild(makeEl('p', 'jg-muted-text', '선택한 분류에 해당하는 상위 결과가 없습니다. 하단 분야별 탭을 눌러 더 찾아보세요.'));
                return;
            }

            const imgInsertAt = Math.min(4, filtered.length);
            filtered.forEach((item, idx) => {
                if (activeGroup === 'all' && idx === imgInsertAt && M && imageItems.length > 0) {
                    const stripEl = M.createInlineImageStrip(imageItems, query, nav.onSwitchTab);
                    if (stripEl) listWrap.appendChild(stripEl);
                }
                listWrap.appendChild(H.createEditorialItem(item, query));
            });

            if (activeGroup === 'all' && filtered.length < 4 && M && imageItems.length > 0) {
                const stripEl = M.createInlineImageStrip(imageItems, query, nav.onSwitchTab);
                if (stripEl) listWrap.appendChild(stripEl);
            }
        };

        filterDefs.forEach((f) => {
            const chip = makeEl('button', f.id === 'all' ? 'jg-blended-filter-chip active' : 'jg-blended-filter-chip', f.label);
            chip.type = 'button';
            chip.addEventListener('click', () => {
                filterBar.querySelectorAll('.jg-blended-filter-chip').forEach((b) => {
                    b.classList.toggle('active', b === chip);
                });
                renderStreamWithFilter(f.id);
            });
            filterBar.appendChild(chip);
        });

        sec.append(hdr, filterBar, listWrap);
        renderStreamWithFilter('all');

        // 하단 분야별 전문 탭 빠른 이동 바
        if (typeof nav.onSwitchTab === 'function') {
            const jumpBar = makeEl('div', 'jg-blended-jump-bar');
            const jumps = [
                { tab: 'web', label: '🌐 웹문서 더보기' },
                { tab: 'blog', label: '✍️ 블로그·카페 더보기' },
                { tab: 'image', label: '🖼️ 이미지 갤러리' },
                { tab: 'local', label: '📍 맛집·지역 지도' },
                { tab: 'encyc', label: '📚 백과·지식 더보기' },
                { tab: 'wikiNews', label: '🗞️ 위키·뉴스 더보기' }
            ];
            jumps.forEach((j) => {
                const btn = makeEl('button', 'jg-blended-jump-btn', j.label);
                btn.type = 'button';
                btn.addEventListener('click', () => nav.onSwitchTab(j.tab, 1));
                jumpBar.appendChild(btn);
            });
            sec.appendChild(jumpBar);
        }

        externalMount.appendChild(sec);
        return totalShown + blendedItems.length + (imageItems.length > 0 ? 1 : 0);
    }

    global.JGSearchBlendedView = {
        renderUnifiedAll
    };
})(window);
