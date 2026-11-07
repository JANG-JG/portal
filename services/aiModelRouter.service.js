/**
 * 🔀 로컬 AI 듀얼 모델 라우터 (aiModelRouter.service.js)
 * - 평상시 대화/브리핑: 경량 대화 모델 (예: Gemma)
 * - 추론·분석이 필요한 질문: 추론 모델 (예: EXAONE 4.0)
 * - Ollama 단일 상주(OLLAMA_MAX_LOADED_MODELS=1) 환경 전제:
 *   대화 모델은 길게 상주, 추론 모델은 짧게 상주시켜 사용 후 대화 모델로 빠르게 복귀
 *
 * .env 설정 키
 *   OLLAMA_CHAT_MODEL       평상시 대화 모델 (미설정 시 OLLAMA_MODEL → exaone4:opt)
 *   OLLAMA_REASONING_MODEL  추론 모델       (미설정 시 대화 모델과 동일 = 단일 모델 모드)
 */

// Ollama 서버 주소 (.env OLLAMA_HOST, 미설정 시 Ollama 기본 주소)
const OLLAMA_HOST = (process.env.OLLAMA_HOST || '').trim() || 'http://localhost:11434';

const LEGACY_MODEL = (process.env.OLLAMA_MODEL || '').trim();
const CHAT_MODEL = (process.env.OLLAMA_CHAT_MODEL || '').trim() || 'gemma3:1b';
const BALANCED_MODEL = (process.env.OLLAMA_BALANCED_MODEL || '').trim() || 'gemma3:4b';
const REASONING_MODEL = (process.env.OLLAMA_REASONING_MODEL || '').trim() || LEGACY_MODEL || 'exaone4:opt';

// 상주 시간: 24시간 VRAM 상주
const CHAT_KEEP_ALIVE = '24h';
const BALANCED_KEEP_ALIVE = '24h';
const REASONING_KEEP_ALIVE = '24h';

// 컨텍스트 창 기본값: 4096 (VRAM 최적화 및 쾌속 응답)
const DEFAULT_NUM_CTX = 4096;
const CHAT_NUM_CTX = parseInt(process.env.OLLAMA_CHAT_NUM_CTX || '', 10) || DEFAULT_NUM_CTX;
const BALANCED_NUM_CTX = parseInt(process.env.OLLAMA_BALANCED_NUM_CTX || '', 10) || DEFAULT_NUM_CTX;
const REASONING_NUM_CTX = parseInt(process.env.OLLAMA_REASONING_NUM_CTX || '', 10) || DEFAULT_NUM_CTX;

// 추론이 필요한 질문 패턴 (원인/분석/비교/계산/계획/판단/영향 등)
const REASONING_REGEX = new RegExp([
    '왜\\s', '왜요', '왜$', '이유', '원인', '근거',
    '분석', '비교', '차이(점)?', '장단점', '장점.*단점', '어느\\s*(게|것이|쪽)', '뭐가\\s*(더|나아)',
    '영향', '효과', '파급', '상관관계', '인과관계', '결과',
    '계산', '얼마(나|인지)?\\s*(들|될|되|나와)', '몇\\s*(퍼센트|%|배)', '평균', '추세', '추이', '증가', '감소',
    '추론', '판단', '예측', '전망', '시나리오', '진단',
    '계획\\s*(세워|짜)', '일정\\s*짜', '전략', '방안', '해결\\s*(방법|책)', '어떻게', '어떨까', '어떠할',
    '단계별', '자세히', '깊게', '꼼꼼히', '논리', '설명해\\s*(줘|주세요|봐)', '풀어\\s*(줘|주세요)',
    '코드', '스크립트', '수식', '증명'
].join('|'), 'i');

// 짧은 인사/잡담은 무조건 대화 모델
const SMALLTALK_REGEX = /^(안녕|하이|ㅎㅇ|고마워|감사|ㅋㅋ|ㅎㅎ|좋아|굿|오케이|ok|네|응|그래)[\s!.~?ㅋㅎ]*$/i;

const LONG_PROMPT_THRESHOLD = 220; // 긴 질문은 추론 모델로

