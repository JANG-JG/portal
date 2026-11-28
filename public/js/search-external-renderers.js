/**
 * 🌐 JG 통합 스마트 검색 - 외부 검색 결과 렌더러 모듈 (search-external-renderers.js)
 * - 위키백과, 나무위키, 웹문서(상위 5건 + 탭 15건 페이지네이션), 블로그, 뉴스, 지역, 구글 렌더링
 */
(function (global) {
    'use strict';

    const makeEl = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    };

    function renderExternalSections(mount, external, rawTab, query = '', nav = {}) {
        if (!mount) return 0;
        mount.replaceChildren();
        const tab = rawTab === 'webBlog' ? 'web' : rawTab;
        if (!external || ['internal', 'memoCalendar', 'album', 'healthAsset'].includes(tab)) return 0;

        const H = global.JGSearchCardHelpers;
        const R = global.JGSearchRenderers;
        if (!H || !R) return 0;

        const onSwitchTab = nav.onSwitchTab;
        const onPageChange = nav.onPageChange;
        const page = Number(external.page) || 1;
        let shownCount = 0;
        const nv = external.naver || {};
        const nvMeta = nv.meta || {};
        const gg = external.google || {};

        // 1) 위키백과 지식 카드 (1페이지에서 우선 노출)
        if ((tab === 'all' || tab === 'encyc') && page === 1 && external.wikipedia) {
            const wk = external.wikipedia;
            const sec = H.createSectionShell({
                icon: '📚',
                title: '위키백과 지식 백과',
                countLabel: wk.lang === 'en' ? 'EN' : 'KO',
                moreTab: tab === 'all' ? 'encyc' : null,
                moreChipText: '백과·지식 ›',
                onSwitchTab
            });
            sec.appendChild(
                H.createEditorialItem(
                    {
                        title: wk.title,
                        desc: wk.extract,
                        url: wk.url,
                        source: '위키백과',
                        tag: wk.description || '',
                        thumbnail: wk.thumbnail || null,
                        external: true,
                        extraClass: 'jg-wiki-card'
                    },
                    query
                )
            );
            mount.appendChild(sec);
            shownCount += 1;
        }

        // 1.5) 나무위키 섹션
        if ((tab === 'all' || tab === 'encyc') && page === 1 && (query || (nv.web && nv.web.length) || (gg.items && gg.items.length))) {
            const namuPool = [...(nv.web || []), ...(gg.items || [])].filter(
                (it) => it && typeof it.link === 'string' && it.link.includes('namu.wiki')
            );
            const seenNamu = new Set();
            const namuItems = [];
            for (const it of namuPool) {
                if (!seenNamu.has(it.link)) {
                    seenNamu.add(it.link);
                    namuItems.push(it);
                    if (namuItems.length >= 3) break;
                }
            }
            if (namuItems.length > 0 || query) {
                const sec = H.createSectionShell({ icon: '🌳', title: '나무위키', countLabel: namuItems.length ? `${namuItems.length}건` : '바로가기' });
                sec.classList.add('jg-namu-card');
                if (namuItems.length > 0) {
                    R.renderListItems(sec, namuItems, query, (it) => ({
                        title: it.title,
                        desc: it.description,
                        source: '나무위키',
                        url: it.link,
                        external: true
                    }));
                }
                if (query) {
                    const direct = makeEl('a', 'jg-namu-direct-link');
                    direct.href = H.safeHref(`https://namu.wiki/w/${encodeURIComponent(query)}`);
                    direct.target = '_blank';
                    direct.rel = 'noopener noreferrer';
                    direct.textContent = `🌳 나무위키에서 '${query}' 문서 바로 열기 ↗`;
                    sec.appendChild(direct);
                }
                mount.appendChild(sec);
                shownCount += 1;
            }
        }

        // 2) 네이버 지식백과
        if (tab === 'all' || tab === 'encyc') {
            const meta = nvMeta.encyc || {};
            const items = tab === 'all' ? (nv.encyc || []).slice(0, 3) : (nv.encyc || []);
            const countLabel = tab === 'encyc'
                ? `${H.formatTotalCount(meta.total, items.length)} · ${meta.page || 1}페이지`
                : `상위 ${items.length}건`;
            shownCount += R.appendSection(
                mount,
                {
                    icon: '📘',
                    title: '지식백과',
                    countLabel,
                    moreTab: tab === 'all' && (meta.total > items.length) ? 'encyc' : null,
                    moreChipText: '백과 더보기 ›',
                    footerMoreLabel: tab === 'all' && (meta.total > items.length) ? '📘 지식백과 검색 결과 더보기 ›' : null,
                    paginationMeta: tab === 'encyc' ? meta : null,
                    onSwitchTab,
                    onPageChange
                },
                items,
                (sec, rows) => {
                    R.renderListItems(sec, rows, query, (it) => ({
                        title: it.title,
                        desc: it.description,
                        source: '네이버 지식백과',
                        url: it.link,
                        external: true
                    }));
                }
            );
        }

        // 3) 웹문서 (통합검색: 상위 5건 고정 + '웹문서 더보기' / 웹문서 탭: 15건씩 번호형 페이지네이션)
        if (tab === 'all' || tab === 'web') {
            const meta = nvMeta.web || {};
            const webItems = tab === 'all' ? (nv.web || []).slice(0, 5) : (nv.web || []);
            const totalTxt = H.formatTotalCount(meta.total, webItems.length);
            const countLabel = tab === 'web'
                ? `${totalTxt || `${webItems.length}건`} · ${meta.page || 1}페이지`
                : (totalTxt ? `상위 ${webItems.length}건 · ${totalTxt}` : `상위 ${webItems.length}건`);
            const canMoreWeb = tab === 'all' && (meta.hasMore || (meta.total || 0) > webItems.length);

            shownCount += R.appendSection(
                mount,
                {
                    icon: '🌐',
                    title: '웹문서',
                    countLabel,
                    moreTab: canMoreWeb ? 'web' : null,
                    moreChipText: '웹문서 탭 ›',
                    footerMoreLabel: canMoreWeb ? '🌐 웹문서 검색 결과 더보기 (페이지 넘겨보기) ›' : null,
                    paginationMeta: tab === 'web' ? meta : null,
                    onSwitchTab,
                    onPageChange
                },
                webItems,
                (sec, rows) => {
                    R.renderListItems(sec, rows, query, (it) => ({
                        title: it.title,
                        desc: it.description,
                        source: it.siteName || '',
                        date: it.date || '',
                        thumbnail: it.thumbnail || null,
                        url: it.link,
                        external: true
                    }));
                }
            );
        }

        // 4) 블로그 · 후기
        if (tab === 'all' || tab === 'blog') {
            const meta = nvMeta.blog || {};
            const blogItems = tab === 'all' ? (nv.blog || []).slice(0, 5) : (nv.blog || []);
            const totalTxt = H.formatTotalCount(meta.total, blogItems.length);
            const canMoreBlog = tab === 'all' && (meta.hasMore || (meta.total || 0) > blogItems.length);

            if (blogItems.length > 0) {
                shownCount += R.appendSection(
                    mount,
                    {
                        icon: '✍️',
                        title: '블로그 · 카페 후기',
                        countLabel: tab === 'blog' ? `${totalTxt} · ${meta.page || 1}페이지` : `상위 ${blogItems.length}건`,
                        moreTab: canMoreBlog ? 'blog' : null,
                        moreChipText: '블로그 탭 ›',
                        footerMoreLabel: canMoreBlog ? '✍️ 블로그 · 카페 검색 결과 더보기 ›' : null,
                        paginationMeta: tab === 'blog' ? meta : null,
                        onSwitchTab,
                        onPageChange
                    },
                    blogItems,
                    (sec, rows) => {
                        R.renderListItems(sec, rows, query, (it) => ({
                            title: it.title,
                            desc: it.description,
                            source: it.bloggername || it.cafename || it.source || '블로그',
                            tag: it.provider === 'daum_cafe' ? '카페' : '',
                            date: it.date || it.postdate || '',
                            thumbnail: it.thumbnail || null,
                            url: it.link,
                            external: true
                        }));
                    }
                );
            } else if (tab === 'blog') {
                const sec = H.createSectionShell({ icon: '✍️', title: '블로그 · 후기', countLabel: '안내' });
                sec.appendChild(makeEl('p', 'jg-muted-text', '블로그 전용 세부 API 이용신청 전이거나 일치하는 글이 없습니다. NCP 콘솔에서 블로그(blog) API를 켜시면 전용 페이지 탐색이 활성화됩니다.'));
                H.appendMoreFooterButton(sec, '🌐 웹문서 탭에서 블로그·웹 결과 함께 보기 ›', 'web', onSwitchTab);
                mount.appendChild(sec);
                shownCount += 1;
            }
        }

        // 5) 외부 실시간 뉴스
        if (tab === 'all' || tab === 'wikiNews') {
            const meta = nvMeta.news || {};
            const newsItems = tab === 'all' ? (nv.news || []).slice(0, 5) : (nv.news || []);
            const canMoreNews = tab === 'all' && (meta.hasMore || (meta.total || 0) > newsItems.length);
            shownCount += R.appendSection(
                mount,
                {
                    icon: '🗞️',
                    title: '실시간 외부 뉴스',
                    countLabel: tab === 'wikiNews' ? `${H.formatTotalCount(meta.total, newsItems.length)} · ${meta.page || 1}페이지` : `상위 ${newsItems.length}건`,
                    moreTab: canMoreNews ? 'wikiNews' : null,
                    moreChipText: '뉴스 더보기 ›',
                    footerMoreLabel: canMoreNews ? '🗞️ 실시간 뉴스 결과 더보기 ›' : null,
                    paginationMeta: tab === 'wikiNews' ? meta : null,
                    onSwitchTab,
                    onPageChange
                },
                newsItems,
                (sec, rows) => {
                    R.renderListItems(sec, rows, query, (it) => ({
                        title: it.title,
                        desc: it.description,
                        date: it.date || '',
                        url: it.link,
                        external: true
                    }));
                }
            );
        }

        // 6) 네이버 지역/맛집
        if (tab === 'all' || tab === 'local') {
            const meta = nvMeta.local || {};
            const localItems = tab === 'all' ? (nv.local || []).slice(0, 4) : (nv.local || []);
            const canMoreLocal = tab === 'all' && (meta.hasMore || (meta.total || 0) > localItems.length);
            shownCount += R.appendSection(
                mount,
                {
                    icon: '📍',
                    title: '지역 · 맛집 정보',
                    countLabel: tab === 'local' ? `${H.formatTotalCount(meta.total, localItems.length)} · ${meta.page || 1}페이지` : `상위 ${localItems.length}건`,
                    moreTab: canMoreLocal ? 'local' : null,
                    moreChipText: '지역 탭 ›',
                    footerMoreLabel: canMoreLocal ? '📍 지역·맛집 검색 결과 더보기 ›' : null,
                    paginationMeta: tab === 'local' ? meta : null,
                    onSwitchTab,
                    onPageChange
                },
                localItems,
                (sec, rows) => {
                    R.renderListItems(sec, rows, query, (it) => ({
                        title: it.title,
                        desc: it.address || it.description,
                        source: it.source || '장소 정보',
                        tag: it.telephone || '',
                        url: it.link || `https://map.naver.com/p/search/${encodeURIComponent(it.title)}`,
                        external: true
                    }));
                }
            );
        }

        // 7) 추가 활성화된 세부 API
        if (Array.isArray(nv.extras)) {
            nv.extras.forEach((ex) => {
                if (!ex || !Array.isArray(ex.items) || ex.items.length === 0) return;
                if (tab === 'all' || tab === ex.tab) {
                    shownCount += R.appendSection(
                        mount,
                        {
                            icon: '🔎',
                            title: `${ex.label || ex.code}`,
                            paginationMeta: tab !== 'all' ? ex.meta : null,
                            onPageChange
                        },
                        ex.items,
                        (sec, rows) => {
                            R.renderListItems(sec, rows, query, (it) => ({
                                title: it.title,
                                desc: it.description,
                                source: it.source || ex.label,
                                date: it.date || '',
                                url: it.link,
                                external: true
                            }));
                        }
                    );
                }
            });
        }

        // 8) 구글 웹 검색
        if ((tab === 'all' || tab === 'google') && Array.isArray(gg.items) && gg.items.length > 0) {
            shownCount += R.appendSection(
                mount,
                {
                    icon: '🔎',
                    title: '구글 웹 검색',
                    countLabel: tab === 'google' && gg.meta ? `${H.formatTotalCount(gg.meta.total, gg.items.length)} · ${gg.meta.page || 1}페이지` : `${gg.items.length}건`,
                    moreTab: tab === 'all' ? 'google' : null,
                    moreChipText: '구글 탭 ›',
                    paginationMeta: tab === 'google' ? gg.meta : null,
                    onSwitchTab,
                    onPageChange
                },
                gg.items,
                (sec, rows) => {
                    R.renderListItems(sec, rows, query, (it) => ({
                        title: it.title,
                        desc: it.description,
                        url: it.link,
                        external: true
                    }));
                }
            );
        } else if (tab === 'google' && gg.blockedReason) {
            const sec = H.createSectionShell({ icon: '🔎', title: '구글 웹 검색', countLabel: '보호 모드' });
            const msg = gg.blockedReason === 'daily_quota_guard'
                ? '오늘의 구글 무료 검색 안전 한도(90건)에 도달해 자동 보호 중입니다. 웹문서 탭이나 내일 다시 이용해 주세요.'
                : '구글 검색 API 키가 아직 설정되지 않았거나 관리자 설정에서 꺼져 있습니다.';
            sec.appendChild(makeEl('p', 'jg-muted-text', msg));
            mount.appendChild(sec);
            shownCount += 1;
        }

        return shownCount;
    }

    global.JGSearchExternalRenderers = {
        renderExternalSections
    };
})(window);
