/**
 * ✨ JG 통합 검색 - 개인정보 격리형 하이브리드 AI 한눈에 요약 서비스 (searchAiBriefing.service.js)
 * - 일반 공개 검색: Google Gemini Flash-Lite SSE 스트리밍 (공개 웹·백과·뉴스·날씨·지도만 전송, ~1초)
 * - 내부 전용 검색(내 메모·일정·가족위키·건강·자산) 및 폴백: 경량 로컬 Ollama 1B 모델 (외부 전송 0%)
 * - [규칙 3-4] 민감 개인정보 마스킹 + 내부 데이터 외부 API 물리적 격리
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { resolveSmartWidget } = require('./smartWidget.service');
const { searchAllInternal } = require('./internalSearch.service');
const { searchExternal, isEngineEnabled, incrementUsage } = require('./externalSearch.service');
const { OLLAMA_HOST, getChatModel } = require('../aiModelRouter.service');

const ipv4HttpsAgent = new https.Agent({ family: 4 });

const CONTEXT_CACHE_TTL_MS = 3 * 60 * 1000;
const SUMMARY_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ITEMS = 80;

const searchContextCache = new Map();
const publicSummaryCache = new Map();

const GEMINI_SUMMARY_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash'
];

const INTERNAL_ONLY_TABS = new Set(['internal', 'memoCalendar', 'album', 'healthAsset']);
const PRIVATE_QUERY_REGEX = /(내\s*(메모|일정|혈압|약|복약|자산|계좌|앨범)|우리\s*(집|가족|위키|병원)|가족\s*일정)/i;

function resolveGeminiKey() {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        return process.env.GEMINI_API_KEY.trim();
    }
    const candidateEnvs = [
        path.join(__dirname, '..', '..', '.env'),
        path.join(__dirname, '..', '..', '..', 'news-dashboard', '.env')
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
        } catch (_) {}
    }
    return '';
}

function hasGeminiKey() {
    return Boolean(resolveGeminiKey());
}

function maskSensitiveInfo(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\b\d{6}-?[1-4]\d{6}\b/g, '[주민번호 마스킹]')
        .replace(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, '[연락처 마스킹]')
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[이메일 마스킹]');
}

function setBoundedCache(map, key, value) {
    if (map.size >= MAX_CACHE_ITEMS) {
        const oldestKey = map.keys().next().value;
        if (oldestKey !== undefined) map.delete(oldestKey);
    }
    map.set(key, value);
}

function cacheSearchContext(userId, query, payload) {
    const q = String(query || '').trim().toLowerCase();
    if (!userId || !q || !payload) return;
    setBoundedCache(searchContextCache, `${userId}::${q}`, {
        ts: Date.now(),
        smartWidget: payload.smartWidget || null,
        internal: payload.internal || { total: 0, results: {} },
        external: payload.external || {}
    });
}

function getCachedSearchContext(userId, query) {
    const key = `${userId}::${String(query || '').trim().toLowerCase()}`;
    const hit = searchContextCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CONTEXT_CACHE_TTL_MS) {
        searchContextCache.delete(key);
        return null;
    }
    return hit;
}

function clearAiSummaryCache() {
    const count = searchContextCache.size + publicSummaryCache.size;
    searchContextCache.clear();
    publicSummaryCache.clear();
    return count;
}

/**
 * 100% 공개 자료만 수집 (내부 개인 데이터는 절대 포함하지 않음)
 */
