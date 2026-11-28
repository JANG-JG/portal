/**
 * 🏠 JG 통합 검색 - 내부 전 서비스 통합 검색 엔진 (internalSearch.service.js)
 * - 메모, 뉴스, 가족 위키, 가족 앨범(썸네일), 캘린더, 병원·복약, 자산, 어린이집, 사이트 바로가기 통합 조회
 * - 3계층 권한(관리자 전용 / 서비스 허용 / 개인 격리) 및 한글 초성 검색 지원
 */

const { db, assetDb, newsDb, albumDb, wikiDb, portalDb } = require('../db');
const { ADMIN_USERS } = require('../../config/constants');
const { isServiceAllowed } = require('../moduleRegistry.service');
const { decryptMemoText, decryptCalendarText } = require('../crypto.service');
const { searchWikiContent } = require('../wikiSummary.service');
const kindergartenService = require('../kindergarten.service');
const { isChosungOnly, matchesQuery } = require('./chosung.util');
const { searchClipsAndBotDocs } = require('./webBotStore.service');

const SITE_SHORTCUTS = [
    { id: 'home', title: 'JG 포털 홈', desc: '통합 대시보드 및 데일리 브리핑', url: '/', icon: '🏠', keywords: '포털 홈 메인 대시보드 브리핑' },
    { id: 'memo', title: '아이디어 & 메모장', desc: '개인 암호화 메모 작성 및 관리', url: '/memo', icon: '📝', keywords: '메모 노트 기록 할일' },
    { id: 'calendar', title: '스마트 캘린더', desc: '가족 행사 및 개인 일정 관리', url: '/calendar', icon: '📅', keywords: '캘린더 달력 일정 약속 기념일' },
    { id: 'ai', title: 'JG AI 비서', desc: '가족·일정·건강 맞춤 AI 대화', url: '/ai', icon: '🤖', keywords: 'ai 비서 챗봇 질문 인공지능' },
    { id: 'news', title: '뉴스룸 대시보드', desc: '실시간 주요 뉴스 및 속보', url: '/go/news', icon: '📰', service: 'news', keywords: '뉴스 신문 기사 속보 헤드라인' },
    { id: 'weather', title: '실시간 날씨 & 레이더', desc: '전국 날씨, 미세먼지 및 강수 레이더', url: '/go/news?path=/weather', icon: '🌤️', service: 'news', keywords: '날씨 기상 레이더 미세먼지 예보' },
    { id: 'economy', title: '경제 & 증시', desc: '국내외 증시 지수 및 환율 현황', url: '/go/economy', icon: '📈', service: 'news', keywords: '경제 증시 주식 코스피 코스닥 환율' },
    { id: 'wiki', title: '가족 위키', desc: '집안 매뉴얼, 레시피, 생활 가이드', url: 'https://wiki.j-jg.cc', icon: '📖', service: 'wiki', keywords: '위키 매뉴얼 가이드 레시피 규칙' },
    { id: 'album', title: '가족 앨범', desc: '우리 가족 추억 사진첩', url: 'https://album.j-jg.cc', icon: '📸', service: 'album', keywords: '앨범 사진 추억 갤러리' },
    { id: 'blood', title: '건강 & 혈압 관리', desc: '오늘 약 챙겨먹기, 병원 일정, 혈압 기록', url: 'https://blood.j-jg.cc/dashboard.html', icon: '💊', service: 'blood', keywords: '건강 혈압 약 복약 병원 진료 해열제' },
    { id: 'asset', title: '자산 대시보드', desc: '보유 종목 및 포트폴리오 관리', url: 'https://asset.j-jg.cc', icon: '💰', adminOnly: true, keywords: '자산 주식 포트폴리오 계좌' },
    { id: 'kindergarten', title: '어린이집 사진 수집', desc: '어린이집 알림장 및 사진 자동 수집', url: '/kindergarten', icon: '🎒', adminOnly: true, keywords: '어린이집 유치원 키즈노트 사진' },
    { id: 'admin', title: '통합 관리자 센터', desc: '서버 상태, 모듈, DB, 보안 관제', url: '/admin', icon: '⚙️', adminOnly: true, keywords: '관리자 설정 서버 로그 pm2' }
];

function safeDecryptCalendar(text, userId, isFamily) {
    try {
        return decryptCalendarText(text, userId, isFamily);
    } catch (_) {
        return '';
    }
}

function safeDecryptMemo(text, userId) {
    try {
        return decryptMemoText(text, userId);
    } catch (_) {
        return '';
    }
}

