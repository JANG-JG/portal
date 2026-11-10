/**
 * 🛡️ 포털 AI 비서 감사 로그 및 Ollama 런타임 상태 서비스 (aiAuditLog.service.js)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 및 민감 개인정보 비식별화 필수
 */

const { portalDb } = require('./db');
const { OLLAMA_HOST, getChatModel } = require('./aiModelRouter.service');

let tableInitialized = false;

function ensureAuditTable() {
    if (tableInitialized || !portalDb) return;
    tableInitialized = true;
    portalDb.serialize(() => {
        portalDb.run(`
            CREATE TABLE IF NOT EXISTS ai_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_role TEXT DEFAULT 'family',
                actor_label TEXT DEFAULT '가족',
                request_type TEXT DEFAULT 'stream_chat',
                routed_mode TEXT DEFAULT 'balanced',
                model TEXT DEFAULT '',
                tools_used TEXT DEFAULT '',
                prompt_chars INTEGER DEFAULT 0,
                masked_preview TEXT DEFAULT '',
                duration_ms INTEGER DEFAULT 0,
                status TEXT DEFAULT 'SUCCESS',
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )
        `);
        portalDb.run(`CREATE INDEX IF NOT EXISTS idx_ai_audit_created ON ai_audit_logs (created_at DESC, id DESC)`);
    });
}

/**
 * 🔒 질문 본문 내 민감 개인정보 비식별/마스킹 처리 (최대 48자 요약 보관)
 */
function maskSensitivePrompt(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let masked = rawText.replace(/\s+/g, ' ').trim();
    // 주민등록번호·외국인등록번호 패턴
    masked = masked.replace(/\b\d{6}[-\s]?[1-8]\d{6}\b/g, '******-*******');
    // 휴대폰·전화번호 패턴
    masked = masked.replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '010-****-****');
    masked = masked.replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '0**-****-****');
    // 이메일 주소 패턴
    masked = masked.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***@***.***');
    // 계좌·카드번호 등 연속 숫자/하이픈 패턴
    masked = masked.replace(/\b\d{2,6}-\d{2,6}-\d{2,8}(-\d{1,4})?\b/g, '***-****-****');
    // 5자리 이상 연속 숫자(금액·식별번호 등) 부분 마스킹
    masked = masked.replace(/\d{5,}/g, '*****');

    return masked.length > 48 ? `${masked.slice(0, 48)}…` : masked;
}

/**
 * 👤 요청 계정 비식별 표시 라벨 생성
 */
function resolveActorInfo(user) {
    if (!user) return { role: 'family', label: '가족' };
    const isAdminUser = user.role === 'admin' || String(user.username || '').toLowerCase() === 'admin';
    if (isAdminUser) return { role: 'admin', label: '관리자' };

    const raw = String(user.nickname || user.username || '가족').trim();
    if (raw.length <= 1) return { role: 'family', label: '가족(*)' };
    const maskedName = `${raw[0]}*${raw.length > 2 ? raw[raw.length - 1] : ''}`;
    return { role: 'family', label: `가족(${maskedName})` };
}

/**
 * 📝 AI 질문·라우팅·응답 감사 로그 비동기 기록 (최근 1,500건 롤링 보관)
 */
