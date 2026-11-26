/**
 * ==============================================================================
 * 자연·과학 / 역사·문화 탐구 학습지 & 전래·명작 동화 빌더
 * (studyDiscoveryWorksheet.service.js)
 * ------------------------------------------------------------------------------
 * - science / history: 포켓몬·판타지 0% [관찰·역사 도감 + 말하기 + 실사 퀴즈 + 짝짓기]
 * - reading: 전래동화·이솝우화 오프라인 폴백 템플릿 포함
 * ==============================================================================
 */

const { clampLevel } = require('./studyDb.service');

const FANTASY_LEAK_RE = /포켓몬|피카츄|파이리|꼬부기|이상해씨|이브이/;

function shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getDiscoverySourceBadge(subject, theme = '') {
    if (subject === 'history') return '🏛️ 국가유산청 · 위키백과';
    const t = String(theme || '');
    if (t.includes('달') || t.includes('우주') || t.includes('태양계')) return '📡 한국천문연구원 · NASA';
    if (t.includes('날씨') || t.includes('계절')) return '⛅ 기상청 단기예보 · 위키백과';
    return '🌿 국립생물자원관 · iNaturalist';
}

function assembleDiscoverySheet({ title, subject, theme, cards, voiceWord, quizzes, matchPairs }) {
    const isHistory = subject === 'history';
    const sourceBadge = getDiscoverySourceBadge(subject, theme);
    const quizBlocks = quizzes.map((q, idx) => ({
        id: `block-${idx + 3}`,
        type: 'quiz',
        prompt: q.prompt,
        ttsText: q.prompt,
        visualLeft: q.emoji || (isHistory ? '🏛️' : '🔬'),
        photoKeyword: q.photoKeyword || '',
        answer: q.answer,
        choices: shuffle(q.choices),
        hint: '앞에서 본 도감 카드를 떠올려 보면 바로 알 수 있어요!'
    }));

    const blocks = [
        {
            id: 'block-1',
            type: 'storybook',
            theme,
            pages: cards,
            badge: isHistory ? '🏛️ 어린이 역사 도감' : '🔬 오늘의 자연 관찰 도감',
            sourceBadge,
            prompt: '카드를 한 장씩 넘기며 생생한 사진과 설명을 들어 보아요!',
            ttsText: cards[0]?.ttsText || cards[0]?.text || ''
        },
        {
            id: 'block-2',
            type: 'voice_repeat',
            prompt: '마이크를 눌러 오늘 배운 핵심 문장을 큰 소리로 따라 말해 보세요!',
            ttsText: voiceWord,
            targetSentence: voiceWord,
            emoji: isHistory ? '🏛️' : '🔬',
            hint: '녹음한 내 목소리를 바로 다시 들어 볼 수도 있어요!'
        },
        ...quizBlocks
    ];

    if (Array.isArray(matchPairs) && matchPairs.length >= 2) {
        const pairs = matchPairs.slice(0, 3).map((p, idx) => ({
            id: `dm-${idx + 1}`,
            left: String(p.left || '').trim(),
            right: String(p.right || '').trim(),
            photoKeyword: String(p.photoKeyword || p.left || '').trim()
        }));
        blocks.push({
            id: `block-${blocks.length + 1}`,
            type: 'match',
            prompt: isHistory
                ? '인물·유물과 알맞은 설명을 두 번 탭해서 선으로 이어 주세요!'
                : '자연의 모습과 알맞은 설명을 두 번 탭해서 선으로 이어 주세요!',
            ttsText: isHistory ? '역사 이름과 알맞은 설명을 선으로 이어 주세요.' : '자연 이름과 알맞은 설명을 선으로 이어 주세요.',
            pairs,
            shuffledRights: shuffle(pairs.map((p) => p.right))
        });
    }

    return {
        title,
        sourceBadge,
        encouragement: isHistory
            ? '우리 역사와 문화유산을 멋지게 탐험한 꼬마 박사님! 🏛️✨'
            : '자연의 비밀을 꼼꼼히 관찰한 꼬마 과학자님! 최고예요! 🔬🌱',
        blocks
    };
}

