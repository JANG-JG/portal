/**
 * ==============================================================================
 * 유아 학습지 블록 조립 엔진 (worksheetBuilders.service.js)
 * ------------------------------------------------------------------------------
 * - 수학(6문항): 수 세기, 그림 덧셈, 짝꿍 선 잇기(3~4쌍), 비교/뺄셈, 순서/빈칸, 응용 세기/연산
 * - 한글·영어(6문항): 따라쓰기 2회 + 그림·단어 퀴즈 3회 + 짝꿍 선 잇기(4쌍)
 * - [규칙 2] 100% 유아 친화적 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { KOREAN_BANK, ENGLISH_BANK, pickThemeEmojis, SAFE_EMOJIS } = require('./fallbackBank.data');
const { clampLevel } = require('./studyDb.service');

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function sanitizeEmoji(candidate, fallbackPool = SAFE_EMOJIS, index = 0) {
    const str = String(candidate || '').trim();
    if (str && EMOJI_RE.test(str) && str.length <= 8) return str;
    return fallbackPool[index % fallbackPool.length] || '⭐';
}

function shuffleArray(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildMathChoices(answer, minVal, maxVal, totalCount = 4) {
    const set = new Set([answer]);
    const offsets = [-3, -2, -1, 1, 2, 3, 4, -4, 5];
    for (const off of shuffleArray(offsets)) {
        if (set.size >= totalCount) break;
        const candidate = answer + off;
        if (candidate >= minVal && candidate <= maxVal) set.add(candidate);
    }
    let cursor = minVal;
    while (set.size < totalCount) {
        if (!set.has(cursor)) set.add(cursor);
        cursor++;
    }
    return shuffleArray(Array.from(set)).map(String);
}

/**
 * ① 서버가 직접 계산하는 Lv.1~5 수학 블록 6개 생성
 */
