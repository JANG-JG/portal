const crypto = require('crypto');

function getMasterSecret() {
    return process.env.JWT_SECRET || 'jg_calendar_default_master_salt_2026';
}

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

// 🔑 사용자별 고유 AES-256 대칭키 유도 (HKDF)
function deriveKeyForUser(userId) {
    const salt = 'jg_calendar_user_salt_v1';
    const info = `calendar_encryption_user:${userId || 'admin'}`;
    return crypto.hkdfSync('sha256', getMasterSecret(), salt, info, 32);
}

// 👨‍👩‍👧‍👦 가족 공통 AES-256 대칭키 유도 (HKDF)
function deriveKeyForFamily() {
    const salt = 'jg_calendar_family_salt_v1';
    const info = 'calendar_encryption_family_shared';
    return crypto.hkdfSync('sha256', getMasterSecret(), salt, info, 32);
}

/**
 * 🔒 캘린더 텍스트 암호화 (AES-256-GCM)
 * @param {string} text 평문
 * @param {string} userId 작성자 ID
 * @param {boolean|number} isFamily 가족 공유 여부
 * @returns {string} enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
function encryptCalendarText(text, userId, isFamily = false) {
    if (text === null || text === undefined || text === '') return '';
    // 이미 암호화된 문자열이면 중복 암호화 방지
    if (typeof text === 'string' && text.startsWith(PREFIX)) return text;

    const isFam = Boolean(isFamily);
    const key = isFam ? deriveKeyForFamily() : deriveKeyForUser(userId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 🔓 캘린더 텍스트 복호화 (AES-256-GCM)
 * @param {string} cipherText 암호문 또는 레거시 평문
 * @param {string} userId 요청자/작성자 ID
 * @param {boolean|number} isFamily 가족 공유 여부
 * @returns {string} 복호화된 평문
 */
function decryptCalendarText(cipherText, userId, isFamily = false) {
    if (!cipherText || typeof cipherText !== 'string') return '';
    // 레거시 평문 데이터는 그대로 반환하여 하위 호환성 유지
    if (!cipherText.startsWith(PREFIX)) return cipherText;

    const parts = cipherText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return cipherText;

    const [ivHex, tagHex, dataHex] = parts;
    const isFam = Boolean(isFamily);

    try {
        const key = isFam ? deriveKeyForFamily() : deriveKeyForUser(userId);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

        let decrypted = decipher.update(dataHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        // 개인 일정으로 조회했으나 가족 공유 키로 암호화되었을 경우의 폴백
        if (!isFam) {
            try {
                const familyKey = deriveKeyForFamily();
                const decipher2 = crypto.createDecipheriv(ALGORITHM, familyKey, Buffer.from(ivHex, 'hex'));
                decipher2.setAuthTag(Buffer.from(tagHex, 'hex'));
                let dec2 = decipher2.update(dataHex, 'hex', 'utf8');
                dec2 += decipher2.final('utf8');
                return dec2;
            } catch (e2) {}
        }
        return '🔒 [암호화된 일정]';
    }
}

/**
 * 🔒 메모 텍스트 암호화 (AES-256-GCM)
 * @param {string} text 평문
 * @param {string} userId 작성자 ID
 * @returns {string} enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
function deriveKeyForMemo(userId) {
    const salt = 'jg_memo_user_salt_v1';
    const info = `memo_encryption_user:${userId || 'admin'}`;
    return crypto.hkdfSync('sha256', getMasterSecret(), salt, info, 32);
}

function encryptMemoText(text, userId) {
    if (text === null || text === undefined || text === '') return '';
    // 이미 암호화된 문자열이면 중복 암호화 방지
    if (typeof text === 'string' && text.startsWith(PREFIX)) return text;

    const key = deriveKeyForMemo(userId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 🔓 메모 텍스트 복호화 (AES-256-GCM)
 * @param {string} cipherText 암호문 또는 레거시 평문
 * @param {string} userId 작성자 ID
 * @returns {string} 복호화된 평문
 */
function decryptMemoText(cipherText, userId) {
    if (!cipherText || typeof cipherText !== 'string') return '';
    // 레거시 평문 데이터는 그대로 반환하여 하위 호환성 유지
    if (!cipherText.startsWith(PREFIX)) return cipherText;

    const parts = cipherText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return cipherText;

    const [ivHex, tagHex, dataHex] = parts;

    try {
        const key = deriveKeyForMemo(userId);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

        let decrypted = decipher.update(dataHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        // 작성자 키로 복호화 실패 시 admin 키로 폴백 시도
        if (userId !== 'admin') {
            try {
                const adminKey = deriveKeyForMemo('admin');
                const decipherAdmin = crypto.createDecipheriv(ALGORITHM, adminKey, Buffer.from(ivHex, 'hex'));
                decipherAdmin.setAuthTag(Buffer.from(tagHex, 'hex'));
                let decAdmin = decipherAdmin.update(dataHex, 'hex', 'utf8');
                decAdmin += decipherAdmin.final('utf8');
                return decAdmin;
            } catch (e2) {}
        }
        return '🔒 [암호화된 메모]';
    }
}

module.exports = {
    encryptCalendarText,
    decryptCalendarText,
    encryptMemoText,
    decryptMemoText
};
