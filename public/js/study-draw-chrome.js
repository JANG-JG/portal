/**
 * ==============================================================================
 * 빨간패드공부 캔버스 중심 스튜디오 크롬 모듈 (study-draw-chrome.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 · 기존 ID/속성 보존
 * 그리기 창을 화면 80%+로 확보하기 위해 보조 도구는 플로팅 드로어로 수납하고
 * 팔레트·색깔 약속표는 가로 모드 좌측 슬림 레일로 배치한다.
 * ==============================================================================
 */
(function () {
    'use strict';

    function pickByClass(nodes, cls) {
        return nodes.find((n) => n && n.classList && n.classList.contains(cls)) || null;
    }

    function createPopButton({ key, label, title, className = '' }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `study-btn study-btn-outline coloring-pop-trigger ${className}`.trim();
        btn.dataset.popKey = key;
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', title || label);
        btn.title = title || label;
        btn.textContent = label;
        return btn;
    }

    function setupToastBanner(banner, stage) {
        if (!banner || !stage) return;
        banner.classList.add('coloring-stage-toast');
        stage.appendChild(banner);

        let hideTimer = null;
        const flashToast = () => {
            if (!banner.textContent || !banner.textContent.trim()) return;
            banner.classList.add('is-toast-visible');
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                banner.classList.remove('is-toast-visible');
            }, 3000);
        };

        flashToast();
        if (typeof MutationObserver === 'function') {
            new MutationObserver(flashToast).observe(banner, {
                childList: true,
                characterData: true,
                subtree: true
            });
        }
    }

    function assemble({ container, dockNodes = [], stage, banner, hintHost, isPokemonSheet, artworkBar, promptText = '' }) {
        if (!container || !stage) return;
        container.classList.add('coloring-studio-root');

        const nodes = dockNodes.filter(Boolean);
        const modeBar = pickByClass(nodes, 'color-toolbar');
        const drawSubbarEl = pickByClass(nodes, 'draw-subbar');
        const stickerTrayEl = pickByClass(nodes, 'draw-sticker-tray');
        const cbnLegendBar = pickByClass(nodes, 'cbn-legend-bar');
        const guideBar = pickByClass(nodes, 'guide-step-bar');
        const recPaletteBar = pickByClass(nodes, 'pokemon-rec-palette');
        const palette = pickByClass(nodes, 'color-palette');

        // 1. 상단 1줄 초슬림 도구 바 (메인 도구 + 보조 드로어 열기 버튼)
        const topStrip = document.createElement('div');
        topStrip.className = 'coloring-top-strip no-print';
        topStrip.setAttribute('role', 'region');
        topStrip.setAttribute('aria-label', '그림 그리기 도구 모음');
        if (modeBar) topStrip.appendChild(modeBar);

        const popBtnsGroup = document.createElement('div');
        popBtnsGroup.className = 'coloring-strip-pop-btns';

        const drawer = document.createElement('div');
        drawer.className = 'coloring-pop-drawer no-print';
        drawer.hidden = true;
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-label', '세부 그리기 도구');

        const drawerHead = document.createElement('div');
        drawerHead.className = 'coloring-pop-head';
        const drawerTitle = document.createElement('span');
        drawerTitle.className = 'coloring-pop-title';
        const drawerCloseBtn = document.createElement('button');
        drawerCloseBtn.type = 'button';
        drawerCloseBtn.className = 'coloring-pop-close';
        drawerCloseBtn.setAttribute('aria-label', '도구 창 닫기');
        drawerCloseBtn.textContent = '✕';
        drawerHead.append(drawerTitle, drawerCloseBtn);

        const drawerBody = document.createElement('div');
        drawerBody.className = 'coloring-pop-body';
        drawer.append(drawerHead, drawerBody);

        const panels = new Map();
        const triggers = new Map();
        let activeKey = null;

        const registerPanel = ({ key, btnLabel, title, triggerClass = '', setupBody }) => {
            const panel = document.createElement('div');
            panel.className = 'coloring-pop-section';
            panel.dataset.popSection = key;
            panel.hidden = true;
            setupBody(panel);
            drawerBody.appendChild(panel);
            panels.set(key, { panel, title });

            const btn = createPopButton({ key, label: btnLabel, title, className: triggerClass });
            triggers.set(key, btn);
            popBtnsGroup.appendChild(btn);
            return btn;
        };

        const closeDrawer = () => {
            if (!activeKey) return;
            activeKey = null;
            drawer.hidden = true;
            panels.forEach(({ panel }) => { panel.hidden = true; });
            triggers.forEach((b) => {
                b.classList.remove('is-open');
                b.setAttribute('aria-expanded', 'false');
            });
        };

        const openDrawer = (key) => {
            const entry = panels.get(key);
            if (!entry) return;
            if (activeKey === key && !drawer.hidden) {
                closeDrawer();
                return;
            }
            activeKey = key;
            drawerTitle.textContent = entry.title;
            panels.forEach(({ panel }, k) => {
                const show = k === key;
                panel.hidden = !show;
                if (show && k === 'brush' && drawSubbarEl) drawSubbarEl.hidden = false;
                if (show && k === 'sticker' && stickerTrayEl) stickerTrayEl.hidden = false;
            });
            triggers.forEach((b, k) => {
                const on = k === key;
                b.classList.toggle('is-open', on);
                b.setAttribute('aria-expanded', on ? 'true' : 'false');
            });
            drawer.hidden = false;
        };

        if (drawSubbarEl) {
            registerPanel({
                key: 'brush',
                btnLabel: '✨ 브러시 ▾',
                title: '✨ 브러시 · 좌우 대칭',
                setupBody: (panel) => panel.appendChild(drawSubbarEl)
            });
        }

        if (stickerTrayEl) {
            registerPanel({
                key: 'sticker',
                btnLabel: '🏷️ 스티커함 ▾',
                title: '🏷️ 스티커 고르기',
                triggerClass: 'is-sticker-trigger',
                setupBody: (panel) => panel.appendChild(stickerTrayEl)
            });
            stickerTrayEl.addEventListener('click', (e) => {
                if (e.target.closest('.draw-sticker-item, [data-sticker]')) {
                    setTimeout(closeDrawer, 40);
                }
            });
        }

        const hasMoreContent = Boolean(
            (artworkBar && artworkBar.children.length > 0) ||
            (isPokemonSheet && hintHost) ||
            String(promptText || '').trim()
        );
        if (hasMoreContent) {
            registerPanel({
                key: 'more',
                btnLabel: isPokemonSheet ? '💾 저장·힌트 ▾' : '💾 저장·안내 ▾',
                title: isPokemonSheet ? '💾 저장 · 자랑 · 원래 색깔' : '💾 저장 · 자랑 · 안내',
                setupBody: (panel) => {
                    if (String(promptText || '').trim()) {
                        const p = document.createElement('p');
                        p.className = 'coloring-drawer-prompt';
                        p.textContent = promptText;
                        panel.appendChild(p);
                    }
                    if (isPokemonSheet && hintHost) panel.appendChild(hintHost);
                    if (artworkBar && artworkBar.children.length > 0) panel.appendChild(artworkBar);
                }
            });
        }

        triggers.forEach((btn, key) => btn.addEventListener('click', () => openDrawer(key)));
        drawerCloseBtn.addEventListener('click', closeDrawer);

        // '스티커' 모드 버튼 누르면 스티커 선택창 자동 열기(이미 스티커 모드면 토글)
        const stickerModeBtn = modeBar?.querySelector('[data-color-mode="sticker"]');
        if (stickerModeBtn && stickerTrayEl) {
            let wasStickerBefore = false;
            stickerModeBtn.addEventListener('pointerdown', () => {
                wasStickerBefore = stickerModeBtn.classList.contains('active');
            });
            stickerModeBtn.addEventListener('click', () => {
                if (wasStickerBefore && activeKey === 'sticker' && !drawer.hidden) {
                    closeDrawer();
                } else {
                    openDrawer('sticker');
                }
            });
        }

        if (popBtnsGroup.children.length > 0) topStrip.appendChild(popBtnsGroup);

        // 2. 작업 영역: 좌측 슬림 색상 레일 + 최대 크기 그리기 캔버스
        const workspaceRow = document.createElement('div');
        workspaceRow.className = 'coloring-workspace-row';

        if (cbnLegendBar || recPaletteBar || palette) {
            const sideRail = document.createElement('div');
            sideRail.className = 'coloring-side-rail no-print';
            if (cbnLegendBar) {
                sideRail.dataset.hasCbn = '1';
                sideRail.appendChild(cbnLegendBar);
            }
            if (recPaletteBar) sideRail.appendChild(recPaletteBar);
            if (palette) sideRail.appendChild(palette);
            workspaceRow.appendChild(sideRail);
        }

        if (guideBar) {
            guideBar.classList.add('is-floating-guide');
            stage.prepend(guideBar);
        }
        setupToastBanner(banner, stage);
        workspaceRow.appendChild(stage);

        container.append(topStrip, drawer, workspaceRow);

        // 캔버스 터치 시 / 바깥 클릭 시 / ESC 시 드로어 즉시 닫기
        stage.addEventListener('pointerdown', (e) => {
            if (!drawer.hidden && !e.target.closest('.guide-step-bar')) closeDrawer();
        });
        const onDocPointerDown = (e) => {
            if (!container.isConnected) {
                document.removeEventListener('pointerdown', onDocPointerDown);
                document.removeEventListener('keydown', onDocKeyDown);
                return;
            }
            if (drawer.hidden) return;
            if (container.contains(e.target) && (drawer.contains(e.target) || topStrip.contains(e.target))) return;
            closeDrawer();
        };
        const onDocKeyDown = (e) => {
            if (!container.isConnected) {
                document.removeEventListener('pointerdown', onDocPointerDown);
                document.removeEventListener('keydown', onDocKeyDown);
                return;
            }
            if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
        };
        document.addEventListener('pointerdown', onDocPointerDown);
        document.addEventListener('keydown', onDocKeyDown);
        container.closest('.worksheet-block')?.addEventListener('study:step-deactivated', closeDrawer);
    }

    window.StudyDrawChrome = { assemble };
})();
