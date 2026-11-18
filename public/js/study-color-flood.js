/**
 * ==============================================================================
 * 유아 색칠 놀이 스마트 선화 오버레이 & 톡 채우기(Scanline Flood-Fill) 엔진
 * (study-color-flood.js)
 * ------------------------------------------------------------------------------
 * - Dream World 포켓몬 도안 등 다층 벡터 SVG의 배경 실루엣 비침 방지(multiply 오버레이)
 * - 선화 기반 4방향 스캔라인 플러드 필 + 1px 안티앨리어싱 경계 보정(흰 테두리 제거)
 * - 유아 손가락 터치 오차 보정(선 위 터치 시 가장 가까운 내부 영역 자동 스냅)
 * - [규칙 3] 500줄 이하 모듈화 | 오프라인/터치 호환
 * ==============================================================================
 */
(function () {
    'use strict';

    function hexToRgb(hex) {
        const clean = String(hex || '#ffffff').replace('#', '').trim();
        if (clean.length === 3) {
            return [
                parseInt(clean[0] + clean[0], 16),
                parseInt(clean[1] + clean[1], 16),
                parseInt(clean[2] + clean[2], 16)
            ];
        }
        return [
            parseInt(clean.slice(0, 2), 16) || 0,
            parseInt(clean.slice(2, 4), 16) || 0,
            parseInt(clean.slice(4, 6), 16) || 0
        ];
    }

    /**
     * 최상단 검은 선화 오버레이 SVG를 생성한다.
     * - 포켓몬(v2) 도안은 흰 채우기를 유지한 채 mix-blend-mode: multiply를 적용해
     *   밑바탕 검은 실루엣이 겉으로 튀어나오지 않게 보호한다.
     */
    function buildOutlineOverlay(svgEl) {
        if (!svgEl) return null;
        const clone = svgEl.cloneNode(true);
        clone.classList.add('coloring-outline-svg');
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('[data-color-part]').forEach((el) => el.removeAttribute('data-color-part'));

        const useMultiply = svgEl.dataset?.coloringV === '2' || svgEl.dataset?.fillMode === 'flood';
        if (useMultiply) {
            clone.classList.add('is-multiply-outline');
        } else {
            clone.querySelectorAll('path, rect, circle, ellipse, polygon, polyline').forEach((el) => {
                if (!el.hasAttribute('data-keep-white') && (el.getAttribute('fill') || '').toLowerCase() === '#ffffff') {
                    el.setAttribute('fill', 'none');
                }
            });
        }
        return clone;
    }

    function rasterizeSvgToMask(svgEl, w, h) {
        return new Promise((resolve) => {
            if (!svgEl || w <= 0 || h <= 0) return resolve(null);
            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(w));
            clone.setAttribute('height', String(h));
            const xml = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                try {
                    const off = document.createElement('canvas');
                    off.width = w;
                    off.height = h;
                    const octx = off.getContext('2d', { willReadFrequently: true });
                    octx.fillStyle = '#ffffff';
                    octx.fillRect(0, 0, w, h);
                    octx.drawImage(img, 0, 0, w, h);
                    const { data } = octx.getImageData(0, 0, w, h);
                    const total = w * h;
                    const inkWall = new Uint8Array(total);
                    const hardInk = new Uint8Array(total);
                    for (let p = 0, i = 0; p < total; p++, i += 4) {
                        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                        if (lum < 216) inkWall[p] = 1;
                        if (lum < 125) hardInk[p] = 1;
                    }
                    resolve({ w, h, inkWall, hardInk });
                } catch (_) {
                    resolve(null);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };
            img.src = url;
        });
    }

    function snapStartPixel(mask, sx, sy) {
        const { w, h, inkWall } = mask;
        const clampedX = Math.max(0, Math.min(w - 1, Math.round(sx)));
        const clampedY = Math.max(0, Math.min(h - 1, Math.round(sy)));
        if (!inkWall[clampedY * w + clampedX]) return [clampedX, clampedY];

        const maxR = Math.max(10, Math.round(w * 0.028));
        for (let r = 1; r <= maxR; r++) {
            for (let dy = -r; dy <= r; dy++) {
                const ny = clampedY + dy;
                if (ny < 0 || ny >= h) continue;
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = clampedX + dx;
                    if (nx < 0 || nx >= w) continue;
                    if (!inkWall[ny * w + nx]) return [nx, ny];
                }
            }
        }
        return null;
    }

    function createFloodFillSession(svgEl, canvas) {
        let cachedKey = '';
        let cachedMask = null;
        let pendingBuild = null;

        const ensureMask = async () => {
            const w = canvas.width;
            const h = canvas.height;
            if (!w || !h) return null;
            const key = `${w}x${h}`;
            if (cachedKey === key && cachedMask) return cachedMask;
            if (pendingBuild && pendingBuild.key === key) return pendingBuild.promise;
            const promise = rasterizeSvgToMask(svgEl, w, h).then((mask) => {
                if (mask) {
                    cachedKey = key;
                    cachedMask = mask;
                }
                pendingBuild = null;
                return mask;
            });
            pendingBuild = { key, promise };
            return promise;
        };

        /**
         * (clientX, clientY) 좌표에 선택 색상으로 스캔라인 채우기를 수행한다.
         * @returns {Promise<{filled:boolean, count:number}>}
         */
        const fillAtClientPoint = async (clientX, clientY, hex) => {
            const mask = await ensureMask();
            if (!mask || !canvas.width || !canvas.height) return { filled: false, count: 0 };
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return { filled: false, count: 0 };

            const rawX = ((clientX - rect.left) * canvas.width) / rect.width;
            const rawY = ((clientY - rect.top) * canvas.height) / rect.height;
            const snapped = snapStartPixel(mask, rawX, rawY);
            if (!snapped) return { filled: false, count: 0 };

            const [sx, sy] = snapped;
            const { w, h, inkWall, hardInk } = mask;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const imgData = ctx.getImageData(0, 0, w, h);
            const px = imgData.data;

            const startOff = (sy * w + sx) * 4;
            const ta = px[startOff + 3];
            const tr = px[startOff];
            const tg = px[startOff + 1];
            const tb = px[startOff + 2];

            const isClearFill = String(hex || '').toLowerCase() === '#ffffff';
            const [fr, fg, fb] = hexToRgb(hex);

            if (isClearFill && ta < 16) return { filled: false, count: 0 };
            if (!isClearFill && ta >= 220 && Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) <= 12) {
                return { filled: false, count: 0 };
            }

            const total = w * h;
            const visited = new Uint8Array(total);
            const filledPixels = [];
            const isTargetEmpty = ta < 48;

            const canFill = (idx) => {
                if (visited[idx] || inkWall[idx]) return false;
                const o = idx * 4;
                const a = px[o + 3];
                if (isTargetEmpty) return a < 96;
                if (a < 48) return false;
                return Math.abs(px[o] - tr) + Math.abs(px[o + 1] - tg) + Math.abs(px[o + 2] - tb) <= 60;
            };

            const stack = [sx, sy];
            while (stack.length > 0) {
                const y = stack.pop();
                let x = stack.pop();
                let idx = y * w + x;
                if (!canFill(idx)) continue;

                while (x > 0 && canFill(idx - 1)) {
                    x -= 1;
                    idx -= 1;
                }

                let spanUp = false;
                let spanDown = false;
                while (x < w && canFill(idx)) {
                    visited[idx] = 1;
                    filledPixels.push(idx);

                    if (y > 0) {
                        const upOk = canFill(idx - w);
                        if (!spanUp && upOk) {
                            stack.push(x, y - 1);
                            spanUp = true;
                        } else if (spanUp && !upOk) {
                            spanUp = false;
                        }
                    }
                    if (y < h - 1) {
                        const downOk = canFill(idx + w);
                        if (!spanDown && downOk) {
                            stack.push(x, y + 1);
                            spanDown = true;
                        } else if (spanDown && !downOk) {
                            spanDown = false;
                        }
                    }
                    x += 1;
                    idx += 1;
                }
            }

            if (filledPixels.length === 0) return { filled: false, count: 0 };

            const writePixel = (idx) => {
                const o = idx * 4;
                if (isClearFill) {
                    px[o] = 0;
                    px[o + 1] = 0;
                    px[o + 2] = 0;
                    px[o + 3] = 0;
                } else {
                    px[o] = fr;
                    px[o + 1] = fg;
                    px[o + 2] = fb;
                    px[o + 3] = 255;
                }
            };

            // 1. 내부 영역 칠하기
            for (let i = 0; i < filledPixels.length; i++) {
                writePixel(filledPixels[i]);
            }

            // 2. 선화 경계의 부드러운 반투명 1px 틈새까지 번짐 보정(흰 띠 방지)
            for (let i = 0; i < filledPixels.length; i++) {
                const idx = filledPixels[i];
                const x = idx % w;
                const y = (idx - x) / w;
                const neighbors = [];
                if (x > 0) neighbors.push(idx - 1);
                if (x < w - 1) neighbors.push(idx + 1);
                if (y > 0) neighbors.push(idx - w);
                if (y < h - 1) neighbors.push(idx + w);
                for (let k = 0; k < neighbors.length; k++) {
                    const ni = neighbors[k];
                    if (!visited[ni] && inkWall[ni] && !hardInk[ni]) {
                        visited[ni] = 1;
                        writePixel(ni);
                    }
                }
            }

            ctx.putImageData(imgData, 0, 0);
            return { filled: true, count: filledPixels.length };
        };

        return { ensureMask, fillAtClientPoint };
    }

    function renderRecommendedPalette(bar, svgEl, onPick) {
        if (!bar || !svgEl) return;
        const raw = svgEl.dataset.palette || '';
        const hexes = raw.split(',').map((s) => s.trim()).filter((s) => /^#[0-9a-f]{6}$/i.test(s));
        bar.innerHTML = '';
        if (!hexes.length) {
            bar.hidden = true;
            return;
        }
        const label = document.createElement('span');
        label.className = 'pokemon-rec-label';
        label.textContent = '✨ 추천 색:';
        bar.appendChild(label);
        hexes.forEach((hex, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'color-swatch color-swatch--rec';
            btn.style.backgroundColor = hex;
            btn.setAttribute('aria-label', `포켓몬 추천 색 ${idx + 1}`);
            btn.title = `포켓몬 추천 색 ${idx + 1}`;
            btn.addEventListener('click', () => onPick(hex, btn));
            bar.appendChild(btn);
        });
        bar.hidden = false;
    }

    const DEFAULT_CRAYONS = [
        { name: '빨강', hex: '#ef4444' },
        { name: '주황', hex: '#fb923c' },
        { name: '노랑', hex: '#facc15' },
        { name: '연두', hex: '#84cc16' },
        { name: '초록', hex: '#22c55e' },
        { name: '하늘', hex: '#38bdf8' },
        { name: '파랑', hex: '#3b82f6' },
        { name: '보라', hex: '#a855f7' },
        { name: '분홍', hex: '#f472b6' },
        { name: '살구', hex: '#fed7aa' },
        { name: '갈색', hex: '#92400e' },
        { name: '하양', hex: '#ffffff' }
    ];

    function bindCanvasTapFill(canvas, opts) {
        if (!canvas || !opts) return;
        let tapStart = null;
        canvas.addEventListener('pointerdown', (e) => {
            if (!opts.canFill?.() || e.isPrimary === false) return;
            tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
        });
        canvas.addEventListener('pointerup', async (e) => {
            if (!tapStart || e.pointerId !== tapStart.id) return;
            const start = tapStart;
            tapStart = null;
            const session = opts.getSession?.();
            if (!opts.canFill?.() || !session) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 26) return;
            const snapInfo = opts.onBeforeFill?.();
            const res = await session.fillAtClientPoint(e.clientX, e.clientY, opts.getHex?.());
            if (res?.filled) opts.onAfterFill?.(snapInfo, res);
        });
    }

    window.StudyColorFlood = {
        DEFAULT_CRAYONS,
        buildOutlineOverlay,
        createFloodFillSession,
        renderRecommendedPalette,
        bindCanvasTapFill
    };
})();