function checkPermission(user) {
    const userId = user?.username || 'admin';
    const isAdmin = Boolean(user?.role === 'admin' || ADMIN_USERS.has(userId));
    return {
        userId,
        isAdmin,
        hasBlood: isAdmin || isServiceAllowed(user, 'blood'),
        hasNews: isAdmin || isServiceAllowed(user, 'news'),
        hasWiki: isAdmin || isServiceAllowed(user, 'wiki'),
        hasAlbum: isAdmin || isServiceAllowed(user, 'album')
    };
}

function searchMemos(userId, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!portalDb) return resolve([]);
        portalDb.all(
            'SELECT id, user_id, title, content, category, color, is_pinned, updated_at FROM user_memos WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC LIMIT 120',
            [userId],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const results = [];
                for (const r of rows) {
                    const decTitle = safeDecryptMemo(r.title, r.user_id);
                    const decContent = safeDecryptMemo(r.content, r.user_id);
                    if (
                        matchesQuery(decTitle, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(decContent, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.category, rawQuery, isChosung, cleanChosung)
                    ) {
                        results.push({
                            id: r.id,
                            title: decTitle || '(제목 없음)',
                            content: decContent,
                            category: r.category || '일반',
                            is_pinned: r.is_pinned,
                            updated_at: r.updated_at,
                            url: `/memo?id=${r.id}`
                        });
                        if (results.length >= 10) break;
                    }
                }
                resolve(results);
            }
        );
    });
}

function searchCalendar(userId, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!portalDb) return resolve([]);
        portalDb.all(
            `SELECT id, user_id, title, event_date, event_time, category, memo, is_all_day, is_family
             FROM calendar_events
             WHERE is_family = 1 OR category = '가족' OR user_id = ?
             ORDER BY event_date DESC, id DESC LIMIT 150`,
            [userId],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const results = [];
                for (const r of rows) {
                    const isFam = Boolean(r.is_family === 1 || r.category === '가족');
                    const decTitle = safeDecryptCalendar(r.title, r.user_id, isFam);
                    const decMemo = safeDecryptCalendar(r.memo, r.user_id, isFam);
                    if (
                        matchesQuery(decTitle, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(decMemo, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.category, rawQuery, isChosung, cleanChosung)
                    ) {
                        results.push({
                            id: r.id,
                            title: decTitle || '일정',
                            memo: decMemo,
                            event_date: r.event_date,
                            event_time: r.is_all_day ? '하루 종일' : (r.event_time || ''),
                            category: r.category || (isFam ? '가족' : '개인'),
                            is_family: isFam,
                            url: `/calendar?date=${encodeURIComponent(r.event_date || '')}`
                        });
                        if (results.length >= 10) break;
                    }
                }
                resolve(results);
            }
        );
    });
}

function searchNews(hasNews, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!hasNews || !newsDb) return resolve([]);
        if (isChosung) {
            newsDb.all(
                'SELECT id, date, category_name, title, link, media_name, summary, published_at FROM news_articles ORDER BY id DESC LIMIT 80',
                (err, rows) => {
                    if (err || !rows) return resolve([]);
                    const filtered = rows
                        .filter(r => matchesQuery(r.title, rawQuery, true, cleanChosung) || matchesQuery(r.category_name, rawQuery, true, cleanChosung))
                        .slice(0, 10);
                    resolve(filtered);
                }
            );
        } else {
            const term = `%${rawQuery}%`;
            newsDb.all(
                `SELECT id, date, category_name, title, link, media_name, summary, published_at
                 FROM news_articles
                 WHERE (title LIKE ? OR summary LIKE ? OR category_name LIKE ?)
                 ORDER BY date DESC, id DESC LIMIT 10`,
                [term, term, term],
                (err, rows) => resolve(rows || [])
            );
        }
    });
}

