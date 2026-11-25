/**
 * ==============================================================================
 * 공교육 기초학력 표준 진도표 & 내장 어휘 데이터 (curriculumKorea.data.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아·초등 저학년 친화 한국어 | [규칙 3] 500줄 이하 모듈화
 * - 국가기초학력지원포털(basics.go.kr) & 누리과정·초등 1학년 준비 진도 정렬
 * ==============================================================================
 */

const CURRICULUM_SUBJECTS = [
    { id: 'korean', label: '한글·국어 (우리말 사전)', emoji: '🇰🇷', badgeColor: '#ef4444' },
    { id: 'math', label: '수·연산·도형', emoji: '🔢', badgeColor: '#3b82f6' },
    { id: 'english', label: '기초 영어·파닉스', emoji: '🔤', badgeColor: '#10b981' },
    { id: 'science', label: '자연·과학 탐험 (날씨·달·생물)', emoji: '🌱', badgeColor: '#059669' },
    { id: 'reading', label: '그림동화·이야기 말하기', emoji: '📖', badgeColor: '#8b5cf6' }
];

const CURRICULUM_TREE = {
    korean: [
        {
            level: 1,
            unitCode: 'KOR-B1',
            title: '① 기본 모음·자음 소리 익히기',
            goal: '아·야·어·여 기본 모음과 ㄱ·ㄴ·ㅁ·ㅅ 소리를 1~2글자 낱말로 구분해요.',
            recommendedTheme: '동물 친구',
            keywords: ['사자', '여우', '나비', '하마', '오리', '모자'],
            promptGuidance: '모음(아,어,오,우,이)과 받침 없는 1~2글자 기초 낱말 중심'
        },
        {
            level: 2,
            unitCode: 'KOR-B2',
            title: '② 받침 없는 글자 조합과 낱말',
            goal: '자음과 모음이 만나 소리가 나는 원리를 알고 일상 사물 낱말을 읽어요.',
            recommendedTheme: '우리말 고운 낱말',
            keywords: ['바나나', '포도', '토마토', '우유', '기차', '구두'],
            promptGuidance: '받침 없는 2~3글자 생활 친숙 낱말(사물·음식·탈것)'
        },
        {
            level: 3,
            unitCode: 'KOR-B3',
            title: '③ 대표 받침(ㅇ·ㄴ·ㄹ·ㅁ·ㄱ·ㅂ) 읽기',
            goal: '글자 아래 받침이 들어간 낱말의 뜻과 그림을 정확히 연결해요.',
            recommendedTheme: '공룡 탐험',
            keywords: ['사과', '공룡', '별님', '햇님', '물감', '가방'],
            promptGuidance: '기본 받침(ㄱ,ㄴ,ㄹ,ㅁ,ㅂ,ㅇ) 1개가 들어간 2~3글자 낱말'
        },
        {
            level: 4,
            unitCode: 'KOR-B4',
            title: '④ 쌍자음·이중모음과 풍부한 낱말',
            goal: 'ㄲ·ㄸ·ㅃ·ㅆ·ㅉ와 ㅐ·ㅔ·ㅘ·ㅝ가 들어간 낱말을 바르게 구분해요.',
            recommendedTheme: '우리말 고운 낱말',
            keywords: ['꼬마', '딸기', '코끼리', '무지개', '시계', '다람쥐'],
            promptGuidance: '쌍자음·복합모음 포함 3~4글자 낱말과 의성어/의태어'
        },
        {
            level: 5,
            unitCode: 'KOR-B5',
            title: '⑤ 짧은 문장 읽기와 바른 어휘',
            goal: '두 어절 이상의 짧은 문장을 읽고 낱말의 알맞은 쓰임을 이해해요.',
            recommendedTheme: '우주 모험',
            keywords: ['반짝이는 별', '푸른 하늘', '달리는 기차', '웃는 친구'],
            promptGuidance: '꾸며주는 말 + 명사 2어절 구문 및 짧은 기초 문장 이해'
        }
    ],
    math: [
        {
            level: 1,
            unitCode: 'MAT-B1',
            title: '① 1~10 수 세기와 가르기·모으기',
            goal: '그림 개수를 하나씩 정확히 세고 5와 10의 짝꿍 수를 이해해요.',
            recommendedTheme: '동물 친구',
            keywords: ['하나', '둘', '다섯', '모으기', '가르기'],
            promptGuidance: '1~10 구체물 수 세기 및 수 크기 비교'
        },
        {
            level: 2,
            unitCode: 'MAT-B2',
            title: '② 10을 넘지 않는 한 자리 덧셈·뺄셈',
            goal: '그림과 손가락 세기를 통해 10 이하 더하기와 빼기를 계산해요.',
            recommendedTheme: '달콤 과일',
            keywords: ['더하기', '빼기', '합이 10', '나머지'],
            promptGuidance: '합이 10 이하인 한 자리 수 덧셈·뺄셈'
        },
        {
            level: 3,
            unitCode: 'MAT-B3',
            title: '③ 100까지 수 · 시계 정각과 30분',
            goal: '십의 자리·일의 자리를 알고 시계의 짧은바늘·긴바늘 시각을 읽어요.',
            recommendedTheme: '탈것 여행',
            keywords: ['십모형', '정각', '30분', '시계'],
            promptGuidance: '두 자리 수 개념, 20 이하 연산 및 시계 정각·30분 읽기'
        },
        {
            level: 4,
            unitCode: 'MAT-B4',
            title: '④ 받아올림·받아내림 & 동전 계산',
            goal: '100원·50원·10원 동전을 모으고 받아올림 덧셈을 풀어요.',
            recommendedTheme: '우주 모험',
            keywords: ['100원', '받아올림', '50원', '거스름돈'],
            promptGuidance: '두 자리 덧셈·뺄셈과 동전(10원/50원/100원) 합 구하기'
        },
        {
            level: 5,
            unitCode: 'MAT-B5',
            title: '⑤ 묶어 세기·구구단 기초와 문장제',
            goal: '같은 수씩 뛰어 세고 짧은 생활 속 수학 이야기를 식으로 풀어요.',
            recommendedTheme: '로봇·변신',
            keywords: ['묶어 세기', '2단', '5단', '문장제'],
            promptGuidance: '2·3·5씩 묶어 세기(곱셈 기초)와 간단한 문장제'
        }
    ],
    english: [
        {
            level: 1,
            unitCode: 'ENG-B1',
            title: '① 알파벳 대문자 A~Z 모양과 소리',
            goal: 'A부터 Z까지 대문자를 보고 대표 첫소리 낱말과 연결해요.',
            recommendedTheme: '동물 친구',
            keywords: ['A', 'B', 'C', 'D', 'E', 'Z'],
            promptGuidance: '알파벳 대문자 1글자와 친숙한 한국어 뜻 연결'
        },
        {
            level: 2,
            unitCode: 'ENG-B2',
            title: '② 3글자 파닉스 기초 낱말',
            goal: 'CAT, DOG, SUN처럼 짧은 3글자 영어 낱말을 소리 내어 읽어요.',
            recommendedTheme: '동물 친구',
            keywords: ['CAT', 'DOG', 'SUN', 'BUS', 'PIG', 'HAT'],
            promptGuidance: 'CVC 3글자 파닉스 기초 영단어'
        },
        {
            level: 3,
            unitCode: 'ENG-B3',
            title: '③ 우리 주변 색깔·과일·탈것 영단어',
            goal: 'APPLE, BLUE, TRAIN 등 자주 쓰는 4~5글자 낱말을 익혀요.',
            recommendedTheme: '달콤 과일',
            keywords: ['APPLE', 'GRAPE', 'RED', 'BLUE', 'TRAIN', 'STAR'],
            promptGuidance: '색깔·과일·생활 사물 4~5글자 영단어'
        },
        {
            level: 4,
            unitCode: 'ENG-B4',
            title: '④ 자연·동물·우주 5~7글자 낱말',
            goal: 'TIGER, RABBIT, ROCKET처럼 그림을 보고 낱말을 골라요.',
            recommendedTheme: '우주 모험',
            keywords: ['TIGER', 'RABBIT', 'ROCKET', 'PLANET', 'ORANGE'],
            promptGuidance: '동물·자연·우주 테마 5~7글자 영단어'
        },
        {
            level: 5,
            unitCode: 'ENG-B5',
            title: '⑤ 생활 속 기초 표현 & 긴 영단어',
            goal: 'ELEPHANT, BUTTERFLY와 같은 어휘와 반가운 인사말을 읽어요.',
            recommendedTheme: '바다 친구',
            keywords: ['ELEPHANT', 'DOLPHIN', 'BUTTERFLY', 'MORNING'],
            promptGuidance: '어린이 생활 친화 7~9글자 영단어 및 인사 어휘'
        }
    ],
    science: [
        {
            level: 1,
            unitCode: 'SCI-B1',
            title: '① 낮과 밤 · 하늘의 해와 달 관찰',
            goal: '초승달·보름달 등 오늘 밤하늘 달 모양과 해·별의 특징을 알아봐요.',
            recommendedTheme: '오늘 밤하늘과 달',
            keywords: ['초승달', '보름달', '햇님', '별빛'],
            promptGuidance: '낮과 밤의 차이, 달의 모양 변화(초승달·상현달·보름달) 쉬운 관찰 동화'
        },
        {
            level: 2,
            unitCode: 'SCI-B2',
            title: '② 오늘의 날씨와 사계절 변화',
            goal: '맑음·구름·비·눈 등 오늘의 날씨와 봄·여름·가을·겨울을 배워요.',
            recommendedTheme: '오늘 날씨와 계절',
            keywords: ['구름', '소나기', '무지개', '사계절'],
            promptGuidance: '비·눈·구름·바람이 생기는 이유와 계절에 따른 자연의 모습'
        },
        {
            level: 3,
            unitCode: 'SCI-B3',
            title: '③ 우리나라 숲과 들판의 동식물',
            goal: '한반도에 사는 다람쥐·곤충·꽃·나무가 어떻게 자라는지 탐험해요.',
            recommendedTheme: '우리나라 숲속 생물',
            keywords: ['다람쥐', '민들레', '나비', '도토리'],
            promptGuidance: '우리나라 산과 들에 사는 동식물의 먹이와 보금자리 특징'
        },
        {
            level: 4,
            unitCode: 'SCI-B4',
            title: '④ 신비한 바다 생물과 물의 여행',
            goal: '갯벌과 바다에 사는 생물들을 만나고 물의 순환을 이해해요.',
            recommendedTheme: '신비한 바다 생물',
            keywords: ['고래', '바다거북', '갯벌', '산호초'],
            promptGuidance: '강과 바다 생태계 생물 다양성과 물이 구름·비가 되는 과정'
        },
        {
            level: 5,
            unitCode: 'SCI-B5',
            title: '⑤ 태양계 우주와 소중한 지구 지키기',
            goal: '지구와 행성들의 비밀을 알고 자연과 생물을 보호하는 방법을 실천해요.',
            recommendedTheme: '태양계 우주 탐험',
            keywords: ['지구', '토성', '생물다양성', '환경보호'],
            promptGuidance: '태양계 행성 특징과 지구 생태계·멸종위기 생물을 아끼는 과학 이야기'
        }
    ],
    reading: [
        {
            level: 1,
            unitCode: 'RED-B1',
            title: '① 의성어·의태어 리듬 동화 읽기',
            goal: '폴짝폴짝, 반짝반짝 재미있는 소리와 모양 낱말을 소리 내어 따라 말해요.',
            recommendedTheme: '동물 친구',
            keywords: ['폴짝폴짝', '반짝반짝', '아장아장'],
            promptGuidance: '의성어·의태어가 반복되는 짧고 리듬감 있는 1문장 유아 동화'
        },
        {
            level: 2,
            unitCode: 'RED-B2',
            title: '② 누가·무엇을 했는지 내용 찾기',
            goal: '단짝 포켓몬과 함께한 모험 이야기를 듣고 주인공이 한 일을 기억해요.',
            recommendedTheme: '단짝 포켓몬 모험',
            keywords: ['주인공', '출발', '도움', '보물'],
            promptGuidance: '뚜렷한 사건 순서가 있는 따뜻한 우정 동화와 사실 확인 퀴즈'
        },
        {
            level: 3,
            unitCode: 'RED-B3',
            title: '③ 친구의 기분과 마음 공감하기',
            goal: '이야기 속 친구가 왜 기쁘거나 속상했는지 마음을 헤아려 보아요.',
            recommendedTheme: '숲속 요정 마을',
            keywords: ['고마워', '미안해', '용기', '배려'],
            promptGuidance: '감정 표현(기쁨·설렘·고마움·용기)과 친구 배려를 다룬 창작 동화'
        },
        {
            level: 4,
            unitCode: 'RED-B4',
            title: '④ 왜 그랬을까? 원인과 결과 알기',
            goal: '사건이 일어난 까닭과 해결 방법을 연결하며 이야기를 깊이 읽어요.',
            recommendedTheme: '별나라 우주 여행',
            keywords: ['까닭', '해결', '지혜', '협동'],
            promptGuidance: '작은 문제를 지혜와 협동으로 해결하는 인과관계 중심 동화'
        },
        {
            level: 5,
            unitCode: 'RED-B5',
            title: '⑤ 풍부한 표현으로 생각 말하기',
            goal: '조금 더 긴 문장을 또박또박 낭독하고 이야기의 교훈을 찾아보아요.',
            recommendedTheme: '바닷속 인어 왕국',
            keywords: ['상상', '약속', '모험', '낭독'],
            promptGuidance: '어휘가 풍부한 2문장 구성 창작 동화와 추론형 독해 퀴즈'
        }
    ]
};

