/**
 * ==============================================================================
 * 가족 계정 및 접근 권한(RBAC) 관리 라우터 (family.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수 (약 200줄)
 * [규칙 8] 평문 시크릿/전화번호 미저장 (HMAC-SHA256 단방향 해시)
 * ==============================================================================
 */

const fs = require('fs');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db } = require('../../services/db');
const { JWT_SECRET, ALBUM_DB_PATH } = require('../../config/constants');

// 전화번호 단방향 해시 헬퍼 (평문 전화번호 서버 미저장)
function hashPhoneNumber(phone) {
    if (!phone) return '';
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (!cleanPhone) return '';
    return crypto.createHmac('sha256', JWT_SECRET).update(cleanPhone).digest('hex');
}

/**
 * 1. 가족 구성원 목록 조회 API
 * GET /api/admin/family/members
 */
router.get('/members', (req, res) => {
    const query = `
        SELECT 
            rowid,
            username,
            admin_memo,
            nickname,
            role,
            email,
            birthdate,
            is_registered,
            allowed_services,
            pin_reset_required,
            invite_token,
            failed_pin_attempts,
            locked_until,
            created_at,
            last_login_at
        FROM users
        ORDER BY rowid ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('가족 구성원 목록 조회 오류:', err);
            return res.status(500).json({ success: false, message: '가족 목록을 불러오지 못했습니다.' });
        }

        const now = new Date();
        const members = (rows || []).map(row => {
            let allowedServices = ['album', 'news'];
            try {
                if (row.allowed_services) {
                    allowedServices = JSON.parse(row.allowed_services);
                }
            } catch (e) {}

            const isLocked = Boolean(row.locked_until && new Date(row.locked_until) > now);

            // 초대 토큰이 없는 경우 자동 생성 후 백그라운드 저장
            let inviteToken = row.invite_token;
            if (!inviteToken && row.role !== 'admin') {
                inviteToken = crypto.randomBytes(16).toString('hex');
                db.run('UPDATE users SET invite_token = ? WHERE username = ?', [inviteToken, row.username]);
            }

            return {
                id: row.rowid,
                username: row.username,
                adminMemo: row.admin_memo || '',
                nickname: row.nickname || (row.role === 'admin' ? '관리자 (나)' : row.username),
                role: row.role || (row.rowid === 1 ? 'admin' : 'family'),
                email: row.email || '',
                birthdate: row.birthdate || '',
                isRegistered: Boolean(row.is_registered === 1),
                allowedServices,
                pinResetRequired: Boolean(row.pin_reset_required),
                inviteToken,
                inviteUrl: inviteToken ? `https://j-jg.cc/invite/${inviteToken}` : '',
                failedAttempts: row.failed_pin_attempts || 0,
                isLocked,
                lockedUntil: row.locked_until,
                createdAt: row.created_at,
                lastLoginAt: row.last_login_at
            };
        });

        res.json({ success: true, members });
    });
});

/**
 * 2. 신규 가족 초대 링크 생성 API
 * POST /api/admin/family/members
 */
