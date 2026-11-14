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
    createStudyProfile,
    deleteStudyProfile,
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
        const kidRows = await new Promise((resolve) => {
            db.all(
                "SELECT rowid as id, username, nickname, role, avatar_emoji, invite_token, pin_reset_required, last_login_at FROM users WHERE role = 'kid' ORDER BY rowid ASC",
                [],
                (err, rows) => resolve(err ? [] : (rows || []))
            );
        });

        const profiles = await getProfiles();
        const children = [];
        for (const p of profiles) {
            const matchedKid = kidRows.find((k) =>
                (p.linked_username && k.username.toLowerCase() === p.linked_username.toLowerCase()) ||
                (!p.linked_username && (k.username.toLowerCase() === p.id.toLowerCase() || (k.nickname && k.nickname === p.display_name)))
            );
            children.push({
                id: p.id,
                displayName: p.display_name,
                birthYear: p.birth_year,
                avatarEmoji: p.avatar_emoji || '🌟',
                targetReward: p.target_reward || '',
                linkedUsername: p.linked_username || matchedKid?.username || '',
                isCore: p.id === 'first' || p.id === 'second',
                levels: await getChildLevels(p.id),
                stampBoard: await getActiveStampBoard(p.id)
            });
        }

        const kidAccounts = kidRows.map((r) => {
            const linkedProfile = children.find((c) => c.linkedUsername.toLowerCase() === r.username.toLowerCase());
            return {
                id: r.id,
                username: r.username,
                nickname: r.nickname,
                emoji: r.avatar_emoji || '🎒',
                pinResetRequired: Boolean(r.pin_reset_required),
                inviteUrl: r.invite_token ? `https://j-jg.cc/invite/${r.invite_token}` : '',
                lastLoginAt: r.last_login_at,
                linkedProfileId: linkedProfile?.id || '',
                linkedProfileName: linkedProfile?.displayName || ''
            };
        });

        const quota = await getDailyQuotaStatus();
        const geminiModel = await getSystemConfig('study_gemini_model', 'gemini-2.5-flash');
        const hasParentPin = Boolean(await getSystemConfig('study_parent_pin', ''));
        const recentSheets = await dbAll(
            `SELECT s.id, s.child_id, s.subject, s.level, s.theme, s.title, s.source, s.completed_at, s.created_by, s.created_at,
                    p.display_name AS child_name, p.avatar_emoji AS child_emoji
             FROM study_sheets s
             LEFT JOIN study_profiles p ON p.id = s.child_id
             ORDER BY s.id DESC LIMIT 20`
        );
        const telegramUsers = await listAllowedTelegramUsers();
        const telegramLogs = await listRecentTelegramLogs(25);

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

router.post('/profile', async (req, res) => {
    try {
        const { displayName, birthYear, targetReward, avatarEmoji, linkedUsername } = req.body || {};
        const created = await createStudyProfile({
            displayName,
            birthYear,
            targetReward,
            avatarEmoji,
            linkedUsername
        });
        res.json({
            success: true,
            message: `[${created.display_name}] 학습 프로필이 추가되었습니다.`,
            profile: created
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '학습 프로필 생성 실패' });
    }
});

router.post('/profile/:childId', async (req, res) => {
    try {
        const cid = normalizeChildId(req.params.childId);
        const { displayName, birthYear, targetReward, avatarEmoji, linkedUsername } = req.body || {};
        const hasBirthYear = birthYear !== undefined && birthYear !== null && String(birthYear).trim() !== '';
        const parsedYear = hasBirthYear ? Math.min(2030, Math.max(2010, Number(birthYear) || 2021)) : null;
        const hasLink = linkedUsername !== undefined;
        const cleanLink = hasLink ? String(linkedUsername || '').trim().toLowerCase().slice(0, 32) : null;

        await dbRun(
            `UPDATE study_profiles
             SET display_name = COALESCE(NULLIF(?, ''), display_name),
                 birth_year = COALESCE(?, birth_year),
                 target_reward = COALESCE(NULLIF(?, ''), target_reward),
                 avatar_emoji = COALESCE(NULLIF(?, ''), avatar_emoji),
                 linked_username = CASE WHEN ? THEN ? ELSE linked_username END
             WHERE id = ?`,
            [
                String(displayName || '').trim().slice(0, 20),
                parsedYear,
                String(targetReward || '').trim().slice(0, 60),
                String(avatarEmoji || '').trim().slice(0, 8),
                hasLink ? 1 : 0,
                cleanLink || '',
                cid
            ]
        );
        res.json({ success: true, message: '아이 학습 프로필 정보가 업데이트되었습니다.' });
    } catch (err) {
        res.status(500).json({ success: false, message: '프로필 수정 실패' });
    }
});

router.delete('/profile/:childId', async (req, res) => {
    try {
        await deleteStudyProfile(req.params.childId);
        res.json({ success: true, message: '학습 프로필이 삭제되었습니다.' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '프로필 삭제 실패' });
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
        const profileMode = String(req.body?.profileMode || 'create_new').trim();
        const birthYear = Math.min(2030, Math.max(2010, Number(req.body?.birthYear) || 2021));
        const linkChildId = String(req.body?.linkChildId || '').trim();

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

        let profileMsg = '';
        if (profileMode === 'link_existing' && linkChildId) {
            const targetCid = normalizeChildId(linkChildId);
            await dbRun('UPDATE study_profiles SET linked_username = ? WHERE id = ?', [rawUsername, targetCid]);
            profileMsg = ' (기존 학습 프로필에 자동 연결됨)';
        } else if (profileMode === 'create_new') {
            const profiles = await getProfiles();
            const sameNameUnlinked = profiles.find(
                (p) => p.display_name === nickname && !p.linked_username
            );
            if (sameNameUnlinked) {
                await dbRun('UPDATE study_profiles SET linked_username = ? WHERE id = ?', [rawUsername, sameNameUnlinked.id]);
                profileMsg = ` (기존 '${sameNameUnlinked.display_name}' 학습 프로필과 연결됨)`;
            } else {
                const created = await createStudyProfile({
                    id: rawUsername,
                    displayName: nickname,
                    birthYear,
                    avatarEmoji: emoji,
                    linkedUsername: rawUsername
                });
                profileMsg = ` ('${created.display_name}' 학습 프로필도 함께 생성됨)`;
            }
        }

        res.json({
            success: true,
            message: `아이 전용 학습실 계정(${rawUsername})이 발급되었습니다!${profileMsg}`,
            inviteUrl: `https://j-jg.cc/invite/${inviteToken}`,
            localInvitePath: `/invite/${inviteToken}`
        });
    } catch (err) {
        console.error('아이 전용 계정 발급 오류:', err);
        res.status(500).json({ success: false, message: '계정 발급 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
