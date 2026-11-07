/**
 * 🤖 JG 포털 로컬 AI 비서 런타임 설정 서비스 (aiConfig.service.js)
 * - 첫 환영 인사말, 1회 질문 글자 수 제한, 히어로 카드 문구/아이콘 영구 보존
 * - [규칙 1] SQLite DB(portal.db) 기반 배포 시 100% 보존 | [규칙 3] 500줄 이하 모듈화
 */

const fs = require('fs');
const path = require('path');
const { portalDb } = require('./db');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'ai-config.json');
const BACKUP_PATH = path.join(__dirname, '..', 'config', 'ai-config.json.bak');

const DEFAULT_AI_CONFIG = {
    welcomeMessage: '안녕하세요! JG 포털 AI 비서입니다. 🇰🇷\n궁금한 점이 있으시면 무엇이든 편하게 물어보세요! 😊',
    maxPromptLength: 1000,
    heroIcon: '🤖',
    heroTitle: 'AI 비서에게 무엇이든 물어보세요',
    heroDescription: 'JG 포털 로컬 AI가 질문에 친절하고 안전하게 답변해 드립니다.',
    // 모델 설정 (빈 값 = .env OLLAMA_CHAT_MODEL / OLLAMA_BALANCED_MODEL / OLLAMA_REASONING_MODEL 사용)
    chatModel: '',
    balancedModel: '',
    reasoningModel: '',
    // 컨텍스트 창 (토큰 수)
    chatNumCtx: 4096,
    balancedNumCtx: 4096,
    reasoningNumCtx: 4096,
    // 화면 표시용 친화적 모델 라벨 (비어있으면 기본 한글 라벨 사용)
    chatModelLabel: '⚡ 빠른 대화 (1B)',
    balancedModelLabel: '⚖️ 균형 대화 (4B)',
    reasoningModelLabel: '🧠 깊은 생각 (EXAONE)'
};

const MODEL_NAME_REGEX = /^[A-Za-z0-9._:\/-]{1,100}$/;
const MODEL_KEYS = [
    'chatModel', 'balancedModel', 'reasoningModel',
    'chatNumCtx', 'balancedNumCtx', 'reasoningNumCtx',
    'chatModelLabel', 'balancedModelLabel', 'reasoningModelLabel'
];

let cachedConfig = { ...DEFAULT_AI_CONFIG };
let isDbInitialized = false;

/**
 * DB 테이블 초기화 및 초기 설정 로드 / 마이그레이션
 */
function initAiConfigDb() {
    if (!portalDb || typeof portalDb.run !== 'function') {
        console.warn('[aiConfig.service] portalDb 연결 대기 중...');
        return;
    }

    portalDb.serialize(() => {
        // 1. ai_config 테이블 생성
        portalDb.run(`CREATE TABLE IF NOT EXISTS ai_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`, (err) => {
            if (err) {
                console.error('[aiConfig.service] ai_config 테이블 생성 오류:', err.message);
                return;
            }

            // 2. DB에서 저장된 설정 로드
            portalDb.all(`SELECT key, value FROM ai_config`, [], (qErr, rows) => {
                if (qErr) {
                    console.error('[aiConfig.service] ai_config 조회 실패:', qErr.message);
                    return;
                }

                const dbMap = {};
                if (Array.isArray(rows)) {
                    rows.forEach(r => {
                        if (r && r.key) dbMap[r.key] = r.value;
                    });
                }

                // 3. 파일에 기존 설정이 있고 DB에 키가 없는 경우 1회성 마이그레이션
                let fileConfig = {};
                try {
                    if (fs.existsSync(CONFIG_PATH)) {
                        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
                        fileConfig = JSON.parse(raw);
                    }
                } catch (fErr) {
                    console.warn('[aiConfig.service] 레거시 파일 읽기 건너뜀:', fErr.message);
                }

                const merged = { ...DEFAULT_AI_CONFIG };

                // 파일 설정 우선 병합
                if (fileConfig.welcomeMessage) merged.welcomeMessage = fileConfig.welcomeMessage;
                if (fileConfig.maxPromptLength) merged.maxPromptLength = parseInt(fileConfig.maxPromptLength, 10) || 1000;
                if (fileConfig.heroIcon) merged.heroIcon = fileConfig.heroIcon;
                if (fileConfig.heroTitle) merged.heroTitle = fileConfig.heroTitle;
                if (fileConfig.heroDescription) merged.heroDescription = fileConfig.heroDescription;

                // DB 설정 최종 우선 병합
                if (dbMap.welcomeMessage) merged.welcomeMessage = dbMap.welcomeMessage;
                if (dbMap.maxPromptLength) merged.maxPromptLength = parseInt(dbMap.maxPromptLength, 10) || 1000;
                if (dbMap.heroIcon) merged.heroIcon = dbMap.heroIcon;
                if (dbMap.heroTitle) merged.heroTitle = dbMap.heroTitle;
                if (dbMap.heroDescription) merged.heroDescription = dbMap.heroDescription;
                // 모델 설정 (빈 값·0도 유효한 저장값이므로 키 존재 여부로 병합)
                MODEL_KEYS.forEach((k) => { if (dbMap[k] !== undefined) merged[k] = dbMap[k]; });

                // 옛 기본 문구의 모델명 브랜딩 → JG 포털로 치환 (나머지 사용자 문구는 보존)
                if (merged.welcomeMessage) merged.welcomeMessage = String(merged.welcomeMessage).replace(/\s*\(LG EXAONE 4\.0\)/g, '');
                if (merged.heroDescription) merged.heroDescription = String(merged.heroDescription).replace(/LG EXAONE 4\.0 기반 로컬 AI/g, 'JG 포털 로컬 AI');

                cachedConfig = sanitizeConfig(merged);

                // DB에 누락된 키가 있으면 기본/병합값으로 저장
                const stmt = portalDb.prepare(`INSERT OR REPLACE INTO ai_config (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))`);
                Object.entries(cachedConfig).forEach(([k, v]) => {
                    stmt.run([k, String(v)]);
                });
                stmt.finalize((fErr) => {
                    if (!fErr) {
                        isDbInitialized = true;
                        // 백업 파일도 최신 동기화
                        saveConfigToBackupFile(cachedConfig);
                        console.log('✅ [aiConfig.service] AI 비서 DB 설정 로드 및 동기화 완료');
                    }
                });
            });
        });
    });
}

