/**
 * ==============================================================================
 * 포켓몬 간식·진화 트리 & 교환 수학 퀴즈 생성 데이터 모듈 (pokemonEvolution.data.js)
 * ------------------------------------------------------------------------------
 * - 1세대(#1~150) 대표 진화 단계, 간식 4종, 감사 쪽지, 아이 mathLevel 맞춤 퀴즈 생성
 * - [규칙 2] 100% 일상 친화적 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const SNACK_CATALOG = [
    { id: 'apple', name: '사과열매', emoji: '🍎', exp: 10, desc: '아삭아삭 달콤한 빨간 사과' },
    { id: 'berry', name: '딸기베리', emoji: '🍓', exp: 12, desc: '향기가 솔솔 나는 분홍 베리' },
    { id: 'cookie', name: '포켓몬쿠키', emoji: '🍪', exp: 15, desc: '바삭바삭 고소한 모양 쿠키' },
    { id: 'star_candy', name: '별사탕', emoji: '🍬', exp: 25, desc: '반짝반짝 친밀도가 쑥쑥 오르는 사탕' }
];

const SNACK_MAP = new Map(SNACK_CATALOG.map((s) => [s.id, s]));

// 1세대 대표 진화 맵 (다음 단계 ID + 필요 친밀도 경험치)
const GEN1_EVOLUTIONS = {
    1: { nextId: 2, needExp: 30 }, 2: { nextId: 3, needExp: 60 },
    4: { nextId: 5, needExp: 30 }, 5: { nextId: 6, needExp: 60 },
    7: { nextId: 8, needExp: 30 }, 8: { nextId: 9, needExp: 60 },
    10: { nextId: 11, needExp: 20 }, 11: { nextId: 12, needExp: 40 },
    13: { nextId: 14, needExp: 20 }, 14: { nextId: 15, needExp: 40 },
    16: { nextId: 17, needExp: 25 }, 17: { nextId: 18, needExp: 50 },
    19: { nextId: 20, needExp: 25 },
    25: { nextId: 26, needExp: 40 },
    35: { nextId: 36, needExp: 40 },
    37: { nextId: 38, needExp: 40 },
    39: { nextId: 40, needExp: 40 },
    52: { nextId: 53, needExp: 30 },
    54: { nextId: 55, needExp: 35 },
    58: { nextId: 59, needExp: 40 },
    60: { nextId: 61, needExp: 25 }, 61: { nextId: 62, needExp: 55 },
    63: { nextId: 64, needExp: 25 }, 64: { nextId: 65, needExp: 55 },
    66: { nextId: 67, needExp: 25 }, 67: { nextId: 68, needExp: 55 },
    74: { nextId: 75, needExp: 25 }, 75: { nextId: 76, needExp: 55 },
    77: { nextId: 78, needExp: 35 },
    92: { nextId: 93, needExp: 30 }, 93: { nextId: 94, needExp: 60 },
    129: { nextId: 130, needExp: 50 },
    133: { nextId: 135, needExp: 35 },
    147: { nextId: 148, needExp: 35 }, 148: { nextId: 149, needExp: 70 }
};

const GREETING_PRESETS = [
    '같이 나눠 먹자! 😊',
    '오늘도 공부 화이팅! 💪',
    '내 포켓몬이랑 사이좋게 지내자! ✨',
    '맛있게 먹고 쑥쑥 자라렴! 🌱'
];

const REPLY_PRESETS = [
    '정말 고마워! ❤️',
    '맛있게 잘 먹을게! 😋',
    '우리 사이좋은 친구야! 🤝',
    '다음엔 내가 줄게! 🌟'
];

function getSnackMeta(snackId) {
    return SNACK_MAP.get(String(snackId || '').trim()) || SNACK_CATALOG[0];
}

function pickRandomSnacks(count = 1) {
    const out = {};
    for (let i = 0; i < count; i++) {
        // 별사탕은 희귀, 나머지 간식 위주 지급
        const roll = Math.random();
        const snack = roll < 0.12
            ? SNACK_CATALOG[3]
            : SNACK_CATALOG[Math.floor(Math.random() * 3)];
        out[snack.id] = (out[snack.id] || 0) + 1;
    }
    return out;
}

function buildUniqueChoices(answer) {
    const ans = Math.max(0, Math.round(Number(answer) || 0));
    const set = new Set([ans]);
    const offsets = [-2, -1, 1, 2, 3, -3, 4];
    for (const off of offsets) {
        if (set.size >= 3) break;
        const cand = ans + off;
        if (cand >= 0) set.add(cand);
    }
    while (set.size < 3) set.add(ans + set.size + 1);
    return Array.from(set).sort(() => Math.random() - 0.5).map(String);
}

/**
 * 간식 교환/선물 수락 시 받는 아이의 mathLevel(Lv.1~5)에 맞춘 확인 퀴즈 생성
 */
