/**
 * ==============================================================================
 * 확장 그림 스튜디오 & AI 맞춤 도안 생성 서비스 (aiColoringSvg.service.js)
 * ------------------------------------------------------------------------------
 * - 자유 스케치북(5종 배경), 단계별 따라 그리기, 숫자/연산/한글 색칠 도안 생성
 * - AI "내가 말한 것 도안 만들기": JSON 도형 명세 -> 화이트리스트 SVG 엄격 직렬화
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | XSS/금칙어 차단
 * ==============================================================================
 */

const { BANNED_WORDS } = require('./fallbackBank.data');

function clampLevel(level) {
    const num = Number(level);
    if (!Number.isFinite(num)) return 1;
    return Math.min(5, Math.max(1, Math.round(num)));
}

const PAPER_LABELS = {
    blank: '하얀 도화지',
    grid: '반듯 모눈종이',
    lined: '줄 공책 그림장',
    night: '반짝 밤하늘 도화지',
    comic4: '4컷 만화 도화지'
};

const GUIDE_LABELS = {
    cat: '야옹 고양이 따라 그리기',
    dino: '아기 공룡 따라 그리기',
    rocket: '우주 로켓 따라 그리기',
    car: '꼬마 자동차 따라 그리기'
};

const CBN_LABELS = {
    cbn_number: '숫자 따라 색칠 (1~5)',
    cbn_math: '덧셈·뺄셈 정답 색칠',
    cbn_hangul: '한글 낱자 색칠 (가~마)'
};

function isExtendedColoringMode(mode) {
    const m = String(mode || '').trim();
    return (
        m.startsWith('free:') ||
        m === 'free' ||
        m.startsWith('guide:') ||
        m.startsWith('cbn_') ||
        m === 'ai_custom'
    );
}

function containsBanned(text) {
    const lower = String(text || '').toLowerCase();
    return BANNED_WORDS.some((w) => lower.includes(w));
}

function escAttr(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function clampNum(v, min, max, fallback = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}

/**
 * Gemini가 반환한 도형 JSON 배열을 XSS 위험 없는 순수 SVG 도안 문자열로 직렬화한다.
 */
function buildSafeSvgFromShapes(shapes, ariaTitle = '나만의 색칠 도안') {
    if (!Array.isArray(shapes) || shapes.length < 3) return '';
    const ALLOWED_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'line']);
    const parts = [];
    let partIdx = 0;

    for (const raw of shapes.slice(0, 24)) {
        const tag = String(raw?.tag || '').trim().toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) continue;

        const isOutlineOnly = Boolean(raw.outlineOnly) || tag === 'line';
        const strokeW = clampNum(raw.strokeWidth, 2, 6, 3.8);
        const fillHex = isOutlineOnly ? 'none' : '#ffffff';
        const dataAttr = isOutlineOnly ? '' : ` data-color-part="${partIdx}"`;
        let el = '';
        let countsPart = !isOutlineOnly;

        if (tag === 'path') {
            const d = String(raw.d || '').trim();
            if (!d || d.length > 600 || !/^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/.test(d)) continue;
            el = `<path${dataAttr} d="${escAttr(d)}" fill="${fillHex}" stroke="#1e293b" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`;
        } else if (tag === 'circle') {
            const cx = clampNum(raw.cx, 10, 310, 160);
            const cy = clampNum(raw.cy, 10, 210, 110);
            const r = clampNum(raw.r, 2, 95, 24);
            const dotFill = raw.solidDot ? '#1e293b' : fillHex;
            if (raw.solidDot) countsPart = false;
            el = `<circle${raw.solidDot ? '' : dataAttr} cx="${cx}" cy="${cy}" r="${r}" fill="${dotFill}" stroke="#1e293b" stroke-width="${strokeW}"/>`;
        } else if (tag === 'ellipse') {
            const cx = clampNum(raw.cx, 10, 310, 160);
            const cy = clampNum(raw.cy, 10, 210, 110);
            const rx = clampNum(raw.rx, 3, 120, 30);
            const ry = clampNum(raw.ry, 3, 95, 22);
            el = `<ellipse${dataAttr} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fillHex}" stroke="#1e293b" stroke-width="${strokeW}"/>`;
        } else if (tag === 'rect') {
            const x = clampNum(raw.x, 4, 290, 80);
            const y = clampNum(raw.y, 4, 190, 60);
            const w = clampNum(raw.width, 6, 280, 80);
            const h = clampNum(raw.height, 6, 190, 60);
            const rx = clampNum(raw.rx, 0, 40, 8);
            el = `<rect${dataAttr} x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fillHex}" stroke="#1e293b" stroke-width="${strokeW}"/>`;
        } else if (tag === 'polygon') {
            const pts = String(raw.points || '').trim();
            if (!pts || pts.length > 260 || !/^[0-9.,\s-]+$/.test(pts)) continue;
            el = `<polygon${dataAttr} points="${escAttr(pts)}" fill="${fillHex}" stroke="#1e293b" stroke-width="${strokeW}" stroke-linejoin="round"/>`;
        } else if (tag === 'line') {
            const x1 = clampNum(raw.x1, 4, 316, 100);
            const y1 = clampNum(raw.y1, 4, 216, 100);
            const x2 = clampNum(raw.x2, 4, 316, 180);
            const y2 = clampNum(raw.y2, 4, 216, 100);
            el = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1e293b" stroke-width="${strokeW}" stroke-linecap="round"/>`;
        }

        if (el) {
            if (countsPart) partIdx += 1;
            parts.push(el);
        }
    }

    if (parts.length < 3) return '';
    return `<svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="${escAttr(ariaTitle)}">${parts.join('')}</svg>`;
}

