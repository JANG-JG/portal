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
const { pickCuratedKoreanWords, verifyKoreanDictWords } = require('./publicEduApi.service');
const { enrichWorksheetMedia } = require('./studyRichMediaApi.service');
const { buildGeminiPromptAndSchema } = require('./studyPromptBuilder.service');
const { getHeritageContextForTheme } = require('./studyHeritageNatureApi.service');

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

    let sciCtx = null;
    let publicDataContext = '';
    if (subj === 'science') {
        const { getTodayScienceContext } = require('./studyDataGoKr.service');
        sciCtx = await getTodayScienceContext().catch(() => null);
        if (sciCtx?.summaryText) {
            publicDataContext = sciCtx.summaryText;
        }
    } else if (subj === 'history') {
        const heritageList = await getHeritageContextForTheme(cleanTheme).catch(() => []);
        if (heritageList.length) {
            publicDataContext = heritageList.map((h) => `${h.keyword}(${h.provider}): ${h.fact}`).join(' / ');
        }
    }

    const canUseGemini = hasKey && lastFailureReason !== 'quota_reserved' ? await tryConsumeGeminiQuota() : false;
    if (canUseGemini) {
        const curriculumHint = getCurriculumPromptHint(subj, level);
        const curatedWords = (subj === 'korean' || subj === 'reading')
            ? await pickCuratedKoreanWords({ level, limit: 5, theme: cleanTheme }).catch(() => [])
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
                publicDataContext,
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
                partnerName,
                sciCtx
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
            partnerName,
            sciCtx
        });
        sourceLabel = skipGemini ? 'interactive_engine' : `fallback:${lastFailureReason || 'safe_bank'}`;
    }

    if (subj === 'korean' && Array.isArray(finalSheet?.blocks)) {
        const koWords = finalSheet.blocks
            .filter((b) => b && (b.type === 'quiz' || b.type === 'trace'))
            .map((b) => b.answer || b.targetWord)
            .filter(Boolean);
        await verifyKoreanDictWords(koWords, level).catch(() => ({}));
        if (!finalSheet.sourceBadge) finalSheet.sourceBadge = '📕 국립국어원 사전 · ARASAAC';
    } else if (subj === 'english' && finalSheet && !finalSheet.sourceBadge) {
        finalSheet.sourceBadge = '🔊 원어민 발음 · ARASAAC';
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
