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
const CHAT_MODEL = (process.env.OLLAMA_CHAT_MODEL || '').trim() || LEGACY_MODEL || 'exaone4:opt';
const REASONING_MODEL = (process.env.OLLAMA_REASONING_MODEL || '').trim() || CHAT_MODEL;

// 상주 시간: 대화 모델은 길게, 추론 모델은 짧게 (단일 상주 환경에서 교체 비용 최소화)
const CHAT_KEEP_ALIVE = '24h';
const REASONING_KEEP_ALIVE = '5m';

// 추론 모델 컨텍스트 창 (.env OLLAMA_REASONING_NUM_CTX, 예: 16384 / 미설정·0이면 Modelfile 기본값)
// 출력 토큰은 상한 없음(num_predict -1)이지만 실제 생성 길이는 이 컨텍스트 창 크기에 묶인다.
const REASONING_NUM_CTX = parseInt(process.env.OLLAMA_REASONING_NUM_CTX || '0', 10) || 0;

// 추론이 필요한 질문 패턴 (원인/분석/비교/계산/계획/판단 등)
const REASONING_REGEX = new RegExp([
    '왜\\s', '왜요', '왜$', '이유', '원인', '근거',
    '분석', '비교', '차이(점)?', '장단점', '장점.*단점', '어느\\s*(게|것이|쪽)', '뭐가\\s*(더|나아)',
    '계산', '얼마(나|인지)?\\s*(들|될|되|나와)', '몇\\s*(퍼센트|%|배)', '평균', '추세', '추이', '증가', '감소',
    '추론', '판단', '예측', '전망', '시나리오',
    '계획\\s*(세워|짜)', '일정\\s*짜', '전략', '방안', '해결\\s*(방법|책)', '어떻게\\s*하면',
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
function getReasoningModel() {
    return adminCfg().reasoningModel || REASONING_MODEL;
}

function isDualMode() {
    return getReasoningModel() !== getChatModel();
}

/**
 * 모델 교체 전 자리 확보: 대상 외 상주 모델을 keep_alive 0으로 언로드
 * (보조서버 VRAM 부족 시 대화 모델(24h 상주)이 내려가지 않아 추론 모델 로딩이 무한 대기하는 문제 방지)
 * 실패해도 본 요청은 그대로 진행 (best-effort)
 */
async function ensureModelSlot(targetModel) {
    if (!targetModel || typeof fetch !== 'function') return;
    try {
        const psRes = await fetch(new URL('/api/ps', OLLAMA_HOST), { signal: AbortSignal.timeout(5000) });
        const loaded = ((await psRes.json()).models || []).map(m => m.name || m.model).filter(Boolean);
        const others = loaded.filter(name => name !== targetModel);
        await Promise.all(others.map(name => fetch(new URL('/api/generate', OLLAMA_HOST), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: name, keep_alive: 0 }),
            signal: AbortSignal.timeout(30000)
        }).catch(() => null)));
    } catch (e) {
        console.warn('[AI 라우터] 모델 자리 확보 실패(무시):', e.message);
    }
}

/**
 * 질문 내용(또는 사용자 선택)에 따라 사용할 모델 선택
 * @param {string} prompt
 * @param {'auto'|'chat'|'reasoning'} preference 사용자 선택 (auto: 질문 내용 기반 자동 분기)
 * @returns {{ model: string, mode: 'chat'|'reasoning', keepAlive: string, timeoutMs: number }}
 */
function selectChatModel(prompt = '', preference = 'auto') {
    const text = String(prompt || '').trim();
    const cfg = adminCfg();
    const chat = { model: getChatModel(), mode: 'chat', keepAlive: CHAT_KEEP_ALIVE, timeoutMs: 300000, numCtx: parseInt(cfg.chatNumCtx, 10) || 0 };
    // 모델 교체(로딩) 시간을 고려해 타임아웃 여유 확보
    const reasoning = { model: getReasoningModel(), mode: 'reasoning', keepAlive: REASONING_KEEP_ALIVE, timeoutMs: 420000, numCtx: parseInt(cfg.reasoningNumCtx, 10) || REASONING_NUM_CTX };
    if (!isDualMode()) return chat;
    if (preference === 'chat') return chat;
    if (preference === 'reasoning') return reasoning;
    if (!text || SMALLTALK_REGEX.test(text)) return chat;

    if (REASONING_REGEX.test(text) || text.length >= LONG_PROMPT_THRESHOLD) {
        return reasoning;
    }
    return chat;
}

module.exports = {
    OLLAMA_HOST,
    CHAT_MODEL,
    REASONING_MODEL,
    CHAT_KEEP_ALIVE,
    isDualMode,
    selectChatModel,
    getChatModel,
    getReasoningModel,
    ensureModelSlot
};
