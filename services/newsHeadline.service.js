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
    const now = Date.now();
    if (cache.date === todayKst && now - cache.ts < CACHE_TTL_MS && cache.items.length) {
        return Promise.resolve(cache.items.slice(0, limit));
    }
    return new Promise(resolve => {
        if (!newsDb) return resolve([]);
        newsDb.all(
            `SELECT id, category_name, title, link, media_name, summary, published_at, image_url
             FROM news_articles
             WHERE date = ? AND category_name != '속보' AND title NOT LIKE '%[속보]%' AND title NOT LIKE '%(속보)%'
             ORDER BY id DESC LIMIT 600`,
            [todayKst],
            (err, rows) => {
                if (err || !rows || rows.length === 0) return resolve([]);
                try {
                    const items = clusterTopIssues(rows, 8);
                    cache = { date: todayKst, ts: now, items };
                    resolve(items.slice(0, limit));
                } catch (e) {
                    resolve([]);
                }
            }
        );
    });
}

module.exports = { getTopNewsIssues };