function normalizeAiDiscoverySheet(rawAiJson, subject, level, theme) {
    if (!rawAiJson || !Array.isArray(rawAiJson.cards) || rawAiJson.cards.length < 3) return null;
    const rawStr = JSON.stringify(rawAiJson);
    if (FANTASY_LEAK_RE.test(rawStr)) return null;

    const lv = clampLevel(level);
    const maxCards = lv <= 2 ? 3 : 4;
    const maxQuizzes = lv <= 2 ? 2 : 3;

    const cards = rawAiJson.cards.slice(0, maxCards).map((c, i) => {
        const title = String(c.title || '').trim();
        const text = String(c.text || '').trim();
        const fullText = title ? `${title}. ${text}` : text;
        return {
            pageNo: i + 1,
            title,
            sceneEmoji: String(c.emoji || (subject === 'history' ? '🏛️' : '🔬')).slice(0, 6),
            photoKeyword: String(c.photoKeyword || '').trim().slice(0, 24),
            text: fullText,
            ttsText: fullText
        };
    }).filter((c) => c.text.length >= 6);

    if (cards.length < 3) return null;

    const quizzes = (Array.isArray(rawAiJson.quizzes) ? rawAiJson.quizzes : [])
        .slice(0, maxQuizzes)
        .map((q) => {
            const ans = String(q.answer || '').trim();
            const rawChoices = (Array.isArray(q.choices) ? q.choices : []).map((x) => String(x || '').trim()).filter(Boolean);
            const deduped = [];
            for (const c of rawChoices) {
                if (!deduped.includes(c)) deduped.push(c);
            }
            if (ans && !deduped.includes(ans)) deduped.unshift(ans);
            const fbPool = subject === 'history' ? ['한복', '거북선', '첨성대', '한글'] : ['보름달', '다람쥐', '민들레', '무지개'];
            for (const fb of fbPool) {
                if (deduped.length >= 3) break;
                if (!deduped.includes(fb)) deduped.push(fb);
            }
            const choices = shuffle(deduped.slice(0, 4));
            if (ans && !choices.includes(ans)) choices[0] = ans;
            return {
                prompt: String(q.prompt || '').trim(),
                emoji: String(q.emoji || (subject === 'history' ? '🏛️' : '🔬')).slice(0, 6),
                photoKeyword: String(q.photoKeyword || ans).trim().slice(0, 24),
                answer: ans,
                choices
            };
        })
        .filter((q) => q.prompt && q.answer);

    if (quizzes.length < 2) return null;

    const matchPairs = (Array.isArray(rawAiJson.matchPairs) ? rawAiJson.matchPairs : [])
        .filter((p) => p && p.left && p.right)
        .slice(0, 3);

    return assembleDiscoverySheet({
        title: String(rawAiJson.title || `${theme} 탐구 도감`).trim().slice(0, 48),
        subject,
        theme,
        cards,
        voiceWord: String(rawAiJson.voiceWord || cards[0].text).trim(),
        quizzes,
        matchPairs
    });
}

