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

    function renderSmartWidget(mount, widget) {
        if (!mount) return;
        mount.replaceChildren();
        if (!widget || !widget.data) return;

        const card = makeEl('div', 'jg-smart-card');
        if (widget.type === 'weather') {
            const w = widget.data;
            card.appendChild(makeEl('span', 'jg-smart-badge', w.isGlobal ? '🌍 해외 날씨 즉답' : '🌤️ 실시간 날씨 즉답'));

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
                const row = makeEl('div', 'jg-forecast-row');
                w.forecast.forEach((f) => {
                    const item = makeEl('div', 'jg-forecast-item');
                    item.append(
                        makeEl('div', '', `${f.label} ${f.icon || ''}`),
                        makeEl('div', '', `${f.min} / ${f.max}`),
                        makeEl('div', 'jg-muted-text', `${f.condition} · 강수 ${f.rain}`)
                    );
                    row.appendChild(item);
                });
                card.appendChild(row);
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

    function appendSection(mount, icon, title, items, renderer) {
        if (!Array.isArray(items) || items.length === 0) return 0;
        const sec = makeEl('section', 'jg-section-card');
        sec.appendChild(makeEl('h3', 'jg-section-title', `${icon} ${title} (${items.length})`));
        renderer(sec, items);
        mount.appendChild(sec);
        return items.length;
    }

    function renderListItems(sec, items, mapFn) {
        const list = makeEl('div', 'jg-result-list');
        items.forEach((item) => {
            const info = mapFn(item);
            const a = makeEl('a', 'jg-result-item');
            a.href = safeHref(info.url);
            if (info.external) {
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
            }
            a.appendChild(makeEl('div', 'jg-result-title', info.title));
            if (info.desc) a.appendChild(makeEl('div', 'jg-result-desc', info.desc));
            if (info.meta) a.appendChild(makeEl('div', 'jg-result-meta', info.meta));
            list.appendChild(a);
        });
        sec.appendChild(list);
    }

    function renderInternalSections(mount, r, tab) {
        if (!mount) return 0;
        mount.replaceChildren();
        let shownCount = 0;

        if (tab === 'all') {
            shownCount += appendSection(mount, '⚡', '서비스 바로가기', r.shortcuts, (sec, items) => {
                renderListItems(sec, items, (s) => ({ title: `${s.icon} ${s.title}`, desc: s.desc, url: s.url }));
            });
        }
        if (tab === 'all' || tab === 'internal' || tab === 'memoCalendar') {
            shownCount += appendSection(mount, '📝', '내 메모', r.memos, (sec, items) => {
                renderListItems(sec, items, (m) => ({
                    title: m.title,
                    desc: (m.content || '').slice(0, 140),
                    meta: `${m.category} · ${(m.updated_at || '').slice(0, 10)}`,
                    url: m.url
                }));
            });
            shownCount += appendSection(mount, '📅', '스마트 캘린더 일정', r.calendar, (sec, items) => {
                renderListItems(sec, items, (c) => ({
                    title: c.title,
                    desc: c.memo,
                    meta: `${c.is_family ? '가족' : '개인'} · ${c.event_date} ${c.event_time}`,
                    url: c.url
                }));
            });
        }
        if (tab === 'all' || tab === 'internal' || tab === 'wikiNews') {
            shownCount += appendSection(mount, '📖', '가족 위키', r.wiki, (sec, items) => {
                renderListItems(sec, items, (w) => ({ title: w.title, desc: w.excerpt, meta: w.category, url: w.url }));
            });
            shownCount += appendSection(mount, '📰', '뉴스룸 브리핑', r.news, (sec, items) => {
                renderListItems(sec, items, (n) => ({
                    title: n.title,
                    desc: (n.summary || '').slice(0, 140),
                    meta: `${n.media_name || '뉴스'} · ${n.date || ''}`,
                    url: n.link || '/go/news',
                    external: Boolean(n.link)
                }));
            });
        }
        if (tab === 'all' || tab === 'internal' || tab === 'album') {
            shownCount += appendSection(mount, '📸', '가족 앨범', r.album, (sec, items) => {
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
            });
        }
        if (tab === 'all' || tab === 'internal' || tab === 'healthAsset') {
            shownCount += appendSection(mount, '🏥', '병원 진료 일정', r.hospitals, (sec, items) => {
                renderListItems(sec, items, (h) => ({
                    title: `${h.hospital_name} (${h.department || '진료'})`,
                    desc: h.memo,
                    meta: `방문 ${h.visit_date || '-'}${h.next_visit_date ? ' · 다음 예약 ' + h.next_visit_date : ''}`,
                    url: 'https://blood.j-jg.cc/dashboard.html#hospital'
                }));
            });
            shownCount += appendSection(mount, '💊', '처방약 · 복약 관리', r.medications, (sec, items) => {
                renderListItems(sec, items, (m) => ({
                    title: `${m.med_name} (${m.target_label})`,
                    desc: m.dosage_note,
                    meta: m.remain_count !== null ? `남은 수량: ${m.remain_count}` : '',
                    url: m.url
                }));
            });
            shownCount += appendSection(mount, '💰', '보유 자산', r.assets, (sec, items) => {
                renderListItems(sec, items, (a) => ({
                    title: `${a.full_name || a.symbol} (${a.symbol})`,
                    desc: `${a.asset_type || ''} · 수량 ${a.quantity}`,
                    meta: `평균단가 ${Number(a.avg_price || 0).toLocaleString()} ${a.currency || ''}`,
                    url: 'https://asset.j-jg.cc'
                }));
            });
            shownCount += appendSection(mount, '🎒', '어린이집 사진 수집', r.kindergarten, (sec, items) => {
                renderListItems(sec, items, (k) => ({ title: k.title, desc: k.status, meta: k.lastRun, url: k.url }));
            });
        }

        return shownCount;
    }

    function renderExternalSections(mount, external, tab) {
        if (!mount) return 0;
        mount.replaceChildren();
        if (!external || ['internal', 'memoCalendar', 'album', 'healthAsset'].includes(tab)) return 0;

        let shownCount = 0;
        const nv = external.naver || {};

        // 1) 위키백과 지식 카드
        if ((tab === 'all' || tab === 'encyc') && external.wikipedia) {
            const wk = external.wikipedia;
            const sec = makeEl('section', 'jg-section-card');
            sec.appendChild(makeEl('h3', 'jg-section-title', `📚 위키백과 지식 백과 (${wk.lang === 'en' ? 'EN' : 'KO'})`));
            const a = makeEl('a', 'jg-result-item jg-wiki-card');
            a.href = safeHref(wk.url);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            if (wk.thumbnail) {
                const wrap = makeEl('div', 'jg-wiki-thumb-wrap');
                const img = makeEl('img', 'jg-wiki-thumb');
                img.src = safeHref(wk.thumbnail);
                img.alt = wk.title;
                img.loading = 'lazy';
                wrap.appendChild(img);
                a.appendChild(wrap);
            }
            const body = makeEl('div');
            body.appendChild(makeEl('div', 'jg-result-title', wk.title));
            if (wk.description) body.appendChild(makeEl('div', 'jg-result-meta', wk.description));
            body.appendChild(makeEl('div', 'jg-result-desc', wk.extract));
            a.appendChild(body);
            sec.appendChild(a);
            mount.appendChild(sec);
            shownCount += 1;
        }

        // 2) 네이버 백과사전
        if (tab === 'all' || tab === 'encyc') {
            shownCount += appendSection(mount, '📘', '네이버 지식백과', nv.encyc, (sec, items) => {
                renderListItems(sec, items, (it) => ({ title: it.title, desc: it.description, url: it.link, external: true }));
            });
        }

        // 3) 네이버 웹·블로그
        if (tab === 'all' || tab === 'webBlog') {
            shownCount += appendSection(mount, '🌐', '웹 검색 결과 (네이버)', nv.web, (sec, items) => {
                renderListItems(sec, items, (it) => ({ title: it.title, desc: it.description, url: it.link, external: true }));
            });
            shownCount += appendSection(mount, '✍️', '블로그 · 후기 (네이버)', nv.blog, (sec, items) => {
                renderListItems(sec, items, (it) => ({
                    title: it.title,
                    desc: it.description,
                    meta: `${it.source || '블로그'}${it.date ? ' · ' + it.date : ''}`,
                    url: it.link,
                    external: true
                }));
            });
        }

        // 4) 네이버 뉴스
        if (tab === 'all' || tab === 'wikiNews') {
            shownCount += appendSection(mount, '🗞️', '외부 실시간 뉴스 (네이버)', nv.news, (sec, items) => {
                renderListItems(sec, items, (it) => ({ title: it.title, desc: it.description, url: it.link, external: true }));
            });
        }

        // 5) 네이버 지역/맛집
        if (tab === 'all' || tab === 'local') {
            shownCount += appendSection(mount, '📍', '지역 · 맛집 정보', nv.local, (sec, items) => {
                renderListItems(sec, items, (it) => ({
                    title: it.title,
                    desc: it.address || it.description,
                    meta: [it.source, it.telephone].filter(Boolean).join(' · '),
                    url: it.link || `https://map.naver.com/p/search/${encodeURIComponent(it.title)}`,
                    external: true
                }));
            });
        }

        // 6) 구글 웹 검색
        const gg = external.google || {};
        if ((tab === 'all' || tab === 'google') && Array.isArray(gg.items) && gg.items.length > 0) {
            shownCount += appendSection(mount, '🔎', '구글 웹 검색', gg.items, (sec, items) => {
                renderListItems(sec, items, (it) => ({
                    title: it.title,
                    desc: it.description,
                    meta: it.displayLink || '',
                    url: it.link,
                    external: true
                }));
            });
        } else if (tab === 'google' && gg.blockedReason) {
            const sec = makeEl('section', 'jg-section-card');
            sec.appendChild(makeEl('h3', 'jg-section-title', '🔎 구글 웹 검색'));
            const msg = gg.blockedReason === 'daily_quota_guard'
                ? '오늘의 구글 무료 검색 안전 한도(90건)에 도달해 자동 보호 중입니다. 네이버 웹 검색이나 내일 다시 이용해 주세요.'
                : '구글 검색 API 키가 아직 설정되지 않았거나 관리자 설정에서 꺼져 있습니다.';
            sec.appendChild(makeEl('p', 'jg-muted-text', msg));
            mount.appendChild(sec);
            shownCount += 1;
        }

        return shownCount;
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
        renderSmartWidget,
        renderInternalSections,
        renderExternalSections,
        renderAiSummaryText
    };
})(window);
