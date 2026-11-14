const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { albumDb, db } = require('../../services/db');
const { ALBUM_DIR } = require('../../config/constants');

/**
 * 📸 [가족 사진첩 관리자 API]
 * 1. 사진첩 통계 및 스토리지 사용량 조회
 * GET /api/admin/album/stats
 */
router.get('/stats', (req, res) => {
    const queries = {
        photos: "SELECT COUNT(*) as cnt, COALESCE(SUM(file_size), 0) as total_size, COUNT(CASE WHEN (latitude IS NOT NULL AND longitude IS NOT NULL) OR (location IS NOT NULL AND TRIM(location) != '') THEN 1 END) as location_count FROM photos",
        comments: "SELECT COUNT(*) as cnt FROM photo_comments",
        reactions: "SELECT COUNT(*) as cnt FROM photo_reactions",
        members: "SELECT COUNT(*) as cnt FROM family_members WHERE is_active = 1"
    };

    albumDb.get(queries.photos, [], (pErr, photoRow) => {
        albumDb.get(queries.comments, [], (cErr, commentRow) => {
            albumDb.get(queries.reactions, [], (rErr, reactionRow) => {
                albumDb.get(queries.members, [], (mErr, memberRow) => {
                    const totalBytes = photoRow ? photoRow.total_size : 0;
                    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);

                    res.json({
                        success: true,
                        stats: {
                            total_photos: photoRow ? photoRow.cnt : 0,
                            location_photos: photoRow ? photoRow.location_count : 0,
                            total_comments: commentRow ? commentRow.cnt : 0,
                            total_reactions: reactionRow ? reactionRow.cnt : 0,
                            active_members: memberRow ? memberRow.cnt : 0,
                            storage_bytes: totalBytes,
                            storage_mb: totalMb
                        }
                    });
                });
            });
        });
    });
});

/**
 * 2. 최근 업로드 사진 목록 조회 (관리자 검수용)
 * GET /api/admin/album/photos?page=1&limit=20
 */
router.get('/photos', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const sql = `
        SELECT 
            p.id,
            p.original_name,
            p.storage_filename,
            p.thumbnail_filename,
            p.caption,
            p.taken_at,
            p.file_size,
            p.created_at,
            fm.nickname as author_name,
            fm.avatar_emoji,
            (SELECT COUNT(*) FROM photo_comments WHERE photo_id = p.id) as comment_count,
            (SELECT COUNT(*) FROM photo_reactions WHERE photo_id = p.id) as reaction_count
        FROM photos p
        LEFT JOIN family_members fm ON p.member_id = fm.id
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?
    `;

    albumDb.all(sql, [limit, offset], (err, rows) => {
        if (err) {
            console.error('관리자 사진 목록 조회 실패:', err);
            return res.status(500).json({ success: false, message: '사진 목록 조회 실패' });
        }

        albumDb.get('SELECT COUNT(*) as total FROM photos', [], (cntErr, cntRow) => {
            const total = cntRow ? cntRow.total : 0;
            res.json({
                success: true,
                photos: rows || [],
                pagination: {
                    page,
                    limit,
                    total,
                    total_pages: Math.ceil(total / limit)
                }
            });
        });
    });
});

/**
 * 3. 관리자 권한 사진 삭제 API
 * DELETE /api/admin/album/photos/:id
 */
