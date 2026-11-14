/**
 * ==============================================================================
 * 텔레그램 화이트리스트 암호화 저장 & 감사 로그 서비스 (telegramAuth.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] AES-256-GCM 암호화 + HMAC-SHA256 블라인드 인덱스 조회 (평문 ID DB 미저장)
 * ==============================================================================
 */

const { portalDb } = require('../db');
const { encryptSecret, decryptSecret, hashBlindIndex } = require('../crypto.service');

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function maskTelegramId(rawId) {
    const str = String(rawId || '').trim();
    if (str.length <= 4) return '****';
    return `${str.slice(0, 2)}${'*'.repeat(Math.max(2, str.length - 4))}${str.slice(-2)}`;
}

/**
 * 텔레그램 송신자 ID 인증 (DB 암호화 화이트리스트 우선 + .env TELEGRAM_ALLOWED_IDS 선택 폴백)
 */
async function isAuthorizedTelegramUser(telegramId) {
    const cleanId = String(telegramId || '').trim();
    if (!/^-?\d+$/.test(cleanId)) return null;

    const idxHash = hashBlindIndex(cleanId, 'telegram');
    const row = await dbGet(
        'SELECT id, label, portal_username, role, enabled FROM telegram_allowed_users WHERE telegram_id_hash = ?',
        [idxHash]
    );
    if (row) {
        if (row.enabled === 1) {
            return {
                source: 'db',
                label: row.label,
                portalUsername: row.portal_username || 'upt0731',
                role: row.role || 'family'
            };
        }
        return null;
    }

    // 선택적 .env 폴백 지원 (TELEGRAM_ALLOWED_IDS="12345,67890")
    const envRaw = process.env.TELEGRAM_ALLOWED_IDS || '';
    if (envRaw.trim()) {
        const envList = envRaw.split(',').map((s) => s.trim()).filter(Boolean);
        if (envList.includes(cleanId)) {
            return {
                source: 'env',
                label: '환경변수 허용 관리자',
                portalUsername: process.env.TELEGRAM_DEFAULT_PORTAL_USER || 'upt0731',
                role: 'admin'
            };
        }
    }

    return null;
}

async function addAllowedTelegramUser({ telegramId, label, portalUsername = 'upt0731', role = 'family' }) {
    const cleanId = String(telegramId || '').trim();
    if (!/^-?\d{4,20}$/.test(cleanId)) {
        throw new Error('올바른 숫자 형식의 텔레그램 ID를 입력해 주세요.');
    }
    const cleanLabel = String(label || '').trim().slice(0, 30) || '가족 사용자';
    const cleanUser = String(portalUsername || 'upt0731').trim().slice(0, 30);
    const cleanRole = role === 'admin' ? 'admin' : 'family';

    const encId = encryptSecret(cleanId, 'telegram');
    const idxHash = hashBlindIndex(cleanId, 'telegram');

    await dbRun(
        `INSERT INTO telegram_allowed_users (telegram_id_enc, telegram_id_hash, label, portal_username, role, enabled)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(telegram_id_hash) DO UPDATE SET
            telegram_id_enc = excluded.telegram_id_enc,
            label = excluded.label,
            portal_username = excluded.portal_username,
            role = excluded.role,
            enabled = 1`,
        [encId, idxHash, cleanLabel, cleanUser, cleanRole]
    );

    return {
        maskedTelegramId: maskTelegramId(cleanId),
        label: cleanLabel,
        portalUsername: cleanUser,
        role: cleanRole
    };
}

async function listAllowedTelegramUsers() {
    const rows = await dbAll(
        'SELECT id, telegram_id_enc, label, portal_username, role, enabled, created_at FROM telegram_allowed_users ORDER BY id ASC'
    );
    return rows.map((r) => {
        const plain = decryptSecret(r.telegram_id_enc, 'telegram');
        return {
            id: r.id,
            maskedTelegramId: maskTelegramId(plain),
            label: r.label,
            portalUsername: r.portal_username,
            role: r.role,
            enabled: r.enabled === 1,
            createdAt: r.created_at
        };
    });
}

async function toggleAllowedTelegramUser(id, enabled) {
    await dbRun('UPDATE telegram_allowed_users SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, Number(id)]);
}

async function removeAllowedTelegramUser(id) {
    await dbRun('DELETE FROM telegram_allowed_users WHERE id = ?', [Number(id)]);
}

async function logTelegramCommand({ senderId, command, status = 'ok', detail = '' }) {
    try {
        const senderHash = senderId ? hashBlindIndex(senderId, 'telegram').slice(0, 16) : '';
        await dbRun(
            'INSERT INTO telegram_bot_logs (sender_hash, command, status, detail) VALUES (?, ?, ?, ?)',
            [senderHash, String(command || '').slice(0, 60), String(status).slice(0, 20), String(detail || '').slice(0, 200)]
        );
    } catch (e) {}
}

async function listRecentTelegramLogs(limit = 30) {
    return dbAll(
        'SELECT id, sender_hash, command, status, detail, created_at FROM telegram_bot_logs ORDER BY id DESC LIMIT ?',
        [Number(limit)]
    );
}

module.exports = {
    isAuthorizedTelegramUser,
    addAllowedTelegramUser,
    listAllowedTelegramUsers,
    toggleAllowedTelegramUser,
    removeAllowedTelegramUser,
    logTelegramCommand,
    listRecentTelegramLogs
};
