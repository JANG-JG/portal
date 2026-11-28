/**
 * 🤖 JG 통합 검색 - 한국형 안전 웹봇 수집 코어 (webBotFetcher.service.js)
 * - SSRF 완벽 차단 (DNS Rebinding 방어용 커스텀 lookup + 리다이렉트 매 단계 재검증)
 * - robots.txt 24시간 캐시 준수 + 도메인별 2초 속도 제한 (공인 IP 차단 방지)
 * - 한국 웹 특화: 네이버 블로그 iframe 우회(m.blog.naver.com) + EUC-KR/CP949 자동 디코딩
 * - 스트림 용량 절단(48KB~180KB)으로 노트 9 RAM/CPU 부하 원천 차단
 */

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const axios = require('axios');

const BOT_USER_AGENT = 'Mozilla/5.0 (compatible; JG-Portal-Bot/1.0; +https://j-jg.cc)';
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_DOMAIN_INTERVAL_MS = 2000;
const MAX_ROBOTS_CACHE = 300;

const robotsCache = new Map();
const domainNextSlotMap = new Map();
const eucKrDecoder = new TextDecoder('euc-kr', { fatal: false });

function isPrivateOrReservedIp(ip) {
    if (!ip || typeof ip !== 'string') return true;
    const clean = ip.trim().toLowerCase();

    if (clean.startsWith('::ffff:')) {
        const v4Part = clean.slice(7);
        if (net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    }

    if (net.isIPv4(clean)) {
        const parts = clean.split('.').map((n) => parseInt(n, 10));
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
        const [a, b] = parts;
        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 192 && b === 0) return true;
        if (a === 198 && (b === 18 || b === 19)) return true;
        if (a >= 224) return true;
        return false;
    }

    if (net.isIPv6(clean)) {
        if (clean === '::' || clean === '::1') return true;
        if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
        if (/^fe[89ab]/i.test(clean)) return true;
        if (clean.startsWith('ff')) return true;
        return false;
    }

    return true;
}

function safeDnsLookup(hostname, options, callback) {
    const opts = typeof options === 'object' ? { ...options, verbatim: true } : { family: options, verbatim: true };
    dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return callback(err);
        if (Array.isArray(address)) {
            const blocked = address.some((entry) => isPrivateOrReservedIp(entry.address));
            if (blocked || address.length === 0) {
                return callback(new Error('SSRF_BLOCKED_PRIVATE_IP'));
            }
            return callback(null, address);
        }
        if (isPrivateOrReservedIp(address)) {
            return callback(new Error('SSRF_BLOCKED_PRIVATE_IP'));
        }
        return callback(null, address, family);
    });
}

const safeHttpAgent = new http.Agent({ keepAlive: false, lookup: safeDnsLookup });
const safeHttpsAgent = new https.Agent({ keepAlive: false, lookup: safeDnsLookup });

async function validateSafePublicUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    } catch (_) {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return null;

    const host = parsed.hostname.toLowerCase();
    if (
        !host ||
        host === 'localhost' ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.endsWith('.lan')
    ) {
        return null;
    }
    if (net.isIP(host) && isPrivateOrReservedIp(host)) return null;

    try {
        const records = await dns.promises.lookup(host, { all: true });
        if (!records.length || records.some((r) => isPrivateOrReservedIp(r.address))) {
            return null;
        }
    } catch (_) {
        return null;
    }
    return parsed;
}

/**
 * 네이버 블로그 등 데스크톱 iframe URL을 모바일 본문 URL로 변환
 */
function rewriteKoreanFetchUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'blog.naver.com') {
            const blogId = u.searchParams.get('blogId');
            const logNo = u.searchParams.get('logNo');
            if (blogId && logNo) {
                return `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`;
            }
            const segs = u.pathname.split('/').filter(Boolean);
            if (segs.length >= 2 && /^[a-zA-Z0-9_-]+$/.test(segs[0]) && /^\d+$/.test(segs[1])) {
                return `https://m.blog.naver.com/${segs[0]}/${segs[1]}`;
            }
        }
    } catch (_) {}
    return rawUrl;
}

