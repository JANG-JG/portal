/**
 * newsHeadline.service.js - 뉴스룸(news-dashboard)과 동일한 기준의 '오늘의 주요 이슈' 선별
 * - news-dashboard/services/cluster_service.py 의 제목 키워드 군집화 로직을 Node로 이식
 * - 오늘 수집된 기사 중 여러 언론사가 함께 다룬 이슈 순으로 대표 기사를 반환
 */
const { newsDb } = require('./db');

const CACHE_TTL_MS = 2 * 60 * 1000; // 2분 (뉴스룸과 동일)
let cache = { date: '', ts: 0, items: [] };

const STOPWORDS = new Set([
    '단독', '속보', '종합', '포토', '영상', '인터뷰', '현장', '카드뉴스', '사설', '칼럼',
    '오늘', '내일', '어제', '올해', '내년', '최근', '결국', '다시', '또', '왜', '어쩌다',
    '무슨', '어디', '누구', '어떻게', '논란', '파문', '주목', '발칵', '충격', '경악',
    '눈길', '화제', '일파만파', '비상', '경고', '우려', '기대', '전망', '발표', '확인',
    '공개', '시작', '마무리', '진행', '예정', '가능', '불가', '이유', '배경', '원인',
    '기자', '뉴스', '연합', '헤럴드', '조선', '동아', '중앙', '매경', '한경'
]);
const MAJOR_MEDIA = ['연합뉴스', '뉴스1', '뉴시스', 'KBS', 'MBC', 'SBS', 'YTN'];

