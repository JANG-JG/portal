/**
 * ==============================================================================
 * 유아 학습지 4단계 무결성 검증 & 생성 파이프라인 (worksheetValidator.service.js)
 * ------------------------------------------------------------------------------
 * ① 수학 문제의 숫자·연산·정답·보기는 AI가 아닌 서버 로직이 100% 직접 계산/조립
 * ② 순수 한글·순수 영어·중복 단어·표준 이모지·금지어 필터링
 * ③ 오류 발견 시 자동 보정/재생성 및 오프라인 문제 은행 안전 폴백
 * ④ 단일 블록(문항) 부분 교체 기능 지원
 * ==============================================================================
 */

const {
    BANNED_WORDS,
    SAFE_EMOJIS,
    KOREAN_BANK,
    ENGLISH_BANK,
    pickThemeEmojis
} = require('./fallbackBank.data');
const { clampLevel } = require('./studyDb.service');

const HANGUL_ONLY_RE = /^[가-힣\s]+$/;
const ENGLISH_ONLY_RE = /^[A-Za-z\s'-]+$/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function containsBannedWord(text) {
    const lower = String(text || '').toLowerCase();
    return BANNED_WORDS.some((w) => lower.includes(w));
}

function sanitizeEmoji(candidate, fallbackPool = SAFE_EMOJIS, index = 0) {
    const str = String(candidate || '').trim();
    if (str && EMOJI_RE.test(str) && str.length <= 8) {
        return str;
    }
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

/**
 * ① 서버가 직접 계산·조립하는 레벨별 수학 보기(중복 없는 정수 3~4지선다)
 */
function buildMathChoices(answer, minVal, maxVal, totalCount = 4) {
    const set = new Set([answer]);
    const offsets = [-3, -2, -1, 1, 2, 3, 4, -4, 5];
    for (const off of shuffleArray(offsets)) {
        if (set.size >= totalCount) break;
        const candidate = answer + off;
        if (candidate >= minVal && candidate <= maxVal) {
            set.add(candidate);
        }
    }
    let cursor = minVal;
    while (set.size < totalCount) {
        if (!set.has(cursor)) set.add(cursor);
        cursor++;
    }
    return shuffleArray(Array.from(set)).map(String);
}

/**
 * ① 서버가 직접 계산하는 Lv.1~5 수학 블록 4개 생성 (AI는 이모지/테마 스토리만 보조)
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
        hint: `하나, 둘, 셋... 순서대로 터치하면 숫자가 올라가요!`
    });

    // 블록 2: 그림 덧셈/모으기 (Server Computed)
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
            hint: `왼쪽과 오른쪽 그림을 모두 세어 보아요.`
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

    // 블록 3: 선 잇기 매칭 (수량 ↔ 숫자)
    const matchPairs = [];
    const usedNums = new Set();
    const mMax = lv <= 2 ? 6 : lv === 3 ? 9 : 14;
    for (let i = 0; i < 3; i++) {
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

    // 블록 4: 비교 또는 뺄셈 문제 (Server Computed)
    if (lv === 1) {
        const x = randInt(1, 3);
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
            hint: `숫자가 커질수록 개수가 많아요.`
        });
    } else if (lv <= 3) {
        const total = randInt(4, lv === 2 ? 6 : 10);
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
            prompt: `빈칸(❓) 안에 들어갈 알맞은 숫자를 찾아 주세요!`,
            ttsText: `${a} 더하기 무엇이 ${sum}이 될까요?`,
            equationText: `${a} + ❓ = ${sum}`,
            answer: String(missing),
            choices: buildMathChoices(missing, 1, missingMax, 4),
            hint: `${sum}에서 ${a}을 빼면 빈칸 숫자가 나와요!`
        });
    }

    return blocks;
}

/**
 * ③ 한글 / 영어 오프라인 안전 블록 빌더 & AI 결과 필터링 검증기
 */
function buildFallbackLanguageSheet(subject, level, theme) {
    const lv = clampLevel(level);
    const pool = subject === 'english' ? ENGLISH_BANK[lv] : KOREAN_BANK[lv];
    const items = shuffleArray(pool).slice(0, 4);
    const blocks = [];

    // 블록 1: 손가락 따라쓰기 (Canvas)
    blocks.push({
        id: 'block-1',
        type: 'trace',
        prompt: subject === 'english'
            ? `알파벳/단어 '${items[0].word}'(${items[0].meaning})를 따라 써 보아요!`
            : `예쁜 글자 '${items[0].word}'를 점선을 따라 써 보아요!`,
        ttsText: items[0].word,
        ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
        targetWord: items[0].word,
        emoji: items[0].emoji,
        hint: items[0].meaning || items[0].hint || ''
    });

    // 블록 2: 그림 보고 단어 맞추기 퀴즈
    const q2 = items[1] || items[0];
    blocks.push({
        id: 'block-2',
        type: 'quiz',
        prompt: subject === 'english'
            ? `${q2.emoji} 그림을 보고 알맞은 영어 단어를 눌러 보세요!`
            : `${q2.emoji} 그림에 어울리는 낱말을 찾아 눌러 주세요!`,
        ttsText: q2.word,
        ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
        visualLeft: q2.emoji,
        answer: q2.word,
        choices: shuffleArray([...new Set([q2.word, ...(q2.choices || [])])]).slice(0, 3),
        hint: q2.meaning || q2.hint || ''
    });

    // 블록 3: 선 잇기 (단어 ↔ 그림)
    const pairs = items.slice(0, 3).map((it, idx) => ({
        id: `m-${idx + 1}`,
        left: it.emoji,
        right: it.word,
        ttsText: it.word,
        ttsLang: subject === 'english' ? 'en-US' : 'ko-KR'
    }));
    blocks.push({
        id: 'block-3',
        type: 'match',
        prompt: '그림과 알맞은 글자를 두 번 탭해서 선으로 연결해 보아요!',
        ttsText: '그림과 알맞은 글자를 선으로 이어 보세요.',
        pairs,
        shuffledRights: shuffleArray(pairs.map((p) => p.right))
    });

    // 블록 4: 한 번 더 따라쓰기 또는 골라보기
    const q4 = items[2] || items[0];
    blocks.push({
        id: 'block-4',
        type: 'trace',
        prompt: subject === 'english'
            ? `한 번 더 써 보아요! '${q4.word}' (${q4.meaning})`
            : `한 번 더 반듯하게 써 보아요! '${q4.word}'`,
        ttsText: q4.word,
        ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
        targetWord: q4.word,
        emoji: q4.emoji,
        hint: q4.meaning || q4.hint || ''
    });

    return {
        title: `${theme} ${subject === 'english' ? '영어' : '한글'} 놀이 (Lv.${lv})`,
        encouragement: '와! 끝까지 집중해서 정말 잘했어요! 👏',
        blocks
    };
}

/**
 * 4단계 전체 검증 + 정제 + 폴백 결합 엔트리포인트
 */
function validateAndNormalizeWorksheet(rawAiJson, { subject, level, theme }) {
    const lv = clampLevel(level);
    const cleanTheme = containsBannedWord(theme) ? '동물 친구' : String(theme || '동물 친구').trim().slice(0, 20);
    const emojiPool = pickThemeEmojis(cleanTheme);

    // 수학은 ①번 규칙에 따라 AI가 만든 오답 가능 문제/보기를 폐기하고 서버가 직접 연산·조립!
    if (subject === 'math') {
        const aiEmojis = Array.isArray(rawAiJson?.themeEmojis) ? rawAiJson.themeEmojis : [];
        const rawTitle = String(rawAiJson?.title || '').trim();
        const safeTitle = (rawTitle && !containsBannedWord(rawTitle) && rawTitle.length <= 40)
            ? rawTitle
            : `${cleanTheme} 숫자·수학 놀이 (Lv.${lv})`;
        return {
            ok: true,
            usedFallback: false,
            sheet: {
                title: safeTitle,
                encouragement: '숫자 박사님처럼 정말 똑똑하게 풀었어요! 🌟',
                blocks: buildDeterministicMathBlocks(lv, cleanTheme, aiEmojis)
            }
        };
    }

    // 한글·영어: ② 금지어 / 순수 문자셋 / 중복 보기 / 표준 이모지 / 문항 수 정밀 검증
    if (!rawAiJson || !Array.isArray(rawAiJson.items) || rawAiJson.items.length < 3) {
        return { ok: false, reason: 'ai_items_insufficient' };
    }

    const validItems = [];
    const usedWords = new Set();

    for (let i = 0; i < rawAiJson.items.length; i++) {
        const item = rawAiJson.items[i] || {};
        const word = String(item.word || '').trim();
        const hint = String(item.hint || '').trim();
        const emoji = sanitizeEmoji(item.emoji, emojiPool, i);

        if (!word || containsBannedWord(word) || containsBannedWord(hint)) continue;

        if (subject === 'korean') {
            if (!HANGUL_ONLY_RE.test(word)) continue;
            const noSpaceLen = word.replace(/\s+/g, '').length;
            if (lv <= 2 && noSpaceLen > 4) continue;
            if (lv >= 3 && noSpaceLen > 12) continue;
        } else if (subject === 'english') {
            if (!ENGLISH_ONLY_RE.test(word) || word.length > 16) continue;
        }

        const normKey = word.toUpperCase();
        if (usedWords.has(normKey)) continue;
        usedWords.add(normKey);

        // 보기 검증 (중복 제거 + 정답 반드시 포함 + 순수 문자셋)
        const rawDistractors = Array.isArray(item.distractors) ? item.distractors : [];
        const distractors = [];
        for (const d of rawDistractors) {
            const ds = String(d || '').trim();
            if (!ds || ds.toUpperCase() === normKey || containsBannedWord(ds)) continue;
            if (subject === 'korean' && !HANGUL_ONLY_RE.test(ds)) continue;
            if (subject === 'english' && !ENGLISH_ONLY_RE.test(ds)) continue;
            if (!distractors.some((x) => x.toUpperCase() === ds.toUpperCase())) {
                distractors.push(ds);
            }
            if (distractors.length >= 2) break;
        }

        validItems.push({ word, hint, emoji, distractors });
        if (validItems.length >= 4) break;
    }

    if (validItems.length < 3) {
        return { ok: false, reason: 'ai_items_filtered_out' };
    }

    // 부족한 4번째 항목이나 부족한 오답 보기는 같은 레벨 오프라인 풀에서 보충
    const fallbackPool = subject === 'english' ? ENGLISH_BANK[lv] : KOREAN_BANK[lv];
    for (const fb of fallbackPool) {
        if (validItems.length >= 4) break;
        if (!usedWords.has(fb.word.toUpperCase())) {
            usedWords.add(fb.word.toUpperCase());
            validItems.push({ word: fb.word, hint: fb.meaning || fb.hint, emoji: fb.emoji, distractors: fb.choices.filter((c) => c !== fb.word) });
        }
    }

    validItems.forEach((it) => {
        while (it.distractors.length < 2) {
            const candidate = fallbackPool.find((f) => f.word.toUpperCase() !== it.word.toUpperCase() && !it.distractors.includes(f.word));
            if (!candidate) break;
            it.distractors.push(candidate.word);
        }
    });

    const rawTitle = String(rawAiJson.title || '').trim();
    const safeTitle = (rawTitle && !containsBannedWord(rawTitle) && rawTitle.length <= 42)
        ? rawTitle
        : `${cleanTheme} ${subject === 'english' ? '영어' : '한글'} 놀이 (Lv.${lv})`;

    const q2 = validItems[1];
    const q4 = validItems[3] || validItems[2];
    const pairs = validItems.slice(0, 3).map((it, idx) => ({
        id: `m-${idx + 1}`,
        left: it.emoji,
        right: it.word,
        ttsText: it.word,
        ttsLang: subject === 'english' ? 'en-US' : 'ko-KR'
    }));

    return {
        ok: true,
        usedFallback: false,
        sheet: {
            title: safeTitle,
            encouragement: '스스로 해내다니 정말 멋져요! 최고예요! 🎉',
            blocks: [
                {
                    id: 'block-1',
                    type: 'trace',
                    prompt: subject === 'english'
                        ? `단어 '${validItems[0].word}'(${validItems[0].hint})를 반듯하게 따라 써 보아요!`
                        : `예쁜 글자 '${validItems[0].word}'를 점선을 따라 써 보아요!`,
                    ttsText: validItems[0].word,
                    ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
                    targetWord: validItems[0].word,
                    emoji: validItems[0].emoji,
                    hint: validItems[0].hint
                },
                {
                    id: 'block-2',
                    type: 'quiz',
                    prompt: subject === 'english'
                        ? `${q2.emoji} 그림에 맞는 영어 단어를 눌러 보세요!`
                        : `${q2.emoji} 그림에 알맞은 낱말을 눌러 주세요!`,
                    ttsText: q2.word,
                    ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
                    visualLeft: q2.emoji,
                    answer: q2.word,
                    choices: shuffleArray([q2.word, ...q2.distractors]).slice(0, 3),
                    hint: q2.hint
                },
                {
                    id: 'block-3',
                    type: 'match',
                    prompt: '그림과 알맞은 글자를 두 번 탭해서 선으로 이어 보아요!',
                    ttsText: '그림과 알맞은 글자를 선으로 이어 보아요.',
                    pairs,
                    shuffledRights: shuffleArray(pairs.map((p) => p.right))
                },
                {
                    id: 'block-4',
                    type: 'trace',
                    prompt: subject === 'english'
                        ? `한 번 더 써 보아요! '${q4.word}' (${q4.hint})`
                        : `한 번 더 써 보아요! '${q4.word}'`,
                    ttsText: q4.word,
                    ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
                    targetWord: q4.word,
                    emoji: q4.emoji,
                    hint: q4.hint
                }
            ]
        }
    };
}

function buildFallbackWorksheet({ subject, level, theme }) {
    const lv = clampLevel(level);
    const cleanTheme = containsBannedWord(theme) ? '동물 친구' : String(theme || '동물 친구').trim().slice(0, 20);
    if (subject === 'math') {
        return {
            title: `${cleanTheme} 숫자·수학 놀이 (Lv.${lv})`,
            encouragement: '차근차근 끝까지 해냈어요! 멋져요! ⭐',
            blocks: buildDeterministicMathBlocks(lv, cleanTheme, [])
        };
    }
    return buildFallbackLanguageSheet(subject, lv, cleanTheme);
}

/**
 * ④ UI 영역별(개별 블록) 부분 교체 생성기
 */
function regenerateSingleBlock(currentSheet, blockIndex, { subject, level, theme }) {
    const blocks = Array.isArray(currentSheet?.blocks) ? [...currentSheet.blocks] : [];
    const idx = Number(blockIndex);
    if (idx < 0 || idx >= blocks.length) return currentSheet;

    const existingBlock = blocks[idx];
    const freshSheet = buildFallbackWorksheet({ subject, level, theme });
    const replacement = freshSheet.blocks[idx] || freshSheet.blocks[0];
    blocks[idx] = {
        ...replacement,
        id: existingBlock.id || `block-${idx + 1}`
    };
    return {
        ...currentSheet,
        blocks
    };
}

module.exports = {
    containsBannedWord,
    sanitizeEmoji,
    buildDeterministicMathBlocks,
    validateAndNormalizeWorksheet,
    buildFallbackWorksheet,
    regenerateSingleBlock
};
