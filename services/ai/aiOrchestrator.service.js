/**
 * 🎯 JG 포털 AI 비서 - 전체 에이전트 오케스트레이터 (aiOrchestrator.service.js)
 * - [핵심 역할] 인텐트 판별 -> 3계층 도구 병렬 실행 -> 프롬프트 조립 -> SSE 스트리밍
 * - [무장애 설계] Ollama 오프라인 시 0.1초 내 규칙 브리핑 자동 폴백
 * - [보안 강화] 관리자 전용 질의 가족 계정 접근 시 안내 메시지 즉시 반환
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { executeTool } = require('./aiTools.registry');
const { isAdmin } = require('./aiDataFetchers.service');
const { buildSystemPrompt, formatToolDataToContext } = require('./aiPromptBuilder.service');
const { streamChatToClient } = require('./aiStreamClient.service');
const { getChatModel, selectChatModel } = require('../aiModelRouter.service');

/** 🔍 사용자 질문에서 필요한 도구 목록 지능형 선별 */
function resolveNeededTools(prompt, user) {
    if (!prompt || typeof prompt !== 'string') return [];
    const text = prompt.trim().toLowerCase();
    const isUserAdmin = isAdmin(user);
    const tools = new Set();

    // 1. 관리자 전용 데이터 질문 감지
    const isBloodQuery = /(혈압|약\s*(먹었|챙겼)|투약|수축기|이완기|맥박|약\s*복용)/.test(text);
    const isAssetQuery = /(자산|주식|포트폴리오|계좌|잔액|수익률|배당|보유\s*종목)/.test(text);
    const isSystemQuery = /(서버\s*(상태|cpu|메모리|자원|점유)|디스크\s*용량|시스템\s*관제)/.test(text);

    if (isBloodQuery) {
        if (isUserAdmin) tools.add('get_blood_records');
    }
    if (isAssetQuery) {
        if (isUserAdmin) tools.add('get_asset_summary');
    }
    if (isSystemQuery) {
        if (isUserAdmin) tools.add('get_system_status');
    }

    // 2. 가족 공용 데이터 질문 감지
    if (/(날씨|기온|온도|비\s*(오|올|내리|왔)|눈\s*(오|올|내리|왔)|우산|미세\s*먼지|황사|체감|추워|더워|쌀쌀|따뜻|습도|바람|하늘|일기\s*예보|기상\s*(청|정보|상황)|외출|바깥|옷차림|뭐\s*입|패딩|코트)/.test(text)) {
        tools.add('get_weather');
    }
    if (/(증시|코스피|코스닥|환율|달러|시장\s*지수)/.test(text)) {
        tools.add('get_market_indicators');
    }
    if (/(뉴스|헤드라인|속보|이슈|신문|오늘\s*소식)/.test(text)) {
        tools.add('get_news_top');
    }
    if (/(위키|매뉴얼|사용법|어떻게\s*써|규칙|레시피|생활\s*가이드)/.test(text)) {
        tools.add('get_family_wiki');
    }
    if (/(사진|앨범|찍은|추억|갤러리)/.test(text)) {
        tools.add('get_family_photos');
    }

    // 3. 캘린더 및 일정 질문 감지
    if (/(일정|스케줄|약속|계획|언제|행사|제사|여행|할\s*일)/.test(text)) {
        tools.add('get_family_calendar');
        tools.add('get_personal_calendar');
    }

    // 4. 메모장 질문 감지
    if (/(메모|적어둔|기록한|적은\s*거|메모장)/.test(text)) {
        tools.add('get_personal_memos');
    }

    // 5. 복합 질문 및 첫 인사 ("오늘 브리핑", "오늘 하루 어때", "안녕", "좋은 아침")
    if (/(브리핑|오늘\s*(하루|요약|안내|어때|상황|소식|날씨)|좋은\s*(아침|하루)|굿모닝|상황\s*보고|반가워|안녕|시작해|출근)/.test(text)) {
        tools.add('get_weather');
        tools.add('get_family_calendar');
        tools.add('get_personal_calendar');
        if (isUserAdmin) {
            tools.add('get_blood_records');
            tools.add('get_asset_summary');
        } else {
            tools.add('get_news_top');
        }
    }

    return Array.from(tools);
}

/** 🎯 질문 텍스트로부터 도구 실행에 필요한 핀포인트 파라미터 스마트 추출 */
function resolveToolParams(toolName, prompt) {
    if (!prompt || typeof prompt !== 'string') return {};
    const text = prompt.trim();

    if (toolName === 'get_news_top') {
        const isGeneral = /^(주요\s*뉴스|오늘\s*뉴스|실시간\s*뉴스|속보|뉴스\s*(알려|보여|요약|정리|있어|뭐\s*있|소식)|오늘\s*소식)/i.test(text);
        if (!isGeneral) {
            const m = text.match(/([가-힣a-zA-Z0-9]{2,})\s*(관련|에\s*대한)?\s*(뉴스|기사|속보|소식)/);
            if (m && m[1] && !/^(주요|오늘|실시간|최신|요즘|모든|전체)$/.test(m[1])) {
                return { keyword: m[1] };
            }
        }
    }
    return {};
}