// 관리자 페이지(DB ai_config) 설정 우선, 비어 있으면 .env 값 사용 → 재시작 없이 즉시 반영
const { getAiConfig } = require('./aiConfig.service');
function adminCfg() {
    try { return getAiConfig() || {}; } catch (e) { return {}; }
}
function getChatModel() {
    return adminCfg().chatModel || CHAT_MODEL;
}
function getBalancedModel() {
    return adminCfg().balancedModel || BALANCED_MODEL;
}
function getReasoningModel() {
    return adminCfg().reasoningModel || REASONING_MODEL;
}

function isDualMode() {
    return getReasoningModel() !== getChatModel();
}

/**
 * 모델 교체 전 자리 확보: 대상 외 상주 모델을 keep_alive 0으로 언로드
/**
 * 🎯 요청 모델의 메모리 적재 상태 확인
 * - 이미 메모리에 올라와 있는지 확인(isAlreadyLoaded)하여 신규 로딩 시 안내 문구 제공
 * - 다른 모델을 강제로 내쫓지 않고 Ollama 자체 스케줄러에 위임하여 잦은 60초 콜드 로딩 방지
 */
async function ensureModelSlot(targetModel) {
    if (!targetModel || typeof fetch !== 'function') return { isAlreadyLoaded: true };
    try {
        const psRes = await fetch(new URL('/api/ps', OLLAMA_HOST), { signal: AbortSignal.timeout(5000) });
        const loaded = ((await psRes.json()).models || []).map(m => m.name || m.model).filter(Boolean);
        const isMatch = (name, target) => {
            if (!name || !target) return false;
            if (name === target) return true;
            const normName = name.replace(/:latest$/, '');
            const normTarget = target.replace(/:latest$/, '');
            return normName === normTarget || normName.startsWith(normTarget + ':') || normTarget.startsWith(normName + ':');
        };
        const isAlreadyLoaded = loaded.some(name => isMatch(name, targetModel));
        return { isAlreadyLoaded };
    } catch (e) {
        console.warn('[AI 라우터] 모델 적재 상태 확인 실패(무시):', e.message);
        return { isAlreadyLoaded: true };
    }
}

/**
 * 질문 내용(또는 사용자 선택)에 따라 사용할 모델 선택
 * @param {string} prompt
 * @param {'auto'|'chat'|'balanced'|'reasoning'} preference 사용자 선택 (auto: 질문 내용 기반 자동 분기)
 * @returns {{ model: string, mode: 'chat'|'balanced'|'reasoning', keepAlive: string, timeoutMs: number, numCtx: number }}
 */
function selectChatModel(prompt = '', preference = 'auto') {
    const text = String(prompt || '').trim();
    const cfg = adminCfg();
    const chat = { model: getChatModel(), mode: 'chat', keepAlive: CHAT_KEEP_ALIVE, timeoutMs: 300000, numCtx: parseInt(cfg.chatNumCtx, 10) || CHAT_NUM_CTX };
    const balanced = { model: getBalancedModel(), mode: 'balanced', keepAlive: BALANCED_KEEP_ALIVE, timeoutMs: 360000, numCtx: parseInt(cfg.balancedNumCtx, 10) || BALANCED_NUM_CTX };
    const reasoning = { model: getReasoningModel(), mode: 'reasoning', keepAlive: REASONING_KEEP_ALIVE, timeoutMs: 420000, numCtx: parseInt(cfg.reasoningNumCtx, 10) || REASONING_NUM_CTX };

    if (preference === 'chat') return chat;
    if (preference === 'balanced') return balanced;
    if (preference === 'reasoning') return reasoning;
    if (!text || SMALLTALK_REGEX.test(text)) return chat;

    if (REASONING_REGEX.test(text) || text.length >= LONG_PROMPT_THRESHOLD) {
        return reasoning;
    }
    // 스마트 자동 모드에서 일반 질문/대화는 균형 잡힌 4B 모델로 풍부하고 정확하게 응답
    return balanced;
}

module.exports = {
    OLLAMA_HOST,
    CHAT_MODEL,
    BALANCED_MODEL,
    REASONING_MODEL,
    CHAT_KEEP_ALIVE,
    BALANCED_KEEP_ALIVE,
    REASONING_KEEP_ALIVE,
    isDualMode,
    selectChatModel,
    getChatModel,
    getBalancedModel,
    getReasoningModel,
    ensureModelSlot
};