function buildPublicContextText(smartWidget, external, maxLen = 2200) {
    const lines = [];

    if (smartWidget && smartWidget.data) {
        if (smartWidget.type === 'weather') {
            const w = smartWidget.data;
            lines.push(`[날씨] ${w.city}: ${w.condition}, 기온 ${w.temp}, 체감 ${w.feels_like || '-'}, 습도 ${w.humidity || '-'}, 미세먼지 ${w.pm10_grade || '-'}`);
        } else if (smartWidget.type === 'exchange') {
            const ex = smartWidget.data;
            lines.push(`[환율] ${ex.amount} ${ex.currency} = ${ex.convertedKrw}원 (기준: ${ex.ratePerUnit}원)`);
        } else if (smartWidget.type === 'calculator') {
            lines.push(`[계산] ${smartWidget.data.expression} = ${smartWidget.data.result}`);
        } else if (smartWidget.type === 'unit') {
            lines.push(`[단위변환] ${smartWidget.data.from} = ${smartWidget.data.to}`);
        } else if (smartWidget.type === 'map' && Array.isArray(smartWidget.data.places)) {
            smartWidget.data.places.slice(0, 3).forEach((p) => {
                lines.push(`[장소] ${p.name} (${p.category || ''}): ${p.address || ''}`);
            });
        }
    }

    if (external?.wikipedia?.extract) {
        lines.push(`[위키백과: ${external.wikipedia.title}] ${external.wikipedia.extract}`);
    }
    (external?.naver?.encyc || []).slice(0, 2).forEach((e) => {
        lines.push(`[백과] ${e.title}: ${e.description}`);
    });
    (external?.naver?.web || []).slice(0, 3).forEach((w) => {
        lines.push(`[웹검색] ${w.title}: ${w.description}`);
    });
    (external?.naver?.blog || []).slice(0, 2).forEach((b) => {
        lines.push(`[블로그] ${b.title}: ${b.description}`);
    });
    (external?.naver?.news || []).slice(0, 2).forEach((n) => {
        lines.push(`[뉴스] ${n.title}: ${n.description || ''}`);
    });
    (external?.google?.items || []).slice(0, 3).forEach((g) => {
        lines.push(`[구글] ${g.title}: ${g.description}`);
    });

    return maskSensitiveInfo(lines.join('\n')).slice(0, maxLen).trim();
}

/**
 * 내부 개인 자료 전용 컨텍스트 (로컬 Ollama 전용)
 */
function buildInternalContextText(internal, maxLen = 900) {
    const lines = [];
    const r = internal?.results || {};
    (r.memos || []).slice(0, 3).forEach((m) => {
        lines.push(`[내 메모] ${m.title}: ${(m.content || '').slice(0, 110)}`);
    });
    (r.calendar || []).slice(0, 3).forEach((c) => {
        lines.push(`[일정] ${c.event_date} ${c.title} (${(c.memo || '').slice(0, 60)})`);
    });
    (r.wiki || []).slice(0, 2).forEach((w) => {
        lines.push(`[가족 위키] ${w.title}: ${(w.excerpt || '').slice(0, 100)}`);
    });
    (r.news || []).slice(0, 2).forEach((n) => {
        lines.push(`[뉴스] ${n.title}: ${(n.summary || '').slice(0, 90)}`);
    });
    (r.hospitals || []).slice(0, 2).forEach((h) => {
        lines.push(`[병원] ${h.name || h.hospital_name || ''}: ${(h.memo || h.diagnosis || '').slice(0, 80)}`);
    });
    (r.medications || []).slice(0, 2).forEach((m) => {
        lines.push(`[복약] ${m.name || m.med_name || ''}: ${(m.dosage || '').slice(0, 60)}`);
    });
    (r.assets || []).slice(0, 2).forEach((a) => {
        lines.push(`[자산] ${a.symbol || ''} ${a.full_name || ''}`);
    });

    return maskSensitiveInfo(lines.join('\n')).slice(0, maxLen).trim();
}

function buildPrompts(query, contextText, isLocal) {
    const systemPrompt = [
        '당신은 JG 포털 통합 검색 AI 요약 비서입니다.',
        '반드시 자연스럽고 일상 친화적인 한국어로만 답변하세요.',
        '제공된 검색 자료만을 근거로 3~5줄로 핵심만 간결하게 요약하세요.',
        '중요한 키워드나 수치는 **굵게** 표시하되, 없는 사실을 지어내지 마세요.'
    ].join(' ');
    const scopeHint = isLocal ? '[내부·통합 검색 자료]' : '[공개 웹·백과 검색 자료]';
    const userPrompt = `검색어: "${query}"\n\n${scopeHint}\n${contextText}\n\n위 자료를 바탕으로 사용자에게 한눈에 들어오도록 핵심을 요약해 주세요.`;
    return { systemPrompt, userPrompt };
}

