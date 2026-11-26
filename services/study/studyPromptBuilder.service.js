/**
 * ==============================================================================
 * 누리과정·공공데이터 맞춤 Gemini 프롬프트 & JSON 스키마 빌더
 * (studyPromptBuilder.service.js)
 * ------------------------------------------------------------------------------
 * - 자연·과학(science) / 역사·문화(history): 포켓몬 완전 배제, 도감+실사퀴즈+짝짓기
 * - 그림동화(reading): 전래동화·이솝우화(원작 보존) vs 창작동화(포켓몬) 명확 분리
 * - 한글(korean) / 영어(english) / 수학(math): 과목별 특화 프롬프트 분리
 * ==============================================================================
 */

const FOLKTALE_KEYWORDS = ['토끼와 거북이', '해님 달님', '흥부와 놀부', '금도끼 은도끼', '호랑이와 곶감', '콩쥐 팥쥐', '전래', '선녀와 나무꾼'];
const CLASSIC_TALE_KEYWORDS = ['개미와 베짱이', '아기 돼지 삼형제', '미운 오리 새끼', '사자와 생쥐', '이솝', '명작', '빨간 모자'];

function detectReadingGenre(theme = '') {
    const t = String(theme || '').trim();
    if (FOLKTALE_KEYWORDS.some((k) => t.includes(k))) return 'folktale';
    if (CLASSIC_TALE_KEYWORDS.some((k) => t.includes(k))) return 'classic';
    return 'creative';
}

function buildDiscoveryPromptAndSchema({ subject, level, theme, birthYear, curriculumHint = '', publicDataContext = '' }) {
    const isHistory = subject === 'history';
    const quizTarget = level <= 2 ? 2 : 3;
    const cardTarget = level <= 2 ? 3 : 4;
    const roleTitle = isHistory
        ? '유치원생·어린이 눈높이 한국사·국가유산 해설사'
        : '유치원생·어린이 눈높이 자연과학관 해설사';
    const dataLine = publicDataContext ? `\n[공신력 공공데이터 참고 — 반드시 주제와 자연스럽게 연결]\n${publicDataContext}` : '';
    const currLine = curriculumHint ? `\n[교육 단원 기준] ${curriculumHint}` : '';

    const prompt =
        `${roleTitle} 역할입니다. 대상: ${birthYear}년생 유치원생, 과목: ${isHistory ? '역사·우리 문화' : '자연·과학'}, 주제: "${theme}", 난이도: Lv.${level}/5.${currLine}${dataLine}\n` +
        `필수 규칙:\n` +
        `1) 포켓몬, 마법, 만화 캐릭터 등 판타지 요소는 절대 등장시키지 마세요. 사실적이고 검증된 ${isHistory ? '역사·문화유산' : '자연·과학'} 내용만 순수 한국어로 쉽게 설명하세요.\n` +
        `2) cards는 ${cardTarget}장의 관찰·도감 카드입니다. 각 카드는 title(짧은 소제목), text(유아가 이해하기 쉬운 1~2문장 설명), emoji(표준 단일 이모지 1개), photoKeyword(위키백과·생물도감·국가유산 검색용 핵심 한국어 명사 1단어, 예: "${isHistory ? '첨성대' : '보름달'}")를 포함하세요.\n` +
        `3) quizzes는 ${quizTarget}개의 확인 퀴즈입니다. 반드시 위 cards 내용 안에서 답을 찾을 수 있어야 하고, answer는 choices 배열(서로 다른 3~4개 보기) 안에 정확히 포함되어야 하며, photoKeyword(단일 명사)를 함께 주세요.\n` +
        `4) matchPairs는 서로 짝이 맞는 3쌍입니다(예: left "${isHistory ? '세종대왕' : '초승달'}", right "${isHistory ? '훈민정음' : '눈썹 모양 달'}", photoKeyword "${isHistory ? '훈민정음' : '초승달'}"). left와 right는 모두 짧은 한국어로 작성하세요.\n` +
        `5) voiceWord는 오늘 배운 핵심 사실을 아이가 따라 말할 수 있는 1문장입니다.`;

    const schema = {
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING' },
            voiceWord: { type: 'STRING' },
            cards: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        title: { type: 'STRING' },
                        text: { type: 'STRING' },
                        emoji: { type: 'STRING' },
                        photoKeyword: { type: 'STRING' }
                    },
                    required: ['title', 'text', 'emoji', 'photoKeyword']
                }
            },
            quizzes: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        prompt: { type: 'STRING' },
                        emoji: { type: 'STRING' },
                        photoKeyword: { type: 'STRING' },
                        answer: { type: 'STRING' },
                        choices: { type: 'ARRAY', items: { type: 'STRING' } }
                    },
                    required: ['prompt', 'emoji', 'photoKeyword', 'answer', 'choices']
                }
            },
            matchPairs: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        left: { type: 'STRING' },
                        right: { type: 'STRING' },
                        photoKeyword: { type: 'STRING' }
                    },
                    required: ['left', 'right', 'photoKeyword']
                }
            }
        },
        required: ['title', 'voiceWord', 'cards', 'quizzes', 'matchPairs']
    };
    return { prompt, schema };
}

