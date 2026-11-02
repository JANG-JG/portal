/**
 * 🤖 JG 포털 지식 관리 및 위키/루틴 AI 서비스 (aiKnowledge.service.js)
 * - 로컬 워크스테이션 PC (192.168.50.164:11434) Ollama LG EXAONE 3.5 모델 연동
 * - 메모 ➔ 위키 정돈, 루틴/일정 자동 감지, 3줄 요약, 위키 초안 자동 작성
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://192.168.50.164:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';

/**
 * Ollama 서버에 HTTP POST 요청을 보내는 경량 헬퍼
 */
function sendOllamaRequest(endpoint, payload, timeoutMs = 60000) {
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
function sanitizeInputText(text, maxLength = 2000) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text.replace(/<\|[a-zA-Z0-9_\-:]+\|>/g, '');
    return cleaned.slice(0, maxLength).trim();
}

/**
 * 헬퍼: AI 응답 텍스트에서 안전하게 JSON 객체 추출
 */
function extractJsonFromText(rawText) {
    if (!rawText) return null;
    try {
        return JSON.parse(rawText.trim());
    } catch (_) {
        const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
            try { return JSON.parse(codeBlockMatch[1].trim()); } catch (__) {}
        }
        const curlyMatch = rawText.match(/\{[\s\S]*\}/);
        if (curlyMatch) {
            try { return JSON.parse(curlyMatch[0].trim()); } catch (___) {}
        }
    }
    return null;
}

/**
 * 1. 메모 ➔ 가족 위키용 마크다운 문서 자동 정돈
 */
