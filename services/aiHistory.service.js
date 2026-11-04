/**
 * 🤖 JG 포털 로컬 AI 비서 대화 히스토리 DB 서비스 (aiHistory.service.js)
 * - 계정별 격리 SQLite DB 영구 보관 (portalDb / portal.db)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { portalDb } = require('./db');

/**
 * AI 대화 세션 및 메시지 테이블 초기화
 */
function initAiHistoryTables() {
    portalDb.serialize(() => {
        // 1. 대화 세션 테이블
        portalDb.run(`CREATE TABLE IF NOT EXISTS ai_chat_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '새 대화',
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);

        // 2. 대화 메시지 테이블
        portalDb.run(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
        )`);

        // 3. 성능 인덱스
        portalDb.run(`CREATE INDEX IF NOT EXISTS idx_ai_sessions_user_updated ON ai_chat_sessions (user_id, updated_at DESC)`);
        portalDb.run(`CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_chat_messages (session_id, id ASC)`);
    });
}

// 서비스 로드 시 즉시 테이블 초기화
initAiHistoryTables();

/**
 * DB 쿼리 Promise 헬퍼 함수들
 */
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

/**
 * 사용자의 전체 대화 세션 목록 조회 (최신 업데이트순)
 */
async function getUserSessions(userId) {
    if (!userId) return [];
    const sql = `
        SELECT 
            s.id,
            s.title,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id) AS messageCount,
            (SELECT m.content FROM ai_chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS lastMessage
        FROM ai_chat_sessions s
        WHERE s.user_id = ?
        ORDER BY s.updated_at DESC
        LIMIT 50
    `;
    const rows = await dbAll(sql, [userId]);
    return rows.map(r => ({
        id: r.id,
        title: r.title,
        createdAt: new Date(r.createdAt).getTime(),
        updatedAt: new Date(r.updatedAt).getTime(),
        messageCount: r.messageCount || 0,
        lastMessage: r.lastMessage || ''
    }));
}

/**
 * 특정 세션의 상세 정보 및 메시지 전체 조회
 */
async function getSessionDetail(userId, sessionId) {
    if (!userId || !sessionId) return null;

    const session = await dbGet(
        `SELECT id, user_id, title, created_at AS createdAt, updated_at AS updatedAt FROM ai_chat_sessions WHERE id = ? AND user_id = ?`,
        [sessionId, userId]
    );
    if (!session) return null;

    const messages = await dbAll(
        `SELECT id, role, content, created_at AS createdAt FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC`,
        [sessionId]
    );

    return {
        id: session.id,
        title: session.title,
        createdAt: new Date(session.createdAt).getTime(),
        updatedAt: new Date(session.updatedAt).getTime(),
        messages: messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt).getTime()
        }))
    };
}

/**
 * 신규 대화 세션 생성
 */
async function createSession(userId, sessionId, title = '새 대화') {
    if (!userId || !sessionId) throw new Error('사용자 ID와 세션 ID가 필요합니다.');

    // 이미 존재하는지 확인
    const existing = await dbGet(`SELECT id FROM ai_chat_sessions WHERE id = ?`, [sessionId]);
    if (existing) {
        return existing;
    }

    const cleanTitle = (title && typeof title === 'string') ? title.trim().substring(0, 50) : '새 대화';
    await dbRun(
        `INSERT INTO ai_chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
        [sessionId, userId, cleanTitle]
    );

    return { id: sessionId, title: cleanTitle };
}

/**
 * 특정 세션에 메시지 추가 및 제목 자동 갱신
 */
async function addMessage(userId, sessionId, role, content, clientTimestamp) {
    if (!userId || !sessionId || !role || !content) {
        throw new Error('필수 파라미터가 누락되었습니다.');
    }

    // 1. 세션 존재 여부 및 소유권 확인
    let session = await dbGet(`SELECT id, title, user_id FROM ai_chat_sessions WHERE id = ?`, [sessionId]);
    if (!session) {
        // 세션이 없으면 새로 생성
        await createSession(userId, sessionId);
        session = { id: sessionId, title: '새 대화', user_id: userId };
    } else if (session.user_id !== userId) {
        throw new Error('다른 사용자의 대화 세션에 접근할 수 없습니다.');
    }

    // 2. 메시지 삽입
    const timeExpr = clientTimestamp ? `datetime(?, 'unixepoch', 'localtime')` : `datetime('now', 'localtime')`;
    const params = [sessionId, role, content];
    let insertSql = `INSERT INTO ai_chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, datetime('now', 'localtime'))`;
    
    if (clientTimestamp && Number(clientTimestamp) > 0) {
        const sec = Math.floor(Number(clientTimestamp) / 1000);
        insertSql = `INSERT INTO ai_chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, datetime(?, 'unixepoch', 'localtime'))`;
        params.push(sec);
    }
    await dbRun(insertSql, params);

    // 3. 첫 질문 시 세션 제목 자동 업데이트
    let newTitle = session.title;
    if (role === 'user' && session.title === '새 대화') {
        const clean = content.replace(/<[^>]*>?/gm, '').trim();
        newTitle = clean.length > 22 ? clean.substring(0, 22) + '...' : clean;
        await dbRun(
            `UPDATE ai_chat_sessions SET title = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
            [newTitle, sessionId]
        );
    } else {
        await dbRun(
            `UPDATE ai_chat_sessions SET updated_at = datetime('now', 'localtime') WHERE id = ?`,
            [sessionId]
        );
    }

    return { sessionId, role, title: newTitle };
}