function buildReadingPromptAndSchema({ childName, partnerName, birthYear, level, theme, curriculumHint = '', curatedWords = [] }) {
    const genre = detectReadingGenre(theme);
    const quizTarget = level <= 2 ? 2 : 3;
    const pageTarget = level <= 2 ? 4 : 5;
    const currLine = curriculumHint ? `\n[누리과정·읽기 단원] ${curriculumHint}` : '';
    const dictLine = curatedWords.length
        ? `\n[국립국어원 우리말 추천 어휘(자연스럽게 1~2개 포함)]: ${curatedWords.slice(0, 4).map((w) => w.word).join(', ')}`
        : '';

    let roleLine = '';
    if (genre === 'folktale') {
        roleLine = `유아 전래동화 작가 역할입니다. 대상: ${birthYear}년생 유치원생, 전래동화 주제: "${theme}", 수준: Lv.${level}/5.\n` +
            `규칙: 원작 전래동화의 주인공, 줄거리, 따뜻한 교훈을 그대로 살려 유아 눈높이로 순화(무섭거나 폭력적인 장면 제외)해 작성하세요. 포켓몬이나 현대 캐릭터는 절대 넣지 마세요. 한국 전통 의성어·의태어(예: 엉금엉금, 덩실덩실)를 자연스럽게 담아 주세요.`;
    } else if (genre === 'classic') {
        roleLine = `유아 명작·이솝우화 작가 역할입니다. 대상: ${birthYear}년생 유치원생, 동화 주제: "${theme}", 수준: Lv.${level}/5.\n` +
            `규칙: 원작 이솝우화·명작동화의 등장인물과 핵심 교훈을 살려 유아 눈높이로 따뜻하게 들려주세요. 포켓몬은 등장시키지 마세요.`;
    } else {
        roleLine = `유아 창작 그림동화 작가 역할입니다. 주인공: "${childName}"과 단짝 포켓몬 "${partnerName}", 주제: "${theme}", 수준: Lv.${level}/5.\n` +
            `규칙: 아이와 단짝 포켓몬이 함께 모험하고 서로 돕는 따뜻하고 재미있는 창작 동화를 작성하세요.`;
    }

    const prompt =
        `${roleLine}${currLine}${dictLine}\n` +
        `구성: ${pageTarget}쪽 그림 동화(pages ${pageTarget}개, 각 1~2문장), 따라 읽을 핵심 문장 1개(voiceWord), 독해 퀴즈 ${quizTarget}개(quizzes)를 순수 한국어로 작성하세요.\n` +
        `중요: 각 quizzes의 answer는 반드시 본문(pages) 내용에서 답을 찾을 수 있어야 하고, choices 배열(서로 다른 3~4개 보기) 안에 정확히 포함되어야 합니다.`;

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

function buildMathPromptAndSchema({ childName, birthYear, level, theme, curriculumHint = '' }) {
    const currLine = curriculumHint ? `\n[누리·초등 수학 단원] ${curriculumHint}` : '';
    const prompt =
        `유치원생 수학 학습지 작가 역할입니다. 대상: ${birthYear}년생(${childName}), 테마: "${theme}", 난이도: Lv.${level}/5.${currLine}\n` +
        `숫자 계산과 정답 검증은 서버가 100% 직접 처리합니다. "${theme}" 테마에 어울리는 친근한 제목 1개(title), 유아 친화 단일 유니코드 이모지 6개(themeEmojis), 그리고 덧셈·뺄셈 문장제에 쓸 짧은 상황 문구 2개(storyContexts: 예 ["숲속 소풍에서", "바구니에 모았더니"])를 JSON으로 주세요.\n` +
        `금지어(폭력/어려운 한자어/부정적 단어)는 절대 쓰지 마세요.`;

    const schema = {
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING' },
            themeEmojis: { type: 'ARRAY', items: { type: 'STRING' } },
            storyContexts: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['title', 'themeEmojis']
    };
    return { prompt, schema };
}

function buildLanguagePromptAndSchema({ childName, birthYear, subject, level, theme, curriculumHint = '', curatedWords = [] }) {
    const isEnglish = subject === 'english';
    const levelGuide = isEnglish
        ? (level === 1 ? '알파벳 대문자 A~Z 1글자 6개와 대표 뜻'
            : level <= 3 ? '파닉스 기초 3~5글자 단일 영단어 표제어 6개(예: CAT, SUN, APPLE — 공백·복수형 금지)'
                : '5~9글자 어린이 친숙 단일 영단어 표제어 6개(공백·하이픈 금지)')
        : (level === 1 ? '1~3글자 받침 없는 쉽고 온전한 순수 한글 낱말 6개(예: 나비, 사자, 오리, 개구리, 코끼리)'
            : level <= 3 ? '2~3글자 친숙한 순수 한글 명사 6개'
                : level === 4 ? '3~4글자 받침 포함 순수 한글 낱말 6개'
                    : '짧은 2어절 순수 한글 표현 6개(예: 반짝이는 별)');
    const currGuide = curriculumHint ? `\n[교육과정 기준] ${curriculumHint}` : '';
    const dictGuide = (!isEnglish && curatedWords.length)
        ? `\n[국립국어원 사전 추천 어휘(주제에 어울리면 2~3개 적극 활용)]: ${curatedWords.map((w) => (w.definition ? `${w.word}(${String(w.definition).slice(0, 28)})` : w.word)).join(', ')}`
        : '';

    const prompt =
        `유치원생(${birthYear}년생 ${childName}) ${isEnglish ? '기초 영어·파닉스' : '한글·우리말'} 교사 역할입니다. ` +
        `테마: "${theme}", 수준: Lv.${level}/5.${currGuide}${dictGuide}\n` +
        `규칙:\n` +
        `1) ${levelGuide}를 생성하세요. 그림으로 바로 알 수 있는 구체적인 동물·사물·음식·자연물을 우선 고르세요.\n` +
        `2) ${isEnglish ? 'word와 distractors는 반드시 공백 없는 단일 영문(A-Z) 표제어만 쓰고, hint에 짧은 한국어 뜻과 첫소리 발음 힌트를 적으세요(예: "고양이 · C로 시작해요").' : 'word와 distractors는 반드시 순수 한글만 쓰고(영어/숫자/특수문자 금지), hint에는 정답 단어를 직접 쓰지 않은 쉬운 유아용 1문장 수수께끼 설명을 적으세요(예: "코가 길고 귀가 큰 회색 동물이에요").'}\n` +
        `3) 각 항목의 emoji는 word의 뜻을 정확히 1:1로 나타내는 표준 단일 유니코드 이모지 1개만 넣고, 6개 항목의 이모지가 서로 중복되지 않게 하세요.\n` +
        `4) 서로 중복되지 않는 단어 6개와, 각 단어당 뜻·그림이 겹치지 않는 분명히 다른 오답 보기 2개(distractors)를 만드세요.\n` +
        `5) 낱말의 끝 글자를 절대 임의로 자르지 말고 온전한 표준어 낱말만 쓰세요.`;

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
                        distractors: { type: 'ARRAY', items: { type: 'STRING' } }
                    },
                    required: ['word', 'hint', 'emoji', 'distractors']
                }
            }
        },
        required: ['title', 'items']
    };
    return { prompt, schema };
}

function buildGeminiPromptAndSchema(opts) {
    const { subject } = opts;
    if (subject === 'science' || subject === 'history') {
        return buildDiscoveryPromptAndSchema(opts);
    }
    if (subject === 'reading') {
        return buildReadingPromptAndSchema(opts);
    }
    if (subject === 'math') {
        return buildMathPromptAndSchema(opts);
    }
    return buildLanguagePromptAndSchema(opts);
}

module.exports = {
    detectReadingGenre,
    buildGeminiPromptAndSchema
};