/**
 * AI 불가 시 아이 입력 키워드에 맞춘 안전한 폴백 벡터 도안을 조립한다.
 */
function buildKeywordFallbackCustomSvg(promptText) {
    const p = String(promptText || '').trim();
    if (/별|하트|왕관|공주/.test(p)) {
        return buildSafeSvgFromShapes([
            { tag: 'polygon', points: '64,174 52,72 114,114 160,40 206,114 268,72 256,174' },
            { tag: 'rect', x: 64, y: 174, width: 192, height: 22, rx: 10 },
            { tag: 'circle', cx: 160, cy: 132, r: 18 },
            { tag: 'circle', cx: 102, cy: 142, r: 12 },
            { tag: 'circle', cx: 218, cy: 142, r: 12 },
            { tag: 'polygon', points: '34,42 40,54 54,56 44,64 46,78 34,70 22,78 24,64 14,56 28,54' },
            { tag: 'polygon', points: '286,42 292,54 306,56 296,64 298,78 286,70 274,78 276,64 266,56 280,54' }
        ], p || '반짝 왕관 도안');
    }
    if (/케이크|과자|딸기|사과|아이스크림/.test(p)) {
        return buildSafeSvgFromShapes([
            { tag: 'rect', x: 76, y: 120, width: 168, height: 66, rx: 16 },
            { tag: 'rect', x: 94, y: 78, width: 132, height: 42, rx: 14 },
            { tag: 'path', d: 'M76 138 Q104 152 132 138 Q160 152 188 138 Q216 152 244 138 L244 120 L76 120 Z' },
            { tag: 'rect', x: 154, y: 42, width: 12, height: 36, rx: 4 },
            { tag: 'path', d: 'M160 18 Q172 30 160 40 Q148 30 160 18 Z' },
            { tag: 'circle', cx: 118, cy: 68, r: 10 },
            { tag: 'circle', cx: 202, cy: 68, r: 10 }
        ], p || '달콤 케이크 도안');
    }
    return buildSafeSvgFromShapes([
        { tag: 'ellipse', cx: 160, cy: 138, rx: 74, ry: 44 },
        { tag: 'circle', cx: 160, cy: 76, r: 38 },
        { tag: 'circle', cx: 122, cy: 48, r: 14 },
        { tag: 'circle', cx: 198, cy: 48, r: 14 },
        { tag: 'circle', cx: 146, cy: 70, r: 4.5, solidDot: true },
        { tag: 'circle', cx: 174, cy: 70, r: 4.5, solidDot: true },
        { tag: 'path', d: 'M148 86 Q160 96 172 86', outlineOnly: true },
        { tag: 'ellipse', cx: 118, cy: 184, rx: 22, ry: 12 },
        { tag: 'ellipse', cx: 202, cy: 184, rx: 22, ry: 12 },
        { tag: 'polygon', points: '52,58 60,72 76,74 64,84 68,100 52,92 36,100 40,84 28,74 44,72' },
        { tag: 'circle', cx: 266, cy: 74, r: 22 }
    ], p || '내가 상상한 멋진 그림');
}

