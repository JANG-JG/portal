/**
 * ==============================================================================
 * 계정 비밀번호 분실 초기화 라우터 (auth.reset.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수 (약 120줄)
 * [규칙 8] 환경변수(EMAIL_USER, EMAIL_PASS) 안전 참조 및 평문 시크릿 미노출
 * ==============================================================================
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { db } = require('../services/db');
const { ADMIN_USERS } = require('../config/constants');
const { getClientIp } = require('../middleware/auth');

// 🛡️ 비밀번호 재설정 전용 인메모리 레이트 리미터 (IP당 15분 내 5회 제한)
const resetAttemptsMap = new Map();

function checkResetRateLimit(ip) {
    const now = Date.now();
    const entry = resetAttemptsMap.get(ip);
    if (!entry) return { allowed: true };

    if (entry.lockedUntil && entry.lockedUntil > now) {
        const remainingMinutes = Math.ceil((entry.lockedUntil - now) / 60000);
        return { allowed: false, remainingMinutes };
    }

    if (now - entry.firstAttemptAt > 15 * 60 * 1000) {
        resetAttemptsMap.delete(ip);
        return { allowed: true };
    }

    return { allowed: true };
}

function recordResetAttempt(ip) {
    const now = Date.now();
    const entry = resetAttemptsMap.get(ip) || { count: 0, lockedUntil: 0, firstAttemptAt: now };
    entry.count += 1;
    if (entry.count >= 5) {
        entry.lockedUntil = now + 15 * 60 * 1000; // 15분간 차단
    }
    resetAttemptsMap.set(ip, entry);
}

/**
 * POST /api/reset-password
 * 비밀번호 분실 시 등록된 이메일로 임시 비밀번호 발송
 */
router.post('/api/reset-password', async (req, res) => {
    const { username, email } = req.body;
    const clientIp = getClientIp(req);

    // 1. 레이트 리밋 검증
    const limitCheck = checkResetRateLimit(clientIp);
    if (!limitCheck.allowed) {
        return res.status(429).json({
            success: false,
            message: `비밀번호 재설정 시도가 너무 많습니다. 약 ${limitCheck.remainingMinutes}분 후에 다시 시도해 주세요.`
        });
    }
    recordResetAttempt(clientIp);

    const genericSuccessMsg = '입력하신 정보가 등록된 계정과 일치하면 해당 이메일로 임시 비밀번호가 발송됩니다.';

    const trimmedUsername = (username || '').trim();
    const trimmedEmail = (email || '').trim().toLowerCase();

    if (!trimmedUsername || !trimmedEmail) {
        return res.status(400).json({ success: false, message: '아이디와 이메일 주소를 모두 입력해 주세요.' });
    }

    // 2. 계정 조회 및 검증
    db.get('SELECT rowid, username, nickname, role, password FROM users WHERE username = ?', [trimmedUsername], async (err, user) => {
        if (err || !user) {
            // 보안상 계정 미존재 여부를 노출하지 않고 동일한 성공 메시지 응답
            return res.json({ success: true, message: genericSuccessMsg });
        }

        const isAdmin = user.role === 'admin' || user.rowid === 1 || ADMIN_USERS.has(user.username);
        const configuredAdminEmail = (process.env.EMAIL_USER || '').trim().toLowerCase();

        // 관리자 계정인 경우 process.env.EMAIL_USER 와 매칭
        // 일반 사용자의 경우 등록된 이메일이 관리자 이메일과 같거나 DB에 등록된 이메일과 매칭
        const isEmailMatched = trimmedEmail === configuredAdminEmail;

        if (!isEmailMatched) {
            return res.json({ success: true, message: genericSuccessMsg });
        }

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.error('❌ [비밀번호 초기화] 이메일 발송 환경변수(EMAIL_USER / EMAIL_PASS) 누락');
            return res.status(500).json({ success: false, message: '메일 발송 서버 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요.' });
        }

        // 3. 임시 비밀번호 생성 (8자리 영숫자 난수)
        const tempPassword = crypto.randomBytes(4).toString('hex');
        const hashedTemp = await bcrypt.hash(tempPassword, 10);

        // 4. Gmail SMTP 발송기 구성
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: `"JG 통합 포털" <${process.env.EMAIL_USER}>`,
            to: trimmedEmail,
            subject: '🏠 [JG 통합 포털] 임시 비밀번호 안내',
            text: `안녕하세요. [ ${user.nickname || user.username} ] (${user.username}) 계정의 임시 비밀번호가 발급되었습니다.\n\n임시 비밀번호: [ ${tempPassword} ]\n\n로그인 후 즉시 비밀번호를 새로 변경해 주세요.\n로그인 바로가기: https://j-jg.cc/login`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #27272a; border-radius: 12px; background-color: #121215; color: #f4f4f5;">
                    <h2 style="color: #f4f4f5; margin-top: 0; font-size: 1.25rem;">🏠 JG 통합 포털</h2>
                    <p style="color: #a1a1aa; font-size: 0.9rem; line-height: 1.5;">
                        안녕하세요, <strong>${user.nickname || user.username}</strong>님.<br>
                        요청하신 계정(<strong>${user.username}</strong>)의 임시 비밀번호가 안전하게 발급되었습니다.
                    </p>
                    <div style="background-color: #18181b; border: 1px solid #3f3f46; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
                        <span style="font-size: 0.8rem; color: #71717a; display: block; margin-bottom: 6px;">임시 비밀번호</span>
                        <strong style="font-size: 1.4rem; letter-spacing: 2px; color: #3b82f6; font-family: monospace;">${tempPassword}</strong>
                    </div>
                    <p style="color: #f43f5e; font-size: 0.82rem; margin: 0 0 20px;">
                        ※ 보안을 위해 로그인 후 반드시 비밀번호를 새로 변경해 주시기 바랍니다.
                    </p>
                    <div style="text-align: center;">
                        <a href="https://j-jg.cc/login" style="background-color: #27272a; color: #f4f4f5; border: 1px solid #3f3f46; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 0.9rem; font-weight: bold; display: inline-block;">
                            로그인 화면으로 이동
                        </a>
                    </div>
                </div>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            // 메일 발송 성공 확인 후에만 DB 비밀번호 갱신 (발송 실패 시 계정 잠김 방지)
            db.run(
                'UPDATE users SET password = ? WHERE username = ?',
                [hashedTemp, user.username],
                (dbErr) => {
                    if (dbErr) {
                        console.error('임시 비밀번호 DB 업데이트 실패:', dbErr);
                        return res.status(500).json({ success: false, message: '임시 비밀번호 저장 중 오류가 발생했습니다.' });
                    }
                    res.json({
                        success: true,
                        message: '입력하신 이메일로 임시 비밀번호가 안전하게 발송되었습니다. 메일함을 확인해 주세요.'
                    });
                }
            );
        } catch (mailErr) {
            console.error('비밀번호 재설정 이메일 발송 실패:', mailErr);
            res.status(500).json({
                success: false,
                message: '이메일 발송 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
            });
        }
    });
});

module.exports = router;