const SCIENCE_FALLBACKS = [
    {
        match: ['달', '우주', '태양계'],
        title: '밤하늘의 달과 태양계 탐험',
        voiceWord: '달의 모양은 날마다 조금씩 바뀌어요',
        cards: [
            { title: '달이 모양을 바꾸는 이유', text: '달은 스스로 빛을 내지 않고 햇빛을 반사해 반짝여요.', emoji: '🌕', photoKeyword: '보름달' },
            { title: '초승달과 보름달', text: '눈썹처럼 얇은 초승달이 점점 차올라 둥근 보름달이 돼요.', emoji: '🌒', photoKeyword: '초승달' },
            { title: '소중한 우리 지구', text: '푸른 바다가 가득한 지구는 태양 주위를 빙글빙글 돌아요.', emoji: '🌍', photoKeyword: '지구' }
        ],
        quizzes: [
            { prompt: '눈썹처럼 가늘고 뾰족한 모양의 달 이름은 무엇인가요?', emoji: '🌒', photoKeyword: '초승달', answer: '초승달', choices: ['초승달', '보름달', '태양', '구름'] },
            { prompt: '달이 환하게 빛나는 이유는 누구의 빛을 반사하기 때문일까요?', emoji: '☀️', photoKeyword: '태양', answer: '햇빛', choices: ['햇빛', '바닷물', '바람', '가로등'] }
        ],
        matchPairs: [
            { left: '초승달', right: '얇은 눈썹 모양', photoKeyword: '초승달' },
            { left: '보름달', right: '둥근 쟁반 모양', photoKeyword: '보름달' },
            { left: '지구', right: '우리가 사는 행성', photoKeyword: '지구' }
        ]
    },
    {
        match: ['날씨', '계절'],
        title: '구름과 비 · 오늘의 날씨 관찰',
        voiceWord: '따뜻한 햇빛이 물을 구름으로 만들어요',
        cards: [
            { title: '하늘의 뭉게구름', text: '바다와 강물이 햇빛에 데워져 올라가면 작은 물방울이 모여 구름이 돼요.', emoji: '⛅', photoKeyword: '구름' },
            { title: '톡톡 떨어지는 빗방울', text: '구름 속 물방울이 무거워지면 땅으로 시원한 비가 내려요.', emoji: '☔', photoKeyword: '무지개' },
            { title: '비가 온 뒤 무지개', text: '비 온 뒤 햇빛이 물방울을 지나가면 일곱 빛깔 무지개가 떠요.', emoji: '🌈', photoKeyword: '무지개' }
        ],
        quizzes: [
            { prompt: '구름 속 물방울이 모여 무거워지면 하늘에서 무엇이 내릴까요?', emoji: '☔', photoKeyword: '구름', answer: '비', choices: ['비', '나뭇잎', '모래', '돌멩이'] },
            { prompt: '비가 그친 뒤 햇빛이 비칠 때 하늘에 뜨는 일곱 빛깔 띠는?', emoji: '🌈', photoKeyword: '무지개', answer: '무지개', choices: ['무지개', '보름달', '눈사람', '별똥별'] }
        ],
        matchPairs: [
            { left: '맑은 날', right: '선글라스와 모자', photoKeyword: '태양' },
            { left: '비 오는 날', right: '우산과 장화', photoKeyword: '구름' },
            { left: '눈 오는 날', right: '따뜻한 장갑', photoKeyword: '눈' }
        ]
    },
    {
        match: [],
        title: '우리나라 숲속 동식물 관찰 도감',
        voiceWord: '다람쥐는 도토리를 모아 겨울을 준비해요',
        cards: [
            { title: '부지런한 다람쥐', text: '우리나라 숲속에 사는 다람쥐는 볼에 도토리를 가득 담아 보금자리로 옮겨요.', emoji: '🐿️', photoKeyword: '다람쥐' },
            { title: '노란 민들레 홀씨', text: '봄에 노랗게 핀 민들레는 하얀 솜털 씨앗이 되어 바람을 타고 날아가요.', emoji: '🌼', photoKeyword: '민들레' },
            { title: '올챙이에서 개구리로', text: '연못의 올챙이는 뒷다리가 먼저 나오고 꼬리가 짧아지며 개구리가 돼요.', emoji: '🐸', photoKeyword: '청개구리' }
        ],
        quizzes: [
            { prompt: '민들레 씨앗은 무엇을 타고 멀리 날아갈까요?', emoji: '🌼', photoKeyword: '민들레', answer: '바람', choices: ['바람', '기차', '자동차', '바닷물'] },
            { prompt: '올챙이가 개구리로 자랄 때 가장 먼저 나오는 다리는?', emoji: '🐸', photoKeyword: '청개구리', answer: '뒷다리', choices: ['뒷다리', '날개', '뿔', '지느러미'] }
        ],
        matchPairs: [
            { left: '다람쥐', right: '도토리 좋아해요', photoKeyword: '다람쥐' },
            { left: '민들레', right: '바람 타고 씨앗 이동', photoKeyword: '민들레' },
            { left: '개구리', right: '연못에서 폴짝', photoKeyword: '청개구리' }
        ]
    }
];