function buildAiCustomColorPromptAndSchema(userIdea) {
    const cleanIdea = String(userIdea || '귀여운 강아지와 풍선').trim().slice(0, 40);
    const prompt =
        `유아용 색칠공부 도안 디자이너 역할입니다. 어린이가 "${cleanIdea}" 그림을 색칠하고 싶어합니다.\n` +
        `320x220 좌표계(x: 20~300, y: 18~202) 안에 서로 겹치지 않게 선명한 큰 도형 7~14개로 색칠 도안을 구성해 주세요.\n` +
        `규칙:\n` +
        `- tag는 path, circle, ellipse, rect, polygon, line 중 하나만 사용\n` +
        `- 눈동자만 solidDot: true, 입꼬리/수염 같은 선만 outlineOnly: true, 나머지는 모두 색칠할 수 있는 닫힌 도형\n` +
        `- 제목(title)은 귀여운 20자 이내 한국어로 작성`;

    const schema = {
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING' },
            shapes: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        tag: { type: 'STRING' },
                        d: { type: 'STRING' },
                        cx: { type: 'NUMBER' },
                        cy: { type: 'NUMBER' },
                        r: { type: 'NUMBER' },
                        rx: { type: 'NUMBER' },
                        ry: { type: 'NUMBER' },
                        x: { type: 'NUMBER' },
                        y: { type: 'NUMBER' },
                        width: { type: 'NUMBER' },
                        height: { type: 'NUMBER' },
                        points: { type: 'STRING' },
                        x1: { type: 'NUMBER' },
                        y1: { type: 'NUMBER' },
                        x2: { type: 'NUMBER' },
                        y2: { type: 'NUMBER' },
                        solidDot: { type: 'BOOLEAN' },
                        outlineOnly: { type: 'BOOLEAN' }
                    },
                    required: ['tag']
                }
            }
        },
        required: ['title', 'shapes']
    };
    return { cleanIdea, prompt, schema };
}

/**
 * 확장 그림 스튜디오(자유 스케치북, 따라 그리기, 숫자/연산 색칠, AI 도안) 워크시트 생성
 */