async function searchWiki(hasWiki, rawQuery, isChosung, cleanChosung) {
    if (!hasWiki) return [];
    if (!isChosung) {
        try {
            const apiResults = await searchWikiContent(rawQuery, 8);
            if (Array.isArray(apiResults) && apiResults.length > 0) {
                return apiResults.map(w => ({
                    title: w.title,
                    slug: w.slug,
                    category: w.category || '생활',
                    excerpt: w.excerpt || '',
                    url: w.url || `https://wiki.j-jg.cc/page/${encodeURIComponent(w.slug || '')}`
                }));
            }
        } catch (_) {}
    }

    if (!wikiDb) return [];
    return new Promise((resolve) => {
        wikiDb.all(
            'SELECT id, category, title, slug, content_md, updated_at FROM wiki_pages ORDER BY updated_at DESC LIMIT 80',
            [],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const results = [];
                for (const r of rows) {
                    const plain = (r.content_md || '').replace(/[#*`\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
                    if (
                        matchesQuery(r.title, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(plain, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.category, rawQuery, isChosung, cleanChosung)
                    ) {
                        results.push({
                            id: r.id,
                            title: r.title,
                            slug: r.slug,
                            category: r.category || '생활',
                            excerpt: plain.slice(0, 110) + (plain.length > 110 ? '...' : ''),
                            url: `https://wiki.j-jg.cc/page/${encodeURIComponent(r.slug || '')}`
                        });
                        if (results.length >= 8) break;
                    }
                }
                resolve(results);
            }
        );
    });
}

function searchAlbum(hasAlbum, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!hasAlbum || !albumDb) return resolve([]);
        const sql = `
            SELECT p.id, p.caption, p.location, p.tags, p.taken_at, p.created_at, p.thumbnail_filename,
                   m.nickname as author_nickname
            FROM photos p
            LEFT JOIN family_members m ON p.member_id = m.id
            ORDER BY COALESCE(p.taken_at, p.created_at) DESC
            LIMIT 120
        `;
        albumDb.all(sql, [], (err, rows) => {
            if (err || !rows) return resolve([]);
            const results = [];
            for (const r of rows) {
                if (
                    matchesQuery(r.caption, rawQuery, isChosung, cleanChosung) ||
                    matchesQuery(r.location, rawQuery, isChosung, cleanChosung) ||
                    matchesQuery(r.tags, rawQuery, isChosung, cleanChosung) ||
                    matchesQuery(r.author_nickname, rawQuery, isChosung, cleanChosung)
                ) {
                    results.push({
                        id: r.id,
                        caption: r.caption || '(제목 없음)',
                        location: r.location || '',
                        tags: r.tags || '',
                        author: r.author_nickname || '가족',
                        taken_at: (r.taken_at || r.created_at || '').slice(0, 10),
                        thumbUrl: r.thumbnail_filename
                            ? `https://album.j-jg.cc/uploads/thumbnails/${encodeURIComponent(r.thumbnail_filename)}`
                            : null,
                        url: `https://album.j-jg.cc/#photo-${r.id}`
                    });
                    if (results.length >= 12) break;
                }
            }
            resolve(results);
        });
    });
}

function searchHospitals(hasBlood, userId, isAdmin, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!hasBlood || !db) return resolve([]);
        db.all(
            'SELECT id, visit_date, hospital_name, department, memo, next_visit_date, reservation_open_date FROM hospital_visits WHERE (user_id = ? OR ? = 1) ORDER BY visit_date DESC LIMIT 80',
            [userId, isAdmin ? 1 : 0],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows
                    .filter(r =>
                        matchesQuery(r.hospital_name, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.department, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.memo, rawQuery, isChosung, cleanChosung)
                    )
                    .slice(0, 8);
                resolve(filtered);
            }
        );
    });
}

function searchMedications(hasBlood, userId, isAdmin, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!hasBlood || !db) return resolve([]);
        db.all(
            `SELECT id, target_label, med_name, dosage_note, med_type, remain_count, is_active
             FROM health_medications
             WHERE (user_id = ? OR ? = 1 OR share_with_family = 1) AND is_active = 1
             ORDER BY id DESC LIMIT 60`,
            [userId, isAdmin ? 1 : 0],
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows
                    .filter(r =>
                        matchesQuery(r.med_name, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.target_label, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.dosage_note, rawQuery, isChosung, cleanChosung)
                    )
                    .slice(0, 8)
                    .map(r => ({
                        ...r,
                        url: 'https://blood.j-jg.cc/dashboard.html#meds'
                    }));
                resolve(filtered);
            }
        );
    });
}

function searchAssets(isAdmin, rawQuery, isChosung, cleanChosung) {
    return new Promise((resolve) => {
        if (!isAdmin || !assetDb) return resolve([]);
        assetDb.all(
            'SELECT id, symbol, full_name, asset_type, quantity, avg_price, currency FROM assets LIMIT 80',
            (err, rows) => {
                if (err || !rows) return resolve([]);
                const filtered = rows
                    .filter(r =>
                        matchesQuery(r.symbol, rawQuery, isChosung, cleanChosung) ||
                        matchesQuery(r.full_name, rawQuery, isChosung, cleanChosung)
                    )
                    .slice(0, 8);
                resolve(filtered);
            }
        );
    });
}

