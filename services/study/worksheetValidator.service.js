/**
 * ==============================================================================
 * 유아 학습지 4단계 무결성 검증 & 생성 파이프라인 (worksheetValidator.service.js)
 * ------------------------------------------------------------------------------
 * ① 수학 문제의 숫자·연산·정답·보기는 AI가 아닌 서버 로직이 100% 직접 계산/조립
 * ② 순수 한글·순수 영어·중복 단어·표준 이모지·금지어 필터링
 * ③ 오류 발견 시 자동 보정/재생성 및 오프라인 문제 은행 안전 폴백 (6문항 + 놀이블록)
 * ④ 단일 블록(문항) 부분 교체 기능 지원
 * ==============================================================================
 */

const {
    BANNED_WORDS,
    KOREAN_BANK,
    ENGLISH_BANK,
    pickThemeEmojis
} = require('./fallbackBank.data');
const { clampLevel } = require('./studyDb.service');
const { appendOptionalPlayBlock, trySwapPlayBlock } = require('./playBlocks.service');
const {
    sanitizeEmoji,
    buildDeterministicMathBlocks,
    buildLanguageBlocksFromItems,
    buildFallbackLanguageSheet
} = require('./worksheetBuilders.service');
const {
    PHASE3_SUBJECTS,
    mixManipulativeIntoSheet,
    buildPhase3Worksheet
} = require('./fallbackPhase3Bank.data');

const HANGUL_ONLY_RE = /^[가-힣\s]+$/;
const ENGLISH_ONLY_RE = /^[A-Za-z\s'-]+$/;
const TARGET_QUESTION_COUNT = 6;

function containsBannedWord(text) {
    const lower = String(text || '').toLowerCase();
    return BANNED_WORDS.some((w) => lower.includes(w));
}

/**
 * 4단계 전체 검증 + 정제 + 폴백 결합 엔트리포인트
 */
function validateAndNormalizeWorksheet(rawAiJson, { subject, level, theme, includePlayBlock = true, childName = '친구', partnerName = '피카츄' }) {
    const lv = clampLevel(level);
    const cleanTheme = containsBannedWord(theme) ? '동물 친구' : String(theme || '동물 친구').trim().slice(0, 20);
    const emojiPool = pickThemeEmojis(cleanTheme);

    if (PHASE3_SUBJECTS.has(subject)) {
        const phase3Sheet = buildPhase3Worksheet({ subject, level: lv, theme: cleanTheme, childName, partnerName, rawAiJson });
        if (phase3Sheet) {
            return { ok: true, usedFallback: false, sheet: phase3Sheet };
        }
    }

    if (subject === 'math') {
        const aiEmojis = Array.isArray(rawAiJson?.themeEmojis) ? rawAiJson.themeEmojis : [];
        const rawTitle = String(rawAiJson?.title || '').trim();
        const safeTitle = (rawTitle && !containsBannedWord(rawTitle) && rawTitle.length <= 40)
            ? rawTitle
            : `${cleanTheme} 숫자·수학 놀이 (Lv.${lv})`;
        const baseBlocks = buildDeterministicMathBlocks(lv, cleanTheme, aiEmojis);
        const mathSheet = mixManipulativeIntoSheet({
            title: safeTitle,
            encouragement: '숫자 박사님처럼 6문제를 정말 똑똑하게 풀었어요! 🌟',
            blocks: appendOptionalPlayBlock(baseBlocks, { subject, level: lv, theme: cleanTheme, includePlayBlock })
        }, { subject, level: lv, theme: cleanTheme });
        return {
            ok: true,
            usedFallback: false,
            sheet: mathSheet
        };
    }

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
        if (validItems.length >= TARGET_QUESTION_COUNT) break;
    }

    if (validItems.length < 3) {
        return { ok: false, reason: 'ai_items_filtered_out' };
    }

    // 부족한 문항(목표 6개)이나 부족한 오답 보기는 같은 레벨 오프라인 풀에서 보충
    const fallbackPool = subject === 'english' ? ENGLISH_BANK[lv] : KOREAN_BANK[lv];
    for (const fb of fallbackPool) {
        if (validItems.length >= TARGET_QUESTION_COUNT) break;
        if (!usedWords.has(fb.word.toUpperCase())) {
            usedWords.add(fb.word.toUpperCase());
            validItems.push({
                word: fb.word,
                hint: fb.meaning || fb.hint,
                emoji: fb.emoji,
                distractors: fb.choices.filter((c) => c !== fb.word)
            });
        }
    }

    validItems.forEach((it) => {
        while (it.distractors.length < 2) {
            const candidate = fallbackPool.find(
                (f) => f.word.toUpperCase() !== it.word.toUpperCase() && !it.distractors.includes(f.word)
            );
            if (!candidate) break;
            it.distractors.push(candidate.word);
        }
    });

    const rawTitle = String(rawAiJson.title || '').trim();
    const safeTitle = (rawTitle && !containsBannedWord(rawTitle) && rawTitle.length <= 42)
        ? rawTitle
        : `${cleanTheme} ${subject === 'english' ? '영어' : '한글'} 놀이 (Lv.${lv})`;

    const langSheet = mixManipulativeIntoSheet({
        title: safeTitle,
        encouragement: '6문제를 끝까지 스스로 해내다니 정말 멋져요! 🎉',
        blocks: appendOptionalPlayBlock(buildLanguageBlocksFromItems(validItems, subject), {
            subject,
            level: lv,
            theme: cleanTheme,
            includePlayBlock
        })
    }, { subject, level: lv, theme: cleanTheme });

    return {
        ok: true,
        usedFallback: false,
        sheet: langSheet
    };
}

