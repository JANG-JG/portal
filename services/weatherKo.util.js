/**
 * 🌤️ 날씨 및 일상 어휘 한국어화 유틸리티
 * - [규칙 2] AI 답변에 섞이는 영어 날씨/일상 표현(chilly, weather 등)을 자연스러운 한국어로 변환
 * - 체감온도 기반 한국어 느낌 라벨 제공 및 조사(은/는, 이/가 등) 자동 보정
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

// 소형 모델이 자주 섞어 쓰는 영어 날씨/일상 표현 → [영어, 명사형, '하다' 어간] (긴 표현 우선 매칭)
const EN_WEATHER_KO = [
    // 1. 복합어 우선 매칭
    ['weather forecast', '일기예보', ''],
    ['weather report', '기상 정보', ''],
    ['weather conditions', '기상 상황', ''],
    ['weather condition', '날씨 상태', ''],
    ['air quality', '공기질', ''],
    ['fine dust', '미세먼지', ''],
    ['ultra fine dust', '초미세먼지', ''],
    ['partly cloudy', '구름 조금', ''],
    ['mostly cloudy', '구름 많음', ''],
    ['light rain', '약한 비', ''],
    ['heavy rain', '강한 비', ''],
    ['thunderstorm', '뇌우', ''],

    // 2. 주요 상태 및 형용사 (어간 결합 지원)
    ['chilly', '쌀쌀함', '쌀쌀'],
    ['freezing', '몹시 추움', '몹시 춥'],
    ['cold', '추움', '추'],
    ['cool', '선선함', '선선'],
    ['mild', '포근함', '포근'],
    ['warm', '따뜻함', '따뜻'],
    ['hot', '더움', '더'],
    ['humid', '습함', '습'],
    ['muggy', '후텁지근함', '후텁지근'],
    ['breezy', '바람이 선선함', '바람이 선선'],
    ['windy', '바람이 강함', '바람이 강'],
    ['sunny', '화창함', '화창'],
    ['clear', '맑음', '쾌청'],
    ['cloudy', '흐림', '흐릿'],
    ['overcast', '흐림', '흐릿'],
    ['foggy', '안개', '안개'],
    ['rainy', '비', ''],
    ['drizzle', '이슬비', ''],
    ['snowy', '눈', ''],
    ['snow', '눈', ''],
    ['rain', '비', ''],

    // 3. 기상/일상 일반 명사
    ['forecast', '일기예보', ''],
    ['temperature', '기온', ''],
    ['weather', '날씨', ''],
    ['degrees', '도', ''],
    ['degree', '도', ''],
    ['d-day', '디데이', ''],
    ['dday', '디데이', '']
];

/** 텍스트 속 영어 날씨/일상 단어를 한국어로 치환 (단어 경계 및 한국어 조사 보정) */
function koreanizeWeatherWords(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const [en, noun, stem] of EN_WEATHER_KO) {
        // 1. 'chilly하고', 'chilly해요', 'chilly한' 등 어간 결합형 처리
        if (stem) {
            out = out.replace(new RegExp(`\\b${en}(?=[하해한할함합])`, 'gi'), stem);
        }

        // 2. 단어 뒤에 바로 한국어 조사(은/는, 이/가, 을/를, 과/와)가 결합된 경우 받침에 맞춰 자동 교정
        const koLastChar = noun[noun.length - 1];
        const code = koLastChar.charCodeAt(0) - 0xAC00;
        const hasBatchim = (code >= 0 && code <= 11171) ? (code % 28) !== 0 : false;

        out = out.replace(new RegExp(`\\b${en}([은는이가을를과와])`, 'gi'), (match, josa) => {
            let fixedJosa = josa;
            if (josa === '은' || josa === '는') fixedJosa = hasBatchim ? '은' : '는';
            else if (josa === '이' || josa === '가') fixedJosa = hasBatchim ? '이' : '가';
            else if (josa === '을' || josa === '를') fixedJosa = hasBatchim ? '을' : '를';
            else if (josa === '과' || josa === '와') fixedJosa = hasBatchim ? '과' : '와';
            return noun + fixedJosa;
        });

        // 3. 단독 단어 매칭
        out = out.replace(new RegExp(`\\b${en}\\b`, 'gi'), noun);
    }
    return out;
}

module.exports = { describeFeelKo, koreanizeWeatherWords };