function streamGeminiModelSse(apiKey, modelName, systemPrompt, userPrompt, signal, onToken) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('ABORTED'));

        const payload = JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 450
            }
        });

        const urlPath = `/v1beta/models/${encodeURIComponent(modelName)}:streamGenerateContent?alt=sse`;
        let settled = false;
        let sseBuffer = '';
        let fullText = '';

        const finishErr = (err) => {
            if (settled) return;
            settled = true;
            reject(err);
        };

        const req = https.request(
            {
                hostname: 'generativelanguage.googleapis.com',
                path: urlPath,
                method: 'POST',
                agent: ipv4HttpsAgent,
                timeout: 12000,
                headers: {
                    'x-goog-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            },
            (apiRes) => {
                if (apiRes.statusCode !== 200) {
                    let errBody = '';
                    apiRes.on('data', (c) => { errBody += c; });
                    apiRes.on('end', () => finishErr(new Error(`GEMINI_HTTP_${apiRes.statusCode}:${errBody.slice(0, 120)}`)));
                    return;
                }

                apiRes.setEncoding('utf8');
                apiRes.on('data', (chunk) => {
                    sseBuffer += chunk;
                    const lines = sseBuffer.split('\n');
                    sseBuffer = lines.pop() || '';
                    for (const rawLine of lines) {
                        const line = rawLine.trim();
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr || dataStr === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(dataStr);
                            const parts = parsed?.candidates?.[0]?.content?.parts || [];
                            for (const part of parts) {
                                if (part && typeof part.text === 'string' && !part.thought && part.text) {
                                    fullText += part.text;
                                    onToken(part.text);
                                }
                            }
                        } catch (_) {}
                    }
                });
                apiRes.on('end', () => {
                    if (settled) return;
                    settled = true;
                    if (!fullText.trim()) return reject(new Error('GEMINI_EMPTY'));
                    resolve(fullText);
                });
                apiRes.on('error', finishErr);
            }
        );

        const onAbort = () => {
            try { req.destroy(new Error('ABORTED')); } catch (_) {}
            finishErr(new Error('ABORTED'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        req.on('timeout', () => {
            req.destroy(new Error('GEMINI_TIMEOUT'));
        });
        req.on('error', finishErr);
        req.write(payload);
        req.end();
    });
}

async function tryGeminiStream(query, publicContext, internalSkippedCount, signal, sendEvent) {
    const apiKey = resolveGeminiKey();
    if (!apiKey) return { ok: false, reason: 'no_key' };

    const cacheKey = query.toLowerCase();
    const cached = publicSummaryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SUMMARY_CACHE_TTL_MS) {
        sendEvent({ meta: { mode: 'cloud', cached: true, internalSkippedCount } });
        sendEvent({ token: cached.text });
        return { ok: true };
    }

    const { systemPrompt, userPrompt } = buildPrompts(query, publicContext, false);

    for (const modelName of GEMINI_SUMMARY_MODELS) {
        let emittedAny = false;
        try {
            sendEvent({ meta: { mode: 'cloud', model: modelName, internalSkippedCount } });
            const text = await streamGeminiModelSse(apiKey, modelName, systemPrompt, userPrompt, signal, (tok) => {
                emittedAny = true;
                sendEvent({ token: tok });
            });
            setBoundedCache(publicSummaryCache, cacheKey, { ts: Date.now(), text });
            incrementUsage('geminiSummary', false).catch(() => {});
            return { ok: true };
        } catch (err) {
            if (signal.aborted || err.message === 'ABORTED') return { ok: false, aborted: true };
            console.warn(`[Search AI Gemini] ${modelName} 실패:`, err.message);
            if (emittedAny) {
                incrementUsage('geminiSummary', true).catch(() => {});
                return { ok: false, partial: true };
            }
        }
    }

    incrementUsage('geminiSummary', true).catch(() => {});
    return { ok: false, reason: 'all_models_failed' };
}

