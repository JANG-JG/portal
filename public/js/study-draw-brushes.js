/**
 * ==============================================================================
 * 확장 그림 스튜디오 특수 브러시 & 대칭 드로잉 엔진 (study-draw-brushes.js)
 * ------------------------------------------------------------------------------
 * - 5종 브러시: 🖍️ 크레파스 · 🌈 무지개 · ✨ 네온 · ⭐ 별가루 · 💧 수채화
 * - 🪞 대칭 데칼코마니: 중앙선 기준 좌우 동시 드로잉 지원
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    const BRUSH_TYPES = [
        { id: 'crayon', label: '🖍️ 크레파스' },
        { id: 'rainbow', label: '🌈 무지개' },
        { id: 'neon', label: '✨ 네온 야광' },
        { id: 'sparkle', label: '⭐ 별가루' },
        { id: 'watercolor', label: '💧 수채화' }
    ];

    function snapshotCanvas(canvas) {
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        if (copy.width > 0 && copy.height > 0) {
            copy.getContext('2d').drawImage(canvas, 0, 0);
        }
        return copy;
    }

    function restoreSnapshot(ctx, canvas, snap, applyStyleFn) {
        if (!ctx || !snap) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (typeof applyStyleFn === 'function') applyStyleFn();
    }

    function mirrorPoints(points, canvasLogicalWidth) {
        return points.map((pt) => [Math.max(0, canvasLogicalWidth - pt[0]), pt[1], pt[2]]);
    }

    function drawStarShape(ctx, cx, cy, outerR, color) {
        const innerR = outerR * 0.45;
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const angle = (Math.PI / 5) * i - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawSparkleBurst(ctx, x, y, width, seedIdx) {
        const colors = ['#facc15', '#f472b6', '#38bdf8', '#a78bfa', '#34d399', '#fb923c'];
        const count = width > 18 ? 4 : 3;
        for (let i = 0; i < count; i++) {
            const angle = ((seedIdx * 2.1 + i * 2.09) % (Math.PI * 2));
            const dist = ((seedIdx + i) % 3 + 0.6) * (width * 0.48);
            const sx = x + Math.cos(angle) * dist;
            const sy = y + Math.sin(angle) * dist;
            const radius = Math.max(3, (width * 0.24) + (i % 2) * 2);
            const col = colors[(seedIdx + i) % colors.length];
            if ((seedIdx + i) % 2 === 0) {
                drawStarShape(ctx, sx, sy, radius, col);
            } else {
                ctx.save();
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(sx, sy, radius * 0.58, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    }

    function drawNeonSegment(ctx, fromPt, toPt, hex, width) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = hex;
        ctx.shadowBlur = Math.max(12, width * 1.15);
        ctx.strokeStyle = hex;
        ctx.lineWidth = width + 4;
        ctx.beginPath();
        ctx.moveTo(fromPt[0], fromPt[1]);
        ctx.lineTo(toPt[0], toPt[1]);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.lineWidth = Math.max(3, width * 0.38);
        ctx.beginPath();
        ctx.moveTo(fromPt[0], fromPt[1]);
        ctx.lineTo(toPt[0], toPt[1]);
        ctx.stroke();
        ctx.restore();
    }

    function drawWatercolorSegment(ctx, fromPt, toPt, hex, width) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = hex;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = width * 1.65;
        ctx.beginPath();
        ctx.moveTo(fromPt[0], fromPt[1]);
        ctx.lineTo(toPt[0], toPt[1]);
        ctx.stroke();

        ctx.globalAlpha = 0.34;
        ctx.lineWidth = width * 0.95;
        ctx.beginPath();
        ctx.moveTo(fromPt[0], fromPt[1]);
        ctx.lineTo(toPt[0], toPt[1]);
        ctx.stroke();
        ctx.restore();
    }

    function drawRainbowSegment(ctx, fromPt, toPt, width, state) {
        const dx = toPt[0] - fromPt[0];
        const dy = toPt[1] - fromPt[1];
        const dist = Math.hypot(dx, dy);
        state.hue = ((state.hue || 0) + Math.max(3, dist * 0.85)) % 360;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = `hsl(${Math.round(state.hue)}, 92%, 55%)`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(fromPt[0], fromPt[1]);
        ctx.lineTo(toPt[0], toPt[1]);
        ctx.stroke();
        ctx.restore();
    }

    function paintSegmentWithMirror({ ctx, brushStyle, fromPt, toPt, hex, width, logicalW, mirror, state, strokeCount }) {
        const pairs = mirror && logicalW > 0
            ? [
                [fromPt, toPt],
                [
                    [Math.max(0, logicalW - fromPt[0]), fromPt[1], fromPt[2]],
                    [Math.max(0, logicalW - toPt[0]), toPt[1], toPt[2]]
                ]
            ]
            : [[fromPt, toPt]];

        for (const [p1, p2] of pairs) {
            if (brushStyle === 'neon') {
                drawNeonSegment(ctx, p1, p2, hex, width);
            } else if (brushStyle === 'watercolor') {
                drawWatercolorSegment(ctx, p1, p2, hex, width);
            } else if (brushStyle === 'rainbow') {
                drawRainbowSegment(ctx, p1, p2, width, state);
            } else if (brushStyle === 'sparkle') {
                drawSparkleBurst(ctx, p2[0], p2[1], width, (state.sparkSeq = (state.sparkSeq || 0) + 1) + strokeCount);
            } else {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = hex;
                ctx.lineWidth = width;
                ctx.beginPath();
                ctx.moveTo(p1[0], p1[1]);
                ctx.lineTo(p2[0], p2[1]);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    function createDrawSubbar({ onBrushChange, onMirrorChange }) {
        let brushStyle = 'crayon';
        let mirror = false;

        const bar = document.createElement('div');
        bar.className = 'draw-subbar no-print';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', '브러시 종류 및 대칭 그리기');

        const brushBtns = BRUSH_TYPES.map((b) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `draw-brush-pill${b.id === brushStyle ? ' active' : ''}`;
            btn.dataset.brushStyle = b.id;
            btn.setAttribute('aria-pressed', b.id === brushStyle ? 'true' : 'false');
            btn.textContent = b.label;
            btn.addEventListener('click', () => {
                brushStyle = b.id;
                syncUi();
                if (typeof onBrushChange === 'function') onBrushChange(brushStyle);
            });
            bar.appendChild(btn);
            return btn;
        });

        const mirrorBtn = document.createElement('button');
        mirrorBtn.type = 'button';
        mirrorBtn.className = 'draw-mirror-btn';
        mirrorBtn.setAttribute('aria-pressed', 'false');
        mirrorBtn.textContent = '🪞 대칭 그리기';
        mirrorBtn.addEventListener('click', () => {
            mirror = !mirror;
            syncUi();
            if (typeof onMirrorChange === 'function') onMirrorChange(mirror);
        });
        bar.appendChild(mirrorBtn);

        function syncUi() {
            brushBtns.forEach((b) => {
                const on = b.dataset.brushStyle === brushStyle;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            mirrorBtn.classList.toggle('active', mirror);
            mirrorBtn.setAttribute('aria-pressed', mirror ? 'true' : 'false');
        }

        return {
            el: bar,
            getBrushStyle: () => brushStyle,
            isMirror: () => mirror,
            setBrushStyle: (next) => { brushStyle = next || 'crayon'; syncUi(); },
            setMirror: (next) => { mirror = Boolean(next); syncUi(); }
        };
    }

    function resizeCanvasToWrap({ canvas, wrap, ctx, hasInk, applyStyle }) {
        if (!ctx || !canvas || !wrap) return;
        const rect = wrap.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.max(200, Math.floor(rect.width * dpr));
        const targetH = Math.max(140, Math.floor(rect.height * dpr));
        if (targetW === canvas.width && targetH === canvas.height) return;
        const snap = (canvas.width > 0 && canvas.height > 0 && hasInk) ? snapshotCanvas(canvas) : null;
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (snap) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(snap, 0, 0, rect.width, rect.height);
        }
        if (typeof applyStyle === 'function') applyStyle();
    }

    window.StudyDrawBrushes = {
        BRUSH_TYPES,
        snapshotCanvas,
        restoreSnapshot,
        resizeCanvasToWrap,
        mirrorPoints,
        paintSegmentWithMirror,
        createDrawSubbar
    };
})();
