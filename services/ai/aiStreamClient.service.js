/**
 * ⚡ JG 포털 AI 비서 - Node 22 네이티브 Ollama 스트리밍 클라이언트 (aiStreamClient.service.js)
 * - Node.js 22 표준 fetch & ReadableStream 기반 제로 카피 SSE 실시간 스트리밍
 * - <think> 사고 과정 실시간 분리 태그 파싱 (프론트엔드 아코디언 UI 연동)
 * - 클라이언트 연결 중단 시 AbortController를 통한 Ollama 추론 즉시 중단 (자원 절약)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { OLLAMA_HOST } = require('../aiModelRouter.service');

const DEFAULT_OLLAMA_HOST = (process.env.OLLAMA_HOST || OLLAMA_HOST || 'http://localhost:11434').trim();

/**
 * 🌐 Ollama 서버 상태 및 모델 가용성 헬스체크
 */
async function checkOllamaHealth(host = DEFAULT_OLLAMA_HOST) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
        const data = await res.json();
        return { online: true, models: (data.models || []).map(m => m.name) };
    } catch (err) {
        return { online: false, error: err.message };
    }
}

const ALL_OPEN_TAGS = ['<think>', '<thought>', '[think]', '[thought]', '<reasoning>', '[reasoning]'];
const ALL_CLOSE_TAGS = ['</think>', '</thought>', '[/think]', '[/thought]', '</reasoning>', '[/reasoning]'];
const OPEN_TAG_REGEX = /<think>|<thought>|\[think\]|\[thought\]|<reasoning>|\[reasoning\]/i;
const CLOSE_TAG_REGEX = /<\/think>|<\/thought>|\[\/think\]|\[\/thought\]|<\/reasoning>|\[\/reasoning\]/i;

/**
 * 🏷️ 영단어 및 마크다운 서식 정제 엔진
 * - [규칙 2] 100% 일상 친화적 한국어 인터페이스 준수
 * - 일상 단어(midday, duration 등) 순수 한국어 치환
 * - 주요 금융/시사 고유명사 및 약어 '한글단어(영단어)' 표기 보장
 * - 마크다운 괄호 중복 깨짐([추가]]) 자동 복원
 */
function ensureKoreanEnglishPair(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;

    // 1. 마크다운 중복 괄호 서식 깨짐 복원 (예: [추가]] -> [추가], [[ -> [, ]] -> ])
    result = result
        .replace(/\[([^\]\n]+)\]\]/g, '[$1]')
        .replace(/\[\[([^\]\n]+)\]/g, '[$1]');

    // 2. 일상 친화적 한국어 변환 (불필요한 영어 노출 원천 차단)
    const dailyTerms = [
        { regex: /\bmidday\b/gi, repl: '한낮' },
        { regex: /\bduration\b/gi, repl: '지속 시간' },
        { regex: /\bFederal\s+Reserve\b/gi, repl: '미 연방준비제도(Fed)' },
        { regex: /\bBase\s+Rate\b/gi, repl: '기준금리' },
        { regex: /\bExchange\s+Rate\b/gi, repl: '환율' },
        { regex: /\bStock\s+Market\b/gi, repl: '증시' },
        { regex: /\bheadline\b/gi, repl: '주요 소식' },
        { regex: /\bheadlines\b/gi, repl: '주요 헤드라인' }
    ];
    for (const term of dailyTerms) {
        result = result.replace(term.regex, term.repl);
    }

    // 3. 주요 공식 약어 '한글단어(영단어)' 보장
    const officialPairs = [
        { regex: /(?<![가-힣\(\/])\bFX\b(?![가-힣\)])/g, repl: '외환(FX)' },
        { regex: /(?<![가-힣\(\/])\bKOSPI\b(?![가-힣\)])/g, repl: '코스피(KOSPI)' },
        { regex: /(?<![가-힣\(\/])\bKOSDAQ\b(?![가-힣\)])/g, repl: '코스닥(KOSDAQ)' },
        { regex: /(?<![가-힣\(\/])\bFED\b(?![가-힣\)])/gi, repl: '미 연준(Fed)' },
        { regex: /(?<![가-힣\(\/])\bGDP\b(?![가-힣\)])/g, repl: '국내총생산(GDP)' },
        { regex: /(?<![가-힣\(\/])\bCPI\b(?![가-힣\)])/g, repl: '소비자물가지수(CPI)' },
        { regex: /(?<![가-힣\(\/])\bFOMC\b(?![가-힣\)])/g, repl: '연방공개시장위원회(FOMC)' },
        { regex: /(?<![가-힣\(\/])\bBOK\b(?![가-힣\)])/g, repl: '한국은행(BOK)' }
    ];
    for (const p of officialPairs) {
        result = result.replace(p.regex, p.repl);
    }

    return result;
}

