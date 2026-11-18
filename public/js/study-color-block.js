/**
 * ==============================================================================
 * 유아 학습지 색칠 놀이 블록 렌더러 (study-color-block.js)
 * ------------------------------------------------------------------------------
 * - 🪄 톡 채우기: 도안 부위([data-color-part]) 원터치 채우기
 * - 🖍️ 쓱쓱 색칠: SVG 도안 위 자유 캔버스 드로잉 (검은 선화는 최상단 유지)
 * - 🧽 지우개 / 🧹 다시 칠하기 / 굵기(보통·굵게) 지원
 * ==============================================================================
 */

(function () {
    'use strict';

    const CRAYONS = window.StudyColorFlood?.DEFAULT_CRAYONS || [
        { name: '빨강', hex: '#ef4444' },
        { name: '노랑', hex: '#facc15' },
        { name: '파랑', hex: '#3b82f6' }
    ];

    const buildOutlineOverlay = (svgEl) => window.StudyColorFlood?.buildOutlineOverlay?.(svgEl) || null;

    function fillFreehandStroke(ctx, rawPoints, hex, baseSize, useRealPressure) {
        return window.StudyTablet?.drawFreehandStroke?.(ctx, rawPoints, hex, baseSize, useRealPressure) || false;
    }

    function snapshotCanvas(canvas) {
        if (window.StudyDrawBrushes?.snapshotCanvas) return window.StudyDrawBrushes.snapshotCanvas(canvas);
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        if (copy.width > 0 && copy.height > 0) copy.getContext('2d').drawImage(canvas, 0, 0);
        return copy;
    }

    /**
     * 색칠 놀이 블록을 렌더링한다 (톡 채우기 + 특수 브러시 + 대칭 + 스티커 + 특수 모드).
     */
    function renderColorBlock(container, blk, speakFn, toastFn, sheetMeta) {
        const studioKind = String(blk?.studioKind || '');
        const supportsFill = studioKind !== 'free' && studioKind !== 'guide';
        let activeHex = CRAYONS[0].hex;
        let activeMode = blk?.defaultTool || (supportsFill ? 'fill' : 'brush');
        if (!supportsFill && activeMode === 'fill') activeMode = 'brush';
        let lastPaintMode = activeMode === 'eraser' || activeMode === 'sticker' ? 'brush' : activeMode;
        let brushWidth = 14;
        let brushStyle = 'crayon';
        let mirrorEnabled = false;
        const brushRunState = { hue: 0, sparkSeq: 0 };
        let paintedCount = 0;
        let strokeCount = 0;
        let cheered = false;
        let hasCanvasInk = false;
        let drawing = false;
        let activePoints = [];
        let lastPoint = null;
        let activeUsesPen = false;
        let preStrokeSnapshot = null;
        const MAX_UNDO = 15;
        const undoStack = [];
        const defaultHint = blk.hint || (supportsFill ? '원하는 색연필을 고른 뒤 그림 안을 톡톡 눌러 보세요!' : '브러시와 스티커로 자유롭게 그림을 그려 보세요!');

        const modeBar = document.createElement('div');
        modeBar.className = 'color-toolbar no-print';
        modeBar.setAttribute('role', 'group');
        modeBar.setAttribute('aria-label', '색칠 도구 선택');

        const modes = [
            ...(supportsFill ? [{ id: 'fill', label: '🪄 톡 채우기' }] : []),
            { id: 'brush', label: '🖍️ 쓱쓱 그리기' },
            { id: 'sticker', label: '🏷️ 스티커' },
            { id: 'eraser', label: '🧽 지우개' }
        ];
        const modeBtns = modes.map((m) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `study-btn color-tool-btn${m.id === activeMode ? ' active' : ''}`;
            btn.dataset.colorMode = m.id;
            btn.setAttribute('aria-pressed', m.id === activeMode ? 'true' : 'false');
            btn.textContent = m.label;
            modeBar.appendChild(btn);
            return btn;
        });

        const sizeGroup = document.createElement('div');
        sizeGroup.className = 'color-size-group';
        sizeGroup.setAttribute('role', 'group');
        sizeGroup.setAttribute('aria-label', '색연필 굵기');
        const sizeBtns = [
            { size: 12, label: '보통', cls: 'size-md' },
            { size: 24, label: '굵게', cls: 'size-lg' }
        ].map((s) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `color-size-btn${s.size === brushWidth ? ' active' : ''}`;
            btn.dataset.brushSize = String(s.size);
            btn.setAttribute('aria-label', `색연필 ${s.label}`);
            btn.title = s.label;
            btn.innerHTML = `<span class="color-size-dot ${s.cls}" aria-hidden="true"></span>`;
            sizeGroup.appendChild(btn);
            return btn;
        });
        modeBar.appendChild(sizeGroup);

        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'study-btn study-btn-outline color-undo-btn';
        undoBtn.textContent = '↩️ 되돌리기';
        undoBtn.disabled = true;
        modeBar.appendChild(undoBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'study-btn study-btn-outline play-reset-btn';
        clearBtn.textContent = '🧹 다시 칠하기';
        modeBar.appendChild(clearBtn);

        const palette = document.createElement('div');
        palette.className = 'color-palette no-print';
        palette.setAttribute('role', 'group');
        palette.setAttribute('aria-label', '색연필 고르기');
        const recPaletteBar = document.createElement('div');
        recPaletteBar.className = 'pokemon-rec-palette no-print';
        recPaletteBar.hidden = true;

        const stage = document.createElement('div');
        stage.className = 'coloring-stage';
        const wrap = document.createElement('div');
        wrap.className = 'coloring-canvas-wrap';
        wrap.dataset.colorMode = activeMode;

        const canvas = document.createElement('canvas');
        canvas.className = 'coloring-draw-canvas';
        canvas.setAttribute('aria-label', '자유 색칠 영역');
        const hintHost = document.createElement('div');
        hintHost.className = 'pokemon-hint-host';
        const mirrorGuideEl = document.createElement('div');
        mirrorGuideEl.className = 'draw-mirror-guide no-print';
        mirrorGuideEl.hidden = true;
        const drawSubbar = window.StudyDrawBrushes?.createDrawSubbar?.({
            onBrushChange: (style) => {
                brushStyle = style || 'crayon';
                if (activeMode !== 'brush') setMode('brush');
            },
            onMirrorChange: (on) => {
                mirrorEnabled = Boolean(on);
                mirrorGuideEl.hidden = !mirrorEnabled;
            }
        });
        const stickerTray = window.StudyDrawStickers?.createStickerTray?.({
            childId: sheetMeta?.child_id || 'first',
            onPick: () => { if (activeMode !== 'sticker') setMode('sticker'); }
        });

        let cbnCtrl = null;
        let guideCtrl = null;
        let baseSvg = null;
        let outlineSvg = null;
        let parts = [];
        let floodSession = null;
        const isPokemonSheet = Number(blk?.pokemonId) > 0 && window.StudyPokemonColoring;
        if (studioKind) wrap.dataset.studioKind = studioKind;

        const banner = document.createElement('p');
        banner.className = 'play-feedback';
        banner.textContent = defaultHint;

        if (!isPokemonSheet) {
            if (window.StudyDrawModes?.mountStudioSvg) {
                const mounted = window.StudyDrawModes.mountStudioSvg({
                    wrap, canvas, blk, studioKind, buildOutlineOverlay,
                    selectColor: (hex, sw) => selectColor(hex, sw), palette, speakFn, banner
                });
                baseSvg = mounted.baseSvg;
                outlineSvg = mounted.outlineSvg;
                cbnCtrl = mounted.cbnCtrl;
                guideCtrl = mounted.guideCtrl;
            } else {
                wrap.innerHTML = window.StudyIllustrations
                    ? window.StudyIllustrations.getColoringSvg(blk.templateId || 'dino')
                    : '<p>색칠 도안을 불러오지 못했어요.</p>';
                baseSvg = wrap.querySelector('.coloring-svg');
                wrap.appendChild(canvas);
                outlineSvg = buildOutlineOverlay(baseSvg);
                if (outlineSvg) wrap.appendChild(outlineSvg);
            }
        }
        wrap.appendChild(mirrorGuideEl);
        stage.appendChild(wrap);

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const applyCanvasStyle = () => {
            if (!ctx) return;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (activeMode === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
                ctx.lineWidth = brushWidth + 10;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = activeHex;
                ctx.lineWidth = brushWidth;
            }
        };

        const syncBrushUi = () => {
            sizeGroup.classList.toggle('is-muted', activeMode === 'fill' || activeMode === 'sticker');
            sizeBtns.forEach((b) => {
                const on = Number(b.dataset.brushSize) === brushWidth;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            modeBtns.forEach((b) => {
                const on = b.dataset.colorMode === activeMode;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            if (drawSubbar) drawSubbar.el.hidden = activeMode === 'fill' || activeMode === 'eraser';
            if (stickerTray) stickerTray.setVisible(activeMode === 'sticker');
            wrap.dataset.colorMode = activeMode;
            applyCanvasStyle();
        };

        const setMode = (nextMode, keepHint) => {
            activeMode = nextMode;
            if (nextMode === 'fill' || nextMode === 'brush') lastPaintMode = nextMode;
            syncBrushUi();
            if (!keepHint) {
                banner.style.color = '#475569';
                if (nextMode === 'fill') banner.textContent = defaultHint;
                else if (nextMode === 'sticker') banner.textContent = '아래에서 스티커를 고른 뒤 그림 위를 톡톡 찍어 꾸며 보세요! 🏷️';
                else if (nextMode === 'brush') banner.textContent = mirrorEnabled ? '🪞 대칭 모드! 가운데를 기준으로 양쪽이 똑같이 그려져요!' : '손가락이나 펜으로 그림 위를 쓱쓱 문질러 그려 보세요! 🖍️';
                else banner.textContent = '지우고 싶은 부분을 쓱쓱 문질러 지울 수 있어요! 🧽';
            }
        };

        modeBtns.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.colorMode)));
        sizeBtns.forEach((btn) => btn.addEventListener('click', () => {
            brushWidth = Number(btn.dataset.brushSize) || 14;
            if (activeMode === 'fill') setMode('brush');
            else syncBrushUi();
        }));

        const selectColor = (hex, activeSw) => {
            activeHex = hex;
            palette.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('active', b === activeSw));
            recPaletteBar.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('active', b === activeSw));
            cbnCtrl?.syncActiveHex?.(hex);
            if (activeMode === 'eraser' || activeMode === 'sticker') setMode(lastPaintMode === 'fill' && supportsFill ? 'brush' : lastPaintMode);
            else applyCanvasStyle();
        };

        CRAYONS.forEach((c, idx) => {
            const sw = Object.assign(document.createElement('button'), { type: 'button', className: `color-swatch${idx === 0 ? ' active' : ''}`, title: c.name });
            sw.dataset.hex = c.hex;
            sw.style.backgroundColor = c.hex;
            sw.setAttribute('aria-label', `${c.name} 색연필`);
            sw.addEventListener('click', () => selectColor(c.hex, sw));
            palette.appendChild(sw);
        });

        const resizeCanvas = () => window.StudyDrawBrushes?.resizeCanvasToWrap?.({ canvas, wrap, ctx, hasInk: hasCanvasInk, applyStyle: applyCanvasStyle });
        requestAnimationFrame(resizeCanvas);
        if (typeof ResizeObserver === 'function') new ResizeObserver(resizeCanvas).observe(wrap);
        else window.addEventListener('resize', resizeCanvas);

        const syncUndoBtn = () => { undoBtn.disabled = undoStack.length === 0; };
        const pushUndo = (entry) => { undoStack.push(entry); if (undoStack.length > MAX_UNDO) undoStack.shift(); syncUndoBtn(); };
        const triggerPraise = () => {
            if (cheered) return;
            cheered = true;
            banner.style.color = '#047857';
            banner.textContent = '우와, 색감이 정말 예뻐요! 계속 멋지게 칠해 보세요 🎨';
            if (window.StudyFx) window.StudyFx.correct();
            if (speakFn) speakFn('우와! 정말 예쁘게 칠하고 있네요!', 'ko-KR');
        };
        const getPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
        const getPointerPressure = (e) => {
            if (!e) return { pressure: 0.5, isPen: false };
            const isPen = e.pointerType === 'pen';
            const raw = typeof e.pressure === 'number' && e.pressure > 0 ? e.pressure : 0.5;
            return { pressure: isPen ? Math.min(1, Math.max(0.08, raw)) : 0.5, isPen };
        };
        const restoreSnapshot = (snap) => window.StudyDrawBrushes?.restoreSnapshot?.(ctx, canvas, snap, applyCanvasStyle);

        let prevInkForStroke = false;
        const beginStroke = (p, e) => {
            prevInkForStroke = hasCanvasInk;
            preStrokeSnapshot = snapshotCanvas(canvas);
            if (activeMode === 'sticker' && window.StudyDrawStickers && stickerTray) {
                hasCanvasInk = true;
                strokeCount += 1;
                if (strokeCount >= 4) triggerPraise();
                if (window.StudyFx) window.StudyFx.crayon();
                const snapForUndo = preStrokeSnapshot;
                preStrokeSnapshot = null;
                window.StudyDrawStickers.stampStickerOnCanvas({
                    ctx, x: p.x, y: p.y, sticker: stickerTray.getCurrentSticker(),
                    sizeMode: stickerTray.getSizeMode(), logicalW: p.w, mirror: mirrorEnabled
                }).then(() => pushUndo({ kind: 'canvas', snapshot: snapForUndo, prevInk: prevInkForStroke }));
                return;
            }
            drawing = true;
            const { pressure, isPen } = getPointerPressure(e);
            activeUsesPen = isPen;
            activePoints = [[p.x, p.y, pressure]];
            lastPoint = [p.x, p.y, pressure];
            if (activeMode === 'brush') {
                hasCanvasInk = true;
                strokeCount += 1;
                if (strokeCount >= 4) triggerPraise();
                if (brushStyle !== 'crayon' && window.StudyDrawBrushes) {
                    window.StudyDrawBrushes.paintSegmentWithMirror({ ctx, brushStyle, fromPt: lastPoint, toPt: [p.x + 0.01, p.y + 0.01, pressure], hex: activeHex, width: brushWidth, logicalW: p.w, mirror: mirrorEnabled, state: brushRunState, strokeCount });
                    return;
                }
                if (window.PerfectFreehand) {
                    fillFreehandStroke(ctx, activePoints, activeHex, brushWidth, activeUsesPen);
                    if (mirrorEnabled && window.StudyDrawBrushes) fillFreehandStroke(ctx, window.StudyDrawBrushes.mirrorPoints(activePoints, p.w), activeHex, brushWidth, activeUsesPen);
                    return;
                }
            }
            applyCanvasStyle();
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y + 0.01); ctx.stroke();
        };
        const moveStroke = (p, e) => {
            if (!drawing || !ctx) return;
            const { pressure } = getPointerPressure(e);
            const curPt = [p.x, p.y, pressure];
            if (activeMode === 'brush' && brushStyle !== 'crayon' && window.StudyDrawBrushes) {
                window.StudyDrawBrushes.paintSegmentWithMirror({ ctx, brushStyle, fromPt: lastPoint || curPt, toPt: curPt, hex: activeHex, width: brushWidth, logicalW: p.w, mirror: mirrorEnabled, state: brushRunState, strokeCount });
                lastPoint = curPt;
                return;
            }
            if (activeMode === 'brush' && window.PerfectFreehand && preStrokeSnapshot) {
                activePoints.push(curPt);
                restoreSnapshot(preStrokeSnapshot);
                fillFreehandStroke(ctx, activePoints, activeHex, brushWidth, activeUsesPen);
                if (mirrorEnabled && window.StudyDrawBrushes) fillFreehandStroke(ctx, window.StudyDrawBrushes.mirrorPoints(activePoints, p.w), activeHex, brushWidth, activeUsesPen);
                return;
            }
            applyCanvasStyle();
            ctx.beginPath(); ctx.moveTo(lastPoint ? lastPoint[0] : p.x, lastPoint ? lastPoint[1] : p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
            if (mirrorEnabled && p.w > 0 && lastPoint) {
                ctx.beginPath(); ctx.moveTo(p.w - lastPoint[0], lastPoint[1]); ctx.lineTo(p.w - p.x, p.y); ctx.stroke();
            }
            lastPoint = curPt;
        };
        const endDraw = () => {
            if (!drawing) return;
            drawing = false;
            lastPoint = null;
            if (preStrokeSnapshot) {
                pushUndo({ kind: 'canvas', snapshot: preStrokeSnapshot, prevInk: prevInkForStroke });
                preStrokeSnapshot = null;
            }
            activePoints = [];
        };

        if (window.StudyTablet && typeof window.StudyTablet.bindDrawingCanvas === 'function') {
            window.StudyTablet.bindDrawingCanvas(canvas, { canStart: () => Boolean(ctx) && activeMode !== 'fill', getPos, onStart: beginStroke, onMove: moveStroke, onEnd: endDraw, onResize: resizeCanvas });
        } else {
            canvas.addEventListener('pointerdown', (e) => { if (ctx && activeMode !== 'fill' && e.isPrimary !== false) { canvas.setPointerCapture(e.pointerId); beginStroke(getPos(e), e); } });
            canvas.addEventListener('pointermove', (e) => moveStroke(getPos(e), e));
            canvas.addEventListener('pointerup', endDraw);
            canvas.addEventListener('pointercancel', endDraw);
        }

        const bindParts = (targetParts) => {
            targetParts.forEach((part) => {
                part.addEventListener('click', () => {
                    if (activeMode !== 'fill') return;
                    if (cbnCtrl?.validateTap && !cbnCtrl.validateTap(part, activeHex)) return;
                    const prevFill = part.getAttribute('fill') || '#ffffff';
                    const prevPainted = Boolean(part.dataset.painted);
                    if (prevFill === activeHex && (activeHex === '#ffffff' || prevPainted)) return;

                    pushUndo({ kind: 'fill', part, prevFill, prevPainted });
                    part.setAttribute('fill', activeHex);
                    if (window.StudyFx) window.StudyFx.crayon();
                    if (activeHex !== '#ffffff' && !part.dataset.painted) {
                        part.dataset.painted = '1';
                        paintedCount += 1;
                        if (paintedCount === 3) triggerPraise();
                    } else if (activeHex === '#ffffff' && part.dataset.painted) {
                        delete part.dataset.painted;
                        paintedCount = Math.max(0, paintedCount - 1);
                    }
                });
            });
        };

        window.StudyColorFlood?.bindCanvasTapFill?.(canvas, {
            canFill: () => activeMode === 'fill' && Boolean(floodSession),
            getSession: () => floodSession,
            getHex: () => activeHex,
            onBeforeFill: () => ({ snap: snapshotCanvas(canvas), prevInk: hasCanvasInk }),
            onAfterFill: (info) => {
                if (info?.snap) pushUndo({ kind: 'canvas', snapshot: info.snap, prevInk: info.prevInk });
                if (activeHex !== '#ffffff') { hasCanvasInk = true; paintedCount += 1; if (paintedCount === 3) triggerPraise(); }
                if (window.StudyFx) window.StudyFx.crayon();
            }
        });

        const hydrateSvg = (svgEl) => {
            baseSvg = svgEl;
            if (!canvas.parentElement) wrap.appendChild(canvas);
            if (outlineSvg) outlineSvg.remove();
            outlineSvg = buildOutlineOverlay(baseSvg);
            if (outlineSvg) wrap.appendChild(outlineSvg);
            const useFlood = baseSvg?.dataset?.fillMode === 'flood' && window.StudyColorFlood?.createFloodFillSession;
            wrap.dataset.fillEngine = useFlood ? 'flood' : 'svg';
            window.StudyColorFlood?.renderRecommendedPalette?.(recPaletteBar, baseSvg, selectColor);
            if (useFlood) {
                parts = [];
                floodSession = window.StudyColorFlood.createFloodFillSession(baseSvg, canvas);
                requestAnimationFrame(() => { resizeCanvas(); floodSession?.ensureMask?.(); });
            } else {
                floodSession = null;
                parts = baseSvg ? Array.from(baseSvg.querySelectorAll('[data-color-part]')) : [];
                bindParts(parts);
                requestAnimationFrame(resizeCanvas);
            }
        };

        if (isPokemonSheet) {
            window.StudyPokemonColoring.mountPokemonColoringSvg({ wrap, blk, hintHost, onSvgReady: hydrateSvg });
        } else {
            parts = baseSvg ? Array.from(baseSvg.querySelectorAll('[data-color-part]')) : [];
            bindParts(parts);
        }

        undoBtn.addEventListener('click', () => {
            const item = undoStack.pop();
            syncUndoBtn();
            if (!item) return;
            if (window.StudyFx) window.StudyFx.tap();
            if (item.kind === 'fill' && item.part) {
                item.part.setAttribute('fill', item.prevFill || '#ffffff');
                const wasPainted = Boolean(item.part.dataset.painted);
                if (item.prevPainted && !wasPainted) { item.part.dataset.painted = '1'; paintedCount += 1; }
                else if (!item.prevPainted && wasPainted) { delete item.part.dataset.painted; paintedCount = Math.max(0, paintedCount - 1); }
            } else if (item.kind === 'canvas' && item.snapshot) {
                restoreSnapshot(item.snapshot);
                hasCanvasInk = Boolean(item.prevInk);
            }
            banner.style.color = '#475569';
            banner.textContent = '방금 칠한 것을 한 단계 되돌렸어요! ↩️';
        });

        clearBtn.addEventListener('click', () => {
            parts.forEach((p) => { p.setAttribute('fill', '#ffffff'); delete p.dataset.painted; });
            if (ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
            undoStack.length = 0;
            syncUndoBtn();
            paintedCount = 0; strokeCount = 0; cheered = false; hasCanvasInk = false;
            applyCanvasStyle();
            if (window.StudyFx) window.StudyFx.tap();
            banner.style.color = '#64748b';
            banner.textContent = '깨끗해졌어요! 다시 예쁘게 칠해 보아요 🎨';
        });

        const artworkBar = document.createElement('div');
        artworkBar.className = 'color-artwork-actions no-print';
        if (window.StudyArtwork && typeof window.StudyArtwork.createShareControl === 'function') {
            window.StudyArtwork.createShareControl({
                actionsBar: artworkBar, toastFn, speakFn,
                getContext: () => ({
                    baseSvg: studioKind === 'guide' ? (wrap.querySelector('.coloring-svg') || baseSvg) : baseSvg,
                    drawCanvas: canvas, outlineSvg,
                    childId: sheetMeta?.child_id || 'first', childName: sheetMeta?.child_name || '',
                    sheetId: sheetMeta?.id || 0, templateId: blk.templateId || '',
                    title: blk.templateTitle || blk.title || sheetMeta?.title || '내가 칠한 그림',
                    hasAnyPaint: paintedCount > 0 || hasCanvasInk,
                    onSaved: (art) => {
                        banner.style.color = '#047857';
                        banner.textContent = art?.albumStatus === 'shared' ? '🎉 멋지게 완성! 가족앨범에도 내 그림을 자랑했어요!' : '🖼️ 내 그림을 학습실에 예쁘게 보관했어요!';
                    }
                })
            });
        }

        syncBrushUi();
        syncUndoBtn();
        const nodes = [modeBar];
        if (drawSubbar?.el) nodes.push(drawSubbar.el);
        if (stickerTray?.el) nodes.push(stickerTray.el);
        if (cbnCtrl?.legendBar) nodes.push(cbnCtrl.legendBar);
        if (guideCtrl?.bar) nodes.push(guideCtrl.bar);
        nodes.push(recPaletteBar, palette, stage, banner);
        if (isPokemonSheet) nodes.push(hintHost);
        if (artworkBar.children.length > 0) nodes.push(artworkBar);
        container.append(...nodes);
    }

    window.StudyColorBlock = { renderColorBlock };
})();
