/**
 * ==============================================================================
 * Phase 3 조작형 교구 · 두뇌 퍼즐 · AI 동화 · 자연과학 · 피아노 은행
 * (fallbackPhase3Bank.data.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { KOREAN_BANK, ENGLISH_BANK, pickThemeEmojis } = require('./fallbackBank.data');
const { clampLevel } = require('./studyDb.service');

const PHASE3_SUBJECTS = new Set(['logic', 'reading', 'science', 'music']);
const PHASE3_SCORED_TYPES = new Set(['clock', 'coins', 'hangul_tiles', 'phonics_blend', 'pattern', 'picture_sudoku', 'tangram_grid']);

const CHOSEONG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNGSEONG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONGSEONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const EXTRA_KO_JAMO = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅏ','ㅓ','ㅗ','ㅜ','ㅣ'];

function shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function decomposeKoreanToTiles(word) {
    const tiles = [];
    for (const ch of String(word || '').replace(/\s+/g, '')) {
        const code = ch.charCodeAt(0);
        if (code >= 0xAC00 && code <= 0xD7A3) {
            const offset = code - 0xAC00;
            const c = Math.floor(offset / (21 * 28));
            const v = Math.floor((offset % (21 * 28)) / 28);
            const t = offset % 28;
            tiles.push(CHOSEONG[c], JUNGSEONG[v]);
            if (JONGSEONG[t]) tiles.push(JONGSEONG[t]);
        }
    }
    return tiles;
}

function buildClockBlock(level, theme) {
    const lv = clampLevel(level);
    const hour = randInt(1, 12);
    const minuteOptions = lv <= 2 ? [0] : lv === 3 ? [0, 30] : lv === 4 ? [0, 15, 30, 45] : [0, 5, 10, 15, 20, 30, 40, 45, 50];
    const minute = minuteOptions[randInt(0, minuteOptions.length - 1)];
    const minLabel = minute === 0 ? '정각' : `${minute}분`;
    const displayTime = `${hour}시 ${minLabel}`;
    return {
        id: 'block-manip-clock',
        type: 'clock',
        prompt: `${theme} 친구와 약속 시간! 시계 바늘을 돌려 ${displayTime}을 맞추어 보세요.`,
        ttsText: `시계 바늘을 돌려서 ${displayTime}을 맞추어 보세요.`,
        targetHour: hour,
        targetMinute: minute,
        displayTime,
        hint: '짧은 빨간 바늘은 시간, 긴 파란 바늘은 분을 가리켜요!'
    };
}

function buildCoinsBlock(level, theme) {
    const lv = clampLevel(level);
    const useBlocks = lv <= 2 && Math.random() < 0.5;
    if (useBlocks) {
        if (lv === 1) {
            const ones = randInt(2, 8);
            return {
                id: 'block-manip-coins',
                type: 'coins',
                mode: 'blocks',
                targetAmount: ones,
                unitLabel: '개',
                denominations: [
                    { value: 1, label: '일(1) 블록', emoji: '🟨' }
                ],
                prompt: `${theme} 상자 안에 일(1) 블록 ${ones}개를 쏙쏙 담아 보세요!`,
                ttsText: `일 블록을 담아서 ${ones}개를 만들어 보세요.`,
                hint: `일(1) 블록을 ${ones}번 누르면 딱 맞아요!`
            };
        }
        const tens = randInt(1, 3);
        const ones = randInt(1, 5);
        const targetAmount = tens * 10 + ones;
        return {
            id: 'block-manip-coins',
            type: 'coins',
            mode: 'blocks',
            targetAmount,
            unitLabel: '개',
            denominations: [
                { value: 10, label: '십(10) 막대', emoji: '🟦' },
                { value: 1, label: '일(1) 블록', emoji: '🟨' }
            ],
            prompt: `${theme} 상자 안에 수모형 ${targetAmount}개를 쏙쏙 담아 보세요!`,
            ttsText: `십 막대와 일 블록을 담아서 ${targetAmount}를 만들어 보세요.`,
            hint: `십(10) 막대 ${tens}개와 일(1) 블록 ${ones}개를 담으면 돼요!`
        };
    }
    if (lv <= 1) {
        const c10 = randInt(1, 4);
        const targetAmount = c10 * 10;
        return {
            id: 'block-manip-coins',
            type: 'coins',
            mode: 'coins',
            targetAmount,
            unitLabel: '원',
            denominations: [
                { value: 10, label: '10원', emoji: '🟠' }
            ],
            prompt: `${theme} 가게 간식 값 ${targetAmount}원을 저금통에 똑같이 모아 주세요!`,
            ttsText: `10원 동전을 담아서 ${targetAmount}원을 만들어 보세요.`,
            hint: `10원 동전을 ${c10}개 담으면 ${targetAmount}원이 돼요!`
        };
    }
    const c100 = randInt(1, lv >= 4 ? 3 : 2);
    const c50 = lv >= 2 && Math.random() < 0.65 ? 1 : 0;
    const c10 = randInt(1, 4);
    const targetAmount = c100 * 100 + c50 * 50 + c10 * 10;
    return {
        id: 'block-manip-coins',
        type: 'coins',
        mode: 'coins',
        targetAmount,
        unitLabel: '원',
        denominations: [
            { value: 100, label: '100원', emoji: '🪙' },
            { value: 50, label: '50원', emoji: '🟡' },
            { value: 10, label: '10원', emoji: '🟠' }
        ],
        prompt: `${theme} 가게 간식 값 ${targetAmount}원을 저금통에 똑같이 모아 주세요!`,
        ttsText: `동전을 담아서 ${targetAmount}원을 만들어 보세요.`,
        hint: '큰 동전(100원, 50원)부터 먼저 담아 보면 쉬워요!'
    };
}

function buildHangulTilesBlock(subject, level, theme) {
    const lv = clampLevel(level);
    if (subject === 'english') {
        const pool = (ENGLISH_BANK[lv] || ENGLISH_BANK[1]).filter((x) => /^[A-Za-z]{2,6}$/.test(x.word));
        const pick = pool[randInt(0, Math.max(0, pool.length - 1))] || { word: 'CAT', emoji: '🐱', meaning: '고양이' };
        const word = pick.word.toUpperCase();
        const answerTiles = Array.from(word);
        const extraPool = shuffle('ABCDEFGHLMNOPRSTW'.split('').filter((ch) => !answerTiles.includes(ch))).slice(0, 2);
        return {
            id: 'block-manip-tiles',
            type: 'hangul_tiles',
            targetWord: word,
            emoji: pick.emoji || '🔤',
            meaning: pick.meaning || pick.hint || '',
            answerTiles,
            poolTiles: shuffle([...answerTiles, ...extraPool]),
            prompt: `${pick.emoji || '✨'} "${pick.meaning || word}" 영어 알파벳 자석을 순서대로 끼워 낱말을 완성하세요!`,
            ttsText: word,
            ttsLang: 'en-US',
            hint: `${word.length}글자 영어 낱말이에요. 아래 자석을 차례대로 눌러 보세요!`
        };
    }

    const koPool = (KOREAN_BANK[lv] || KOREAN_BANK[1]).filter((x) => /^[가-힣]{1,2}$/.test(x.word));
    const pick = koPool[randInt(0, Math.max(0, koPool.length - 1))] || { word: '나무', emoji: '🌳', hint: '숲에 자라요' };
    const answerTiles = decomposeKoreanToTiles(pick.word);
    const distractors = shuffle(EXTRA_KO_JAMO.filter((j) => !answerTiles.includes(j))).slice(0, 2);
    return {
        id: 'block-manip-tiles',
        type: 'hangul_tiles',
        targetWord: pick.word,
        emoji: pick.emoji || '🧩',
        meaning: pick.hint || `${theme} 낱말`,
        answerTiles,
        poolTiles: shuffle([...answerTiles, ...distractors]),
        prompt: `${pick.emoji || '🌟'} 그림을 보고 "${pick.word}" 자음·모음 자석을 순서대로 맞추어 보세요!`,
        ttsText: pick.word,
        ttsLang: 'ko-KR',
        hint: `자음과 모음 조각 ${answerTiles.length}개를 차례로 누르면 완성돼요!`
    };
}

function buildPhonicsBlendBlock(level, theme) {
    const lv = clampLevel(level);
    const allEn = Array.isArray(ENGLISH_BANK) ? ENGLISH_BANK : [];
    const pool = allEn.filter((w) => {
        const len = String(w.word || '').trim().length;
        return lv <= 2 ? (len >= 3 && len <= 4) : (len >= 3 && len <= 6);
    });
    const pick = (pool.length ? pool : allEn)[randInt(0, Math.max(0, (pool.length ? pool : allEn).length - 1))] || { word: 'cat', meaning: '고양이', emoji: '🐱' };
    const targetWord = String(pick.word || 'cat').trim().toUpperCase();
    const answerLetters = Array.from(targetWord).filter((c) => /[A-Z]/.test(c));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((c) => !answerLetters.includes(c));
    const distractors = shuffle(alphabet).slice(0, lv <= 2 ? 2 : 3);
    return {
        id: 'block-manip-phonics',
        type: 'phonics_blend',
        targetWord,
        meaningKo: pick.meaning || '',
        emoji: pick.emoji || '🔤',
        answerLetters,
        poolLetters: shuffle([...answerLetters, ...distractors]),
        prompt: `${pick.emoji || '🔤'} 그림(${pick.meaning || targetWord})에 맞는 영어 알파벳을 순서대로 눌러 보세요!`,
        ttsText: pick.word,
        ttsLang: 'en-US',
        hint: `첫 글자 "${answerLetters[0] || 'A'}"부터 차례대로 ${answerLetters.length}글자를 맞춰 보아요!`
    };
}

function mixManipulativeIntoSheet(sheet, { subject, level, theme }) {
    if (!sheet || !Array.isArray(sheet.blocks) || !['math', 'korean', 'english'].includes(subject)) return sheet;
    const blocks = [...sheet.blocks];
    if (blocks.some((b) => PHASE3_SCORED_TYPES.has(b?.type))) return sheet;

    const manip = subject === 'math'
        ? (Math.random() < 0.5 ? buildClockBlock(level, theme) : buildCoinsBlock(level, theme))
        : (subject === 'english' ? buildPhonicsBlendBlock(level, theme) : buildHangulTilesBlock(subject, level, theme));

    const replaceIdx = blocks.length >= 6 ? 4 : -1;
    if (replaceIdx >= 0) {
        blocks[replaceIdx] = { ...manip, id: blocks[replaceIdx].id || manip.id };
    } else {
        blocks.push(manip);
    }
    return { ...sheet, blocks };
}

function buildPatternBlock(level, emojis, idx) {
    const lv = clampLevel(level);
    const [a, b, c] = [emojis[0] || '🍎', emojis[1] || '🍌', emojis[2] || '🍇'];
    const seqs = lv <= 2
        ? [[a, b, a, b, a, null, b], [a, a, b, a, a, null, b]]
        : [[a, b, c, a, b, null, c], [a, b, b, a, b, null, b]];
    const picked = seqs[idx % seqs.length];
    const answer = picked[picked.length - 1];
    const sequence = picked.slice(0, -1);
    const choices = shuffle([a, b, c, emojis[3] || '🍓'].filter((v, i, arr) => arr.indexOf(v) === i)).slice(0, 4);
    if (!choices.includes(answer)) choices[0] = answer;
    return {
        id: `block-${idx + 1}`,
        type: 'pattern',
        prompt: '규칙을 찾아 빈칸 [ ? ]에 들어갈 알맞은 그림을 골라 보세요!',
        ttsText: '그림의 규칙을 찾아 빈칸에 들어갈 그림을 골라 보세요.',
        sequence,
        answer,
        choices: shuffle(choices),
        hint: '앞에서부터 어떤 순서로 반복되는지 소리 내어 읽어 보아요!'
    };
}

function buildSudokuBlock(level, emojis, idx) {
    const lv = clampLevel(level);
    const symbols = shuffle([emojis[0] || '🐶', emojis[1] || '🐱', emojis[2] || '🐰', emojis[3] || '🐻']);
    const base = [
        [0, 1, 2, 3],
        [2, 3, 0, 1],
        [1, 0, 3, 2],
        [3, 2, 1, 0]
    ];
    const perm = shuffle([0, 1, 2, 3]);
    const solution = base.map((row) => row.map((v) => symbols[perm[v]]));
    const blankCount = lv <= 2 ? 4 : lv === 3 ? 5 : 6;
    const coords = shuffle(Array.from({ length: 16 }, (_, k) => [Math.floor(k / 4), k % 4])).slice(0, blankCount);
    const blankSet = new Set(coords.map(([r, c]) => `${r},${c}`));
    const given = solution.map((row, r) => row.map((val, c) => (blankSet.has(`${r},${c}`) ? null : val)));

    return {
        id: `block-${idx + 1}`,
        type: 'picture_sudoku',
        prompt: '4x4 그림 스도쿠! 가로줄, 세로줄, 네모 상자(2x2)에 그림이 겹치지 않게 채워 보세요.',
        ttsText: '가로줄, 세로줄, 작은 상자에 같은 그림이 겹치지 않게 빈칸을 채워 보세요.',
        symbols,
        given,
        solution,
        hint: '이미 들어있는 3가지 그림을 빼면 남은 1가지가 정답이에요!'
    };
}

function buildTangramBlock(level, emojis, idx) {
    const lv = clampLevel(level);
    const fillEmoji = emojis[idx % emojis.length] || '🟩';
    const leftPairs = lv <= 2
        ? [[0, 1], [1, 0], [1, 1], [2, 1]]
        : [[0, 0], [0, 1], [1, 1], [2, 0], [3, 1]];
    const targetCells = leftPairs.map(([r, c]) => `${r},${3 - c}`);
    const prefilled = lv <= 2 ? [targetCells[0]] : [];
    return {
        id: `block-${idx + 1}`,
        type: 'tangram_grid',
        prompt: '가운데 거울 선을 기준으로 왼쪽 그림과 데칼코마니 똑같이 오른쪽 칸을 눌러 채워 보세요!',
        ttsText: '왼쪽 그림과 거울처럼 똑같은 위치의 오른쪽 칸을 눌러 보세요.',
        gridSize: 4,
        fillEmoji,
        leftCells: leftPairs.map(([r, c]) => `${r},${c}`),
        prefilledCells: prefilled,
        targetCells,
        hint: '거울 선에서 얼마나 떨어져 있는지 칸 수를 세어 보면 쉬워요!'
    };
}

function buildLogicWorksheet(level, theme) {
    const lv = clampLevel(level);
    const emojis = pickThemeEmojis(theme);
    const blocks = [
        buildPatternBlock(lv, emojis, 0),
        buildSudokuBlock(lv, emojis, 1),
        buildTangramBlock(lv, emojis, 2),
        buildPatternBlock(lv, shuffle(emojis), 3),
        buildSudokuBlock(Math.min(5, lv + 1), shuffle(emojis), 4),
        buildTangramBlock(Math.min(5, lv + 1), shuffle(emojis), 5)
    ];
    return {
        title: `${theme} 반짝 두뇌 퍼즐 (Lv.${lv})`,
        encouragement: '규칙 찾기와 그림 스도쿠까지 척척! 우리 집 꼬마 천재예요! 🧩🌟',
        blocks
    };
}

const STORY_TEMPLATES = {
    reading: [
        {
            themeKey: '공룡',
            title: '{child}와 {partner}의 공룡 숲 소풍',
            pages: [
                '어느 맑은 아침, {child}와 단짝 {partner}는 커다란 공룡 숲으로 소풍을 떠났어요.',
                '길 위에는 알록달록 반짝이는 도토리가 하나, 둘, 셋 떨어져 있었어요.',
                '목이 긴 아기 브라키오가 높은 나무의 나뭇잎을 못 먹어 울상이에요.',
                '{partner}가 폴짝 뛰어 나뭇잎을 따 주자 아기 공룡이 "고마워!" 하고 웃었어요.',
                '모두 둘러앉아 달콤한 사과를 나누어 먹으며 행복한 노래를 불렀답니다.'
            ],
            voiceWord: '고마워 함께 나누어 먹자',
            quizzes: [
                { prompt: '{child}와 {partner}가 소풍 길에서 발견한 것은 무엇인가요?', emoji: '🌰', answer: '도토리', choices: ['도토리', '눈사람', '우산', '자전거'] },
                { prompt: '아기 공룡에게 친구들이 나누어 준 간식은 무엇이었나요?', emoji: '🍎', answer: '달콤한 사과', choices: ['달콤한 사과', '차가운 얼음', '돌멩이', '모래'] }
            ]
        },
        {
            themeKey: '우주',
            title: '{child}와 {partner}의 반짝 별나라 여행',
            pages: [
                '반짝반짝 은하수 로켓을 타고 {child}와 {partner}가 우주로 날아올랐어요.',
                '커다란 보름달 옆을 지나자 조그만 별님 하나가 길 잃고 깜빡이고 있었어요.',
                '{child}는 별자리 지도를 펼치고 {partner}는 손전등을 높이 비추어 주었어요.',
                '무사히 엄마 별 품으로 돌아간 아기 별이 하늘 가득 별빛 폭죽을 쏘아 올렸어요!',
                '지구로 돌아온 {child}와 {partner}는 오늘 밤 꿈속에서도 반짝일 거예요.'
            ],
            voiceWord: '반짝반짝 작은 별 안녕',
            quizzes: [
                { prompt: '{child}와 {partner}가 우주로 갈 때 타고 간 것은 무엇인가요?', emoji: '🚀', answer: '은하수 로켓', choices: ['은하수 로켓', '소방차', '고래 배', '달팽이'] },
                { prompt: '집을 찾은 아기 별이 하늘에 쏘아 올린 선물은 무엇인가요?', emoji: '🎆', answer: '별빛 폭죽', choices: ['별빛 폭죽', '비눗방울', '낙엽', '눈송이'] }
            ]
        }
    ],
    science: [
        {
            themeKey: '기본',
            title: '{child}의 호기심 자연·과학 탐험!',
            pages: [
                '숲속 연못가에서 {child}와 {partner}가 작은 올챙이를 만났어요. 꼬리가 살랑살랑 움직여요!',
                '며칠이 지나자 올챙이에게 튼튼한 뒷다리가 쏘옥 나오더니 앞다리도 생겼어요.',
                '꼬리가 점점 짧아지면서 마침내 "개굴개굴!" 멋진 초록 개구리가 되었어요.',
                '개구리는 폴짝 뛰어 연잎 위로 올라가 햇볕을 쬐며 모기와 파리를 냠냠 잡아요.',
                '작은 올챙이가 개구리로 변하는 자연의 마법! 정말 신기하고 놀라워요.'
            ],
            voiceWord: '개굴개굴 올챙이가 개구리가 되었어요',
            quizzes: [
                { prompt: '올챙이가 개구리로 자랄 때 가장 먼저 나오는 다리는 어느 쪽인가요?', emoji: '🐸', answer: '뒷다리', choices: ['뒷다리', '날개', '뿔', '지느러미'] },
                { prompt: '개구리가 되면서 몸에서 점점 사라져 작아지는 부분은 어디일까요?', emoji: '🔎', answer: '꼬리', choices: ['꼬리', '눈', '입', '발가락'] }
            ]
        }
    ]
};

function assembleStorySheet(title, subject, theme, pages, voiceWord, quizzes) {
    return {
        title,
        encouragement: subject === 'science'
            ? '호기심 과학 박사님! 오늘도 자연의 비밀을 하나 더 배웠어요! 🌱🔬'
            : '이야기를 끝까지 읽고 퀴즈까지 맞췄어요! 정말 멋져요 📚✨',
        blocks: [
            {
                id: 'block-1', type: 'storybook', theme, pages,
                badge: subject === 'science' ? '🔬 자연·과학 그림책' : '📖 AI 맞춤 동화',
                prompt: '한 쪽씩 넘기며 재미있는 이야기를 들어 보아요!', ttsText: pages[0].ttsText
            },
            {
                id: 'block-2', type: 'voice_repeat',
                prompt: '마이크를 눌러 큰 소리로 멋지게 따라 말해 보세요!',
                ttsText: voiceWord, targetSentence: voiceWord,
                emoji: subject === 'science' ? '🔬' : '🎤',
                hint: '녹음한 내 목소리를 바로 다시 들어 볼 수도 있어요!'
            },
            ...quizzes
        ]
    };
}

function normalizeAiStoryBlocks(rawAiJson, subject, theme, childName, partnerName) {
    const clean = (t) => String(t || '').replace(/\{child\}/g, childName).replace(/\{partner\}/g, partnerName).trim();
    const pages = Array.isArray(rawAiJson?.pages) && rawAiJson.pages.length >= 3
        ? rawAiJson.pages.slice(0, 5).map((p, i) => ({ pageNo: i + 1, sceneEmoji: String(p.emoji || (subject === 'science' ? '🔬' : '📖')).slice(0, 6), text: clean(p.text || p), ttsText: clean(p.text || p) }))
        : null;
    if (!pages) return null;

    const quizzes = Array.isArray(rawAiJson?.quizzes) && rawAiJson.quizzes.length >= 1
        ? rawAiJson.quizzes.slice(0, 2).map((q, i) => {
            const ans = clean(q.answer);
            const rawChoices = (Array.isArray(q.choices) ? q.choices : []).map(clean).filter(Boolean);
            const deduped = [];
            for (const c of rawChoices) {
                if (!deduped.includes(c)) deduped.push(c);
            }
            if (ans && !deduped.includes(ans)) {
                deduped.unshift(ans);
            }
            for (const fb of ['강아지', '구름', '별님', '무지개']) {
                if (deduped.length >= 3) break;
                if (!deduped.includes(fb)) deduped.push(fb);
            }
            const finalChoices = shuffle(deduped.slice(0, 4));
            if (ans && !finalChoices.includes(ans)) finalChoices[0] = ans;
            return {
                id: `block-${i + 3}`, type: 'quiz', prompt: clean(q.prompt), ttsText: clean(q.prompt),
                visualLeft: String(q.emoji || '🌟').slice(0, 6), answer: ans,
                choices: shuffle(finalChoices),
                hint: '방금 읽은 이야기를 떠올려 보아요!'
            };
        }).filter((q) => q.prompt && q.answer)
        : [];
    if (!quizzes.length) return null;
    return assembleStorySheet(clean(rawAiJson.title || `${childName}의 ${theme} 이야기`), subject, theme, pages, clean(rawAiJson.voiceWord || '오늘도 정말 재미있는 공부 시간이었어요!'), quizzes);
}

function buildReadingOrScienceWorksheet(subject, level, theme, { childName = '친구', partnerName = '피카츄', rawAiJson = null } = {}) {
    const aiNormalized = rawAiJson ? normalizeAiStoryBlocks(rawAiJson, subject, theme, childName, partnerName) : null;
    if (aiNormalized) return aiNormalized;

    const list = STORY_TEMPLATES[subject === 'science' ? 'science' : 'reading'];
    const found = list.find((t) => String(theme || '').includes(t.themeKey)) || list[randInt(0, list.length - 1)];
    const rep = (s) => String(s || '').replace(/\{child\}/g, childName).replace(/\{partner\}/g, partnerName);
    const emojis = pickThemeEmojis(theme);

    const pages = found.pages.map((txt, i) => ({ pageNo: i + 1, sceneEmoji: emojis[i % emojis.length] || '✨', text: rep(txt), ttsText: rep(txt) }));
    const quizzes = found.quizzes.map((q, idx) => ({
        id: `block-${idx + 3}`, type: 'quiz', prompt: rep(q.prompt), ttsText: rep(q.prompt),
        visualLeft: q.emoji, answer: rep(q.answer), choices: shuffle(q.choices.map(rep)),
        hint: '앞에서 읽은 이야기를 떠올려 보면 바로 알 수 있어요!'
    }));
    return assembleStorySheet(`${rep(found.title)} (Lv.${clampLevel(level)})`, subject, theme, pages, rep(found.voiceWord), quizzes);
}

function buildMusicWorksheet(level, theme) {
    const lv = clampLevel(level);
    return {
        title: `${theme} 신나는 리듬 피아노 (Lv.${lv})`,
        encouragement: '멋진 꼬마 음악가! 아름다운 멜로디를 연주했어요! 🎹🎵',
        blocks: [
            {
                id: 'block-1',
                type: 'piano',
                prompt: '반짝이는 건반을 따라 누르며 멋진 동요를 직접 연주해 보세요!',
                ttsText: '반짝이는 무지개 피아노 건반을 눌러 동요를 연주해 보세요.',
                defaultSongId: 'twinkle',
                songs: [
                    { id: 'twinkle', title: '⭐ 작은 별', notes: ['도', '도', '솔', '솔', '라', '라', '솔', '파', '파', '미', '미', '레', '레', '도'] },
                    { id: 'butterfly', title: '🦋 나비야', notes: ['솔', '미', '미', '파', '레', '레', '도', '레', '미', '파', '솔', '솔', '솔'] },
                    { id: 'bell', title: '🏫 학교종', notes: ['솔', '솔', '라', '라', '솔', '솔', '미', '솔', '솔', '미', '미', '레'] },
                    { id: 'three_bears', title: '🐻 곰 세 마리', notes: ['도', '도', '도', '도', '도', '미', '솔', '솔', '미', '도', '솔', '솔', '미', '솔', '솔', '미', '도', '도', '도'] },
                    { id: 'baby_shark', title: '🦈 아기 상어', notes: ['도', '레', '미', '미', '미', '미', '미', '미', '미', '도', '레', '미', '미', '미', '미', '미', '미', '미', '미', '레'] },
                    { id: 'airplane', title: '✈️ 비행기', notes: ['미', '레', '도', '레', '미', '미', '미', '레', '레', '레', '미', '솔', '솔'] }
                ]
            },
            {
                id: 'block-2',
                type: 'voice_repeat',
                prompt: '음계 "도 레 미 파 솔 라 시 도!" 신나게 노래해 보세요 🎵',
                ttsText: '도 레 미 파 솔 라 시 도',
                targetSentence: '도 레 미 파 솔 라 시 도',
                emoji: '🎶',
                hint: '높아지는 소리를 따라 목소리도 씩씩하게 내 보아요!'
            },
            {
                id: 'block-3',
                type: 'quiz',
                prompt: '무지개 피아노의 맨 왼쪽 첫 번째 빨간 건반은 무슨 소리일까요?',
                ttsText: '피아노에서 도 레 미 순서의 가장 첫 번째 음은 무엇일까요?',
                visualLeft: '🎹',
                answer: '도',
                choices: shuffle(['도', '미', '솔', '시']),
                hint: '"도·레·미·파·솔·라·시"의 첫 글자를 생각해 보세요!'
            },
            {
                id: 'block-4',
                type: 'quiz',
                prompt: '"나비야 나비야 이리 날아 오너라~" 노래에 어울리는 동물은?',
                ttsText: '나비야 노래에 나오는 예쁜 날개 친구는 누구일까요?',
                visualLeft: '🦋',
                answer: '나비',
                choices: shuffle(['나비', '코끼리', '거북이', '상어']),
                hint: '꽃밭에 팔랑팔랑 날아다니는 친구예요!'
            }
        ]
    };
}

function buildPhase3Worksheet({ subject, level, theme, childName, partnerName, rawAiJson }) {
    if (subject === 'logic') return buildLogicWorksheet(level, theme);
    if (subject === 'music') return buildMusicWorksheet(level, theme);
    if (subject === 'reading' || subject === 'science') {
        return buildReadingOrScienceWorksheet(subject, level, theme, { childName, partnerName, rawAiJson });
    }
    return null;
}

function evaluatePhase3SubmittedBlock(blk, submitted) {
    const type = String(blk?.type || '');
    const wrongTries = Math.max(0, Number(submitted?.wrongCount || 0));
    if (submitted?.status !== 'correct' || wrongTries >= 2) return false;

    if (type === 'clock') {
        return Number(submitted?.hour) === Number(blk?.targetHour) && Number(submitted?.minute) === Number(blk?.targetMinute);
    }
    if (type === 'coins') {
        return Number(submitted?.amount) === Number(blk?.targetAmount);
    }
    if (type === 'hangul_tiles' || type === 'phonics_blend') {
        const expectedArr = type === 'phonics_blend' ? blk?.answerLetters : blk?.answerTiles;
        const expected = Array.isArray(expectedArr) ? expectedArr.join('') : String(blk?.targetWord || '');
        const actual = Array.isArray(submitted?.tiles) ? submitted.tiles.join('') : String(submitted?.finalAnswer || '');
        return Boolean(expected) && actual.toUpperCase() === expected.toUpperCase();
    }
    if (type === 'pattern') {
        return String(submitted?.finalAnswer || '') === String(blk?.answer || '');
    }
    if (type === 'picture_sudoku') {
        const sol = blk?.solution || [];
        const ans = Array.isArray(submitted?.grid) ? submitted.grid : [];
        return sol.length === 4 && ans.length === 4 && sol.every((row, r) => row.every((val, c) => ans[r]?.[c] === val));
    }
    if (type === 'tangram_grid') {
        const exp = [...(blk?.targetCells || [])].sort().join('|');
        const got = [...(Array.isArray(submitted?.cells) ? submitted.cells : [])].sort().join('|');
        return Boolean(exp) && exp === got;
    }
    return false;
}

module.exports = {
    PHASE3_SUBJECTS,
    PHASE3_SCORED_TYPES,
    decomposeKoreanToTiles,
    buildClockBlock,
    buildCoinsBlock,
    buildHangulTilesBlock,
    mixManipulativeIntoSheet,
    buildPhase3Worksheet,
    evaluatePhase3SubmittedBlock
};
