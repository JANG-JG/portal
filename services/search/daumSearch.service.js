/**
 * 🟡 JG 통합 검색 - 카카오·다음(Daum) 오픈 검색 어댑터 (daumSearch.service.js)
 * - 기존 KAKAO_REST_API_KEY 재활용 (추가 키 발급 불필요)
 * - 웹문서(web) · 블로그(blog, 썸네일 내장) · 카페(cafe, 썸네일 내장) · 이미지(image) 검색 지원
 * - URL 정규화 기반 네이버+다음 중복 제거 및 썸네일 보존 병합 유틸 포함
 */

const axios = require('axios');
const {
    incrementUsage,
    getCache,
    setCache,
    isSubApiAuthBlocked,
    markSubApiAuthBlocked
} = require('./externalSearchState.service');

const DAUM_API_BASE = 'https://dapi.kakao.com/v2/search';
const MAX_DAUM_PAGE = 50;

function getKakaoRestKey() {
    return (process.env.KAKAO_REST_API_KEY || '').trim();
}

function isDaumConfigured() {
    return Boolean(getKakaoRestKey());
}

function stripHtmlTags(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDaumDate(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
        const d = new Date(parsed);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}.${m}.${day}`;
    }
    return raw.slice(0, 10);
}

function extractDomain(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        return new URL(url).hostname.replace(/^www\./i, '');
    } catch (_) {
        return '';
    }
}

function sanitizeHttpImage(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    return trimmed;
}

/**
 * URL 정규화 키 (네이버·다음 교차 중복 제거용)
 * - m.blog.naver.com / blog.naver.com 통일, 트래킹 쿼리 제거, 말미 슬래시 제거
 */
function normalizeCanonicalUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const u = new URL(rawUrl.trim());
        let host = u.hostname.toLowerCase().replace(/^www\./, '');
        let pathname = u.pathname.replace(/\/+$/, '') || '/';

        if (host === 'm.blog.naver.com') host = 'blog.naver.com';
        if (host === 'm.cafe.naver.com') host = 'cafe.naver.com';
        if (host === 'm.cafe.daum.net') host = 'cafe.daum.net';

        if (host === 'blog.naver.com' && u.searchParams.get('blogId') && u.searchParams.get('logNo')) {
            pathname = `/${u.searchParams.get('blogId')}/${u.searchParams.get('logNo')}`;
            return `${host}${pathname}`;
        }

        const cleanParams = [];
        for (const [k, v] of u.searchParams.entries()) {
            if (/^(utm_|fbclid|gclid|NaPm|from|where|sm|ssc)/i.test(k)) continue;
            cleanParams.push(`${k}=${v}`);
        }
        cleanParams.sort();
        const qs = cleanParams.length ? `?${cleanParams.join('&')}` : '';
        return `${host}${pathname}${qs}`;
    } catch (_) {
        return rawUrl.trim().toLowerCase().replace(/\/+$/, '');
    }
}

function emptyDaumBucket(size = 10, page = 1) {
    return {
        items: [],
        meta: { total: 0, page, display: size, totalPages: 0, hasMore: false }
    };
}

/**
 * 카카오·다음 검색 공통 호출기
 * @param {'web'|'blog'|'cafe'|'image'} type
 */
async function fetchDaumEndpoint(type, query, size = 10, page = 1) {
    const key = getKakaoRestKey();
    const safeSize = Math.max(1, Math.min(50, parseInt(size, 10) || 10));
    const safePage = Math.max(1, Math.min(MAX_DAUM_PAGE, parseInt(page, 10) || 1));

    if (!key || !query || isSubApiAuthBlocked(`daum_${type}`)) {
        return emptyDaumBucket(safeSize, safePage);
    }

    const cacheKey = `daum:${type}:${safePage}:${safeSize}:${query.toLowerCase()}`;
    const cached = getCache(cacheKey);
    if (cached !== null) {
        if (Array.isArray(cached.items)) return cached;
        return emptyDaumBucket(safeSize, safePage);
    }

    try {
        await incrementUsage('daumSearch', false);
        const res = await axios.get(`${DAUM_API_BASE}/${type}`, {
            params: { query, size: safeSize, page: safePage, sort: 'accuracy' },
            headers: { Authorization: `KakaoAK ${key}` },
            timeout: 3500
        });

        const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
        const metaRaw = res.data?.meta || {};
        const pageable = Number(metaRaw.pageable_count) || docs.length;
        const total = Math.max(docs.length, Number(metaRaw.total_count) || pageable);
        const totalPages = pageable > 0 ? Math.min(MAX_DAUM_PAGE, Math.ceil(pageable / safeSize)) : 0;
        const isEnd = Boolean(metaRaw.is_end);

        const items = docs.map((it) => {
            if (type === 'image') {
                return {
                    title: stripHtmlTags(it.display_sitename || it.collection || query),
                    collection: stripHtmlTags(it.collection || ''),
                    siteName: stripHtmlTags(it.display_sitename || '') || extractDomain(it.doc_url),
                    thumbnail: sanitizeHttpImage(it.thumbnail_url),
                    imageUrl: sanitizeHttpImage(it.image_url) || sanitizeHttpImage(it.thumbnail_url),
                    docUrl: it.doc_url || '',
                    width: Number(it.width) || 0,
                    height: Number(it.height) || 0,
                    date: formatDaumDate(it.datetime)
                };
            }

            const link = it.url || '';
            return {
                title: stripHtmlTags(it.title),
                description: stripHtmlTags(it.contents),
                link,
                domain: extractDomain(link),
                bloggername: stripHtmlTags(it.blogname || it.cafename || ''),
                cafename: stripHtmlTags(it.cafename || ''),
                thumbnail: sanitizeHttpImage(it.thumbnail),
                postdate: formatDaumDate(it.datetime),
                date: formatDaumDate(it.datetime),
                provider: type === 'cafe' ? 'daum_cafe' : `daum_${type}`
            };
        }).filter((it) => (type === 'image' ? Boolean(it.thumbnail && it.docUrl) : Boolean(it.link && it.title)));

        const bucket = {
            items,
            meta: {
                total,
                page: safePage,
                display: safeSize,
                totalPages,
                hasMore: !isEnd && safePage < totalPages && items.length > 0
            }
        };
        setCache(cacheKey, bucket);
        return bucket;
    } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
            markSubApiAuthBlocked(`daum_${type}`);
        }
        await incrementUsage('daumSearch', true);
        return emptyDaumBucket(safeSize, safePage);
    }
}

/**
 * 네이버 결과와 다음 결과를 정규화 URL 기준으로 교차 병합 (썸네일·날짜 자동 보강)
 */
function mergeDedupedDocuments(primaryItems = [], secondaryItems = [], maxCount = 15) {
    const map = new Map();
    const order = [];

    const ingest = (item, fromSecondary = false) => {
        if (!item || !item.link) return;
        const key = normalizeCanonicalUrl(item.link);
        if (!key) return;
        const existing = map.get(key);
        if (!existing) {
            const copy = { ...item };
            if (fromSecondary && !copy.provider) copy.provider = 'daum';
            map.set(key, copy);
            order.push(key);
        } else {
            if (!existing.thumbnail && item.thumbnail) existing.thumbnail = item.thumbnail;
            if (!existing.date && (item.date || item.postdate)) existing.date = item.date || item.postdate;
            if (!existing.postdate && item.postdate) existing.postdate = item.postdate;
            if (!existing.bloggername && item.bloggername) existing.bloggername = item.bloggername;
            if ((item.description || '').length > (existing.description || '').length + 25) {
                existing.description = item.description;
            }
        }
    };

    // 교차 배치(Interleaving)로 포털 편중 없이 골고루 병합
    const maxLen = Math.max(primaryItems.length, secondaryItems.length);
    for (let i = 0; i < maxLen; i += 1) {
        if (i < primaryItems.length) ingest(primaryItems[i], false);
        if (i < secondaryItems.length) ingest(secondaryItems[i], true);
    }

    return order.slice(0, maxCount).map((k) => map.get(k));
}

module.exports = {
    isDaumConfigured,
    normalizeCanonicalUrl,
    fetchDaumEndpoint,
    mergeDedupedDocuments,
    emptyDaumBucket
};
