/**
 * ==============================================================================
 * 어린이 학습실 포켓몬 도감 카탈로그 (pokemonCatalog.data.js)
 * ------------------------------------------------------------------------------
 * - [규칙 2] 100% 일상 친화적 한국어 이름·속성·설명
 * - [규칙 3] 500줄 이하 모듈화 | 오프라인 안전을 위한 로컬 내장 메타데이터 (40종)
 * ==============================================================================
 */

const POKEMON_TYPE_STYLES = {
    electric: { label: '전기', emoji: '⚡', color: '#d97706', bgSoft: '#fef3c7', eggColor: '#facc15', eggSpot: '#f59e0b' },
    fire: { label: '불꽃', emoji: '🔥', color: '#dc2626', bgSoft: '#fee2e2', eggColor: '#fb923c', eggSpot: '#ea580c' },
    water: { label: '물', emoji: '💧', color: '#0284c7', bgSoft: '#e0f2fe', eggColor: '#38bdf8', eggSpot: '#0284c7' },
    grass: { label: '풀', emoji: '🌿', color: '#16a34a', bgSoft: '#dcfce7', eggColor: '#4ade80', eggSpot: '#16a34a' },
    fairy: { label: '페어리', emoji: '🌸', color: '#db2777', bgSoft: '#fce7f3', eggColor: '#f9a8d4', eggSpot: '#ec4899' },
    psychic: { label: '에스퍼', emoji: '🔮', color: '#9333ea', bgSoft: '#f3e8ff', eggColor: '#c084fc', eggSpot: '#9333ea' },
    normal: { label: '노말', emoji: '⭐', color: '#b45309', bgSoft: '#fef9c3', eggColor: '#fde68a', eggSpot: '#d97706' },
    fighting: { label: '격투', emoji: '🥊', color: '#b91c1c', bgSoft: '#ffedd5', eggColor: '#fdba74', eggSpot: '#c2410c' },
    dragon: { label: '드래곤', emoji: '🐉', color: '#4f46e5', bgSoft: '#e0e7ff', eggColor: '#818cf8', eggSpot: '#4338ca' },
    ghost: { label: '고스트', emoji: '👻', color: '#6d28d9', bgSoft: '#ede9fe', eggColor: '#a78bfa', eggSpot: '#6d28d9' },
    dark: { label: '악', emoji: '🌙', color: '#334155', bgSoft: '#e2e8f0', eggColor: '#94a3b8', eggSpot: '#475569' }
};

