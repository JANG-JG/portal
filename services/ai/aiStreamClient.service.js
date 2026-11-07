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

/**
 * EXAONE 4.0 및 추론 모델 사고 과정 태그 제거
 */
function stripThinkTags(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').replace(/<think>[\s\S]*$/i, '');
}

/**
 * 스트리밍 원문을 생각 과정(thinking)과 답변 본문(answer)으로 분리
 * - 1) <think>...</think> 태그 분리
 * - 2) 여는 태그 없이 </think>만 있는 템플릿 선주입 모델(EXAONE 4.0 등) 대응
 * - 3) 태그가 없는 경우: 추론 모드에서는 </think> 전까지 생각 스트림으로 버퍼링, 일반 모드에서는 본문 즉시 스트리밍
 */
function splitThinkStream(raw, final = false, isReasoning = false, hasNativeThinking = false) {
    const text = raw || '';
    if (!text) return { thinking: '', answer: '', closed: false };

    // 0) 네이티브 thinking 필드로 이미 생각을 수신한 경우:
    // 이후 생성되는 raw 텍스트는 100% 답변 본문임
    if (hasNativeThinking) {
        const clean = stripThinkTags(text).replace(/^\s+/, '');
        return { thinking: '', answer: clean, closed: true };
    }

    const thinkTagRegex = /<think>/i;
    const thinkCloseRegex = /<\/think>/i;
    const hasOpen = thinkTagRegex.test(text);
    const hasClose = thinkCloseRegex.test(text);

    // 1) <think> 여는 태그가 있는 경우
    if (hasOpen) {
        const openMatch = text.match(thinkTagRegex);
        const openIdx = openMatch.index;
        const afterOpen = text.slice(openIdx + openMatch[0].length);
        const closeMatch = afterOpen.match(thinkCloseRegex);

        if (closeMatch) {
            const closeIdx = closeMatch.index;
            const thinking = afterOpen.slice(0, closeIdx).trim();
            const answer = (stripThinkTags(afterOpen.slice(closeIdx + closeMatch[0].length)) || '').replace(/^\s+/, '');
            return { thinking, answer, closed: true };
        }

        if (final) {
            return { thinking: afterOpen.trim(), answer: '', closed: false };
        }

        let hold = 0;
        const closeTag = '</think>';
        for (let k = closeTag.length - 1; k > 0; k--) {
            if (afterOpen.toLowerCase().endsWith(closeTag.slice(0, k))) {
                hold = k;
                break;
            }
        }
        return {
            thinking: afterOpen.slice(0, afterOpen.length - hold).replace(/^\s+/, ''),
            answer: '',
            closed: false
        };
    }

    // 2) 여는 태그 없이 닫는 태그 </think>만 있는 경우 (EXAONE 4.0 템플릿 선주입 대응)
    if (hasClose) {
        const closeMatch = text.match(thinkCloseRegex);
        const closeIdx = closeMatch.index;
        const thinking = text.slice(0, closeIdx).trim();
        const answer = (stripThinkTags(text.slice(closeIdx + closeMatch[0].length)) || '').replace(/^\s+/, '');
        return { thinking, answer, closed: true };
    }

    // 3) 태그가 아직 없는 상태
    // 3-A) 추론 모델 모드: </think>가 나오기 전까지는 생각 스트림으로 버퍼링
    if (isReasoning) {
        if (final) {
            return { thinking: (stripThinkTags(text) || '').trim(), answer: '', closed: false };
        }
        let holdTail = 0;
        const closeTag = '</think>';
        for (let k = closeTag.length - 1; k > 0; k--) {
            if (text.toLowerCase().endsWith(closeTag.slice(0, k))) {
                holdTail = k;
                break;
            }
        }
        return {
            thinking: text.slice(0, text.length - holdTail).replace(/^\s+/, ''),
            answer: '',
            closed: false
        };
    }

    // 3-B) 일반 대화 모델 모드 -> 답변 본문(answer)으로 즉시 스트리밍
    if (final) {
        return { thinking: '', answer: (stripThinkTags(text) || '').trim(), closed: false };
    }

    let holdOpen = 0;
    const openTag = '<think>';
    for (let k = openTag.length - 1; k > 0; k--) {
        if (text.toLowerCase().endsWith(openTag.slice(0, k))) {
            holdOpen = k;
            break;
        }
    }
    const cleanAnswer = text.slice(0, text.length - holdOpen);
    return { thinking: '', answer: cleanAnswer.replace(/^\s+/, ''), closed: false };
}

/**
 * 🧠 추론 모델이 생각(<think>)만 출력하고 본문 없이(또는 점/기호만으로) 종료된 경우
 * 생각 내용을 바탕으로 사용자에게 제공할 최종 본문을 즉시 이어서 실시간 스트리밍하는 2차 복구 안전망
 */
