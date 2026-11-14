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
// 🛡️ 1회성 비밀번호 초기화 확인 토큰 저장소 (token -> { username, expiresAt })
const pendingResetTokens = new Map();

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 15분마다 만료된 레이트 리밋 & 확인 토큰 정리
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of resetAttemptsMap.entries()) {
        if ((entry.lockedUntil && entry.lockedUntil <= now) || (now - entry.firstAttemptAt > 30 * 60 * 1000)) {
            resetAttemptsMap.delete(ip);
        }
    }
    for (const [tok, info] of pendingResetTokens.entries()) {
        if (!info || info.expiresAt <= now) {
            pendingResetTokens.delete(tok);
        }
    }
}, 15 * 60 * 1000).unref();

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

function renderResetPage(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - JG 통합 포털</title>
    <style>
        body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:16px; background:#09090b; color:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Pretendard',sans-serif; box-sizing:border-box; }
        .card { width:100%; max-width:420px; background:#18181b; border:1px solid #27272a; border-radius:14px; padding:24px; box-sizing:border-box; text-align:center; }
        .btn { display:inline-block; width:100%; min-height:44px; line-height:44px; padding:0 16px; border:none; border-radius:8px; background:#2563eb; color:#fff; font-weight:700; font-size:0.95rem; cursor:pointer; text-decoration:none; box-sizing:border-box; }
        .pw-box { background:#09090b; border:1px solid #3f3f46; border-radius:8px; padding:14px; margin:16px 0; font-family:monospace; font-size:1.35rem; letter-spacing:2px; color:#60a5fa; user-select:all; }
    </style>
</head>
<body><div class="card">${bodyHtml}</div></body>
</html>`;
}

/**
 * POST /api/reset-password
 * 비밀번호 분실 시 본인 확인 후 1회성 재설정 확인 링크 이메일 발송 (확인 클릭 시에만 비밀번호 변경)
 */
router.post('/api/reset-password', async (req, res) => {
    const { username, email } = req.body;
    const clientIp = getClientIp(req);

    const limitCheck = checkResetRateLimit(clientIp);
    if (!limitCheck.allowed) {
        return res.status(429).json({
            success: false,
            message: `비밀번호 재설정 시도가 너무 많습니다. 약 ${limitCheck.remainingMinutes}분 후에 다시 시도해 주세요.`
        });
    }
    recordResetAttempt(clientIp);

    const genericSuccessMsg = '입력하신 정보가 등록된 계정과 일치하면 해당 이메일로 비밀번호 초기화 확인 링크가 발송됩니다.';

    const trimmedUsername = (username || '').trim();
    const trimmedEmail = (email || '').trim().toLowerCase();

    if (!trimmedUsername || !trimmedEmail) {
        return res.status(400).json({ success: false, message: '아이디와 이메일 주소를 모두 입력해 주세요.' });
    }

    db.get('SELECT rowid, username, nickname, role, email FROM users WHERE username = ?', [trimmedUsername], async (err, user) => {
        if (err || !user) {
            return res.json({ success: true, message: genericSuccessMsg });
        }

        const isAdmin = user.role === 'admin' || user.rowid === 1 || ADMIN_USERS.has(user.username);
        const configuredAdminEmail = (process.env.EMAIL_USER || '').trim().toLowerCase();
        const userRegisteredEmail = (user.email || '').trim().toLowerCase();

        const isEmailMatched = isAdmin
            ? ((userRegisteredEmail && trimmedEmail === userRegisteredEmail) || (configuredAdminEmail && trimmedEmail === configuredAdminEmail))
            : Boolean(userRegisteredEmail && trimmedEmail === userRegisteredEmail);

        if (!isEmailMatched) {
            return res.json({ success: true, message: genericSuccessMsg });
        }

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.error('❌ [비밀번호 초기화] 이메일 발송 환경변수(EMAIL_USER / EMAIL_PASS) 누락');
            return res.status(500).json({ success: false, message: '메일 발송 서버 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        pendingResetTokens.set(resetToken, {
            username: user.username,
            expiresAt: Date.now() + 15 * 60 * 1000
        });

        const confirmUrl = `https://j-jg.cc/api/reset-password/confirm?token=${encodeURIComponent(resetToken)}`;
        const safeNickname = escapeHtml(user.nickname || user.username);
        const safeUsername = escapeHtml(user.username);

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
            subject: '🏠 [JG 통합 포털] 비밀번호 초기화 확인 안내',
            text: `안녕하세요. ${user.nickname || user.username} (${user.username}) 계정의 비밀번호 초기화가 요청되었습니다.\n\n본인이 요청한 경우 아래 링크(15분간 유효, 1회성)를 열어 새 임시 비밀번호를 발급받으세요:\n${confirmUrl}\n\n본인이 요청하지 않았다면 이 메일을 무시하세요. 기존 비밀번호는 변경되지 않습니다.`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #27272a; border-radius: 12px; background-color: #121215; color: #f4f4f5;">
                    <h2 style="color: #f4f4f5; margin-top: 0; font-size: 1.25rem;">🏠 JG 통합 포털</h2>
                    <p style="color: #a1a1aa; font-size: 0.9rem; line-height: 1.5;">
                        안녕하세요, <strong>${safeNickname}</strong>님.<br>
                        계정(<strong>${safeUsername}</strong>)의 비밀번호 초기화가 요청되었습니다.<br>
                        확인 버튼을 누르기 전까지는 기존 비밀번호가 변경되지 않습니다.
                    </p>
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${escapeHtml(confirmUrl)}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 0.95rem; font-weight: bold; display: inline-block;">
                            임시 비밀번호 발급 확인 (15분 유효)
                        </a>
                    </div>
                    <p style="color: #71717a; font-size: 0.8rem; margin: 0;">
                        본인이 요청하지 않으셨다면 이 메일을 무시하셔도 안전합니다.
                    </p>
                </div>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            res.json({
                success: true,
                message: '입력하신 이메일로 비밀번호 초기화 확인 링크가 발송되었습니다. 메일함을 확인해 주세요.'
            });
        } catch (mailErr) {
            pendingResetTokens.delete(resetToken);
            console.error('비밀번호 재설정 이메일 발송 실패:', mailErr);
            res.status(500).json({
                success: false,
                message: '이메일 발송 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
            });
        }
    });
});

