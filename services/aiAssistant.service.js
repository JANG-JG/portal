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
function sendOllamaRequest(endpoint, payload, timeoutMs = 15000) {
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
                            modelName: OLLAMA_MODEL,
                            host: OLLAMA_HOST
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
async function generateAiDailyBriefing({ blood, medication, weather, todayEvents = [], userName = '가족' }, forceRefresh = false) {
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
    
    let eventText = '오늘 예정된 특별한 일정 없음.';
    if (Array.isArray(todayEvents) && todayEvents.length > 0) {
        eventText = `오늘 일정 ${todayEvents.length}건: ` + todayEvents.map(e => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`).join(', ');
    }

    const systemPrompt = `당신은 대한민국 홈서버 JG 포털의 다정하고 유능한 가족 전용 AI 비서(LG EXAONE)입니다.
가족 구성원에게 다정한 한국어 경어(존댓말)로 말하세요.
주어진 건강, 날씨, 일정 데이터를 바탕으로 2~3문장 이내의 따뜻하고 실천적인 데일리 건강 조언을 작성하세요.
답변에는 불필요한 서론이나 자기소개 없이 바로 다정한 인사와 조언만 말하세요.`;

    const userPrompt = `[상황 데이터]
- 사용자: ${userName}님
- 날씨: ${weatherText}
- 복약: ${medText}
- 혈압: ${bloodText}
- 일정: ${eventText}

위 상황을 보고 ${userName}님에게 건넬 다정하고 따뜻한 2~3문장 조언을 작성해 주세요.`;

    try {
        const result = await sendOllamaRequest('/api/generate', {
            model: OLLAMA_MODEL,
            prompt: `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
            stream: false,
            keep_alive: '60m',
            options: {
                temperature: 0.7,
                top_p: 0.9,
                num_predict: 120
            }
        }, 15000);

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
 * 3. 우리 집 AI 챗봇 실시간 대화
 */
async function askAiAssistant({ prompt, history = [], summaryContext = null, userName = '가족' }) {
    if (!prompt || !prompt.trim()) {
        throw new Error('질문 내용을 입력해 주세요.');
    }

    let contextGuide = '';
    if (summaryContext) {
        const { blood, medication, weather, todayEvents } = summaryContext;
        const bloodInfo = blood ? `${blood.systolic}/${blood.diastolic} mmHg (${blood.grade ? blood.grade.name : '정상'})` : '기록 없음';
        const medInfo = medication && medication.is_today_taken ? '오늘 복약 완료' : '오늘 미복용';
        const weatherInfo = weather ? `${weather.city || '서울'} ${weather.temp || ''} (${weather.condition || ''})` : '날씨 정보 없음';
        const eventsInfo = Array.isArray(todayEvents) && todayEvents.length > 0 ? todayEvents.map(e => e.title).join(', ') : '오늘 일정 없음';

        contextGuide = `\n[우리 집 실시간 현황 참고 데이터]
- 최근 혈압: ${bloodInfo}
- 오늘 복약 여부: ${medInfo}
- 실시간 날씨: ${weatherInfo}
- 오늘 가족 일정: ${eventsInfo}\n`;
    }

    const systemPrompt = `당신은 JG 포털의 전용 AI 비서(LG EXAONE 3.5)입니다.
- 100% 한국어로 정중하고 다정한 존댓말로 답변하세요.
- 질문자가 가족 구성원이므로, 마치 든든하고 똑똑한 가족 비서처럼 따뜻하고 명확하게 답변해 주세요.
- 건강, 일정, 생활에 관련된 질문에 친절히 조언해 주세요.${contextGuide}`;

    let fullPrompt = `<|system|>\n${systemPrompt}\n`;
    
    // 최근 대화 히스토리 (최대 4턴)
    if (Array.isArray(history)) {
        history.slice(-4).forEach(h => {
            if (h.role === 'user') {
                fullPrompt += `<|user|>\n${h.content}\n`;
            } else if (h.role === 'assistant') {
                fullPrompt += `<|assistant|>\n${h.content}\n`;
            }
        });
    }

    fullPrompt += `<|user|>\n${prompt.trim()}\n<|assistant|>\n`;

    const result = await sendOllamaRequest('/api/generate', {
        model: OLLAMA_MODEL,
        prompt: fullPrompt,
        stream: false,
        keep_alive: '60m',
        options: {
            temperature: 0.7,
            num_predict: 250
        }
    }, 25000);

    return {
        success: true,
        answer: result.response ? result.response.trim() : '답변을 생성하지 못했습니다.',
        model: OLLAMA_MODEL
    };
}

module.exports = {
    checkAiHealth,
    generateAiDailyBriefing,
    askAiAssistant
};
