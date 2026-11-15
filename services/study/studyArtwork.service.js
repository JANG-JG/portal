/**
 * ==============================================================================
 * 어린이 학습실 그림 작품 저장 & 가족앨범 연동 서비스 (studyArtwork.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 & PNG 매직 바이트 검증
 * [규칙 11] 관리자 검수·재공유·삭제 지원
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { portalDb } = require('../db');
const { normalizeChildId, getProfiles, getSystemConfig } = require('./studyDb.service');

const ARTWORKS_DIR = path.join(__dirname, '..', '..', 'data', 'study-artworks');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 4 * 1024 * 1024;

let tablePromise = null;

function ensureDir() {
    if (!fs.existsSync(ARTWORKS_DIR)) {
        fs.mkdirSync(ARTWORKS_DIR, { recursive: true });
    }
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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

async function ensureArtworksTable() {
    if (tablePromise) return tablePromise;
    tablePromise = (async () => {
        ensureDir();
        await dbRun(`
            CREATE TABLE IF NOT EXISTS study_artworks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL,
                author_username TEXT DEFAULT '',
                title TEXT NOT NULL,
                template_id TEXT DEFAULT '',
                sheet_id INTEGER DEFAULT 0,
                image_filename TEXT NOT NULL,
                album_photo_id INTEGER DEFAULT NULL,
                album_status TEXT NOT NULL DEFAULT 'local',
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
        `);
    })();
    return tablePromise;
}

function decodePngDataUrl(dataUrl) {
    const raw = String(dataUrl || '').trim();
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
    if (!match) {
        throw new Error('올바른 PNG 그림 형식이 아닙니다.');
    }
    const buf = Buffer.from(match[1], 'base64');
    if (buf.length < 128 || buf.length > MAX_PNG_BYTES) {
        throw new Error('그림 파일 크기가 허용 범위를 벗어났습니다.');
    }
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
        throw new Error('PNG 이미지 검증에 실패했습니다.');
    }
    return buf;
}

async function resolveChildDisplayName(childId) {
    try {
        const profiles = await getProfiles();
        const found = profiles.find((p) => p.id === childId);
        return found ? found.display_name : childId;
    } catch (_) {
        return childId;
    }
}

async function pushBufferToFamilyAlbum({ buffer, filename, childName, title, cookieHeader }) {
    const albumPort = parseInt(process.env.ALBUM_PORT, 10) || 3005;
    const form = new FormData();
    form.append('photos', new Blob([buffer], { type: 'image/png' }), filename);
    form.append('caption', `🎨 ${childName}의 색칠 작품 — ${title}`);
    form.append('tags', `#빨간패드공부 #아이작품 #${childName.replace(/\s+/g, '')}`);
    form.append('location', '빨간패드공부');

    try {
        const res = await fetch(`http://127.0.0.1:${albumPort}/api/photos/upload`, {
            method: 'POST',
            headers: cookieHeader ? { Cookie: cookieHeader } : {},
            body: form,
            signal: AbortSignal.timeout(12000)
        });
        const data = await res.json().catch(() => ({}));
        return {
            ok: Boolean(res.ok && data.success),
            photoId: data.photo?.id || null,
            statusCode: res.status,
            message: data.message || ''
        };
    } catch (err) {
        return {
            ok: false,
            photoId: null,
            statusCode: 503,
            message: err?.message || '가족앨범 서버와 연결할 수 없습니다.'
        };
    }
}

async function saveStudyArtwork({
    childId,
    authorUsername = '',
    title = '내가 칠한 그림',
    templateId = '',
    sheetId = 0,
    imageDataUrl,
    shareToAlbum = true,
    cookieHeader = ''
}) {
    await ensureArtworksTable();
    const safeChild = normalizeChildId(childId || 'first');
    const cleanTitle = String(title || '내가 칠한 그림').trim().slice(0, 80) || '내가 칠한 그림';
    const cleanTemplate = String(templateId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const numericSheetId = Math.max(0, parseInt(sheetId || '0', 10) || 0);
    const pngBuffer = decodePngDataUrl(imageDataUrl);

    ensureDir();
    const filename = `art_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
    const filePath = path.join(ARTWORKS_DIR, filename);
    await fs.promises.writeFile(filePath, pngBuffer);

    const shareEnabled = (await getSystemConfig('study_kid_album_share_enabled', '1')) !== '0';
    let albumStatus = shareToAlbum && shareEnabled ? 'pending' : 'local';
    let albumPhotoId = null;
    let albumNote = '';

    if (shareToAlbum && shareEnabled) {
        const childName = await resolveChildDisplayName(safeChild);
        const upload = await pushBufferToFamilyAlbum({
            buffer: pngBuffer,
            filename,
            childName,
            title: cleanTitle,
            cookieHeader
        });
        if (upload.ok) {
            albumStatus = 'shared';
            albumPhotoId = upload.photoId;
        } else {
            albumStatus = 'album_failed';
            albumNote = upload.message || '';
        }
    }

    const inserted = await dbRun(
        `INSERT INTO study_artworks (child_id, author_username, title, template_id, sheet_id, image_filename, album_photo_id, album_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [safeChild, String(authorUsername || '').slice(0, 40), cleanTitle, cleanTemplate, numericSheetId, filename, albumPhotoId, albumStatus]
    );

    return {
        id: inserted.lastID,
        childId: safeChild,
        title: cleanTitle,
        templateId: cleanTemplate,
        imageUrl: `/api/study/artworks/${inserted.lastID}/image`,
        albumStatus,
        albumPhotoId,
        albumShareEnabled: shareEnabled,
        albumNote
    };
}

async function listStudyArtworks({ childId = '', limit = 30 } = {}) {
    await ensureArtworksTable();
    const maxRows = Math.min(100, Math.max(1, parseInt(limit || '30', 10) || 30));
    const profiles = await getProfiles().catch(() => []);
    const nameMap = new Map(profiles.map((p) => [p.id, `${p.avatar_emoji || '🧒'} ${p.display_name}`]));

    const hasChild = Boolean(childId && String(childId).trim());
    const sql = hasChild
        ? 'SELECT * FROM study_artworks WHERE child_id = ? ORDER BY id DESC LIMIT ?'
        : 'SELECT * FROM study_artworks ORDER BY id DESC LIMIT ?';
    const params = hasChild ? [normalizeChildId(childId), maxRows] : [maxRows];
    const rows = await dbAll(sql, params);

    return rows.map((r) => ({
        id: r.id,
        childId: r.child_id,
        childLabel: nameMap.get(r.child_id) || r.child_id,
        authorUsername: r.author_username || '',
        title: r.title,
        templateId: r.template_id || '',
        sheetId: r.sheet_id || 0,
        imageUrl: `/api/study/artworks/${r.id}/image`,
        adminImageUrl: `/api/admin/study/artworks/${r.id}/image`,
        albumPhotoId: r.album_photo_id || null,
        albumStatus: r.album_status || 'local',
        createdAt: r.created_at
    }));
}

async function getArtworkFilePath(artworkId) {
    await ensureArtworksTable();
    const row = await dbGet('SELECT * FROM study_artworks WHERE id = ?', [Number(artworkId)]);
    if (!row || !row.image_filename) return null;
    const safeName = path.basename(row.image_filename);
    const fullPath = path.join(ARTWORKS_DIR, safeName);
    if (!fullPath.startsWith(ARTWORKS_DIR + path.sep) || !fs.existsSync(fullPath)) {
        return null;
    }
    return { row, fullPath };
}

async function shareExistingArtworkToAlbum(artworkId, cookieHeader = '') {
    const found = await getArtworkFilePath(artworkId);
    if (!found) {
        throw new Error('그림 파일을 찾을 수 없습니다.');
    }
    const pngBuffer = await fs.promises.readFile(found.fullPath);
    const childName = await resolveChildDisplayName(found.row.child_id);
    const upload = await pushBufferToFamilyAlbum({
        buffer: pngBuffer,
        filename: path.basename(found.fullPath),
        childName,
        title: found.row.title,
        cookieHeader
    });
    if (!upload.ok) {
        await dbRun('UPDATE study_artworks SET album_status = ? WHERE id = ?', ['album_failed', found.row.id]);
        throw new Error(upload.message || '가족앨범 업로드에 실패했습니다.');
    }
    await dbRun(
        'UPDATE study_artworks SET album_status = ?, album_photo_id = ? WHERE id = ?',
        ['shared', upload.photoId, found.row.id]
    );
    return { id: found.row.id, albumPhotoId: upload.photoId, albumStatus: 'shared' };
}

async function deleteStudyArtwork(artworkId) {
    await ensureArtworksTable();
    const row = await dbGet('SELECT * FROM study_artworks WHERE id = ?', [Number(artworkId)]);
    if (!row) return false;
    const safeName = path.basename(row.image_filename || '');
    if (safeName) {
        const fullPath = path.join(ARTWORKS_DIR, safeName);
        if (fullPath.startsWith(ARTWORKS_DIR + path.sep)) {
            await fs.promises.unlink(fullPath).catch(() => {});
        }
    }
    await dbRun('DELETE FROM study_artworks WHERE id = ?', [row.id]);
    return true;
}

module.exports = {
    saveStudyArtwork,
    listStudyArtworks,
    getArtworkFilePath,
    shareExistingArtworkToAlbum,
    deleteStudyArtwork
};
