/**
 * 🔎 JG 포털 AI 비서 - 대화 데이터 추출기 (aiDataExtractor.service.js)
 * - [핵심 역할] 의도 정규식에 걸리지 않은 일반 대화에서도 발화 키워드로 접근 가능한 DB(뉴스룸·가족 위키)를 검색해 근거로 주입
 * - [최신성 보강] 모델 학습 시점(과거) 지식으로 답하지 않도록, 오늘의 주요 뉴스·증시 지표를 배경 정보로 함께 제공
 * - [보안] 개인 자산(asset.db)·건강 정보는 다루지 않음 (aiContextRouter의 관리자 한정 규칙 그대로 유지)
 * - [규칙 3] 500줄 이하 모듈화
 */

const { searchNewsByKeyword, getLatestByCategories } = require('./newsHeadline.service');
const { searchWikiContent } = require('./wikiSummary.service');

// 인사·맞장구 등 짧은 잡담은 DB 검색 생략 (불필요한 지연·토큰 방지)
const SMALLTALK_RE = /^(안녕|하이|ㅎㅇ|반가|고마|감사|ㅋ+|ㅎ+|좋아|응|네|넵|아니|그래|잘\s*자|굿모닝|수고)/;

// 전망·예측·추론 질문 (최신 기사 다건을 근거로 주입해 학습 시점(과거) 기준 추론 방지)
const FORECAST_RE = /(앞으로|향후|전망|예측|예상|추론|추측|어떻게\s*될|될\s*것\s*같|발생할|일어날|미래|시나리오|흐름)/;
const WORLD_RE = /(세계|국제|해외|글로벌|외신|미국|중국|일본|러시아|유럽|중동)/;
const WORLD_CATS = ['국제/세계', '국제·세계'];

function isSmalltalk(prompt) {
    const t = String(prompt || '').trim();
    return t.length < 10 && SMALLTALK_RE.test(t);
}

function isForecastQuery(prompt) {
    return FORECAST_RE.test(String(prompt || ''));
}

function fmtArticle(a) {
    const when = a.published_at ? String(a.published_at).slice(5, 16) : (a.date || '');
    const summary = a.summary ? `\n- 요약: ${String(a.summary).slice(0, 150)}` : '';
    return `■ [${a.category_name || '기타'}] ${a.title} (${a.media_name || '언론사 미상'}, ${when})${summary}`;
}

/**
 * 발화 기반 추가 컨텍스트 생성 (실패 시 빈 문자열로 무중단 진행)
 * @param {{prompt: string, intents: Set<string>, summaryContext: object|null}} params
 * @returns {Promise<string>}
 */
async function buildExtractedContext({ prompt, intents, summaryContext = null }) {
    const text = String(prompt || '').trim();
    if (!text) return '';
    const skipSearch = isSmalltalk(text);
    const todayKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const tasks = [];

    // 1) 뉴스룸 키워드 검색 (NEWS 의도는 라우터에서 이미 검색하므로 중복 방지)
    if (!skipSearch && !intents.has('NEWS')) {
        tasks.push(
            searchNewsByKeyword(text, todayKst, 5).then(({ keywords, items }) => {
                // 제목에 키워드가 직접 들어간 기사만 채택 (요약 우연 일치로 인한 엉뚱한 근거 방지)
                const hits = (items || []).filter(a => a && a.title && keywords.some(k => a.title.includes(k)));
                if (!hits.length) return '';
                return `[대화 관련 뉴스룸 기사 (키워드: ${keywords.join(', ')})]\n${hits.map(fmtArticle).join('\n')}`;
            }).catch(() => '')
        );
    }

    // 2) 가족 위키 검색 (WIKI 의도는 라우터에서 이미 검색하므로 중복 방지)
    if (!skipSearch && !intents.has('WIKI')) {
        tasks.push(
            searchWikiContent(text, 2).then(pages => {
                if (!Array.isArray(pages) || !pages.length) return '';
                return '[대화 관련 가족 위키 발췌 (질문과 무관하면 무시)]\n' +
                    pages.map(p => `■ [${p.category}] ${p.title}\n${String(p.excerpt || '').slice(0, 300)}`).join('\n');
            }).catch(() => '')
        );
    }

    // 3) 최신 세상 소식 배경 (뉴스·시황·종합현황 의도는 라우터가 이미 주입하므로 제외)
    const news = summaryContext && summaryContext.news;
    if (news && !intents.has('NEWS') && !intents.has('ASSET') && !intents.has('GENERAL_OVERVIEW')) {
        const q = v => (v && typeof v === 'object') ? (v.price && v.price !== '-' ? `${v.price}${v.ratio && v.ratio !== '-' ? `(${v.ratio})` : ''}` : '-') : (v || '-');
        const lines = [];
        if (news.market) lines.push(`- 증시: 코스피 ${q(news.market.kospi)}, 코스닥 ${q(news.market.kosdaq)}, 원/달러 ${q(news.market.usd_krw)}`);
        const issues = (Array.isArray(news.topIssues) && news.topIssues.length > 0) ? news.topIssues : (Array.isArray(news.recommendedArticles) ? news.recommendedArticles : []);
        if (issues.length) lines.push(`- 오늘 주요 뉴스: ${issues.slice(0, 3).map(a => `[${a.category_name || '기타'}] ${a.title}`).join(' / ')}`);
        if (lines.length) tasks.push(Promise.resolve(`[오늘의 세상 소식 (${todayKst} 기준 배경 정보)]\n${lines.join('\n')}`));
    }

    // 4) 전망·예측·세계 정세 질문 → 국제·경제·정치 분야 최신 기사 다건 (키워드 매칭 실패 대비, 날짜 포함)
    const forecast = isForecastQuery(text);
    if (!skipSearch && (forecast || (WORLD_RE.test(text) && intents.has('NEWS')))) {
        const groups = [[WORLD_CATS, '국제·세계', WORLD_RE.test(text) ? 6 : 4]];
        if (forecast) groups.push([['경제'], '경제', 3], [['정치'], '정치', 3]);
        tasks.push(
            Promise.all(groups.map(([cats, , n]) => getLatestByCategories(cats, n).catch(() => []))).then(lists => {
                const lines = lists.flat().filter(a => a && a.title).map(fmtArticle);
                if (!lines.length) return '';
                return `[전망·추론용 최신 기사 (${todayKst} 기준, 이 기사들을 근거로 앞으로의 흐름을 추론하세요)]\n${lines.join('\n')}`;
            }).catch(() => '')
        );
    }

    if (!tasks.length) return '';
    const results = await Promise.all(tasks);
    const merged = results.filter(Boolean).join('\n\n');
    return merged ? `\n\n${merged}` : '';
}

module.exports = { buildExtractedContext, isSmalltalk, isForecastQuery };