async function refineMemoToWiki({ title = '', content = '', userName = '가족' }) {
    const cleanTitle = sanitizeInputText(title, 200);
    const cleanContent = sanitizeInputText(content.replace(/<[^>]+>/g, ' '), 2000);
    if (!cleanContent) {
        throw new Error('정리할 메모 내용이 없습니다.');
    }

    const systemPrompt = `당신은 대한민국 홈서버 JG 포털의 지식 정리 AI(LG EXAONE)입니다.
사용자의 날것의 메모를 체계적이고 가독성 높은 가족 위키(Family Wiki) 마크다운 문서로 변환하세요.
출력은 반드시 다른 설명 없이 순수한 JSON 형식으로만 작성하세요.
JSON 필드:
- "title": 잘 다듬어진 명확한 문서 제목 (예: [가전 매뉴얼] 보일러 에러 03 조치법)
- "category": 추천 카테고리 중 택1 ('생활', '가전설비', '복약처방', '레시피', '차량정비', '계약금융', '아이들', '여행', '기타')
- "slug": URL용 한글/영문 식별자 (특수문자 제외, 공백은 하이픈)
- "content_md": 위키용 정돈된 마크다운 본문 (개요, 핵심 지침, 주의사항 등을 이모지와 함께 구성)`;

    const userPrompt = `[작성자]: ${userName}\n[메모 제목]: ${cleanTitle || '(제목 없음)'}\n[메모 본문]:\n${cleanContent}\n\n위 메모를 가족 위키에 영구 보관할 수 있도록 체계적인 마크다운 문서 JSON으로 정돈해 주세요.`;

    const fullPrompt = `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`;

    let raw = '';
    let parsed = null;
    try {
        const result = await sendOllamaRequest('/api/generate', {
            model: OLLAMA_MODEL,
            prompt: fullPrompt,
            stream: false,
            keep_alive: '24h',
            options: { temperature: 0.3, num_predict: 1200 }
        }, 60000);

        raw = result && result.response ? result.response.trim() : '';
        parsed = extractJsonFromText(raw);
    } catch (ollamaErr) {
        console.warn('⚠️ [RefineMemoToWiki] Ollama 생성 실패, 규칙 기반 마크다운 자동 생성으로 폴백:', ollamaErr.message);
    }

    if (parsed && parsed.title && parsed.content_md) {
        return {
            success: true,
            title: parsed.title,
            category: parsed.category || '생활',
            slug: (parsed.slug || parsed.title).replace(/[^a-zA-Z0-9가-힣\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50),
            content_md: parsed.content_md,
            model: OLLAMA_MODEL
        };
    }

    return {
        success: true,
        title: cleanTitle ? `[위키] ${cleanTitle}` : '새 가족 위키 문서',
        category: '생활',
        slug: `memo-${Date.now().toString(36)}`,
        content_md: `## 개요\n\n${raw || cleanContent}\n\n---\n*작성자: ${userName}*`,
        model: OLLAMA_MODEL
    };
}

/**
 * 2. 메모에서 루틴 주기 및 할 일(일정) 자동 감지
 */
async function extractRoutineAndTodos({ title = '', content = '' }) {
    const cleanContent = sanitizeInputText((title ? `${title}\n` : '') + content.replace(/<[^>]+>/g, ' '), 1500);
    if (!cleanContent) {
        throw new Error('분석할 메모 내용이 없습니다.');
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const systemPrompt = `당신은 일정 및 생활 루틴 분석 AI(LG EXAONE)입니다.
메모 본문에서 정기적인 반복 루틴(주기 포함)이나 향후 수행해야 할 특정 일정/할 일을 찾아내세요.
오늘 날짜는 ${todayStr}입니다.
출력은 반드시 다른 설명 없이 순수한 JSON 형식으로만 작성하세요.
JSON 필드:
- "hasRoutine": 주기적 반복 작업이 있으면 true, 없으면 false
- "routineTitle": 루틴 제목 (예: "정수기 세디먼트 필터 교체")
- "cycleDays": 반복 일수 (예: 120, 30, 7 등. 없으면 0)
- "cycleText": 주기 설명 (예: "4개월마다", "매달 25일", "매주 토요일")
- "targetDate": 다음 예정일 (YYYY-MM-DD 형식. 추산 가능할 경우)
- "hasTodo": 특정 할 일이 있으면 true, 없으면 false
- "todoText": 구체적인 할 일 내용 (예: "세디먼트 필터 온라인 주문")
- "summary": 분석 요약 1줄`;

    const userPrompt = `[분석할 메모]\n${cleanContent}\n\n위 내용에서 주기적인 루틴이나 챙겨야 할 일정을 분석하여 JSON으로 반환하세요.`;
    const fullPrompt = `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`;

    const result = await sendOllamaRequest('/api/generate', {
        model: OLLAMA_MODEL,
        prompt: fullPrompt,
        stream: false,
        keep_alive: '24h',
        options: { temperature: 0.2, num_predict: 600 }
    }, 45000);

    const raw = result && result.response ? result.response.trim() : '';
    const parsed = extractJsonFromText(raw);

    if (parsed) {
        return { success: true, data: parsed, model: OLLAMA_MODEL };
    }

    return {
        success: true,
        data: {
            hasRoutine: false,
            routineTitle: '',
            cycleDays: 0,
            cycleText: '',
            targetDate: todayStr,
            hasTodo: true,
            todoText: cleanContent.slice(0, 50),
            summary: '자동 감지된 일정입니다.'
        },
        model: OLLAMA_MODEL
    };
}

/**
 * 3. 임의 텍스트 3줄 핵심 요약
 */
async function summarizeText({ text = '', maxLines = 3 }) {
    const cleanText = sanitizeInputText(text.replace(/<[^>]+>/g, ' '), 3000);
    if (!cleanText || cleanText.length < 20) {
        throw new Error('요약할 텍스트가 너무 짧습니다.');
    }

    const systemPrompt = `당신은 문서 핵심 요약 AI(LG EXAONE)입니다.
주어진 글을 읽고 가장 핵심적인 지침이나 내용을 ${maxLines}개의 불릿 포인트(- )로 간결하게 요약하세요.
인사말이나 서론 없이 불릿 포인트 요약문만 출력하세요.`;

    const userPrompt = `[원문]\n${cleanText}\n\n위 글의 핵심 내용을 ${maxLines}줄로 명확하게 요약해 주세요.`;
    const fullPrompt = `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`;

    const result = await sendOllamaRequest('/api/generate', {
        model: OLLAMA_MODEL,
        prompt: fullPrompt,
        stream: false,
        keep_alive: '24h',
        options: { temperature: 0.3, num_predict: 400 }
    }, 45000);

    return {
        success: true,
        summary: result && result.response ? result.response.trim() : '요약문을 생성하지 못했습니다.',
        model: OLLAMA_MODEL
    };
}

/**
 * 4. 프롬프트 기반 위키 마크다운 초안 자동 작성
 */
async function generateWikiDraft({ prompt = '', category = '생활' }) {
    const cleanPrompt = sanitizeInputText(prompt, 300);
    if (!cleanPrompt) {
        throw new Error('작성할 주제를 입력해 주세요.');
    }

    const systemPrompt = `당신은 가족 위키 문서 작성 전문 AI(LG EXAONE)입니다.
주어진 주제에 대해 가족들이 실생활에서 바로 유용하게 참고할 수 있는 체계적인 마크다운 위키 초안을 작성하세요.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "명확하고 친절한 문서 제목",
  "category": "${category}",
  "content_md": "마크다운 형식의 본문 (## 개요, ## 단계별 절차 또는 준비물, ## 주의사항 및 꿀팁 등 구성)"
}`;

    const userPrompt = `[작성 주제]: ${cleanPrompt}\n[카테고리]: ${category}\n\n위 주제로 알기 쉬운 가족 위키 문서 초안을 JSON으로 작성해 주세요.`;
    const fullPrompt = `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`;

    const result = await sendOllamaRequest('/api/generate', {
        model: OLLAMA_MODEL,
        prompt: fullPrompt,
        stream: false,
        keep_alive: '24h',
        options: { temperature: 0.5, num_predict: 1500 }
    }, 60000);

    const raw = result && result.response ? result.response.trim() : '';
    const parsed = extractJsonFromText(raw);

    if (parsed && parsed.title && parsed.content_md) {
        return {
            success: true,
            title: parsed.title,
            category: parsed.category || category,
            content_md: parsed.content_md,
            model: OLLAMA_MODEL
        };
    }

    return {
        success: true,
        title: cleanPrompt,
        category: category,
        content_md: `## 개요\n\n${raw || cleanPrompt}에 대한 위키 문서입니다.\n\n## 상세 내용\n\n- 내용을 작성해 주세요.`,
        model: OLLAMA_MODEL
    };
}

/**
 * 5. 📚 [위키 2단계] 기존 문서 지능형 자동 병합 (Living Document)
 * - 기존 유사 문서가 있는 경우 기존 내용을 온전히 유지하며 새 정보를 적절한 섹션에 자연스럽게 보강(merge)
 * - 새로운 주제인 경우 신규 문서 생성(create)
 */
async function smartMergeOrDraftWiki({ newContent = '', newTitle = '', candidateDoc = null, userName = '가족' }) {
    const cleanContent = sanitizeInputText(newContent.replace(/<[^>]+>/g, ' '), 2000);
    if (!cleanContent) {
        throw new Error('정리할 내용이 없습니다.');
    }

    if (!candidateDoc || !candidateDoc.content_md) {
        const drafted = await refineMemoToWiki({ title: newTitle, content: cleanContent, userName });
        return { action: 'create', ...drafted };
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const systemPrompt = `당신은 대한민국 홈서버 JG 포털의 지식 통합 AI(LG EXAONE)입니다.
새로운 내용이 [기존 위키 후보 문서]와 직접적으로 관련된 내용(추가 꿀팁, 교체/점검 이력, 절차 보강, 새로운 정보 등)인지 판별하세요.
- 관련이 있다면: "action": "merge"로 설정하고, 기존 문서의 유용한 서식과 내용을 100% 보존하면서 새 내용을 알맞은 섹션(또는 날짜별 이력 섹션)에 자연스럽게 누적 보강한 마크다운을 작성하세요.
- 관련이 없는 완전히 새로운 주제라면: "action": "create"로 설정하고 신규 위키 문서 마크다운을 작성하세요.
반드시 다른 설명 없이 순수한 JSON 형식으로만 응답하세요:
{
  "action": "merge" 또는 "create",
  "title": "문서 제목",
  "category": "추천 카테고리",
  "slug": "${candidateDoc.slug}",
  "content_md": "최종 마크다운 본문",
  "merge_summary": "보강된 핵심 내용 1줄 요약 (create인 경우 빈 문자열)"
}`;

    const userPrompt = `[기존 위키 후보 문서]
- 제목: ${candidateDoc.title} (카테고리: ${candidateDoc.category || '생활'})
- 슬러그: ${candidateDoc.slug}
- 기존 본문:
${candidateDoc.content_md.slice(0, 1200)}

[새로 들어온 정보 (작성자: ${userName}, 날짜: ${todayStr})]
- 제목 제안: ${newTitle || '(없음)'}
- 내용:
${cleanContent}

위 정보를 바탕으로 기존 문서에 병합(merge)할지, 신규 작성(create)할지 판단하여 JSON으로 응답하세요.`;

    const fullPrompt = `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`;

    let raw = '';
    let parsed = null;
    try {
        const result = await sendOllamaRequest('/api/generate', {
            model: OLLAMA_MODEL,
            prompt: fullPrompt,
            stream: false,
            keep_alive: '24h',
            options: { temperature: 0.3, num_predict: 1500 }
        }, 60000);

        raw = result && result.response ? result.response.trim() : '';
        parsed = extractJsonFromText(raw);
    } catch (ollamaErr) {
        console.warn('⚠️ [SmartMerge] Ollama 병합 추론 실패, 규칙 기반 병합으로 폴백:', ollamaErr.message);
    }

    if (parsed && parsed.content_md) {
        const action = (parsed.action === 'merge' || parsed.action === 'create') ? parsed.action : 'merge';
        return {
            success: true,
            action,
            title: parsed.title || candidateDoc.title,
            category: parsed.category || candidateDoc.category || '생활',
            slug: (action === 'merge') ? candidateDoc.slug : (parsed.slug || candidateDoc.slug),
            content_md: parsed.content_md,
            merge_summary: parsed.merge_summary || `${todayStr} 내용 추가 보강`,
            model: OLLAMA_MODEL
        };
    }

    const appendSection = `\n\n---\n### 📝 추가 기록 (${todayStr})\n- ${cleanContent}\n*(기록: ${userName})*`;
    return {
        success: true,
        action: 'merge',
        title: candidateDoc.title,
        category: candidateDoc.category || '생활',
        slug: candidateDoc.slug,
        content_md: candidateDoc.content_md + appendSection,
        merge_summary: `${todayStr} 추가 내용 누적 보강`,
        model: OLLAMA_MODEL
    };
}

module.exports = {
    refineMemoToWiki,
    extractRoutineAndTodos,
    summarizeText,
    generateWikiDraft,
    smartMergeOrDraftWiki
};
