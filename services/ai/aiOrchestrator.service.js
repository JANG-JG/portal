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
const {
    DEFAULT_OLLAMA_HOST,
    streamChatToClient,
    ensureKoreanEnglishPair,
    splitThinkStream,
    ollamaDispatcher
} = require('./aiStreamClient.service');
const { getChatModel, selectChatModel, ensureModelSlot } = require('../aiModelRouter.service');
const { recordAiAuditLog } = require('../aiAuditLog.service');
const { detectPromptInjection, scrubPromptPii } = require('./aiGuardrails.service');

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
 * 🧩 공통 컨텍스트 빌더: 보안 가드 + 도구 병렬 수집 + 모델/프롬프트 조립
 */
async function prepareOrchestrationContext({ prompt, history = [], user, preference = 'auto' }) {
    const injectionCheck = detectPromptInjection(prompt);
    const unauthorizedMsg = injectionCheck.blocked ? injectionCheck.message : checkUnauthorizedAdminQuery(prompt, user);
    if (unauthorizedMsg) {
        return {
            blocked: true,
            blockReason: injectionCheck.blocked ? 'injection_blocked' : 'policy_blocked',
            unauthorizedMsg
        };
    }

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
        settled.forEach((s) => {
            if (s.status === 'fulfilled' && s.value) toolResults.push(s.value);
        });
    }

    const picked = selectChatModel(prompt, preference);
    const activeModel = picked.model || getChatModel() || 'exaone4:opt';
    const isReasoning = (picked.mode === 'reasoning' || activeModel.toLowerCase().includes('exaone'));
    const systemPrompt = buildSystemPrompt(user, activeModel);

    const messages = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history) && history.length > 0) {
        const recentHistory = history.slice(-4);
        let accumulatedChars = 0;
        const validItems = [];
        for (let i = recentHistory.length - 1; i >= 0; i--) {
            const item = recentHistory[i];
            if (item && item.role && item.content) {
                const { text } = scrubPromptPii(String(item.content), 500);
                if (!text) continue;
                if (accumulatedChars + text.length > 1200) break;
                accumulatedChars += text.length;
                validItems.unshift({
                    role: item.role === 'user' ? 'user' : 'assistant',
                    content: text
                });
            }
        }
        messages.push(...validItems);
    }

    const { text: safePrompt, scrubbed: piiScrubbed } = scrubPromptPii(prompt, 2000);
    let finalUserMessage = safePrompt;
    if (toolResults.length > 0) {
        finalUserMessage = `[참고용 실시간 포털 데이터]\n${toolResults.join('\n\n')}\n\n[사용자 질문]\n위 [참고용 실시간 포털 데이터]를 바탕으로 사용자에게 친절하고 다정한 한국어로 답변해 주세요. 제공된 데이터에 없는 날짜·수치·약품 용량·전화번호는 절대 추측해서 지어내지 마시고, 대화 길이를 요약하거나 축소하지 말고 필요한 세부 사항을 충실히 설명해 주세요. (시스템 함수명이나 영단어를 섞지 마시고, 100% 매끄럽고 친근한 순수 우리말 한국어로 설명해 주세요):\n"${safePrompt}"`;
    } else if (neededTools.length > 0) {
        finalUserMessage = `[포털 데이터 조회 결과]\n관련된 실시간 등록 데이터를 찾지 못했습니다. 없는 일정·위키·메모 정보를 임의로 지어내지 말고, 확인된 등록 정보가 없음을 솔직히 안내해 주세요.\n\n[사용자 질문]\n"${safePrompt}"`;
    }
    if (piiScrubbed) {
        finalUserMessage += `\n\n(보안 안내: 입력에 포함된 민감 개인정보는 자동으로 마스킹 처리되었습니다. 마스킹된 정보는 추측하거나 복원하려 하지 마세요.)`;
    }
    if (isReasoning) {
        finalUserMessage += `\n\n(작성 지침: 생각과 답변 모두 100% 한국어로 진행하세요. 생각은 1~2문장으로 한국어로만 간결히 정리하고, 본문에서는 표나 'Done!' 메모만 남기지 말고 곧바로 사용자에게 건네는 완성된 한국어 존댓말 본문으로 충실하게 작성해 주세요.)`;
    }
    messages.push({ role: 'user', content: finalUserMessage });

    return {
        blocked: false,
        neededTools,
        toolResults,
        picked,
        activeModel,
        isReasoning,
        messages,
        streamOptions: {
            num_ctx: Math.max(Number(picked.numCtx) || 4096, 2048)
        }
    };
}