async function streamLocalOllamaSummary(query, contextText, signal, onToken) {
    if (!contextText || signal?.aborted) return { ok: false, aborted: Boolean(signal?.aborted) };
    const modelName = getChatModel() || 'gemma3:1b';
    const { systemPrompt, userPrompt } = buildPrompts(query, contextText, true);

    const localCtrl = new AbortController();
    const onParentAbort = () => localCtrl.abort();
    if (signal) signal.addEventListener('abort', onParentAbort, { once: true });
    const timeoutId = setTimeout(() => localCtrl.abort(), 20000);

    let fullText = '';
    try {
        const res = await fetch(new URL('/api/chat', OLLAMA_HOST), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: localCtrl.signal,
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                stream: true,
                think: false,
                keep_alive: '15m',
                options: { temperature: 0.3, num_ctx: 2048, num_predict: 320 }
            })
        });
        if (!res.ok || !res.body) return { ok: false, model: modelName };

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    const tok = parsed?.message?.content;
                    if (tok) {
                        fullText += tok;
                        onToken(tok);
                    }
                } catch (_) {}
            }
        }
        return { ok: Boolean(fullText.trim()), partial: Boolean(fullText), model: modelName };
    } catch (err) {
        if (signal?.aborted) return { ok: false, aborted: true, model: modelName };
        console.warn(`[Search AI Ollama] ${modelName} 실패 (즉시 요약 폴백):`, err.message);
        return { ok: false, partial: Boolean(fullText), model: modelName };
    } finally {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onParentAbort);
    }
}

function buildInstantInternalSummary(query, ctx) {
    const lines = [];
    const w = ctx?.smartWidget;
    if (w && w.data) {
        if (w.type === 'weather') {
            lines.push(`- **날씨**: ${w.data.city} ${w.data.condition}, 기온 **${w.data.temp}** (습도 ${w.data.humidity || '-'})`);
        } else if (w.type === 'exchange') {
            lines.push(`- **환율**: ${w.data.amount} ${w.data.currency} = **${w.data.convertedKrw}원**`);
        } else if (w.type === 'calculator') {
            lines.push(`- **계산**: ${w.data.expression} = **${w.data.result}**`);
        }
    }

    const r = ctx?.internal?.results || {};
    const addSection = (label, arr, formatter) => {
        if (!Array.isArray(arr) || arr.length === 0) return;
        const preview = arr.slice(0, 2).map(formatter).filter(Boolean).join(' / ');
        if (preview) lines.push(`- **${label} (${arr.length}건)**: ${preview}`);
    };

    addSection('내 메모', r.memos, (m) => `**${m.title}**${m.content ? ` (${String(m.content).slice(0, 45).trim()})` : ''}`);
    addSection('일정', r.calendar, (c) => `${c.event_date || ''} **${c.title}**`.trim());
    addSection('가족 위키', r.wiki, (wk) => `**${wk.title}**`);
    addSection('뉴스', r.news, (n) => `**${n.title}**`);
    addSection('병원', r.hospitals, (h) => `**${h.name || h.hospital_name || ''}**`);
    addSection('약', r.medications, (m) => `**${m.name || m.med_name || ''}**`);
    addSection('자산', r.assets, (a) => `**${a.symbol || ''} ${a.full_name || ''}**`.trim());
    if (Array.isArray(r.album) && r.album.length > 0) {
        lines.push(`- **사진첩**: 관련 사진 **${r.album.length}장**`);
    }
    if (Array.isArray(r.kindergarten) && r.kindergarten.length > 0) {
        lines.push(`- **알림장**: 관련 기록 **${r.kindergarten.length}건**`);
    }

    if (lines.length === 0) {
        const ext = ctx?.external || {};
        if (ext.wikipedia?.extract) {
            lines.push(`- **백과**: ${String(ext.wikipedia.extract).slice(0, 140).trim()}...`);
        }
        (ext.naver?.items || []).slice(0, 2).forEach((n) => {
            lines.push(`- **${n.title}**: ${String(n.description || '').slice(0, 90).trim()}`);
        });
        (ext.google?.items || []).slice(0, 2).forEach((g) => {
            lines.push(`- **${g.title}**: ${String(g.description || '').slice(0, 90).trim()}`);
        });
    }

    if (lines.length === 0) return '';
    return `'${query}' 검색 결과 핵심을 바로 정리해 드렸어요.\n\n${lines.join('\n')}`;
}

