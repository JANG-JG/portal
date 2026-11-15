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

    const CRAYONS = [
        { name: '빨강', hex: '#ef4444' },
        { name: '주황', hex: '#fb923c' },
        { name: '노랑', hex: '#facc15' },
        { name: '초록', hex: '#22c55e' },
        { name: '파랑', hex: '#3b82f6' },
        { name: '보라', hex: '#a855f7' },
        { name: '분홍', hex: '#f472b6' },
        { name: '하양', hex: '#ffffff' }
    ];

    /**
     * 도안 검은 윤곽선과 표정만 투명 채우기로 복제해 캔버스 위에 얹는다.
     */
    function buildOutlineOverlay(svgEl) {
        if (!svgEl) return null;
        const clone = svgEl.cloneNode(true);
        clone.classList.add('coloring-outline-svg');
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('[data-color-part]').forEach((el) => el.removeAttribute('data-color-part'));
        clone.querySelectorAll('path, rect, circle, ellipse, polygon, polyline').forEach((el) => {
            if ((el.getAttribute('fill') || '').toLowerCase() === '#ffffff') {
                el.setAttribute('fill', 'none');
            }
        });
        return clone;
    }

    function fillFreehandStroke(ctx, rawPoints, hex, baseSize, useRealPressure) {
        if (!ctx || !rawPoints.length || !window.PerfectFreehand) return false;
        const pts = window.PerfectFreehand.getStroke(rawPoints, {
            size: baseSize,
            thinning: useRealPressure ? 0.65 : 0.35,
            smoothing: 0.55,
            streamline: 0.45,
            simulatePressure: !useRealPressure
        });
        if (!pts.length) return false;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = hex;
        ctx.beginPath();
        const len = pts.length;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < len - 1; i++) {
            const [x0, y0] = pts[i];
            const [x1, y1] = pts[i + 1];
            ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return true;
    }

    function snapshotCanvas(canvas) {
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        if (copy.width > 0 && copy.height > 0) {
            copy.getContext('2d').drawImage(canvas, 0, 0);
        }
        return copy;
    }

    /**
     * 색칠 놀이 블록을 렌더링한다 (톡 채우기 + S펜 필압 색칠 + 되돌리기 + 앨범 자랑).
     */
    function renderColorBlock(container, blk, speakFn, toastFn, sheetMeta) {
        let activeHex = CRAYONS[0].hex;
        let activeMode = 'fill';
        let lastPaintMode = 'fill';
        let brushWidth = 14;
        let paintedCount = 0;
        let strokeCount = 0;
        let cheered = false;
        let hasCanvasInk = false;
        let drawing = false;
        let activePoints = [];
        let activeUsesPen = false;
        let preStrokeSnapshot = null;
        const MAX_UNDO = 15;
        const undoStack = [];
        const defaultHint = blk.hint || '원하는 색연필을 고른 뒤 그림 안을 톡톡 눌러 보세요!';

        const modeBar = document.createElement('div');
        modeBar.className = 'color-toolbar no-print';
        modeBar.setAttribute('role', 'group');
        modeBar.setAttribute('aria-label', '색칠 도구 선택');

        const modes = [
            { id: 'fill', label: '🪄 톡 채우기' },
            { id: 'brush', label: '🖍️ 쓱쓱 색칠' },
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

        const stage = document.createElement('div');
        stage.className = 'coloring-stage';
        const wrap = document.createElement('div');
        wrap.className = 'coloring-canvas-wrap';
        wrap.dataset.colorMode = activeMode;
        wrap.innerHTML = window.StudyIllustrations
            ? window.StudyIllustrations.getColoringSvg(blk.templateId || 'dino')
            : '<p>색칠 도안을 불러오지 못했어요.</p>';

        const baseSvg = wrap.querySelector('.coloring-svg');
        const canvas = document.createElement('canvas');
        canvas.className = 'coloring-draw-canvas';
        canvas.setAttribute('aria-label', '자유 색칠 영역');
        wrap.appendChild(canvas);
        const outlineSvg = buildOutlineOverlay(baseSvg);
        if (outlineSvg) wrap.appendChild(outlineSvg);
        stage.appendChild(wrap);

        const banner = document.createElement('p');
        banner.className = 'play-feedback';
        banner.textContent = defaultHint;

        const ctx = canvas.getContext('2d');
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
            sizeGroup.classList.toggle('is-muted', activeMode === 'fill');
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
                else if (nextMode === 'brush') banner.textContent = '손가락이나 펜으로 그림 위를 쓱쓱 문질러 색칠해 보세요! 🖍️';
                else banner.textContent = '지우고 싶은 부분을 쓱쓱 문질러 지울 수 있어요! 🧽';
            }
        };

        modeBtns.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.colorMode)));
        sizeBtns.forEach((btn) => btn.addEventListener('click', () => {
            brushWidth = Number(btn.dataset.brushSize) || 14;
            if (activeMode === 'fill') setMode('brush');
            else syncBrushUi();
        }));

        CRAYONS.forEach((c, idx) => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = `color-swatch${idx === 0 ? ' active' : ''}`;
            sw.style.backgroundColor = c.hex;
            sw.setAttribute('aria-label', `${c.name} 색연필`);
            sw.title = c.name;
            sw.addEventListener('click', () => {
                activeHex = c.hex;
                palette.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('active', b === sw));
                if (activeMode === 'eraser') setMode(lastPaintMode === 'fill' ? 'brush' : lastPaintMode);
                else applyCanvasStyle();
            });
            palette.appendChild(sw);
        });

        const resizeCanvas = () => {
            if (!ctx) return;
            const rect = wrap.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const targetW = Math.max(200, Math.floor(rect.width * dpr));
            const targetH = Math.max(140, Math.floor(rect.height * dpr));
            if (targetW === canvas.width && targetH === canvas.height) return;
            let snapshot = null;
            if (canvas.width > 0 && canvas.height > 0 && hasCanvasInk) {
                snapshot = document.createElement('canvas');
                snapshot.width = canvas.width;
                snapshot.height = canvas.height;
                snapshot.getContext('2d').drawImage(canvas, 0, 0);
            }
            canvas.width = targetW;
            canvas.height = targetH;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (snapshot) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(snapshot, 0, 0, rect.width, rect.height);
            }
            applyCanvasStyle();
        };
        requestAnimationFrame(resizeCanvas);
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(resizeCanvas).observe(wrap);
        } else {
            window.addEventListener('resize', resizeCanvas);
        }

        const syncUndoBtn = () => { undoBtn.disabled = undoStack.length === 0; };
        const pushUndo = (entry) => {
            undoStack.push(entry);
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            syncUndoBtn();
        };

        const triggerPraise = () => {
            if (cheered) return;
            cheered = true;
            banner.style.color = '#047857';
            banner.textContent = '우와, 색감이 정말 예뻐요! 계속 멋지게 칠해 보세요 🎨';
            if (window.StudyFx) window.StudyFx.correct();
            if (speakFn) speakFn('우와! 정말 예쁘게 칠하고 있네요!', 'ko-KR');
        };

        const getPos = (e) => {
            const r = canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const getPointerPressure = (e) => {
            if (!e) return { pressure: 0.5, isPen: false };
            const isPen = e.pointerType === 'pen';
            const raw = typeof e.pressure === 'number' && e.pressure > 0 ? e.pressure : 0.5;
            return { pressure: isPen ? Math.min(1, Math.max(0.08, raw)) : 0.5, isPen };
        };
        const restoreSnapshot = (snap) => {
            if (!ctx || !snap) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);
            ctx.restore();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            applyCanvasStyle();
        };

        let prevInkForStroke = false;
        const beginStroke = (p, e) => {
            drawing = true;
            prevInkForStroke = hasCanvasInk;
            preStrokeSnapshot = snapshotCanvas(canvas);
            const { pressure, isPen } = getPointerPressure(e);
            activeUsesPen = isPen;
            activePoints = [[p.x, p.y, pressure]];

            if (activeMode === 'brush') {
                hasCanvasInk = true;
                strokeCount += 1;
                if (strokeCount >= 4) triggerPraise();
            }
            if (activeMode === 'brush' && window.PerfectFreehand) {
                fillFreehandStroke(ctx, activePoints, activeHex, brushWidth, activeUsesPen);
                return;
            }
            applyCanvasStyle();
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 0.01, p.y + 0.01);
            ctx.stroke();
        };
        const moveStroke = (p, e) => {
            if (!drawing || !ctx) return;
            if (activeMode === 'brush' && window.PerfectFreehand && preStrokeSnapshot) {
                const { pressure } = getPointerPressure(e);
                activePoints.push([p.x, p.y, pressure]);
                restoreSnapshot(preStrokeSnapshot);
                fillFreehandStroke(ctx, activePoints, activeHex, brushWidth, activeUsesPen);
                return;
            }
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };
        const endDraw = () => {
            if (!drawing) return;
            drawing = false;
            if (preStrokeSnapshot) {
                pushUndo({ kind: 'canvas', snapshot: preStrokeSnapshot, prevInk: prevInkForStroke });
                preStrokeSnapshot = null;
            }
            activePoints = [];
        };

        if (window.StudyTablet && typeof window.StudyTablet.bindDrawingCanvas === 'function') {
            window.StudyTablet.bindDrawingCanvas(canvas, {
                canStart: () => Boolean(ctx) && activeMode !== 'fill',
                getPos,
                onStart: beginStroke,
                onMove: moveStroke,
                onEnd: endDraw,
                onResize: resizeCanvas
            });
        } else {
            canvas.addEventListener('pointerdown', (e) => {
                if (!ctx || activeMode === 'fill' || e.isPrimary === false) return;
                canvas.setPointerCapture(e.pointerId);
                beginStroke(getPos(e), e);
            });
            canvas.addEventListener('pointermove', (e) => moveStroke(getPos(e), e));
            canvas.addEventListener('pointerup', endDraw);
            canvas.addEventListener('pointercancel', endDraw);
        }

        const parts = baseSvg ? baseSvg.querySelectorAll('[data-color-part]') : [];
        parts.forEach((part) => {
            part.addEventListener('click', () => {
                if (activeMode !== 'fill') return;
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

        undoBtn.addEventListener('click', () => {
            const item = undoStack.pop();
            syncUndoBtn();
            if (!item) return;
            if (window.StudyFx) window.StudyFx.tap();
            if (item.kind === 'fill' && item.part) {
                item.part.setAttribute('fill', item.prevFill || '#ffffff');
                const wasPainted = Boolean(item.part.dataset.painted);
                if (item.prevPainted && !wasPainted) {
                    item.part.dataset.painted = '1';
                    paintedCount += 1;
                } else if (!item.prevPainted && wasPainted) {
                    delete item.part.dataset.painted;
                    paintedCount = Math.max(0, paintedCount - 1);
                }
            } else if (item.kind === 'canvas' && item.snapshot) {
                restoreSnapshot(item.snapshot);
                hasCanvasInk = Boolean(item.prevInk);
            }
            banner.style.color = '#475569';
            banner.textContent = '방금 칠한 것을 한 단계 되돌렸어요! ↩️';
        });

        clearBtn.addEventListener('click', () => {
            parts.forEach((p) => {
                p.setAttribute('fill', '#ffffff');
                delete p.dataset.painted;
            });
            if (ctx) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
            }
            undoStack.length = 0;
            syncUndoBtn();
            paintedCount = 0;
            strokeCount = 0;
            cheered = false;
            hasCanvasInk = false;
            applyCanvasStyle();
            if (window.StudyFx) window.StudyFx.tap();
            banner.style.color = '#64748b';
            banner.textContent = '깨끗해졌어요! 다시 예쁘게 칠해 보아요 🎨';
        });

        const artworkBar = document.createElement('div');
        artworkBar.className = 'color-artwork-actions no-print';
        if (window.StudyArtwork && typeof window.StudyArtwork.createShareControl === 'function') {
            window.StudyArtwork.createShareControl({
                actionsBar: artworkBar,
                toastFn,
                speakFn,
                getContext: () => ({
                    baseSvg,
                    drawCanvas: canvas,
                    outlineSvg,
                    childId: sheetMeta?.child_id || 'first',
                    childName: sheetMeta?.child_name || '',
                    sheetId: sheetMeta?.id || 0,
                    templateId: blk.templateId || '',
                    title: blk.title || sheetMeta?.title || '내가 칠한 그림',
                    hasAnyPaint: paintedCount > 0 || hasCanvasInk,
                    onSaved: (art) => {
                        banner.style.color = '#047857';
                        banner.textContent = art?.albumStatus === 'shared'
                            ? '🎉 멋지게 완성! 가족앨범에도 내 그림을 자랑했어요!'
                            : '🖼️ 내 그림을 학습실에 예쁘게 보관했어요!';
                    }
                })
            });
        }

        syncBrushUi();
        syncUndoBtn();
        container.appendChild(modeBar);
        container.appendChild(palette);
        container.appendChild(stage);
        container.appendChild(banner);
        if (artworkBar.children.length > 0) container.appendChild(artworkBar);
    }

    window.StudyColorBlock = {
        renderColorBlock
    };
})();
