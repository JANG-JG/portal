// ==============================================================================
// 🩸 대한고혈압학회(KSH) 진료지침 기준 혈압 분류 및 일정 유틸리티
// ==============================================================================

// 병원 진료 예약 오픈일 계산 헬퍼 함수
function calculateReservationOpenDate(nextVisitDateStr) {
    if (!nextVisitDateStr) return '-';
    try {
        const nextVisit = new Date(nextVisitDateStr);
        if (isNaN(nextVisit.getTime())) return '-';
        const dayOfWeek = nextVisit.getDay();
        const sunday = new Date(nextVisit);
        sunday.setDate(nextVisit.getDate() - dayOfWeek);

        const openFriday = new Date(sunday);
        openFriday.setDate(sunday.getDate() - 2);
        
        const year = openFriday.getFullYear();
        const month = String(openFriday.getMonth() + 1).padStart(2, '0');
        const day = String(openFriday.getDate()).padStart(2, '0');
        
        return `${year}-${month}-${day} 11:00`;
    } catch (e) {
        return '-';
    }
}

// 대한고혈압학회(KSH) 진료지침 기준 혈압 분류 헬퍼 함수
function classifyBloodPressure(sys, dia) {
    if (!sys || !dia) return null;
    const s = Number(sys);
    const d = Number(dia);
    if (isNaN(s) || isNaN(d)) return null;

    if (s < 90 || d < 60) {
        return {
            key: 'low',
            label: '저혈압 ❄️',
            name: '저혈압',
            desc: '수축기 90 미만 또는 이완기 60 미만',
            color: '#2563eb',
            badgeClass: 'bp-badge-low'
        };
    }
    if (s >= 160 || d >= 100) {
        return {
            key: 'stage2',
            label: '2기 고혈압 🚨',
            name: '고혈압 2기',
            desc: '수축기 160 이상 또는 이완기 100 이상',
            color: '#991b1b',
            badgeClass: 'bp-badge-stage2'
        };
    }
    if (s >= 140 || d >= 90) {
        return {
            key: 'stage1',
            label: '1기 고혈압 🔴',
            name: '고혈압 1기',
            desc: '수축기 140~159 또는 이완기 90~99',
            color: '#dc2626',
            badgeClass: 'bp-badge-stage1'
        };
    }
    if (s >= 130 || d >= 80) {
        return {
            key: 'prehypertension',
            label: '고혈압 전단계 🟠',
            name: '고혈압 전단계',
            desc: '수축기 130~139 또는 이완기 80~89',
            color: '#ea580c',
            badgeClass: 'bp-badge-pre'
        };
    }
    if (s >= 120 && d < 80) {
        return {
            key: 'elevated',
            label: '주의 혈압 🟡',
            name: '주의 혈압',
            desc: '수축기 120~129 그리고 이완기 80 미만',
            color: '#d97706',
            badgeClass: 'bp-badge-elevated'
        };
    }
    return {
        key: 'normal',
        label: '정상 혈압 🟢',
        name: '정상 혈압',
        desc: '수축기 120 미만 그리고 이완기 80 미만',
        color: '#059669',
        badgeClass: 'bp-badge-normal'
    };
}

module.exports = {
    calculateReservationOpenDate,
    classifyBloodPressure
};
