/**
 * ==============================================================================
 * Google Gemini REST API 단독 학습지 생성 서비스 (geminiWorksheet.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 별도 보조 워커 없이 portal 프로세스에서 직접 REST 호출
 * - Structured JSON 출력 스키마 + IPv4 강제 + 일일 할당량 제한 + 4단계 검증/폴백
 * ==============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const {
    normalizeChildId,
    normalizeSubject,
    getChildLevels,
    saveWorksheet,
    tryConsumeGeminiQuota,
    recordFallbackUsage,
    getSystemConfig
} = require('./studyDb.service');
const {
    validateAndNormalizeWorksheet,
    buildFallbackWorksheet
} = require('./worksheetValidator.service');
const { buildColoringWorksheet } = require('./playBlocks.service');

const ipv4HttpsAgent = new https.Agent({ family: 4 });

function resolveGeminiApiKey() {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        return process.env.GEMINI_API_KEY.trim();
    }
    const candidateEnvs = [
        path.join(__dirname, '..', '..', '.env'),
        path.join(__dirname, '..', '..', '..', 'news-dashboard', '.env'),
        path.join(__dirname, '..', '..', '..', 'family-wiki', '.env')
    ];
    for (const envPath of candidateEnvs) {
        try {
            if (!fs.existsSync(envPath)) continue;
            const raw = fs.readFileSync(envPath, 'utf8');
            const m = raw.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
            if (m && m[1]) {
                const cleaned = m[1].trim().replace(/^["']|["']$/g, '');
                if (cleaned) return cleaned;
            }
        } catch (e) {}
    }
    return '';
}

function postJsonIPv4(urlStr, headers, bodyObj, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(bodyObj);
        const parsed = new URL(urlStr);
        const req = https.request(
            {
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                method: 'POST',
                agent: ipv4HttpsAgent,
                timeout: timeoutMs,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    resolve({ status: res.statusCode || 500, body: raw });
                });
            }
        );
        req.on('timeout', () => {
            req.destroy(new Error('GEMINI_TIMEOUT'));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function buildGeminiPromptAndSchema({ childName, birthYear, subject, level, theme }) {
    if (subject === 'math') {
        const prompt =
            `유아 학습지 디자이너 역할입니다. 대상: ${birthYear}년생(${childName}), 테마: "${theme}", 난이도: Lv.${level}/5.\n` +
            `수학 계산과 숫자 문제는 서버가 직접 생성하므로, "${theme}" 테마에 어울리는 친근한 학습지 제목 1개와 유아 친화적인 표준 단일 유니코드 이모지 4개만 JSON으로 주세요.\n` +
            `금지어(폭력/어려운 한자어/부정적 단어)는 절대 쓰지 마세요.`;

        const schema = {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING' },
                themeEmojis: {
                    type: 'ARRAY',
                    items: { type: 'STRING' }
                }
            },
            required: ['title', 'themeEmojis']
        };
        return { prompt, schema };
    }

    const levelGuide = subject === 'english'
        ? (level === 1 ? '알파벳 대문자 A~Z 1글자 4개와 대표 뜻'
            : level <= 3 ? '3~5글자 기초 영단어 4개(예: CAT, SUN, APPLE)'
                : '5~9글자 어린이 친숙 영단어 4개')
        : (level === 1 ? '음절 1~2글자 순수 한글 단어 4개(받침 없는 쉬운 단어 위주)'
            : level <= 3 ? '2~3글자 친숙한 순수 한글 단어 4개'
                : level === 4 ? '3~4글자 받침 포함 순수 한글 단어 4개'
                    : '짧은 2어절 순수 한글 표현 4개(예: 반짝이는 별)');

    const prompt =
        `유아 학습지 교사 역할입니다. 대상: ${birthYear}년생 유아(${childName}), 과목: ${subject === 'english' ? '영어' : '한글'}, ` +
        `테마: "${theme}", 수준: Lv.${level}/5.\n` +
        `규칙:\n` +
        `1) ${levelGuide}를 생성하세요.\n` +
        `2) ${subject === 'english' ? 'word와 distractors는 반드시 순수 영문(A-Z)만 쓰고, hint에 짧은 한국어 뜻을 적으세요.' : 'word와 distractors는 반드시 순수 한글만 쓰세요(영어/숫자/특수문자 혼합 금지).'}\n` +
        `3) 각 항목의 emoji는 표준 유니코드 이모지 1개만 넣으세요.\n` +
        `4) 서로 중복되지 않는 단어 4개와, 각 단어당 오답 보기 2개(distractors)를 만드세요.`;

    const schema = {
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING' },
            items: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        word: { type: 'STRING' },
                        hint: { type: 'STRING' },
                        emoji: { type: 'STRING' },
                        distractors: {
                            type: 'ARRAY',
                            items: { type: 'STRING' }
                        }
                    },
                    required: ['word', 'hint', 'emoji', 'distractors']
                }
            }
        },
        required: ['title', 'items']
    };
    return { prompt, schema };
}

async function callGeminiStructuredJson(opts) {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return { ok: false, reason: 'missing_api_key' };

    const configuredModel = await getSystemConfig('study_gemini_model', '');
    const modelCandidates = [
        configuredModel,
        process.env.GEMINI_STUDY_MODEL,
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash',
        'gemini-3.0-flash'
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    const { prompt, schema } = buildGeminiPromptAndSchema(opts);
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.4,
            maxOutputTokens: 2800
        }
    };

    for (const modelName of modelCandidates) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
            const res = await postJsonIPv4(url, { 'x-goog-api-key': apiKey }, payload, 15000);
            if (res.status !== 200) {
                console.warn(`⚠️ [Study Gemini] ${modelName} 응답 상태 ${res.status}`);
                continue;
            }
            const parsed = JSON.parse(res.body);
            const parts = parsed?.candidates?.[0]?.content?.parts || [];
            const rawText = parts
                .filter((p) => p && typeof p.text === 'string' && !p.thought)
                .map((p) => p.text)
                .join('')
                .trim();
            if (!rawText) continue;
            const cleanedText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            const jsonObj = JSON.parse(cleanedText);
            return { ok: true, model: modelName, data: jsonObj };
        } catch (err) {
            console.warn(`⚠️ [Study Gemini] ${modelName} 호출 오류:`, err.message);
        }
    }
    return { ok: false, reason: 'gemini_request_failed' };
}

async function generateAndSaveWorksheet({ childId, subject, theme = '동물 친구', createdBy = 'web', includePlayBlock = true, coloringMode = 'auto_3' }) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    const cleanTheme = String(theme || '동물 친구').trim().slice(0, 24) || '동물 친구';

    if (subj === 'coloring') {
        const coloringSheet = buildColoringWorksheet({ theme: cleanTheme, coloringMode });
        const sheetId = await saveWorksheet({
            childId: cid,
            subject: 'coloring',
            level: 1,
            theme: cleanTheme,
            title: coloringSheet.title,
            source: 'coloring_studio',
            content: coloringSheet,
            createdBy
        });
        return {
            id: sheetId,
            childId: cid,
            subject: 'coloring',
            level: 1,
            theme: cleanTheme,
            title: coloringSheet.title,
            source: 'coloring_studio',
            content: coloringSheet
        };
    }

    const levels = await getChildLevels(cid);
    const level = levels[subj] || 1;
    const childName = cid === 'first' ? '첫째' : '둘째';
    const birthYear = cid === 'first' ? 2021 : 2022;

    let finalSheet = null;
    let sourceLabel = 'fallback';
    let lastFailureReason = '';

    const canUseGemini = await tryConsumeGeminiQuota();
    if (canUseGemini) {
        // ③ 자동 재시도 (최대 2회 시도 후 검증 통과 시 채택)
        for (let attempt = 1; attempt <= 2; attempt++) {
            const aiRes = await callGeminiStructuredJson({
                childName,
                birthYear,
                subject: subj,
                level,
                theme: cleanTheme
            });
            if (!aiRes.ok) {
                lastFailureReason = aiRes.reason;
                break;
            }
            const validated = validateAndNormalizeWorksheet(aiRes.data, {
                subject: subj,
                level,
                theme: cleanTheme,
                includePlayBlock
            });
            if (validated.ok) {
                finalSheet = validated.sheet;
                sourceLabel = `gemini:${aiRes.model}`;
                break;
            }
            lastFailureReason = validated.reason || 'validation_failed';
        }
    } else {
        lastFailureReason = 'daily_quota_exceeded';
    }

    // ③ 실패/할당량 초과/API키 미설정 시 즉시 안전 오프라인 은행 폴백
    if (!finalSheet) {
        await recordFallbackUsage();
        finalSheet = buildFallbackWorksheet({
            subject: subj,
            level,
            theme: cleanTheme,
            includePlayBlock
        });
        sourceLabel = `fallback:${lastFailureReason || 'safe_bank'}`;
    }

    const sheetId = await saveWorksheet({
        childId: cid,
        subject: subj,
        level,
        theme: cleanTheme,
        title: finalSheet.title,
        source: sourceLabel,
        content: finalSheet,
        createdBy
    });

    return {
        id: sheetId,
        childId: cid,
        subject: subj,
        level,
        theme: cleanTheme,
        title: finalSheet.title,
        source: sourceLabel,
        content: finalSheet
    };
}

module.exports = {
    resolveGeminiApiKey,
    generateAndSaveWorksheet
};
