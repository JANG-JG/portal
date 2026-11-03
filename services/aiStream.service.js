/**
 * ⚡ JG 포털 AI 비서 - SSE(Server-Sent Events) 실시간 토큰 스트리밍 엔진 (aiStream.service.js)
 * - [핵심 역할] Ollama stream:true와 Express SSE를 결합한 초고속 실시간 스트리밍
 * - [체감 혁신] 첫 글자 출력 대기(TTFT)를 0.5초 이내로 단축 (클로드/제미나이 동급 경험)
 * - [자원 보호] 클라이언트 중단(Stop 버튼/창 닫기) 감지 시 Ollama 요청 즉시 취소
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const http = require('http');
const { buildAiChatPrompt, sanitizeInputText } = require('./aiContextRouter.service');
const { searchWikiContent, createWikiPage, getWikiPageDetail, updateWikiPage } = require('./wikiSummary.service');
const { smartMergeOrDraftWiki } = require('./aiKnowledge.service');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://192.168.50.164:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

/**
 * SSE 포맷 이벤트 전송 헬퍼
 */
function sendSseEvent(res, eventType, data) {
    if (res.writableEnded) return;
    try {
        const payload = typeof data === 'string' ? { text: data } : data;
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
        // 소켓 종료 시 무시
    }
}

/**
 * 위키 문서 자동 저장 및 병합 의도 처리 (단발성 응답)
 */
async function handleWikiIntent({ prompt, history, userName, res }) {
    const WIKI_INTENT_REGEX = /(위키|wiki)\s*(에|로|에다가)?\s*(저장|등록|작성|기록|추가|올려|남겨|만들어|정리|발행)/i;
    const isWikiIntent = WIKI_INTENT_REGEX.test(prompt) || /(이거|이\s*내용|방금\s*내용|위\s*내용|앞의\s*내용).*위키/i.test(prompt);

    if (!isWikiIntent) return false;

    let targetContent = '';
    let targetTitle = '';

    const strippedIntent = prompt.replace(WIKI_INTENT_REGEX, '').trim();
    if (strippedIntent.length >= 15) {
        targetContent = strippedIntent;
        targetTitle = strippedIntent.split(/[\n,.]/)[0].slice(0, 30).trim();
    } else if (Array.isArray(history) && history.length > 0) {
        const lastAssistantMsg = [...history].reverse().find(h => h && h.role === 'assistant' && h.content);
        const lastUserMsg = [...history].reverse().find(h => h && h.role === 'user' && h.content && !WIKI_INTENT_REGEX.test(h.content));
        if (lastAssistantMsg) {
            targetContent = lastAssistantMsg.content;
            if (lastUserMsg) targetTitle = lastUserMsg.content.slice(0, 30);
        }
    }

    if (!targetContent || targetContent.length < 5) {
        const guideMsg = '어떤 내용을 가족 위키에 저장할까요? 위키로 보관하고 싶은 레시피, 생활 팁, 가전 사용법 등을 말씀해 주시면 알기 쉽게 마크다운 문서로 정리하여 바로 등록해 드릴게요! 😊';
        sendSseEvent(res, 'token', { token: guideMsg });
        sendSseEvent(res, 'done', { fullText: guideMsg, model: OLLAMA_MODEL });
        res.end();
        return true;
    }

    sendSseEvent(res, 'token', { token: '가족 위키 문서를 분석하고 정리하는 중입니다... 📚\n\n' });

    let candidateDoc = null;
    const searchKeyword = targetTitle || targetContent.slice(0, 80);
    try {
        const candidates = await searchWikiContent(searchKeyword, 1);
        if (Array.isArray(candidates) && candidates.length > 0 && candidates[0].slug) {
            candidateDoc = await getWikiPageDetail(candidates[0].slug);
        }
    } catch (e) {
        // 신규 문서로 계속 진행
    }

    const processed = await smartMergeOrDraftWiki({
        newContent: targetContent,
        newTitle: targetTitle,
        candidateDoc,
        userName
    });

    let answerMsg = '';
    let wikiMeta = null;

    if (processed.action === 'merge' && candidateDoc) {
        const updateRes = await updateWikiPage({
            slug: candidateDoc.slug,
            content_md: processed.content_md,
            title: processed.title,
            category: processed.category,
            change_summary: processed.merge_summary || 'AI 지능형 보강',
            author: userName || '가족'
        });
        const verText = updateRes.version ? ` (v${updateRes.version})` : '';
        answerMsg = `가족 위키 문서 **[${processed.category}] ${processed.title}${verText}**에 새로운 내용을 누적 보강했습니다! 🔄\n\n- **보강 요약**: ${processed.merge_summary || '최신 정보 업데이트'}\n- **문서 제목**: ${processed.title}\n\n👉 [**위키 문서 바로가기**](${updateRes.view_url || `/wiki/${candidateDoc.slug}`})`;
        wikiMeta = { slug: candidateDoc.slug, title: processed.title, category: processed.category, view_url: updateRes.view_url || `/wiki/${candidateDoc.slug}` };
    } else {
        const saveRes = await createWikiPage({
            category: processed.category || '생활',
            title: processed.title,
            content_md: processed.content_md,
            slug: processed.slug
        });
        answerMsg = `가족 위키에 **[${saveRes.category || processed.category}] ${saveRes.title || processed.title}** 문서를 성공적으로 등록했습니다! 📚\n\n- **카테고리**: ${saveRes.category || processed.category}\n- **문서 제목**: ${saveRes.title || processed.title}\n\n👉 [**위키 문서 바로가기**](${saveRes.view_url || `/wiki/${saveRes.slug}`})`;
        wikiMeta = { id: saveRes.id, title: saveRes.title || processed.title, category: saveRes.category || processed.category, slug: saveRes.slug || processed.slug, view_url: saveRes.view_url || `/wiki/${saveRes.slug}` };
    }

    sendSseEvent(res, 'token', { token: answerMsg });
    sendSseEvent(res, 'done', { fullText: answerMsg, wiki: wikiMeta, model: OLLAMA_MODEL });
    res.end();
    return true;
}

