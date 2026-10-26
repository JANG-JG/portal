const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_SECRET } = require('../config/constants');
const { db, newsDb, albumDb } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { getLiveWeatherData, CITY_LIST, normalizeCityCode, getDefaultWeatherCity } = require('../services/weather.service');
const { getPortalSummary, invalidateSummaryCache } = require('../services/portalSummary.service');
const { getTickerData, invalidateTickerCache } = require('../services/portalTicker.service');

// 1. 요약 데이터 조회 API (메인 대시보드 카드용, SWR 60초 캐시 및 백그라운드 무기다림 갱신)
router.get('/api/summary', authenticateToken, async (req, res) => {
    try {
        const responseData = await getPortalSummary(req.user);
        res.json(responseData);
    } catch (err) {
        console.error('요약 데이터 조회 오류:', err);
        res.status(500).json({ success: false, message: '요약 데이터 조회 실패' });
    }
});

// 1-1. 메인 대시보드용 최근 가족 앨범 사진 12선 조회 API (개별 슬라이드 사진 단위 전개)
router.get('/api/portal/recent-photos', authenticateToken, (req, res) => {
    if (!albumDb) {
        return res.json({ success: true, photos: [] });
    }
    // 1) 슬라이드 개별 사진(photo_images) 우선 조회
    const query = `
        SELECT 
            pi.id as image_id,
            p.id as photo_id,
            p.caption,
            pi.thumbnail_filename,
            pi.storage_filename,
            COALESCE(pi.created_at, p.created_at) as created_at,
            COALESCE(m.nickname, '가족') as author_nickname,
            COALESCE(m.avatar_emoji, '😊') as author_emoji,
            (SELECT COUNT(*) FROM photo_comments c WHERE c.photo_id = p.id) as comment_count,
            (SELECT COUNT(*) FROM photo_reactions r WHERE r.photo_id = p.id) as reaction_count
        FROM photo_images pi
        JOIN photos p ON pi.photo_id = p.id
        LEFT JOIN family_members m ON p.member_id = m.id
        ORDER BY pi.id DESC
        LIMIT 12
    `;
    albumDb.all(query, [], (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length > 0) {
            const photos = rows.map(r => ({
                id: r.photo_id,
                imageId: r.image_id,
                caption: r.caption || '',
                thumbnailUrl: `/album-uploads/thumbnails/${r.thumbnail_filename}`,
                externalThumbnailUrl: `https://album.j-jg.cc/uploads/thumbnails/${r.thumbnail_filename}`,
                author: r.author_nickname,
                emoji: r.author_emoji,
                createdAt: r.created_at,
                commentCount: r.comment_count || 0,
                reactionCount: r.reaction_count || 0
            }));
            return res.json({ success: true, photos });
        }

        // 2) 폴백: photos 테이블 직접 조회 (과거 단일 사진)
        const fallbackQuery = `
            SELECT 
                p.id as photo_id, p.caption, p.thumbnail_filename, p.storage_filename, p.created_at,
                COALESCE(m.nickname, '가족') as author_nickname,
                COALESCE(m.avatar_emoji, '😊') as author_emoji,
                (SELECT COUNT(*) FROM photo_comments c WHERE c.photo_id = p.id) as comment_count,
                (SELECT COUNT(*) FROM photo_reactions r WHERE r.photo_id = p.id) as reaction_count
            FROM photos p
            LEFT JOIN family_members m ON p.member_id = m.id
            ORDER BY p.id DESC
            LIMIT 12
        `;
        albumDb.all(fallbackQuery, [], (fErr, fRows) => {
            if (fErr) {
                console.error('포털 최근 사진 조회 오류:', fErr.message);
                return res.json({ success: false, photos: [] });
            }
            const photos = (fRows || []).map(r => ({
                id: r.photo_id,
                caption: r.caption || '',
                thumbnailUrl: `/album-uploads/thumbnails/${r.thumbnail_filename}`,
                externalThumbnailUrl: `https://album.j-jg.cc/uploads/thumbnails/${r.thumbnail_filename}`,
                author: r.author_nickname,
                emoji: r.author_emoji,
                createdAt: r.created_at,
                commentCount: r.comment_count || 0,
                reactionCount: r.reaction_count || 0
            }));
            res.json({ success: true, photos });
        });
    });
});

