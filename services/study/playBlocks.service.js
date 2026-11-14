/**
 * ==============================================================================
 * 유아 학습지 놀이형 블록(점잇기·미로·색칠하기) 서버 생성 엔진 (playBlocks.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 한국어 & 검증된 해결 가능 구조 보장
 * [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

function clampLevel(level) {
    const n = Number(level);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 1;
}

const KOREAN_ORDER = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'];
const KOREAN_JAMO_ORDER = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ'];
const ENGLISH_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

const DOT_TEMPLATES = [
    {
        shapeId: 'star',
        shapeName: '반짝 별님',
        shapeEmoji: '⭐',
        fillColor: '#fde047',
        themes: ['space', 'princess', 'animal'],
        points: [
            { x: 160, y: 20 }, { x: 192, y: 82 }, { x: 262, y: 92 }, { x: 210, y: 138 },
            { x: 224, y: 204 }, { x: 160, y: 172 }, { x: 96, y: 204 }, { x: 110, y: 138 },
            { x: 58, y: 92 }, { x: 128, y: 82 }
        ]
    },
    {
        shapeId: 'heart',
        shapeName: '사랑 하트',
        shapeEmoji: '💖',
        fillColor: '#f9a8d4',
        themes: ['princess', 'fruit', 'animal'],
        points: [
            { x: 160, y: 66 }, { x: 210, y: 28 }, { x: 266, y: 58 }, { x: 262, y: 122 },
            { x: 160, y: 200 }, { x: 58, y: 122 }, { x: 54, y: 58 }, { x: 110, y: 28 }
        ]
    },
    {
        shapeId: 'house',
        shapeName: '포근한 집',
        shapeEmoji: '🏠',
        fillColor: '#fdba74',
        themes: ['animal', 'vehicle', 'fruit'],
        points: [
            { x: 160, y: 24 }, { x: 262, y: 100 }, { x: 238, y: 100 }, { x: 238, y: 196 },
            { x: 82, y: 196 }, { x: 82, y: 100 }, { x: 58, y: 100 }
        ]
    },
    {
        shapeId: 'rocket',
        shapeName: '우주 로켓',
        shapeEmoji: '🚀',
        fillColor: '#93c5fd',
        themes: ['space', 'robot', 'vehicle'],
        points: [
            { x: 160, y: 18 }, { x: 208, y: 78 }, { x: 208, y: 158 }, { x: 248, y: 194 },
            { x: 184, y: 176 }, { x: 136, y: 176 }, { x: 72, y: 194 }, { x: 112, y: 158 },
            { x: 112, y: 78 }
        ]
    },
    {
        shapeId: 'crown',
        shapeName: '보석 왕관',
        shapeEmoji: '👑',
        fillColor: '#fcd34d',
        themes: ['princess', 'dino', 'animal'],
        points: [
            { x: 64, y: 182 }, { x: 52, y: 66 }, { x: 114, y: 116 }, { x: 160, y: 42 },
            { x: 206, y: 116 }, { x: 268, y: 66 }, { x: 256, y: 182 }
        ]
    },
    {
        shapeId: 'fish',
        shapeName: '헤엄 물고기',
        shapeEmoji: '🐠',
        fillColor: '#67e8f9',
        themes: ['ocean', 'animal'],
        points: [
            { x: 66, y: 112 }, { x: 120, y: 46 }, { x: 196, y: 46 }, { x: 242, y: 106 },
            { x: 278, y: 68 }, { x: 278, y: 156 }, { x: 242, y: 118 }, { x: 196, y: 178 },
            { x: 120, y: 178 }
        ]
    }
];

const COLOR_TEMPLATES = [
    { templateId: 'dino', templateTitle: '아기 공룡', shapeEmoji: '🦕', themes: ['dino'] },
    { templateId: 'rocket', templateTitle: '우주 로켓', shapeEmoji: '🚀', themes: ['space'] },
    { templateId: 'princess_crown', templateTitle: '반짝 왕관', shapeEmoji: '👑', themes: ['princess'] },
    { templateId: 'car', templateTitle: '꼬마 자동차', shapeEmoji: '🚗', themes: ['vehicle'] },
    { templateId: 'whale', templateTitle: '아기 고래', shapeEmoji: '🐳', themes: ['ocean'] },
    { templateId: 'robot', templateTitle: '멋진 로봇', shapeEmoji: '🤖', themes: ['robot'] },
    { templateId: 'cat', templateTitle: '야옹 고양이', shapeEmoji: '🐱', themes: ['animal', 'fruit'] }
];

const OBSTACLE_ICONS = ['🌲', '🪨', '☁️', '🌊', '🌷'];

function resolveThemeCategory(theme = '') {
    const t = String(theme || '').toLowerCase();
    if (/공주|티니|핑|요정|왕관|하트|마법|벨|엘사/.test(t)) return 'princess';
    if (/로봇|변신|메카|블록|장난감/.test(t)) return 'robot';
    if (/공룡|티라노|브라키|트리케라/.test(t)) return 'dino';
    if (/우주|로켓|별|달|행성|태양/.test(t)) return 'space';
    if (/바다|고래|상어|물고기|인어|문어/.test(t)) return 'ocean';
    if (/탈것|차|자동차|소방|경찰|기차|버스|포크레인/.test(t)) return 'vehicle';
    if (/과일|사과|딸기|수박|바나나|포도/.test(t)) return 'fruit';
    return 'animal';
}

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function buildOrderLabels(subject, level, count) {
    const lv = clampLevel(level);
    const out = [];
    if (subject === 'korean') {
        const src = lv === 1 ? KOREAN_JAMO_ORDER : KOREAN_ORDER;
        for (let i = 0; i < count; i++) out.push(src[i % src.length]);
        return out;
    }
    if (subject === 'english') {
        for (let i = 0; i < count; i++) out.push(ENGLISH_ORDER[i % ENGLISH_ORDER.length]);
        return out;
    }
    const step = lv >= 5 ? 2 : 1;
    for (let i = 0; i < count; i++) out.push(String((i + 1) * step));
    return out;
}

function buildDotToDotBlock({ subject, level, theme, excludeShapeId = '' }) {
    const lv = clampLevel(level);
    const category = resolveThemeCategory(theme);
    const preferred = DOT_TEMPLATES.filter((d) => d.themes.includes(category) && d.shapeId !== excludeShapeId);
    const fallback = DOT_TEMPLATES.filter((d) => d.shapeId !== excludeShapeId);
    const tpl = preferred.length ? pickRandom(preferred) : pickRandom(fallback.length ? fallback : DOT_TEMPLATES);

    const maxPoints = lv <= 2 ? Math.min(7, tpl.points.length) : tpl.points.length;
    const rawPts = tpl.points.slice(0, maxPoints);
    const labels = buildOrderLabels(subject, lv, rawPts.length);
    const points = rawPts.map((pt, idx) => ({ x: pt.x, y: pt.y, label: labels[idx] }));

    const firstLabel = points[0].label;
    const lastLabel = points[points.length - 1].label;
    const orderHint = subject === 'math'
        ? (lv >= 5 ? `2씩 띄어 세며 ${firstLabel}부터 ${lastLabel}까지` : `${firstLabel}부터 ${lastLabel}까지 순서대로`)
        : `'${firstLabel}'부터 '${lastLabel}'까지 순서대로`;

    return {
        id: 'block-5',
        type: 'dot_to_dot',
        themeKey: category,
        shapeId: tpl.shapeId,
        shapeName: tpl.shapeName,
        shapeEmoji: tpl.shapeEmoji,
        fillColor: tpl.fillColor,
        points,
        prompt: `${tpl.shapeEmoji} ${orderHint} 점을 톡톡 이어서 숨은 그림을 완성해 보세요!`,
        ttsText: `${orderHint} 점을 순서대로 눌러 이어 보세요. 어떤 그림이 나올까요?`,
        ttsLang: 'ko-KR'
    };
}

function generateSolvablePath(rows, cols) {
    // (0,0) -> (rows-1, cols-1)까지 인접(상하좌우) 단순 경로를 랜덤 백트래킹으로 생성
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const path = [];
    const dirs = [
        [0, 1], [1, 0], [0, -1], [-1, 0]
    ];

    function dfs(r, c) {
        visited[r][c] = true;
        path.push({ r, c });
        if (r === rows - 1 && c === cols - 1) {
            return path.length >= Math.max(rows + cols - 1, 5);
        }
        const shuffled = [...dirs].sort(() => Math.random() - 0.5);
        // 오른쪽/아래쪽 약간의 우선순위
        shuffled.sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]) + (Math.random() - 0.5) * 1.6);

        for (const [dr, dc] of shuffled) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || visited[nr][nc]) continue;
            if (dfs(nr, nc)) return true;
        }
        path.pop();
        visited[r][c] = false;
        return false;
    }

    if (dfs(0, 0)) return path;

    // 안전한 지그재그 폴백 경로
    const fallback = [];
    for (let r = 0; r < rows; r++) {
        if (r % 2 === 0) {
            for (let c = 0; c < cols; c++) fallback.push({ r, c });
        } else {
            for (let c = cols - 1; c >= 0; c--) fallback.push({ r, c });
        }
    }
    return fallback;
}

function buildMazeBlock({ subject, level, theme }) {
    const lv = clampLevel(level);
    const category = resolveThemeCategory(theme);
    const rows = lv <= 2 ? 3 : 4;
    const cols = lv <= 2 ? 4 : 5;
    const path = generateSolvablePath(rows, cols);
    const labels = buildOrderLabels(subject, lv, path.length);
    const pathLookup = new Map();

    const fullPath = path.map((pos, idx) => {
        const label = labels[idx];
        pathLookup.set(`${pos.r},${pos.c}`, { idx, label });
        return { r: pos.r, c: pos.c, label };
    });

    const themeIcons = {
        dino: ['🦕', '🥚'],
        space: ['🚀', '🪐'],
        ocean: ['🐳', '🐚'],
        vehicle: ['🚒', '🏁'],
        fruit: ['🐰', '🍓'],
        princess: ['🧚', '👑'],
        robot: ['🤖', '⭐'],
        animal: ['🐶', '🎁']
    };
    const [startEmoji, goalEmoji] = themeIcons[category] || themeIcons.animal;

    const cells = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            const hit = pathLookup.get(`${r},${c}`);
            if (hit) {
                row.push({
                    r, c,
                    kind: hit.idx === 0 ? 'start' : (hit.idx === fullPath.length - 1 ? 'goal' : 'path'),
                    stepIndex: hit.idx,
                    label: hit.label
                });
            } else {
                const isObstacle = Math.random() < 0.55;
                row.push({
                    r, c,
                    kind: isObstacle ? 'obstacle' : 'decoy',
                    stepIndex: -1,
                    label: isObstacle
                        ? pickRandom(OBSTACLE_ICONS)
                        : pickRandom(labels.filter((l) => l !== labels[0])) || '?'
                });
            }
        }
        cells.push(row);
    }

    const first = labels[0];
    const last = labels[labels.length - 1];
    return {
        id: 'block-5',
        type: 'maze',
        themeKey: category,
        startEmoji,
        goalEmoji,
        rows,
        cols,
        path: fullPath,
        cells,
        prompt: `${startEmoji} 출발! '${first}'에서 '${last}' 순서대로 길을 톡톡 눌러 ${goalEmoji} 보물까지 가 보아요!`,
        ttsText: `${first}부터 ${last}까지 차례대로 칸을 눌러서 보물까지 길을 찾아 보아요!`,
        ttsLang: 'ko-KR'
    };
}

function buildColoringBlock({ level, theme, excludeTemplateId = '' }) {
    const category = resolveThemeCategory(theme);
    const preferred = COLOR_TEMPLATES.filter((c) => c.themes.includes(category) && c.templateId !== excludeTemplateId);
    const pool = COLOR_TEMPLATES.filter((c) => c.templateId !== excludeTemplateId);
    const tpl = preferred.length ? pickRandom(preferred) : pickRandom(pool.length ? pool : COLOR_TEMPLATES);

    return {
        id: 'block-5',
        type: 'color',
        themeKey: category,
        templateId: tpl.templateId,
        templateTitle: tpl.templateTitle,
        shapeEmoji: tpl.shapeEmoji,
        level: clampLevel(level),
        prompt: `🖍️ '${tpl.templateTitle}' 색칠 놀이! 좋아하는 색깔을 골라 예쁘게 칠해 보세요.`,
        ttsText: `${tpl.templateTitle} 그림을 좋아하는 색깔로 예쁘게 칠해 보아요!`,
        ttsLang: 'ko-KR',
        hint: '인쇄해서 색연필로 색칠해도 멋져요!'
    };
}

function buildPlayBlock({ subject, level, theme, preferredType = '', currentBlock = null }) {
    const types = ['dot_to_dot', 'maze', 'color'];
    let chosenType = preferredType && types.includes(preferredType) ? preferredType : '';
    if (!chosenType) {
        if (currentBlock && types.includes(currentBlock.type)) {
            const nextIdx = (types.indexOf(currentBlock.type) + 1) % types.length;
            chosenType = types[nextIdx];
        } else {
            chosenType = pickRandom(types);
        }
    }

    if (chosenType === 'dot_to_dot') {
        return buildDotToDotBlock({
            subject,
            level,
            theme,
            excludeShapeId: currentBlock?.shapeId || ''
        });
    }
    if (chosenType === 'maze') {
        return buildMazeBlock({ subject, level, theme });
    }
    return buildColoringBlock({
        subject,
        level,
        theme,
        excludeTemplateId: currentBlock?.templateId || ''
    });
}

function appendOptionalPlayBlock(baseBlocks, { subject, level, theme, includePlayBlock = true }) {
    if (includePlayBlock === false) return baseBlocks;
    const playBlk = buildPlayBlock({ subject, level, theme });
    return [...baseBlocks, { ...playBlk, id: `block-${baseBlocks.length + 1}` }];
}

function trySwapPlayBlock(existingBlock, idx, { subject, level, theme }) {
    const playTypes = new Set(['dot_to_dot', 'maze', 'color']);
    if (!playTypes.has(existingBlock?.type)) return null;
    const nextPlay = buildPlayBlock({ subject, level, theme, currentBlock: existingBlock });
    return { ...nextPlay, id: existingBlock.id || `block-${idx + 1}` };
}

module.exports = {
    resolveThemeCategory,
    buildDotToDotBlock,
    buildMazeBlock,
    buildColoringBlock,
    buildPlayBlock,
    appendOptionalPlayBlock,
    trySwapPlayBlock
};
