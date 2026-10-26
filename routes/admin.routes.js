const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db } = require('../services/db');

// 서브 관리자 라우터 마운트
const bloodAdminRoutes = require('./admin/blood.admin.routes');
const newsAdminRoutes = require('./admin/news.admin.routes');
const familyAdminRoutes = require('./admin/family.admin.routes');
const albumAdminRoutes = require('./admin/album.admin.routes');
const backupAdminRoutes = require('./admin/backup.admin.routes');
const dbAdminRoutes = require('./admin/db.admin.routes');
const assetAdminRoutes = require('./admin/asset.admin.routes');
const systemAdminRoutes = require('./admin/system.admin.routes');

router.use('/blood', bloodAdminRoutes);
router.use('/news', newsAdminRoutes);
router.use('/family', familyAdminRoutes);
router.use('/album', albumAdminRoutes);
router.use('/backup', backupAdminRoutes);
router.use('/db', dbAdminRoutes);
router.use('/asset', assetAdminRoutes);
router.use('/', systemAdminRoutes);

// 관리자 마스터 비밀번호 변경
router.post('/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: '새 비밀번호는 6자리 이상이어야 합니다.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [req.user.username], async (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
        }

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
            return res.status(400).json({ success: false, message: '현재 비밀번호가 일치하지 않습니다.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        db.run('UPDATE users SET password = ? WHERE username = ?', [newHash, req.user.username], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ success: false, message: '비밀번호 변경 중 데이터베이스 오류가 발생했습니다.' });
            }
            res.json({ success: true, message: '관리자 마스터 비밀번호가 성공적으로 변경되었습니다.' });
        });
    });
});

module.exports = router;