/**
 * ⚡ Express SSE 기반 실시간 AI 대화 스트리밍 처리기
 */
async function handleSseChatStream({ req, res, prompt, history = [], summaryContext = null, userName = '가족' }) {
    // 1. SSE 응답 헤더 설정
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    // 2. 위키 작성 의도 우선 감지
    const handledWiki = await handleWikiIntent({ prompt, history, userName, res });
    if (handledWiki) return;

    // 3. 질문 의도 분석 및 최적화된 프롬프트 빌드
    const { fullPrompt } = await buildAiChatPrompt({
        prompt,
        history,
        summaryContext,
        userName
    });

    let isFinished = false;
    let fullAnswer = '';
    let ollamaReq = null;

    // 4. 클라이언트 연결 끊김(Stop 버튼 / 탭 닫기) 감지 시 Ollama 요청 즉시 파기
    req.on('close', () => {
        if (!isFinished && ollamaReq) {
            try {
                ollamaReq.destroy();
            } catch (e) {
                // 정리 오류 무시
            }
        }
    });

    // 5. Ollama 실시간 스트리밍 HTTP 요청 발송
    try {
        const urlObj = new URL('/api/generate', OLLAMA_HOST);
        const bodyStr = JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: fullPrompt,
            stream: true,
            keep_alive: '24h',
            options: {
                temperature: 0.7,
                num_predict: 2048
            }
        });

        ollamaReq = http.request(urlObj, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            },
            timeout: 120000
        }, (ollamaRes) => {
            if (ollamaRes.statusCode < 200 || ollamaRes.statusCode >= 300) {
                sendSseEvent(res, 'error', { message: `로컬 AI 엔진 오류 (상태 코드: ${ollamaRes.statusCode})` });
                res.end();
                isFinished = true;
                return;
            }

            let buffer = '';
            ollamaRes.setEncoding('utf8');

            ollamaRes.on('data', (chunk) => {
                if (isFinished || res.writableEnded) return;
                buffer += chunk;

                const lines = buffer.split('\n');
                // 마지막 불완전한 라인은 버퍼에 유지
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.response) {
                            fullAnswer += parsed.response;
                            sendSseEvent(res, 'token', { token: parsed.response });
                        }
                        if (parsed.done) {
                            isFinished = true;
                            sendSseEvent(res, 'done', {
                                fullText: fullAnswer.trim(),
                                model: OLLAMA_MODEL
                            });
                            res.end();
                            return;
                        }
                    } catch (jsonErr) {
                        // 개별 라인 파싱 실패 무시
                    }
                }
            });

            ollamaRes.on('end', () => {
                if (!isFinished && !res.writableEnded) {
                    isFinished = true;
                    // 버퍼 잔여분 파싱 시도
                    if (buffer.trim()) {
                        try {
                            const parsed = JSON.parse(buffer.trim());
                            if (parsed.response) fullAnswer += parsed.response;
                        } catch (e) {}
                    }
                    sendSseEvent(res, 'done', {
                        fullText: fullAnswer.trim() || '답변을 생성하지 못했습니다.',
                        model: OLLAMA_MODEL
                    });
                    res.end();
                }
            });
        });

        ollamaReq.on('timeout', () => {
            if (!isFinished && !res.writableEnded) {
                isFinished = true;
                ollamaReq.destroy();
                sendSseEvent(res, 'error', { message: 'AI 비서 응답 대기 시간이 초과되었습니다.' });
                res.end();
            }
        });

        ollamaReq.on('error', (err) => {
            if (!isFinished && !res.writableEnded) {
                isFinished = true;
                sendSseEvent(res, 'error', { message: `AI 비서 연결 실패 (${err.message})` });
                res.end();
            }
        });

        ollamaReq.write(bodyStr);
        ollamaReq.end();
    } catch (err) {
        if (!isFinished && !res.writableEnded) {
            isFinished = true;
            sendSseEvent(res, 'error', { message: `스트리밍 시작 실패 (${err.message})` });
            res.end();
        }
    }
}

module.exports = {
    handleSseChatStream
};
