/**
 * ==============================================================================
 * 어린이 학습실 그림 작품 관리자 제어 라우터 (studyArtwork.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const {
    listStudyArtworks,
    getArtworkFilePath,
    shareExistingArtworkToAlbum,
    deleteStudyArtwork
} = require('../../services/study/studyArtwork.service');

router.get('/', async (req, res) => {
    try {
        const artworks = await listStudyArtworks({
            childId: req.query.childId || '',
            limit: req.query.limit || 24
        });
        res.json({ success: true, artworks });
    } catch (err) {
        console.error('관리자 학습실 작품 조회 오류:', err);
        res.status(500).json({ success: false, message: '작품 목록을 조회하지 못했습니다.' });
    }
});

router.get('/:id/image', async (req, res) => {
    try {
        const found = await getArtworkFilePath(req.params.id);
        if (!found) return res.status(404).send('작품 이미지를 찾을 수 없습니다.');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(found.fullPath);
    } catch (err) {
        return res.status(500).send('이미지 조회 중 오류가 발생했습니다.');
    }
});

router.post('/:id/share', async (req, res) => {
    try {
        const result = await shareExistingArtworkToAlbum(req.params.id, req.headers.cookie || '');
        res.json({
            success: true,
            message: '선택한 아이 그림을 가족앨범에 등록했습니다.',
            ...result
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            message: err?.message || '가족앨범 등록에 실패했습니다.'
        });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await deleteStudyArtwork(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: '삭제할 작품을 찾지 못했습니다.' });
        }
        res.json({ success: true, message: '학습실 작품 기록과 이미지 파일을 삭제했습니다.' });
    } catch (err) {
        res.status(500).json({ success: false, message: '작품 삭제 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
