/**
 * ==============================================================================
 * 포켓몬 API 연동 1세대(#1~150) 색칠 도안 변환·캐시 서비스
 * (pokemonColoring.service.js)
 * ------------------------------------------------------------------------------
 * - PokéAPI 공식 종 정보(pokeapi.co/api/v2/pokemon-species/1~150) +
 *   Dream World 벡터 SVG를 안전한 컬러링 북 선화로 자동 변환·디스크 캐시
 * - 외부 API 장애 시에도 100% 동작하는 내장 벡터 도안 폴백 포함
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { getPokemonById, listEnrichedCatalog, POPULAR_GEN1_IDS } = require('./pokemonCatalog.data');
const { getPokemonCacheEntry, setPokemonCacheEntry } = require('./studyPokemonCache.service');

const SVG_CACHE_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'pokemon');
const SPECIES_CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'pokemon-cache');
const ipv4Agent = new https.Agent({ family: 4 });

const SAFE_GEO_ATTRS = new Set([
    'd', 'points', 'x', 'y', 'width', 'height', 'rx', 'ry',
    'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'fill-rule', 'clip-rule'
]);
const SAFE_TRANSFORM_RE = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[-+0-9.,eE\s]+\)\s*)+$/;
const SHAPE_TAGS = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);
const SKIP_SUBTREE_TAGS = new Set(['defs', 'style', 'script', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter', 'pattern', 'metadata', 'title', 'desc']);

function fetchTextHttps(url, timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { agent: ipv4Agent, timeout: timeoutMs, headers: { Accept: 'application/json,image/svg+xml,*/*' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchTextHttps(res.headers.location, timeoutMs).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP_${res.statusCode}`));
            }
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
                if (raw.length > 512 * 1024) req.destroy(new Error('PAYLOAD_TOO_LARGE'));
            });
            res.on('end', () => resolve(raw));
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('POKEAPI_TIMEOUT'));
        });
        req.on('error', reject);
    });
}

function clampGen1Id(id) {
    const num = Math.round(Number(id));
    if (!Number.isInteger(num) || num < 1 || num > 150) return 25;
    return num;
}

function escapeXml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseAttributes(attrText) {
    const out = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(attrText)) !== null) {
        out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] || '');
    }
    return out;
}

function extractStyleProp(styleStr, propName) {
    if (!styleStr) return '';
    const m = styleStr.match(new RegExp(`(?:^|;)\\s*${propName}\\s*:\\s*([^;]+)`, 'i'));
    return m ? m[1].trim() : '';
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
    if (rgb) {
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }
    return [180, 180, 180];
}

function colorLuminance(rgb) {
    if (!rgb || rgb.some((n) => !Number.isFinite(n))) return 180;
    return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
}

function estimateShapeMaxSpan(tag, attrs) {
    if (tag === 'circle') return (Number(attrs.r) || 0) * 2;
    if (tag === 'ellipse') return Math.max(Number(attrs.rx) || 0, Number(attrs.ry) || 0) * 2;
    if (tag === 'rect') return Math.max(Number(attrs.width) || 0, Number(attrs.height) || 0);
    const coordSrc = attrs.d || attrs.points || '';
    const nums = (coordSrc.match(/-?\d*\.?\d+/g) || []).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return 999;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
        if (nums[i] < minX) minX = nums[i];
        if (nums[i] > maxX) maxX = nums[i];
        if (nums[i + 1] < minY) minY = nums[i + 1];
        if (nums[i + 1] > maxY) maxY = nums[i + 1];
    }
    return Math.max(maxX - minX, maxY - minY);
}

function buildSafeAttrString(attrs) {
    const parts = [];
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'transform') {
            if (SAFE_TRANSFORM_RE.test(v)) parts.push(`transform="${escapeXml(v.trim())}"`);
        } else if (SAFE_GEO_ATTRS.has(k) && v !== '') {
            parts.push(`${k}="${escapeXml(v)}"`);
        }
    }
    return parts.join(' ');
}

