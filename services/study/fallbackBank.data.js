/**
 * ==============================================================================
 * 오프라인 안전 문제 은행 및 금지어/안전 이모지 풀 (fallbackBank.data.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 순수 한국어/기본 영어 단어만 엄선
 * [규칙 3] Gemini 장애/할당량 초과 시 즉시 고품질 오프라인 학습지 제공
 * ==============================================================================
 */

const BANNED_WORDS = [
    '죽음', '살인', '폭력', '피', '전쟁', '총', '칼', '술', '담배',
    '욕', '바보', '멍청이', '귀신', '괴물', '지옥', '도박', '범죄', '마약'
];

const THEME_EMOJI_MAP = {
    '동물': ['🐶', '🐱', '🐰', '🐻', '🦊', '🦁', '🐼', '🐸'],
    '공룡': ['🦕', '🦖', '🥚', '🌿', '🌋', '⭐', '🪨', '🐾'],
    '과일': ['🍎', '🍌', '🍓', '🍇', '🍊', '🍉', '🍑', '🥝'],
    '탈것': ['🚗', '🚌', '🚒', '🚓', '🚂', '✈️', '🚀', '⛵'],
    '우주': ['🚀', '🌙', '⭐', '🪐', '☀️', '🛸', '🌍', '☄️'],
    '바다': ['🐳', '🐬', '🐠', '🐙', '🦀', '🐢', '🐚', '⭐'],
    '계절': ['🌸', '🌻', '🍁', '⛄', '☀️', '🌈', '☔', '🍃']
};

const SAFE_EMOJIS = [
    '🐶', '🐱', '🐰', '🐻', '🦊', '🦁', '🐼', '🐸', '🦕', '🦖',
    '🍎', '🍌', '🍓', '🍇', '🍊', '🍉', '🚗', '🚌', '🚒', '🚂',
    '🚀', '🌙', '⭐', '☀️', '🌈', '🐳', '🐠', '🐙', '🦋', '🌸', '🎈', '🎁'
];

const KOREAN_BANK = {
    1: [
        { word: '가', hint: '첫 번째 글자 가를 써 보아요', emoji: '🐶', choices: ['가', '나', '다'] },
        { word: '나', hint: '예쁜 나비의 나!', emoji: '🦋', choices: ['나', '가', '다'] },
        { word: '다', hint: '달콤한 딸기의 다와 친구예요', emoji: '🍓', choices: ['다', '라', '마'] },
        { word: '나무', hint: '초록색 나뭇잎이 달린 나무', emoji: '🌳', choices: ['나무', '바다', '구름'] },
        { word: '우유', hint: '건강해지는 맛있는 우유', emoji: '🥛', choices: ['우유', '사과', '모자'] }
    ],
    2: [
        { word: '사과', hint: '빨갛고 아삭한 과일 사과', emoji: '🍎', choices: ['사과', '바나나', '포도'] },
        { word: '바나나', hint: '노랗고 길쭉한 바나나', emoji: '🍌', choices: ['바나나', '딸기', '수박'] },
        { word: '기차', hint: '칙칙폭폭 달리는 기차', emoji: '🚂', choices: ['기차', '버스', '배'] },
        { word: '모자', hint: '햇빛을 가려주는 모자', emoji: '🧢', choices: ['모자', '신발', '가방'] },
        { word: '고양이', hint: '야옹야옹 귀여운 고양이', emoji: '🐱', choices: ['고양이', '강아지', '토끼'] }
    ],
    3: [
        { word: '토끼', hint: '깡충깡충 귀가 긴 토끼', emoji: '🐰', choices: ['토끼', '여우', '사자'] },
        { word: '딸기', hint: '새콤달콤 빨간 딸기', emoji: '🍓', choices: ['딸기', '수박', '참외'] },
        { word: '코끼리', hint: '코가 길고 힘센 코끼리', emoji: '🐘', choices: ['코끼리', '기린', '하마'] },
        { word: '우산', hint: '비 오는 날 쓰는 우산', emoji: '☂️', choices: ['우산', '장화', '구름'] },
        { word: '무지개', hint: '비 온 뒤에 뜨는 일곱 색깔 무지개', emoji: '🌈', choices: ['무지개', '구름', '별빛'] }
    ],
    4: [
        { word: '공룡', hint: '크앙! 씩씩한 공룡 친구', emoji: '🦖', choices: ['공룡', '악어', '거북이'] },
        { word: '별님', hint: '밤하늘에 반짝반짝 별님', emoji: '⭐', choices: ['별님', '달님', '햇님'] },
        { word: '소방차', hint: '불을 끄는 멋진 소방차', emoji: '🚒', choices: ['소방차', '경찰차', '구급차'] },
        { word: '수박', hint: '시원하고 달콤한 여름 과일', emoji: '🍉', choices: ['수박', '포도', '복숭아'] },
        { word: '거북이', hint: '느릿느릿 바다를 헤엄치는 거북이', emoji: '🐢', choices: ['거북이', '문어', '꽃게'] }
    ],
    5: [
        { word: '반짝이는 별', hint: '밤하늘에 빛나는 별을 써 보아요', emoji: '⭐', choices: ['반짝이는 별', '파란 바다', '빨간 사과'] },
        { word: '씩씩한 공룡', hint: '푸른 숲을 걷는 공룡 문장이에요', emoji: '🦕', choices: ['씩씩한 공룡', '작은 토끼', '예쁜 나비'] },
        { word: '신나는 소풍', hint: '가족과 함께 가는 소풍', emoji: '🎈', choices: ['신나는 소풍', '따뜻한 집', '맛있는 간식'] },
        { word: '우주선 여행', hint: '달나라로 날아가는 우주선', emoji: '🚀', choices: ['우주선 여행', '기차 놀이', '바다 수영'] },
        { word: '달콤한 딸기', hint: '봄에 먹는 맛있는 딸기', emoji: '🍓', choices: ['달콤한 딸기', '시원한 바람', '노란 병아리'] }
    ]
};

