/**
 * ==============================================================================
 * 어린이 학습실 색칠 작품 저장 & 가족앨범 자랑하기 API (studyArtwork.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    saveStudyArtwork,
    listStudyArtworks,
    getArtworkFilePath
} = require('../services/study/studyArtwork.service');

const artworkRateMap = new Map();
function allowArtworkUpload(key, maxCount = 15, windowMs = 10 * 60 * 1000) {
    const now = Date.now();
    const list = (artworkRateMap.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= maxCount) return false;
    list.push(now);
    artworkRateMap.set(key, list);
    return true;
}

router.get('/api/study/artworks', authenticateToken, async (req, res) => {
    try {
        const childId = req.query.childId ? String(req.query.childId) : '';
        const artworks = await listStudyArtworks({ childId, limit: req.query.limit || 20 });
        res.json({ success: true, artworks });
    } catch (err) {
        console.error('학습실 작품 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: '작품 목록을 불러오지 못했습니다.' });
    }
});

router.get('/api/study/artworks/:id/image', authenticateToken, async (req, res) => {
    try {
        const found = await getArtworkFilePath(req.params.id);
        if (!found) {
            return res.status(404).send('그림 파일을 찾을 수 없습니다.');
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.sendFile(found.fullPath);
    } catch (err) {
        return res.status(500).send('그림을 불러오는 중 오류가 발생했습니다.');
    }
});

router.post('/api/study/artworks', authenticateToken, async (req, res) => {
    const userKey = req.user?.username || req.ip || 'study';
    if (!allowArtworkUpload(`art:${userKey}`)) {
        return res.status(429).json({
            success: false,
            message: '잠시 쉬었다가 다시 그림을 올려 볼까요? (잠시 후 재시도해 주세요)'
        });
    }

    try {
        const { childId, title, templateId, sheetId, imageDataUrl, shareToAlbum } = req.body || {};
        const saved = await saveStudyArtwork({
            childId,
            authorUsername: req.user?.username || '',
            title,
            templateId,
            sheetId,
            imageDataUrl,
            shareToAlbum: shareToAlbum !== false,
            cookieHeader: req.headers.cookie || ''
        });

        let message = '내 그림을 예쁘게 저장했어요! 🎨';
        if (saved.albumStatus === 'shared') {
            message = '우와! 내 그림이 가족앨범에도 멋지게 올라갔어요! 🖼️✨';
        } else if (shareToAlbum !== false && !saved.albumShareEnabled) {
            message = '내 그림을 학습실에 보관했어요! (가족앨범 자동 올리기는 부모님이 껐어요)';
        } else if (saved.albumStatus === 'album_failed') {
            message = '그림은 학습실에 잘 저장했어요! (가족앨범 전송은 부모님 화면에서 다시 할 수 있어요)';
        }

        res.json({ success: true, message, artwork: saved });
    } catch (err) {
        console.error('학습실 그림 저장 오류:', err);
        res.status(400).json({
            success: false,
            message: err?.message || '그림을 저장하는 중 문제가 생겼어요.'
        });
    }
});

module.exports = router;
