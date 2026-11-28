/**
 * 🖼️ JG 통합 검색 - 인라인 이미지 스트립 · 이미지 전용 갤러리 · 네이티브 <dialog> 라이트박스 (search-media-modal.js)
 * - 순수 DOM 생성(XSS 원천 차단), <dialog closedby="any"> + 미지원 브라우저 외부 클릭 폴백 적용
 */
(function (global) {
    'use strict';

    const makeEl = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    };

    const modalState = {
        dialog: null,
        items: [],
        index: 0,
        els: {}
    };

    function safeImageUrl(url) {
        const H = global.JGSearchCardHelpers;
        return H ? H.safeHref(url) : '#';
    }

    function ensureLightboxDialog() {
        if (modalState.dialog && document.body.contains(modalState.dialog)) {
            return modalState.dialog;
        }

        // 네이티브 <dialog>: role="dialog" / aria-modal 생략, 제목은 h1 사용 (dialog 가이드 준수)
        const dialog = makeEl('dialog', 'jg-media-dialog');
        dialog.id = 'jgMediaLightboxDialog';
        dialog.setAttribute('closedby', 'any');
        dialog.setAttribute('aria-labelledby', 'jgMediaDialogTitle');

        const topBar = makeEl('div', 'jg-media-dialog-topbar');
        const titleEl = makeEl('h1', 'jg-media-dialog-title', '이미지 미리보기');
        titleEl.id = 'jgMediaDialogTitle';

        const closeForm = makeEl('form', 'jg-media-close-form');
        closeForm.method = 'dialog';
        const closeBtn = makeEl('button', 'jg-media-close-btn', '✕ 닫기');
        closeBtn.type = 'submit';
        closeBtn.value = 'close';
        closeBtn.autofocus = true;
        closeBtn.setAttribute('aria-label', '이미지 미리보기 닫기');
        closeForm.appendChild(closeBtn);
        topBar.append(titleEl, closeForm);

        const stage = makeEl('div', 'jg-media-stage');
        const prevBtn = makeEl('button', 'jg-media-nav-btn is-prev', '‹');
        prevBtn.type = 'button';
        prevBtn.setAttribute('aria-label', '이전 이미지');
        prevBtn.addEventListener('click', () => stepImage(-1));

        const imgEl = makeEl('img', 'jg-media-full-img');
        imgEl.alt = '';
        imgEl.referrerPolicy = 'no-referrer';

        const nextBtn = makeEl('button', 'jg-media-nav-btn is-next', '›');
        nextBtn.type = 'button';
        nextBtn.setAttribute('aria-label', '다음 이미지');
        nextBtn.addEventListener('click', () => stepImage(1));

        stage.append(prevBtn, imgEl, nextBtn);

        const metaRow = makeEl('div', 'jg-media-meta-row');
        const metaInfo = makeEl('div', 'jg-media-meta-info');
        const counterEl = makeEl('span', 'jg-media-counter', '');
        const sourceEl = makeEl('span', 'jg-media-source', '');
        metaInfo.append(counterEl, sourceEl);

        const actionGroup = makeEl('div', 'jg-media-actions');
        const clipMount = makeEl('span', 'jg-media-clip-slot');
        const openDocLink = makeEl('a', 'jg-media-doc-link', '원본 문서 열기 ↗');
        openDocLink.target = '_blank';
        openDocLink.rel = 'noopener noreferrer';
        actionGroup.append(clipMount, openDocLink);

        metaRow.append(metaInfo, actionGroup);
        dialog.append(topBar, stage, metaRow);

        dialog.addEventListener('close', () => {
            dialog.returnValue = '';
        });

        dialog.addEventListener('keydown', (e) => {
            if (!dialog.open) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                stepImage(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                stepImage(1);
            }
        });

        // closedby 미지원 브라우저용 외부(백드롭) 포인터 다운+업 경계 폴백
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const isOutside = (ev) => {
                const r = dialog.getBoundingClientRect();
                return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
            };
            let pressedOutside = false;
            dialog.addEventListener('pointerdown', (ev) => {
                pressedOutside = ev.target === dialog && isOutside(ev);
            });
            dialog.addEventListener('pointerup', (ev) => {
                if (pressedOutside && ev.target === dialog && isOutside(ev)) {
                    dialog.close();
                }
                pressedOutside = false;
            });
        }

        document.body.appendChild(dialog);
        modalState.dialog = dialog;
        modalState.els = { titleEl, imgEl, prevBtn, nextBtn, counterEl, sourceEl, clipMount, openDocLink };
        return dialog;
    }

    function stepImage(delta) {
        const len = modalState.items.length;
        if (len <= 1) return;
        modalState.index = (modalState.index + delta + len) % len;
        renderActiveModalItem();
    }

    function renderActiveModalItem() {
        const H = global.JGSearchCardHelpers;
        const item = modalState.items[modalState.index];
        if (!item || !modalState.dialog) return;

        const { titleEl, imgEl, prevBtn, nextBtn, counterEl, sourceEl, clipMount, openDocLink } = modalState.els;
        const len = modalState.items.length;

        titleEl.textContent = item.title || item.siteName || '검색 이미지';
        counterEl.textContent = `${modalState.index + 1} / ${len}`;

        const metaParts = [];
        if (item.siteName) metaParts.push(item.siteName);
        if (item.width && item.height) metaParts.push(`${item.width}×${item.height}`);
        if (item.date) metaParts.push(item.date);
        sourceEl.textContent = metaParts.join(' · ');

        prevBtn.disabled = len <= 1;
        nextBtn.disabled = len <= 1;

        const primarySrc = safeImageUrl(item.imageUrl || item.thumbnail);
        const fallbackSrc = safeImageUrl(item.thumbnail);
        imgEl.onerror = () => {
            imgEl.onerror = null;
            if (fallbackSrc && fallbackSrc !== '#' && imgEl.src !== fallbackSrc) {
                imgEl.src = fallbackSrc;
            }
        };
        imgEl.src = primarySrc;
        imgEl.alt = item.title || '검색 이미지';

        const docHref = safeImageUrl(item.docUrl);
        openDocLink.href = docHref;
        openDocLink.style.display = docHref !== '#' ? 'inline-flex' : 'none';

        clipMount.replaceChildren();
        if (H && H.createClipButton && item.docUrl && /^https?:\/\//i.test(item.docUrl)) {
            clipMount.appendChild(
                H.createClipButton({
                    url: item.docUrl,
                    title: item.title || item.siteName || '이미지 출처 문서',
                    snippet: `${item.siteName || '웹 이미지'} (${item.date || ''})`.trim(),
                    thumbnail: item.thumbnail || item.imageUrl || null,
                    siteName: item.siteName || '',
                    category: 'image',
                    clipped: Boolean(item.clipped),
                    onToggle: (nextClipped) => {
                        item.clipped = nextClipped;
                    }
                })
            );
        }
    }

    function openLightbox(items, startIndex = 0) {
        if (!Array.isArray(items) || !items.length) return;
        const dialog = ensureLightboxDialog();
        modalState.items = items;
        modalState.index = Math.max(0, Math.min(items.length - 1, Number(startIndex) || 0));
        renderActiveModalItem();
        if (!dialog.open) {
            dialog.showModal();
        }
    }

    function createImageTile(item, idx, allItems, isLcpCandidate = false) {
        const btn = makeEl('button', 'jg-gallery-tile');
        btn.type = 'button';
        btn.setAttribute('aria-label', `${item.title || '이미지'} 크게 보기`);

        const img = makeEl('img', 'jg-gallery-tile-img');
        img.src = safeImageUrl(item.thumbnail || item.imageUrl);
        img.alt = item.title || item.siteName || '검색 이미지';
        img.referrerPolicy = 'no-referrer';
        if (isLcpCandidate) {
            img.setAttribute('fetchpriority', 'high');
        } else {
            img.loading = 'lazy';
        }
        img.addEventListener('error', () => {
            btn.remove();
        });

        const cap = makeEl('span', 'jg-gallery-tile-caption', item.siteName || item.title || '이미지');
        btn.append(img, cap);
        btn.addEventListener('click', () => openLightbox(allItems, idx));
        return btn;
    }

    function createInlineImageStrip(items, query, onSwitchTab) {
        if (!Array.isArray(items) || items.length === 0) return null;
        const valid = items.filter((it) => it && (it.thumbnail || it.imageUrl)).slice(0, 8);
        if (!valid.length) return null;

        const block = makeEl('div', 'jg-inline-img-block');
        const hdr = makeEl('div', 'jg-inline-img-header');
        const titleWrap = makeEl('div', 'jg-inline-img-title-wrap');
        titleWrap.append(
            makeEl('span', 'jg-cat-pill is-image', '🖼️ 관련 이미지'),
            makeEl('span', 'jg-inline-img-sub', `'${query}' 대표 시각 자료`)
        );
        hdr.appendChild(titleWrap);

        if (typeof onSwitchTab === 'function') {
            const moreBtn = makeEl('button', 'jg-section-more-chip', '이미지 탭 더보기 ›');
            moreBtn.type = 'button';
            moreBtn.addEventListener('click', () => onSwitchTab('image', 1));
            hdr.appendChild(moreBtn);
        }
        block.appendChild(hdr);

        const strip = makeEl('div', 'jg-inline-img-grid');
        valid.forEach((it, idx) => {
            strip.appendChild(createImageTile(it, idx, valid, false));
        });
        block.appendChild(strip);
        return block;
    }

    function renderImageTabGallery(mount, imagesBucket, query = '', nav = {}) {
        const H = global.JGSearchCardHelpers;
        if (!mount || !H) return 0;

        const items = Array.isArray(imagesBucket?.items) ? imagesBucket.items : [];
        const meta = imagesBucket?.meta || {};
        const page = Number(meta.page) || 1;
        const totalTxt = H.formatTotalCount(meta.total, items.length);

        const sec = H.createSectionShell({
            icon: '🖼️',
            title: '이미지 갤러리',
            countLabel: totalTxt ? `${totalTxt} · ${page}페이지` : `${items.length}건`
        });

        if (!items.length) {
            sec.appendChild(makeEl('p', 'jg-muted-text', `'${query}'에 대한 이미지 검색 결과가 없습니다.`));
            mount.appendChild(sec);
            return 1;
        }

        const grid = makeEl('div', 'jg-image-gallery-grid');
        items.forEach((it, idx) => {
            const isFirstLcp = page === 1 && idx === 0;
            grid.appendChild(createImageTile(it, idx, items, isFirstLcp));
        });
        sec.appendChild(grid);

        if (meta && typeof nav.onPageChange === 'function') {
            H.appendPagination(sec, meta, nav.onPageChange);
        }
        mount.appendChild(sec);
        return items.length;
    }

    global.JGSearchMediaModal = {
        openLightbox,
        createInlineImageStrip,
        renderImageTabGallery
    };
})(window);