function parseRobotsTxt(text) {
    const lines = String(text || '').split(/\r?\n/);
    const rules = [];
    let applicable = false;

    for (const rawLine of lines) {
        const line = rawLine.split('#')[0].trim();
        if (!line) continue;
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const field = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();

        if (field === 'user-agent') {
            const ua = val.toLowerCase();
            applicable = ua === '*' || ua.includes('jg-portal-bot');
        } else if (applicable && (field === 'disallow' || field === 'allow')) {
            if (val) rules.push({ allow: field === 'allow', prefix: val });
        }
    }
    return rules;
}

async function isAllowedByRobots(urlObj) {
    const origin = urlObj.origin;
    const cached = robotsCache.get(origin);
    let rules = null;

    if (cached && Date.now() - cached.ts < ROBOTS_TTL_MS) {
        rules = cached.rules;
    } else {
        try {
            const res = await axios.get(`${origin}/robots.txt`, {
                timeout: 1500,
                maxRedirects: 2,
                httpAgent: safeHttpAgent,
                httpsAgent: safeHttpsAgent,
                headers: { 'User-Agent': BOT_USER_AGENT },
                responseType: 'text',
                maxContentLength: 65536,
                validateStatus: (s) => s >= 200 && s < 500
            });
            rules = res.status === 200 ? parseRobotsTxt(res.data) : [];
        } catch (_) {
            rules = [];
        }
        if (robotsCache.size >= MAX_ROBOTS_CACHE) {
            const firstKey = robotsCache.keys().next().value;
            if (firstKey) robotsCache.delete(firstKey);
        }
        robotsCache.set(origin, { ts: Date.now(), rules });
    }

    const pathTarget = `${urlObj.pathname}${urlObj.search || ''}`;
    let matched = null;
    for (const r of rules) {
        if (pathTarget.startsWith(r.prefix)) {
            if (!matched || r.prefix.length > matched.prefix.length) {
                matched = r;
            }
        }
    }
    return matched ? matched.allow : true;
}

async function acquireDomainSlot(hostname, skipWaitIfBusy = false) {
    const now = Date.now();
    const nextAllowed = domainNextSlotMap.get(hostname) || 0;
    const waitMs = nextAllowed - now;
    if (waitMs > 0) {
        if (skipWaitIfBusy && waitMs > 400) return false;
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 2500)));
    }
    domainNextSlotMap.set(hostname, Date.now() + MIN_DOMAIN_INTERVAL_MS);
    if (domainNextSlotMap.size > 500) {
        const oldest = domainNextSlotMap.keys().next().value;
        if (oldest) domainNextSlotMap.delete(oldest);
    }
    return true;
}