/** 🛡️ 가족 계정의 관리자 전용 데이터 요청 거절 가드 */
function checkUnauthorizedAdminQuery(prompt, user) {
    if (isAdmin(user)) return null;
    const text = prompt.trim().toLowerCase();

    if (/(혈압|복약|약\s*먹었|투약)/.test(text)) {
        return '혈압 및 복약 건강 관리 데이터는 관리자 전용 정보로 보호되어 있어요. 도움이 필요하시면 관리자에게 문의해 주세요!';
    }
    if (/(자산|주식|계좌|잔액|수익률|배당)/.test(text)) {
        return '금융 자산 및 계좌 정보는 관리자 전용 정보입니다. 가족 계정에서는 조회가 제한되어 있어요.';
    }
    if (/(관리자\s*페이지|서버\s*설정|db\s*관리|시스템\s*설정)/.test(text)) {
        return '시스템 관제 및 관리자 설정은 접근 권한이 없습니다.';
    }
    return null;
}

/**
 * 🚀 전체 대화 요청 오케스트레이션 메인 함수
 */
async function orchestrateChatRequest({ req, res, prompt, history = [], user }) {
    // 1. 비인가 관리자 데이터 질의 사전 차단
    const unauthorizedMsg = checkUnauthorizedAdminQuery(prompt, user);
    if (unauthorizedMsg) {
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
        }
        res.write(`data: ${JSON.stringify({ type: 'start', model: 'policy-guard' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'content', delta: unauthorizedMsg })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        return res.end();
    }

    // 2. 필요 도구 판별 및 병렬 데이터 수집
    const neededTools = resolveNeededTools(prompt, user);
    const toolResults = [];

    if (neededTools.length > 0) {
        const fetchPromises = neededTools.map(async (toolName) => {
            const params = resolveToolParams(toolName, prompt);
            const execResult = await executeTool(toolName, params, user);
            if (execResult && execResult.success) {
                return formatToolDataToContext(toolName, execResult.data);
            }
            return null;
        });

        const settled = await Promise.allSettled(fetchPromises);
        settled.forEach(s => {
            if (s.status === 'fulfilled' && s.value) {
                toolResults.push(s.value);
            }
        });
    }

    // 3. 시스템 프롬프트 빌드 (역할, 시간, 한국어 존댓말)
    const systemPrompt = buildSystemPrompt(user);

    // 4. 대화 이력 구성 (안전한 최근 4~6턴)
    const messages = [
        { role: 'system', content: systemPrompt }
    ];

    if (Array.isArray(history)) {
        const safeHistory = history.slice(-6);
        safeHistory.forEach(item => {
            if (item && item.role && item.content) {
                messages.push({
                    role: item.role === 'user' ? 'user' : 'assistant',
                    content: String(item.content).slice(0, 1000)
                });
            }
        });
    }

    // 5. 질문 의도에 따른 모델 및 파라미터 선택 (EXAONE 단일 모델)
    const picked = selectChatModel(prompt);
    const activeModel = picked.model || getChatModel() || 'exaone4:opt';
    const isReasoning = (picked.mode === 'reasoning');
    const streamOptions = {
        num_ctx: picked.numCtx || 32768
    };

    // 6. [실측 최적화] EXAONE 4.0 1.2B가 데이터를 100% 인용하고 본문 출력을 누락하지 않도록 User 메시지 지침 보강
    let finalUserMessage = prompt;
    if (toolResults.length > 0) {
        finalUserMessage = `[참고용 실시간 포털 데이터]\n${toolResults.join('\n\n')}\n\n[사용자 질문]\n위 [참고용 실시간 포털 데이터]를 바탕으로 사용자에게 친절하고 다정한 한국어로 답변해 주세요. 대화 길이를 요약하거나 축소하지 말고, 필요한 세부 사항과 수치를 충분히 담아 풍부하고 상세하게 설명해 주세요. (시스템 함수명은 노출하지 마시고, 일상 단어는 영어 대신 순수 한국어로, 공식 전문 약어만 '한글단어(영단어)' 형태로 친절하게 표기해 주세요):\n"${prompt}"`;
    }
    if (isReasoning) {
        finalUserMessage += `\n\n(작성 지침: 생각(Thinking) 과정은 생각 영역 안에서만 마무리하고, 본문 시작 시 'Okay', '사용자가 ~를 요청했군', '전문 분석 추론 내용을 보면' 같은 혼잣말이나 메타 독백을 절대 쓰지 마세요. 일상 단어에 영어를 섞지 마시고 첫 문장부터 사용자에게 건네는 완성된 한국어 존댓말 본문으로 시작해 주세요.)`;
    }

    messages.push({ role: 'user', content: finalUserMessage });

    // 7. SSE 실시간 스트리밍 실행 (대화 길이 제한 없이 풍부하게 끝까지 생성)
    await streamChatToClient({
        req,
        res,
        model: activeModel,
        messages,
        options: streamOptions,
        keepAlive: picked.keepAlive || '24h',
        isReasoningMode: isReasoning
    });
}

module.exports = {
    resolveNeededTools,
    checkUnauthorizedAdminQuery,
    orchestrateChatRequest
};