const LOCAL_KOREAN_DICT_WORDS = [
    { word: '사과', pos: '명사', level: 1, definition: '둥글고 빨간 껍질에 아삭하고 달콤한 과일이에요.', example: '아침에 시원한 사과를 한 조각 먹었어요.' },
    { word: '나비', pos: '명사', level: 1, definition: '예쁜 무늬 날개를 팔랑팔랑 움직이며 꽃에 앉는 곤충이에요.', example: '노란 나비가 꽃밭 위를 날아다녀요.' },
    { word: '사자', pos: '명사', level: 1, definition: '커다란 갈기를 가진 씩씩하고 힘센 동물이에요.', example: '아기 사자가 초원에서 어슬렁거려요.' },
    { word: '우유', pos: '명사', level: 2, definition: '젖소에게서 얻는 하얗고 영양이 듬뿍 든 마실 것이에요.', example: '키가 쑥쑥 크려고 따뜻한 우유를 마셔요.' },
    { word: '기차', pos: '명사', level: 2, definition: '철길 위를 길게 이어져 달리는 커다란 탈것이에요.', example: '칙칙폭폭 기차를 타고 할머니 댁에 가요.' },
    { word: '토마토', pos: '명사', level: 2, definition: '빨갛고 동글동글하며 비타민이 많은 채소이자 과일이에요.', example: '도시락에 방울 토마토를 담았어요.' },
    { word: '공룡', pos: '명사', level: 3, definition: '아주 오랜 옛날 지구에 살았던 커다란 파충류 동물이에요.', example: '티라노사우루스는 가장 유명한 공룡이에요.' },
    { word: '무지개', pos: '명사', level: 4, definition: '비가 온 뒤 햇빛이 비쳐 하늘에 뜨는 일곱 빛깔 띠예요.', example: '소나기가 그치자 하늘에 예쁜 무지개가 떴어요.' },
    { word: '코끼리', pos: '명사', level: 4, definition: '긴 코와 커다란 귀를 가진 육지의 가장 큰 동물이에요.', example: '코끼리가 긴 코로 시원한 물을 뿌려요.' },
    { word: '다람쥐', pos: '명사', level: 4, definition: '복슬복슬한 꼬리를 달고 도토리를 좋아하는 작은 동물이에요.', example: '숲속 다람쥐가 도토리를 볼에 가득 넣었어요.' },
    { word: '하늘', pos: '명사', level: 3, definition: '땅 위쪽으로 끝없이 넓게 펼쳐진 파란 공간이에요.', example: '뭉게구름이 맑은 하늘에 두둥실 떠 있어요.' },
    { word: '별빛', pos: '명사', level: 5, definition: '깜깜한 밤하늘에서 반짝반짝 비치는 별의 빛이에요.', example: '창문 너머로 고운 별빛이 반짝여요.' },
    { word: '우주선', pos: '명사', level: 5, definition: '별과 달을 탐험하기 위해 지구 밖 우주로 날아가는 배예요.', example: '우리 가족이 멋진 우주선을 타고 달에 가요.' }
];

