/**
 * ==============================================================================
 * 포켓몬 Dream World SVG 선화 정제 & 대표 팔레트 추출 헬퍼
 * (pokemonLineArt.helper.js)
 * ------------------------------------------------------------------------------
 * - 진짜 검은 윤곽선(#0d131a 등 저채도 극암색)과 유채색/명암 면을 정밀 분리
 * - sharp(librsvg) 기반 가시 경계 분석으로 피카츄 볼터치/이상해씨 반점 등
 *   선화가 빠진 무늬만 부드러운 벡터 선으로 보강 (숨은 명암/삼각형 선 제거)
 * - [규칙 3] 500줄 이하 모듈화 | graceful fallback
 * ==============================================================================
 */

let sharpLib = null;
try {
    sharpLib = require('sharp');
} catch (_) {
    sharpLib = null;
}

function parseRgbColor(val) {
    const s = String(val || '').trim().toLowerCase();
    if (!s || s === 'none' || s === 'transparent') return null;
    if (s === 'black') return [0, 0, 0];
    if (s === 'white') return [255, 255, 255];
    if (s.startsWith('#')) {
        const hex = s.slice(1);
        if (hex.length === 3) {
            return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
        }
        if (hex.length >= 6) {
            return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
        }
    }
    const rgb = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return [180, 180, 180];
}

function colorLuminance(rgb) {
    if (!rgb || rgb.some((n) => !Number.isFinite(n))) return 180;
    return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
}

function colorChroma(rgb) {
    if (!rgb || rgb.some((n) => !Number.isFinite(n))) return 0;
    return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

function isTrueInkColor(rgb) {
    if (!rgb) return false;
    return colorLuminance(rgb) < 46 && colorChroma(rgb) < 34;
}

function toHex(rgb) {
    return '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

function extractSignaturePalette(rawSvg) {
    const counts = new Map();
    const re = /<path\b[^>]*\bfill\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
    let m;
    while ((m = re.exec(String(rawSvg || ''))) !== null) {
        const rawFill = m[1] !== undefined ? m[1] : m[2];
        const rgb = parseRgbColor(rawFill);
        if (!rgb || isTrueInkColor(rgb)) continue;
        const lum = colorLuminance(rgb);
        const ch = colorChroma(rgb);
        if (lum >= 248 && ch < 18) continue;
        if (lum >= 210 && ch < 12) continue;
        const hex = toHex(rgb);
        const dMatch = m[0].match(/\bd\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const weight = Math.max(40, (dMatch?.[1] || dMatch?.[2] || '').length);
        const prev = counts.get(hex);
        counts.set(hex, { rgb, lum, ch, score: (prev?.score || 0) + weight });
    }

    const sorted = Array.from(counts.entries())
        .sort((a, b) => (b[1].score * (1 + b[1].ch / 180)) - (a[1].score * (1 + a[1].ch / 180)));

    const picked = [];
    for (const [hex, info] of sorted) {
        const tooSimilar = picked.some((p) => {
            const dr = p.rgb[0] - info.rgb[0];
            const dg = p.rgb[1] - info.rgb[1];
            const db = p.rgb[2] - info.rgb[2];
            return Math.hypot(dr, dg, db) < 58;
        });
        if (!tooSimilar) {
            picked.push({ hex, rgb: info.rgb });
            if (picked.length >= 5) break;
        }
    }
    return picked.map((p) => p.hex);
}

function normHueDiff(r1, g1, b1, r2, g2, b2) {
    const s1 = r1 + g1 + b1 + 45;
    const s2 = r2 + g2 + b2 + 45;
    return Math.abs(r1 / s1 - r2 / s2) + Math.abs(g1 / s1 - g2 / s2) + Math.abs(b1 / s1 - b2 / s2);
}

function rdpSimplify(pts, eps) {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let idx = 0;
    const [x1, y1] = pts[0];
    const [x2, y2] = pts[pts.length - 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy || 1;
    for (let i = 1; i < pts.length - 1; i++) {
        const t = ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / lenSq;
        const px = x1 + t * dx;
        const py = y1 + t * dy;
        const dist = Math.hypot(pts[i][0] - px, pts[i][1] - py);
        if (dist > maxDist) {
            maxDist = dist;
            idx = i;
        }
    }
    if (maxDist > eps) {
        const left = rdpSimplify(pts.slice(0, idx + 1), eps);
        const right = rdpSimplify(pts.slice(idx), eps);
        return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
}

function pointsToSmoothPath(pts, closed) {
    if (pts.length < 2) return '';
    const coords = pts.map(([x, y]) => [+(x / 2).toFixed(1), +(y / 2).toFixed(1)]);
    if (coords.length === 2) {
        return `M${coords[0][0]} ${coords[0][1]} L${coords[1][0]} ${coords[1][1]}`;
    }
    let d = `M${coords[0][0]} ${coords[0][1]}`;
    for (let i = 1; i < coords.length - 1; i++) {
        const mx = +((coords[i][0] + coords[i + 1][0]) / 2).toFixed(1);
        const my = +((coords[i][1] + coords[i + 1][1]) / 2).toFixed(1);
        d += ` Q${coords[i][0]} ${coords[i][1]} ${mx} ${my}`;
    }
    const last = coords[coords.length - 1];
    d += ` L${last[0]} ${last[1]}`;
    if (closed) d += ' Z';
    return d;
}

const DIRS = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
];

function traceEdgePolylines(edgeMap, w, h) {
    const visited = new Uint8Array(w * h);
    const paths = [];

    const markNearVisited = (cx, cy) => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    visited[ny * w + nx] = 1;
                }
            }
        }
    };

    for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
            const startIdx = y * w + x;
            if (!edgeMap[startIdx] || visited[startIdx]) continue;

            const chain = [[x, y]];
            markNearVisited(x, y);
            let cx = x;
            let cy = y;
            let dirIdx = 0;

            for (let step = 0; step < 2400; step++) {
                let found = false;
                for (let r = 1; r <= 2 && !found; r++) {
                    for (let off = 0; off < 8; off++) {
                        const d = (dirIdx + (off % 2 === 0 ? off / 2 : 8 - (off + 1) / 2)) % 8;
                        const nx = cx + DIRS[d][0] * r;
                        const ny = cy + DIRS[d][1] * r;
                        if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) continue;
                        const ni = ny * w + nx;
                        if (edgeMap[ni] && !visited[ni]) {
                            chain.push([nx, ny]);
                            markNearVisited(nx, ny);
                            cx = nx;
                            cy = ny;
                            dirIdx = d;
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) break;
            }

            if (chain.length < 9) continue;
            const [ex, ey] = chain[chain.length - 1];
            const closed = chain.length >= 12 && Math.hypot(ex - x, ey - y) <= 5.5;
            const simplified = rdpSimplify(chain, 1.8);
            if (simplified.length >= 3) {
                const d = pointsToSmoothPath(simplified, closed);
                if (d) paths.push(d);
            }
        }
    }
    return paths;
}

