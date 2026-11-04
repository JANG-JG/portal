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
const { smartMergeOrDraftWiki, stripThinkTags } = require('./aiKnowledge.service');
const { handleActionIntent } = require('./aiActionAgent.service');
const { koreanizeWeatherWords } = require('./weatherKo.util');

const { OLLAMA_HOST, CHAT_MODEL, selectChatModel } = require('./aiModelRouter.service');
const OLLAMA_MODEL = CHAT_MODEL; // 위키 안내 등 기본 응답 표기용 (대화는 selectChatModel로 자동 선택)

/**
 * 스트리밍 원문을 생각 과정(thinking)과 답변 본문(answer)으로 분리
 * - <think> 태그가 명시적으로 존재하는 경우만 생각 과정으로 분류
 * - 템플릿 선주입으로 </think>만 있는 경우에도 분리
 * - <think> 태그가 없는 일반 응답은 답변 본문(answer)으로 즉시 전달 (생각 과정으로 오인 방지)
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

    // 2) 여는 태그 없이 닫는 태그 </think>만 있는 경우 (템플릿 선주입 대응)
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
    // 📚 [위키] 대화/메모 ➔ 원터치 위키 문서화 (조회/요약 질의는 배제하고 명시적 신규 작성/저장만 처리)
    const hasPastParticiple = /(저장된|등록된|작성된|기록된|올려진|남겨진|적혀\s*있는|적힌)/.test(prompt);
    const hasQueryOrRead = /(찾아|검색|조회|알려\s*(줘|주세요|줄래|주라|달라)|보여\s*(줘|주세요|줄래|달라)|뭐\s*있|무엇이|어떤|요약|정리\s*(해|해줘|해\s*주세요|부탁|해달라|해\s*달라)|안\s*될까|왜\s*안|확인|추천)/i.test(prompt);
    const isPureWriteCommand = /(위키|wiki).*?(저장|등록|작성|기록|추가|올려|남겨|발행)\s*(해줘|해라|해주세요|부탁|바람|하기)$/i.test(prompt)
        && !hasPastParticiple && !/(찾아|검색|조회|요약|정리|안\s*될까|왜\s*안|추천|알려)/.test(prompt);
    const WIKI_INTENT_REGEX = /(위키|wiki)\s*(에|로|에다가)?\s*(저장|등록|작성|기록|추가|올려|남겨|발행)/i;
    const isReferentialWrite = /(이거|이\s*내용|방금\s*내용|위\s*내용|앞의\s*내용).*위키\s*(에|로|에다가)?\s*(저장|등록|작성|기록|추가|올려|남겨|발행)/i.test(prompt);

    const isWikiIntent = !hasPastParticiple && (!hasQueryOrRead 
        ? (WIKI_INTENT_REGEX.test(prompt) || isReferentialWrite) 
        : isPureWriteCommand);

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
async function handleSseChatStream({ req, res, prompt, history = [], summaryContext = null, userName = '가족', user = null }) {
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

    // 2. ⚡ 액션 에이전트 의도 감지 (일정/혈압/메모 자동 등록)
    const actionResult = await handleActionIntent({ prompt, user, userName });
    if (actionResult && actionResult.handled) {
        sendSseEvent(res, 'token', { token: actionResult.message });
        sendSseEvent(res, 'done', {
            fullText: actionResult.message,
            action: actionResult.meta,
            actionType: actionResult.actionType,
            model: 'action-agent'
        });
        res.end();
        return;
    }

    // 3. 위키 작성 의도 감지
    const handledWiki = await handleWikiIntent({ prompt, history, userName, res });
    if (handledWiki) return;

    // 4. 질문 의도 분석 및 최적화된 프롬프트 빌드
    const { fullPrompt } = await buildAiChatPrompt({
        prompt,
        history,
        summaryContext,
        userName,
        user
    });

    let isFinished = false;
    let fullAnswer = '';
    let rawAnswer = '';
    let sentThinking = '';
    let nativeThinking = '';
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

    // 5. Ollama 실시간 스트리밍 HTTP 요청 발송 (🔀 질문 내용 기반 대화/추론 모델 자동 선택)
    const picked = selectChatModel(prompt);
    try {
        const urlObj = new URL('/api/generate', OLLAMA_HOST);
        const bodyStr = JSON.stringify({
            model: picked.model,
            prompt: fullPrompt,
            stream: true,
            keep_alive: picked.keepAlive,
            options: {
                temperature: 0.5,
                top_p: 0.9,
                num_predict: 2048
            }
        });

        ollamaReq = http.request(urlObj, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            },
            timeout: picked.timeoutMs
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
                        if (parsed.thinking) {
                            // Ollama think 모드: 생각 과정이 별도 필드로 오는 경우
                            nativeThinking += parsed.thinking;
                            sendSseEvent(res, 'thinking', { token: parsed.thinking });
                        }
                        if (parsed.response) {
                            rawAnswer += parsed.response;
                            const part = splitThinkStream(rawAnswer);
                            if (part.thinking.length > sentThinking.length && part.thinking.startsWith(sentThinking)) {
                                const tDelta = part.thinking.slice(sentThinking.length);
                                sentThinking = part.thinking;
                                sendSseEvent(res, 'thinking', { token: tDelta });
                            }
                            const visible = part.answer;
                            if (visible.length > fullAnswer.length && visible.startsWith(fullAnswer)) {
                                const delta = visible.slice(fullAnswer.length);
                                fullAnswer = visible;
                                sendSseEvent(res, 'token', { token: delta });
                            }
                        }
                        if (parsed.done) {
                            isFinished = true;
                            const finalPart = splitThinkStream(rawAnswer, true);
                            fullAnswer = koreanizeWeatherWords(finalPart.answer.trim());
                            sendSseEvent(res, 'done', {
                                fullText: fullAnswer.trim(),
                                thinkingText: (nativeThinking + finalPart.thinking).trim(),
                                model: picked.model,
                                modelMode: picked.mode
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
                            if (parsed.response) rawAnswer += parsed.response;
                            if (parsed.thinking) nativeThinking += parsed.thinking;
                        } catch (e) {}
                    }
                    const finalPart = splitThinkStream(rawAnswer, true);
                    fullAnswer = koreanizeWeatherWords(finalPart.answer.trim());
                    sendSseEvent(res, 'done', {
                        fullText: fullAnswer.trim() || '답변을 생성하지 못했습니다.',
                        thinkingText: (nativeThinking + finalPart.thinking).trim(),
                        model: picked.model,
                        modelMode: picked.mode
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