router.delete('/photos/:id', (req, res) => {
    const photoId = parseInt(req.params.id);
    if (!photoId) {
        return res.status(400).json({ success: false, message: '유효하지 않은 사진 번호입니다.' });
    }

    albumDb.get('SELECT * FROM photos WHERE id = ?', [photoId], (findErr, photo) => {
        if (findErr || !photo) {
            return res.status(404).json({ success: false, message: '삭제할 사진을 찾을 수 없습니다.' });
        }

        albumDb.serialize(() => {
            albumDb.run('DELETE FROM photo_comments WHERE photo_id = ?', [photoId]);
            albumDb.run('DELETE FROM photo_reactions WHERE photo_id = ?', [photoId]);
            albumDb.run('DELETE FROM photos WHERE id = ?', [photoId], (delErr) => {
                if (delErr) {
                    return res.status(500).json({ success: false, message: '사진 데이터 삭제 실패' });
                }

                // 물리 파일 삭제 (안전하게 basename 검증 및 존재 여부 확인 후 삭제)
                try {
                    const uploadsDir = path.join(ALBUM_DIR, 'uploads');
                    const safeOrig = photo.storage_filename ? path.basename(String(photo.storage_filename)) : '';
                    const safeThumb = photo.thumbnail_filename ? path.basename(String(photo.thumbnail_filename)) : '';

                    if (safeOrig && safeOrig === photo.storage_filename) {
                        const origPath = path.join(uploadsDir, 'originals', safeOrig);
                        if (fs.existsSync(origPath)) fs.unlinkSync(origPath);
                    }
                    if (safeThumb && safeThumb === photo.thumbnail_filename) {
                        const thumbPath = path.join(uploadsDir, 'thumbnails', safeThumb);
                        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
                    }
                } catch (fsErr) {
                    console.warn('사진 물리 파일 삭제 중 경고:', fsErr.message);
                }

                res.json({
                    success: true,
                    message: `사진 #${photoId}이(가) 안전하게 삭제되었습니다.`
                });
            });
        });
    });
});

/**
 * 4. 가족 구성원 및 사진 등록 현황 조회
 * GET /api/admin/album/members
 */
router.get('/members', (req, res) => {
    const sql = `
        SELECT 
            fm.id,
            fm.user_id,
            fm.nickname,
            fm.avatar_emoji,
            fm.role,
            fm.is_active,
            fm.created_at,
            (SELECT COUNT(*) FROM photos WHERE member_id = fm.id) as photo_count,
            (SELECT COUNT(*) FROM photo_comments WHERE member_id = fm.id) as comment_count
        FROM family_members fm
        ORDER BY fm.id ASC
    `;

    albumDb.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: '가족 구성원 조회 실패' });
        }
        res.json({
            success: true,
            members: rows || []
        });
    });
});

/**
 * 5. 🤖 AI 사진 분석 이력 로그 조회 API
 * GET /api/admin/album/ai-logs?page=1&limit=30
 */
router.get('/ai-logs', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = (page - 1) * limit;

    const sql = `
        SELECT l.*, p.original_name, p.thumbnail_filename
        FROM ai_logs l
        LEFT JOIN photos p ON l.photo_id = p.id
        ORDER BY l.id DESC
        LIMIT ? OFFSET ?
    `;

    albumDb.all(sql, [limit, offset], (err, rows) => {
        if (err) {
            return res.json({
                success: true,
                logs: [],
                stats: { totalCount: 0, successCount: 0, avgDurationMs: 0, successRate: 100 },
                pagination: { page, limit, total: 0, totalPages: 0 }
            });
        }

        const countSql = 'SELECT COUNT(*) as total FROM ai_logs';
        albumDb.get(countSql, [], (cErr, cRow) => {
            const total = cRow ? cRow.total : (rows || []).length;
            const statsSql = `
                SELECT 
                    COUNT(*) as total_count,
                    COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as success_count,
                    COALESCE(AVG(duration_ms), 0) as avg_duration_ms
                FROM ai_logs
            `;
            albumDb.get(statsSql, [], (sErr, sRow) => {
                const totalCount = sRow ? sRow.total_count : 0;
                const successCount = sRow ? sRow.success_count : 0;
                const avgDuration = sRow ? Math.round(sRow.avg_duration_ms) : 0;
                const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100;

                res.json({
                    success: true,
                    logs: rows || [],
                    stats: { totalCount, successCount, avgDurationMs: avgDuration, successRate },
                    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
                });
            });
        });
    });
});

module.exports = router;
