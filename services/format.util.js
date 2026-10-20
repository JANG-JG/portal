// 서버 가동 시간 사람이 읽기 좋은 포맷 변환기
function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '방금 시작됨';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}일 ${h}시간 ${m}분`;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

// Uptime 텍스트 한글 변환기
function parseUptimeString(str) {
    if (!str) return '방금 시작됨';
    const trimmed = str.trim();

    const mDayHm = trimmed.match(/(\d+)\s+days?,\s*(\d+):(\d+)/i);
    if (mDayHm) {
        return `${mDayHm[1]}일 ${parseInt(mDayHm[2], 10)}시간 ${parseInt(mDayHm[3], 10)}분`;
    }

    const mDayMin = trimmed.match(/(\d+)\s+days?,\s*(\d+)\s+min/i);
    if (mDayMin) {
        return `${mDayMin[1]}일 ${parseInt(mDayMin[2], 10)}분`;
    }

    const mHm = trimmed.match(/^(\d+):(\d+)$/);
    if (mHm) {
        return `${parseInt(mHm[1], 10)}시간 ${parseInt(mHm[2], 10)}분`;
    }

    const mMin = trimmed.match(/^(\d+)\s+min/i);
    if (mMin) {
        return `${parseInt(mMin[1], 10)}분`;
    }

    const mDayOnly = trimmed.match(/^(\d+)\s+days?$/i);
    if (mDayOnly) {
        return `${mDayOnly[1]}일`;
    }

    return trimmed;
}

module.exports = {
    formatUptime,
    parseUptimeString
};
