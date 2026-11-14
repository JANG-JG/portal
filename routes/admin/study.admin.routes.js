/**
 * ==============================================================================
 * 어린이 학습실 · Gemini 할당량 · 암호화 텔레그램 화이트리스트 관리자 API
 * (study.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 8] API 키·텔레그램 ID 평문 노출 금지 (블라인드 마스킹 & boolean 상태만 반환)
 * [규칙 11] 관리자 페이지 실시간 모니터링·제어·아이 전용 계정 원클릭 발급
 * ==============================================================================
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const router = express.Router();
const { db } = require('../../services/db');
const {
    dbAll,
    dbRun,
    getProfiles,
    getChildLevels,
    getActiveStampBoard,
    getDailyQuotaStatus,
    getSystemConfig,
    setSystemConfig,
    setParentLockPin,
    normalizeChildId
} = require('../../services/study/studyDb.service');
const { resolveGeminiApiKey } = require('../../services/study/geminiWorksheet.service');
const {
    listAllowedTelegramUsers,
    addAllowedTelegramUser,
    toggleAllowedTelegramUser,
    removeAllowedTelegramUser,
    listRecentTelegramLogs
} = require('../../services/telegram/telegramAuth.service');

router.get('/overview', async (req, res) => {
    try {
        const profiles = await getProfiles();
        const children = [];
        for (const p of profiles) {
            children.push({
                ...p,
                levels: await getChildLevels(p.id),
                stampBoard: await getActiveStampBoard(p.id)
            });
        }

        const quota = await getDailyQuotaStatus();
        const geminiModel = await getSystemConfig('study_gemini_model', 'gemini-2.5-flash');
        const hasParentPin = Boolean(await getSystemConfig('study_parent_pin', ''));
        const recentSheets = await dbAll(
            'SELECT id, child_id, subject, level, theme, title, source, completed_at, created_by, created_at FROM study_sheets ORDER BY id DESC LIMIT 20'
        );
        const telegramUsers = await listAllowedTelegramUsers();
        const telegramLogs = await listRecentTelegramLogs(25);

        const kidAccounts = await new Promise((resolve) => {
            db.all(
                "SELECT rowid as id, username, nickname, role, avatar_emoji, invite_token, pin_reset_required, last_login_at FROM users WHERE role = 'kid' ORDER BY rowid ASC",
                [],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map((r) => ({
                        id: r.id,
                        username: r.username,
                        nickname: r.nickname,
                        emoji: r.avatar_emoji || '🎒',
                        pinResetRequired: Boolean(r.pin_reset_required),
                        inviteUrl: r.invite_token ? `https://j-jg.cc/invite/${r.invite_token}` : '',
                        lastLoginAt: r.last_login_at
                    })));
                }
            );
        });

        res.json({
            success: true,
            children,
            quota,
            config: {
                geminiModel,
                dailyLimit: quota.dailyLimit,
                hasParentPin,
                hasGeminiKey: Boolean(resolveGeminiApiKey()),
                hasTelegramToken: Boolean(
                    process.env.STUDY_TELEGRAM_BOT_TOKEN ||
                    process.env.SERVER_TELEGRAM_BOT_TOKEN ||
                    process.env.TELEGRAM_BOT_TOKEN
                )
            },
            recentSheets,
            telegramUsers,
            telegramLogs,
            kidAccounts
        });
    } catch (err) {
        console.error('관리자 학습실 현황 조회 오류:', err);
        res.status(500).json({ success: false, message: '학습실 관리 현황 조회에 실패했습니다.' });
    }
});

router.post('/config', async (req, res) => {
    try {
        const { dailyLimit, geminiModel, parentPin, clearParentPin } = req.body || {};

        if (dailyLimit !== undefined && dailyLimit !== '') {
            const num = Math.min(500, Math.max(1, Number(dailyLimit) || 30));
            await setSystemConfig('study_daily_gemini_limit', String(num));
        }
        if (geminiModel && typeof geminiModel === 'string') {
            await setSystemConfig('study_gemini_model', geminiModel.trim().slice(0, 60));
        }
        if (clearParentPin === true) {
            await setParentLockPin('');
        } else if (parentPin && String(parentPin).trim()) {
            await setParentLockPin(String(parentPin).trim());
        }

        res.json({ success: true, message: '학습실 운영 설정이 저장되었습니다.' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '설정 저장에 실패했습니다.' });
    }
});

router.post('/profile/:childId', async (req, res) => {
    try {
        const cid = normalizeChildId(req.params.childId);
        const { displayName, targetReward, avatarEmoji } = req.body || {};
        await dbRun(
            `UPDATE study_profiles
             SET display_name = COALESCE(NULLIF(?, ''), display_name),
                 target_reward = COALESCE(NULLIF(?, ''), target_reward),
                 avatar_emoji = COALESCE(NULLIF(?, ''), avatar_emoji)
             WHERE id = ?`,
            [
                String(displayName || '').trim().slice(0, 20),
                String(targetReward || '').trim().slice(0, 60),
                String(avatarEmoji || '').trim().slice(0, 8),
                cid
            ]
        );
        res.json({ success: true, message: '아이 학습 프로필 정보가 업데이트되었습니다.' });
    } catch (err) {
        res.status(500).json({ success: false, message: '프로필 수정 실패' });
    }
});

router.post('/telegram/users', async (req, res) => {
    try {
        const { telegramId, label, portalUsername, role } = req.body || {};
        const added = await addAllowedTelegramUser({ telegramId, label, portalUsername, role });
        res.json({
            success: true,
            message: `[${added.label}] 텔레그램 ID가 암호화되어 안전하게 등록되었습니다.`,
            user: added
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '텔레그램 사용자 등록 실패' });
    }
});

router.post('/telegram/users/:id/toggle', async (req, res) => {
    try {
        await toggleAllowedTelegramUser(req.params.id, Boolean(req.body?.enabled));
        res.json({ success: true, message: '텔레그램 사용자 상태가 변경되었습니다.' });
    } catch (err) {
        res.status(500).json({ success: false, message: '상태 변경 실패' });
    }
});

router.delete('/telegram/users/:id', async (req, res) => {
    try {
        await removeAllowedTelegramUser(req.params.id);
        res.json({ success: true, message: '텔레그램 허용 목록에서 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ success: false, message: '삭제 실패' });
    }
});

router.post('/kid-account', async (req, res) => {
    try {
        const rawUsername = String(req.body?.username || 'kids').trim().toLowerCase();
        const nickname = String(req.body?.nickname || '우리 아이들 태블릿').trim().slice(0, 20);
        const initialPin = String(req.body?.initialPin || '').trim();
        const emoji = String(req.body?.emoji || '🎒').trim().slice(0, 8);

        if (!/^[a-z0-9_]{3,20}$/.test(rawUsername)) {
            return res.status(400).json({ success: false, message: '계정 아이디는 영문 소문자/숫자/_ 3~20자로 입력해 주세요.' });
        }
        if (!/^\d{6}$/.test(initialPin)) {
            return res.status(400).json({ success: false, message: '초기 간편 로그인 PIN은 숫자 6자리여야 합니다.' });
        }

        const existing = await new Promise((resolve) => {
            db.get('SELECT rowid FROM users WHERE username = ?', [rawUsername], (e, row) => resolve(row || null));
        });
        if (existing) {
            return res.status(409).json({ success: false, message: `이미 '${rawUsername}' 계정이 존재합니다.` });
        }

        const pinHash = await bcrypt.hash(initialPin, 10);
        const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
        const inviteToken = crypto.randomBytes(16).toString('hex');
        const allowedServicesJson = JSON.stringify(['study']);

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (
                    username, password, pin, role, allowed_services, admin_memo, nickname,
                    avatar_emoji, pin_reset_required, invite_token, failed_pin_attempts, is_registered, created_at
                ) VALUES (?, ?, ?, 'kid', ?, ?, ?, ?, 1, ?, 0, 1, datetime('now', 'localtime'))`,
                [rawUsername, randomPasswordHash, pinHash, allowedServicesJson, nickname, nickname, emoji, inviteToken],
                (err) => (err ? reject(err) : resolve())
            );
        });

        res.json({
            success: true,
            message: `아이 전용 학습실 계정(${rawUsername})이 발급되었습니다! 태블릿에서 초대 링크로 접속해 주세요.`,
            inviteUrl: `https://j-jg.cc/invite/${inviteToken}`,
            localInvitePath: `/invite/${inviteToken}`
        });
    } catch (err) {
        console.error('아이 전용 계정 발급 오류:', err);
        res.status(500).json({ success: false, message: '계정 발급 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