const HISTORY_FALLBACKS = [
    {
        match: ['세종', '훈민정음', '한글'],
        title: '세종대왕과 우리 글자 훈민정음',
        voiceWord: '세종대왕님이 백성을 위해 한글을 만드셨어요',
        cards: [
            { title: '백성을 사랑한 세종대왕', text: '조선의 세종대왕은 모두가 글을 쉽게 읽고 쓰도록 훈민정음을 만들었어요.', emoji: '👑', photoKeyword: '훈민정음' },
            { title: '소리 모양을 본뜬 한글', text: '입과 혀의 모양, 하늘·땅·사람을 본떠 자음과 모음을 만들었어요.', emoji: '📖', photoKeyword: '훈민정음' },
            { title: '빗물을 재는 측우기', text: '장영실과 함께 비가 얼마나 내리는지 재는 측우기도 발명했어요.', emoji: '🌧️', photoKeyword: '측우기' }
        ],
        quizzes: [
            { prompt: '백성들을 위해 우리 글자 훈민정음을 만드신 임금님은 누구인가요?', emoji: '👑', photoKeyword: '훈민정음', answer: '세종대왕', choices: ['세종대왕', '이순신', '을지문덕', '김홍도'] },
            { prompt: '옛날에 하늘에서 내린 비의 양을 재던 발명품은 무엇일까요?', emoji: '🌧️', photoKeyword: '측우기', answer: '측우기', choices: ['측우기', '거북선', '금관', '연날리기'] }
        ],
        matchPairs: [
            { left: '세종대왕', right: '훈민정음 창제', photoKeyword: '훈민정음' },
            { left: '측우기', right: '빗물의 양 측정', photoKeyword: '측우기' },
            { left: '한글', right: '소리 본뜬 우리 글자', photoKeyword: '훈민정음' }
        ]
    },
    {
        match: ['이순신', '거북선'],
        title: '바다를 지킨 이순신 장군과 거북선',
        voiceWord: '이순신 장군은 거북선으로 우리나라 바다를 지켰어요',
        cards: [
            { title: '용감한 이순신 장군', text: '이순신 장군은 힘든 싸움에서도 물러서지 않고 바다를 지킨 영웅이에요.', emoji: '⚔️', photoKeyword: '이순신' },
            { title: '등에 뾰족한 덮개가 있는 거북선', text: '거북선 위에는 쇠못을 꽂은 덮개가 있어 적군이 배 위로 올라오지 못했어요.', emoji: '🐢', photoKeyword: '거북선' },
            { title: '용머리 입에서 뿜는 연기', text: '뱃머리의 용 입에서는 대포를 쏘며 적군을 물리쳤어요.', emoji: '🚢', photoKeyword: '거북선' }
        ],
        quizzes: [
            { prompt: '이순신 장군이 바다를 지킬 때 활약한 거북 모양의 배는 무엇인가요?', emoji: '🐢', photoKeyword: '거북선', answer: '거북선', choices: ['거북선', '첨성대', '나룻배', '잠수함'] },
            { prompt: '거북선 지붕 위에 뾰족한 덮개를 씌운 까닭은 무엇일까요?', emoji: '🛡️', photoKeyword: '거북선', answer: '적군이 못 올라오게', choices: ['적군이 못 올라오게', '비를 피하려고', '그늘을 만들려고', '물고기 잡으려고'] }
        ],
        matchPairs: [
            { left: '이순신 장군', right: '우리 바다 수호', photoKeyword: '이순신' },
            { left: '거북선', right: '뾰족한 철갑 덮개', photoKeyword: '거북선' },
            { left: '판옥선', right: '조선의 큰 전함', photoKeyword: '판옥선' }
        ]
    },
    {
        match: ['첨성대', '금관', '불국사', '신라'],
        title: '천년 신라의 보물 · 첨성대와 불국사',
        voiceWord: '첨성대는 신라 시대에 별을 관찰하던 돌 탑이에요',
        cards: [
            { title: '별을 바라보던 첨성대', text: '경주에 있는 첨성대는 옛날 사람들이 밤하늘의 별과 달을 살피던 천문대예요.', emoji: '🔭', photoKeyword: '첨성대' },
            { title: '반짝이는 신라 금관', text: '신라 왕이 쓰던 금관에는 나뭇가지와 사슴 뿔 모양의 황금 장식이 달려 있어요.', emoji: '👑', photoKeyword: '신라 금관' },
            { title: '아름다운 절 불국사', text: '돌을 정교하게 쌓아 만든 불국사의 다보탑과 석가탑은 소중한 국가유산이에요.', emoji: '🏛️', photoKeyword: '불국사' }
        ],
        quizzes: [
            { prompt: '신라 시대에 밤하늘의 별과 달을 관찰하던 돌 건축물은 무엇인가요?', emoji: '🔭', photoKeyword: '첨성대', answer: '첨성대', choices: ['첨성대', '거북선', '측우기', '기와집'] },
            { prompt: '경주 불국사에 나란히 서 있는 두 개의 유명한 탑은 다보탑과 무엇일까요?', emoji: '🏛️', photoKeyword: '불국사', answer: '석가탑', choices: ['석가탑', '에펠탑', '시계탑', '등대'] }
        ],
        matchPairs: [
            { left: '첨성대', right: '별을 보던 천문대', photoKeyword: '첨성대' },
            { left: '신라 금관', right: '황금빛 왕관 보물', photoKeyword: '신라 금관' },
            { left: '불국사', right: '다보탑과 석가탑', photoKeyword: '불국사' }
        ]
    },
    {
        match: [],
        title: '아름다운 한복과 즐거운 전통놀이',
        voiceWord: '설날과 추석에는 고운 한복을 입고 윷놀이를 해요',
        cards: [
            { title: '고운 빛깔 우리 옷 한복', text: '한복은 저고리와 치마·바지로 이루어져 명절에 입는 아름다운 전통 옷이에요.', emoji: '🎎', photoKeyword: '한복' },
            { title: '도·개·걸·윷·모 윷놀이', text: '네 개의 윷가락을 던져 나온 모양만큼 말을 움직이며 가족이 함께 놀아요.', emoji: '🪵', photoKeyword: '윷놀이' },
            { title: '따뜻한 한옥 기와집', text: '옛날 기와집은 바닥 아래로 따뜻한 연기가 지나가는 온돌 덕분에 겨울에도 따뜻해요.', emoji: '🏠', photoKeyword: '한옥' }
        ],
        quizzes: [
            { prompt: '네 개의 나무 막대를 던져 도·개·걸·윷·모로 말을 움직이는 전통놀이는?', emoji: '🪵', photoKeyword: '윷놀이', answer: '윷놀이', choices: ['윷놀이', '축구', '블록놀이', '줄넘기'] },
            { prompt: '옛날 우리 조상들이 명절이나 잔칫날 곱게 차려입던 전통 옷은 무엇인가요?', emoji: '🎎', photoKeyword: '한복', answer: '한복', choices: ['한복', '우주복', '수영복', '잠옷'] }
        ],
        matchPairs: [
            { left: '한복', right: '고운 우리 전통 옷', photoKeyword: '한복' },
            { left: '윷놀이', right: '도·개·걸·윷·모', photoKeyword: '윷놀이' },
            { left: '한옥', right: '따뜻한 온돌방 집', photoKeyword: '한옥' }
        ]
    }
];