function decodeHtmlBuffer(buffer, contentTypeHeader = '') {
    const ct = String(contentTypeHeader || '').toLowerCase();
    const headAscii = buffer.subarray(0, 2048).toString('latin1').toLowerCase();
    const isEucKr =
        /euc-kr|cp949|ks_c_5601/i.test(ct) ||
        /charset\s*=\s*["']?\s*(euc-kr|cp949|ks_c_5601)/i.test(headAscii);
    return isEucKr ? eucKrDecoder.decode(buffer) : buffer.toString('utf8');
}

async function fetchSafeBufferWithRedirects(startUrl, { maxBytes = 65536, timeoutMs = 2000, skipWaitIfBusy = false } = {}) {
    let currentUrl = rewriteKoreanFetchUrl(startUrl);
    for (let hop = 0; hop <= 3; hop += 1) {
        const safeUrl = await validateSafePublicUrl(currentUrl);
        if (!safeUrl) return { ok: false, reason: 'unsafe_url' };

        const allowed = await isAllowedByRobots(safeUrl);
        if (!allowed) return { ok: false, reason: 'robots_disallowed' };

        const slotOk = await acquireDomainSlot(safeUrl.hostname, skipWaitIfBusy);
        if (!slotOk) return { ok: false, reason: 'domain_busy' };

        let res;
        try {
            res = await axios.get(safeUrl.toString(), {
                timeout: timeoutMs,
                maxRedirects: 0,
                httpAgent: safeHttpAgent,
                httpsAgent: safeHttpsAgent,
                responseType: 'stream',
                headers: {
                    'User-Agent': BOT_USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.7'
                },
                validateStatus: (s) => s >= 200 && s < 400
            });
        } catch (err) {
            return { ok: false, reason: 'network_error', status: err?.response?.status || 0 };
        }

        if (res.status >= 300 && res.status < 400 && res.headers?.location) {
            if (res.data && typeof res.data.destroy === 'function') res.data.destroy();
            try {
                currentUrl = new URL(res.headers.location, safeUrl.toString()).toString();
                continue;
            } catch (_) {
                return { ok: false, reason: 'bad_redirect' };
            }
        }

        const ct = String(res.headers?.['content-type'] || '').toLowerCase();
        if (ct && !/(text\/html|application\/xhtml|xml|rss|atom|text\/plain)/i.test(ct)) {
            if (res.data && typeof res.data.destroy === 'function') res.data.destroy();
            return { ok: false, reason: 'non_text_content' };
        }

        const chunks = [];
        let totalBytes = 0;
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (res.data && typeof res.data.destroy === 'function') res.data.destroy();
                resolve();
            }, timeoutMs);

            res.data.on('data', (chunk) => {
                chunks.push(chunk);
                totalBytes += chunk.length;
                if (totalBytes >= maxBytes) {
                    clearTimeout(timer);
                    res.data.destroy();
                    resolve();
                }
            });
            res.data.on('end', () => { clearTimeout(timer); resolve(); });
            res.data.on('close', () => { clearTimeout(timer); resolve(); });
            res.data.on('error', () => { clearTimeout(timer); resolve(); });
        });

        const buf = Buffer.concat(chunks).subarray(0, maxBytes);
        const text = decodeHtmlBuffer(buf, ct);
        return { ok: true, finalUrl: safeUrl.toString(), status: res.status, contentType: ct, text };
    }
    return { ok: false, reason: 'too_many_redirects' };
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_, n) => {
            const code = parseInt(n, 10);
            return code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : '';
        });
}

function extractMetaContent(html, keys) {
    for (const key of keys) {
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, 'i');
        const m1 = html.match(re1);
        if (m1 && m1[1]) return decodeHtmlEntities(m1[1]).trim();

        const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, 'i');
        const m2 = html.match(re2);
        if (m2 && m2[1]) return decodeHtmlEntities(m2[1]).trim();
    }
    return '';
}

function resolveSafeImageUrl(rawImg, baseUrl) {
    if (!rawImg) return null;
    try {
        const resolved = new URL(rawImg.trim(), baseUrl);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
        if (/(1x1|pixel|spacer|blank\.gif|logo_default)/i.test(resolved.pathname)) return null;
        return resolved.toString();
    } catch (_) {
        return null;
    }
}

