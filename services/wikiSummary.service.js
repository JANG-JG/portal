/**
 * 📖 JG 포털 가족 위키 요약 및 지식 검색 서비스 (wikiSummary.service.js)
 * - 보조 서버(HP 노트북: 192.168.50.75:5060) 실시간 위키 API 연동
 * - 보조 서버 순단 시 로컬 wiki.db 자동 폴백 (무장애 안전성 확보)
 * - AI 비서 브리핑 및 실시간 대화 컨텍스트 주입 (RAG)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const http = require('http');
const { WIKI_BASE_URL, JWT_SECRET } = require('../config/constants');
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
 * 보조 서버 위키 HTTP API 호출 헬퍼 (타임아웃 3초)
 */
function fetchWikiApi(apiPath, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const url = `${WIKI_BASE_URL}${apiPath}`;
        const options = {
            timeout: timeoutMs,
            headers: JWT_SECRET ? { 'X-Internal-Secret': JWT_SECRET } : {}
        };
        const req = http.get(url, options, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`위키 서버 응답 오류 (${res.statusCode})`));
            }
            let rawData = '';
            res.on('data', chunk => { rawData += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(rawData));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('위키 서버 요청 시간 초과 (3초)'));
        });
    });
}

/**
 * 1. 가족 위키 주요 현황 취합 (D-Day, 미완료 할 일, 최근 문서)
 * - 1차: 보조 서버 실시간 API 호출
 * - 2차: 실패 시 로컬 wikiDb 폴백
 */
async function getWikiSummary() {
    // 1차: 보조 서버 실시간 API 호출
    try {
        const liveData = await fetchWikiApi('/api/wiki/dashboard-summary', 3000);
        if (liveData && liveData.success) {
            const ddays = (liveData.dday || []).slice(0, 5).map(r => ({
                id: r.id,
                category: r.category,
                title: r.title,
                targetDate: r.target_date,
                dday: (r.dday_info && r.dday_info.dday_str) ? r.dday_info.dday_str : calcDDay(r.target_date),
                memo: r.memo
            }));

            const todos = (liveData.todos || [])
                .filter(t => !t.is_completed)
                .slice(0, 5)
                .map(r => ({
                    id: r.id,
                    content: r.content,
                    isRoutine: !!r.is_routine,
                    assignee: r.assignee || '가족'
                }));

            const pages = (liveData.pages || []).slice(0, 5);

            return {
                ddays,
                todos,
                pages
            };
        }
    } catch (netErr) {
        console.warn('⚠️ [WikiSummary] 보조 서버 위키 API 통신 실패 (로컬 DB 폴백 전환):', netErr.message);
    }

    // 2차 폴백: 로컬 SQLite DB 직접 조회
    if (!wikiDb) return null;

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
        return { ddays, todos, pages };
    } catch (e) {
        console.warn('⚠️ [WikiSummary] 로컬 위키 DB 조회 실패:', e.message);
        return null;
    }
}

/**
 * 2. 사용자 질문 키워드 기반 연관 위키 문서 검색 (RAG)
 * - 1차: 보조 서버 실시간 검색 API 호출
 * - 2차: 실패 시 로컬 wikiDb 폴백
 */
async function searchWikiContent(query, limit = 2) {
    if (!query || typeof query !== 'string') return [];

    // 1차: 보조 서버 실시간 검색 API 호출
    try {
        const encQ = encodeURIComponent(query.trim());
        const liveSearch = await fetchWikiApi(`/api/wiki/search?q=${encQ}&limit=${limit}`, 3000);
        if (liveSearch && liveSearch.success && Array.isArray(liveSearch.results)) {
            return liveSearch.results;
        }
    } catch (netErr) {
        console.warn('⚠️ [WikiSearch] 보조 서버 위키 검색 API 실패 (로컬 DB 폴백 전환):', netErr.message);
    }

    // 2차 폴백: 로컬 SQLite DB 검색
    if (!wikiDb) return [];

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
        const clauses = words.map(() => '(title LIKE ? OR content_md LIKE ?)').join(' OR ');
        const params = [];
        words.forEach(w => {
            const pattern = `%${w}%`;
            params.push(pattern, pattern);
        });

        const sql = `SELECT id, category, title, slug, content_md, updated_at FROM wiki_pages WHERE ${clauses} ORDER BY updated_at DESC LIMIT ${limit}`;

        wikiDb.all(sql, params, (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve([]);

            const results = rows.map(r => {
                let excerpt = (r.content_md || '').trim();
                if (excerpt.length > 700) {
                    excerpt = excerpt.slice(0, 700) + '\n... (이하 생략)';
                }
                return {
                    id: r.id,
                    category: r.category,
                    title: r.title,
                    slug: r.slug,
                    excerpt,
                    updated_at: r.updated_at
                };
            });
            resolve(results);
        });
    });
}