function recordAiAuditLog({
    user,
    requestType = 'stream_chat',
    routedMode = 'balanced',
    model = '',
    toolsUsed = [],
    prompt = '',
    durationMs = 0,
    status = 'SUCCESS'
}) {
    try {
        if (!portalDb) return;
        ensureAuditTable();
        const actor = resolveActorInfo(user);
        const toolsStr = Array.isArray(toolsUsed) ? toolsUsed.join(', ') : String(toolsUsed || '');
        const cleanPrompt = String(prompt || '');
        const maskedPreview = maskSensitivePrompt(cleanPrompt);

        portalDb.run(
            `INSERT INTO ai_audit_logs
             (user_role, actor_label, request_type, routed_mode, model, tools_used, prompt_chars, masked_preview, duration_ms, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
            [
                actor.role,
                actor.label,
                String(requestType || 'stream_chat').slice(0, 30),
                String(routedMode || 'balanced').slice(0, 20),
                String(model || '').slice(0, 60),
                toolsStr.slice(0, 180),
                cleanPrompt.length,
                maskedPreview,
                Math.max(0, Math.round(Number(durationMs) || 0)),
                String(status || 'SUCCESS').slice(0, 20)
            ],
            () => {
                portalDb.run(
                    `DELETE FROM ai_audit_logs WHERE id NOT IN (SELECT id FROM ai_audit_logs ORDER BY id DESC LIMIT 1500)`,
                    () => {}
                );
            }
        );
    } catch (e) {
        console.warn('[aiAuditLog] 기록 생략:', e.message);
    }
}

/**
 * 📊 관리자용 AI 감사 통계 및 최근 로그 목록 조회
 */
function getAiAuditSummary(limit = 60) {
    return new Promise((resolve) => {
        if (!portalDb) {
            return resolve({ stats: {}, logs: [] });
        }
        ensureAuditTable();
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 60, 10), 200);

        const statsSql = `
            SELECT
                COUNT(*) AS totalCount,
                SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS todayCount,
                SUM(CASE WHEN routed_mode = 'chat' THEN 1 ELSE 0 END) AS chatCount,
                SUM(CASE WHEN routed_mode = 'balanced' THEN 1 ELSE 0 END) AS balancedCount,
                SUM(CASE WHEN routed_mode = 'reasoning' THEN 1 ELSE 0 END) AS reasoningCount,
                SUM(CASE WHEN status = 'BLOCKED' OR routed_mode = 'policy' THEN 1 ELSE 0 END) AS blockedCount,
                ROUND(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) AS avgDurationMs
            FROM ai_audit_logs
        `;

        portalDb.get(statsSql, [], (sErr, statRow) => {
            portalDb.all(
                `SELECT id, user_role, actor_label, request_type, routed_mode, model, tools_used, prompt_chars, masked_preview, duration_ms, status, created_at
                 FROM ai_audit_logs
                 ORDER BY id DESC
                 LIMIT ?`,
                [safeLimit],
                (lErr, rows) => {
                    resolve({
                        stats: {
                            totalCount: statRow?.totalCount || 0,
                            todayCount: statRow?.todayCount || 0,
                            chatCount: statRow?.chatCount || 0,
                            balancedCount: statRow?.balancedCount || 0,
                            reasoningCount: statRow?.reasoningCount || 0,
                            blockedCount: statRow?.blockedCount || 0,
                            avgDurationMs: statRow?.avgDurationMs || 0
                        },
                        logs: (!lErr && Array.isArray(rows)) ? rows : []
                    });
                }
            );
        });
    });
}

/**
 * ⚡ 로컬 Ollama 실시간 적재 모델(VRAM/RAM) 및 설치 모델 상세 점검
 */
async function getOllamaRuntimeDetails() {
    const started = Date.now();
    try {
        const [tagsRes, psRes] = await Promise.all([
            fetch(new URL('/api/tags', OLLAMA_HOST), { signal: AbortSignal.timeout(2500) }),
            fetch(new URL('/api/ps', OLLAMA_HOST), { signal: AbortSignal.timeout(2500) }).catch(() => null)
        ]);

        const latencyMs = Date.now() - started;
        if (!tagsRes || !tagsRes.ok) {
            return { online: false, healthy: false, latencyMs, error: `HTTP ${tagsRes ? tagsRes.status : 'TIMEOUT'}` };
        }

        const tagsJson = await tagsRes.json();
        const psJson = (psRes && psRes.ok) ? await psRes.json() : { models: [] };

        const installedModels = (tagsJson.models || []).map(m => ({
            name: m.name,
            sizeMb: Math.round((Number(m.size) || 0) / (1024 * 1024)),
            parameterSize: m.details?.parameter_size || '',
            quantization: m.details?.quantization_level || ''
        }));

        let totalLoadedMb = 0;
        let totalVramMb = 0;
        const loadedModels = (psJson.models || []).map(m => {
            const sizeMb = Math.round((Number(m.size) || 0) / (1024 * 1024));
            const vramMb = Math.round((Number(m.size_vram) || 0) / (1024 * 1024));
            totalLoadedMb += sizeMb;
            totalVramMb += vramMb;
            return {
                name: m.name || m.model,
                sizeMb,
                vramMb,
                contextLength: m.context_length || 0,
                expiresAt: m.expires_at || ''
            };
        });

        return {
            online: true,
            healthy: true,
            latencyMs,
            modelName: getChatModel(),
            installedModels,
            loadedModels,
            totalLoadedMb,
            totalVramMb
        };
    } catch (err) {
        return {
            online: false,
            healthy: false,
            latencyMs: Date.now() - started,
            error: err.message
        };
    }
}

module.exports = {
    maskSensitivePrompt,
    recordAiAuditLog,
    getAiAuditSummary,
    getOllamaRuntimeDetails
};