/**
 * 설정값 정제 및 기본값 폴백
 */
function sanitizeConfig(input = {}) {
    const output = { ...DEFAULT_AI_CONFIG };

    if (typeof input.welcomeMessage === 'string' && input.welcomeMessage.trim()) {
        output.welcomeMessage = input.welcomeMessage.trim().slice(0, 1000);
    }

    if (input.maxPromptLength !== undefined) {
        const parsed = parseInt(input.maxPromptLength, 10);
        if (!isNaN(parsed) && parsed >= 100 && parsed <= 4000) {
            output.maxPromptLength = parsed;
        }
    }

    if (typeof input.heroIcon === 'string' && input.heroIcon.trim()) {
        output.heroIcon = input.heroIcon.trim().slice(0, 10);
    }

    if (typeof input.heroTitle === 'string' && input.heroTitle.trim()) {
        output.heroTitle = input.heroTitle.trim().slice(0, 100);
    }

    if (typeof input.heroDescription === 'string' && input.heroDescription.trim()) {
        output.heroDescription = input.heroDescription.trim().slice(0, 300);
    }

    ['chatModel', 'balancedModel', 'reasoningModel'].forEach((k) => {
        const v = typeof input[k] === 'string' ? input[k].trim() : '';
        output[k] = MODEL_NAME_REGEX.test(v) ? v : '';
    });

    ['chatNumCtx', 'balancedNumCtx', 'reasoningNumCtx'].forEach((k) => {
        const n = parseInt(input[k], 10);
        output[k] = (!isNaN(n) && n >= 512 && n <= 131072) ? n : 0;
    });

    ['chatModelLabel', 'balancedModelLabel', 'reasoningModelLabel'].forEach((k) => {
        if (typeof input[k] === 'string') {
            output[k] = input[k].trim().slice(0, 50);
        }
    });

    return output;
}

/**
 * AI 비서 설정 불러오기 (동기 캐시 반환 - 초고속 무중단)
 */
function getAiConfig() {
    return { ...cachedConfig };
}

/**
 * AI 비서 설정 업데이트 (DB 영구 보존 + 캐시 갱신)
 */
function updateAiConfig(updates = {}) {
    return new Promise((resolve) => {
        MODEL_KEYS.forEach((k) => { if (updates[k] === undefined) delete updates[k]; });
        const next = sanitizeConfig({
            ...cachedConfig,
            ...updates
        });

        cachedConfig = { ...next };

        // 보조 파일 백업
        saveConfigToBackupFile(cachedConfig);

        if (!portalDb || typeof portalDb.prepare !== 'function') {
            console.warn('[aiConfig.service] portalDb 미연결 상태에서 캐시만 갱신');
            return resolve({ success: true, config: { ...cachedConfig } });
        }

        const stmt = portalDb.prepare(`INSERT OR REPLACE INTO ai_config (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))`);
        let pending = Object.keys(next).length;
        let hasError = false;

        Object.entries(next).forEach(([k, v]) => {
            stmt.run([k, String(v)], (err) => {
                if (err) {
                    console.error(`[aiConfig.service] 키 ${k} DB 저장 오류:`, err.message);
                    hasError = true;
                }
                pending--;
                if (pending === 0) {
                    stmt.finalize();
                    resolve({ success: !hasError, config: { ...cachedConfig } });
                }
            });
        });
    });
}

/**
 * 보조 파일 쓰기 (재해 복구용 백업)
 */
function saveConfigToBackupFile(config) {
    try {
        const configDir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        // 비치명적 경고
        console.warn('[aiConfig.service] 보조 파일 백업 실패 (무시됨):', err.message);
    }
}

// 서비스 로드 시 DB 초기화 트리거
try {
    initAiConfigDb();
} catch (e) {
    console.error('[aiConfig.service] 초기화 실패:', e);
}

module.exports = {
    DEFAULT_AI_CONFIG,
    getAiConfig,
    updateAiConfig,
    initAiConfigDb
};
