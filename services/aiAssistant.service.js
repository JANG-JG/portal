/**
 * 🤖 JG 포털 LG EXAONE 3.5 로컬 AI 비서 서비스 (aiAssistant.service.js)
 * - 로컬 워크스테이션 PC (192.168.50.164:11434) Ollama API 내부망 연동
 * - 모델: exaone3.5:2.4b (LG AI연구원 국산 초경량 LLM)
 * - 건강 데이터 기반 스마트 데일리 브리핑 및 가족 대화형 챗봇
 * - 무장애 설계: PC 오프라인/지연 시 0.1초 만에 기본 규칙 브리핑으로 자동 폴백
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const http = require('http');
const { searchWikiContent, createWikiPage, getWikiPageDetail, updateWikiPage } = require('./wikiSummary.service');
const { searchAlbumPhotos } = require('./albumSummary.service');
const { refineMemoToWiki, smartMergeOrDraftWiki } = require('./aiKnowledge.service');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://192.168.50.164:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

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
function sanitizeInputText(text, maxLength = 500) {
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
                        const hasModel = Array.isArray(parsed.models) && parsed.models.some(m => m.name.includes('exaone3.5'));
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
 * 2. LG EXAONE 기반 맞춤형 데일리 건강/일정 브리핑 문장 생성
 */