function searchShortcuts(perm, rawQuery, isChosung, cleanChosung) {
    return SITE_SHORTCUTS.filter((item) => {
        if (item.adminOnly && !perm.isAdmin) return false;
        if (item.service === 'blood' && !perm.hasBlood) return false;
        if (item.service === 'news' && !perm.hasNews) return false;
        if (item.service === 'wiki' && !perm.hasWiki) return false;
        if (item.service === 'album' && !perm.hasAlbum) return false;
        return (
            matchesQuery(item.title, rawQuery, isChosung, cleanChosung) ||
            matchesQuery(item.desc, rawQuery, isChosung, cleanChosung) ||
            matchesQuery(item.keywords, rawQuery, isChosung, cleanChosung)
        );
    }).slice(0, 6);
}

function searchKindergarten(isAdmin, rawQuery, isChosung, cleanChosung) {
    if (!isAdmin) return [];
    const targetText = '어린이집 유치원 키즈노트 알림장 사진 수집';
    if (!matchesQuery(targetText, rawQuery, isChosung, cleanChosung)) return [];
    try {
        const cfg = kindergartenService.getPublicConfig();
        return [{
            title: '어린이집 사진 자동 수집기',
            status: cfg.isConfigured ? '계정 연동됨' : '설정 필요',
            lastRun: cfg.lastRunAt || '실행 기록 없음',
            url: '/kindergarten'
        }];
    } catch (_) {
        return [{ title: '어린이집 사진 자동 수집기', status: '이동', lastRun: '', url: '/kindergarten' }];
    }
}

function getAllowedShortcuts(user) {
    const perm = checkPermission(user);
    return SITE_SHORTCUTS.filter((item) => {
        if (item.adminOnly && !perm.isAdmin) return false;
        if (item.service === 'blood' && !perm.hasBlood) return false;
        if (item.service === 'news' && !perm.hasNews) return false;
        if (item.service === 'wiki' && !perm.hasWiki) return false;
        if (item.service === 'album' && !perm.hasAlbum) return false;
        return true;
    });
}

async function searchAllInternal(rawQuery, user) {
    const perm = checkPermission(user);
    const isChosung = isChosungOnly(rawQuery);
    const cleanChosung = rawQuery.replace(/\s+/g, '').toLowerCase();

    const [memos, calendar, news, wiki, album, hospitals, medications, assets, clipAndBot] = await Promise.all([
        searchMemos(perm.userId, rawQuery, isChosung, cleanChosung),
        searchCalendar(perm.userId, rawQuery, isChosung, cleanChosung),
        searchNews(perm.hasNews, rawQuery, isChosung, cleanChosung),
        searchWiki(perm.hasWiki, rawQuery, isChosung, cleanChosung),
        searchAlbum(perm.hasAlbum, rawQuery, isChosung, cleanChosung),
        searchHospitals(perm.hasBlood, perm.userId, perm.isAdmin, rawQuery, isChosung, cleanChosung),
        searchMedications(perm.hasBlood, perm.userId, perm.isAdmin, rawQuery, isChosung, cleanChosung),
        searchAssets(perm.isAdmin, rawQuery, isChosung, cleanChosung),
        searchClipsAndBotDocs(rawQuery, perm.userId, isChosung, cleanChosung, 8)
    ]);

    const savedClips = clipAndBot?.savedClips || [];
    const botDocs = clipAndBot?.botDocs || [];
    const shortcuts = searchShortcuts(perm, rawQuery, isChosung, cleanChosung);
    const kindergarten = searchKindergarten(perm.isAdmin, rawQuery, isChosung, cleanChosung);

    const total = memos.length + calendar.length + news.length + wiki.length +
        album.length + hospitals.length + medications.length + assets.length +
        shortcuts.length + kindergarten.length + savedClips.length + botDocs.length;

    return {
        isChosung,
        total,
        permissions: {
            isAdmin: perm.isAdmin,
            hasBlood: perm.hasBlood,
            hasNews: perm.hasNews,
            hasWiki: perm.hasWiki,
            hasAlbum: perm.hasAlbum
        },
        results: {
            shortcuts,
            savedClips,
            botDocs,
            memos,
            calendar,
            wiki,
            album,
            news,
            hospitals,
            medications,
            assets,
            kindergarten
        }
    };
}

module.exports = {
    searchAllInternal,
    getAllowedShortcuts
};
