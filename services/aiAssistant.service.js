/**
 * 🤖 JG 포털 LG EXAONE 4.0 로컬 AI 비서 서비스 (aiAssistant.service.js)
 * - 로컬 워크스테이션 PC (192.168.50.164:11434) Ollama API 내부망 연동
 * - 모델: exaone4:opt (LG AI연구원 국산 초경량 LLM EXAONE 4.0 1.2B)
 * - 건강 데이터 기반 스마트 데일리 브리핑 및 가족 대화형 챗봇
 * - 무장애 설계: PC 오프라인/지연 시 0.1초 만에 기본 규칙 브리핑으로 자동 폴백
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const http = require('http');
const { searchWikiContent, createWikiPage, getWikiPageDetail, updateWikiPage } = require('./wikiSummary.service');
const { searchAlbumPhotos } = require('./albumSummary.service');
const { refineMemoToWiki, smartMergeOrDraftWiki, stripThinkTags } = require('./aiKnowledge.service');
const { describeFeelKo, koreanizeWeatherWords } = require('./weatherKo.util');
const { handleActionIntent } = require('./aiActionAgent.service');
const { buildAiChatPrompt } = require('./aiContextRouter.service');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://192.168.50.164:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone4:opt';

// 브리핑 캐시 (1시간 유효, 데이터 변경 시 자동 갱신)
let cachedAiBriefing = null;
let cachedAiBriefingTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

/**
 * Ollama 서버에 HTTP POST 요청을 보내는 경량 헬퍼 (의존성 제로)
 */