function splitHangulSyllables(word) {
    return Array.from(String(word || '').trim()).filter((ch) => /[가-힣]/.test(ch));
}

function getCurriculumPromptHint(subject, level = 1) {
    const units = CURRICULUM_TREE[subject];
    if (!Array.isArray(units) || !units.length) return '';
    const lv = Math.min(Math.max(Number(level) || 1, 1), units.length);
    const unit = units.find((u) => u.level === lv) || units[0];
    return `${unit.title}: ${unit.promptGuidance}`;
}

function buildCurriculumStatus({ levels = {}, completedCounts = {} }) {
    let totalUnits = 0;
    let completedUnits = 0;
    const subjects = CURRICULUM_SUBJECTS.map((subjMeta) => {
        const currentLv = Math.min(Math.max(Number(levels[subjMeta.id]) || 1, 1), 5);
        const doneSheets = Number(completedCounts[subjMeta.id] || 0);
        const units = (CURRICULUM_TREE[subjMeta.id] || []).map((u) => {
            totalUnits += 1;
            let state = 'locked';
            if (u.level < currentLv) {
                state = 'completed';
                completedUnits += 1;
            } else if (u.level === currentLv) {
                state = 'active';
            }
            return { ...u, state };
        });
        const activeUnit = units.find((u) => u.state === 'active') || units[units.length - 1];
        return {
            ...subjMeta,
            currentLevel: currentLv,
            completedSheets: doneSheets,
            activeUnit,
            units
        };
    });

    const overallPercent = totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;
    return {
        standardName: '국가기초학력지원포털(basics.go.kr) · 누리·초등 1학년 연계 진도표',
        totalUnits,
        completedUnits,
        overallPercent,
        subjects
    };
}

module.exports = {
    CURRICULUM_SUBJECTS,
    CURRICULUM_TREE,
    LOCAL_KOREAN_DICT_WORDS,
    splitHangulSyllables,
    getCurriculumPromptHint,
    buildCurriculumStatus
};