router.post('/members', async (req, res) => {
    try {
        const nickname = (req.body.nickname || '').trim();
        let allowedServices = req.body.allowedServices;

        if (!nickname) {
            return res.status(400).json({ success: false, message: '관리용 명칭(가족 호칭 메모)을 입력해 주세요.' });
        }

        if (!Array.isArray(allowedServices) || allowedServices.length === 0) {
            allowedServices = ['album', 'news'];
        }

        // 가입 완료 전 임시 식별용 고유 아이디 및 초대 토큰 생성
        const randomId = crypto.randomBytes(4).toString('hex');
        const username = `pending_${randomId}`;
        const inviteToken = crypto.randomBytes(16).toString('hex');
        const servicesJson = JSON.stringify(allowedServices);

        const insertSql = `
            INSERT INTO users (
                username,
                password,
                pin,
                role,
                allowed_services,
                admin_memo,
                nickname,
                pin_reset_required,
                invite_token,
                failed_pin_attempts,
                is_registered
            ) VALUES (?, '', '', 'family', ?, ?, ?, 1, ?, 0, 0)
        `;

        db.run(insertSql, [username, servicesJson, nickname, nickname, inviteToken], function (insErr) {
            if (insErr) {
                console.error('가족 초대 링크 생성 실패:', insErr);
                return res.status(500).json({ success: false, message: '초대 링크 생성 실패: ' + insErr.message });
            }

            res.json({
                success: true,
                message: `[${nickname}]님의 가족 초대 링크가 발급되었습니다.`,
                member: {
                    id: this.lastID,
                    username,
                    adminMemo: nickname,
                    nickname,
                    inviteToken,
                    inviteUrl: `https://j-jg.cc/invite/${inviteToken}`
                }
            });
        });
    } catch (err) {
        console.error('가족 추가 처리 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 3. 가족 구성원 정보(호칭/이메일/생년월일/허용 서비스) 수정 API
 * PUT /api/admin/family/members/:username
 */
router.put('/members/:username', (req, res) => {
    const targetUsername = req.params.username;
    const nickname = (req.body.nickname || '').trim();
    const adminMemo = (req.body.adminMemo !== undefined ? req.body.adminMemo : nickname).trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const birthdate = (req.body.birthdate || '').trim();
    const allowedServices = req.body.allowedServices;

    if (!nickname) {
        return res.status(400).json({ success: false, message: '호칭(프로필명)을 입력해 주세요.' });
    }

    const servicesJson = Array.isArray(allowedServices) ? JSON.stringify(allowedServices) : JSON.stringify(['album', 'news']);

    db.run(
        'UPDATE users SET admin_memo = ?, nickname = ?, email = ?, birthdate = ?, allowed_services = ? WHERE username = ?',
        [adminMemo, nickname, email, birthdate, servicesJson, targetUsername],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: '정보 수정 실패: ' + err.message });

            // 가족 앨범 DB(family_members)도 실시간 닉네임 동기화
            if (fs.existsSync(ALBUM_DB_PATH)) {
                const sqlite3 = require('sqlite3').verbose();
                const albumDb = new sqlite3.Database(ALBUM_DB_PATH, (aErr) => {
                    if (!aErr) {
                        albumDb.run(
                            'UPDATE family_members SET nickname = ? WHERE user_id = ?',
                            [nickname, targetUsername],
                            () => { albumDb.close(); }
                        );
                    }
                });
            }

            res.json({ success: true, message: '가족 정보가 성공적으로 수정되었습니다.' });
        }
    );
});

/**
 * 4. 임시 PIN 재설정 API (관리자 초기화)
 * POST /api/admin/family/members/:username/reset-pin
 */
router.post('/members/:username/reset-pin', async (req, res) => {
    try {
        const targetUsername = req.params.username;
        const newPin = String(req.body.newPin || '').trim();

        if (!/^\d{6}$/.test(newPin)) {
            return res.status(400).json({ success: false, message: '초기화할 PIN은 숫자 6자리로 입력해 주세요.' });
        }

        const pinHash = await bcrypt.hash(newPin, 10);
        const updateSql = `
            UPDATE users SET 
                pin = ?, 
                password = ?, 
                pin_reset_required = 1, 
                failed_pin_attempts = 0, 
                locked_until = NULL 
            WHERE username = ?
        `;

        db.run(updateSql, [pinHash, pinHash, targetUsername], function (err) {
            if (err) return res.status(500).json({ success: false, message: 'PIN 재설정 실패' });
            res.json({
                success: true,
                message: `임시 PIN이 [${newPin}]으로 재설정되었습니다. (최초 접속 시 변경 필수)`
            });
        });
    } catch (err) {
        res.status(500).json({ success: false, message: '서버 오류 발생' });
    }
});

/**
 * 5. 잠금 해제 API (5회 오류 잠금 즉시 해제)
 * POST /api/admin/family/members/:username/unlock
 */
router.post('/members/:username/unlock', (req, res) => {
    const targetUsername = req.params.username;
    db.run(
        'UPDATE users SET failed_pin_attempts = 0, locked_until = NULL WHERE username = ?',
        [targetUsername],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: '잠금 해제 실패' });
            res.json({ success: true, message: '로그인 잠금이 정상적으로 해제되었습니다.' });
        }
    );
});

/**
 * 6. 가족 구성원 삭제 API
 * DELETE /api/admin/family/members/:username
 */
router.delete('/members/:username', (req, res) => {
    const targetUsername = req.params.username;

    db.get('SELECT rowid, role FROM users WHERE username = ?', [targetUsername], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, message: '해당 사용자를 찾을 수 없습니다.' });

        if (user.role === 'admin' || user.rowid === 1) {
            return res.status(403).json({ success: false, message: '관리자 본인 계정은 삭제할 수 없습니다.' });
        }

        db.run('DELETE FROM users WHERE username = ?', [targetUsername], (delErr) => {
            if (delErr) return res.status(500).json({ success: false, message: '계정 삭제 실패' });
            res.json({ success: true, message: '가족 구성원 계정이 삭제되었습니다.' });
        });
    });
});

module.exports = router;
