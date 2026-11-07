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
        let isInsideThink = false;

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

                // 2) 일반 콘텐츠 및 <think> 분리 처리
                const delta = json.message?.content || '';
                if (delta) {
                    let currentText = delta;

                    // <think> 태그 시작 감지
                    if (!isInsideThink && currentText.includes('<think>')) {
                        isInsideThink = true;
                        const parts = currentText.split('<think>');
                        if (parts[0]) sendEvent({ type: 'content', delta: parts[0] });
                        currentText = parts[1] || '';
                    }

                    // </think> 태그 종료 감지
                    if (isInsideThink && currentText.includes('</think>')) {
                        isInsideThink = false;
                        const parts = currentText.split('</think>');
                        if (parts[0]) sendEvent({ type: 'thinking', delta: parts[0] });
                        if (parts[1]) sendEvent({ type: 'content', delta: parts[1] });
                        continue;
                    }

                    if (isInsideThink) {
                        sendEvent({ type: 'thinking', delta: currentText });
                    } else {
                        sendEvent({ type: 'content', delta: currentText });
                    }
                }

                if (json.done) {
                    sendEvent({
                        type: 'done',
                        totalDuration: json.total_duration,
                        evalCount: json.eval_count
                    });
                }
            }
        }

        res.end();
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
