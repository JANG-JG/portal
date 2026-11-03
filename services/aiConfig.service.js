/**
 * 🤖 JG 포털 로컬 AI 비서 런타임 설정 서비스 (aiConfig.service.js)
 * - 첫 환영 인사말 및 1회 질문 글자 수 제한 영구 보존
 * - [규칙 1] 안전 백업 및 스마트 병합 | [규칙 3] 500줄 이하 모듈화
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'ai-config.json');
const BACKUP_PATH = path.join(__dirname, '..', 'config', 'ai-config.json.bak');

const DEFAULT_AI_CONFIG = {
    welcomeMessage: '안녕하세요! JG 포털 AI 비서(LG EXAONE 3.5)입니다. 🇰🇷\n궁금한 점이 있으시면 무엇이든 편하게 물어보세요! 😊',
    maxPromptLength: 1000
};

let cachedConfig = null;

/**
 * AI 비서 설정 불러오기
 */
function getAiConfig() {
    if (cachedConfig) {
        return { ...cachedConfig };
    }

    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            cachedConfig = {
                welcomeMessage: typeof parsed.welcomeMessage === 'string' && parsed.welcomeMessage.trim()
                    ? parsed.welcomeMessage.trim()
                    : DEFAULT_AI_CONFIG.welcomeMessage,
                maxPromptLength: Number.isInteger(parsed.maxPromptLength) && parsed.maxPromptLength >= 100 && parsed.maxPromptLength <= 4000
                    ? parsed.maxPromptLength
                    : DEFAULT_AI_CONFIG.maxPromptLength
            };
            return { ...cachedConfig };
        }
    } catch (err) {
        console.error('[aiConfig.service] 설정 로드 실패, 기본값 사용:', err.message);
    }

    // 설정 파일이 없거나 에러 시 기본값 적용 및 파일 저장
    cachedConfig = { ...DEFAULT_AI_CONFIG };
    saveConfigToFile(cachedConfig);
    return { ...cachedConfig };
}

/**
 * 내부 파일 쓰기 및 백업 보존
 */
function saveConfigToFile(config) {
    try {
        const configDir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        const dataStr = JSON.stringify(config, null, 2);

        // 기존 파일이 있으면 백업
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
            } catch (backupErr) {
                console.warn('[aiConfig.service] 백업 생성 실패:', backupErr.message);
            }
        }

        fs.writeFileSync(CONFIG_PATH, dataStr, 'utf8');
        return true;
    } catch (err) {
        console.error('[aiConfig.service] 파일 저장 오류:', err);
        return false;
    }
}

/**
 * AI 비서 설정 업데이트
 */
function updateAiConfig(updates = {}) {
    const current = getAiConfig();
    const nextConfig = { ...current };

    if (typeof updates.welcomeMessage === 'string') {
        const trimmed = updates.welcomeMessage.trim();
        if (trimmed.length > 0 && trimmed.length <= 1000) {
            nextConfig.welcomeMessage = trimmed;
        }
    }

    if (updates.maxPromptLength !== undefined) {
        const parsedLen = parseInt(updates.maxPromptLength, 10);
        if (!isNaN(parsedLen) && parsedLen >= 100 && parsedLen <= 4000) {
            nextConfig.maxPromptLength = parsedLen;
        }
    }

    cachedConfig = { ...nextConfig };
    const saved = saveConfigToFile(cachedConfig);
    return { success: saved, config: { ...cachedConfig } };
}

module.exports = {
    DEFAULT_AI_CONFIG,
    getAiConfig,
    updateAiConfig
};