/**
 * 🚀 전체 대화 요청 오케스트레이션 메인 함수 (HTTP SSE)
 */
async function orchestrateChatRequest({ req, res, prompt, history = [], user, preference = 'auto' }) {
    const reqStartMs = Date.now();
    // 1. 프롬프트 인젝션 / 비인가 관리자 데이터 질의 사전 차단 (SSE 헤더 전 빠른 차단)
    const injectionCheck = detectPromptInjection(prompt);
    const earlyUnauthorized = injectionCheck.blocked ? injectionCheck.message : checkUnauthorizedAdminQuery(prompt, user);
    if (earlyUnauthorized) {
        recordAiAuditLog({
            user,
            requestType: injectionCheck.blocked ? 'injection_blocked' : 'policy_blocked',
            routedMode: 'policy',
            model: 'policy-guard',
            toolsUsed: [],
            prompt,
            durationMs: Date.now() - reqStartMs,
            status: 'BLOCKED'
        });
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
        }
        res.write(`data: ${JSON.stringify({ type: 'start', model: 'policy-guard' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'content', delta: earlyUnauthorized })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        return res.end();
    }

    // ⚡ SSE 실시간 스트리밍 응답 헤더 즉시 수립 (프록시/클라우드플레어 1차 타임아웃 차단)
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
    }

    const ctx = await prepareOrchestrationContext({ prompt, history, user, preference });
    const { neededTools, picked, activeModel, isReasoning, messages, streamOptions } = ctx;

    // ⚡ 주기적 하트비트 (: keepalive) 가동 (Ollama 모델 로딩/생성 중 네트워크 타임아웃 원천 차단)
    const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': keepalive\n\n');
            if (typeof res.flush === 'function') res.flush();
        }
    }, 4000);

    try {
        const slotResult = await ensureModelSlot(activeModel);
        if (slotResult && slotResult.isAlreadyLoaded === false) {
            const friendlyName = (activeModel.includes('4b') ? '⚖️ 균형 대화 (4B)' : activeModel.includes('1b') ? '⚡ 빠른 대화 (1B)' : '🧠 깊은 생각 (EXAONE)');
            res.write(`data: ${JSON.stringify({
                type: 'thinking',
                delta: `[안내] ${friendlyName} 모델을 메모리에 새로 불러오는 중입니다... ⏳\n(모델 전환 시 약 30~50초 소요됩니다. 잠시만 기다려 주세요 😊)\n\n`,
                token: `[안내] ${friendlyName} 모델을 메모리에 새로 불러오는 중입니다... ⏳\n(모델 전환 시 약 30~50초 소요됩니다. 잠시만 기다려 주세요 😊)\n\n`
            })}\n\n`);
            if (typeof res.flush === 'function') res.flush();
        }

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
        recordAiAuditLog({
            user,
            requestType: 'stream_chat',
            routedMode: picked.mode || 'balanced',
            model: activeModel,
            toolsUsed: neededTools,
            prompt,
            durationMs: Date.now() - reqStartMs,
            status: 'SUCCESS'
        });
    } catch (streamErr) {
        recordAiAuditLog({
            user,
            requestType: 'stream_chat',
            routedMode: picked.mode || 'balanced',
            model: activeModel,
            toolsUsed: neededTools,
            prompt,
            durationMs: Date.now() - reqStartMs,
            status: 'ERROR'
        });
        throw streamErr;
    } finally {
        clearInterval(heartbeatTimer);
    }
}

/**
 * 🤖 텔레그램 등 비-SSE 채널용 AI 단일 완성 응답 실행기
 * - 동일 RBAC·도구·PII 마스킹·감사 로그 파이프라인 공유
 * - Ollama 오프라인 시 수집된 포털 실시간 데이터 기반 안전 요약 자동 폴백
 */
async function runChatCompletion({
    prompt,
    history = [],
    user,
    preference = 'auto',
    requestType = 'telegram_chat',
    timeoutMs = null,
    maxTokens = null,
    onStatus = null
}) {
    const reqStartMs = Date.now();
    const ctx = await prepareOrchestrationContext({ prompt, history, user, preference });
    if (ctx.blocked) {
        recordAiAuditLog({
            user,
            requestType: ctx.blockReason,
            routedMode: 'policy',
            model: 'policy-guard',
            toolsUsed: [],
            prompt,
            durationMs: Date.now() - reqStartMs,
            status: 'BLOCKED'
        });
        return { ok: true, blocked: true, answer: ctx.unauthorizedMsg, model: 'policy-guard', toolsUsed: [] };
    }

    const { neededTools, toolResults, picked, activeModel, isReasoning, messages, streamOptions } = ctx;
    const effectiveTimeoutMs = Number(timeoutMs) > 0
        ? Number(timeoutMs)
        : Math.max(Number(picked?.timeoutMs) || 300000, 240000);
    const effectivePredict = Number(maxTokens) > 0
        ? Number(maxTokens)
        : (isReasoning ? 950 : 650);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
        const slotResult = await ensureModelSlot(activeModel).catch(() => ({ isAlreadyLoaded: true }));
        if (slotResult && slotResult.isAlreadyLoaded === false && typeof onStatus === 'function') {
            Promise.resolve(onStatus({ type: 'model_loading', model: activeModel, mode: picked?.mode })).catch(() => {});
        }
        const ollamaRes = await fetch(`${DEFAULT_OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: activeModel,
                messages,
                stream: false,
                keep_alive: picked.keepAlive || '24h',
                options: {
                    temperature: 0.65,
                    top_p: 0.9,
                    num_predict: effectivePredict,
                    ...streamOptions
                }
            }),
            signal: controller.signal,
            dispatcher: ollamaDispatcher
        });

        if (!ollamaRes.ok) {
            throw new Error(`HTTP_${ollamaRes.status}`);
        }
        const json = await ollamaRes.json();
        const rawContent = json?.message?.content || json?.response || '';
        const parsed = splitThinkStream(rawContent, true, isReasoning, Boolean(json?.message?.thinking));
        const answer = ensureKoreanEnglishPair((parsed.answer || rawContent || '').trim());

        if (!answer) {
            throw new Error('EMPTY_ANSWER');
        }

        recordAiAuditLog({
            user,
            requestType,
            routedMode: picked.mode || 'balanced',
            model: activeModel,
            toolsUsed: neededTools,
            prompt,
            durationMs: Date.now() - reqStartMs,
            status: 'SUCCESS'
        });
        return { ok: true, blocked: false, answer, model: activeModel, toolsUsed: neededTools };
    } catch (err) {
        const elapsedMs = Date.now() - reqStartMs;
        console.error(
            `⚠️ [AI 비서] ${requestType} 추론 실패 (model=${activeModel}, elapsed=${elapsedMs}ms, timeout=${effectiveTimeoutMs}ms):`,
            err?.name || 'Error',
            err?.message || err
        );
        if (toolResults.length > 0) {
            const fallbackSummary = toolResults
                .join('\n\n')
                .replace(/^\[[^\]]+\]\s*/gm, '• ')
                .slice(0, 1500);
            recordAiAuditLog({
                user,
                requestType,
                routedMode: 'rule_fallback',
                model: 'portal-data-fallback',
                toolsUsed: neededTools,
                prompt,
                durationMs: elapsedMs,
                status: 'SUCCESS'
            });
            return {
                ok: true,
                blocked: false,
                fallback: true,
                answer: `지금 AI 모델이 잠시 바빠서 실시간 포털 데이터로 먼저 정리해 드릴게요 😊\n\n${fallbackSummary}`,
                model: 'portal-data-fallback',
                toolsUsed: neededTools
            };
        }

        recordAiAuditLog({
            user,
            requestType,
            routedMode: picked?.mode || 'balanced',
            model: activeModel,
            toolsUsed: neededTools,
            prompt,
            durationMs: elapsedMs,
            status: 'ERROR'
        });
        return {
            ok: false,
            blocked: false,
            answer: '지금 AI 비서 연결이 잠시 지연되고 있어요. `/도움말`, `/일정`, `/메모`, `/장보기`, `/혈압` 같은 빠른 명령을 바로 쓰실 수 있어요!',
            model: activeModel,
            toolsUsed: neededTools
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    resolveNeededTools,
    checkUnauthorizedAdminQuery,
    orchestrateChatRequest,
    runChatCompletion
};