// 2. 원터치 복약 등록 API
router.post('/api/blood/quick-med', authenticateToken, (req, res) => {
    try {
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        const nowStr = (new Date(now.getTime() - tzOffset)).toISOString().slice(0, 16);

        db.run(
            `INSERT INTO records (systolic, diastolic, pulse, measured_at, medication_time) VALUES (NULL, NULL, NULL, ?, ?)`,
            [nowStr, nowStr],
            function(err) {
                if (err) {
                    console.error('원터치 복약 등록 실패:', err);
                    return res.status(500).json({ success: false, message: '복약 기록 저장 실패' });
                }
                invalidateSummaryCache(); // 복약 상태 즉시 반영을 위한 캐시 무효화
                res.json({
                    success: true,
                    message: '💊 오늘 혈압약 복용 기록이 성공적으로 등록되었습니다!',
                    id: this.lastID,
                    medication_time: nowStr
                });
            }
        );
    } catch (err) {
        console.error('원터치 복약 처리 오류:', err);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

// 3. 하단 실시간 뉴스/속보 티커 API (SWR 무기다림 캐시 패턴 적용: 직전 데이터 0ms 반환 + 백그라운드 비동기 갱신)
router.get('/api/ticker', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=15');
    try {
        const payload = await getTickerData();
        res.json(payload);
    } catch (e) {
        console.error('티커 데이터 조회 오류:', e);
        res.status(500).json({ success: false, message: '티커 데이터 조회 실패' });
    }
});

// 4. OAuth 방식 SSO 게이트웨이 (15초 초단기 + jti 1회용 Nonce + 딥링크 지원 + RBAC 권한 검증)
router.get('/go/:service', authenticateToken, (req, res) => {
    const service = req.params.service;
    let targetPath = (req.query.path || '').trim();
    // 🛡️ 오픈 리다이렉트 및 프로토콜 탈출 차단 가드
    if (targetPath) {
        if (/^\/\//.test(targetPath) || /^\/\\/.test(targetPath) || /^[a-zA-Z]+:/.test(targetPath) || targetPath.includes('\\')) {
            targetPath = '';
        }
    }

    const executeSso = (userNickname = '') => {
        const jti = crypto.randomBytes(16).toString('hex');
        const ticket = jwt.sign(
            {
                username: req.user.username,
                role: req.user.role || 'family',
                nickname: userNickname || req.user.nickname || req.user.username,
                jti,
                purpose: 'sso_ticket'
            },
            JWT_SECRET,
            { expiresIn: '15s' }
        );

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');

        let baseUrl = '';
        if (service === 'news') baseUrl = 'https://news.j-jg.cc';
        else if (service === 'economy') baseUrl = 'https://news.j-jg.cc/economy';
        else if (service === 'asset') baseUrl = 'https://asset.j-jg.cc';
        else if (service === 'blood') baseUrl = 'https://blood.j-jg.cc';
        else if (service === 'album') baseUrl = 'https://album.j-jg.cc';

        if (baseUrl) {
            let destUrl = baseUrl;
            let hash = '';
            if (targetPath) {
                const hashIdx = targetPath.indexOf('#');
                let cleanPath = targetPath;
                if (hashIdx !== -1) {
                    hash = targetPath.slice(hashIdx);
                    cleanPath = targetPath.slice(0, hashIdx);
                }
                if (cleanPath && !cleanPath.startsWith('/') && !cleanPath.startsWith('?')) {
                    cleanPath = '/' + cleanPath;
                }
                destUrl = baseUrl.replace(/\/+$/, '') + cleanPath;
            }
            const sep = destUrl.includes('?') ? '&' : '?';
            return res.redirect(`${destUrl}${sep}token=${ticket}${hash}`);
        }
        res.redirect('/');
    };

    // 🛡️ 가족 계정 서비스별 접근 권한(RBAC) 검증
    if (req.user.role === 'family') {
        db.get('SELECT allowed_services, nickname FROM users WHERE username = ?', [req.user.username], (uErr, userRow) => {
            let allowed = ['album', 'news'];
            try {
                if (userRow && userRow.allowed_services) allowed = JSON.parse(userRow.allowed_services);
            } catch (e) {}

            const serviceKey = (service === 'economy' ? 'news' : service);
            if (!allowed.includes('all') && !allowed.includes(serviceKey)) {
                return res.redirect('/?notice=unauthorized_service');
            }
            executeSso(userRow?.nickname);
        });
    } else {
        executeSso();
    }
});

// 5. 사용자 날씨 지역 조회 API
router.get('/api/portal/user/weather-city', authenticateToken, async (req, res) => {
    try {
        const username = req.user ? req.user.username : 'admin';
        const defaultCity = await getDefaultWeatherCity();
        db.get("SELECT weather_city FROM users WHERE username = ?", [username], (err, row) => {
            const currentCity = (row && row.weather_city && row.weather_city.trim()) ? row.weather_city.trim() : defaultCity;
            res.json({
                success: true,
                current_city: currentCity,
                cities: CITY_LIST
            });
        });
    } catch (e) {
        res.json({ success: true, current_city: 'Seoul', cities: CITY_LIST });
    }
});

// 6. 사용자 날씨 지역 변경 저장 API (포털, 하단 뉴스바, 날씨 브리핑 100% 자동 연동)
router.post('/api/portal/user/weather-city', authenticateToken, async (req, res) => {
    try {
        const username = req.user ? req.user.username : 'admin';
        const rawCity = (req.body && req.body.city) ? req.body.city : 'Seoul';
        const cityCode = normalizeCityCode(rawCity);

        // 1) health.db users 테이블에 저장
        db.run("UPDATE users SET weather_city = ? WHERE username = ?", [cityCode, username], async function(err) {
            if (err) {
                console.error('날씨 지역 변경 실패:', err);
                return res.status(500).json({ success: false, message: '지역 설정 저장에 실패했습니다.' });
            }

            // 2) briefing.db(newsDb) system_settings 테이블에도 즉시 동기화 저장 (날씨 브리핑과 100% 자동 연동)
            if (newsDb) {
                try {
                    newsDb.run(
                        "INSERT INTO system_settings (key, value, updated_at) VALUES ('weather_city', ?, datetime('now', '+9 hours')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                        [cityCode]
                    );
                } catch (dbErr) {
                    console.warn('newsDb system_settings 동기화 경고:', dbErr.message);
                }
            }

            // 3) 캐시 즉시 무효화 (하단 뉴스바 및 메인 화면 즉시 갱신)
            invalidateTickerCache();
            invalidateSummaryCache();

            const updatedWeather = await getLiveWeatherData(cityCode);
            res.json({
                success: true,
                message: '날씨 지역이 성공적으로 변경되었습니다.',
                current_city: cityCode,
                weather: updatedWeather
            });
        });
    } catch (e) {
        console.error('날씨 지역 설정 오류:', e);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

module.exports = router;