async function buildExtendedColoringWorksheet({
    mode,
    theme = '동물 친구',
    mathLevel = 1,
    customPrompt = '',
    callGeminiJson = null
}) {
    const m = String(mode || '').trim();
    const lv = clampLevel(mathLevel);

    if (m === 'free' || m.startsWith('free:')) {
        const paperKey = m.includes(':') ? m.split(':')[1] : 'blank';
        const paperKind = PAPER_LABELS[paperKey] ? paperKey : 'blank';
        const paperTitle = PAPER_LABELS[paperKind];
        return {
            title: `🎨 자유 스케치북 · ${paperTitle}`,
            encouragement: '상상력을 활짝 펼쳐 세상에 하나뿐인 멋진 작품을 완성했어요! 🌈',
            blocks: [{
                id: 'block-1',
                type: 'color',
                studioKind: 'free',
                paperKind,
                defaultTool: 'brush',
                templateId: `free_${paperKind}`,
                templateTitle: paperTitle,
                shapeEmoji: paperKind === 'night' ? '🌙' : '🎨',
                level: lv,
                prompt: `🎨 '${paperTitle}' 위에 무지개·네온·별가루 브러시와 대칭 그리기, 스티커로 마음껏 그려 보아요!`,
                ttsText: `${paperTitle} 자유 스케치북이에요! 좋아하는 브러시와 스티커로 마음껏 그려 보아요!`,
                ttsLang: 'ko-KR',
                hint: '✨ 브러시를 바꾸고 🪞 대칭 그리기도 켜서 멋진 그림을 만들어 보세요!'
            }]
        };
    }

    if (m.startsWith('guide:')) {
        const guideKey = m.split(':')[1] || 'cat';
        const guideId = GUIDE_LABELS[guideKey] ? guideKey : 'cat';
        const guideTitle = GUIDE_LABELS[guideId];
        return {
            title: `👣 단계별 그림 교실 · ${guideTitle}`,
            encouragement: '1단계부터 차근차근 따라 그려서 정말 멋진 그림을 완성했어요! 👏',
            blocks: [{
                id: 'block-1',
                type: 'color',
                studioKind: 'guide',
                guideId,
                defaultTool: 'brush',
                templateId: `guide_${guideId}`,
                templateTitle: guideTitle,
                shapeEmoji: '👣',
                level: lv,
                prompt: `👣 1단계부터 4단계까지 흐린 선을 따라 그리며 '${guideTitle.replace(' 따라 그리기', '')}'를 완성해 보아요!`,
                ttsText: '1단계부터 차례대로 흐린 선을 따라 그리면 귀여운 그림이 완성돼요!',
                ttsLang: 'ko-KR',
                hint: '아래 단계 버튼을 눌러 1~4단계 선을 하나씩 켜며 따라 그려 보세요!'
            }]
        };
    }

    if (m.startsWith('cbn_')) {
        const cbnKey = CBN_LABELS[m] ? m : 'cbn_number';
        const cbnType = cbnKey.replace('cbn_', '');
        const cbnTitle = CBN_LABELS[cbnKey];
        return {
            title: `🔢 ${cbnTitle}`,
            encouragement: '숫자와 색깔 약속을 끝까지 찾아서 알록달록 그림을 완성했어요! 🌟',
            blocks: [{
                id: 'block-1',
                type: 'color',
                studioKind: 'cbn',
                cbnType,
                mathLevel: lv,
                defaultTool: 'fill',
                templateId: cbnKey,
                templateTitle: cbnTitle,
                shapeEmoji: cbnType === 'math' ? '🧮' : (cbnType === 'hangul' ? '🇰🇷' : '🔢'),
                level: lv,
                prompt: cbnType === 'math'
                    ? `🧮 식의 정답에 맞는 색연필을 고른 뒤, 그림 칸을 톡톡 눌러 색칠해 보세요! (Lv.${lv})`
                    : (cbnType === 'hangul'
                        ? '🇰🇷 글자에 적힌 색연필을 고른 뒤, 같은 글자 칸을 톡톡 눌러 색칠해 보세요!'
                        : '🔢 숫자(1~5)에 맞는 색연필을 고른 뒤, 같은 숫자 칸을 톡톡 눌러 색칠해 보세요!'),
                ttsText: '색깔 약속 표를 보고 알맞은 색연필을 골라 그림 칸을 톡톡 눌러 색칠해 보아요!',
                ttsLang: 'ko-KR',
                hint: '위쪽 색깔 약속 표에서 정답에 맞는 색을 먼저 고른 다음 그림을 눌러 보세요!'
            }]
        };
    }

    // ai_custom
    const rawIdea = String(customPrompt || theme || '귀여운 고양이').trim().slice(0, 40);
    const safeIdea = (!rawIdea || containsBanned(rawIdea)) ? '무지개 아래 아기 공룡' : rawIdea;
    let customSvg = '';
    let finalTitle = `🪄 ${safeIdea}`;
    let usedAi = false;

    if (typeof callGeminiJson === 'function') {
        const { prompt, schema } = buildAiCustomColorPromptAndSchema(safeIdea);
        const aiRes = await callGeminiJson(prompt, schema).catch(() => null);
        if (aiRes && aiRes.ok && aiRes.data) {
            const candidateSvg = buildSafeSvgFromShapes(aiRes.data.shapes, safeIdea);
            if (candidateSvg) {
                customSvg = candidateSvg;
                const t = String(aiRes.data.title || '').trim();
                if (t && !containsBanned(t) && t.length <= 32) {
                    finalTitle = `🪄 ${t}`;
                }
                usedAi = true;
            }
        }
    }

    if (!customSvg) {
        customSvg = buildKeywordFallbackCustomSvg(safeIdea);
    }

    return {
        title: `${finalTitle} 색칠 도안`,
        encouragement: '상상한 그림이 도안으로 변신! 예쁜 색으로 가득 채웠어요! 🎨',
        sourceLabel: usedAi ? 'gemini:custom_svg' : 'coloring_studio:custom_fallback',
        blocks: [{
            id: 'block-1',
            type: 'color',
            studioKind: 'ai_custom',
            defaultTool: 'fill',
            templateId: 'ai_custom',
            templateTitle: safeIdea,
            customSvg,
            shapeEmoji: '🪄',
            level: lv,
            prompt: `🪄 내가 부탁한 '${safeIdea}' 도안이에요! 톡 채우기와 브러시·스티커로 꾸며 보세요.`,
            ttsText: `${safeIdea} 색칠 도안이 완성되었어요! 예쁜 색으로 칠해 보아요!`,
            ttsLang: 'ko-KR',
            hint: usedAi
                ? 'AI 선생님이 그려준 나만의 맞춤 도안이에요!'
                : '귀여운 맞춤 도안으로 준비했어요! 스티커와 무지개 브러시로도 꾸며 보세요!'
        }]
    };
}

module.exports = {
    PAPER_LABELS,
    GUIDE_LABELS,
    CBN_LABELS,
    isExtendedColoringMode,
    buildSafeSvgFromShapes,
    buildKeywordFallbackCustomSvg,
    buildExtendedColoringWorksheet
};
