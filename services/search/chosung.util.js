/**
 * 🔤 한글 초성 추출 및 통합 검색 매칭 유틸리티 (chosung.util.js)
 */

const CHOSUNG_LIST = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

function extractChosung(str) {
    if (!str) return '';
    let result = '';
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code >= 0xAC00 && code <= 0xD7A3) {
            const chosungIndex = Math.floor((code - 0xAC00) / (21 * 28));
            result += CHOSUNG_LIST[chosungIndex];
        } else {
            result += s.charAt(i);
        }
    }
    return result.toLowerCase();
}

function isChosungOnly(str) {
    return /^[\u3131-\u314E\s]+$/.test(str || '');
}

function matchesQuery(text, rawQuery, isChosung, cleanChosung) {
    if (!text || !rawQuery) return false;
    const str = String(text);
    if (isChosung) {
        return extractChosung(str).replace(/\s+/g, '').includes(cleanChosung);
    }
    return str.toLowerCase().includes(rawQuery.toLowerCase());
}

module.exports = {
    extractChosung,
    isChosungOnly,
    matchesQuery
};
