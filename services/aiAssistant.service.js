/**
 * 🤖 JG 포털 LG EXAONE 3.5 로컬 AI 비서 서비스 (aiAssistant.service.js)
 * - 로컬 워크스테이션 PC (192.168.50.164:11434) Ollama API 내부망 연동
 * - 모델: exaone3.5:2.4b (LG AI연구원 국산 초경량 LLM)
 * - 건강 데이터 기반 스마트 데일리 브리핑 및 가족 대화형 챗봇
 * - 무장애 설계: PC 오프라인/지연 시 0.1초 만에 기본 규칙 브리핑으로 자동 폴백
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const http = require('http');

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
async function generateAiDailyBriefing({ blood, medication, weather, todayEvents = [], asset = null, userName = '가족' }, forceRefresh = false) {
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

    const systemPrompt = `당신은 대한민국 홈서버 JG 포털의 다정하고 유능한 가족 전용 AI 비서(LG EXAONE)입니다.
가족 구성원에게 다정한 한국어 경어(존댓말)로 말하세요.
주어진 건강, 날씨, 일정, 자산 데이터를 바탕으로 2~3문장 이내의 따뜻하고 실천적인 데일리 조언과 인사를 작성하세요.
답변에는 불필요한 서론이나 자기소개 없이 바로 다정한 인사와 조언만 말하세요.`;

    const userPrompt = `[상황 데이터]
- 사용자: ${userName}님
- 날씨: ${weatherText}
- 복약: ${medText}
- 혈압: ${bloodText}
- 일정: ${eventText}${assetText ? `\n- 자산: ${assetText}` : ''}

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
                num_predict: 350
            }
        }, 60000);

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

    let contextGuide = '';
    if (summaryContext) {
        const { blood, medication, hospital, memo, asset, news, system, weather, todayEvents } = summaryContext;

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
- 🌤️ 날씨: ${weatherInfo}
- 📰 시장/뉴스: ${marketNewsInfo || '정보 없음'}
- 🖥️ 서버 인프라: ${systemInfo}\n`;
    }

    const systemPrompt = `당신은 대한민국 JG 홈서버의 전용 AI 비서이자 가족 데이터 통합 분석가(LG EXAONE 3.5)입니다.
- 질문자가 가족 구성원이므로 100% 한국어로 정중하고 다정한 존댓말로 답변하세요.
- 우리 집의 자산 관리, 건강(혈압·복약·병원), 가족 일정, 메모, 뉴스 및 서버 인프라 현황 데이터를 파악하고 있습니다.
- '비공개' 또는 '관리자 전용'으로 표시된 항목에 대해서는 "해당 정보는 관리자 전용 데이터로 조회 권한이 없습니다"라고 친절히 안내하세요.
- 질문이 들어오면 위의 [실시간 통합 현황] 데이터를 적극 참조하여 명확한 수치와 함께 똑똑하고 따뜻하게 분석·브리핑해 주세요.
- 데이터에 없는 내용은 추측하지 말고 솔직하고 친절하게 안내하세요.${contextGuide}`;

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
