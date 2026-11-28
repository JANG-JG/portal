/**
 * 🗺️ JG 통합 검색 - 지역 종합 브리핑 카드 & 7일 주간예보 & 맛집·지역 탭 렌더러 (search-region-card.js)
 * - 모든 외부 텍스트는 textContent로 바인딩하여 XSS 원천 차단
 * - 대표 풍경 이미지(LCP 후보)에 fetchpriority="high" 적용
 */
(function (global) {
    'use strict';

    const LOCAL_CATEGORIES = [
        { code: 'ALL', label: '전체 장소' },
        { code: 'FD6', label: '🍽️ 맛집·식당' },
        { code: 'CE7', label: '☕ 카페·디저트' },
        { code: 'AT4', label: '🏞️ 관광·명소' },
        { code: 'AD5', label: '🏨 숙소·펜션' },
        { code: 'HP8', label: '🏥 병원·약국' }
    ];

    function makeEl(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function safeHref(url) {
        if (!url || typeof url !== 'string') return '#';
        const trimmed = url.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('tel:')) {
            return trimmed;
        }
        return '#';
    }

    /**
     * 7일 주간예보 스트립 생성 (지역 종합 카드 + 단독 날씨 카드 공용)
     */
    function renderForecastStrip(forecastList) {
        if (!Array.isArray(forecastList) || forecastList.length === 0) return null;
        const strip = makeEl('div', 'jg-forecast7-strip');
        strip.setAttribute('aria-label', '주간 날씨 예보');

        forecastList.forEach((f, idx) => {
            const box = makeEl('div', `jg-forecast7-day${idx === 0 ? ' is-today' : ''}`);
            box.appendChild(makeEl('div', 'jg-f7-label', f.label || ''));
            if (f.dateShort) {
                box.appendChild(makeEl('div', 'jg-f7-date', f.dateShort));
            }
            box.appendChild(makeEl('div', 'jg-f7-icon', f.icon || '🌤️'));

            const temps = makeEl('div', 'jg-f7-temps');
            const minSpan = makeEl('span', 'jg-f7-min', String(f.min || '-').replace('°C', '°'));
            const sep = document.createTextNode(' / ');
            const maxSpan = makeEl('span', 'jg-f7-max', String(f.max || '-').replace('°C', '°'));
            temps.append(minSpan, sep, maxSpan);
            box.appendChild(temps);

            const rainProb = typeof f.rainProb === 'number' ? f.rainProb : parseInt(String(f.rain || '0'), 10) || 0;
            const rainEl = makeEl('div', `jg-f7-rain${rainProb >= 30 ? ' is-wet' : ''}`, `💧 ${f.rain || '0%'}`);
            box.appendChild(rainEl);

            strip.appendChild(box);
        });
        return strip;
    }

    /**
     * 지역·여행지 올인원 복합 브리핑 카드 렌더링
     */
    function renderComposite(mount, data, nav = {}) {
        if (!mount || !data) return;
        mount.replaceChildren();

        const M = global.JGSearchMapWidget;
        const H = global.JGSearchCardHelpers;
        const card = makeEl('article', 'jg-region-card');

        // 1) 상단 배지 및 빠른 탭 이동
        const topRow = makeEl('div', 'jg-region-top-badges');
        topRow.appendChild(makeEl('span', 'jg-smart-badge', data.isGlobal ? '🌍 해외 여행지 종합 브리핑' : '🗺️ 지역 · 여행 종합 브리핑'));
        if (!data.isGlobal && typeof nav.onSwitchLocalCat === 'function') {
            const moreBtn = makeEl('button', 'jg-map-gps-btn', '📍 주변 명소·맛집 전체보기 ›');
            moreBtn.type = 'button';
            moreBtn.addEventListener('click', () => nav.onSwitchLocalCat('ALL'));
            topRow.appendChild(moreBtn);
        }
        card.appendChild(topRow);

        // 2) 히어로 그리드: 대표 풍경 이미지 + 지역 개요 + 미니맵
        const hasHeroImg = Boolean(data.heroImage && /^https?:\/\//i.test(data.heroImage));
        const hasMap = Boolean(!data.isGlobal && data.kakaoJsKey && data.center);
        const heroGrid = makeEl('div', `jg-region-hero-grid${hasHeroImg ? ' has-media' : ''}${hasMap ? ' has-map' : ''}`);

        if (hasHeroImg) {
            const img = document.createElement('img');
            img.className = 'jg-region-hero-img';
            img.src = safeHref(data.heroImage);
            img.alt = `${data.regionName || ''} 대표 풍경`;
            img.setAttribute('fetchpriority', 'high');
            img.referrerPolicy = 'no-referrer';
            img.decoding = 'async';
            img.addEventListener('error', () => {
                img.remove();
                heroGrid.classList.remove('has-media');
            });
            heroGrid.appendChild(img);
        }

        const overview = makeEl('div', 'jg-region-overview');
        if (data.subtitle) overview.appendChild(makeEl('div', 'jg-region-subtitle', data.subtitle));
        overview.appendChild(makeEl('h2', 'jg-region-title', data.regionName || data.query));
        if (data.summary) overview.appendChild(makeEl('p', 'jg-region-summary', data.summary));
        if (data.summaryUrl) {
            const wikiLink = makeEl('a', 'jg-region-wiki-link', '위키백과 지역 설명 더보기 ↗');
            wikiLink.href = safeHref(data.summaryUrl);
            wikiLink.target = '_blank';
            wikiLink.rel = 'noopener noreferrer';
            overview.appendChild(wikiLink);
        }
        heroGrid.appendChild(overview);

        let miniMap = null;
        let miniMarkers = [];
        let miniInfo = null;
        if (hasMap) {
            const mapWrap = makeEl('div', 'jg-region-minimap-wrap');
            const mapCanvas = makeEl('div', 'jg-region-minimap');
            mapWrap.appendChild(mapCanvas);
            heroGrid.appendChild(mapWrap);

            if (M && typeof M.loadSdk === 'function') {
                M.loadSdk(data.kakaoJsKey)
                    .then((kMaps) => {
                        const center = new kMaps.LatLng(data.center.lat, data.center.lng);
                        miniMap = new kMaps.Map(mapCanvas, { center, level: 7 });
                        miniInfo = new kMaps.InfoWindow({ removable: true });
                        const spots = Array.isArray(data.highlights) ? data.highlights : [];
                        if (spots.length > 0) {
                            const bounds = new kMaps.LatLngBounds();
                            spots.forEach((sp, idx) => {
                                if (!sp.lat || !sp.lng) return;
                                const pos = new kMaps.LatLng(sp.lat, sp.lng);
                                bounds.extend(pos);
                                const mk = new kMaps.Marker({ map: miniMap, position: pos, title: sp.name });
                                kMaps.event.addListener(mk, 'click', () => {
                                    const box = makeEl('div', 'jg-map-iw-box');
                                    box.appendChild(makeEl('strong', '', `${idx + 1}. ${sp.name}`));
                                    miniInfo.setContent(box);
                                    miniInfo.open(miniMap, mk);
                                });
                                miniMarkers.push(mk);
                            });
                            if (miniMarkers.length > 1) miniMap.setBounds(bounds);
                        } else {
                            new kMaps.Marker({ map: miniMap, position: center, title: data.regionName });
                        }
                    })
                    .catch(() => {
                        mapWrap.remove();
                        heroGrid.classList.remove('has-map');
                    });
            }
        }
        card.appendChild(heroGrid);

        // 3) 실시간 날씨 + 7일 주간예보 섹션
        const w = data.weather;
        if (w && w.temp) {
            const wxBox = makeEl('div', 'jg-region-weather-box');
            const wxHead = makeEl('div', 'jg-region-wx-head');

            const nowLeft = makeEl('div', 'jg-region-wx-now');
            nowLeft.appendChild(makeEl('span', 'jg-region-wx-icon', w.icon || '🌤️'));
            const nowTxt = makeEl('div');
            nowTxt.append(
                makeEl('div', 'jg-region-wx-temp', w.temp),
                makeEl('div', 'jg-region-wx-cond', `${w.city || data.shortName} · 현재 ${w.condition || '맑음'}`)
            );
            nowLeft.appendChild(nowTxt);

            const pills = makeEl('div', 'jg-region-wx-pills');
            if (w.feels_like) pills.appendChild(makeEl('span', 'jg-wx-meta-pill', `체감 ${w.feels_like}`));
            if (w.humidity) pills.appendChild(makeEl('span', 'jg-wx-meta-pill', `습도 ${w.humidity}`));
            if (w.pm10_grade) pills.appendChild(makeEl('span', 'jg-wx-meta-pill', `미세먼지 ${w.pm10_grade}`));
            if (w.pm25_grade) pills.appendChild(makeEl('span', 'jg-wx-meta-pill', `초미세 ${w.pm25_grade}`));

            wxHead.append(nowLeft, pills);
            wxBox.appendChild(wxHead);

            const strip = renderForecastStrip(w.forecast);
            if (strip) wxBox.appendChild(strip);
            card.appendChild(wxBox);
        }

        // 4) 인기 명소 · 맛집 하이라이트 TOP 4 + 업종별 빠른 이동
        const highlights = Array.isArray(data.highlights) ? data.highlights : [];
        if (highlights.length > 0 && M && typeof M.createPlaceItemCard === 'function') {
            const spotsWrap = makeEl('div');
            const spotsHead = makeEl('div', 'jg-region-spots-head');
            spotsHead.appendChild(makeEl('h3', 'jg-region-spots-title', `🌟 ${data.shortName || data.regionName} 대표 명소 · 맛집`));

            if (typeof nav.onSwitchLocalCat === 'function') {
                const quickChips = makeEl('div', 'jg-region-wx-pills');
                [
                    { code: 'FD6', text: '🍽️ 맛집 더보기' },
                    { code: 'CE7', text: '☕ 카페 더보기' },
                    { code: 'AT4', text: '🏞️ 명소 더보기' }
                ].forEach((c) => {
                    const b = makeEl('button', 'jg-map-gps-btn', c.text);
                    b.type = 'button';
                    b.addEventListener('click', () => nav.onSwitchLocalCat(c.code));
                    quickChips.appendChild(b);
                });
                spotsHead.appendChild(quickChips);
            }
            spotsWrap.appendChild(spotsHead);

            const grid = makeEl('div', 'jg-region-spots-grid');
            highlights.forEach((sp, idx) => {
                const itemEl = M.createPlaceItemCard(sp, idx, {
                    onFocus: () => {
                        if (miniMap && global.kakao?.maps && sp.lat && sp.lng) {
                            miniMap.panTo(new global.kakao.maps.LatLng(sp.lat, sp.lng));
                            if (miniMarkers[idx] && miniInfo) {
                                const box = makeEl('div', 'jg-map-iw-box');
                                box.appendChild(makeEl('strong', '', `${idx + 1}. ${sp.name}`));
                                miniInfo.setContent(box);
                                miniInfo.open(miniMap, miniMarkers[idx]);
                            }
                        }
                    }
                });
                grid.appendChild(itemEl);
            });
            spotsWrap.appendChild(grid);

            if (H && typeof nav.onSwitchTab === 'function') {
                H.appendMoreFooterButton(spotsWrap, `📍 ${data.shortName || data.regionName} 맛집·명소 15곳씩 더보기 ›`, 'local', nav.onSwitchTab);
            }
            card.appendChild(spotsWrap);
        }

        mount.appendChild(card);
    }

    /**
     * 맛집·지역(local) 전용 탭: 업종 필터 칩 + 지도 + 15곳 페이지네이션 렌더링
     */
    function renderLocalTabSection(mount, kakaoLocal, query, nav = {}) {
        const H = global.JGSearchCardHelpers;
        const M = global.JGSearchMapWidget;
        if (!mount || !H || !M) return 0;

        const places = Array.isArray(kakaoLocal?.places) ? kakaoLocal.places : [];
        const activeCat = kakaoLocal?.categoryGroup || nav.activeLocalCat || 'ALL';
        const meta = kakaoLocal?.meta || { total: places.length, page: 1 };

        const sec = H.createSectionShell({
            icon: '📍',
            title: `${query} · 장소 · 맛집 탐색`,
            countLabel: `${H.formatTotalCount(meta.total, places.length)} · ${meta.page || 1}페이지`
        });
        sec.classList.add('jg-local-tab-sec');

        // 업종별 단일 행 가로 스크롤 필터 칩
        const catBar = makeEl('div', 'jg-local-cat-bar');
        catBar.setAttribute('role', 'group');
        catBar.setAttribute('aria-label', '장소 업종 필터');
        LOCAL_CATEGORIES.forEach((cat) => {
            const btn = makeEl('button', 'jg-local-cat-chip', cat.label);
            btn.type = 'button';
            const selected = cat.code === activeCat;
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            btn.addEventListener('click', () => {
                if (typeof nav.onSwitchLocalCat === 'function') {
                    nav.onSwitchLocalCat(cat.code);
                }
            });
            catBar.appendChild(btn);
        });
        sec.appendChild(catBar);

        if (places.length === 0) {
            sec.appendChild(makeEl('p', 'jg-muted-text', '선택한 업종에 해당하는 장소 검색 결과가 없습니다. 다른 업종 칩을 선택해 보세요.'));
            mount.appendChild(sec);
            return 1;
        }

        let tabMap = null;
        let tabMarkers = [];
        let tabInfo = null;
        if (kakaoLocal?.kakaoJsKey) {
            const mapWrap = makeEl('div', 'jg-local-tab-map-wrap');
            const mapCanvas = makeEl('div', 'jg-map-canvas');
            mapWrap.appendChild(mapCanvas);
            sec.appendChild(mapWrap);

            M.loadSdk(kakaoLocal.kakaoJsKey)
                .then((kMaps) => {
                    const first = places[0];
                    tabMap = new kMaps.Map(mapCanvas, {
                        center: new kMaps.LatLng(first.lat, first.lng),
                        level: 5
                    });
                    tabMap.addControl(new kMaps.ZoomControl(), kMaps.ControlPosition.RIGHT);
                    tabInfo = new kMaps.InfoWindow({ removable: true });
                    const bounds = new kMaps.LatLngBounds();
                    tabMarkers = places.map((pl, idx) => {
                        const pos = new kMaps.LatLng(pl.lat, pl.lng);
                        bounds.extend(pos);
                        const mk = new kMaps.Marker({ map: tabMap, position: pos, title: pl.name });
                        kMaps.event.addListener(mk, 'click', () => {
                            const box = makeEl('div', 'jg-map-iw-box');
                            box.appendChild(makeEl('strong', '', `${idx + 1}. ${pl.name}`));
                            tabInfo.setContent(box);
                            tabInfo.open(tabMap, mk);
                        });
                        return mk;
                    });
                    if (places.length > 1) tabMap.setBounds(bounds);
                })
                .catch(() => {
                    mapWrap.remove();
                });
        }

        const list = makeEl('div', 'jg-map-places-list');
        list.style.borderTop = 'none';
        list.style.marginTop = '0';
        list.style.paddingTop = '0';

        const offset = ((meta.page || 1) - 1) * (meta.display || 15);
        places.forEach((pl, idx) => {
            const cardEl = M.createPlaceItemCard(pl, offset + idx, {
                active: idx === 0,
                onFocus: () => {
                    list.querySelectorAll('.jg-map-place-item').forEach((n, i) => n.classList.toggle('is-active', i === idx));
                    if (tabMap && global.kakao?.maps && pl.lat && pl.lng) {
                        tabMap.panTo(new global.kakao.maps.LatLng(pl.lat, pl.lng));
                        if (tabMarkers[idx] && tabInfo) {
                            const box = makeEl('div', 'jg-map-iw-box');
                            box.appendChild(makeEl('strong', '', `${offset + idx + 1}. ${pl.name}`));
                            tabInfo.setContent(box);
                            tabInfo.open(tabMap, tabMarkers[idx]);
                        }
                    }
                }
            });
            list.appendChild(cardEl);
        });
        sec.appendChild(list);

        if (meta && nav.onPageChange) {
            H.appendPagination(sec, meta, nav.onPageChange);
        }
        mount.appendChild(sec);
        return places.length;
    }

    global.JGSearchRegionCard = {
        renderForecastStrip,
        renderComposite,
        renderLocalTabSection
    };
})(window);
