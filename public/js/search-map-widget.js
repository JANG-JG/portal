/**
 * 📍 JG 통합 검색 - 카카오맵 즉답 위젯 렌더러 (search-map-widget.js)
 * - 초기 정적/잠금 미니맵 미리보기 + [지도 펼치기] 클릭 시 대화형 다중 마커(①~⑤) 및 목록 확장
 * - [내 현재 위치로 찾기] GPS 반경 재검색 및 카카오맵·네이버지도·길찾기 연동
 * - XSS 방지를 위해 모든 API 텍스트는 textContent로만 바인딩
 */
(function (global) {
    'use strict';

    let kakaoSdkPromise = null;
    let activeSdkKey = '';

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

    function loadKakaoMapsSdk(appKey) {
        if (!appKey) return Promise.reject(new Error('KAKAO_JS_KEY 없음'));
        if (global.kakao && global.kakao.maps && global.kakao.maps.LatLng) {
            return Promise.resolve(global.kakao.maps);
        }
        if (kakaoSdkPromise && activeSdkKey === appKey) return kakaoSdkPromise;

        activeSdkKey = appKey;
        kakaoSdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
            script.async = true;
            script.onload = () => {
                if (global.kakao && global.kakao.maps && typeof global.kakao.maps.load === 'function') {
                    global.kakao.maps.load(() => resolve(global.kakao.maps));
                } else {
                    kakaoSdkPromise = null;
                    reject(new Error('카카오맵 SDK 초기화 실패'));
                }
            };
            script.onerror = () => {
                kakaoSdkPromise = null;
                reject(new Error('카카오맵 SDK 스크립트 로드 실패'));
            };
            document.head.appendChild(script);
        });
        return kakaoSdkPromise;
    }

    function formatDistance(meters) {
        if (!Number.isFinite(meters) || meters <= 0) return '';
        if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
        return `${Math.round(meters)}m`;
    }

    function copyText(text, btn) {
        if (!text || !navigator.clipboard) return;
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = '복사됨 ✓';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        }).catch(() => {});
    }

    function render(mount, data) {
        if (!mount || !data || !Array.isArray(data.places) || data.places.length === 0) return;
        mount.replaceChildren();

        const places = data.places;
        const primary = places[0];
        let isExpanded = false;
        let mapInstance = null;
        let markers = [];
        let activeInfoWindow = null;

        const card = makeEl('div', 'jg-smart-card jg-map-card');

        // 1. 상단 헤더 (배지 + 기준 위치 + 내 위치 재검색)
        const topRow = makeEl('div', 'jg-map-top-row');
        const badgeGroup = makeEl('div', 'jg-map-badge-group');
        badgeGroup.appendChild(makeEl('span', 'jg-smart-badge', '📍 지역 · 지도 즉답'));
        if (data.anchorLabel) {
            badgeGroup.appendChild(makeEl('span', 'jg-map-anchor-pill', data.anchorLabel));
        }
        topRow.appendChild(badgeGroup);

        const gpsBtn = makeEl('button', 'jg-map-gps-btn', '🎯 내 현재 위치로 찾기');
        gpsBtn.type = 'button';
        gpsBtn.addEventListener('click', () => {
            if (!navigator.geolocation) {
                gpsBtn.textContent = '위치 기능 미지원';
                return;
            }
            gpsBtn.disabled = true;
            gpsBtn.textContent = '위치 확인 중...';
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    try {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;
                        const q = data.rawQuery || data.query;
                        const res = await fetch(
                            `/api/search/map-nearby?q=${encodeURIComponent(q)}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
                            { credentials: 'include' }
                        );
                        const json = await res.json();
                        if (json && json.success && json.widget && json.widget.data) {
                            render(mount, json.widget.data);
                            return;
                        }
                        gpsBtn.textContent = '주변 결과 없음';
                    } catch (_) {
                        gpsBtn.textContent = '조회 실패';
                    } finally {
                        gpsBtn.disabled = false;
                    }
                },
                () => {
                    gpsBtn.disabled = false;
                    gpsBtn.textContent = '위치 권한 필요';
                },
                { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
            );
        });
        topRow.appendChild(gpsBtn);
        card.appendChild(topRow);

        // 2. 메인 컴팩트 영역 (대표 장소 요약 + 잠금 미니맵)
        const mainGrid = makeEl('div', 'jg-map-main-grid');

        const infoCol = makeEl('div', 'jg-map-primary-info');
        const titleRow = makeEl('div', 'jg-map-title-row');
        titleRow.appendChild(makeEl('h4', 'jg-map-place-title', primary.name));
        if (primary.category) {
            titleRow.appendChild(makeEl('span', 'jg-map-cat-pill', primary.category));
        }
        infoCol.appendChild(titleRow);

        const fullAddr = primary.roadAddress || primary.address;
        if (fullAddr) {
            const addrRow = makeEl('div', 'jg-map-addr-row');
            addrRow.appendChild(makeEl('span', 'jg-map-addr-text', fullAddr));
            const copyBtn = makeEl('button', 'jg-map-copy-btn', '주소 복사');
            copyBtn.type = 'button';
            copyBtn.addEventListener('click', () => copyText(fullAddr, copyBtn));
            addrRow.appendChild(copyBtn);
            infoCol.appendChild(addrRow);
        }
        if (primary.roadAddress && primary.address && primary.roadAddress !== primary.address) {
            infoCol.appendChild(makeEl('div', 'jg-map-jibun-text', `(지번) ${primary.address}`));
        }

        const metaRow = makeEl('div', 'jg-map-meta-row');
        if (primary.phone) {
            const telLink = makeEl('a', 'jg-map-phone-link', `📞 ${primary.phone}`);
            telLink.href = safeHref(`tel:${primary.phone}`);
            metaRow.appendChild(telLink);
        }
        const distLabel = formatDistance(primary.distance);
        if (distLabel) {
            metaRow.appendChild(makeEl('span', 'jg-map-dist-pill', distLabel));
        }
        if (metaRow.childNodes.length > 0) infoCol.appendChild(metaRow);

        mainGrid.appendChild(infoCol);

        // 미니맵 컨테이너
        const mapBox = makeEl('div', 'jg-map-canvas-wrap');
        const mapCanvas = makeEl('div', 'jg-map-canvas');
        const mapFallback = makeEl('div', 'jg-map-fallback');
        mapFallback.appendChild(makeEl('div', 'jg-map-fallback-icon', '🗺️'));
        mapFallback.appendChild(makeEl('div', 'jg-map-fallback-title', `${primary.name}`));
        mapFallback.appendChild(makeEl('div', 'jg-muted-text', '지도를 불러오는 중이거나 외부 지도로 바로 이동할 수 있습니다.'));
        mapBox.append(mapCanvas, mapFallback);
        mainGrid.appendChild(mapBox);

        card.appendChild(mainGrid);

        // 3. 액션 버튼 바 (지도 펼치기 + 카카오맵 + 네이버지도 + 길찾기)
        const actionBar = makeEl('div', 'jg-map-action-bar');
        const expandBtn = makeEl(
            'button',
            'jg-map-btn jg-map-btn-primary',
            places.length > 1 ? `🗺️ 지도 펼치기 (${places.length}곳)` : '🗺️ 지도 크게 보기'
        );
        expandBtn.type = 'button';

        const kakaoLink = makeEl('a', 'jg-map-btn jg-map-btn-kakao', '카카오맵 열기');
        kakaoLink.href = safeHref(primary.kakaoUrl);
        kakaoLink.target = '_blank';
        kakaoLink.rel = 'noopener noreferrer';

        const naverLink = makeEl('a', 'jg-map-btn jg-map-btn-naver', '네이버지도 열기');
        naverLink.href = safeHref(primary.naverUrl);
        naverLink.target = '_blank';
        naverLink.rel = 'noopener noreferrer';

        const dirLink = makeEl('a', 'jg-map-btn jg-map-btn-outline', '🧭 길찾기');
        dirLink.href = safeHref(primary.directionsUrl);
        dirLink.target = '_blank';
        dirLink.rel = 'noopener noreferrer';

        actionBar.append(expandBtn, kakaoLink, naverLink, dirLink);
        card.appendChild(actionBar);

        // 4. 확장 시 노출되는 다중 장소 목록 (①~⑤)
        const listWrap = makeEl('div', 'jg-map-places-list');
        listWrap.style.display = 'none';

        places.forEach((pl, idx) => {
            const item = makeEl('div', 'jg-map-place-item');
            if (idx === 0) item.classList.add('is-active');

            const numBadge = makeEl('span', 'jg-map-num-badge', String(idx + 1));
            const body = makeEl('div', 'jg-map-item-body');

            const head = makeEl('div', 'jg-map-item-head');
            head.appendChild(makeEl('strong', 'jg-map-item-name', pl.name));
            if (pl.category) head.appendChild(makeEl('span', 'jg-map-item-cat', pl.category));
            const dStr = formatDistance(pl.distance);
            if (dStr) head.appendChild(makeEl('span', 'jg-map-dist-pill', dStr));
            body.appendChild(head);

            const addr = pl.roadAddress || pl.address;
            if (addr) body.appendChild(makeEl('div', 'jg-map-item-addr', addr));
            if (pl.phone) body.appendChild(makeEl('div', 'jg-map-item-phone', `📞 ${pl.phone}`));

            const extLinks = makeEl('div', 'jg-map-item-links');
            const kA = makeEl('a', 'jg-map-mini-link', '카카오맵');
            kA.href = safeHref(pl.kakaoUrl);
            kA.target = '_blank';
            kA.rel = 'noopener noreferrer';
            kA.addEventListener('click', (ev) => ev.stopPropagation());

            const nA = makeEl('a', 'jg-map-mini-link', '네이버지도');
            nA.href = safeHref(pl.naverUrl);
            nA.target = '_blank';
            nA.rel = 'noopener noreferrer';
            nA.addEventListener('click', (ev) => ev.stopPropagation());

            extLinks.append(kA, nA);
            body.appendChild(extLinks);

            item.append(numBadge, body);
            item.addEventListener('click', () => {
                listWrap.querySelectorAll('.jg-map-place-item').forEach((el) => el.classList.remove('is-active'));
                item.classList.add('is-active');
                focusPlaceOnMap(idx);
            });
            listWrap.appendChild(item);
        });
        card.appendChild(listWrap);

        mount.appendChild(card);

        function focusPlaceOnMap(idx) {
            if (!mapInstance || !global.kakao || !global.kakao.maps) return;
            const target = places[idx];
            if (!target || !target.lat || !target.lng) return;
            const pos = new global.kakao.maps.LatLng(target.lat, target.lng);
            mapInstance.panTo(pos);
            const marker = markers[idx];
            if (marker && activeInfoWindow) {
                const iwBox = makeEl('div', 'jg-map-iw-box');
                iwBox.appendChild(makeEl('strong', '', `${idx + 1}. ${target.name}`));
                activeInfoWindow.setContent(iwBox);
                activeInfoWindow.open(mapInstance, marker);
            }
        }

        function applyMapMode(expanded) {
            isExpanded = expanded;
            card.classList.toggle('is-expanded', expanded);
            listWrap.style.display = expanded ? 'flex' : 'none';
            expandBtn.textContent = expanded
                ? '🗺️ 지도 접기 ▲'
                : (places.length > 1 ? `🗺️ 지도 펼치기 (${places.length}곳)` : '🗺️ 지도 크게 보기');

            if (mapInstance && global.kakao && global.kakao.maps) {
                mapInstance.setDraggable(expanded);
                mapInstance.setZoomable(expanded);
                setTimeout(() => {
                    mapInstance.relayout();
                    if (expanded && places.length > 1) {
                        const bounds = new global.kakao.maps.LatLngBounds();
                        places.forEach((p) => {
                            if (p.lat && p.lng) bounds.extend(new global.kakao.maps.LatLng(p.lat, p.lng));
                        });
                        mapInstance.setBounds(bounds);
                    } else {
                        mapInstance.setCenter(new global.kakao.maps.LatLng(primary.lat, primary.lng));
                        mapInstance.setLevel(4);
                    }
                }, 60);
            }
        }

        expandBtn.addEventListener('click', () => {
            applyMapMode(!isExpanded);
        });

        // 카카오맵 SDK 지연 로드 및 초기 잠금 미리보기 렌더링
        if (data.kakaoJsKey) {
            loadKakaoMapsSdk(data.kakaoJsKey)
                .then((kMaps) => {
                    mapFallback.style.display = 'none';
                    const centerPos = new kMaps.LatLng(primary.lat, primary.lng);
                    mapInstance = new kMaps.Map(mapCanvas, {
                        center: centerPos,
                        level: 4,
                        draggable: false,
                        scrollwheel: false
                    });
                    const zoomCtrl = new kMaps.ZoomControl();
                    mapInstance.addControl(zoomCtrl, kMaps.ControlPosition.RIGHT);

                    activeInfoWindow = new kMaps.InfoWindow({ removable: true });
                    markers = places.map((pl, idx) => {
                        const marker = new kMaps.Marker({
                            map: mapInstance,
                            position: new kMaps.LatLng(pl.lat, pl.lng),
                            title: pl.name
                        });
                        kMaps.event.addListener(marker, 'click', () => {
                            if (!isExpanded) applyMapMode(true);
                            listWrap.querySelectorAll('.jg-map-place-item').forEach((el, i) => {
                                el.classList.toggle('is-active', i === idx);
                            });
                            focusPlaceOnMap(idx);
                        });
                        return marker;
                    });
                })
                .catch(() => {
                    mapCanvas.style.display = 'none';
                    mapFallback.style.display = 'flex';
                });
        } else {
            mapCanvas.style.display = 'none';
            mapFallback.style.display = 'flex';
        }
    }

    global.JGSearchMapWidget = { render };
})(window);