async function extractUnoutlinedMarkingPaths(colorSvg, bwInkSvg) {
    if (!sharpLib || !colorSvg || !bwInkSvg) return '';
    const W = 640;
    const H = 440;
    try {
        const [colBuf, inkBuf] = await Promise.all([
            sharpLib(Buffer.from(colorSvg)).resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer(),
            sharpLib(Buffer.from(bwInkSvg)).resize(W, H, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).flatten({ background: '#ffffff' }).raw().toBuffer()
        ]);

        const inkMask = new Uint8Array(W * H);
        for (let i = 0, p = 0; p < W * H; p++, i += 3) {
            if (inkBuf[i] * 0.299 + inkBuf[i + 1] * 0.587 + inkBuf[i + 2] * 0.114 < 232) {
                inkMask[p] = 1;
            }
        }

        const nearInk = (x, y) => {
            for (let dy = -3; dy <= 3; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= H) continue;
                for (let dx = -3; dx <= 3; dx++) {
                    const xx = x + dx;
                    if (xx >= 0 && xx < W && inkMask[yy * W + xx]) return true;
                }
            }
            return false;
        };

        const edgeMap = new Uint8Array(W * H);
        for (let y = 3; y < H - 3; y++) {
            for (let x = 3; x < W - 3; x++) {
                const p = y * W + x;
                const c0 = p * 4;
                if (colBuf[c0 + 3] < 220) continue;
                if (nearInk(x, y)) continue;

                const r1 = colBuf[c0], g1 = colBuf[c0 + 1], b1 = colBuf[c0 + 2];
                const lum1 = r1 * 0.299 + g1 * 0.587 + b1 * 0.114;
                const cr = (p + 2) * 4;
                const cd = (p + W * 2) * 4;

                let isEdge = false;
                if (colBuf[cr + 3] >= 220) {
                    const nd = normHueDiff(r1, g1, b1, colBuf[cr], colBuf[cr + 1], colBuf[cr + 2]);
                    const ld = Math.abs(lum1 - (colBuf[cr] * 0.299 + colBuf[cr + 1] * 0.587 + colBuf[cr + 2] * 0.114));
                    if (nd > 0.27 || (ld > 95 && nd > 0.12)) isEdge = true;
                }
                if (!isEdge && colBuf[cd + 3] >= 220) {
                    const nd = normHueDiff(r1, g1, b1, colBuf[cd], colBuf[cd + 1], colBuf[cd + 2]);
                    const ld = Math.abs(lum1 - (colBuf[cd] * 0.299 + colBuf[cd + 1] * 0.587 + colBuf[cd + 2] * 0.114));
                    if (nd > 0.27 || (ld > 95 && nd > 0.12)) isEdge = true;
                }
                if (isEdge) edgeMap[p] = 1;
            }
        }

        const paths = traceEdgePolylines(edgeMap, W, H);
        if (!paths.length) return '';
        const dTags = paths.map((d) => `<path d="${d}" fill="none" stroke="#1e293b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" data-marking-guide="1"/>`).join('');
        return `<g class="pokemon-marking-guides">${dTags}</g>`;
    } catch (_) {
        return '';
    }
}

module.exports = {
    parseRgbColor,
    colorLuminance,
    colorChroma,
    isTrueInkColor,
    extractSignaturePalette,
    extractUnoutlinedMarkingPaths
};