function buildDeterministicMathBlocks(level, theme, aiEmojis = []) {
    const lv = clampLevel(level);
    const pool = pickThemeEmojis(theme);
    const pickEmoji = (idx) => sanitizeEmoji(aiEmojis[idx], pool, idx);
    const blocks = [];

    // 블록 1: 터치해서 하나씩 세어보기 (Count & Touch)
    const countMax = lv === 1 ? 4 : lv === 2 ? 7 : lv === 3 ? 9 : lv === 4 ? 12 : 15;
    const countMin = lv === 1 ? 1 : lv === 2 ? 3 : 4;
    const targetCount = randInt(countMin, countMax);
    const e1 = pickEmoji(0);
    blocks.push({
        id: 'block-1',
        type: 'count',
        prompt: `${theme} 친구가 모두 몇 개일까요? 하나씩 손으로 콕! 누르며 세어 보세요.`,
        ttsText: `${theme} 친구가 모두 몇 개일까요? 하나씩 손으로 누르며 세어 보세요.`,
        emoji: e1,
        count: targetCount,
        answer: String(targetCount),
        choices: buildMathChoices(targetCount, 1, Math.max(countMax + 2, 6), 4),
        hint: '하나, 둘, 셋... 순서대로 터치하면 숫자가 올라가요!'
    });

    // 블록 2: 그림 덧셈/모으기
    if (lv <= 2) {
        const a = randInt(1, lv === 1 ? 3 : 5);
        const b = randInt(1, lv === 1 ? 2 : 4);
        const sum = a + b;
        const e2 = pickEmoji(1);
        blocks.push({
            id: 'block-2',
            type: 'quiz',
            prompt: `${e2} ${a}개와 ${b}개를 모으면 모두 몇 개가 될까요?`,
            ttsText: `${a}개와 ${b}개를 모두 모으면 몇 개가 될까요?`,
            visualLeft: Array(a).fill(e2).join(' '),
            visualRight: Array(b).fill(e2).join(' '),
            operator: '+',
            equationText: `${a} + ${b} = ?`,
            answer: String(sum),
            choices: buildMathChoices(sum, 1, 12, 4),
            hint: '왼쪽과 오른쪽 그림을 모두 세어 보아요.'
        });
    } else {
        const maxSum = lv === 3 ? 10 : lv === 4 ? 15 : 20;
        const a = randInt(2, Math.floor(maxSum / 2) + 2);
        const b = randInt(1, maxSum - a);
        const sum = a + b;
        const e2 = pickEmoji(1);
        blocks.push({
            id: 'block-2',
            type: 'quiz',
            prompt: `덧셈 퀴즈! ${e2} 친구와 함께 계산해 보아요.`,
            ttsText: `${a} 더하기 ${b}는 얼마일까요?`,
            visualLeft: Array(Math.min(a, 10)).fill(e2).join(' '),
            visualRight: Array(Math.min(b, 10)).fill(e2).join(' '),
            operator: '+',
            equationText: `${a} + ${b} = ?`,
            answer: String(sum),
            choices: buildMathChoices(sum, 2, maxSum + 2, 4),
            hint: `${a}에서 ${b}만큼 더 커지면 얼마일까요?`
        });
    }

    // 블록 3: 선 잇기 매칭 (Lv.1: 3쌍, Lv.2+: 4쌍)
    const pairCount = lv === 1 ? 3 : 4;
    const matchPairs = [];
    const usedNums = new Set();
    const mMax = lv <= 2 ? 6 : lv === 3 ? 9 : 14;
    for (let i = 0; i < pairCount; i++) {
        let n = randInt(1, mMax);
        while (usedNums.has(n)) n = (n % mMax) + 1;
        usedNums.add(n);
        const em = pickEmoji(i + 2);
        matchPairs.push({
            id: `m-${i + 1}`,
            left: Array(n).fill(em).join(''),
            right: String(n),
            leftLabel: `${n}개`
        });
    }
    blocks.push({
        id: 'block-3',
        type: 'match',
        prompt: '그림 개수를 세어서 알맞은 숫자와 두 번 탭해서 선으로 이어 주세요!',
        ttsText: '그림 개수를 세어서 알맞은 숫자와 선으로 이어 주세요.',
        pairs: matchPairs,
        shuffledRights: shuffleArray(matchPairs.map((p) => p.right))
    });

    // 블록 4: 비교 또는 뺄셈/빈칸
    if (lv === 1) {
        const x = randInt(1, 4);
        const y = x + randInt(1, 2);
        const bigger = Math.max(x, y);
        const e4 = pickEmoji(3);
        blocks.push({
            id: 'block-4',
            type: 'quiz',
            prompt: `${e4} 어느 숫자가 더 큰가요? 더 큰 숫자를 눌러 주세요!`,
            ttsText: `${x}하고 ${y} 중에서 더 큰 숫자를 찾아보세요.`,
            equationText: `${x}   vs   ${y}`,
            answer: String(bigger),
            choices: shuffleArray([String(x), String(y)]),
            hint: '숫자가 커질수록 개수가 많아요.'
        });
    } else if (lv <= 3) {
        const total = randInt(4, lv === 2 ? 7 : 10);
        const take = randInt(1, total - 1);
        const left = total - take;
        const e4 = pickEmoji(3);
        blocks.push({
            id: 'block-4',
            type: 'quiz',
            prompt: `${e4} ${total}개 중에서 ${take}개를 먹었어요. 몇 개가 남았을까요?`,
            ttsText: `${total}개 중에서 ${take}개를 빼면 몇 개가 남을까요?`,
            equationText: `${total} - ${take} = ?`,
            answer: String(left),
            choices: buildMathChoices(left, 1, total + 1, 4),
            hint: `${total}에서 ${take}만큼 거꾸로 세어 보아요.`
        });
    } else {
        const missingMax = lv === 4 ? 14 : 20;
        const missing = randInt(2, Math.floor(missingMax / 2));
        const a = randInt(2, missingMax - missing);
        const sum = a + missing;
        blocks.push({
            id: 'block-4',
            type: 'quiz',
            prompt: '빈칸(❓) 안에 들어갈 알맞은 숫자를 찾아 주세요!',
            ttsText: `${a} 더하기 무엇이 ${sum}이 될까요?`,
            equationText: `${a} + ❓ = ${sum}`,
            answer: String(missing),
            choices: buildMathChoices(missing, 1, missingMax, 4),
            hint: `${sum}에서 ${a}을 빼면 빈칸 숫자가 나와요!`
        });
    }

    // 블록 5 (신규): 순서 이어가기 또는 더 작은 수 / 10 만들기
    const e5 = pickEmoji(4);
    if (lv <= 2) {
        const startN = randInt(1, lv === 1 ? 3 : 6);
        const nextN = startN + 2;
        blocks.push({
            id: 'block-5',
            type: 'quiz',
            prompt: `${e5} 숫자가 차례차례 커져요! 마지막 ❓ 숫자는 무엇일까요?`,
            ttsText: `${startN}, ${startN + 1} 다음에 올 숫자는 무엇일까요?`,
            equationText: `${startN}  →  ${startN + 1}  →  ❓`,
            answer: String(nextN),
            choices: buildMathChoices(nextN, 1, 10, 4),
            hint: `${startN + 1} 다음 숫자 하나 더 큰 수를 찾아보세요.`
        });
    } else if (lv === 3) {
        const x = randInt(2, 8);
        const y = x + randInt(1, 3);
        const smaller = Math.min(x, y);
        blocks.push({
            id: 'block-5',
            type: 'quiz',
            prompt: `${e5} 이번엔 반대로 더 작은 숫자를 골라 볼까요?`,
            ttsText: `${x}하고 ${y} 중에서 더 작은 숫자를 찾아보세요.`,
            equationText: `${x}   vs   ${y}`,
            answer: String(smaller),
            choices: shuffleArray([String(x), String(y)]),
            hint: '개수가 더 적은 숫자가 작은 수예요.'
        });
    } else {
        const base = lv === 4 ? 10 : 20;
        const partA = randInt(2, base - 2);
        const partB = base - partA;
        blocks.push({
            id: 'block-5',
            type: 'quiz',
            prompt: `${e5} ${partA}와 무엇을 모으면 딱 ${base}이 될까요?`,
            ttsText: `${partA}와 무엇을 더하면 ${base}가 될까요?`,
            equationText: `${partA} + ❓ = ${base}`,
            answer: String(partB),
            choices: buildMathChoices(partB, 1, base, 4),
            hint: `${base}에서 ${partA}만큼 빼면 짝꿍 숫자가 나와요!`
        });
    }

    // 블록 6 (신규): 두 번째 그림 세기 또는 생활 연산 응용
    const e6 = pickEmoji(5);
    if (lv === 1) {
        let secondCount = randInt(1, 5);
        if (secondCount === targetCount) secondCount = (secondCount % 5) + 1;
        blocks.push({
            id: 'block-6',
            type: 'count',
            prompt: `${e6} 한 번 더! 이번엔 이 친구가 몇 마리인지 콕콕 눌러 세어 보아요.`,
            ttsText: `이번에는 친구가 몇 마리인지 하나씩 세어 보아요.`,
            emoji: e6,
            count: secondCount,
            answer: String(secondCount),
            choices: buildMathChoices(secondCount, 1, 6, 4),
            hint: '마지막으로 누른 숫자가 정답이에요!'
        });
    } else if (lv <= 3) {
        const a2 = randInt(2, lv === 2 ? 5 : 7);
        const b2 = randInt(1, lv === 2 ? 3 : 4);
        const sum2 = a2 + b2;
        blocks.push({
            id: 'block-6',
            type: 'quiz',
            prompt: `${e6} 친구 ${a2}마리가 놀고 있는데 ${b2}마리가 더 왔어요! 모두 몇 마리일까요?`,
            ttsText: `${a2}마리에 ${b2}마리가 더 오면 모두 몇 마리일까요?`,
            visualLeft: Array(a2).fill(e6).join(' '),
            visualRight: Array(b2).fill(e6).join(' '),
            operator: '+',
            equationText: `${a2} + ${b2} = ?`,
            answer: String(sum2),
            choices: buildMathChoices(sum2, 2, 13, 4),
            hint: '모두 합치면 숫자가 더 커져요!'
        });
    } else {
        const total2 = randInt(10, lv === 4 ? 15 : 20);
        const take2 = randInt(2, total2 - 3);
        const left2 = total2 - take2;
        blocks.push({
            id: 'block-6',
            type: 'quiz',
            prompt: `${e6} ${total2}개 중에서 ${take2}개를 친구에게 선물했어요. 남은 개수는?`,
            ttsText: `${total2} 빼기 ${take2}는 얼마일까요?`,
            equationText: `${total2} - ${take2} = ?`,
            answer: String(left2),
            choices: buildMathChoices(left2, 1, total2, 4),
            hint: `${total2}에서 ${take2}만큼 줄어들어요.`
        });
    }

    return blocks;
}