function generateTradeMathQuiz({ mathLevel = 1, trade, receiverQty = 0 }) {
    const lv = Math.min(5, Math.max(1, Math.round(Number(mathLevel) || 1)));
    const offerMeta = getSnackMeta(trade.offer_snack);
    const reqMeta = getSnackMeta(trade.request_snack);
    const offerQty = Math.max(1, Number(trade.offer_qty || 1));
    const reqQty = Math.max(0, Number(trade.request_qty || 0));
    const curHas = Math.max(0, Number(receiverQty || 0));

    let prompt = '';
    let answer = 0;
    let visual = '';
    let hint = '';

    if (reqQty === 0) {
        // 선물 받기: 덧셈 문제
        if (lv <= 1) {
            const base = Math.min(4, curHas);
            answer = base + offerQty;
            visual = `${offerMeta.emoji.repeat(Math.min(5, base || 1))} + ${offerMeta.emoji.repeat(Math.min(5, offerQty))}`;
            prompt = base > 0
                ? `${offerMeta.name} ${base}개를 가지고 있는데 ${offerQty}개를 선물받았어요! 모두 몇 개가 될까요?`
                : `선물 상자에 ${offerMeta.name} ${offerQty}개와 보너스 1개가 들어있어요! 모두 몇 개일까요?`;
            if (base === 0) {
                answer = offerQty + 1;
                visual = `${offerMeta.emoji.repeat(Math.min(5, offerQty))} + ${offerMeta.emoji}`;
            }
            hint = '그림을 하나씩 손가락으로 세어 더해 보세요!';
        } else if (lv <= 3) {
            const extra = curHas > 0 ? curHas : 4;
            answer = extra + offerQty;
            visual = `${offerMeta.emoji} × ${extra} + ${offerMeta.emoji} × ${offerQty}`;
            prompt = `원래 있던 ${offerMeta.name} ${extra}개에 선물 ${offerQty}개를 더하면 모두 몇 개가 될까요?`;
            hint = `${extra}에서 ${offerQty}만큼 더 크게 세어 보세요!`;
        } else {
            const bundle = offerQty + 3;
            answer = bundle * 2;
            visual = `${offerMeta.emoji} (${offerQty} + 3) × 2묶음`;
            prompt = `${offerMeta.name} ${bundle}개씩 2주머니가 있다면 간식은 모두 몇 개일까요?`;
            hint = `${bundle} + ${bundle}을 계산해 보세요!`;
        }
    } else {
        // 물물교환: 뺄셈·비교·곱셈 문제
        if (lv <= 1) {
            const start = Math.max(reqQty + 1, Math.min(6, curHas));
            answer = start - reqQty;
            visual = `${reqMeta.emoji.repeat(Math.min(6, start))} 에서 ${reqQty}개 건네주기`;
            prompt = `${reqMeta.name} ${start}개 중에서 ${reqQty}개를 친구에게 주면 내 손엔 몇 개가 남을까요?`;
            hint = `${start}개에서 ${reqQty}개를 빼 보세요!`;
        } else if (lv === 2) {
            const afterLeft = Math.max(0, curHas - reqQty);
            answer = afterLeft + offerQty;
            visual = `${reqMeta.name} ${curHas}-${reqQty} 남고 + ${offerMeta.name} ${offerQty}개 받기`;
            prompt = `${reqMeta.name} ${reqQty}개를 주고 ${offerMeta.name} ${offerQty}개를 받아요! 남는 ${reqMeta.name}(${afterLeft}개)과 새 ${offerMeta.name}(${offerQty}개)을 합하면 몇 개일까요?`;
            hint = `${afterLeft} + ${offerQty}를 계산하면 돼요!`;
        } else if (lv === 3) {
            const start = Math.max(curHas, reqQty + 7);
            answer = start - reqQty + offerQty;
            visual = `${start} - ${reqQty} + ${offerQty} = ?`;
            prompt = `${reqMeta.name} ${start}개 중 ${reqQty}개를 내고, ${offerMeta.name} ${offerQty}개를 받으면 총 간식은 몇 개일까요?`;
            hint = `먼저 ${start}에서 ${reqQty}을 뺀 다음 ${offerQty}를 더하세요!`;
        } else {
            const packs = reqQty + 2;
            answer = packs * 3 + offerQty;
            visual = `(${packs} × 3) + ${offerQty} = ?`;
            prompt = `${reqMeta.name} ${packs}개씩 3묶음에 ${offerMeta.name} ${offerQty}개를 더 모으면 총 몇 개일까요?`;
            hint = `${packs} × 3을 먼저 구한 뒤 ${offerQty}를 더하세요!`;
        }
    }

    return {
        mathLevel: lv,
        prompt,
        visual,
        hint,
        answer: String(answer),
        choices: buildUniqueChoices(answer)
    };
}

module.exports = {
    SNACK_CATALOG,
    GEN1_EVOLUTIONS,
    GREETING_PRESETS,
    REPLY_PRESETS,
    getSnackMeta,
    pickRandomSnacks,
    generateTradeMathQuiz
};
