/**
 * ==============================================================================
 * 초대 기반 가족 회원가입 전용 라우터 (auth.register.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 자연스러운 일상 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수 (약 150줄)
 * [규칙 8] 비밀번호 bcrypt 강력 단방향 해싱 (Salt rounds 10)
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../services/db');
const { JWT_SECRET } = require('../config/constants');
const { getClientIp, recordLoginLog } = require('../middleware/auth');

/**
 * 1. 초대 토큰 유효성 확인 API
 * GET /api/auth/invite-info/:token
 */
router.get('/api/auth/invite-info/:token', (req, res) => {
    const inviteToken = req.params.token;
    if (!inviteToken) {
        return res.status(400).json({ success: false, message: '초대 토큰이 제공되지 않았습니다.' });
    }

    db.get(
        'SELECT username, nickname, admin_memo, role, is_registered, allowed_services FROM users WHERE invite_token = ?',
        [inviteToken],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ success: false, message: '유효하지 않거나 만료된 초대 링크입니다.' });
            }

            res.json({
                success: true,
                isRegistered: Boolean(user.is_registered === 1),
                adminMemo: user.admin_memo || '',
                nickname: user.nickname || '',
                username: user.is_registered === 1 ? user.username : ''
            });
        }
    );
});

/**
 * 2. 초대 기반 가족 회원가입 API
 * POST /api/auth/register
 * 
 * 수집 항목:
 * - inviteToken: 초대 토큰
 * - username: 사용자 아이디 (영문/숫자 4~20자)
 * - email: 이메일 주소
 * - password: 비밀번호 (8자 이상)
 * - nickname: 프로필명/호칭 (2~20자)
 * - birthdate: 생년월일 (YYMMDD 또는 YYYY-MM-DD)
 */
router.post('/api/auth/register', async (req, res) => {
    const { inviteToken, username, email, password, nickname, birthdate } = req.body;
    const clientIp = getClientIp(req);

    // 1) 기본 필수값 검증
    const trimmedUsername = (username || '').trim().toLowerCase();
    const trimmedEmail = (email || '').trim().toLowerCase();
    const trimmedNickname = (nickname || '').trim();
    const trimmedBirthdate = (birthdate || '').trim();

    if (!inviteToken) {
        return res.status(400).json({ success: false, message: '초대 토큰이 누락되었습니다.' });
    }

    if (!trimmedUsername || !trimmedEmail || !password || !trimmedNickname || !trimmedBirthdate) {
        return res.status(400).json({ success: false, message: '모든 필수 정보를 입력해 주세요.' });
    }

    // 아이디 형식 검사: 영문 소문자, 숫자, 언더스코어 조합 (4~20자)
    if (!/^[a-z0-9_]{4,20}$/.test(trimmedUsername)) {
        return res.status(400).json({ success: false, message: '아이디는 영문 소문자, 숫자, _ 조합으로 4~20자 이내여야 합니다.' });
    }

    // 이메일 형식 검사
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return res.status(400).json({ success: false, message: '올바른 이메일 주소 형식을 입력해 주세요.' });
    }

    // 비밀번호 길이 검사 (최소 8자 이상)
    if (String(password).length < 8) {
        return res.status(400).json({ success: false, message: '비밀번호는 최소 8자 이상으로 안전하게 설정해 주세요.' });
    }

    // 2) 초대 토큰 확인
    db.get('SELECT rowid, * FROM users WHERE invite_token = ?', [inviteToken], async (err, inviteUser) => {
        if (err || !inviteUser) {
            return res.status(404).json({ success: false, message: '유효하지 않거나 만료된 초대 링크입니다.' });
        }

        // 이미 가입이 완료된 계정인 경우
        if (inviteUser.is_registered === 1 && inviteUser.password) {
            return res.status(400).json({ success: false, message: '이미 가입이 완료된 초대 링크입니다. 로그인해 주세요.' });
        }

        // 3) 아이디 중복 확인 (다른 사용자가 이미 사용 중인지)
        db.get('SELECT rowid FROM users WHERE username = ? AND rowid != ?', [trimmedUsername, inviteUser.rowid], async (dupErr, existingUser) => {
            if (dupErr) {
                return res.status(500).json({ success: false, message: '아이디 중복 검증 중 오류가 발생했습니다.' });
            }
            if (existingUser) {
                return res.status(409).json({ success: false, message: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.' });
            }

            try {
                // 4) 강력한 비밀번호 암호화 (bcrypt salt 10)
                const hashedPassword = await bcrypt.hash(String(password), 10);

                // 5) 사용자 정보 업데이트 및 가입 완료 처리
                const updateSql = `
                    UPDATE users SET 
                        username = ?, 
                        email = ?, 
                        password = ?, 
                        nickname = ?, 
                        birthdate = ?, 
                        is_registered = 1, 
                        pin_reset_required = 1, 
                        failed_pin_attempts = 0, 
                        locked_until = NULL, 
                        created_at = datetime('now', 'localtime')
                    WHERE rowid = ?
                `;

                db.run(
                    updateSql,
                    [trimmedUsername, trimmedEmail, hashedPassword, trimmedNickname, trimmedBirthdate, inviteUser.rowid],
                    function (upErr) {
                        if (upErr) {
                            console.error('회원가입 정보 DB 저장 실패:', upErr);
                            return res.status(500).json({ success: false, message: '회원가입 처리 중 오류가 발생했습니다.' });
                        }

                        recordLoginLog(trimmedUsername, clientIp, 'REGISTER_SUCCESS');

                        // 6) 가입 직후 간편 비밀번호(6자리 PIN) 설정을 위한 30분 임시 토큰 발급
                        const tempToken = jwt.sign(
                            { username: trimmedUsername, role: inviteUser.role || 'family', purpose: 'pin_change_required' },
                            JWT_SECRET,
                            { expiresIn: '30m' }
                        );

                        res.json({
                            success: true,
                            message: `반갑습니다, ${trimmedNickname}님! 회원가입이 완료되었습니다. 이제 간편입장을 위한 6자리 PIN을 설정해 주세요.`,
                            tempToken,
                            username: trimmedUsername,
                            nickname: trimmedNickname
                        });
                    }
                );
            } catch (hashErr) {
                console.error('비밀번호 암호화 오류:', hashErr);
                res.status(500).json({ success: false, message: '비밀번호 암호화 처리 중 오류가 발생했습니다.' });
            }
        });
    });
});

module.exports = router;