const POKEMON_CATALOG = [
    { id: 25, nameKo: '피카츄', typeKey: 'electric', rarity: '일반', flavorKo: '볼에 전기를 모았다가 찌릿찌릿 쏘아 보내는 귀여운 친구예요!' },
    { id: 133, nameKo: '이브이', typeKey: 'normal', rarity: '일반', flavorKo: '환경에 따라 여러 모습으로 진화할 수 있는 보송보송한 친구예요.' },
    { id: 4, nameKo: '파이리', typeKey: 'fire', rarity: '일반', flavorKo: '꼬리 끝에 작은 불꽃이 언제나 반짝반짝 타고 있어요.' },
    { id: 7, nameKo: '꼬부기', typeKey: 'water', rarity: '일반', flavorKo: '동그란 등껍질에 숨었다가 시원한 물대포를 쏘아요.' },
    { id: 1, nameKo: '이상해씨', typeKey: 'grass', rarity: '일반', flavorKo: '등에 큰 씨앗을 업고 햇빛을 받으며 무럭무럭 자라요.' },
    { id: 39, nameKo: '푸린', typeKey: 'fairy', rarity: '일반', flavorKo: '동그란 눈으로 바라보며 자장가 노래를 부르는 걸 좋아해요.' },
    { id: 175, nameKo: '토게피', typeKey: 'fairy', rarity: '일반', flavorKo: '알 껍질에 행복이 가득 담겨 있어 모두에게 행운을 나눠줘요.' },
    { id: 172, nameKo: '피츄', typeKey: 'electric', rarity: '일반', flavorKo: '작지만 발랄하게 뛰어다니며 전기 스파크를 연습하고 있어요.' },
    { id: 52, nameKo: '나옹', typeKey: 'normal', rarity: '일반', flavorKo: '반짝거리는 동전을 모으는 걸 좋아하는 장난꾸러기 고양이예요.' },
    { id: 54, nameKo: '고라파덕', typeKey: 'water', rarity: '일반', flavorKo: '머리를 갸우뚱하며 고민하다가 갑자기 멋진 힘을 써요.' },
    { id: 79, nameKo: '야돈', typeKey: 'water', rarity: '일반', flavorKo: '물가에서 느긋하게 쉬면서 여유롭게 하루를 보내요.' },
    { id: 132, nameKo: '메타몽', typeKey: 'normal', rarity: '희귀', flavorKo: '말랑말랑한 몸으로 본 것은 무엇이든 똑같이 변신할 수 있어요!' },
    { id: 37, nameKo: '식스테일', typeKey: 'fire', rarity: '일반', flavorKo: '따뜻하고 복슬복슬한 여섯 개의 꼬리가 정말 매력적이에요.' },
    { id: 58, nameKo: '가디', typeKey: 'fire', rarity: '일반', flavorKo: '주인을 아주 잘 따르고 용감하게 지켜주는 믿음직한 친구예요.' },
    { id: 152, nameKo: '치코리타', typeKey: 'grass', rarity: '일반', flavorKo: '머리 위 커다란 잎사귀에서 기분 좋은 달콤한 향기가 나요.' },
    { id: 155, nameKo: '브케인', typeKey: 'fire', rarity: '일반', flavorKo: '평소에는 온순하지만 기합이 들어가면 등에서 불꽃이 타올라요.' },
    { id: 158, nameKo: '리아코', typeKey: 'water', rarity: '일반', flavorKo: '작은 몸이지만 에너지가 넘쳐서 늘 통통 뛰어다녀요.' },
    { id: 252, nameKo: '나무지기', typeKey: 'grass', rarity: '일반', flavorKo: '발바닥이 쫀득해서 나무나 벽도 척척 잘 올라가요.' },
    { id: 255, nameKo: '아차모', typeKey: 'fire', rarity: '일반', flavorKo: '따뜻한 솜털 덕분에 꼭 안아주면 난로처럼 포근해요.' },
    { id: 258, nameKo: '물짱이', typeKey: 'water', rarity: '일반', flavorKo: '머리 위 지느러미로 물의 움직임을 느끼는 수영 천재예요.' },
    { id: 387, nameKo: '모부기', typeKey: 'grass', rarity: '일반', flavorKo: '햇볕을 쬐고 나면 등껍질 위의 잎이 생생하게 빛나요.' },
    { id: 393, nameKo: '팽도리', typeKey: 'water', rarity: '일반', flavorKo: '자존심이 세지만 귀여운 뒤뚱걸음이 사랑스러운 펭귄 친구예요.' },
    { id: 403, nameKo: '꼬링크', typeKey: 'electric', rarity: '일반', flavorKo: '위험할 때 털 끝이 반짝빛나며 친구들에게 신호를 보내요.' },
    { id: 417, nameKo: '파치리스', typeKey: 'electric', rarity: '일반', flavorKo: '동그란 꼬리를 살랑거리며 나무 열매를 모으는 다람쥐 친구예요.' },
    { id: 722, nameKo: '나몰빼미', typeKey: 'grass', rarity: '일반', flavorKo: '고개를 휙 돌리며 소리 없이 사뿐사뿐 날아다니는 부엉이예요.' },
    { id: 906, nameKo: '나오하', typeKey: 'grass', rarity: '일반', flavorKo: '앞발을 꾹꾹 누르면 달콤한 아로마 향기가 솔솔 퍼져요.' },
    { id: 909, nameKo: '뜨아거', typeKey: 'fire', rarity: '일반', flavorKo: '느긋한 성격이지만 맛있는 간식을 보면 눈이 반짝반짝해져요!' },
    { id: 912, nameKo: '꾸왁스', typeKey: 'water', rarity: '일반', flavorKo: '언제나 앞머리를 깔끔하게 정돈하는 단정한 오리 친구예요.' },
    { id: 196, nameKo: '에브이', typeKey: 'psychic', rarity: '희귀', flavorKo: '이마의 붉은 보석이 빛나며 미래의 날씨와 움직임을 느껴요.' },
    { id: 197, nameKo: '블래키', typeKey: 'dark', rarity: '희귀', flavorKo: '달빛을 받으면 몸의 노란 고리가 아름답게 반짝여요.' },
    { id: 700, nameKo: '님피아', typeKey: 'fairy', rarity: '희귀', flavorKo: '리본 모양 촉수를 팔랑거리며 다정한 기운을 전해줘요.' },
    { id: 143, nameKo: '잠만보', typeKey: 'normal', rarity: '희귀', flavorKo: '배불리 먹고 포근하게 낮잠 자는 게 제일 행복한 거대한 친구예요.' },
    { id: 94, nameKo: '팬텀', typeKey: 'ghost', rarity: '희귀', flavorKo: '씨익 웃는 표정이 매력적인 장난꾸러기 그림자 친구예요.' },
    { id: 131, nameKo: '라프라스', typeKey: 'water', rarity: '희귀', flavorKo: '넓고 튼튼한 등에 친구들을 태우고 바다 여행을 떠나요.' },
    { id: 149, nameKo: '망나뇽', typeKey: 'dragon', rarity: '희귀', flavorKo: '커다랗고 씩씩하지만 마음씨가 따뜻해 길을 잃은 배를 도와줘요.' },
    { id: 448, nameKo: '루카리오', typeKey: 'fighting', rarity: '희귀', flavorKo: '정의감이 강하고 파동으로 상대방의 마음을 읽을 수 있어요.' },
    { id: 658, nameKo: '개굴닌자', typeKey: 'water', rarity: '희귀', flavorKo: '물수리검을 날리며 닌자처럼 날렵하게 움직여요.' },
    { id: 778, nameKo: '미미큐', typeKey: 'ghost', rarity: '희귀', flavorKo: '인기를 얻고 싶어서 피카츄 모양 천을 뒤집어쓴 부끄럼쟁이예요.' },
    { id: 494, nameKo: '비크티니', typeKey: 'psychic', rarity: '전설', flavorKo: '무한한 승리의 에너지를 나누어 주는 전설의 행운 친구예요!' },
    { id: 151, nameKo: '뮤', typeKey: 'psychic', rarity: '전설', flavorKo: '모든 기술을 배울 수 있다고 전해지는 신비롭고 사랑스러운 전설 포켓몬이에요!' }
];

