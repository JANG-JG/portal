const express = require('express');
const router = express.Router();
const { db } = require('../services/db');
const { authenticateToken } = require('../middleware/auth');
const { ADMIN_USERS } = require('../config/constants');

// 1. 메모 목록 조회 (상단 고정 우선, 최신 수정순 정렬)
router.get('/', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { category, search } = req.query;

    let query = "SELECT * FROM user_memos WHERE (user_id = ? OR user_id = 'admin')";
    const params = [userId];

    if (category && category !== 'all') {
        if (category === 'pinned') {
            query += " AND is_pinned = 1";
        } else if (category === 'scrap' || category === 'news') {
            query += " AND (category = 'scrap' OR category = 'news')";
        } else {
            query += " AND category = ?";
            params.push(category);
        }
    }

    if (search && search.trim()) {
        query += " AND (title LIKE ? OR content LIKE ?)";
        const term = `%${search.trim()}%`;
        params.push(term, term);
    }

    query += " ORDER BY is_pinned DESC, updated_at DESC, id DESC";

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('[Memo 조회 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 목록 조회 실패' });
        }
        res.json({ success: true, memos: rows || [] });
    });
});

// 2. 신규 메모/아이디어 등록
router.post('/', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { title, content, category = 'idea', color = '#fef3c7', is_pinned = 0 } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: '메모 내용을 입력해 주세요.' });
    }

    const cleanTitle = (title || '').trim();
    const cleanContent = content.trim();
    const validCategory = ['idea', 'todo', 'memo', 'important', 'scrap', 'news'].includes(category) ? category : 'idea';
    const validColors = ['#fef3c7', '#e0f2fe', '#dcfce7', '#f3e8ff', '#fee2e2'];
    const validColor = validColors.includes(color) ? color : '#fef3c7';

    const query = `
        INSERT INTO user_memos (user_id, title, content, category, color, is_pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `;

    db.run(query, [userId, cleanTitle, cleanContent, validCategory, validColor, is_pinned ? 1 : 0], function(err) {
        if (err) {
            console.error('[Memo 등록 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 등록 실패' });
        }
        res.json({ success: true, id: this.lastID, message: '새 메모가 등록되었습니다.' });
    });
});

// 3. 뉴스 기사 원터치 스크랩 API (외부/내부 연동)
router.post('/scrap', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const { title, link, mediaName, summary } = req.body;

    if (!title || !link) {
        return res.status(400).json({ success: false, message: '기사 제목과 링크가 필요합니다.' });
    }

    const cleanTitle = title.trim();
    const cleanMedia = (mediaName || '언론사').trim();
    const cleanLink = link.trim();
    const cleanSummary = (summary || '요약 정보 없음').trim().replace(/\n/g, '<br>');

    const scrapTitle = `[스크랩] ${cleanTitle}`;
    const scrapContent = `<p>📰 <strong>출처:</strong> ${cleanMedia} | <a href="${cleanLink}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; font-weight: 700; text-decoration: underline;">원문 이동 ↗</a></p><p><br></p><p>💡 <strong>핵심 요약:</strong></p><p>${cleanSummary}</p>`;
    const query = `
        INSERT INTO user_memos (user_id, title, content, category, color, is_pinned)
        VALUES (?, ?, ?, 'scrap', '#fef9c3', 0)
    `;

    db.run(query, [userId, scrapTitle, scrapContent], function(err) {
        if (err) {
            console.error('[Scrap 등록 실패]:', err.message);
            return res.status(500).json({ success: false, message: '스크랩 저장 실패: ' + err.message });
        }
        res.json({ success: true, id: this.lastID, message: '포털 메모장에 기사가 성공적으로 스크랩되었습니다.' });
    });
});

// 4. 메모 수정 (제목, 내용, 카테고리, 색상, 고정 여부)
router.put('/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const memoId = req.params.id;
    const { title, content, category = 'idea', color = '#fef3c7', is_pinned = 0 } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: '메모 내용을 입력해 주세요.' });
    }

    const cleanTitle = (title || '').trim();
    const cleanContent = content.trim();
    const validCategory = ['idea', 'todo', 'memo', 'important', 'scrap', 'news'].includes(category) ? category : 'idea';
    const validColors = ['#fef3c7', '#e0f2fe', '#dcfce7', '#f3e8ff', '#fee2e2'];
    const validColor = validColors.includes(color) ? color : '#fef3c7';

    const query = `
        UPDATE user_memos 
        SET title = ?, content = ?, category = ?, color = ?, is_pinned = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND (user_id = ? OR ? = 1)
    `;

    db.run(query, [cleanTitle, cleanContent, validCategory, validColor, is_pinned ? 1 : 0, memoId, userId, isAdmin], function(err) {
        if (err) {
            console.error('[Memo 수정 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 수정 실패' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '수정할 메모를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '메모가 성공적으로 수정되었습니다.' });
    });
});

// 5. 메모 상단 고정 토글 (📌 Pin / Unpin)
router.patch('/:id/pin', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const memoId = req.params.id;

    db.run(`
        UPDATE user_memos 
        SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END, updated_at = datetime('now', 'localtime')
        WHERE id = ? AND (user_id = ? OR ? = 1)
    `, [memoId, userId, isAdmin], function(err) {
        if (err) {
            console.error('[Memo 핀 토글 실패]:', err.message);
            return res.status(500).json({ success: false, message: '상단 고정 토글 실패' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '상단 고정 상태가 변경되었습니다.' });
    });
});

// 6. 메모 삭제
router.delete('/:id', authenticateToken, (req, res) => {
    const userId = req.user.username || 'admin';
    const isAdmin = (req.user.role === 'admin' || ADMIN_USERS.has(userId)) ? 1 : 0;
    const memoId = req.params.id;

    db.run("DELETE FROM user_memos WHERE id = ? AND (user_id = ? OR ? = 1)", [memoId, userId, isAdmin], function(err) {
        if (err) {
            console.error('[Memo 삭제 실패]:', err.message);
            return res.status(500).json({ success: false, message: '메모 삭제 실패' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '삭제할 메모를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '메모가 삭제되었습니다.' });
    });
});

module.exports = router;
