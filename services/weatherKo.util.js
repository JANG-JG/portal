/**
 * 🌤️ 날씨 한국어화 유틸리티
 * - [규칙 2] AI 답변에 섞이는 영어 날씨 표현(chilly 등)을 일상 한국어로 변환
 * - 체감온도 기반 한국어 느낌 라벨 제공 (모델이 영어 단어 대신 한국어를 쓰도록 유도)
 */

/** 체감온도(예: '7.3°C') → 한국어 느낌 라벨 */
function describeFeelKo(feelsLike) {
    const v = parseFloat(String(feelsLike || '').replace(/[^\d.\-]/g, ''));
    if (Number.isNaN(v)) return '';
    if (v <= -5) return '매우 추움';
    if (v <= 4) return '추움';
    if (v <= 11) return '쌀쌀함';
    if (v <= 17) return '선선함';
    if (v <= 22) return '포근함';
    if (v <= 27) return '따뜻함';
    if (v <= 31) return '더움';
    return '무더움';
}

// 소형 모델이 자주 섞어 쓰는 영어 날씨 표현 → [영어, 명사형, '하다' 어간] (긴 표현 우선 매칭)
const EN_WEATHER_KO = [
    ['partly cloudy', '구름 조금', ''], ['mostly cloudy', '구름 많음', ''], ['light rain', '약한 비', ''],
    ['heavy rain', '강한 비', ''], ['thunderstorm', '뇌우', ''], ['chilly', '쌀쌀함', '쌀쌀'], ['freezing', '몹시 추움', ''],
    ['cold', '추움', '서늘'], ['cool', '선선함', '선선'], ['mild', '포근함', '포근'], ['warm', '따뜻함', '따뜻'], ['hot', '더움', '후끈'],
    ['humid', '습함', '습'], ['muggy', '후텁지근함', '후텁지근'], ['breezy', '바람이 선선함', '바람이 선선'], ['windy', '바람이 강함', '바람이 강'],
    ['sunny', '화창함', '화창'], ['clear', '맑음', '청명'], ['cloudy', '흐림', '흐릿'], ['overcast', '흐림', '흐릿'], ['foggy', '안개', '뿌옇'],
    ['rainy', '비', ''], ['drizzle', '이슬비', ''], ['snowy', '눈', ''], ['snow', '눈', ''], ['rain', '비', '']
];

/** 텍스트 속 영어 날씨 단어를 한국어로 치환 (단어 경계 기준, 대소문자 무시) */
function koreanizeWeatherWords(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const [en, noun, stem] of EN_WEATHER_KO) {
        // 'chilly하고' → '쌀쌀하고' (하다 활용형 뒤따름 시 어간 사용)
        if (stem) out = out.replace(new RegExp(`\\b${en}(?=[하해한할함합])`, 'gi'), stem);
        out = out.replace(new RegExp(`\\b${en}\\b`, 'gi'), noun);
    }
    return out;
}

module.exports = { describeFeelKo, koreanizeWeatherWords };