/**
 * 🕵️‍♂️ 본문 시작부에 튀어나오는 모델의 메타 독백(CoT 누출)을 감지하여 생각 과정으로 흡수
 * @param {string} text - 본문 후보 텍스트
 * @param {boolean} final - 스트림 완료 여부
 * @returns {{ absorbedThinking: string, cleanAnswer: string, isStillInMeta: boolean }}
 */
function extractLeadingMetaThinking(text, final = false) {
    if (!text || typeof text !== 'string') {
        return { absorbedThinking: '', cleanAnswer: '', isStillInMeta: false };
    }

    const trimmed = text.replace(/^\s+/, '');
    if (!trimmed) {
        return { absorbedThinking: '', cleanAnswer: '', isStillInMeta: false };
    }

    // 메타 독백 시작 트리거 감지 (Okay, 사용자가~, 전문 분석~, 추론 내용을~ 등)
    const metaStartRegex = /^(?:(?:Okay|Ok|오케이|알겠습니다|자,)\s*[,.]?\s*)?(?:사용자(?:가|는|의|에게)|요청(?:한|하신|내용)|질문(?:한|하신|내용)|전문\s*분석\s*추론|추론\s*내용을|사전\s*정리된\s*내용|생각해\s*보면|답변\s*계획|답변을\s*작성|이\s*정보(?:들을)?\s*바탕으로)/i;

    if (!metaStartRegex.test(trimmed)) {
        return { absorbedThinking: '', cleanAnswer: text, isStillInMeta: false };
    }

    // 메타 독백 종료 및 실제 본문 시작 전환점 탐색
    const transitionRegex = /\n\s*(?:\n+|(?=[#\-*]|\d+\.\s|안녕하세요|네,\s|오늘의|실시간|현재|문의하신|요청하신|가족\s*포털))/i;
    const match = trimmed.search(transitionRegex);

    if (match !== -1) {
        const absorbed = trimmed.slice(0, match).trim();
        const remainder = trimmed.slice(match).replace(/^\s+/, '');
        return { absorbedThinking: absorbed, cleanAnswer: remainder, isStillInMeta: false };
    }

    if (final) {
        return { absorbedThinking: trimmed, cleanAnswer: '', isStillInMeta: false };
    }

    return { absorbedThinking: trimmed, cleanAnswer: '', isStillInMeta: true };
}

/**
 * EXAONE 4.0 및 추론 모델 사고 과정 태그 완전 제거
 */
function stripThinkTags(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/<(think|thought|reasoning)>[\s\S]*?<\/(think|thought|reasoning)>/gi, '')
        .replace(/\[(think|thought|reasoning)\][\s\S]*?\[\/(think|thought|reasoning)\]/gi, '')
        .replace(/^[\s\S]*?<\/(think|thought|reasoning)>/i, '')
        .replace(/^[\s\S]*?\[\/(think|thought|reasoning)\]/i, '')
        .replace(/<(think|thought|reasoning)>[\s\S]*$/i, '')
        .replace(/\[(think|thought|reasoning)\][\s\S]*$/i, '')
        .replace(/<\/?(think|thought|reasoning)>/gi, '')
        .replace(/\[\/?(think|thought|reasoning)\]/gi, '');
}

/**
 * 스트리밍 원문을 생각 과정(thinking)과 답변 본문(answer)으로 분리
 * - 1) <think>...</think>, <thought>...</thought>, [THINK]...[/THINK] 태그 분리
 * - 2) 여는 태그 없이 닫는 태그만 있는 템플릿 선주입 모델(EXAONE 4.0 등) 대응
 * - 3) 태그가 없는 경우: 추론 모드에서는 닫는 태그 전까지 생각 스트림으로 버퍼링, 일반 모드에서는 본문 즉시 스트리밍
 */
function splitThinkStreamInternal(raw, final = false, isReasoning = false, hasNativeThinking = false) {
    const text = raw || '';
    if (!text) return { thinking: '', answer: '', closed: false };

    // 0) 네이티브 thinking 필드로 이미 생각을 수신 중이거나 완료한 경우:
    // 혹시 text(content) 시작 부분에 남아있는 닫는 태그나 생각 잔여물이 있는지 검사
    if (hasNativeThinking) {
        const closeMatch = text.match(CLOSE_TAG_REGEX);
        if (closeMatch) {
            const closeIdx = closeMatch.index;
            const extraThinking = text.slice(0, closeIdx).trim();
            const rawAns = text.slice(closeIdx + closeMatch[0].length);
            const cleanAns = stripThinkTags(rawAns).replace(/^\s+/, '');
            return { thinking: extraThinking, answer: cleanAns, closed: true };
        }
        const clean = stripThinkTags(text).replace(/^\s+/, '');
        return { thinking: '', answer: clean, closed: true };
    }

    const openMatch = text.match(OPEN_TAG_REGEX);
    const closeMatch = text.match(CLOSE_TAG_REGEX);
    const hasOpen = !!openMatch;
    const hasClose = !!closeMatch;

    // 1) 여는 태그가 있는 경우
    if (hasOpen) {
        const openIdx = openMatch.index;
        const afterOpen = text.slice(openIdx + openMatch[0].length);
        const innerCloseMatch = afterOpen.match(CLOSE_TAG_REGEX);

        if (innerCloseMatch) {
            const closeIdx = innerCloseMatch.index;
            const thinking = afterOpen.slice(0, closeIdx).trim();
            const afterClose = afterOpen.slice(closeIdx + innerCloseMatch[0].length);
            const answer = (stripThinkTags(afterClose) || '').replace(/^\s+/, '');
            return { thinking, answer, closed: true };
        }

        if (final) {
            return { thinking: afterOpen.trim(), answer: '', closed: false };
        }

        let hold = 0;
        for (const cTag of ALL_CLOSE_TAGS) {
            for (let k = cTag.length - 1; k > 0; k--) {
                if (afterOpen.toLowerCase().endsWith(cTag.slice(0, k))) {
                    hold = Math.max(hold, k);
                }
            }
        }
        return {
            thinking: afterOpen.slice(0, afterOpen.length - hold).replace(/^\s+/, ''),
            answer: '',
            closed: false
        };
    }

    // 2) 여는 태그 없이 닫는 태그만 있는 경우 (EXAONE 4.0 템플릿 선주입 대응)
    if (hasClose) {
        const closeIdx = closeMatch.index;
        const thinking = text.slice(0, closeIdx).trim();
        const afterClose = text.slice(closeIdx + closeMatch[0].length);
        const answer = (stripThinkTags(afterClose) || '').replace(/^\s+/, '');
        return { thinking, answer, closed: true };
    }

    // 3) 태그가 아직 없는 상태
    // 3-A) 추론 모델 모드: 닫는 태그가 나오기 전까지는 생각 스트림으로 버퍼링
    if (isReasoning) {
        if (final) {
            return { thinking: (stripThinkTags(text) || '').trim(), answer: '', closed: false };
        }
        let holdTail = 0;
        for (const cTag of ALL_CLOSE_TAGS) {
            for (let k = cTag.length - 1; k > 0; k--) {
                if (text.toLowerCase().endsWith(cTag.slice(0, k))) {
                    holdTail = Math.max(holdTail, k);
                }
            }
        }
        return {
            thinking: text.slice(0, text.length - holdTail).replace(/^\s+/, ''),
            answer: '',
            closed: false
        };
    }

    // 3-B) 일반 대화 모델 모드 -> 여는 태그 접두사 확인 후 답변 본문(answer)으로 즉시 스트리밍
    if (final) {
        return { thinking: '', answer: (stripThinkTags(text) || '').trim(), closed: false };
    }

    let holdOpen = 0;
    for (const oTag of ALL_OPEN_TAGS) {
        for (let k = oTag.length - 1; k > 0; k--) {
            if (text.toLowerCase().endsWith(oTag.slice(0, k))) {
                holdOpen = Math.max(holdOpen, k);
            }
        }
    }
    const cleanAnswer = text.slice(0, text.length - holdOpen);
    return { thinking: '', answer: cleanAnswer.replace(/^\s+/, ''), closed: false };
}

/**
 * 🛡️ 생각 과정(thinking)과 본문(answer) 분리 + 본문 시작 메타 독백 흡수 가드
 */
function splitThinkStream(raw, final = false, isReasoning = false, hasNativeThinking = false) {
    const res = splitThinkStreamInternal(raw, final, isReasoning, hasNativeThinking);
    if (res.answer) {
        const meta = extractLeadingMetaThinking(res.answer, final);
        if (meta.absorbedThinking) {
            res.thinking = (res.thinking ? res.thinking + '\n\n' : '') + meta.absorbedThinking;
            res.answer = meta.cleanAnswer;
            if (meta.isStillInMeta) {
                res.closed = false;
            }
        }
    }
    return res;
}

/**
 * 🧠 추론 모델이 생각(<think>)만 출력하고 본문 없이(또는 점/기호만으로) 종료된 경우
 * 생각 내용을 바탕으로 사용자에게 제공할 최종 본문을 즉시 이어서 실시간 스트리밍하는 2차 복구 안전망
 */
async function streamAnswerFromThinking({ messages, thinkingText, model, keepAlive, options, abortSignal, sendEvent }) {
    // 마지막 사용자 질문 추출
    const lastUserMsg = (Array.isArray(messages) ? [...messages].reverse().find(m => m && m.role === 'user') : null);
    const userPrompt = lastUserMsg ? String(lastUserMsg.content).replace(/\[참고용 실시간[\s\S]*?\[사용자 질문\]/i, '').replace(/[\r\n]+/g, ' ').trim() : '사용자 질문';

    const systemPrompt = `당신은 JG 가족 포털의 전용 AI 비서 "제이지(JG)"입니다.
가족 구성원에게 다정하고 친절한 한국어 존댓말(~해요, ~합니다)로 완성된 최종 답변을 상세하게 제공합니다.
[필수 준수 규칙]
1. 내부 독백/혼잣말 절대 금지: "Okay", "사용자가 ~를 요청했군", "사용자는 아마도 ~", "답변을 작성해 보자", "추론 내용을 보면" 등의 혼잣말이나 메타 독백을 절대로 본문에 쓰지 마세요.
2. 첫 어절부터 곧바로 사용자에게 건네는 완성형 한국어 존댓말 본문으로 시작하세요.
3. 100% 일상 한국어 사용: 일상 단어(midday, duration 등)에 영어를 쓰지 말고 한낮, 소요 시간 등 순수 우리말로 작성하세요. 공식 약어만 '한글단어(영단어)' 형태로 표기하세요.`;

    const promptForRecovery = `다음 [사용자 질문]에 대해 [사전 정리된 핵심 참고 내용]을 바탕으로 사용자에게 제공할 최종 분석 답변 본문을 작성해 주세요.

[사용자 질문]
${userPrompt.slice(0, 500)}

[사전 정리된 핵심 참고 내용]
${thinkingText.slice(0, 3000)}

위 내용을 바탕으로 사용자에게 친절하고 다정한 한국어 존댓말로 상세하고 풍부하게 답변해 주세요. 혼잣말이나 메타 독백 없이 곧바로 완성된 한국어 본문만 작성해 주세요.`;

    // EXAONE 단일 모델로 즉시 복구 (gemma 등 타 모델 로딩 방지)
    const candidateModels = [model, 'exaone4:opt'].filter((v, idx, arr) => v && arr.indexOf(v) === idx);

    for (const targetModel of candidateModels) {
        try {
            console.log(`[aiStreamClient] 2차 본문 완성 안전망 가동 (모델: ${targetModel})...`);
            const res = await fetch(`${DEFAULT_OLLAMA_HOST}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: targetModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: promptForRecovery }
                    ],
                    stream: true,
                    keep_alive: keepAlive || '24h',
                    options: Object.assign({
                        temperature: 0.7,
                        top_p: 0.9,
                        num_predict: -1
                    }, options)
                }),
                signal: abortSignal
            });

            if (!res.ok) {
                console.warn(`[aiStreamClient] 2차 본문 모델(${targetModel}) 실패 (HTTP ${res.status}), 다음 후보 시도...`);
                continue;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let recoveryRaw = '';
            let sentRecovery = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const json = JSON.parse(trimmed);
                        const delta = json.message?.content || json.response || '';
                        if (delta) {
                            const cleanDelta = delta.replace(/<\/?think>/gi, '');
                            recoveryRaw += cleanDelta;
                            const meta = extractLeadingMetaThinking(recoveryRaw, false);
                            if (meta.cleanAnswer && !meta.isStillInMeta) {
                                if (meta.cleanAnswer.length > sentRecovery.length) {
                                    const aDelta = meta.cleanAnswer.slice(sentRecovery.length);
                                    sentRecovery = meta.cleanAnswer;
                                    if (aDelta) {
                                        sendEvent({ type: 'content', delta: aDelta, token: aDelta });
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                }
            }

            const finalMeta = extractLeadingMetaThinking(recoveryRaw, true);
            const finalClean = (finalMeta.cleanAnswer || recoveryRaw).replace(/<\/?think>/gi, '').trim();
            if (finalClean.length > sentRecovery.length) {
                const remaining = finalClean.slice(sentRecovery.length);
                sentRecovery = finalClean;
                if (remaining) {
                    sendEvent({ type: 'content', delta: remaining, token: remaining });
                }
            }

            const trimmedAns = finalClean.trim();
            if (trimmedAns.length >= 20) {
                console.log(`[aiStreamClient] ✅ 2차 본문 자동 완성 성공 (${targetModel}, ${trimmedAns.length}자)`);
                return trimmedAns;
            }
        } catch (e) {
            console.warn(`[aiStreamClient] 2차 본문 시도 중 에러 (${targetModel}):`, e.message);
        }
    }
    return '';
}

/**
 * ⚡ Ollama /api/chat SSE 스트리밍 처리기
 * @param {Object} options
 * @param {import('express').Request} options.req - 클라이언트 요청
 * @param {import('express').Response} options.res - 클라이언트 SSE 응답 객체
 * @param {string} options.model - 구동 모델 (예: exaone3.5:2.4b, exaone4:opt)
 * @param {Array} options.messages - [{role: 'system'|'user'|'assistant', content: '...'}]
 * @param {Object} [options.tools] - Ollama 도구 목록 (옵션)
 * @param {Object} [options.options] - Ollama 생성 옵션 (num_ctx, num_predict 등)
 * @param {string} [options.keepAlive] - Ollama 모델 메모리 상주 시간 (기본 24h)
 * @param {boolean} [options.isReasoningMode] - 깊은 생각 추론 모드 여부
 */
async function streamChatToClient({ req, res, model, messages, tools = null, options = {}, keepAlive = '24h', isReasoningMode = false }) {
    // 1. SSE 응답 헤더 설정
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Nginx 버퍼링 차단
        res.flushHeaders?.();
    }

    const abortController = new AbortController();

    // 클라이언트 브라우저가 창을 닫거나 요청을 취소한 경우
    req.on('close', () => {
        if (!res.writableEnded) {
            abortController.abort();
        }
    });

    const sendEvent = (eventData) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            if (typeof res.flush === 'function') {
                res.flush();
            }
        }
    };

    try {
        sendEvent({ type: 'start', model });

        const payload = {
            model,
            messages,
            stream: true,
            keep_alive: keepAlive || '24h',
            options: Object.assign({
                temperature: 0.7,
                top_p: 0.9,
                num_ctx: 32768, // 워크스테이션 VRAM 활용을 극대화한 32K 컨텍스트
                num_predict: -1 // 대화 길이 축소 없이 끝까지 충실하고 풍부하게 생성 (상한 없음)
            }, options)
        };

        if (Array.isArray(tools) && tools.length > 0) {
            payload.tools = tools;
        }

        const ollamaRes = await fetch(`${DEFAULT_OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: abortController.signal
        });

        if (!ollamaRes.ok) {
            const errBody = await ollamaRes.text().catch(() => '');
            throw new Error(`Ollama 서버 응답 오류 (HTTP ${ollamaRes.status}): ${errBody.slice(0, 100)}`);
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let rawAnswer = '';
        let sentThinking = '';
        let sentAnswer = '';
        let nativeThinking = '';
        let thinkStartMs = null;
        let thinkEndMs = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 미완성 라인 보관

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                let json;
                try {
                    json = JSON.parse(trimmed);
                } catch (e) {
                    continue; // 파싱 실패 라인 무시
                }

                // 1) 도구 호출 청크(Tool Calls) 감지
                if (json.message?.tool_calls && json.message.tool_calls.length > 0) {
                    sendEvent({
                        type: 'tool_call',
                        toolCalls: json.message.tool_calls
                    });
                }

                // 2) Ollama 네이티브 thinking 필드 처리 (Ollama 0.5+ / EXAONE 4.0 추론)
                const thinkToken = json.message?.thinking || json.thinking || '';
                if (thinkToken) {
                    if (!thinkStartMs) thinkStartMs = Date.now();
                    nativeThinking += thinkToken;
                    sendEvent({ type: 'thinking', delta: thinkToken, token: thinkToken });
                }

                // 3) 일반 콘텐츠 및 <think> 분리 처리
                const delta = json.message?.content || json.response || '';
                if (delta) {
                    rawAnswer += delta;
                    const hasNative = (nativeThinking.length > 0);
                    const part = splitThinkStream(rawAnswer, false, isReasoningMode, hasNative);

                    // 생각 과정 스트리밍
                    if (part.thinking.length > sentThinking.length && part.thinking.startsWith(sentThinking)) {
                        if (!thinkStartMs) thinkStartMs = Date.now();
                        const tDelta = part.thinking.slice(sentThinking.length);
                        sentThinking = part.thinking;
                        sendEvent({ type: 'thinking', delta: tDelta, token: tDelta });
                    }

                    // 답변 본문 실시간 스트리밍 (무중단 실시간 타이핑 렌더링)
                    if (part.answer.length > sentAnswer.length) {
                        if (thinkStartMs && !thinkEndMs) thinkEndMs = Date.now();
                        if (part.answer.startsWith(sentAnswer)) {
                            const aDelta = part.answer.slice(sentAnswer.length);
                            sentAnswer = part.answer;
                            sendEvent({ type: 'content', delta: aDelta, token: aDelta });
                        } else {
                            // 공통 접두사 안전망 (태그/공백 분리 등으로 인한 미세 변동 방어)
                            let commonLen = 0;
                            while (commonLen < sentAnswer.length && commonLen < part.answer.length && sentAnswer[commonLen] === part.answer[commonLen]) {
                                commonLen++;
                            }
                            const aDelta = part.answer.slice(commonLen);
                            sentAnswer = part.answer;
                            if (aDelta) {
                                sendEvent({ type: 'content', delta: aDelta, token: aDelta });
                            }
                        }
                    }
                }

                if (json.done) {
                    const hasNative = (nativeThinking.length > 0);
                    const finalPart = splitThinkStream(rawAnswer, true, isReasoningMode, hasNative);
                    let finalThinking = (nativeThinking + (hasNative ? (finalPart.thinking ? ' ' + finalPart.thinking : '') : finalPart.thinking)).trim();
                    let finalAnswer = ensureKoreanEnglishPair(finalPart.answer.trim());

                    // 🛡️ [생각 후 본문 답변 미출력 방어 안전망]
                    // 생각 내용이 존재하는데, 본문 답변이 비어있거나 점/기호뿐인 경우 (유효 글자 수 15자 미만)
                    const meaningfulAnswerLen = finalAnswer.replace(/[^\w\uAC00-\uD7A3]/g, '').length;
                    if (meaningfulAnswerLen < 15 && finalThinking.length >= 25 && !abortController.signal.aborted) {
                        console.log(`[aiStreamClient] 🧠 생각 후 본문 미출력 감지 (본문: ${meaningfulAnswerLen}자, 생각: ${finalThinking.length}자). 2차 본문 자동 완성 가동...`);
                        const recovered = await streamAnswerFromThinking({
                            messages,
                            thinkingText: finalThinking,
                            model,
                            keepAlive,
                            options,
                            abortSignal: abortController.signal,
                            sendEvent
                        });
                        if (recovered) {
                            finalAnswer = ensureKoreanEnglishPair(recovered);
                            sentAnswer = finalAnswer;
                        }
                    } else {
                        // 미전송된 마지막 잔여 토큰 방출
                        if (finalPart.answer.length > sentAnswer.length) {
                            let commonLen = 0;
                            while (commonLen < sentAnswer.length && commonLen < finalPart.answer.length && sentAnswer[commonLen] === finalPart.answer[commonLen]) {
                                commonLen++;
                            }
                            const remaining = finalPart.answer.slice(commonLen);
                            sentAnswer = finalPart.answer;
                            if (remaining) {
                                sendEvent({ type: 'content', delta: remaining, token: remaining });
                            }
                        }
                    }

                    if (!thinkEndMs && thinkStartMs) thinkEndMs = Date.now();
                    const thinkDurationSec = (thinkStartMs && thinkEndMs)
                        ? Math.max(1, Math.round((thinkEndMs - thinkStartMs) / 1000))
                        : (json.total_duration ? Math.max(1, Math.round(json.total_duration / 1e9)) : null);

                    sendEvent({
                        type: 'done',
                        fullText: finalAnswer || sentAnswer || (meaningfulAnswerLen >= 15 ? ensureKoreanEnglishPair(rawAnswer) : '분석 결과를 정리하는 중 일시적인 지연이 발생했습니다. 다시 한번 질문해 주세요.'),
                        thinkingText: finalThinking,
                        thinkDurationSec,
                        totalDuration: json.total_duration,
                        evalCount: json.eval_count
                    });
                    res.end();
                    return;
                }
            }
        }

        if (!res.writableEnded) {
            const hasNative = (nativeThinking.length > 0);
            const finalPart = splitThinkStream(rawAnswer, true, isReasoningMode, hasNative);
            let finalThinking = (nativeThinking + (hasNative ? (finalPart.thinking ? ' ' + finalPart.thinking : '') : finalPart.thinking)).trim();
            let finalAnswer = ensureKoreanEnglishPair(finalPart.answer.trim());

            const meaningfulAnswerLen = finalAnswer.replace(/[^\w\uAC00-\uD7A3]/g, '').length;
            if (meaningfulAnswerLen < 15 && finalThinking.length >= 25 && !abortController.signal.aborted) {
                console.log(`[aiStreamClient] 🧠 스트림 말미 생각 후 본문 미출력 감지. 2차 본문 자동 완성 가동...`);
                const recovered = await streamAnswerFromThinking({
                    messages,
                    thinkingText: finalThinking,
                    model,
                    keepAlive,
                    options,
                    abortSignal: abortController.signal,
                    sendEvent
                });
                if (recovered) {
                    finalAnswer = ensureKoreanEnglishPair(recovered);
                    sentAnswer = finalAnswer;
                }
            } else {
                // 미전송된 마지막 잔여 토큰 방출
                if (finalPart.answer.length > sentAnswer.length) {
                    let commonLen = 0;
                    while (commonLen < sentAnswer.length && commonLen < finalPart.answer.length && sentAnswer[commonLen] === finalPart.answer[commonLen]) {
                        commonLen++;
                    }
                    const remaining = finalPart.answer.slice(commonLen);
                    sentAnswer = finalPart.answer;
                    if (remaining) {
                        sendEvent({ type: 'content', delta: remaining, token: remaining });
                    }
                }
            }

            if (!thinkEndMs && thinkStartMs) thinkEndMs = Date.now();
            const thinkDurationSec = (thinkStartMs && thinkEndMs) ? Math.max(1, Math.round((thinkEndMs - thinkStartMs) / 1000)) : null;

            sendEvent({
                type: 'done',
                fullText: finalAnswer || sentAnswer || ensureKoreanEnglishPair(rawAnswer),
                thinkingText: finalThinking,
                thinkDurationSec
            });
            res.end();
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('[aiStreamClient] 클라이언트에 의해 스트림 취소됨');
            return;
        }

        console.error('[aiStreamClient] 스트리밍 중 오류 발생:', err);
        sendEvent({
            type: 'error',
            message: 'AI 비서와의 연결이 일시적으로 원활하지 않습니다. 잠시 후 다시 질문해 주세요.'
        });
        res.end();
    }
}

module.exports = {
    DEFAULT_OLLAMA_HOST,
    checkOllamaHealth,
    streamChatToClient
};
