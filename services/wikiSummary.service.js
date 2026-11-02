/**
 * 📖 JG 포털 가족 위키 요약 및 지식 검색 서비스 (wikiSummary.service.js)
 * - wiki.db (위키 문서, D-Day, 할 일/루틴) 연동
 * - AI 비서 브리핑 및 실시간 대화 컨텍스트 주입 (RAG)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { wikiDb } = require('./db');

/**
 * KST 기준 D-Day 계산 헬퍼
 */
function calcDDay(targetDateStr) {
    if (!targetDateStr) return '';
    try {
        const cleanDate = targetDateStr.slice(0, 10);
        const target = new Date(cleanDate + 'T00:00:00+09:00');
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        const today = new Date(todayStr + 'T00:00:00+09:00');
        if (isNaN(target.getTime()) || isNaN(today.getTime())) return '';
        const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'D-Day';
        if (diffDays > 0) return `D-${diffDays}`;
        return `D+${Math.abs(diffDays)}`;
    } catch (e) {
        return '';
    }
}

/**
 * 1. 가족 위키 주요 현황 취합 (D-Day, 미완료 할 일, 최근 문서)
 */
async function getWikiSummary() {
    if (!wikiDb) return null;

    // 1) 다가오는 중요 D-Day (미완료 5건)
    const ddayPromise = new Promise((resolve) => {
        wikiDb.all(
            "SELECT id, category, title, target_date, cycle_days, memo FROM family_dday WHERE is_completed = 0 ORDER BY target_date ASC LIMIT 5",
            [],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const formatted = rows.map(r => ({
                    id: r.id,
                    category: r.category,
                    title: r.title,
                    targetDate: r.target_date,
                    dday: calcDDay(r.target_date),
                    memo: r.memo
                }));
                resolve(formatted);
            }
        );
    });

    // 2) 오늘 진행 중인 미완료 가족 할 일 & 루틴 (5건)
    const todosPromise = new Promise((resolve) => {
        wikiDb.all(
            "SELECT id, content, is_routine, assignee FROM family_todos WHERE is_completed = 0 ORDER BY id ASC LIMIT 5",
            [],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const formatted = rows.map(r => ({
                    id: r.id,
                    content: r.content,
                    isRoutine: !!r.is_routine,
                    assignee: r.assignee || '가족'
                }));
                resolve(formatted);
            }
        );
    });

    // 3) 최근 등록/수정된 가족 위키 문서 (5건)
    const pagesPromise = new Promise((resolve) => {
        wikiDb.all(
            "SELECT id, category, title, slug, updated_at FROM wiki_pages ORDER BY updated_at DESC LIMIT 5",
            [],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                resolve(rows);
            }
        );
    });

    try {
        const [ddays, todos, pages] = await Promise.all([ddayPromise, todosPromise, pagesPromise]);
        return {
            ddays,
            todos,
            pages
        };
    } catch (e) {
        console.warn('[WikiSummary] 위키 데이터 조회 실패:', e.message);
        return null;
    }
}

/**
 * 2. 사용자 질문 키워드 기반 연관 위키 문서 검색 (RAG)
 */
async function searchWikiContent(query, limit = 2) {
    if (!wikiDb || !query || typeof query !== 'string') return [];

    // 불용어 및 제어 문자 제거 후 의미 있는 단어 추출 (한글 2글자 이상, 영문 3글자 이상)
    const stopWords = new Set([
        '우리', '우리집', '위키', '가족', '가족위키', '알려줘', '알려', '어떻게', '뭐야', '무엇', '있는', '있어', 
        '검색', '내용', '적혀', '관련', '확인', '진짜', '정말', '해줘', '부탁'
    ]);

    const words = query
        .replace(/[^\w\s가-힣]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 2 && !stopWords.has(w));

    if (words.length === 0) return [];

    return new Promise((resolve) => {
        // 단어별 LIKE 조건 생성
        const clauses = words.map(() => '(title LIKE ? OR content_md LIKE ?)').join(' OR ');
        const params = [];
        words.forEach(w => {
            const pattern = `%${w}%`;
            params.push(pattern, pattern);
        });

        const sql = `SELECT id, category, title, content_md, updated_at FROM wiki_pages WHERE ${clauses} ORDER BY updated_at DESC LIMIT ${limit}`;

        wikiDb.all(sql, params, (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve([]);

            const results = rows.map(r => {
                // 본문 발췌 (최대 700자)
                let excerpt = (r.content_md || '').trim();
                if (excerpt.length > 700) {
                    excerpt = excerpt.slice(0, 700) + '\n... (이하 생략)';
                }
                return {
                    id: r.id,
                    category: r.category,
                    title: r.title,
                    excerpt
                };
            });
            resolve(results);
        });
    });
}

module.exports = {
    calcDDay,
    getWikiSummary,
    searchWikiContent
};
