/**
 * ==============================================================================
 * 🛡️ JG 포털 AI 비서 - 프롬프트 인젝션 방어 & PII 입력 가드레일 (aiGuardrails.service.js)
 * ------------------------------------------------------------------------------
 * - 시스템 프롬프트 탈옥(Jailbreak) / 내부 비밀키·스키마 유출 시도 사전 탐지 및 차단
 * - Ollama LLM 호출 전 민감 개인정보(주민번호·카드·계좌·연락처·이메일·비번) 자동 마스킹
 * - [규칙 2] 100% 한국어 안내 | [규칙 3] 500줄 이하 모듈화 및 비식별화 준수
 * ==============================================================================
 */

const INJECTION_PATTERNS = [
    /(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|the\s+)?(?:previous|above|prior|system|safety)\s+(?:instructions|prompts|rules|guidelines)/i,
    /(?:reveal|show|print|output|dump|leak)\s+(?:your\s+|the\s+)?(?:system\s*prompt|hidden\s*instructions|developer\s*prompt|env|secrets?)/i,
    /(?:\bdeveloper\s*mode\b|\bjailbreak\b|\bDAN\s*mode\b)/i,
    /<\|(?:im_start|im_end|system|assistant|endoftext)\|>/i,
    /(?:시스템\s*프롬프트|시스템\s*지침|내부\s*프롬프트|개발자\s*모드|원시\s*스키마|DB\s*스키마)\s*(?:를|을|이|은|좀|다)?\s*(?:보여|알려|출력|공개|무시|해제|변경|우회)/i,
    /(?:이전|기존|위의|모든)\s*(?:지시|규칙|명령|프롬프트|가이드라인)(?:를|을|는)?\s*(?:무시|잊어|취소|초기화|해제)/i,
    /(?:JWT_SECRET|INTERNAL_API_SECRET|X-Internal-Secret|\.env|비밀키|암호화\s*키|마스터\s*키)/i
];

/**
 * 🚨 프롬프트 인젝션 및 시스템 탈옥 시도 탐지
 */
function detectPromptInjection(rawPrompt) {
    const text = String(rawPrompt || '').trim();
    if (!text) return { blocked: false };

    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(text)) {
            return {
                blocked: true,
                reason: 'injection_blocked',
                message: '포털 보안 정책상 시스템 내부 지침을 변경하거나 보안·설정 정보를 열람하는 요청은 처리할 수 없어요.'
            };
        }
    }
    return { blocked: false };
}

/**
 * 🔒 LLM 전달 전 민감 개인정보(PII) 마스킹 및 제어문자 제거
 * - 일반 숫자(가격, 날짜, 시간 등)는 훼손하지 않고 식별 가능한 PII 패턴만 핀포인트 마스킹
 */
function scrubPromptPii(rawText, maxLen = 2000) {
    if (!rawText || typeof rawText !== 'string') {
        return { text: '', scrubbed: false };
    }

    let cleaned = rawText
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/<\|[a-zA-Z0-9_\-:|]+\|>/g, '')
        .trim()
        .slice(0, maxLen);

    const before = cleaned;

    // 1. 주민등록번호·외국인등록번호 (YYMMDD-1~8XXXXXX)
    cleaned = cleaned.replace(/\b\d{6}[-\s]?[1-8]\d{6}\b/g, '[주민번호 마스킹됨]');
    // 2. 16자리 신용/체크카드 번호
    cleaned = cleaned.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[카드번호 마스킹됨]');
    // 3. 하이픈 포함 계좌번호 (예: 110-123-456789, 302-1234-5678-91 — YYYY-MM-DD 날짜 오인 방지)
    cleaned = cleaned.replace(/\b\d{2,6}-\d{2,6}-\d{4,8}(?:-\d{1,4})?\b/g, '[계좌번호 마스킹됨]');
    // 4. 휴대전화 및 유선전화번호
    cleaned = cleaned.replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[연락처 마스킹됨]');
    cleaned = cleaned.replace(/\b0(?:2|[3-6]\d)[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[연락처 마스킹됨]');
    // 5. 이메일 주소
    cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[이메일 마스킹됨]');
    // 6. 비밀번호 직접 입력 문구
    cleaned = cleaned.replace(/((?:비밀번호|패스워드|비번|password)\s*(?:는|은|:|=)?\s*)\S+/gi, '$1[비밀번호 마스킹됨]');

    return {
        text: cleaned,
        scrubbed: cleaned !== before
    };
}

module.exports = {
    detectPromptInjection,
    scrubPromptPii
};