function sendOllamaRequest(endpoint, payload, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(endpoint, OLLAMA_HOST);
            const bodyStr = JSON.stringify(payload);

            const req = http.request(urlObj, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr)
                },
                timeout: timeoutMs
            }, (res) => {
                let rawData = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { rawData += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(rawData);
                            if (parsed && typeof parsed.response === 'string') parsed.response = stripThinkTags(parsed.response);
                            resolve(parsed);
                        } catch (e) {
                            reject(new Error('응답 JSON 파싱 실패'));
                        }
                    } else {
                        reject(new Error(`Ollama 오류 상태 코드: ${res.statusCode}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Ollama 요청 시간 초과'));
            });

            req.on('error', err => reject(err));
            req.write(bodyStr);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * 🛡️ [보안 강화] 프롬프트 템플릿 탈취 및 제어 문자 인젝션 방어 유틸리티
 */
function sanitizeInputText(text, maxLength = 1000) {
    if (!text || typeof text !== 'string') return '';
    // 모델 템플릿 제어 토큰 (<|system|>, <|user|>, <|assistant|>, <|end_of_turn|> 등) 제거
    const cleaned = text.replace(/<\|[a-zA-Z0-9_\-:]+\|>/g, '');
    return cleaned.slice(0, maxLength).trim();
}

/**
 * 1. 로컬 AI 엔진 헬스체크
 */
async function checkAiHealth() {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL('/api/tags', OLLAMA_HOST);
            const req = http.get(urlObj, { timeout: 1500 }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const modelBase = OLLAMA_MODEL.split(':')[0];
                        const hasModel = Array.isArray(parsed.models) && parsed.models.some(m => m.name === OLLAMA_MODEL || m.name === `${OLLAMA_MODEL}:latest` || (OLLAMA_MODEL.indexOf(':') === -1 && m.name.split(':')[0] === modelBase));
                        resolve({
                            online: true,
                            modelReady: hasModel,
                            modelName: OLLAMA_MODEL
                        });
                    } catch (e) {
                        resolve({ online: false, error: 'JSON 응답 오류' });
                    }
                });
            });
            req.on('timeout', () => { req.destroy(); resolve({ online: false, error: '타임아웃' }); });
            req.on('error', () => resolve({ online: false, error: '연결 실패' }));
        } catch (e) {
            resolve({ online: false, error: e.message });
        }
    });
}

/**
 * D-Day 항목에서 오늘 기준 남은 일수 계산 (당일: 0, 내일: 1, ...)
 */
function parseDDayDiff(ddayItem) {
    if (!ddayItem) return null;
    if (ddayItem.targetDate || ddayItem.target_date) {
        const dateStr = (ddayItem.targetDate || ddayItem.target_date).slice(0, 10);
        const target = new Date(dateStr + 'T00:00:00+09:00');
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        const today = new Date(todayStr + 'T00:00:00+09:00');
        if (!isNaN(target.getTime()) && !isNaN(today.getTime())) {
            return Math.round((target - today) / (1000 * 60 * 60 * 24));
        }
    }
    const dStr = String(ddayItem.dday || '').trim();
    if (dStr === 'D-Day' || dStr === 'D-0') return 0;
    const m = /^D-(\d+)$/.exec(dStr);
    if (m) return parseInt(m[1], 10);
    return null;
}

/**
 * 브리핑 말투 후처리: '님아/님님' 호칭 정리 + 질문형(?) 문장 제거 (평서문만 남김, 전부 질문이면 null)
 */
function polishBriefingTone(text) {
    let t = String(text || '')
        .replace(/님\s*님/g, '님')
        .replace(/님아(?=[\s,.!~]|$)/g, '님')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const sentences = t.split(/(?<=[.!?？。])\s+/);
    const kept = sentences.map(s => s.trim()).filter(s => s && !/[?？]$/.test(s));
    t = kept.join(' ').trim();
    return t.length >= 10 ? t : null;
}

/**
 * 2. LG EXAONE 기반 오늘 맞춤형 데일리 건강/일정 조언 문장 생성
 * - [원칙] 먼 미래 D-Day 원천 배제, 오늘 당일(D-Day) 및 3일 이내 초임박 일정만 엄선
 * - [원칙] 자산/사진첩 등 잡음 제거, 사용자의 '오늘 하루'에 꼭 필요한 핵심 1~2가지만 간결 조언
 */
async function generateAiDailyBriefing({ blood, medication, weather, todayEvents = [], asset = null, wiki = null, album = null, userName = '가족' }, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedAiBriefing && (now - cachedAiBriefingTime < CACHE_TTL_MS)) {
        return cachedAiBriefing;
    }

    // 1) 오늘 건강 상태 (복약 & 혈압)
    const bloodText = blood 
        ? `${blood.systolic}/${blood.diastolic} mmHg (${blood.grade ? blood.grade.name : '정상'}), ${blood.is_today_measured ? '오늘 측정 완료 ✅' : '오늘 아직 미측정 ⚠️'}` 
        : '혈압 기록 없음';
    const medText = medication && medication.is_today_taken 
        ? '오늘 약 복용 완료 ✅' 
        : '오늘 혈압약 아직 안 챙겨드심(복용 필요 ⚠️)';

    // 2) 오늘 날씨 & 외출 주의사항
    const feelKo = weather ? describeFeelKo(weather.feels_like || weather.temp) : '';
    const weatherText = weather 
        ? `${weather.city || '계룡'} ${weather.temp || ''}, ${weather.condition || '맑음'}${feelKo ? `, 체감 ${feelKo}` : ''}` 
        : '';

    // 3) 오늘 당일 캘린더 일정 (오늘 일정이 있는 경우만)
    let eventText = '';
    if (Array.isArray(todayEvents) && todayEvents.length > 0) {
        eventText = todayEvents.map(e => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`).join(', ');
    }

    // 4) D-Day 엄격 필터링: 오직 오늘 당일(D-Day) 또는 3일 이내 초임박 일정만 허용 (먼 D-Day 완전 배제)
    let nearDdayText = '';
    if (wiki && Array.isArray(wiki.ddays)) {
        const urgentDdays = [];
        for (const item of wiki.ddays) {
            const diff = parseDDayDiff(item);
            if (diff === null) continue;
            if (diff === 0) {
                urgentDdays.push(`오늘이 [${item.title}] D-Day 당일입니다`);
            } else if (diff === 1) {
                urgentDdays.push(`내일이 [${item.title}] (D-1)입니다`);
            } else if (diff >= 2 && diff <= 3) {
                urgentDdays.push(`[${item.title}] 일정이 D-${diff}일 남았습니다`);
            }
            // 4일 이상 남은 먼 D-Day나 이미 지난 D+ 일정은 절대 포함하지 않음!
        }
        if (urgentDdays.length > 0) {
            nearDdayText = urgentDdays.slice(0, 2).join(', ');
        }
    }

    // 5) 날씨 맞춤형 위키 생활 팁 (선택적)
    let tipText = '';
    if (wiki && wiki.proactiveTip && wiki.proactiveTip.title) {
        tipText = `[${wiki.proactiveTip.title}] ${wiki.proactiveTip.reason || ''}`;
    }

    // 상황 데이터 조합 (자산, 사진첩 등 산만한 잡음 정보 완전 배제하고 '오늘'에만 집중)
    const situationLines = [`- 사용자: ${userName}님`];
    if (weatherText) situationLines.push(`- 오늘 날씨: ${weatherText}`);
    situationLines.push(`- 오늘 복약: ${medText}`);
    situationLines.push(`- 오늘 혈압: ${bloodText}`);
    if (eventText) situationLines.push(`- 오늘 일정: ${eventText}`);
    if (nearDdayText) situationLines.push(`- 임박 디데이: ${nearDdayText}`);
    if (tipText) situationLines.push(`- 오늘 생활 팁: ${tipText}`);

    // 상황 텍스트 조립 (데이터가 없을 때를 대비한 기본값 처리)
    const situationText = situationLines.length > 0 
        ? situationLines.join('\n') 
        : '- 특이 일정 없음, 평온한 하루';

    const systemPrompt = `당신은 가족 구성원의 오늘 하루를 챙겨주는 다정한 알림 작성기입니다.
주어진 [오늘 상황]을 보고, 가장 중요한 1~2가지만 골라 따뜻한 1~2문장의 조언을 만드세요.

[작성 규칙]
1. 반드시 "${userName}님,"으로 시작하세요.
2. 서론이나 로봇 같은 인사 없이, 오늘 챙겨야 할 행동(외출, 복약, 일정 등)을 바로 말하세요.
3. 모든 문장은 다정한 존댓말('~세요', '~해요') 평서문으로 끝내세요.

[작성 예시]
상황:
- 날씨: 영하 3도, 맑음
- 오늘 일정: 오전 회의
조언:
${userName}님, 오늘은 아침 기온이 영하로 떨어져 쌀쌀하니 따뜻한 외투 꼭 챙겨 입으시고 오전 회의도 편안하게 잘 마치세요.

상황:
- 오늘 생활 팁: 혈압약 복용 확인
- 임박 디데이: D-Day 가족 식사
조언:
${userName}님, 오늘 잊지 마시고 아침 약 꼭 챙겨 드시고, 저녁 가족 식사도 즐겁고 편안한 시간 보내세요.

상황:
- 오늘 일정: 없음
- 오늘 생활 팁: 환기 권장
조언:
${userName}님, 특별한 일정 없이 여유로운 하루인 만큼 가볍게 환기 한 번 하시고 편안하고 기분 좋은 하루 보내세요.`;

    const userPrompt = `[오늘 상황]
${situationText}

[조언]:`;

    try {
        const result = await sendOllamaRequest('/api/generate', {
            model: OLLAMA_MODEL,
            prompt: `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
            stream: false,
            keep_alive: '24h',
            options: {
                temperature: 0.5,
                top_p: 0.9,
                // EXAONE 4.0은 <think> 생각 과정이 토큰을 먼저 소모하므로 250 → 1024로 확대 (브리핑 잘림 방지)
                num_predict: 1024
            }
        }, 90000);

        if (result && result.response) {
            let cleanText = koreanizeWeatherWords(result.response.trim());
            // 토큰 상한 도달로 문장 중간에서 끊긴 경우: 마지막 완결 문장까지만 사용 (없으면 기본 브리핑 폴백)
            if (result.done_reason === 'length') {
                const lastEnd = Math.max(cleanText.lastIndexOf('.'), cleanText.lastIndexOf('!'), cleanText.lastIndexOf('?'), cleanText.lastIndexOf('요'));
                if (lastEnd < 10) return null;
                cleanText = cleanText.slice(0, lastEnd + 1).trim();
            }
            // 말투 정리: '님아' 호칭 교정 + 질문형 문장 제거 (전부 질문이면 기본 브리핑 폴백)
            cleanText = polishBriefingTone(cleanText);
            if (!cleanText) return null;
            cachedAiBriefing = {
                success: true,
                message: cleanText,
                generatedAt: new Date().toISOString(),
                model: OLLAMA_MODEL
            };
            cachedAiBriefingTime = now;
            return cachedAiBriefing;
        }
    } catch (err) {
        console.warn('[AiAssistant] 로컬 AI 브리핑 생성 실패 (폴백 사용):', err.message);
    }

    return null;
}

/**
 * 3. 우리 집 AI 챗봇 실시간 대화 (전체 서브 서비스 통합 분석가)
 */
async function askAiAssistant({ prompt, history = [], summaryContext = null, userName = '가족', user = null }) {
    const cleanPrompt = sanitizeInputText(prompt, 1000);
    if (!cleanPrompt) throw new Error('유효한 질문 내용을 입력해 주세요.');

    // ⚡ [액션 에이전트] 자연어 액션 의도 감지 (일정/혈압/메모 등록)
    const actionResult = await handleActionIntent({ prompt: cleanPrompt, user, userName });
    if (actionResult && actionResult.handled) {
        return {
            success: true,
            answer: actionResult.message,
            action: actionResult.meta,
            actionType: actionResult.actionType,
            model: 'action-agent'
        };
    }

    // 📚 [위키] 대화/메모 ➔ 원터치 위키 문서화
    const WIKI_INTENT_REGEX = /(위키|wiki)\s*(에|로|에다가)?\s*(저장|등록|작성|기록|추가|올려|남겨|만들어|정리|발행)/i;
    const isWikiIntent = WIKI_INTENT_REGEX.test(cleanPrompt) || /(이거|이\s*내용|방금\s*내용|위\s*내용|앞의\s*내용).*위키/i.test(cleanPrompt);

    if (isWikiIntent) {
        try {
            let targetContent = '';
            let targetTitle = '';

            // 1) 사용자가 직접 프롬프트에 내용을 적은 경우 (의도어 제거 후 15자 이상이면 직접 내용으로 채택)
            const strippedIntent = cleanPrompt.replace(WIKI_INTENT_REGEX, '').trim();
            if (strippedIntent.length >= 15) {
                targetContent = strippedIntent;
                targetTitle = strippedIntent.split(/[\n,.]/)[0].slice(0, 30).trim();
            } else if (Array.isArray(history) && history.length > 0) {
                // 2) 직전 대화(AI 답변 등)를 위키로 저장하려는 경우
                const lastAssistantMsg = [...history].reverse().find(h => h && h.role === 'assistant' && h.content);
                const lastUserMsg = [...history].reverse().find(h => h && h.role === 'user' && h.content && !WIKI_INTENT_REGEX.test(h.content));
                if (lastAssistantMsg) {
                    targetContent = lastAssistantMsg.content;
                    if (lastUserMsg) {
                        targetTitle = lastUserMsg.content.slice(0, 30);
                    }
                }
            }

            if (!targetContent || targetContent.length < 5) {
                return {
                    success: true,
                    answer: '어떤 내용을 가족 위키에 저장할까요? 위키로 보관하고 싶은 레시피, 생활 팁, 가전 사용법 등을 말씀해 주시면 알기 쉽게 마크다운 문서로 정리하여 바로 등록해 드릴게요! 😊',
                    model: OLLAMA_MODEL
                };
            }

            // 📚 [위키 2단계] 기존 연관 문서 탐색 및 지능형 병합 (Living Document)
            let candidateDoc = null;
            const searchKeyword = targetTitle || targetContent.slice(0, 80);
            try {
                const candidates = await searchWikiContent(searchKeyword, 1);
                if (Array.isArray(candidates) && candidates.length > 0 && candidates[0].slug) {
                    candidateDoc = await getWikiPageDetail(candidates[0].slug);
                }
            } catch (searchErr) {
                console.warn('[AiAssistant] 기존 위키 문서 탐색 실패 (신규 작성으로 진행):', searchErr.message);
            }

            // AI 기반 지능형 병합 또는 신규 초안 작성
            const processed = await smartMergeOrDraftWiki({
                newContent: targetContent,
                newTitle: targetTitle,
                candidateDoc,
                userName
            });

            if (processed.action === 'merge' && candidateDoc) {
                // 기존 문서 내용 갱신 (Living Wiki)
                const updateRes = await updateWikiPage({
                    slug: candidateDoc.slug,
                    content_md: processed.content_md,
                    title: processed.title,
                    category: processed.category,
                    change_summary: processed.merge_summary || 'AI 지능형 보강',
                    author: userName || '가족'
                });

                const verText = updateRes.version ? ` (v${updateRes.version})` : '';
                return {
                    success: true,
                    answer: `가족 위키 문서 **[${processed.category}] ${processed.title}${verText}**에 새로운 내용을 누적 보강했습니다! 🔄\n\n- **보강 요약**: ${processed.merge_summary || '최신 정보 업데이트'}\n- **문서 제목**: ${processed.title}\n\n👉 [**위키 문서 바로가기**](${updateRes.view_url || `/wiki/${candidateDoc.slug}`})`,
                    action: 'wiki_merged',
                    wiki: {
                        slug: candidateDoc.slug,
                        title: processed.title,
                        category: processed.category,
                        view_url: updateRes.view_url || `/wiki/${candidateDoc.slug}`
                    },
                    model: OLLAMA_MODEL
                };
            }

            // 신규 문서 등록 (새로운 주제)
            const saveRes = await createWikiPage({
                category: processed.category || '생활',
                title: processed.title,
                content_md: processed.content_md,
                slug: processed.slug
            });

            return {
                success: true,
                answer: `가족 위키에 **[${saveRes.category || processed.category}] ${saveRes.title || processed.title}** 문서를 성공적으로 등록했습니다! 📚\n\n- **카테고리**: ${saveRes.category || processed.category}\n- **문서 제목**: ${saveRes.title || processed.title}\n\n👉 [**위키 문서 바로가기**](${saveRes.view_url || `/wiki/${saveRes.slug}`})`,
                action: 'wiki_published',
                wiki: {
                    id: saveRes.id,
                    title: saveRes.title || processed.title,
                    category: saveRes.category || processed.category,
                    slug: saveRes.slug || processed.slug,
                    view_url: saveRes.view_url || `/wiki/${saveRes.slug}`
                },
                model: OLLAMA_MODEL
            };
        } catch (wikiErr) {
            console.error('[AiAssistant] 위키 문서 자동 처리 실패:', wikiErr);
            return {
                success: true,
                answer: `위키 문서 처리 중 오류가 발생했습니다 (${wikiErr.message}). 잠시 후 다시 시도해 주세요.`,
                model: OLLAMA_MODEL
            };
        }
    }

    // 질문 의도 기반 최적화 프롬프트 및 타깃 RAG 빌드
    const { fullPrompt } = await buildAiChatPrompt({
        prompt: cleanPrompt,
        history,
        summaryContext,
        userName
    });

    const result = await sendOllamaRequest('/api/generate', {
        model: OLLAMA_MODEL,
        prompt: fullPrompt,
        stream: false,
        keep_alive: '24h',
        options: {
            temperature: 0.7,
            num_predict: 2048
        }
    }, 120000);

    return {
        success: true,
        answer: result.response ? result.response.trim() : '답변을 생성하지 못했습니다.',
        model: OLLAMA_MODEL
    };
}

const knowledgeService = require('./aiKnowledge.service');

module.exports = {
    checkAiHealth,
    generateAiDailyBriefing,
    askAiAssistant,
    ...knowledgeService
};