async function generateAiDailyBriefing({ blood, medication, weather, todayEvents = [], asset = null, wiki = null, album = null, userName = '가족' }, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedAiBriefing && (now - cachedAiBriefingTime < CACHE_TTL_MS)) {
        return cachedAiBriefing;
    }

    // 상황 데이터 텍스트 조합
    const bloodText = blood 
        ? `최근 혈압: 수축기 ${blood.systolic} / 이완기 ${blood.diastolic} mmHg (맥박 ${blood.pulse || '-'}회, ${blood.grade ? blood.grade.name : '정상'}). ${blood.is_today_measured ? '오늘 측정 완료.' : '오늘 아직 미측정.'}` 
        : '혈압 정보 없음.';
    const medText = medication && medication.is_today_taken ? '오늘 복약 완료.' : '오늘 혈압약 아직 미복용(주의 필요).';
    const weatherText = weather ? `현재 날씨: ${weather.city || '서울'} ${weather.temp || ''}, ${weather.condition || '맑음'}.` : '날씨 정보 없음.';
    const assetText = (asset && asset.totalKrw) ? `가족 총 자산: ${asset.totalKrw}` : '';
    
    let eventText = '오늘 예정된 특별한 일정 없음.';
    if (Array.isArray(todayEvents) && todayEvents.length > 0) {
        eventText = `오늘 일정 ${todayEvents.length}건: ` + todayEvents.map(e => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`).join(', ');
    }

    let wikiText = '';
    if (wiki) {
        const parts = [];
        if (wiki.proactiveTip) {
            parts.push(`오늘의 위키 추천 생활 지식: [${wiki.proactiveTip.title}] (${wiki.proactiveTip.reason})`);
        }
        if (Array.isArray(wiki.ddays) && wiki.ddays.length > 0) {
            const nearDday = wiki.ddays[0];
            parts.push(`다가오는 D-Day: ${nearDday.title} (${nearDday.dday || '예정'})`);
        }
        if (Array.isArray(wiki.todos) && wiki.todos.length > 0) {
            const pending = wiki.todos.slice(0, 2).map(t => `${t.assignee ? `[${t.assignee}] ` : ''}${t.content}`).join(', ');
            parts.push(`가족 루틴/할 일: ${pending}`);
        }
        if (parts.length > 0) wikiText = parts.join(' | ');
    }

    let albumText = '';
    if (album) {
        if (Array.isArray(album.onThisDay) && album.onThisDay.length > 0) {
            const mem = album.onThisDay[0];
            albumText = `${mem.yearsAgo}년 전 오늘 추억 사진: ${mem.author}님이 올린 '${mem.caption || mem.location || '가족 사진'}'${mem.location ? ` (${mem.location})` : ''}`;
        } else if (album.activity && album.activity.unreactedPhoto) {
            const un = album.activity.unreactedPhoto;
            albumText = `최근 사진: ${un.author}님이 올린 '${un.caption || un.location || '추억 사진'}'`;
        }
    }

    const systemPrompt = `당신은 대한민국 홈서버 JG 포털의 다정하고 유능한 가족 전용 AI 비서(LG EXAONE)입니다.
가족 구성원에게 다정한 한국어 경어(존댓말)로 말하세요.
주어진 건강, 날씨, 일정, 자산, 가족 위키(추천 생활 지식), 가족 사진첩(추억 사진) 데이터를 바탕으로 2~3문장 이내의 따뜻하고 실천적인 데일리 조언과 인사를 작성하세요.
위키 추천 생활 지식이 있다면 날씨나 상황에 맞추어 유용하게 활용할 수 있도록 다정하게 곁들여 권유하세요. 불필요한 서론 없이 바로 조언과 인사만 말하세요.`;

    const userPrompt = `[상황 데이터]
- 사용자: ${userName}님
- 날씨: ${weatherText}
- 복약: ${medText}
- 혈압: ${bloodText}
- 일정: ${eventText}${assetText ? `\n- 자산: ${assetText}` : ''}${wikiText ? `\n- 가족 위키: ${wikiText}` : ''}${albumText ? `\n- 가족 사진첩: ${albumText}` : ''}

위 상황을 보고 ${userName}님에게 건넬 다정하고 따뜻한 2~3문장 조언을 작성해 주세요.`;

    try {
        const result = await sendOllamaRequest('/api/generate', {
            model: OLLAMA_MODEL,
            prompt: `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
            stream: false,
            keep_alive: '24h',
            options: {
                temperature: 0.7,
                top_p: 0.9,
                num_predict: 250
            }
        }, 90000);

        if (result && result.response) {
            const cleanText = result.response.trim();
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
async function askAiAssistant({ prompt, history = [], summaryContext = null, userName = '가족' }) {
    const cleanPrompt = sanitizeInputText(prompt, 500);
    if (!cleanPrompt) {
        throw new Error('유효한 질문 내용을 입력해 주세요.');
    }

    // 📚 [위키 1단계] 대화/메모 ➔ 원터치 위키 문서화 (Auto-Drafting & Publishing)
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

    let contextGuide = '';
    let matchedWikiGuide = '';
    let matchedAlbumGuide = '';

    // 질문 키워드 기반 연관 위키 문서 본문 발췌 (RAG)
    try {
        const matchedPages = await searchWikiContent(cleanPrompt, 2);
        if (Array.isArray(matchedPages) && matchedPages.length > 0) {
            matchedWikiGuide = '\n\n[질문 연관 가족 위키 문서 발췌 (내용 적극 인용 가능)]\n' + 
                matchedPages.map(p => `■ [${p.category}] ${p.title}\n${p.excerpt}`).join('\n\n');
        }
    } catch (e) {
        console.warn('[AiAssistant] 위키 연관 문서 검색 오류:', e.message);
    }

    // 질문 키워드 기반 연관 가족 사진 검색 (RAG)
    try {
        const matchedPhotos = await searchAlbumPhotos(cleanPrompt, 3);
        if (Array.isArray(matchedPhotos) && matchedPhotos.length > 0) {
            matchedAlbumGuide = '\n\n[질문 연관 가족 사진첩 발췌]\n' + 
                matchedPhotos.map(p => `📷 [사진 #${p.id}] ${p.author}님 등록 (${p.takenAt})\n- 이야기: ${p.caption}${p.location ? ` | 장소: ${p.location}` : ''}${p.tags ? ` | 태그: ${p.tags}` : ''}\n- 사진 보기: ${p.url}`).join('\n\n');
        }
    } catch (e) {
        console.warn('[AiAssistant] 사진첩 연관 검색 오류:', e.message);
    }

    if (summaryContext) {
        const { blood, medication, hospital, memo, asset, news, system, weather, todayEvents, wiki, album } = summaryContext;

        // 1. 자산 관리 현황 (관리자 전용 / 비관리자는 차단)
        let assetInfo = '자산 정보 비공개 (관리자 전용 권한)';
        if (asset && asset.totalKrw) {
            const topItems = Array.isArray(asset.items) ? asset.items.slice(0, 5).map(i => `${i.name}(${i.symbol}): ${i.formattedTotal} (${i.diffPercent})`).join(', ') : '';
            assetInfo = `총 자산 평가액 ${asset.totalKrw} (보유 종목 ${asset.count || 0}개)` + (topItems ? ` | 주요 종목: ${topItems}` : '');
        }

        // 2. 건강 & 복약 & 병원 진료 (관리자 전용 / 비관리자는 차단)
        const bloodInfo = blood ? `${blood.systolic}/${blood.diastolic} mmHg (${blood.grade ? blood.grade.name : '정상'}) - ${blood.is_today_measured ? '오늘 측정 완료' : '오늘 미측정'}` : '건강 기록 비공개 (관리자 전용)';
        const medInfo = medication && medication.is_today_taken ? '오늘 복약 완료 ✅' : (medication ? '오늘 혈압약 아직 미복용 ⚠️' : '복약 정보 없음');
        let hospInfo = '예정된 진료 없음';
        if (hospital) {
            hospInfo = `다음 진료: ${hospital.displayNextVisit || '미정'} (${hospital.nextVisitDDay || 'D-Day 미정'}), 처방 잔여 약: ${hospital.remainingPills || 0}일분`;
        }

        // 3. 가족 일정 & 메모
        const eventsInfo = Array.isArray(todayEvents) && todayEvents.length > 0 
            ? todayEvents.map(e => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`).join(', ') 
            : '오늘 예정된 특별한 일정 없음';
        let memoInfo = '등록된 메모 없음';
        if (memo && Array.isArray(memo.recent) && memo.recent.length > 0) {
            memoInfo = memo.recent.map(m => `[${m.category || '일반'}] ${m.title}`).join(', ');
        }

        // 3-1. 가족 위키 (D-Day & 루틴 & 주요 문서)
        let wikiInfo = '등록된 위키 데이터 없음';
        if (wiki) {
            const wikiParts = [];
            if (Array.isArray(wiki.ddays) && wiki.ddays.length > 0) {
                wikiParts.push('중요 D-Day: ' + wiki.ddays.map(d => `${d.title}(${d.dday || d.targetDate})`).join(', '));
            }
            if (Array.isArray(wiki.todos) && wiki.todos.length > 0) {
                wikiParts.push('미완료 루틴: ' + wiki.todos.map(t => `${t.assignee ? `[${t.assignee}] ` : ''}${t.content}`).join(', '));
            }
            if (Array.isArray(wiki.pages) && wiki.pages.length > 0) {
                wikiParts.push('위키 문서: ' + wiki.pages.slice(0, 4).map(p => `[${p.category}] ${p.title}`).join(', '));
            }
            if (wikiParts.length > 0) wikiInfo = wikiParts.join(' | ');
        }

        // 3-2. 가족 사진첩 (N년 전 오늘 추억 & 활동 통계)
        let albumInfo = '등록된 사진 없음';
        if (album) {
            const albumParts = [];
            if (Array.isArray(album.onThisDay) && album.onThisDay.length > 0) {
                const mem = album.onThisDay[0];
                albumParts.push(`추억(N년 전 오늘): ${mem.yearsAgo}년 전 [${mem.author}] '${mem.caption || mem.location || '사진'}' (${mem.takenAt})`);
            }
            if (album.activity) {
                albumParts.push(`총 ${album.activity.totalPhotos}장 보관 중`);
                if (album.activity.unreactedPhoto) {
                    const un = album.activity.unreactedPhoto;
                    albumParts.push(`새 사진: [${un.author}] '${un.caption || un.location || '사진'}'`);
                }
            }
            if (albumParts.length > 0) albumInfo = albumParts.join(' | ');
        }

        // 4. 실시간 날씨 & 시장 지표 & 최신 뉴스
        const weatherInfo = weather ? `${weather.city || '서울'} ${weather.temp || ''} (${weather.condition || '맑음'}), 습도 ${weather.humidity || '-'}` : '날씨 정보 없음';
        let marketNewsInfo = '';
        if (news) {
            const m = news.market;
            const marketStr = m ? `코스피 ${m.kospi || '-'}, 코스닥 ${m.kosdaq || '-'}, 환율 ${m.usdkrw || '-'}원` : '';
            const topNews = Array.isArray(news.recommendedArticles) ? news.recommendedArticles.slice(0, 3).map(a => a.title).join(' / ') : '';
            const breaking = Array.isArray(news.breakingArticles) && news.breakingArticles.length > 0 ? `🚨 속보: ${news.breakingArticles[0].title}` : '';
            marketNewsInfo = [marketStr, breaking, topNews ? `주요 뉴스: ${topNews}` : ''].filter(Boolean).join(' | ');
        }

        // 5. 서버 듀얼 인프라 상태
        let systemInfo = '서버 정보 없음';
        if (system) {
            const pri = system.primary ? `주서버(노트9): CPU ${system.primary.cpu}, RAM ${system.primary.ram}, 디스크 ${system.primary.disk}` : '';
            const sec = system.secondary ? `보조서버(노트북): ${system.secondary.statusText || '대기'} (CPU ${system.secondary.cpu}, RAM ${system.secondary.ram})` : '';
            systemInfo = [pri, sec].filter(Boolean).join(' | ');
        }

        contextGuide = `\n[우리 집 JG 홈서버 실시간 통합 현황]
- 💰 자산 현황: ${assetInfo}
- 🩺 혈압 건강: ${bloodInfo}
- 💊 오늘 복약: ${medInfo}
- 🏥 병원/처방약: ${hospInfo}
- 📅 오늘 가족 일정: ${eventsInfo}
- 📝 가족 메모: ${memoInfo}
- 📖 가족 위키: ${wikiInfo}
- 📸 가족 사진첩: ${albumInfo}
- 🌤️ 날씨: ${weatherInfo}
- 📰 시장/뉴스: ${marketNewsInfo || '정보 없음'}
- 🖥️ 서버 인프라: ${systemInfo}\n`;
    }

    const systemPrompt = `당신은 대한민국 JG 홈서버의 전용 AI 비서이자 가족 데이터 통합 분석가(LG EXAONE 3.5)입니다.
- 질문자가 가족 구성원이므로 100% 한국어로 정중하고 다정한 존댓말로 답변하세요.
- 우리 집의 자산 관리, 건강(혈압·복약·병원), 가족 일정, 메모, 가족 위키(D-Day·할 일·생활 문서/매뉴얼/레시피 등), 가족 사진첩(추억, N년 전 오늘, 장소, 사진 검색) 및 서버 인프라 현황 데이터를 파악하고 있습니다.
- '비공개' 또는 '관리자 전용'으로 표시된 항목에 대해서는 "해당 정보는 관리자 전용 데이터로 조회 권한이 없습니다"라고 친절히 안내하세요.
- 질문이 들어오면 위의 [실시간 통합 현황] 및 발췌 자료를 적극 참조하여 명확하고 정확하게 분석·안내해 주세요.
- 위키 문서 질문은 발췌된 위키 본문을 바탕으로 답변하세요.
- 가족 사진이나 과거 추억, 여행, 촬영 장소 등에 대해 물어보면 [질문 연관 가족 사진첩 발췌]를 참조하여 사진 정보(날짜, 장소, 내용)와 함께 사진 링크를 친절히 안내하세요.
- 데이터에 없는 내용은 추측하지 말고 솔직하고 친절하게 안내하세요.${contextGuide}${matchedWikiGuide}${matchedAlbumGuide}`;

    let fullPrompt = `<|system|>\n${systemPrompt}\n`;
    
    // 최근 대화 히스토리 (최대 4턴, 특수 토큰 정제)
    if (Array.isArray(history)) {
        history.slice(-4).forEach(h => {
            const safeRole = (h && h.role === 'assistant') ? 'assistant' : 'user';
            const safeContent = sanitizeInputText(h ? h.content : '', 500);
            if (safeContent) {
                fullPrompt += `<|${safeRole}|>\n${safeContent}\n`;
            }
        });
    }

    fullPrompt += `<|user|>\n${cleanPrompt}\n<|assistant|>\n`;

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
