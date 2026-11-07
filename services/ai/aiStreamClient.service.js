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
 * - 3) 태그가 없는 경우: 스트리밍 중에는 </think> 전까지 생각으로 스트리밍하되, 최종 완료 시 </think>가 없으면 전체를 본문으로 전환
 */
function splitThinkStream(raw, final = false) {
    const text = raw || '';
    if (!text) return { thinking: '', answer: '', closed: false };

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

    // 3) <think> 태그가 전혀 없는 경우
    if (final) {
        return { thinking: '', answer: (stripThinkTags(text) || '').trim(), closed: false };
    }

    // EXAONE 4.0 템플릿은 프롬프트 끝에 <think>를 선주입 → </think> 전까지는 생각 과정으로 스트리밍
    // (종료 시까지 </think>가 없으면 위 final 분기에서 전체를 답변으로 처리, 생각 패널은 자동 제거)
    let holdTail = 0;
    for (const tag of ['</think>', '<think>']) {
        for (let k = tag.length - 1; k > 0; k--) {
            if (text.toLowerCase().endsWith(tag.slice(0, k))) { holdTail = Math.max(holdTail, k); break; }
        }
    }
    return { thinking: text.slice(0, text.length - holdTail).replace(/^\s+/, ''), answer: '', closed: false };
}

/**
 * ⚡ Ollama /api/chat SSE 스트리밍 처리기
 * @param {Object} options
 * @param {import('express').Request} options.req - 클라이언트 요청
 * @param {import('express').Response} options.res - 클라이언트 SSE 응답 객체
 * @param {string} options.model - 구동 모델 (예: exaone3.5:2.4b, exaone4:opt)
 * @param {Array} options.messages - [{role: 'system'|'user'|'assistant', content: '...'}]
 * @param {Object} [options.tools] - Ollama 도구 목록 (옵션)
 */
async function streamChatToClient({ req, res, model, messages, tools = null }) {
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
            options: {
                temperature: 0.7,
                top_p: 0.9
            }
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
                    const part = splitThinkStream(rawAnswer, false);

                    // 생각 과정 스트리밍
                    if (part.thinking.length > sentThinking.length && part.thinking.startsWith(sentThinking)) {
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
                    const finalPart = splitThinkStream(rawAnswer, true);
                    const finalThinking = (nativeThinking + finalPart.thinking).trim();
                    const finalAnswer = finalPart.answer.trim();

                    if (finalAnswer.length > sentAnswer.length && finalAnswer.startsWith(sentAnswer)) {
                        const remaining = finalAnswer.slice(sentAnswer.length);
                        sentAnswer = finalAnswer;
                        sendEvent({ type: 'content', delta: remaining, token: remaining });
                    }

                    sendEvent({
                        type: 'done',
                        fullText: finalAnswer || sentAnswer || rawAnswer,
                        thinkingText: finalThinking,
                        totalDuration: json.total_duration,
                        evalCount: json.eval_count
                    });
                }
            }
        }

        if (!res.writableEnded) {
            const finalPart = splitThinkStream(rawAnswer, true);
            const finalThinking = (nativeThinking + finalPart.thinking).trim();
            const finalAnswer = finalPart.answer.trim();

            if (finalAnswer.length > sentAnswer.length && finalAnswer.startsWith(sentAnswer)) {
                const remaining = finalAnswer.slice(sentAnswer.length);
                sentAnswer = finalAnswer;
                sendEvent({ type: 'content', delta: remaining, token: remaining });
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