/**
 * 6개 단어 항목으로 한글/영어 6문항 학습 블록 조립
 */
function buildLanguageBlocksFromItems(validItems, subject) {
    const lang = subject === 'english' ? 'en-US' : 'ko-KR';
    const isEn = subject === 'english';
    const safeItem = (idx) => validItems[idx % validItems.length];

    const it0 = safeItem(0);
    const it1 = safeItem(1);
    const it2 = safeItem(2);
    const it3 = safeItem(3);
    const it4 = safeItem(4);
    const it5 = safeItem(5);

    const pairs = validItems.slice(0, 4).map((it, idx) => ({
        id: `m-${idx + 1}`,
        left: it.emoji,
        right: it.word,
        ttsText: it.word,
        ttsLang: lang
    }));

    return [
        {
            id: 'block-1', type: 'trace', ttsText: it0.word, ttsLang: lang,
            targetWord: it0.word, emoji: it0.emoji, hint: it0.hint || it0.meaning || '',
            prompt: isEn
                ? `단어 '${it0.word}'(${it0.hint || it0.meaning})를 반듯하게 따라 써 보아요!`
                : `예쁜 글자 '${it0.word}'를 점선을 따라 써 보아요!`
        },
        {
            id: 'block-2', type: 'quiz', ttsText: it1.word, ttsLang: lang,
            visualLeft: it1.emoji, answer: it1.word, hint: it1.hint || it1.meaning || '',
            choices: shuffleArray([it1.word, ...(it1.distractors || it1.choices || [])].filter((v, i, a) => a.indexOf(v) === i)).slice(0, 3),
            prompt: isEn ? `${it1.emoji} 그림에 맞는 영어 단어를 눌러 보세요!` : `${it1.emoji} 그림에 알맞은 낱말을 눌러 주세요!`
        },
        {
            id: 'block-3', type: 'match', pairs,
            shuffledRights: shuffleArray(pairs.map((p) => p.right)),
            prompt: '그림과 알맞은 글자를 두 번 탭해서 선으로 이어 보아요!',
            ttsText: '그림과 알맞은 글자를 선으로 이어 보아요.'
        },
        {
            id: 'block-4', type: 'quiz', ttsText: it2.word, ttsLang: lang,
            visualLeft: it2.emoji, answer: it2.word, hint: it2.hint || it2.meaning || '',
            choices: shuffleArray([it2.word, ...(it2.distractors || it2.choices || [])].filter((v, i, a) => a.indexOf(v) === i)).slice(0, 3),
            prompt: isEn ? `한 문제 더! ${it2.emoji}에 어울리는 영어 단어를 골라 보세요!` : `한 문제 더! ${it2.emoji} 그림과 짝꿍인 글자는?`
        },
        {
            id: 'block-5', type: 'trace', ttsText: it4.word, ttsLang: lang,
            targetWord: it4.word, emoji: it4.emoji, hint: it4.hint || it4.meaning || '',
            prompt: isEn ? `한 번 더 써 보아요! '${it4.word}' (${it4.hint || it4.meaning})` : `한 번 더 반듯하게 써 보아요! '${it4.word}'`
        },
        {
            id: 'block-6', type: 'quiz', ttsText: it5.word, ttsLang: lang,
            visualLeft: it5.emoji, answer: it5.word, hint: it5.hint || it5.meaning || '',
            choices: shuffleArray([it5.word, ...(it5.distractors || it5.choices || [])].filter((v, i, a) => a.indexOf(v) === i)).slice(0, 3),
            prompt: isEn
                ? `마지막 퀴즈! 🔊 듣기를 누르고 ${it5.emoji} 단어를 맞춰 보세요!`
                : `마지막 퀴즈! '${it5.hint || it5.emoji}' 알맞은 낱말을 눌러 주세요!`
        }
    ];
}

function buildFallbackLanguageSheet(subject, level, theme) {
    const lv = clampLevel(level);
    const pool = subject === 'english' ? ENGLISH_BANK[lv] : KOREAN_BANK[lv];
    const picked = shuffleArray(pool).slice(0, 6).map((it) => ({
        word: it.word,
        hint: it.meaning || it.hint,
        emoji: it.emoji,
        distractors: (it.choices || []).filter((c) => c !== it.word)
    }));
    return {
        title: `${theme} ${subject === 'english' ? '영어' : '한글'} 놀이 (Lv.${lv})`,
        encouragement: '와! 6문제를 끝까지 집중해서 정말 잘했어요! 👏',
        blocks: buildLanguageBlocksFromItems(picked, subject)
    };
}

module.exports = {
    sanitizeEmoji,
    shuffleArray,
    buildDeterministicMathBlocks,
    buildLanguageBlocksFromItems,
    buildFallbackLanguageSheet
};
