/**
 * ==============================================================================
 * 오프라인 안전 문제 은행 및 금지어/안전 이모지 풀 (fallbackBank.data.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 순수 한국어/기본 영어 단어만 엄선
 * [규칙 3] 500줄 이하 모듈화 | 레벨별 8단어 확충 (6문항 + 교체 여유분)
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
        { word: '우유', hint: '건강해지는 맛있는 우유', emoji: '🥛', choices: ['우유', '사과', '모자'] },
        { word: '아가', hint: '방긋 웃는 귀여운 아가', emoji: '👶', choices: ['아가', '오리', '여우'] },
        { word: '오리', hint: '뒤뚱뒤뚱 노란 오리', emoji: '🦆', choices: ['오리', '나비', '하마'] },
        { word: '바다', hint: '파도가 찰랑찰랑 파란 바다', emoji: '🌊', choices: ['바다', '포도', '모자'] }
    ],
    2: [
        { word: '사과', hint: '빨갛고 아삭한 과일 사과', emoji: '🍎', choices: ['사과', '바나나', '포도'] },
        { word: '바나나', hint: '노랗고 길쭉한 바나나', emoji: '🍌', choices: ['바나나', '딸기', '수박'] },
        { word: '기차', hint: '칙칙폭폭 달리는 기차', emoji: '🚂', choices: ['기차', '버스', '배'] },
        { word: '모자', hint: '햇빛을 가려주는 모자', emoji: '🧢', choices: ['모자', '신발', '가방'] },
        { word: '고양이', hint: '야옹야옹 귀여운 고양이', emoji: '🐱', choices: ['고양이', '강아지', '토끼'] },
        { word: '포도', hint: '보라색 알맹이가 송이송이 포도', emoji: '🍇', choices: ['포도', '체리', '사과'] },
        { word: '구름', hint: '하늘에 둥실둥실 솜사탕 구름', emoji: '☁️', choices: ['구름', '별님', '햇님'] },
        { word: '나비', hint: '꽃밭을 팔랑팔랑 날아다니는 나비', emoji: '🦋', choices: ['나비', '개구리', '거북이'] }
    ],
    3: [
        { word: '토끼', hint: '깡충깡충 귀가 긴 토끼', emoji: '🐰', choices: ['토끼', '여우', '사자'] },
        { word: '딸기', hint: '새콤달콤 빨간 딸기', emoji: '🍓', choices: ['딸기', '수박', '참외'] },
        { word: '코끼리', hint: '코가 길고 힘센 코끼리', emoji: '🐘', choices: ['코끼리', '기린', '하마'] },
        { word: '우산', hint: '비 오는 날 쓰는 우산', emoji: '☂️', choices: ['우산', '장화', '구름'] },
        { word: '무지개', hint: '비 온 뒤에 뜨는 일곱 색깔 무지개', emoji: '🌈', choices: ['무지개', '구름', '별빛'] },
        { word: '비행기', hint: '구름 위를 슝 날아가는 비행기', emoji: '✈️', choices: ['비행기', '자동차', '기차'] },
        { word: '개구리', hint: '연못에서 폴짝폴짝 개굴개굴', emoji: '🐸', choices: ['개구리', '문어', '참새'] },
        { word: '해바라기', hint: '노란 해를 닮은 예쁜 꽃', emoji: '🌻', choices: ['해바라기', '민들레', '진달래'] }
    ],
    4: [
        { word: '공룡', hint: '크앙! 씩씩한 공룡 친구', emoji: '🦖', choices: ['공룡', '악어', '거북이'] },
        { word: '별님', hint: '밤하늘에 반짝반짝 별님', emoji: '⭐', choices: ['별님', '달님', '햇님'] },
        { word: '소방차', hint: '불을 끄는 멋진 소방차', emoji: '🚒', choices: ['소방차', '경찰차', '구급차'] },
        { word: '수박', hint: '시원하고 달콤한 여름 과일', emoji: '🍉', choices: ['수박', '포도', '복숭아'] },
        { word: '거북이', hint: '느릿느릿 바다를 헤엄치는 거북이', emoji: '🐢', choices: ['거북이', '문어', '꽃게'] },
        { word: '우주선', hint: '별나라로 출발하는 로켓 우주선', emoji: '🚀', choices: ['우주선', '비행기', '잠수함'] },
        { word: '도토리', hint: '다람쥐가 좋아하는 동글동글 열매', emoji: '🌰', choices: ['도토리', '밤송이', '호두'] },
        { word: '눈사람', hint: '하얀 겨울에 만드는 둥근 친구', emoji: '⛄', choices: ['눈사람', '눈꽃', '썰매'] }
    ],
    5: [
        { word: '반짝이는 별', hint: '밤하늘에 빛나는 별을 써 보아요', emoji: '⭐', choices: ['반짝이는 별', '파란 바다', '빨간 사과'] },
        { word: '씩씩한 공룡', hint: '푸른 숲을 걷는 공룡 문장이에요', emoji: '🦕', choices: ['씩씩한 공룡', '작은 토끼', '예쁜 나비'] },
        { word: '신나는 소풍', hint: '가족과 함께 가는 소풍', emoji: '🎈', choices: ['신나는 소풍', '따뜻한 집', '맛있는 간식'] },
        { word: '우주선 여행', hint: '달나라로 날아가는 우주선', emoji: '🚀', choices: ['우주선 여행', '기차 놀이', '바다 수영'] },
        { word: '달콤한 딸기', hint: '봄에 먹는 맛있는 딸기', emoji: '🍓', choices: ['달콤한 딸기', '시원한 바람', '노란 병아리'] },
        { word: '파란 바닷가', hint: '고래 친구가 헤엄치는 푸른 바다', emoji: '🐳', choices: ['파란 바닷가', '초록 숲속', '하얀 구름'] },
        { word: '알록달록 꽃밭', hint: '나비가 춤추는 향기로운 꽃밭', emoji: '🌸', choices: ['알록달록 꽃밭', '고요한 밤하늘', '넓은 운동장'] },
        { word: '고마운 우리 가족', hint: '사랑하는 가족에게 쓰는 예쁜 말', emoji: '🏡', choices: ['고마운 우리 가족', '귀여운 강아지', '따뜻한 햇살'] }
    ]
};

const ENGLISH_BANK = {
    1: [
        { word: 'A', meaning: '에이 (사과 Apple의 첫 글자)', emoji: '🍎', choices: ['A', 'B', 'C'] },
        { word: 'B', meaning: '비 (공 Ball의 첫 글자)', emoji: '⚽', choices: ['B', 'A', 'D'] },
        { word: 'C', meaning: '씨 (고양이 Cat의 첫 글자)', emoji: '🐱', choices: ['C', 'B', 'E'] },
        { word: 'D', meaning: '디 (강아지 Dog의 첫 글자)', emoji: '🐶', choices: ['D', 'C', 'F'] },
        { word: 'E', meaning: '이 (달걀 Egg의 첫 글자)', emoji: '🥚', choices: ['E', 'F', 'A'] },
        { word: 'F', meaning: '에프 (물고기 Fish의 첫 글자)', emoji: '🐠', choices: ['F', 'E', 'G'] },
        { word: 'G', meaning: '지 (포도 Grape의 첫 글자)', emoji: '🍇', choices: ['G', 'D', 'H'] },
        { word: 'S', meaning: '에스 (별 Star의 첫 글자)', emoji: '⭐', choices: ['S', 'C', 'B'] }
    ],
    2: [
        { word: 'CAT', meaning: '고양이 (야옹!)', emoji: '🐱', choices: ['CAT', 'DOG', 'SUN'] },
        { word: 'DOG', meaning: '강아지 (멍멍!)', emoji: '🐶', choices: ['DOG', 'PIG', 'COW'] },
        { word: 'SUN', meaning: '해 / 태양', emoji: '☀️', choices: ['SUN', 'MOON', 'STAR'] },
        { word: 'BUS', meaning: '부릉부릉 버스', emoji: '🚌', choices: ['BUS', 'CAR', 'BOAT'] },
        { word: 'BEE', meaning: '윙윙 꿀벌', emoji: '🐝', choices: ['BEE', 'BUG', 'ANT'] },
        { word: 'PIG', meaning: '꿀꿀 귀여운 돼지', emoji: '🐷', choices: ['PIG', 'FOX', 'CAT'] },
        { word: 'FOX', meaning: '영리한 여우', emoji: '🦊', choices: ['FOX', 'DOG', 'OWL'] },
        { word: 'HAT', meaning: '멋진 모자', emoji: '🧢', choices: ['HAT', 'BAG', 'CUP'] }
    ],
    3: [
        { word: 'APPLE', meaning: '빨간 사과', emoji: '🍎', choices: ['APPLE', 'GRAPE', 'MELON'] },
        { word: 'BEAR', meaning: '귀여운 곰', emoji: '🐻', choices: ['BEAR', 'LION', 'FROG'] },
        { word: 'STAR', meaning: '반짝반짝 별', emoji: '⭐', choices: ['STAR', 'MOON', 'CLOUD'] },
        { word: 'FISH', meaning: '헤엄치는 물고기', emoji: '🐠', choices: ['FISH', 'CRAB', 'WHALE'] },
        { word: 'MOON', meaning: '밤하늘의 달', emoji: '🌙', choices: ['MOON', 'STAR', 'CLOUD'] },
        { word: 'FROG', meaning: '폴짝폴짝 개구리', emoji: '🐸', choices: ['FROG', 'DUCK', 'BEAR'] },
        { word: 'TRAIN', meaning: '칙칙폭폭 기차', emoji: '🚂', choices: ['TRAIN', 'TRUCK', 'PLANE'] },
        { word: 'GRAPE', meaning: '달콤한 포도', emoji: '🍇', choices: ['GRAPE', 'PEACH', 'LEMON'] }
    ],
    4: [
        { word: 'RABBIT', meaning: '깡충깡충 토끼', emoji: '🐰', choices: ['RABBIT', 'MONKEY', 'TIGER'] },
        { word: 'BANANA', meaning: '노란 바나나', emoji: '🍌', choices: ['BANANA', 'ORANGE', 'CHERRY'] },
        { word: 'ROCKET', meaning: '우주로 가는 로켓', emoji: '🚀', choices: ['ROCKET', 'TRAIN', 'PLANE'] },
        { word: 'FLOWER', meaning: '향기로운 꽃', emoji: '🌸', choices: ['FLOWER', 'FOREST', 'RIVER'] },
        { word: 'TURTLE', meaning: '느긋한 거북이', emoji: '🐢', choices: ['TURTLE', 'DOLPHIN', 'WHALE'] },
        { word: 'ORANGE', meaning: '상큼한 오렌지', emoji: '🍊', choices: ['ORANGE', 'BANANA', 'MELON'] },
        { word: 'PLANET', meaning: '우주의 반짝 행성', emoji: '🪐', choices: ['PLANET', 'ROCKET', 'GALAXY'] },
        { word: 'MONKEY', meaning: '장난꾸러기 원숭이', emoji: '🐵', choices: ['MONKEY', 'RABBIT', 'PANDA'] }
    ],
    5: [
        { word: 'DINOSAUR', meaning: '커다란 공룡', emoji: '🦕', choices: ['DINOSAUR', 'ELEPHANT', 'KANGAROO'] },
        { word: 'RAINBOW', meaning: '일곱 색깔 무지개', emoji: '🌈', choices: ['RAINBOW', 'SUNSHINE', 'MOUNTAIN'] },
        { word: 'DOLPHIN', meaning: '바다 친구 돌고래', emoji: '🐬', choices: ['DOLPHIN', 'PENGUIN', 'TURTLE'] },
        { word: 'STRAWBERRY', meaning: '달콤한 딸기', emoji: '🍓', choices: ['STRAWBERRY', 'WATERMELON', 'PINEAPPLE'] },
        { word: 'ELEPHANT', meaning: '코가 긴 코끼리', emoji: '🐘', choices: ['ELEPHANT', 'KANGAROO', 'GIRAFFE'] },
        { word: 'BUTTERFLY', meaning: '예쁜 날개 나비', emoji: '🦋', choices: ['BUTTERFLY', 'DRAGONFLY', 'LADYBUG'] },
        { word: 'WATERMELON', meaning: '시원한 여름 수박', emoji: '🍉', choices: ['WATERMELON', 'BLUEBERRY', 'PINEAPPLE'] },
        { word: 'ASTRONAUT', meaning: '우주를 여행하는 대원', emoji: '👩‍🚀', choices: ['ASTRONAUT', 'SPACESHIP', 'ADVENTURE'] }
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
