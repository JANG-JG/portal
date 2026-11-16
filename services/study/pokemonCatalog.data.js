/**
 * ==============================================================================
 * 어린이 학습실 포켓몬 도감 카탈로그 (pokemonCatalog.data.js)
 * ------------------------------------------------------------------------------
 * - [규칙 2] 100% 일상 친화적 한국어 이름·속성·설명
 * - [규칙 3] 500줄 이하 모듈화 | 초창기 1세대(#1~150) 관동 캐릭터 전용 도감
 * ==============================================================================
 */

const { GEN1_POKEMON, POPULAR_GEN1_IDS } = require('./pokemonGen1.data');

const POKEMON_TYPE_STYLES = {
    electric: { label: '전기', emoji: '⚡', color: '#d97706', bgSoft: '#fef3c7', eggColor: '#facc15', eggSpot: '#f59e0b' },
    fire: { label: '불꽃', emoji: '🔥', color: '#dc2626', bgSoft: '#fee2e2', eggColor: '#fb923c', eggSpot: '#ea580c' },
    water: { label: '물', emoji: '💧', color: '#0284c7', bgSoft: '#e0f2fe', eggColor: '#38bdf8', eggSpot: '#0284c7' },
    grass: { label: '풀', emoji: '🌿', color: '#16a34a', bgSoft: '#dcfce7', eggColor: '#4ade80', eggSpot: '#16a34a' },
    bug: { label: '벌레', emoji: '🐛', color: '#65a30d', bgSoft: '#ecfccb', eggColor: '#a3e635', eggSpot: '#4d7c0f' },
    normal: { label: '노말', emoji: '⭐', color: '#b45309', bgSoft: '#fef9c3', eggColor: '#fde68a', eggSpot: '#d97706' },
    poison: { label: '독', emoji: '🧪', color: '#7e22ce', bgSoft: '#f3e8ff', eggColor: '#c084fc', eggSpot: '#7e22ce' },
    ground: { label: '땅', emoji: '🏜️', color: '#a16207', bgSoft: '#fef3c7', eggColor: '#eab308', eggSpot: '#854d0e' },
    fairy: { label: '페어리', emoji: '🌸', color: '#db2777', bgSoft: '#fce7f3', eggColor: '#f9a8d4', eggSpot: '#ec4899' },
    fighting: { label: '격투', emoji: '🥊', color: '#b91c1c', bgSoft: '#ffedd5', eggColor: '#fdba74', eggSpot: '#c2410c' },
    psychic: { label: '에스퍼', emoji: '🔮', color: '#9333ea', bgSoft: '#f3e8ff', eggColor: '#c084fc', eggSpot: '#9333ea' },
    rock: { label: '바위', emoji: '🪨', color: '#57534e', bgSoft: '#f5f5f4', eggColor: '#d6d3d1', eggSpot: '#78716c' },
    ghost: { label: '고스트', emoji: '👻', color: '#6d28d9', bgSoft: '#ede9fe', eggColor: '#a78bfa', eggSpot: '#6d28d9' },
    ice: { label: '얼음', emoji: '❄️', color: '#0891b2', bgSoft: '#cffafe', eggColor: '#67e8f9', eggSpot: '#0e7490' },
    dragon: { label: '드래곤', emoji: '🐉', color: '#4f46e5', bgSoft: '#e0e7ff', eggColor: '#818cf8', eggSpot: '#4338ca' }
};

