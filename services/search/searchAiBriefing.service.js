/**
 * ✨ JG 통합 검색 - 온디맨드 AI 한눈에 요약 서비스 (searchAiBriefing.service.js)
 * - 사용자가 '✨ AI 한눈에 요약' 버튼을 클릭했을 때만 로컬 Ollama 스트리밍 추론 실행 (서버 부하 방지)
 * - 내부 자료(권한 허용분) + 외부 검색 스니펫을 결합해 3~5줄 핵심 브리핑 생성
 * - [규칙 3-4] 민감 개인정보(전화번호·주민번호·이메일 등) 마스킹 처리 후 프롬프트 주입
 */

const { OLLAMA_HOST, getBalancedModel, getChatModel } = require('../aiModelRouter.service');
const { resolveSmartWidget } = require('./smartWidget.service');
const { searchAllInternal } = require('./internalSearch.service');
const { searchExternal } = require('./externalSearch.service');

function maskSensitiveInfo(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\b\d{6}-?[1-4]\d{6}\b/g, '[주민번호 마스킹]')
        .replace(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, '[연락처 마스킹]')
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[이메일 마스킹]');
}

function buildSearchContextText(query, smartWidget, internal, external) {
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
        }
    }

    const r = internal?.results || {};
    (r.memos || []).slice(0, 3).forEach(m => {
        lines.push(`[내 메모] ${m.title}: ${(m.content || '').slice(0, 120)}`);
    });
    (r.calendar || []).slice(0, 3).forEach(c => {
        lines.push(`[일정] ${c.event_date} ${c.title} (${c.memo || ''})`);
    });
    (r.wiki || []).slice(0, 3).forEach(w => {
        lines.push(`[가족 위키] ${w.title}: ${w.excerpt || ''}`);
    });
    (r.news || []).slice(0, 3).forEach(n => {
        lines.push(`[뉴스] ${n.title}: ${(n.summary || '').slice(0, 100)}`);
    });

    if (external?.wikipedia?.extract) {
        lines.push(`[위키백과: ${external.wikipedia.title}] ${external.wikipedia.extract}`);
    }
    (external?.naver?.encyc || []).slice(0, 2).forEach(e => {
        lines.push(`[백과] ${e.title}: ${e.description}`);
    });
    (external?.naver?.web || []).slice(0, 3).forEach(w => {
        lines.push(`[웹검색] ${w.title}: ${w.description}`);
    });
    (external?.naver?.blog || []).slice(0, 2).forEach(b => {
        lines.push(`[블로그] ${b.title}: ${b.description}`);
    });
    (external?.google?.items || []).slice(0, 3).forEach(g => {
        lines.push(`[구글] ${g.title}: ${g.description}`);
    });

    return maskSensitiveInfo(lines.join('\n')).slice(0, 3200);
}

async function streamSearchAiSummary(req, res, rawQuery) {
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
    req.on('close', () => {
        try { controller.abort(); } catch (_) {}
    });

    try {
        const [smartWidget, internal, external] = await Promise.all([
            resolveSmartWidget(q, req.user).catch(() => null),
            searchAllInternal(q, req.user).catch(() => ({ results: {} })),
            searchExternal(q, 'all').catch(() => ({}))
        ]);

        const contextText = buildSearchContextText(q, smartWidget, internal, external);
        if (!contextText) {
            sendEvent({ token: `'${q}'에 대해 참고할 내부·외부 검색 자료가 충분하지 않습니다.` });
            sendEvent({ done: true });
            return res.end();
        }

        const model = getBalancedModel() || getChatModel();
        const systemPrompt = [
            '당신은 JG 포털 통합 검색 AI 요약 비서입니다.',
            '반드시 자연스럽고 일상 친화적인 한국어로만 답변하세요.',
            '제공된 검색 결과(내부 자료 및 외부 검색 스니펫)만을 근거로 3~5줄로 핵심만 간결하게 요약하세요.',
            '중요한 키워드나 수치는 **굵게** 표시하되, 없는 사실을 지어내지 마세요.'
        ].join(' ');

        const userPrompt = `검색어: "${q}"\n\n[수집된 검색 자료]\n${contextText}\n\n위 자료를 바탕으로 사용자에게 한눈에 들어오도록 핵심을 요약해 주세요.`;

        const timeoutId = setTimeout(() => controller.abort(), 35000);
        const ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                stream: true,
                options: { temperature: 0.3, num_ctx: 4096 },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });
        clearTimeout(timeoutId);

        if (!ollamaRes.ok || !ollamaRes.body) {
            sendEvent({ error: '로컬 AI 서버가 현재 응답하지 않습니다. 잠시 후 다시 시도해 주세요.' });
            return res.end();
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n');
            buffer = parts.pop() || '';
            for (const line of parts) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    const content = parsed.message?.content || '';
                    if (content) sendEvent({ token: content });
                } catch (_) {}
            }
        }

        sendEvent({ done: true });
        res.end();
    } catch (err) {
        if (err.name !== 'AbortError') {
            sendEvent({ error: 'AI 요약 생성 중 오류가 발생했습니다.' });
        }
        if (!res.writableEnded) res.end();
    }
}

module.exports = {
    streamSearchAiSummary
};