/**
 * 3. 보조 서버 위키에 신규 마크다운 문서 등록 API
 * - 1차: 보조 서버 실시간 POST /api/wiki/pages/create (X-Internal-Secret 포함)
 * - 2차: 실패 시 로컬 wikiDb 직접 INSERT (무장애 안전성 확보)
 */
async function createWikiPage({ category = '생활', title, content_md, slug = '' }) {
    if (!title || !title.trim()) {
        throw new Error('문서 제목을 입력해 주세요.');
    }
    if (!content_md || !content_md.trim()) {
        throw new Error('문서 내용을 입력해 주세요.');
    }

    const cleanCategory = (category || '생활').trim();
    const cleanTitle = title.trim();
    const cleanContent = content_md.trim();
    const cleanSlug = (slug || '').trim();

    const payload = JSON.stringify({
        category: cleanCategory,
        title: cleanTitle,
        content_md: cleanContent,
        slug: cleanSlug
    });

    // 1차: 보조 서버 실시간 API 호출
    try {
        const liveResult = await new Promise((resolve, reject) => {
            const urlObj = new URL('/api/wiki/pages/create', WIKI_BASE_URL);
            const req = http.request(urlObj, {
                method: 'POST',
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...(JWT_SECRET ? { 'X-Internal-Secret': JWT_SECRET } : {})
                }
            }, (res) => {
                let rawData = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { rawData += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(rawData);
                        if (res.statusCode >= 200 && res.statusCode < 300 && parsed.success) {
                            resolve(parsed);
                        } else {
                            reject(new Error(parsed.message || `위키 서버 상태 코드: ${res.statusCode}`));
                        }
                    } catch (e) {
                        reject(new Error('위키 서버 JSON 응답 파싱 실패'));
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('위키 서버 응답 시간 초과 (5초)'));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });

        if (liveResult && liveResult.success) {
            return liveResult;
        }
    } catch (netErr) {
        console.warn('⚠️ [CreateWikiPage] 보조 서버 위키 API 통신 실패 (로컬 DB 폴백 전환):', netErr.message);
    }

    // 2차 폴백: 로컬 SQLite DB 직접 등록 (무장애 안전성 확보)
    if (!wikiDb) {
        throw new Error('위키 DB에 연결할 수 없습니다.');
    }

    let baseSlug = cleanSlug || cleanTitle.toLowerCase().replace(/[^a-z0-9가-힣\s-]/g, '').trim().replace(/\s+/g, '-');
    if (!baseSlug) baseSlug = `page-${Date.now()}`;

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    return new Promise((resolve, reject) => {
        wikiDb.get("SELECT id FROM wiki_pages WHERE slug = ?", [baseSlug], (err, row) => {
            let finalSlug = baseSlug;
            if (row) {
                finalSlug = `${baseSlug}-${Date.now().toString(36)}`;
            }
            wikiDb.run(
                "INSERT INTO wiki_pages (category, title, slug, content_md, updated_at) VALUES (?, ?, ?, ?, ?)",
                [cleanCategory, cleanTitle, finalSlug, cleanContent, nowStr],
                function(insertErr) {
                    if (insertErr) return reject(insertErr);
                    resolve({
                        success: true,
                        id: this.lastID,
                        slug: finalSlug,
                        title: cleanTitle,
                        category: cleanCategory,
                        view_url: `/wiki/${finalSlug}`,
                        message: '위키 문서가 성공적으로 등록되었습니다. (로컬 DB)'
                    });
                }
            );
        });
    });
}

module.exports = {
    calcDDay,
    getWikiSummary,
    searchWikiContent,
    createWikiPage
};