// 기존 DB 이력 호환용 레거시 ID 조회 테이블 (신규 알 부화·색칠하기는 1~150번만 사용)
const LEGACY_POKEMON_LOOKUP = {
    151: { id: 151, nameKo: '뮤', typeKey: 'psychic', rarity: '전설', flavorKo: '신비롭고 사랑스러운 전설 포켓몬이에요.' },
    152: { id: 152, nameKo: '치코리타', typeKey: 'grass', rarity: '일반', flavorKo: '머리 위 잎사귀에서 달콤한 향기가 나요.' },
    155: { id: 155, nameKo: '브케인', typeKey: 'fire', rarity: '일반', flavorKo: '등에서 따뜻한 불꽃이 타오르는 친구예요.' },
    158: { id: 158, nameKo: '리아코', typeKey: 'water', rarity: '일반', flavorKo: '에너지가 넘치는 귀여운 악어 친구예요.' },
    172: { id: 172, nameKo: '피츄', typeKey: 'electric', rarity: '일반', flavorKo: '전기 스파크를 연습하는 작고 발랄한 친구예요.' },
    175: { id: 175, nameKo: '토게피', typeKey: 'fairy', rarity: '일반', flavorKo: '알 껍질에 행복이 가득 담긴 친구예요.' },
    196: { id: 196, nameKo: '에브이', typeKey: 'psychic', rarity: '희귀', flavorKo: '이마의 붉은 보석이 빛나는 친구예요.' },
    197: { id: 197, nameKo: '블래키', typeKey: 'normal', rarity: '희귀', flavorKo: '달빛 아래 노란 고리가 빛나는 친구예요.' },
    448: { id: 448, nameKo: '루카리오', typeKey: 'fighting', rarity: '희귀', flavorKo: '파동으로 마음을 읽는 씩씩한 친구예요.' },
    700: { id: 700, nameKo: '님피아', typeKey: 'fairy', rarity: '희귀', flavorKo: '리본 촉수로 다정한 기운을 전해줘요.' },
    778: { id: 778, nameKo: '미미큐', typeKey: 'ghost', rarity: '희귀', flavorKo: '피카츄 모습을 흉내 내는 수줍은 친구예요.' },
    906: { id: 906, nameKo: '나오하', typeKey: 'grass', rarity: '일반', flavorKo: '달콤한 아로마 향기를 풍기는 고양이 친구예요.' }
};

const POKEMON_CATALOG = GEN1_POKEMON;
const CATALOG_BY_ID = new Map(POKEMON_CATALOG.map((p) => [p.id, p]));
const POPULAR_SET = new Set(POPULAR_GEN1_IDS);

function enrichPokemon(entry) {
    if (!entry) return null;
    const style = POKEMON_TYPE_STYLES[entry.typeKey] || POKEMON_TYPE_STYLES.normal;
    return {
        ...entry,
        isPopular: POPULAR_SET.has(entry.id),
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
    const found = CATALOG_BY_ID.get(idNum) || LEGACY_POKEMON_LOOKUP[idNum];
    if (found) return enrichPokemon(found);
    if (idNum > 150) {
        return enrichPokemon({
            id: idNum,
            nameKo: `포켓몬 #${idNum}`,
            typeKey: 'normal',
            rarity: '일반',
            flavorKo: '특별히 만나게 된 포켓몬 친구예요.'
        });
    }
    return enrichPokemon(CATALOG_BY_ID.get(25) || POKEMON_CATALOG[0]);
}

function listEnrichedCatalog() {
    return POKEMON_CATALOG.map(enrichPokemon);
}

/**
 * 아이가 아직 모으지 못한 1세대(#1~150) 포켓몬 우선 추천 뽑기
 * - 초반 3마리까지는 피카츄·스타터 등 친숙한 인기 1세대 위주
 * - 전설 등급(프리져·썬더·파이어·뮤츠)은 최소 2마리 이상 수집 후 등장
 */
function pickEggPokemonId(collectedIds = []) {
    const owned = new Set((collectedIds || []).map((n) => Number(n)));
    const ownedGen1Count = Array.from(owned).filter((id) => id >= 1 && id <= 150).length;

    let pool = POKEMON_CATALOG.filter((p) => !owned.has(p.id));
    if (pool.length === 0) {
        pool = POKEMON_CATALOG;
    }

    if (ownedGen1Count < 3) {
        const starterFriendly = pool.filter((p) => POPULAR_SET.has(p.id) && p.rarity !== '전설');
        if (starterFriendly.length > 0) pool = starterFriendly;
    } else if (ownedGen1Count < 5) {
        const nonLegend = pool.filter((p) => p.rarity !== '전설');
        if (nonLegend.length > 0) pool = nonLegend;
    }

    const picked = pool[Math.floor(Math.random() * pool.length)];
    return picked ? picked.id : 25;
}

module.exports = {
    POKEMON_CATALOG,
    POKEMON_TYPE_STYLES,
    POPULAR_GEN1_IDS,
    getPokemonById,
    listEnrichedCatalog,
    pickEggPokemonId
};