function convertDreamWorldSvgToColoring(rawSvg, pokemonMeta) {
    const svgMatch = String(rawSvg || '').match(/<svg([^>]*)>([\s\S]*?)<\/svg>/i);
    if (!svgMatch) return null;

    const rootAttrs = parseAttributes(svgMatch[1]);
    let vbX = 0;
    let vbY = 0;
    let vbW = 180;
    let vbH = 180;
    if (rootAttrs.viewbox) {
        const parts = rootAttrs.viewbox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
            [vbX, vbY, vbW, vbH] = parts;
        }
    } else if (rootAttrs.width && rootAttrs.height) {
        const w = parseFloat(rootAttrs.width);
        const h = parseFloat(rootAttrs.height);
        if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
            vbW = w;
            vbH = h;
        }
    }

    const scale = Math.min(276 / vbW, 188 / vbH);
    const tx = (320 - vbW * scale) / 2 - vbX * scale;
    const ty = (220 - vbH * scale) / 2 - vbY * scale;
    const strokeW = Number(Math.min(4.2, Math.max(0.85, 1.55 / scale)).toFixed(3));
    const maxDim = Math.max(vbW, vbH);

    const tokenRe = /<(\/?)([a-zA-Z0-9:-]+)([^>]*?)(\/?)>/g;
    const outChunks = [];
    let skipDepth = 0;
    let partIdx = 0;
    let m;

    while ((m = tokenRe.exec(svgMatch[2])) !== null) {
        const isClose = m[1] === '/';
        const tag = m[2].toLowerCase();
        const attrRaw = m[3] || '';
        const isSelfClose = m[4] === '/' || attrRaw.trim().endsWith('/');

        if (SKIP_SUBTREE_TAGS.has(tag)) {
            if (!isClose && !isSelfClose) skipDepth += 1;
            else if (isClose && skipDepth > 0) skipDepth -= 1;
            continue;
        }
        if (skipDepth > 0) continue;

        if (tag === 'g') {
            if (isClose) {
                outChunks.push('</g>');
            } else if (!isSelfClose) {
                const attrs = parseAttributes(attrRaw);
                const tAttr = attrs.transform && SAFE_TRANSFORM_RE.test(attrs.transform)
                    ? ` transform="${escapeXml(attrs.transform.trim())}"`
                    : '';
                outChunks.push(`<g${tAttr}>`);
            }
            continue;
        }

        if (!SHAPE_TAGS.has(tag)) continue;
        const attrs = parseAttributes(attrRaw);
        const geo = buildSafeAttrString(attrs);
        if (!geo) continue;

        const rawFill = attrs.fill || extractStyleProp(attrs.style, 'fill') || '#000000';
        const rgb = parseRgbColor(rawFill);

        if (!rgb) {
            outChunks.push(`<${tag} ${geo} fill="none" stroke="#1e293b" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" data-outline-part="1"/>`);
            continue;
        }

        const lum = colorLuminance(rgb);
        if (lum < 58) {
            outChunks.push(`<${tag} ${geo} fill="#1e293b" stroke="none" data-outline-part="1"/>`);
            continue;
        }

        const span = estimateShapeMaxSpan(tag, attrs);
        if (lum >= 248 && span <= maxDim * 0.095) {
            outChunks.push(`<${tag} ${geo} fill="#ffffff" stroke="none" data-keep-white="1" data-outline-part="1"/>`);
            continue;
        }

        outChunks.push(
            `<${tag} ${geo} data-color-part="${partIdx++}" fill="#ffffff" stroke="#1e293b" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`
        );
    }

    if (partIdx === 0 && outChunks.length === 0) return null;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="${escapeXml(pokemonMeta.nameKo)} 포켓몬 색칠 도안">`,
        `<g transform="translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">`,
        ...outChunks,
        '</g>',
        '</svg>'
    ].join('');
}

function buildFallbackPokemonColoringSvg(pokemonMeta) {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="${escapeXml(pokemonMeta.nameKo)} 색칠 도안">`,
        '<circle data-color-part="0" cx="160" cy="110" r="82" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>',
        '<path data-color-part="1" d="M78 110 A82 82 0 0 1 242 110 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>',
        '<line x1="78" y1="110" x2="242" y2="110" stroke="#1e293b" stroke-width="6"/>',
        '<circle data-color-part="2" cx="160" cy="110" r="24" fill="#ffffff" stroke="#1e293b" stroke-width="5"/>',
        `<text x="160" y="210" text-anchor="middle" font-size="15" font-weight="800" fill="#1e293b" font-family="sans-serif">#${String(pokemonMeta.id).padStart(3, '0')} ${escapeXml(pokemonMeta.nameKo)}</text>`,
        '</svg>'
    ].join('');
}

