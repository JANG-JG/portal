/**
 * 🎨 JG 통합 스마트 검색 - 즉답 카드 및 내부 결과 렌더러 모듈 (search-renderers.js)
 * - XSS 방지를 위해 모든 텍스트는 textContent로 안전하게 바인딩
 */
(function (global) {
    'use strict';

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

    function renderSmartWidget(mount, widget, nav = {}) {
        if (!mount) return;
        mount.replaceChildren();
        if (!widget || !widget.data) return;

        if (widget.type === 'regionComposite' && global.JGSearchRegionCard) {
            global.JGSearchRegionCard.renderComposite(mount, widget.data, nav);
            return;
        }
        if (widget.type === 'map' && global.JGSearchMapWidget) {
            global.JGSearchMapWidget.render(mount, widget.data, nav);
            return;
        }

        const card = makeEl('div', 'jg-smart-card');
        if (widget.type === 'weather') {
            const w = widget.data;
            card.style.containerType = 'inline-size';
            card.appendChild(makeEl('span', 'jg-smart-badge', w.isGlobal ? '🌍 해외 날씨 · 주간예보' : '🌤️ 실시간 날씨 · 7일 주간예보'));

            const main = makeEl('div', 'jg-weather-main');
            const left = makeEl('div', 'jg-weather-left');
            left.appendChild(makeEl('span', 'jg-weather-big-icon', w.icon || '🌤️'));
            const txt = makeEl('div');
            txt.append(makeEl('div', 'jg-weather-city', `${w.city || '서울'} · ${w.condition || ''}`), makeEl('div', 'jg-weather-temp', w.temp || '-'));
            left.appendChild(txt);

            const meta = makeEl('div', 'jg-weather-meta');
            if (w.feels_like) meta.appendChild(makeEl('span', '', `체감 ${w.feels_like}`));
            if (w.humidity) meta.appendChild(makeEl('span', '', `습도 ${w.humidity}`));
            if (w.wind_speed) meta.appendChild(makeEl('span', '', `바람 ${w.wind_speed}`));
            if (w.pm10_grade) meta.appendChild(makeEl('span', '', `미세먼지 ${w.pm10_grade}`));
            if (w.pm25_grade) meta.appendChild(makeEl('span', '', `초미세 ${w.pm25_grade}`));
            main.append(left, meta);
            card.appendChild(main);

            if (Array.isArray(w.forecast) && w.forecast.length > 0) {
                const strip = global.JGSearchRegionCard
                    ? global.JGSearchRegionCard.renderForecastStrip(w.forecast)
                    : null;
                if (strip) {
                    strip.style.marginTop = '0.85rem';
                    card.appendChild(strip);
                }
            }
        } else if (widget.type === 'exchange') {
            const ex = widget.data;
            card.appendChild(makeEl('span', 'jg-smart-badge', '💱 실시간 환율 계산'));
            card.appendChild(makeEl('div', 'jg-muted-text', `${ex.label} · ${ex.amount.toLocaleString()} ${ex.currency} =`));
            card.appendChild(makeEl('div', 'jg-calc-value', `${ex.convertedKrw.toLocaleString()} 원`));
            card.appendChild(makeEl('div', 'jg-muted-text', `기준 환율: ${ex.unitDivisor}${ex.currency}당 ${ex.ratePerUnit.toLocaleString()}원`));
        } else if (widget.type === 'market') {
            const mk = widget.data;
            card.appendChild(makeEl('span', 'jg-smart-badge', '📈 실시간 증시·환율'));
            if (mk.usdKrw) {
                card.appendChild(makeEl('div', 'jg-muted-text', `원/달러 환율: ${Number(mk.usdKrw).toLocaleString()}원`));
            }
            const grid = makeEl('div', 'jg-market-grid');
            (mk.indices || []).forEach((idx) => {
                const tile = makeEl('div', 'jg-market-tile');
                const price = idx.price !== undefined ? Number(idx.price).toLocaleString() : '-';
                const pct = idx.changePercent !== undefined ? `${idx.changePercent > 0 ? '+' : ''}${idx.changePercent}%` : '';
                tile.append(makeEl('div', 'jg-shortcut-title', idx.name || idx.symbol), makeEl('div', '', `${price} (${pct})`));
                grid.appendChild(tile);
            });
            card.appendChild(grid);
        } else if (widget.type === 'calculator') {
            card.appendChild(makeEl('span', 'jg-smart-badge', '🧮 스마트 계산기'));
            card.appendChild(makeEl('div', 'jg-muted-text', `${widget.data.expression} =`));
            card.appendChild(makeEl('div', 'jg-calc-value', Number(widget.data.result).toLocaleString()));
        } else if (widget.type === 'unit') {
            card.appendChild(makeEl('span', 'jg-smart-badge', `📐 ${widget.data.category}`));
            card.appendChild(makeEl('div', 'jg-muted-text', `${widget.data.from} =`));
            card.appendChild(makeEl('div', 'jg-calc-value', widget.data.to));
        }

        mount.appendChild(card);
    }

    function getHelpers() {
        return global.JGSearchCardHelpers;
    }

    function appendSection(mount, opts, items, renderer) {
        if (!Array.isArray(items) || items.length === 0) return 0;
        const H = getHelpers();
        const sec = H.createSectionShell({
            icon: opts.icon,
            title: opts.title,
            countLabel: opts.countLabel || `${items.length}건`,
            moreTab: opts.moreTab,
            moreChipText: opts.moreChipText,
            onSwitchTab: opts.onSwitchTab
        });
        renderer(sec, items);
        if (opts.footerMoreLabel && opts.moreTab) {
            H.appendMoreFooterButton(sec, opts.footerMoreLabel, opts.moreTab, opts.onSwitchTab);
        }
        if (opts.paginationMeta && opts.onPageChange) {
            H.appendPagination(sec, opts.paginationMeta, opts.onPageChange);
        }
        mount.appendChild(sec);
        return items.length;
    }

    function renderListItems(sec, items, query, mapFn) {
        const H = getHelpers();
        const list = makeEl('div', 'jg-result-list');
        items.forEach((item) => {
            const info = mapFn(item);
            list.appendChild(H.createEditorialItem(info, query));
        });
        sec.appendChild(list);
    }

    function renderInternalSections(mount, r, tab, query = '', nav = {}) {
        if (!mount) return 0;
        mount.replaceChildren();
        let shownCount = 0;
        const onSwitchTab = nav.onSwitchTab;

        if (tab === 'all') {
            shownCount += appendSection(mount, { icon: '⚡', title: '서비스 바로가기' }, r.shortcuts, (sec, items) => {
                renderListItems(sec, items, query, (s) => ({
                    title: s.title,
                    desc: s.desc,
                    url: s.url,
                    source: '포털 바로가기',
                    badgeIcon: s.icon || '⚡'
                }));
            });
        }
        if (tab === 'all' || tab === 'internal' || tab === 'memoCalendar') {
            shownCount += appendSection(
                mount,
                { icon: '📝', title: '내 메모', moreTab: tab === 'all' ? 'memoCalendar' : null, moreChipText: '메모·일정 ›', onSwitchTab },
                r.memos,
                (sec, items) => {
                    renderListItems(sec, items, query, (m) => ({
                        title: m.title,
                        desc: (m.content || '').slice(0, 160),
                        source: '포털 메모',
                        badgeIcon: '📝',
                        date: (m.updated_at || '').slice(0, 10),
                        tag: m.category || '메모',
                        url: m.url
                    }));
                }
            );
            shownCount += appendSection(
                mount,
                { icon: '📅', title: '스마트 캘린더 일정', moreTab: tab === 'all' ? 'memoCalendar' : null, moreChipText: '메모·일정 ›', onSwitchTab },
                r.calendar,
                (sec, items) => {
                    renderListItems(sec, items, query, (c) => ({
                        title: c.title,
                        desc: c.memo,
                        source: '스마트 캘린더',
                        badgeIcon: '📅',
                        date: `${c.event_date || ''} ${c.event_time || ''}`.trim(),
                        tag: c.is_family ? '가족 일정' : '개인 일정',
                        url: c.url
                    }));
                }
            );
        }
        if (tab === 'all' || tab === 'internal' || tab === 'wikiNews') {
            shownCount += appendSection(
                mount,
                { icon: '📖', title: '가족 위키', moreTab: tab === 'all' ? 'wikiNews' : null, moreChipText: '위키·뉴스 ›', onSwitchTab },
                r.wiki,
                (sec, items) => {
                    renderListItems(sec, items, query, (w) => ({
                        title: w.title,
                        desc: w.excerpt,
                        source: '가족 위키',
                        badgeIcon: '📖',
                        tag: w.category || '',
                        url: w.url
                    }));
                }
            );
            shownCount += appendSection(
                mount,
                { icon: '📰', title: '뉴스룸 브리핑', moreTab: tab === 'all' ? 'wikiNews' : null, moreChipText: '위키·뉴스 ›', onSwitchTab },
                r.news,
                (sec, items) => {
                    renderListItems(sec, items, query, (n) => ({
                        title: n.title,
                        desc: (n.summary || '').slice(0, 160),
                        source: n.media_name || 'JG 뉴스룸',
                        badgeIcon: '📰',
                        date: n.date || '',
                        tag: n.category_name || '',
                        url: n.link || '/go/news',
                        external: Boolean(n.link)
                    }));
                }
            );
            shownCount += appendSection(
                mount,
                { icon: '🤖', title: '웹봇 수집 아카이브', moreTab: tab === 'all' ? 'wikiNews' : null, moreChipText: '위키·뉴스 ›', onSwitchTab },
                r.botDocs,
                (sec, items) => {
                    renderListItems(sec, items, query, (d) => ({
                        title: d.title,
                        desc: (d.snippet || '').slice(0, 180),
                        source: d.site_name || '웹봇 수집',
                        badgeIcon: '🤖',
                        date: (d.published_at || '').slice(0, 16),
                        thumbnail: d.og_image || null,
                        url: d.url,
                        external: true
                    }));
                }
            );
        }
        if (tab === 'all' || tab === 'internal') {
            shownCount += appendSection(
                mount,
                { icon: '📌', title: '내 서버 보관함 (영구 스크랩)', moreTab: tab === 'all' ? 'internal' : null, moreChipText: '우리 사이트 ›', onSwitchTab },
                r.savedClips,
                (sec, items) => {
                    renderListItems(sec, items, query, (c) => ({
                        title: c.title,
                        desc: (c.snippet || '').slice(0, 180),
                        source: c.site_name || '내 보관함',
                        badgeIcon: '📌',
                        tag: '보관됨',
                        thumbnail: c.thumbnail_url || null,
                        url: c.url,
                        external: true
                    }));
                }
            );
        }
        if (tab === 'all' || tab === 'internal' || tab === 'album') {
            shownCount += appendSection(
                mount,
                { icon: '📸', title: '가족 앨범', moreTab: tab === 'all' ? 'album' : null, moreChipText: '앨범 더보기 ›', onSwitchTab },
                r.album,
                (sec, items) => {
                    const grid = makeEl('div', 'jg-album-grid');
                    items.forEach((ph) => {
                        const card = makeEl('a', 'jg-album-card');
                        card.href = safeHref(ph.url);
                        const wrap = makeEl('div', 'jg-album-thumb-wrap');
                        if (ph.thumbUrl) {
                            const img = makeEl('img', 'jg-album-thumb');
                            img.src = ph.thumbUrl;
                            img.alt = ph.caption || '가족 사진';
                            img.loading = 'lazy';
                            wrap.appendChild(img);
                        }
                        const info = makeEl('div', 'jg-album-info');
                        info.append(
                            makeEl('div', 'jg-album-caption', ph.caption),
                            makeEl('div', 'jg-album-date', `${ph.taken_at || ''} ${ph.location ? '· ' + ph.location : ''}`)
                        );
                        card.append(wrap, info);
                        grid.appendChild(card);
                    });
                    sec.appendChild(grid);
                }
            );
        }
        if (tab === 'all' || tab === 'internal' || tab === 'healthAsset') {
            shownCount += appendSection(mount, { icon: '🏥', title: '병원 진료 일정' }, r.hospitals, (sec, items) => {
                renderListItems(sec, items, query, (h) => ({
                    title: `${h.hospital_name} (${h.department || '진료'})`,
                    desc: h.memo,
                    source: '혈압·건강 관리',
                    badgeIcon: '🏥',
                    date: `방문 ${h.visit_date || '-'}`,
                    tag: h.next_visit_date ? `예약 ${h.next_visit_date}` : '',
                    url: 'https://blood.j-jg.cc/dashboard.html#hospital'
                }));
            });
            shownCount += appendSection(mount, { icon: '💊', title: '처방약 · 복약 관리' }, r.medications, (sec, items) => {
                renderListItems(sec, items, query, (m) => ({
                    title: `${m.med_name} (${m.target_label})`,
                    desc: m.dosage_note,
                    source: '약 챙겨먹기',
                    badgeIcon: '💊',
                    tag: m.remain_count !== null ? `남은 수량 ${m.remain_count}` : '',
                    url: m.url
                }));
            });
            shownCount += appendSection(mount, { icon: '💰', title: '보유 자산' }, r.assets, (sec, items) => {
                renderListItems(sec, items, query, (a) => ({
                    title: `${a.full_name || a.symbol} (${a.symbol})`,
                    desc: `${a.asset_type || ''} · 수량 ${a.quantity}`,
                    source: '자산 관리',
                    badgeIcon: '💰',
                    tag: `평균 ${Number(a.avg_price || 0).toLocaleString()} ${a.currency || ''}`,
                    url: 'https://asset.j-jg.cc'
                }));
            });
            shownCount += appendSection(mount, { icon: '🎒', title: '어린이집 사진 수집' }, r.kindergarten, (sec, items) => {
                renderListItems(sec, items, query, (k) => ({
                    title: k.title,
                    desc: k.status,
                    source: '어린이집 알림',
                    badgeIcon: '🎒',
                    date: k.lastRun || '',
                    url: k.url
                }));
            });
        }

        return shownCount;
    }

    function renderExternalSections(mount, external, rawTab, query = '', nav = {}) {
        if (global.JGSearchExternalRenderers && typeof global.JGSearchExternalRenderers.renderExternalSections === 'function') {
            return global.JGSearchExternalRenderers.renderExternalSections(mount, external, rawTab, query, nav);
        }
        return 0;
    }

    /**
     * AI 요약 텍스트 안전 렌더링 (**굵게** 및 줄바꿈만 DOM 노드로 안전 변환)
     */
    function renderAiSummaryText(container, rawText) {
        if (!container) return;
        container.replaceChildren();
        const lines = String(rawText || '').split('\n');
        lines.forEach((line, lineIdx) => {
            if (lineIdx > 0) container.appendChild(document.createElement('br'));
            const parts = line.split(/(\*\*[^*]+\*\*)/g);
            parts.forEach((part) => {
                if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                    const strong = document.createElement('strong');
                    strong.textContent = part.slice(2, -2);
                    container.appendChild(strong);
                } else if (part) {
                    container.appendChild(document.createTextNode(part));
                }
            });
        });
    }

    global.JGSearchRenderers = {
        safeHref,
        appendSection,
        renderListItems,
        renderSmartWidget,
        renderInternalSections,
        renderExternalSections,
        renderAiSummaryText
    };
})(window);