function extractKeywords(title) {
    if (!title) return new Set();
    const clean = String(title)
        .replace(/&quot;|&#39;|&amp;|&lt;|&gt;/g, ' ')
        .replace(/\[.*?\]|\(.*?\)|<.*?>|【.*?】|['"‘’“”·…!?,]/g, ' ');
    const words = clean.match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
    return new Set(words.filter(w => !STOPWORDS.has(w) && !/^\d+$/.test(w)));
}

function isSameTopic(a, b) {
    if (!a.size || !b.size) return false;
    let common = 0;
    a.forEach(w => { if (b.has(w)) common++; });
    if (common >= 3) return true;
    const overlap = common / Math.min(a.size, b.size);
    return common >= 2 && overlap >= 0.35;
}

function leadScore(art) {
    let score = 0;
    if (art.image_url) score += 50;
    if (art.summary && art.summary.length >= 40) score += 40;
    const media = art.media_name || '';
    if (MAJOR_MEDIA.some(m => media.includes(m))) score += 20;
    const len = (art.title || '').length;
    if (len >= 25 && len <= 55) score += 10;
    return score;
}

function clusterTopIssues(articles, limit) {
    const buckets = {};
    articles.forEach(art => {
        const cat = art.category_name || '기타';
        (buckets[cat] = buckets[cat] || []).push(art);
    });

    const allClusters = [];
    Object.keys(buckets).forEach(cat => {
        const groups = [];
        const kwSets = [];
        buckets[cat].forEach(art => {
            const kw = extractKeywords(art.title);
            const idx = kwSets.findIndex(set => isSameTopic(kw, set));
            if (idx >= 0) {
                groups[idx].push(art);
                kw.forEach(w => kwSets[idx].add(w));
            } else {
                groups.push([art]);
                kwSets.push(kw);
            }
        });
        groups.forEach(grp => {
            const lead = grp.slice().sort((x, y) => leadScore(y) - leadScore(x))[0];
            const mediaCount = new Set(grp.map(a => a.media_name).filter(Boolean)).size;
            allClusters.push({ lead, total: grp.length, mediaCount, category: cat });
        });
    });

    const mega = allClusters
        .filter(c => c.total >= 2)
        .sort((a, b) => (b.total - a.total) || (b.mediaCount - a.mediaCount) || ((b.lead.id || 0) - (a.lead.id || 0)));
    // 메가 이슈가 부족하면 최신 기사로 보충
    const latest = allClusters.filter(c => c.total < 2).sort((a, b) => (b.lead.id || 0) - (a.lead.id || 0));
    return mega.concat(latest).slice(0, limit).map(c => ({
        title: c.lead.title,
        link: c.lead.link,
        media_name: c.lead.media_name,
        category_name: c.category,
        published_at: c.lead.published_at,
        report_count: c.total
    }));
}

/**
 * 오늘(KST)의 주요 이슈 Top N 반환 (2분 캐시)
 * @param {string} todayKst - 'YYYY-MM-DD'
 */
function getTopNewsIssues(todayKst, limit = 5) {
    let targetDate = todayKst;
    let maxLimit = limit;
    if (typeof todayKst === 'number') {
        maxLimit = todayKst;
        targetDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    } else if (!targetDate || typeof targetDate !== 'string') {
        targetDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    }

    const now = Date.now();
    if (cache.date === targetDate && now - cache.ts < CACHE_TTL_MS && cache.items.length) {
        return Promise.resolve(cache.items.slice(0, maxLimit));
    }
    return new Promise(resolve => {
        if (!newsDb) return resolve([]);
        newsDb.all(
            `SELECT id, category_name, title, link, media_name, summary, published_at, image_url
             FROM news_articles
             WHERE date = ? AND category_name != '속보' AND title NOT LIKE '%[속보]%' AND title NOT LIKE '%(속보)%'
             ORDER BY id DESC LIMIT 600`,
            [targetDate],
            (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    // 🛡️ 당일 기사가 아직 없거나 적을 경우(이른 아침/수집 대기) 최근 기사 200건 기반 이슈 군집화 폴백
                    return newsDb.all(
                        `SELECT id, category_name, title, link, media_name, summary, published_at, image_url
                         FROM news_articles
                         WHERE category_name != '속보' AND title NOT LIKE '%[속보]%' AND title NOT LIKE '%(속보)%'
                         ORDER BY id DESC LIMIT 200`,
                        [],
                        (fErr, fRows) => {
                            if (fErr || !fRows || fRows.length === 0) return resolve([]);
                            try {
                                const fallbackItems = clusterTopIssues(fRows, 8);
                                resolve(fallbackItems.slice(0, maxLimit));
                            } catch (e2) {
                                resolve([]);
                            }
                        }
                    );
                }
                try {
                    const items = clusterTopIssues(rows, 8);
                    cache = { date: targetDate, ts: now, items };
                    resolve(items.slice(0, maxLimit));
                } catch (e) {
                    resolve([]);
                }
            }
        );
    });
}

// 질문에서 검색 키워드 추출 시 제외할 일상어/요청어
const QUERY_STOPWORDS = new Set([
    '뉴스', '기사', '소식', '속보', '헤드라인', '이슈', '시사', '동향', '주요', '최근', '요즘', '오늘', '어제',
    '관련', '내용', '확인', '알려', '알려줘', '알려주세요', '찾아', '찾아줘', '검색', '해줘', '해주세요', '정리',
    '요약', '있어', '있나', '있는지', '어떤', '무슨', '어때', '대해', '대해서', '대한', '좀', '나온', '나왔어'
]);
const PARTICLE_RE = /(에\s*대한|에\s*대해서?|에서는?|으로|이랑|하고|까지|부터|관련|은|는|이|가|을|를|에|의|로|도|만|와|과)$/;

function extractQueryKeywords(prompt) {
    const words = String(prompt || '').replace(/['"‘’“”·…!?,.~]/g, ' ').match(/[가-힣a-zA-Z0-9]{2,}/g) || [];
    const out = [];
    words.forEach(w => {
        let k = w.length > 2 ? w.replace(PARTICLE_RE, '') : w;
        if (k.length < 2 || QUERY_STOPWORDS.has(k) || QUERY_STOPWORDS.has(w) || /^\d+$/.test(k)) return;
        if (/(줘|줄래|주세요|해요|할까|인가|있어|었어|았어|니|나요|까요?|습니까|어요)$/.test(w)) return;
        if (!out.includes(k)) out.push(k);
    });
    return out.slice(0, 4);
}

/**
 * 질문 키워드로 최근 7일 뉴스 검색 (제목 일치 우선, 중복 제목 제거)
 * @returns {Promise<{keywords: string[], items: object[]}>}
 */
function searchNewsByKeyword(prompt, todayKst, limit = 5) {
    const keywords = extractQueryKeywords(prompt);
    if (!keywords.length || !newsDb) return Promise.resolve({ keywords, items: [] });
    const validToday = (typeof todayKst === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todayKst))
        ? todayKst
        : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const maxLimit = typeof limit === 'number' ? limit : 5;
    const from = new Date(new Date(validToday + 'T00:00:00+09:00').getTime() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const cond = keywords.map(() => '(title LIKE ? OR summary LIKE ?)').join(' OR ');
    const params = [from];
    keywords.forEach(k => params.push(`%${k}%`, `%${k}%`));
    return new Promise(resolve => {
        newsDb.all(
            `SELECT id, date, category_name, title, media_name, summary, published_at FROM news_articles
             WHERE date >= ? AND (${cond}) ORDER BY id DESC LIMIT 200`,
            params,
            (err, rows) => {
                if (err || !rows) return resolve({ keywords, items: [] });
                const seen = new Set();
                const scored = rows.filter(r => {
                    if (!r.title || seen.has(r.title)) return false;
                    seen.add(r.title);
                    return true;
                }).map(r => {
                    let score = 0;
                    keywords.forEach(k => {
                        if (r.title.includes(k)) score += 3;
                        else if ((r.summary || '').includes(k)) score += 1;
                    });
                    return { r, score };
                }).sort((a, b) => (b.score - a.score) || ((b.r.id || 0) - (a.r.id || 0)));
                resolve({ keywords, items: scored.slice(0, limit).map(s => s.r) });
            }
        );
    });
}

/**
 * 최근 N시간 이내 속보 (발행 시각 최신순, 중복 제목 제거)
 * @returns {Promise<object[]>}
 */
function getRecentBreaking(hours = 2, limit = 3) {
    if (!newsDb) return Promise.resolve([]);
    const threshold = new Date(Date.now() - hours * 3600000)
        .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
    return new Promise(resolve => {
        newsDb.all(
            `SELECT id, date, category_name, title, media_name, summary, published_at FROM news_articles
             WHERE (category_name = '속보' OR title LIKE '%[속보]%' OR title LIKE '%(속보)%')
               AND published_at >= ?
             ORDER BY published_at DESC, id DESC LIMIT 30`,
            [threshold],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const seen = new Set();
                resolve(rows.filter(r => {
                    if (!r.title || seen.has(r.title)) return false;
                    seen.add(r.title);
                    return true;
                }).slice(0, limit));
            }
        );
    });
}

/**
 * 지정 분야(카테고리)의 최근 기사 (최신순, 중복 제목 제거) - 예: 증시/가상자산, 경제
 * @returns {Promise<object[]>}
 */
function getLatestByCategories(categories = [], limit = 5) {
    if (!newsDb || !categories.length) return Promise.resolve([]);
    const ph = categories.map(() => '?').join(',');
    return new Promise(resolve => {
        newsDb.all(
            `SELECT id, date, category_name, title, media_name, summary, published_at FROM news_articles
             WHERE category_name IN (${ph}) ORDER BY id DESC LIMIT 60`,
            categories,
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const seen = new Set();
                resolve(rows.filter(r => r.title && !seen.has(r.title) && seen.add(r.title)).slice(0, limit));
            }
        );
    });
}

/**
 * 네이트 실시간 랭킹 Top N 기사 및 핵심 요약 조회 (AI 심층 브리핑 연동)
 * @returns {Promise<object[]>}
 */
function getNateRankings(limit = 5) {
    if (!newsDb) return Promise.resolve([]);
    return new Promise(resolve => {
        newsDb.all(
            `SELECT rank, title, media_name, summary, rank_change, collected_at
             FROM nate_ranking
             ORDER BY id DESC, rank ASC
             LIMIT ?`,
            [limit],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(rows);
            }
        );
    });
}

module.exports = {
    getTopNewsIssues,
    searchNewsByKeyword,
    getRecentBreaking,
    getLatestByCategories,
    getDailyWeatherSummary,
    getNateRankings,
};