async function streamAnswerFromThinking({ messages, thinkingText, model, keepAlive, options, abortSignal, sendEvent }) {
    // 마지막 사용자 질문 추출
    const lastUserMsg = (Array.isArray(messages) ? [...messages].reverse().find(m => m && m.role === 'user') : null);
    const userPrompt = lastUserMsg ? String(lastUserMsg.content).replace(/\[참고용 실시간[\s\S]*?\[사용자 질문\]/i, '').replace(/[\r\n]+/g, ' ').trim() : '사용자 질문';

    const promptForRecovery = `사용자가 다음과 같은 질문을 하였고, 전문 분석 추론이 완료되었습니다.\n\n[사용자 질문]\n${userPrompt.slice(0, 500)}\n\n[전문 분석 추론 내용]\n${thinkingText.slice(0, 3000)}\n\n위 전문 분석 추론 내용을 바탕으로, 사용자에게 정중하고 친절한 한국어 존댓말(~해요, ~합니다)로 풍부하고 완성도 높은 최종 분석 답변을 상세하게 작성해 주세요. (추가 안내나 잡담 없이 완성된 마크다운 본문만 바로 작성해 주세요.)`;

    // 1순위: 한국어 작문력과 속도가 뛰어난 gemma2:jg, 폴백: 원본 모델
    const candidateModels = ['gemma2:jg', 'exaone3.5:2.4b', model].filter((v, idx, arr) => v && arr.indexOf(v) === idx);

    for (const targetModel of candidateModels) {
        try {
            console.log(`[aiStreamClient] 2차 본문 완성 안전망 가동 (모델: ${targetModel})...`);
            const res = await fetch(`${DEFAULT_OLLAMA_HOST}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: targetModel,
                    messages: [
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
            let recoveryAnswer = '';

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
                            if (cleanDelta) {
                                recoveryAnswer += cleanDelta;
                                sendEvent({ type: 'content', delta: cleanDelta, token: cleanDelta });
                            }
                        }
                    } catch (e) {}
                }
            }

            const trimmedAns = recoveryAnswer.trim();
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
                    nativeThinking += thinkToken;
                    sendEvent({ type: 'thinking', delta: thinkToken, token: thinkToken });
                }

                // 3) 일반 콘텐츠 및 <think> 분리 처리
                const delta = json.message?.content || json.response || '';
                if (delta) {
                    rawAnswer += delta;
                    const hasNative = (nativeThinking.length > 0);
                    const part = splitThinkStream(rawAnswer, false, isReasoningMode, hasNative);

                    // 생각 과정 스트리밍 (네이티브 thinking이 없는 모델일 때 <think> 태그 분리)
                    if (!hasNative && part.thinking.length > sentThinking.length && part.thinking.startsWith(sentThinking)) {
                        const tDelta = part.thinking.slice(sentThinking.length);
                        sentThinking = part.thinking;
                        sendEvent({ type: 'thinking', delta: tDelta, token: tDelta });
                    }

                    // 답변 본문 스트리밍
                    const visible = part.answer;
                    if (visible.length > sentAnswer.length && visible.startsWith(sentAnswer)) {
                        const aDelta = visible.slice(sentAnswer.length);
                        sentAnswer = visible;
                        sendEvent({ type: 'content', delta: aDelta, token: aDelta });
                    }
                }

                if (json.done) {
                    const hasNative = (nativeThinking.length > 0);
                    const finalPart = splitThinkStream(rawAnswer, true, isReasoningMode, hasNative);
                    let finalThinking = (nativeThinking + (hasNative ? '' : finalPart.thinking)).trim();
                    let finalAnswer = finalPart.answer.trim();

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
                            finalAnswer = recovered;
                            sentAnswer = recovered;
                        }
                    } else {
                        if (finalAnswer.length > sentAnswer.length && finalAnswer.startsWith(sentAnswer)) {
                            const remaining = finalAnswer.slice(sentAnswer.length);
                            sentAnswer = finalAnswer;
                            sendEvent({ type: 'content', delta: remaining, token: remaining });
                        }
                    }

                    sendEvent({
                        type: 'done',
                        fullText: finalAnswer || sentAnswer || (meaningfulAnswerLen >= 15 ? rawAnswer : '분석 결과를 정리하는 중 일시적인 지연이 발생했습니다. 다시 한번 질문해 주세요.'),
                        thinkingText: finalThinking,
                        totalDuration: json.total_duration,
                        evalCount: json.eval_count
                    });
                    res.end();
                    return;
                }
            }
        }

        if (!res.writableEnded) {
            const finalPart = splitThinkStream(rawAnswer, true, isReasoningMode);
            let finalThinking = (nativeThinking + finalPart.thinking).trim();
            let finalAnswer = finalPart.answer.trim();

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
                    finalAnswer = recovered;
                    sentAnswer = recovered;
                }
            } else {
                if (finalAnswer.length > sentAnswer.length && finalAnswer.startsWith(sentAnswer)) {
                    const remaining = finalAnswer.slice(sentAnswer.length);
                    sentAnswer = finalAnswer;
                    sendEvent({ type: 'content', delta: remaining, token: remaining });
                }
            }

            sendEvent({
                type: 'done',
                fullText: finalAnswer || sentAnswer || rawAnswer,
                thinkingText: finalThinking
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