function buildDiscoveryFallbackWorksheet({ subject, level, theme, sciCtx = null }) {
    const lv = clampLevel(level);
    const pool = subject === 'history' ? HISTORY_FALLBACKS : SCIENCE_FALLBACKS;
    const cleanTheme = String(theme || '');
    const picked = pool.find((item) => item.match.some((k) => cleanTheme.includes(k))) || pool[pool.length - 1];

    const cards = picked.cards.slice(0, lv <= 2 ? 3 : 4).map((c, idx) => ({
        pageNo: idx + 1,
        title: c.title,
        sceneEmoji: c.emoji,
        photoKeyword: c.photoKeyword,
        text: `${c.title}. ${c.text}`,
        ttsText: `${c.title}. ${c.text}`
    }));

    if (subject === 'science' && sciCtx?.moon && cleanTheme.includes('달')) {
        cards[0] = {
            pageNo: 1,
            title: `오늘 밤하늘 달: ${sciCtx.moon.name}`,
            sceneEmoji: sciCtx.moon.emoji,
            photoKeyword: sciCtx.moon.name.replace(/\(.*\)/, ''),
            text: `오늘 실제 밤하늘의 달 모양은 ${sciCtx.moon.emoji} ${sciCtx.moon.name}이에요!`,
            ttsText: `오늘 실제 밤하늘의 달 모양은 ${sciCtx.moon.name}이에요!`
        };
    } else if (subject === 'science' && sciCtx?.weather && cleanTheme.includes('날씨')) {
        cards[0] = {
            pageNo: 1,
            title: '오늘 우리 동네 날씨',
            sceneEmoji: sciCtx.weather.emoji,
            photoKeyword: '구름',
            text: `기상청 오늘 날씨는 "${sciCtx.weather.text}"이에요. 하늘을 직접 살펴보아요!`,
            ttsText: `기상청 오늘 날씨는 ${sciCtx.weather.label}이에요.`
        };
    }

    return assembleDiscoverySheet({
        title: `${picked.title} (Lv.${lv})`,
        subject,
        theme: cleanTheme || picked.title,
        cards,
        voiceWord: picked.voiceWord,
        quizzes: picked.quizzes.slice(0, lv <= 2 ? 2 : 3),
        matchPairs: picked.matchPairs
    });
}

module.exports = {
    FANTASY_LEAK_RE,
    normalizeAiDiscoverySheet,
    buildDiscoveryFallbackWorksheet
};
