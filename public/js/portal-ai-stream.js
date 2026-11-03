/**
 * ⚡ JG 포털 AI 비서 - SSE 실시간 스트리밍 클라이언트 모듈 (portal-ai-stream.js)
 * - [핵심 역할] fetch ReadableStream 기반 SSE 이벤트 파싱 및 실시간 토큰 전달
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */
(function() {
    'use strict';

    let activeAbortController = null;

    /**
     * SSE 실시간 대화 스트리밍 요청
     */
    async function streamChat({ message, history = [], onStart, onToken, onThinking, onDone, onError, onAbort }) {
        if (activeAbortController) {
            activeAbortController.abort();
        }
        activeAbortController = new AbortController();

        if (typeof onStart === 'function') onStart();

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({
                    message,
                    history,
                    stream: true
                }),
                signal: activeAbortController.signal
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: '서버 응답 오류' }));
                const errMsg = errData.message || '로컬 AI 비서 응답 중 일시적인 오류가 발생했습니다.';
                if (typeof onError === 'function') onError(errMsg);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let isStreamDone = false;
            let fullText = '';

            while (!isStreamDone) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                let currentEventType = 'message';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (trimmed.startsWith('event:')) {
                        currentEventType = trimmed.slice(6).trim();
                        continue;
                    }

                    if (trimmed.startsWith('data:')) {
                        const dataStr = trimmed.slice(5).trim();
                        try {
                            const data = JSON.parse(dataStr);
                            if (currentEventType === 'thinking') {
                                if (typeof onThinking === 'function') onThinking(data.token || '');
                            } else if (currentEventType === 'token' || data.token) {
                                const t = data.token || '';
                                fullText += t;
                                if (typeof onToken === 'function') onToken(t);
                            } else if (currentEventType === 'done' || data.done) {
                                isStreamDone = true;
                                const final = data.fullText || fullText;
                                if (typeof onDone === 'function') onDone(final, data);
                            } else if (currentEventType === 'error') {
                                isStreamDone = true;
                                if (typeof onError === 'function') onError(data.message || '오류가 발생했습니다.');
                            }
                        } catch (e) {
                            // JSON 파싱 실패 무시
                        }
                    }
                }
            }

            if (!isStreamDone) {
                if (typeof onDone === 'function') onDone(fullText);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                if (typeof onAbort === 'function') onAbort('답변 생성을 중단했습니다.');
            } else {
                if (typeof onError === 'function') onError('로컬 PC AI 엔진과의 연결이 원활하지 않습니다. (PC의 Ollama 구동 상태를 확인해 주세요)');
            }
        } finally {
            activeAbortController = null;
        }
    }

    /**
     * 진행 중인 스트리밍 수동 취소
     */
    function abortStream() {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
            return true;
        }
        return false;
    }

    /**
     * 스트리밍 진행 여부 확인
     */
    function isStreamingActive() {
        return !!activeAbortController;
    }

    window.JgAiStream = {
        streamChat,
        abortStream,
        isStreamingActive
    };
})();