function enrichPokemon(entry) {
    if (!entry) return null;
    const style = POKEMON_TYPE_STYLES[entry.typeKey] || POKEMON_TYPE_STYLES.normal;
    return {
        ...entry,
        typeLabel: style.label,
        typeEmoji: style.emoji,
        color: style.color,
        bgSoft: style.bgSoft,
        eggColor: style.eggColor,
        eggSpot: style.eggSpot
    };
}

function getPokemonById(pokemonId) {
    const idNum = Number(pokemonId);
    const found = POKEMON_CATALOG.find((p) => p.id === idNum);
    return found ? enrichPokemon(found) : enrichPokemon(POKEMON_CATALOG[0]);
}

function listEnrichedCatalog() {
    return POKEMON_CATALOG.map(enrichPokemon);
}

/**
 * 아이가 아직 모으지 못한 포켓몬 우선 추천 뽑기
 * - 전설 등급은 최소 3마리 이상 수집 후 등장 확률 상승
 */
function pickEggPokemonId(collectedIds = []) {
    const owned = new Set((collectedIds || []).map((n) => Number(n)));
    const ownedCount = owned.size;
    let pool = POKEMON_CATALOG.filter((p) => !owned.has(p.id));
    if (pool.length === 0) {
        pool = POKEMON_CATALOG;
    }

    // 초반(3마리 미만)엔 친숙한 일반/희귀 위주, 이후 전설 포함
    if (ownedCount < 2) {
        const starterPool = pool.filter((p) => p.rarity !== '전설');
        if (starterPool.length > 0) pool = starterPool;
    }

    const picked = pool[Math.floor(Math.random() * pool.length)];
    return picked ? picked.id : 25;
}

module.exports = {
    POKEMON_CATALOG,
    POKEMON_TYPE_STYLES,
    getPokemonById,
    listEnrichedCatalog,
    pickEggPokemonId
};