function buildFallbackWorksheet({ subject, level, theme, includePlayBlock = true, childName = '친구', partnerName = '피카츄' }) {
    const lv = clampLevel(level);
    const cleanTheme = containsBannedWord(theme) ? '동물 친구' : String(theme || '동물 친구').trim().slice(0, 20);
    if (PHASE3_SUBJECTS.has(subject)) {
        const p3 = buildPhase3Worksheet({ subject, level: lv, theme: cleanTheme, childName, partnerName });
        if (p3) return p3;
    }
    const baseSheet = subject === 'math'
        ? {
            title: `${cleanTheme} 숫자·수학 놀이 (Lv.${lv})`,
            encouragement: '차근차근 6문제를 끝까지 해냈어요! 멋져요! ⭐',
            blocks: buildDeterministicMathBlocks(lv, cleanTheme, [])
        }
        : buildFallbackLanguageSheet(subject, lv, cleanTheme);
    baseSheet.blocks = appendOptionalPlayBlock(baseSheet.blocks, { subject, level: lv, theme: cleanTheme, includePlayBlock });
    return mixManipulativeIntoSheet(baseSheet, { subject, level: lv, theme: cleanTheme });
}

/**
 * ④ UI 영역별(개별 블록) 부분 교체 생성기
 */
function regenerateSingleBlock(currentSheet, blockIndex, { subject, level, theme }) {
    const blocks = Array.isArray(currentSheet?.blocks) ? [...currentSheet.blocks] : [];
    const idx = Number(blockIndex);
    if (idx < 0 || idx >= blocks.length) return currentSheet;

    const existingBlock = blocks[idx];
    const swappedPlay = trySwapPlayBlock(existingBlock, idx, { subject, level, theme });
    if (swappedPlay) {
        blocks[idx] = swappedPlay;
        return { ...currentSheet, blocks };
    }

    const freshSheet = buildFallbackWorksheet({ subject, level, theme, includePlayBlock: false });
    const replacement = freshSheet.blocks[idx] || freshSheet.blocks[0];
    blocks[idx] = { ...replacement, id: existingBlock.id || `block-${idx + 1}` };
    return { ...currentSheet, blocks };
}

module.exports = {
    containsBannedWord,
    sanitizeEmoji,
    buildDeterministicMathBlocks,
    validateAndNormalizeWorksheet,
    buildFallbackWorksheet,
    regenerateSingleBlock
};