function extractReadableBody(html, maxChars = 4000) {
    const cleaned = String(html || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|iframe|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(br|p|div|li|h[1-6]|tr|article|section)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeHtmlEntities(cleaned)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim()
        .slice(0, maxChars);
}

async function fetchPageDocument(rawUrl, { fullBody = false, timeoutMs = 1600, skipWaitIfBusy = false } = {}) {
    const fetched = await fetchSafeBufferWithRedirects(rawUrl, {
        maxBytes: fullBody ? 180 * 1024 : 52 * 1024,
        timeoutMs,
        skipWaitIfBusy
    });
    if (!fetched.ok) return { ok: false, reason: fetched.reason };

    const html = fetched.text;
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (
        extractMetaContent(html, ['og:title', 'twitter:title']) ||
        (titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '')
    ).slice(0, 200);

    const description = extractMetaContent(html, ['og:description', 'description', 'twitter:description'])
        .replace(/\s+/g, ' ')
        .slice(0, 400);

    const rawOgImg = extractMetaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']);
    const ogImage = resolveSafeImageUrl(rawOgImg, fetched.finalUrl);
    const siteName = extractMetaContent(html, ['og:site_name']).slice(0, 60);
    const bodyText = fullBody ? extractReadableBody(html, 4000) : '';

    return {
        ok: true,
        url: rawUrl,
        finalUrl: fetched.finalUrl,
        title,
        description,
        ogImage,
        siteName,
        bodyText
    };
}

/**
 * RSS / Atom 피드 또는 웹 목록 시드에서 최신 문서 항목 추출
 */
async function fetchSeedFeedItems(seedUrl, maxItems = 8) {
    const fetched = await fetchSafeBufferWithRedirects(seedUrl, { maxBytes: 220 * 1024, timeoutMs: 4500 });
    if (!fetched.ok) return { ok: false, reason: fetched.reason, items: [] };

    const xml = fetched.text;
    const items = [];

    // 1) RSS <item> / Atom <entry> 파싱
    const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
    for (const block of blocks) {
        if (items.length >= maxItems) break;
        const tMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const lMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
        const dMatch = block.match(/<(description|summary|content:encoded|content)[^>]*>([\s\S]*?)<\/\1>/i);
        const pMatch = block.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i);
        const rawLink = lMatch ? decodeHtmlEntities(lMatch[1]).replace(/<[^>]+>/g, '').trim() : '';
        if (!rawLink) continue;

        let fullLink = '';
        try {
            fullLink = new URL(rawLink, fetched.finalUrl).toString();
        } catch (_) {
            continue;
        }
        const title = tMatch ? decodeHtmlEntities(tMatch[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        const descHtml = dMatch ? decodeHtmlEntities(dMatch[2]) : '';
        const mediaImg = block.match(/<(?:media:thumbnail|media:content|enclosure)[^>]+url=["']([^"']+)["']/i);
        const imgInDesc = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        const rawThumb = (mediaImg && mediaImg[1]) || (imgInDesc && imgInDesc[1]) || '';
        const snippet = descHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);

        if (title && fullLink) {
            items.push({
                title: title.slice(0, 200),
                url: fullLink,
                snippet,
                ogImage: rawThumb ? resolveSafeImageUrl(rawThumb, fullLink) : null,
                publishedAt: pMatch ? decodeHtmlEntities(pMatch[2]).replace(/<[^>]+>/g, '').trim().slice(0, 25) : ''
            });
        }
    }

    if (items.length > 0) return { ok: true, items };

    // 2) 일반 웹페이지 시드일 경우 같은 도메인의 본문형 링크 추출
    const baseObj = new URL(fetched.finalUrl);
    const seen = new Set();
    const anchorRe = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(xml)) !== null && items.length < maxItems) {
        const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        if (text.length < 8 || text.length > 140) continue;
        try {
            const u = new URL(m[1], fetched.finalUrl);
            if (u.hostname !== baseObj.hostname || u.pathname === baseObj.pathname) continue;
            const href = u.toString();
            if (seen.has(href)) continue;
            seen.add(href);
            items.push({ title: text, url: href, snippet: '', ogImage: null, publishedAt: '' });
        } catch (_) {}
    }

    return { ok: true, items };
}

function getRobotsCacheSize() {
    return robotsCache.size;
}

function clearRobotsCache() {
    const n = robotsCache.size;
    robotsCache.clear();
    return n;
}

module.exports = {
    validateSafePublicUrl,
    fetchPageDocument,
    fetchSeedFeedItems,
    getRobotsCacheSize,
    clearRobotsCache
};