/**
 * 특정 세션 삭제
 */
async function deleteSession(userId, sessionId) {
    if (!userId || !sessionId) return false;

    // 소유권 확인
    const session = await dbGet(`SELECT id FROM ai_chat_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
    if (!session) return false;

    // 메시지 및 세션 삭제
    await dbRun(`DELETE FROM ai_chat_messages WHERE session_id = ?`, [sessionId]);
    await dbRun(`DELETE FROM ai_chat_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
    return true;
}

/**
 * 사용자의 전체 세션 삭제
 */
async function deleteAllSessions(userId) {
    if (!userId) return false;
    const sessions = await dbAll(`SELECT id FROM ai_chat_sessions WHERE user_id = ?`, [userId]);
    if (sessions.length === 0) return true;

    for (const s of sessions) {
        await dbRun(`DELETE FROM ai_chat_messages WHERE session_id = ?`, [s.id]);
    }
    await dbRun(`DELETE FROM ai_chat_sessions WHERE user_id = ?`, [userId]);
    return true;
}

/**
 * 프론트엔드 로컬스토리지 데이터 일괄 동기화 (기존 대화 무손실 마이그레이션 지원)
 */
async function syncSessionsFromClient(userId, sessions) {
    if (!userId || !Array.isArray(sessions) || sessions.length === 0) return 0;

    let importedCount = 0;
    for (const sess of sessions) {
        if (!sess || !sess.id) continue;
        
        // 이미 DB에 존재하는지 확인
        const exists = await dbGet(`SELECT id FROM ai_chat_sessions WHERE id = ?`, [sess.id]);
        if (!exists) {
            const title = sess.title || '새 대화';
            const createdSec = sess.createdAt ? Math.floor(sess.createdAt / 1000) : null;
            const updatedSec = sess.updatedAt ? Math.floor(sess.updatedAt / 1000) : null;

            if (createdSec && updatedSec) {
                await dbRun(
                    `INSERT INTO ai_chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, datetime(?, 'unixepoch', 'localtime'), datetime(?, 'unixepoch', 'localtime'))`,
                    [sess.id, userId, title, createdSec, updatedSec]
                );
            } else {
                await dbRun(
                    `INSERT INTO ai_chat_sessions (id, user_id, title) VALUES (?, ?, ?)`,
                    [sess.id, userId, title]
                );
            }
            importedCount++;

            // 메시지 일괄 추가
            if (Array.isArray(sess.messages)) {
                for (const msg of sess.messages) {
                    if (!msg || !msg.content) continue;
                    const msgSec = msg.timestamp ? Math.floor(msg.timestamp / 1000) : null;
                    if (msgSec) {
                        await dbRun(
                            `INSERT INTO ai_chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, datetime(?, 'unixepoch', 'localtime'))`,
                            [sess.id, msg.role || 'assistant', msg.content, msgSec]
                        );
                    } else {
                        await dbRun(
                            `INSERT INTO ai_chat_messages (session_id, role, content) VALUES (?, ?, ?)`,
                            [sess.id, msg.role || 'assistant', msg.content]
                        );
                    }
                }
            }
        }
    }
    return importedCount;
}

/**
 * 특정 세션의 제목(대화명) 수정
 */
async function updateSessionTitle(userId, sessionId, title) {
    if (!userId || !sessionId) return false;
    const cleanTitle = (title && typeof title === 'string') ? title.trim().substring(0, 50) : '';
    if (!cleanTitle) return false;

    // 소유권 확인
    const session = await dbGet(`SELECT id FROM ai_chat_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
    if (!session) return false;

    await dbRun(
        `UPDATE ai_chat_sessions SET title = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ?`,
        [cleanTitle, sessionId, userId]
    );
    return true;
}

module.exports = {
    initAiHistoryTables,
    getUserSessions,
    getSessionDetail,
    createSession,
    addMessage,
    updateSessionTitle,
    deleteSession,
    deleteAllSessions,
    syncSessionsFromClient
};

