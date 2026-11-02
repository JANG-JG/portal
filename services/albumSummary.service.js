/**
 * 📸 JG 포털 가족 사진첩 요약 및 추억 검색 서비스 (albumSummary.service.js)
 * - album.db (사진 메타데이터, 촬영일, 장소, 태그, 반응) 연동
 * - 4가지 핵심 기능:
 *   1. "N년 전 오늘" 타임머신 추억 브리핑
 *   2. 질문 키워드/장소 기반 사진 검색 및 링크 제공 (RAG)
 *   3. 가족 소통 및 하트(반응) 알림
 *   4. 사진첩 활동 통계
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { albumDb } = require('./db');

/**
 * KST 기준 오늘 날짜 정보 헬퍼
 */
function getKstDateParts() {
    const now = new Date();
    const kstStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
    const parts = kstStr.split('-');
    return {
        year: parseInt(parts[0], 10),
        monthDay: `${parts[1]}-${parts[2]}`, // MM-DD
        todayStr: kstStr
    };
}

/**
 * 1. "N년 전 오늘" 과거 같은 날짜의 추억 사진 조회
 */
async function getPastPhotosOnThisDay() {
    if (!albumDb) return [];
    const { year, monthDay } = getKstDateParts();

    return new Promise((resolve) => {
        const sql = `
            SELECT 
                p.id, p.caption, p.location, p.tags, p.taken_at, p.created_at, p.thumbnail_filename,
                m.nickname as author_nickname,
                strftime('%Y', COALESCE(p.taken_at, p.created_at)) as photo_year
            FROM photos p
            JOIN family_members m ON p.member_id = m.id
            WHERE strftime('%m-%d', COALESCE(p.taken_at, p.created_at)) = ?
              AND CAST(strftime('%Y', COALESCE(p.taken_at, p.created_at)) AS INTEGER) < ?
            ORDER BY COALESCE(p.taken_at, p.created_at) DESC
            LIMIT 3
        `;
        albumDb.all(sql, [monthDay, year], (err, rows) => {
            if (err || !rows) return resolve([]);
            const formatted = rows.map(r => {
                const pYear = parseInt(r.photo_year, 10);
                const yearsAgo = year - pYear;
                return {
                    id: r.id,
                    yearsAgo,
                    photoYear: pYear,
                    author: r.author_nickname || '가족',
                    caption: r.caption || '',
                    location: r.location || '',
                    tags: r.tags || '',
                    takenAt: (r.taken_at || r.created_at || '').slice(0, 10),
                    url: `https://album.j-jg.cc/#photo-${r.id}`
                };
            });
            resolve(formatted);
        });
    });
}

/**
 * 2. 가족 소통 및 최근 사진첩 활동 요약
 */
async function getRecentAlbumActivity() {
    if (!albumDb) return null;

    return new Promise((resolve) => {
        // 총 사진 수 및 최근 업로드 사진 1건, 최근 7일 사진 수
        const sql = `
            SELECT 
                COUNT(*) as total_photos,
                MAX(COALESCE(taken_at, created_at)) as latest_taken_at,
                (
                    SELECT COUNT(*) 
                    FROM photos 
                    WHERE datetime(COALESCE(taken_at, created_at)) >= datetime('now', '-7 days', 'localtime')
                ) as photos_last_7days
            FROM photos
        `;
        albumDb.get(sql, [], (err, stats) => {
            if (err || !stats || stats.total_photos === 0) {
                return resolve({ totalPhotos: 0, latestTakenAt: null, photosLast7Days: 0, unreactedPhoto: null });
            }

            // 하트 반응이 없는 최신 사진 1건 탐색
            const unreactedSql = `
                SELECT p.id, p.caption, p.location, m.nickname as author_nickname
                FROM photos p
                JOIN family_members m ON p.member_id = m.id
                WHERE (SELECT COUNT(*) FROM photo_reactions r WHERE r.photo_id = p.id) = 0
                ORDER BY p.id DESC
                LIMIT 1
            `;
            albumDb.get(unreactedSql, [], (uErr, unreacted) => {
                resolve({
                    totalPhotos: stats.total_photos || 0,
                    latestTakenAt: (stats.latest_taken_at || '').slice(0, 10),
                    photosLast7Days: stats.photos_last_7days || 0,
                    unreactedPhoto: unreacted ? {
                        id: unreacted.id,
                        author: unreacted.author_nickname,
                        caption: unreacted.caption,
                        location: unreacted.location,
                        url: `https://album.j-jg.cc/#photo-${unreacted.id}`
                    } : null
                });
            });
        });
    });
}

/**
 * 3. 통합 사진첩 현황 요약
 */
async function getAlbumSummary() {
    try {
        const [onThisDay, activity] = await Promise.all([
            getPastPhotosOnThisDay(),
            getRecentAlbumActivity()
        ]);

        return {
            onThisDay,
            activity
        };
    } catch (e) {
        console.warn('[AlbumSummary] 앨범 요약 생성 오류:', e.message);
        return null;
    }
}

/**
 * 4. 사용자 질문 기반 사진 검색 (RAG: 캡션, 장소, 태그, 작성자 검색)
 */
async function searchAlbumPhotos(query, limit = 3) {
    if (!albumDb || !query || typeof query !== 'string') return [];

    const stopWords = new Set([
        '우리', '우리집', '사진', '사진첩', '앨범', '가족', '가족사진', '보여줘', '찾아줘', '어디', '언제',
        '있어', '있는', '알려줘', '링크', '찍은', '갔을', '때', '했던'
    ]);

    const words = query
        .replace(/[^\w\s가-힣]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 2 && !stopWords.has(w));

    if (words.length === 0) return [];

    return new Promise((resolve) => {
        const clauses = words.map(() => '(p.caption LIKE ? OR p.location LIKE ? OR p.tags LIKE ? OR m.nickname LIKE ?)').join(' OR ');
        const params = [];
        words.forEach(w => {
            const pattern = `%${w}%`;
            params.push(pattern, pattern, pattern, pattern);
        });

        const sql = `
            SELECT 
                p.id, p.caption, p.location, p.tags, p.taken_at, p.created_at,
                m.nickname as author_nickname,
                (SELECT COUNT(*) FROM photo_reactions r WHERE r.photo_id = p.id) as reaction_count
            FROM photos p
            JOIN family_members m ON p.member_id = m.id
            WHERE ${clauses}
            ORDER BY COALESCE(p.taken_at, p.created_at) DESC
            LIMIT ${limit}
        `;

        albumDb.all(sql, params, (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve([]);

            const results = rows.map(r => ({
                id: r.id,
                author: r.author_nickname || '가족',
                caption: r.caption || '(제목 없음)',
                location: r.location || '',
                tags: r.tags || '',
                takenAt: (r.taken_at || r.created_at || '').slice(0, 10),
                reactions: r.reaction_count || 0,
                url: `https://album.j-jg.cc/#photo-${r.id}`
            }));
            resolve(results);
        });
    });
}

module.exports = {
    getPastPhotosOnThisDay,
    getRecentAlbumActivity,
    getAlbumSummary,
    searchAlbumPhotos
};