const ENGLISH_BANK = {
    1: [
        { word: 'A', meaning: '에이 (사과 Apple의 첫 글자)', emoji: '🍎', choices: ['A', 'B', 'C'] },
        { word: 'B', meaning: '비 (공 Ball의 첫 글자)', emoji: '⚽', choices: ['B', 'A', 'D'] },
        { word: 'C', meaning: '씨 (고양이 Cat의 첫 글자)', emoji: '🐱', choices: ['C', 'B', 'E'] },
        { word: 'D', meaning: '디 (강아지 Dog의 첫 글자)', emoji: '🐶', choices: ['D', 'C', 'F'] }
    ],
    2: [
        { word: 'CAT', meaning: '고양이 (야옹!)', emoji: '🐱', choices: ['CAT', 'DOG', 'SUN'] },
        { word: 'DOG', meaning: '강아지 (멍멍!)', emoji: '🐶', choices: ['DOG', 'PIG', 'COW'] },
        { word: 'SUN', meaning: '해 / 태양', emoji: '☀️', choices: ['SUN', 'MOON', 'STAR'] },
        { word: 'BUS', meaning: '부릉부릉 버스', emoji: '🚌', choices: ['BUS', 'CAR', 'BOAT'] }
    ],
    3: [
        { word: 'APPLE', meaning: '빨간 사과', emoji: '🍎', choices: ['APPLE', 'GRAPE', 'MELON'] },
        { word: 'BEAR', meaning: '귀여운 곰', emoji: '🐻', choices: ['BEAR', 'LION', 'FROG'] },
        { word: 'STAR', meaning: '반짝반짝 별', emoji: '⭐', choices: ['STAR', 'MOON', 'CLOUD'] },
        { word: 'FISH', meaning: '헤엄치는 물고기', emoji: '🐠', choices: ['FISH', 'CRAB', 'WHALE'] }
    ],
    4: [
        { word: 'RABBIT', meaning: '깡충깡충 토끼', emoji: '🐰', choices: ['RABBIT', 'MONKEY', 'TIGER'] },
        { word: 'BANANA', meaning: '노란 바나나', emoji: '🍌', choices: ['BANANA', 'ORANGE', 'CHERRY'] },
        { word: 'ROCKET', meaning: '우주로 가는 로켓', emoji: '🚀', choices: ['ROCKET', 'TRAIN', 'PLANE'] },
        { word: 'FLOWER', meaning: '향기로운 꽃', emoji: '🌸', choices: ['FLOWER', 'FOREST', 'RIVER'] }
    ],
    5: [
        { word: 'DINOSAUR', meaning: '커다란 공룡', emoji: '🦕', choices: ['DINOSAUR', 'ELEPHANT', 'KANGAROO'] },
        { word: 'RAINBOW', meaning: '일곱 색깔 무지개', emoji: '🌈', choices: ['RAINBOW', 'SUNSHINE', 'MOUNTAIN'] },
        { word: 'DOLPHIN', meaning: '바다 친구 돌고래', emoji: '🐬', choices: ['DOLPHIN', 'PENGUIN', 'TURTLE'] },
        { word: 'STRAWBERRY', meaning: '달콤한 딸기', emoji: '🍓', choices: ['STRAWBERRY', 'WATERMELON', 'PINEAPPLE'] }
    ]
};

function pickThemeEmojis(theme = '') {
    const clean = String(theme || '');
    for (const [k, pool] of Object.entries(THEME_EMOJI_MAP)) {
        if (clean.includes(k)) return pool;
    }
    return SAFE_EMOJIS;
}

module.exports = {
    BANNED_WORDS,
    SAFE_EMOJIS,
    THEME_EMOJI_MAP,
    KOREAN_BANK,
    ENGLISH_BANK,
    pickThemeEmojis
};
