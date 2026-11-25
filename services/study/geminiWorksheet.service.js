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
    getDailyQuotaStatus,
    getSystemConfig
} = require('./studyDb.service');
const {
    validateAndNormalizeWorksheet,
    buildFallbackWorksheet
} = require('./worksheetValidator.service');
const { buildColoringWorksheet } = require('./playBlocks.service');
const {
    isExtendedColoringMode,
    buildExtendedColoringWorksheet
} = require('./aiColoringSvg.service');
const { getCurriculumPromptHint } = require('./curriculumKorea.data');
const { pickCuratedKoreanWords } = require('./publicEduApi.service');
const { enrichWorksheetMedia } = require('./studyRichMediaApi.service');

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

function buildGeminiPromptAndSchema({ childName, partnerName = '피카츄', birthYear, subject, level, theme, curriculumHint = '', curatedWords = [] }) {
    if (subject === 'reading' || subject === 'science') {
        const isSci = subject === 'science';
        const sciOrReadHint = curriculumHint ? `\n학습 단원 및 오늘의 공공데이터 참고: ${curriculumHint}` : '';
        const prompt = isSci
            ? `유아 자연·과학 동화 작가 역할입니다. 대상: ${birthYear}년생 유아("${childName}"), 동반 친구: "${partnerName}", 주제: "${theme}", 수준: Lv.${level}/5.${sciOrReadHint}\n` +
              `참고 정보(오늘의 달 모양·날씨·우리나라 생물 등)가 있다면 주제와 자연스럽게 엮어 호기심을 키우는 5쪽 그림 동화(pages 5개, 각 1~2문장), 따라 말할 핵심 문장 1개(voiceWord), 이해 퀴즈 3개(quizzes)를 순수 유아 친화 한국어로 작성하세요.\n` +
              `중요: 각 quizzes의 answer는 반드시 본문 내용에서 답을 찾을 수 있어야 하고, choices 배열(서로 다른 3~4개 보기) 안에 정확히 포함되어야 합니다.`
            : `유아 그림 동화 작가 역할입니다. 주인공: "${childName}"과 단짝 포켓몬 "${partnerName}", 주제: "${theme}", 수준: Lv.${level}/5.${sciOrReadHint}\n` +
              `따뜻하고 재미있는 5쪽 그림 동화(pages 5개, 각 1~2문장), 따라 읽을 핵심 문장 1개(voiceWord), 독해 퀴즈 3개(quizzes)를 순수 한국어로 작성하세요.\n` +
              `중요: 각 quizzes의 answer는 반드시 본문 내용에서 답을 찾을 수 있어야 하고, choices 배열(서로 다른 3~4개 보기) 안에 정확히 포함되어야 합니다.`;
        const schema = {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING' },
                voiceWord: { type: 'STRING' },
                pages: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: { text: { type: 'STRING' }, emoji: { type: 'STRING' } },
                        required: ['text', 'emoji']
                    }
                },
                quizzes: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            prompt: { type: 'STRING' },
                            emoji: { type: 'STRING' },
                            answer: { type: 'STRING' },
                            choices: { type: 'ARRAY', items: { type: 'STRING' } }
                        },
                        required: ['prompt', 'emoji', 'answer', 'choices']
                    }
                }
            },
            required: ['title', 'voiceWord', 'pages', 'quizzes']
        };
        return { prompt, schema };
    }

    if (subject === 'math') {
        const currLine = curriculumHint ? `\n공교육 연계 단원: ${curriculumHint}` : '';
        const prompt =
            `유아 학습지 디자이너 역할입니다. 대상: ${birthYear}년생(${childName}), 테마: "${theme}", 난이도: Lv.${level}/5.${currLine}\n` +
            `수학 계산과 숫자 문제는 서버가 직접 생성하므로, "${theme}" 테마에 어울리는 친근한 학습지 제목 1개와 유아 친화적인 표준 단일 유니코드 이모지 6개만 JSON으로 주세요.\n` +
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
        ? (level === 1 ? '알파벳 대문자 A~Z 1글자 6개와 대표 뜻'
            : level <= 3 ? '3~5글자 기초 영단어 6개(예: CAT, SUN, APPLE)'
                : '5~9글자 어린이 친숙 영단어 6개')
        : (level === 1 ? '1~3글자 받침 없는 쉽고 온전한 순수 한글 낱말 6개(예: 나비, 사자, 오리, 개구리, 코끼리)'
            : level <= 3 ? '2~3글자 친숙한 순수 한글 낱말 6개'
                : level === 4 ? '3~4글자 받침 포함 순수 한글 낱말 6개'
                    : '짧은 2어절 순수 한글 표현 6개(예: 반짝이는 별)');
    const currGuide = curriculumHint ? `\n공교육 진도 기준: ${curriculumHint}` : '';
    const dictGuide = (subject === 'korean' && curatedWords.length)
        ? `\n국립국어원 사전 추천 어휘(주제에 어울리면 1~3개 적극 활용): ${curatedWords.map((w) => (w.definition ? `${w.word}(${String(w.definition).slice(0, 28)})` : w.word)).join(', ')}`
        : '';

    const prompt =
        `유아 학습지 교사 역할입니다. 대상: ${birthYear}년생 유아(${childName}), 과목: ${subject === 'english' ? '영어' : '한글'}, ` +
        `테마: "${theme}", 수준: Lv.${level}/5.${currGuide}${dictGuide}\n` +
        `규칙:\n` +
        `1) ${levelGuide}를 생성하세요. 추상적인 단어(예: 마음, 생각, 기분) 대신 그림으로 바로 알 수 있는 구체적인 동물·사물·음식·자연물을 우선 고르세요.\n` +
        `2) ${subject === 'english' ? 'word와 distractors는 반드시 순수 영문(A-Z)만 쓰고, hint에 짧은 한국어 뜻을 적으세요.' : 'word와 distractors는 반드시 순수 한글만 쓰고(영어/숫자/특수문자 금지), hint에는 정답 단어를 직접 쓰지 않은 쉬운 유아용 1문장 수수께끼 설명을 적으세요(예: "코가 길고 귀가 큰 회색 동물이에요").'}\n` +
        `3) 각 항목의 emoji는 word의 뜻을 정확히 1:1로 나타내는 표준 단일 유니코드 이모지 1개만 넣고, 6개 항목의 이모지가 서로 중복되지 않게 하세요.\n` +
        `4) 서로 중복되지 않는 단어 6개와, 각 단어당 뜻·그림이 겹치지 않는 분명히 다른 오답 보기 2개(distractors)를 만드세요.\n` +
        `5) "개구리"를 "개구"로, "코끼리"를 "코끼"로 줄이는 것처럼 낱말의 끝 글자를 절대 임의로 자르지 말고 온전한 표준어 낱말만 쓰세요.`;

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

async function callGeminiWithPromptAndSchema(prompt, schema) {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return { ok: false, reason: 'missing_api_key' };

    const configuredModel = await getSystemConfig('study_gemini_model', '');
    const modelCandidates = [
        configuredModel,
        process.env.GEMINI_STUDY_MODEL,
        'gemini-4-hydrogen',
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash'
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    for (const modelName of modelCandidates) {
        try {
            const generationConfig = {
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature: 0.4,
                maxOutputTokens: 8192
            };
            if (modelName.startsWith('gemini-4')) {
                generationConfig.thinkingConfig = { thinkingLevel: 'low' };
            }
            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig
            };
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
            const res = await postJsonIPv4(url, { 'x-goog-api-key': apiKey }, payload, 20000);
            if (res.status !== 200) {
                console.warn(`⚠️ [Study Gemini] ${modelName} 응답 상태 ${res.status}`);
                continue;
            }
            const parsed = JSON.parse(res.body);
            const candidate = parsed?.candidates?.[0];
            const finishReason = candidate?.finishReason || 'UNKNOWN';
            const parts = candidate?.content?.parts || [];
            const rawText = parts
                .filter((p) => p && typeof p.text === 'string' && !p.thought)
                .map((p) => p.text)
                .join('')
                .trim();
            if (!rawText) {
                console.warn(`⚠️ [Study Gemini] ${modelName} 빈 응답 (finishReason=${finishReason})`);
                continue;
            }
            const cleanedText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            try {
                const jsonObj = JSON.parse(cleanedText);
                return { ok: true, model: modelName, data: jsonObj };
            } catch (parseErr) {
                console.warn(`⚠️ [Study Gemini] ${modelName} JSON 파싱 실패 (finishReason=${finishReason}):`, parseErr.message);
                continue;
            }
        } catch (err) {
            console.warn(`⚠️ [Study Gemini] ${modelName} 호출 오류:`, err.message);
        }
    }
    return { ok: false, reason: 'gemini_request_failed' };
}

async function callGeminiStructuredJson(opts) {
    const { prompt, schema } = buildGeminiPromptAndSchema(opts);
    return callGeminiWithPromptAndSchema(prompt, schema);
}

async function generateWorksheetPayload({
    childId,
    subject,
    theme = '동물 친구',
    includePlayBlock = true,
    coloringMode = 'auto_3',
    customPrompt = '',
    allowFallback = true,
    reserveQuota = 0
}) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    const cleanTheme = String(theme || '동물 친구').trim().slice(0, 24) || '동물 친구';

    if (subj === 'music') {
        const pianoVoiceRaw = await getSystemConfig('study_piano_voice_enabled', '1');
        if (pianoVoiceRaw === '0') {
            const err = new Error('현재 미니 피아노·음성 말하기 기능이 잠시 꺼져 있어요.');
            err.statusCode = 403;
            throw err;
        }
    }

    if (subj === 'coloring') {
        if (String(coloringMode) === 'ai_custom') {
            const customAiRaw = await getSystemConfig('study_ai_custom_coloring_enabled', '1');
            if (customAiRaw === '0') {
                const err = new Error('현재 AI 자유 도안 만들기 기능이 잠시 꺼져 있어요.');
                err.statusCode = 403;
                throw err;
            }
        }
        if (isExtendedColoringMode(coloringMode)) {
            const levels = await getChildLevels(cid);
            const mathLevel = levels.math || 1;
            const extSheet = await buildExtendedColoringWorksheet({
                mode: coloringMode,
                theme: cleanTheme,
                mathLevel,
                customPrompt,
                childId: cid,
                callGeminiJson: String(coloringMode) === 'ai_custom'
                    ? async (p, s) => {
                        if (!resolveGeminiApiKey()) return null;
                        const canUse = await tryConsumeGeminiQuota();
                        if (!canUse) return null;
                        return callGeminiWithPromptAndSchema(p, s);
                    }
                    : null
            });
            return {
                ok: true,
                childId: cid,
                subject: 'coloring',
                level: mathLevel,
                theme: cleanTheme,
                title: extSheet.title,
                source: extSheet.sourceLabel || 'coloring_studio',
                content: extSheet
            };
        }

        const coloringSheet = buildColoringWorksheet({ theme: cleanTheme, coloringMode });
        return {
            ok: true,
            childId: cid,
            subject: 'coloring',
            level: 1,
            theme: cleanTheme,
            title: coloringSheet.title,
            source: 'coloring_studio',
            content: coloringSheet
        };
    }

    const { dbGet } = require('./studyDb.service');
    const levels = await getChildLevels(cid);
    const level = levels[subj] || (subj === 'logic' ? levels.math : levels.korean) || 1;
    const profileRow = await dbGet('SELECT display_name, birth_year FROM study_profiles WHERE id = ?', [cid]).catch(() => null);
    const partnerRow = await dbGet('SELECT pokemon_name FROM study_pokemon_pokedex WHERE child_id = ? ORDER BY is_partner DESC, id ASC LIMIT 1', [cid]).catch(() => null);
    const childName = profileRow?.display_name || (cid === 'first' ? '첫째' : '둘째');
    const birthYear = Number(profileRow?.birth_year) || (cid === 'first' ? 2021 : 2022);
    const partnerName = partnerRow?.pokemon_name || '피카츄';

    let finalSheet = null;
    let sourceLabel = 'fallback';
    let lastFailureReason = '';

    const skipGemini = subj === 'logic' || subj === 'music';
    const hasKey = !skipGemini && Boolean(resolveGeminiApiKey());
    if (!skipGemini && !hasKey && !allowFallback) {
        return { ok: false, reason: 'api_key_missing' };
    }

    if (!skipGemini && reserveQuota > 0) {
        const quota = await getDailyQuotaStatus();
        if (quota.remaining <= reserveQuota) {
            if (!allowFallback) return { ok: false, reason: 'quota_reserved' };
            lastFailureReason = 'quota_reserved';
        }
    }

    const canUseGemini = hasKey && lastFailureReason !== 'quota_reserved' ? await tryConsumeGeminiQuota() : false;
    if (canUseGemini) {
        let curriculumHint = getCurriculumPromptHint(subj, level);
        if (subj === 'science') {
            const { getTodayScienceContext } = require('./studyDataGoKr.service');
            const sciCtx = await getTodayScienceContext().catch(() => null);
            if (sciCtx?.summaryText) {
                curriculumHint = `${curriculumHint} (오늘 실제 자연 관찰 참고: ${sciCtx.summaryText})`.trim();
            }
        }
        const curatedWords = subj === 'korean'
            ? await pickCuratedKoreanWords({ level, limit: 5 }).catch(() => [])
            : [];
        for (let attempt = 1; attempt <= 3; attempt++) {
            const aiRes = await callGeminiStructuredJson({
                childName,
                partnerName,
                birthYear,
                subject: subj,
                level,
                theme: cleanTheme,
                curriculumHint,
                curatedWords
            });
            if (!aiRes.ok) {
                lastFailureReason = aiRes.reason;
                break;
            }
            const validated = validateAndNormalizeWorksheet(aiRes.data, {
                subject: subj,
                level,
                theme: cleanTheme,
                includePlayBlock,
                childName,
                partnerName
            });
            if (validated.ok) {
                finalSheet = validated.sheet;
                sourceLabel = `gemini:${aiRes.model}`;
                break;
            }
            lastFailureReason = validated.reason || 'validation_failed';
        }
    } else if (!lastFailureReason) {
        lastFailureReason = skipGemini ? 'interactive_engine' : (hasKey ? 'daily_quota_exceeded' : 'api_key_missing');
    }

    if (!finalSheet && !allowFallback) {
        return { ok: false, reason: lastFailureReason || 'gemini_unavailable' };
    }

    // ③ 실패/할당량 초과/API키 미설정 시 즉시 안전 오프라인 은행 폴백
    if (!finalSheet) {
        if (!skipGemini) await recordFallbackUsage();
        finalSheet = buildFallbackWorksheet({
            subject: subj,
            level,
            theme: cleanTheme,
            includePlayBlock,
            childName,
            partnerName
        });
        sourceLabel = skipGemini ? 'interactive_engine' : `fallback:${lastFailureReason || 'safe_bank'}`;
    }

    const { injectRecentWrongReviews } = require('./studyMissions.service');
    finalSheet = await injectRecentWrongReviews(cid, subj, finalSheet);
    finalSheet = await enrichWorksheetMedia(finalSheet, subj).catch(() => finalSheet);

    return {
        ok: true,
        childId: cid,
        subject: subj,
        level,
        theme: cleanTheme,
        title: finalSheet.title,
        source: sourceLabel,
        content: finalSheet
    };
}

async function generateAndSaveWorksheet({ childId, subject, theme = '동물 친구', createdBy = 'web', includePlayBlock = true, coloringMode = 'auto_3', customPrompt = '' }) {
    const payload = await generateWorksheetPayload({
        childId,
        subject,
        theme,
        includePlayBlock,
        coloringMode,
        customPrompt,
        allowFallback: true,
        reserveQuota: 0
    });

    const sheetId = await saveWorksheet({
        childId: payload.childId,
        subject: payload.subject,
        level: payload.level,
        theme: payload.theme,
        title: payload.title,
        source: payload.source,
        content: payload.content,
        createdBy
    });

    return {
        id: sheetId,
        childId: payload.childId,
        subject: payload.subject,
        level: payload.level,
        theme: payload.theme,
        title: payload.title,
        source: payload.source,
        content: payload.content
    };
}

module.exports = {
    resolveGeminiApiKey,
    generateWorksheetPayload,
    generateAndSaveWorksheet
};