/**
 * GET /api/reset-password/confirm
 * 메일 스캐너 자동 클릭(GET)으로 인한 오발급 방지를 위해 명시적 POST 확인 폼 제공
 */
router.get('/api/reset-password/confirm', (req, res) => {
    const token = String(req.query.token || '').trim();
    const entry = pendingResetTokens.get(token);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (!entry || entry.expiresAt <= Date.now()) {
        pendingResetTokens.delete(token);
        return res.status(400).send(renderResetPage('만료된 링크', `
            <h2 style="margin-top:0;">⏰ 링크가 만료되었거나 유효하지 않습니다</h2>
            <p style="color:#a1a1aa; font-size:0.9rem;">비밀번호 초기화를 다시 요청해 주세요.</p>
            <a href="/login" class="btn" style="background:#27272a; margin-top:12px;">로그인 화면으로 이동</a>
        `));
    }

    res.send(renderResetPage('비밀번호 초기화 확인', `
        <h2 style="margin-top:0;">🔐 비밀번호 초기화 확인</h2>
        <p style="color:#a1a1aa; font-size:0.9rem; line-height:1.5;">
            계정 <strong>${escapeHtml(entry.username)}</strong>의 새 임시 비밀번호를 발급하시겠습니까?
        </p>
        <form method="POST" action="/api/reset-password/confirm" style="margin-top:16px;">
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            <button type="submit" class="btn">임시 비밀번호 발급받기</button>
        </form>
    `));
});

/**
 * POST /api/reset-password/confirm
 * 1회성 토큰 소비 후 새 임시 비밀번호 적용
 */
router.post('/api/reset-password/confirm', async (req, res) => {
    const token = String(req.body?.token || '').trim();
    const entry = pendingResetTokens.get(token);
    pendingResetTokens.delete(token);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (!entry || entry.expiresAt <= Date.now()) {
        return res.status(400).send(renderResetPage('만료된 요청', `
            <h2 style="margin-top:0;">⏰ 유효하지 않거나 만료된 요청입니다</h2>
            <p style="color:#a1a1aa; font-size:0.9rem;">보안을 위해 링크는 1회성·15분 유효입니다. 다시 요청해 주세요.</p>
            <a href="/login" class="btn" style="background:#27272a; margin-top:12px;">로그인 화면으로 이동</a>
        `));
    }

    const tempPassword = crypto.randomBytes(5).toString('hex');
    const hashedTemp = await bcrypt.hash(tempPassword, 10);

    db.run(
        'UPDATE users SET password = ? WHERE username = ?',
        [hashedTemp, entry.username],
        (dbErr) => {
            if (dbErr) {
                console.error('임시 비밀번호 DB 업데이트 실패:', dbErr);
                return res.status(500).send(renderResetPage('오류 발생', `
                    <h2 style="margin-top:0;">❌ 처리 중 오류가 발생했습니다</h2>
                    <a href="/login" class="btn" style="background:#27272a; margin-top:12px;">로그인 화면으로 이동</a>
                `));
            }
            res.send(renderResetPage('임시 비밀번호 발급 완료', `
                <h2 style="margin-top:0;">✅ 임시 비밀번호 발급 완료</h2>
                <p style="color:#a1a1aa; font-size:0.9rem;">아래 임시 비밀번호로 로그인한 뒤 비밀번호를 변경해 주세요.</p>
                <div class="pw-box">${escapeHtml(tempPassword)}</div>
                <a href="/login" class="btn">로그인 화면으로 이동</a>
            `));
        }
    );
});

module.exports = router;