async function streamSearchAiSummary(req, res, rawQuery, activeTab = 'all') {
    const q = (rawQuery || '').trim().slice(0, 120);
    if (!q) {
        return res.status(400).json({ success: false, message: '검색어가 필요합니다.' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (payload) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
    };

    const controller = new AbortController();
    controller.signal._abortCtrl = controller;
    req.on('close', () => {
        try { controller.abort(); } catch (_) {}
    });

    try {
        const userId = req.user?.username || 'admin';
        let ctx = getCachedSearchContext(userId, q);
        if (!ctx) {
            const [smartWidget, internal, external] = await Promise.all([
                resolveSmartWidget(q, req.user).catch(() => null),
                searchAllInternal(q, req.user).catch(() => ({ total: 0, results: {} })),
                searchExternal(q, 'all').catch(() => ({}))
            ]);
            ctx = { smartWidget, internal, external };
            cacheSearchContext(userId, q, ctx);
        }

        const publicContext = buildPublicContextText(ctx.smartWidget, ctx.external);
        const internalContext = buildInternalContextText(ctx.internal);
        const internalTotal = Number(ctx.internal?.total || 0);

        if (!publicContext && !internalContext) {
            sendEvent({ token: `'${q}'에 대해 참고할 내부·외부 검색 자료가 충분하지 않습니다.` });
            sendEvent({ done: true });
            return res.end();
        }

        const geminiEnabled = await isEngineEnabled('geminiSummary');
        const isPrivateTab = INTERNAL_ONLY_TABS.has(String(activeTab || 'all'));
        const isPrivateQuery = PRIVATE_QUERY_REGEX.test(q) && Boolean(internalContext);
        const canUseCloud = geminiEnabled && hasGeminiKey() && Boolean(publicContext) && !isPrivateTab && !isPrivateQuery;

        let fallbackFromCloud = false;
        if (canUseCloud) {
            const cloudRes = await tryGeminiStream(q, publicContext, internalTotal, controller.signal, sendEvent);
            if (cloudRes.aborted) {
                if (!res.writableEnded) res.end();
                return;
            }
            if (cloudRes.ok || cloudRes.partial) {
                sendEvent({ done: true });
                return res.end();
            }
            fallbackFromCloud = true;
        }

        const localContext = [internalContext, publicContext].filter(Boolean).join('\n\n').slice(0, 1200);
        if (localContext) {
            let sentMeta = false;
            const localRes = await streamLocalOllamaSummary(q, localContext, controller.signal, (tok) => {
                if (!sentMeta) {
                    sentMeta = true;
                    sendEvent({ meta: { mode: 'local', model: getChatModel() || 'gemma3:1b', internalTotal, fallbackFromCloud } });
                }
                sendEvent({ token: tok });
            });
            if (localRes.aborted) {
                if (!res.writableEnded) res.end();
                return;
            }
            if (localRes.ok || localRes.partial) {
                sendEvent({ done: true });
                return res.end();
            }
        }

        // 로컬 Ollama 오프라인/타임아웃 시 즉시 구조화 요약으로 안전 폴백
        const instantText = buildInstantInternalSummary(q, ctx);
        sendEvent({ meta: { mode: 'instant', internalTotal, fallbackFromCloud } });
        sendEvent({
            token: instantText || `'${q}'에 대해 요약할 검색 결과가 충분하지 않습니다.`
        });
        sendEvent({ done: true });
        res.end();
    } catch (err) {
        if (err.name !== 'AbortError' && err.message !== 'ABORTED') {
            sendEvent({ error: 'AI 요약 생성 중 오류가 발생했습니다.' });
        }
        if (!res.writableEnded) res.end();
    }
}

module.exports = {
    streamSearchAiSummary,
    cacheSearchContext,
    clearAiSummaryCache,
    hasGeminiKey
};