async function getOrBuildPokemonColoringSvg(pokemonId) {
    const idNum = clampGen1Id(pokemonId);
    const meta = getPokemonById(idNum);
    fs.mkdirSync(SVG_CACHE_DIR, { recursive: true });

    const convertedPath = path.join(SVG_CACHE_DIR, `coloring-${idNum}.svg`);
    if (fs.existsSync(convertedPath)) {
        const cached = fs.readFileSync(convertedPath, 'utf8');
        if (cached.includes('class="coloring-svg"')) return cached;
    }

    const dbSvg = await getPokemonCacheEntry(`coloring_svg:${idNum}`);
    if (dbSvg?.buffer?.length > 40) {
        const cached = dbSvg.buffer.toString('utf8');
        if (cached.includes('class="coloring-svg"')) {
            try { fs.writeFileSync(convertedPath, cached, 'utf8'); } catch (_) {}
            return cached;
        }
    }

    try {
        const rawUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world/${idNum}.svg`;
        const rawSvg = await fetchTextHttps(rawUrl, 5000);
        const converted = convertDreamWorldSvgToColoring(rawSvg, meta);
        if (converted) {
            try { fs.writeFileSync(convertedPath, converted, 'utf8'); } catch (_) {}
            await setPokemonCacheEntry(`coloring_svg:${idNum}`, 'image/svg+xml', converted, rawUrl);
            try {
                const { getOrCachePokemonSprite } = require('./studyPokemon.service');
                getOrCachePokemonSprite(idNum, 'artwork').catch(() => {});
            } catch (_) {}
            return converted;
        }
    } catch (_) {}

    return buildFallbackPokemonColoringSvg(meta);
}

async function getPokeApiSpeciesInfo(pokemonId) {
    const idNum = clampGen1Id(pokemonId);
    const base = getPokemonById(idNum);
    fs.mkdirSync(SPECIES_CACHE_DIR, { recursive: true });
    const cachePath = path.join(SPECIES_CACHE_DIR, `species-${idNum}.json`);
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000;

    try {
        if (fs.existsSync(cachePath)) {
            const stat = fs.statSync(cachePath);
            if (Date.now() - stat.mtimeMs < maxAgeMs) {
                return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            }
        }
    } catch (_) {}

    try {
        const dbSpecies = await getPokemonCacheEntry(`species:${idNum}`, maxAgeMs);
        if (dbSpecies?.buffer?.length > 2) {
            const parsed = JSON.parse(dbSpecies.buffer.toString('utf8'));
            try { fs.writeFileSync(cachePath, JSON.stringify(parsed), 'utf8'); } catch (_) {}
            return parsed;
        }
    } catch (_) {}

    try {
        const speciesUrl = `https://pokeapi.co/api/v2/pokemon-species/${idNum}`;
        const raw = await fetchTextHttps(speciesUrl, 4500);
        const data = JSON.parse(raw);
        const koName = (data.names || []).find((n) => n?.language?.name === 'ko')?.name || base.nameKo;
        const koGenus = (data.genera || []).find((g) => g?.language?.name === 'ko')?.genus || '';
        const koFlavorEntry = (data.flavor_text_entries || [])
            .filter((f) => f?.language?.name === 'ko' && f.flavor_text)
            .slice(-1)[0];
        const koFlavor = koFlavorEntry
            ? String(koFlavorEntry.flavor_text).replace(/[\f\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
            : base.flavorKo;

        const merged = {
            ...base,
            id: idNum,
            nameKo: koName,
            genusKo: koGenus,
            flavorKo: koFlavor,
            artworkUrl: `/api/study/pokemon/sprite/${idNum}?kind=artwork`,
            coloringSvgUrl: `/api/study/pokemon/coloring-svg/${idNum}`,
            fromPokeApi: true
        };
        const jsonText = JSON.stringify(merged);
        try { fs.writeFileSync(cachePath, jsonText, 'utf8'); } catch (_) {}
        await setPokemonCacheEntry(`species:${idNum}`, 'application/json', jsonText, speciesUrl);
        return merged;
    } catch (_) {
        return {
            ...base,
            id: idNum,
            genusKo: `${base.typeLabel} 포켓몬`,
            artworkUrl: `/api/study/pokemon/sprite/${idNum}?kind=artwork`,
            coloringSvgUrl: `/api/study/pokemon/coloring-svg/${idNum}`,
            fromPokeApi: false
        };
    }
}

function listGen1ColoringCatalog({ q = '', type = '' } = {}) {
    const query = String(q || '').trim().toLowerCase();
    const numQ = query.replace(/^#?0*/, '');
    const typeFilter = String(type || '').trim().toLowerCase();

    return listEnrichedCatalog()
        .filter((p) => p.id >= 1 && p.id <= 150)
        .filter((p) => {
            if (typeFilter === 'popular') return POPULAR_GEN1_IDS.includes(p.id);
            if (typeFilter && typeFilter !== 'all' && p.typeKey !== typeFilter) return false;
            if (!query) return true;
            return p.nameKo.toLowerCase().includes(query) || String(p.id) === numQ || p.typeLabel.includes(query);
        })
        .map((p) => ({
            id: p.id,
            nameKo: p.nameKo,
            typeKey: p.typeKey,
            typeLabel: p.typeLabel,
            typeEmoji: p.typeEmoji,
            color: p.color,
            bgSoft: p.bgSoft,
            rarity: p.rarity,
            isPopular: p.isPopular,
            artworkUrl: `/api/study/pokemon/sprite/${p.id}?kind=artwork`
        }));
}

module.exports = {
    clampGen1Id,
    convertDreamWorldSvgToColoring,
    getOrBuildPokemonColoringSvg,
    getPokeApiSpeciesInfo,
    listGen1ColoringCatalog
};
