/**
 * 🌅 JG 포털 능동형 스마트 데일리 브리핑 서비스 (dailyBriefing.service.js)
 * - 시간대(아침/오후/저녁/밤) 인지 및 감성적 다정 인사 생성
 * - 실시간 날씨 & 기온 기반 생활 가이드
 * - 오늘 복약 & 혈압 측정 여부 능동 감지 및 액션 유도
 * - 오늘 캘린더 일정 및 임박 이벤트 요약
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 * - 3단계 로컬 AI 비서(Ollama / Gemini) 연동 슬롯(aiSlot) 완벽 대비
 */

/**
 * KST 기준 현재 시간대 슬롯 판정
 */
function getTimeSlot(hour) {
    if (hour >= 5 && hour < 11) {
        return {
            key: 'morning',
            label: '상쾌한 아침',
            icon: '🌅',
            greeting: '좋은 아침입니다! 활기차고 건강한 하루 시작하세요.'
        };
    } else if (hour >= 11 && hour < 17) {
        return {
            key: 'afternoon',
            label: '활기찬 오후',
            icon: '☀️',
            greeting: '활기찬 오후 보내고 계신가요? 차 한 잔의 여유와 함께 힘내세요.'
        };
    } else if (hour >= 17 && hour < 22) {
        return {
            key: 'evening',
            label: '편안한 저녁',
            icon: '🌆',
            greeting: '오늘 하루도 수고 많으셨습니다! 편안하고 따뜻한 저녁 되세요.'
        };
    } else {
        return {
            key: 'night',
            label: '깊은 밤',
            icon: '🌙',
            greeting: '포근한 밤 되세요. 오늘도 고생 많으셨습니다.'
        };
    }
}

/**
 * 날씨 및 기온 기반 맞춤형 생활 가이드 문구 (기상청 수집 데이터 근거 연동)
 */
function getWeatherGuide(weather) {
    if (!weather || !weather.temp) {
        return '오늘도 쾌적하고 기분 좋은 하루 보내세요.';
    }

    const cond = weather.condition || '';
    const isKma = (weather.data_source === 'kma' || weather.source_label === '기상청 공식');
    const minT = weather.min_temp || (weather.forecast?.[0]?.min);
    const maxT = weather.max_temp || (weather.forecast?.[0]?.max);

    // 1순위: 기상청 공식 생활가이드 문장이 존재하면 우선 채택
    if (isKma && weather.guide && !weather.guide.startsWith('상쾌하고')) {
        return weather.guide;
    }

    if (cond.includes('비') || cond.includes('소나기') || cond.includes('이슬비')) {
        return '비 소식이 있으니 외출 시 우산을 꼭 챙기세요 ☔';
    }
    if (cond.includes('눈')) {
        return '눈길 빙판길 미끄럼에 주의하시고 따뜻하게 입으세요 ❄️';
    }

    const tempNum = parseFloat(weather.temp);
    if (!isNaN(tempNum)) {
        if (tempNum >= 28) {
            return '날씨가 다소 덥습니다. 시원한 물을 자주 드세요 💧';
        } else if (tempNum <= 5) {
            const rangeStr = (minT && maxT) ? ` (최저 ${minT} / 최고 ${maxT})` : '';
            return `기온이 낮고 쌀쌀합니다${rangeStr}. 따뜻한 외투를 챙기세요 🧣`;
        } else if (tempNum <= 15) {
            const rangeStr = (minT && maxT) ? ` (최저 ${minT} / 최고 ${maxT})` : '';
            return `일교차가 있는 날씨입니다${rangeStr}. 겉옷을 가볍게 챙겨 외출하세요 🧥`;
        }
    }

    return '바깥 활동하기 좋은 날씨입니다. 상쾌한 하루 되세요 ✨';
}

/**
 * 오늘 복약 및 혈압 상태 기반 능동 건강 브리핑 생성
 */
function getHealthBriefing(blood, medication, hasBloodAccess) {
    if (!hasBloodAccess) {
        return {
            hasAccess: false,
            statusBadge: '가족 모드',
            badgeClass: 'badge-blue',
            headline: '오늘도 건강하고 행복한 하루 되세요!',
            subText: '가족 루틴과 일정 관리를 함께 확인해 보세요.',
            actionRequired: false,
            actionType: null
        };
    }

    const medTaken = !!(medication && medication.is_today_taken);
    const bloodMeasured = !!(blood && blood.is_today_measured);

    // 1. 둘 다 미완료: 가장 긴급
    if (!medTaken && !bloodMeasured) {
        return {
            hasAccess: true,
            statusBadge: '확인 필요 ⚠️',
            badgeClass: 'badge-amber',
            headline: '오늘 혈압약과 혈압 측정이 아직 안 되었어요',
            subText: '잊지 말고 약을 챙겨드시고 편안한 시간에 혈압을 기록해 주세요.',
            actionRequired: true,
            actionType: 'quick_med',
            actionBtnText: '💊 약 복용 기록',
            secondaryBtnText: '🩸 혈압 기록'
        };
    }

    // 2. 약은 안 드셨고, 혈압만 측정함
    if (!medTaken) {
        return {
            hasAccess: true,
            statusBadge: '복약 미완료 💊',
            badgeClass: 'badge-amber',
            headline: '오늘 약을 아직 안 챙겨드셨어요',
            subText: '규칙적인 복약이 혈압 관리의 기본입니다. 잊지 말고 챙겨드세요!',
            actionRequired: true,
            actionType: 'quick_med',
            actionBtnText: '💊 약 먹었어요',
            secondaryBtnText: null
        };
    }

    // 3. 약은 드셨고, 혈압 측정이 아직임
    if (!bloodMeasured) {
        return {
            hasAccess: true,
            statusBadge: '약 복용 완료 ✅',
            badgeClass: 'badge-emerald',
            headline: '오늘 약 복용 완료! 혈압 측정도 잊지 마세요',
            subText: '오늘의 편안한 상태에서 혈압을 한 번 측정해 기록해 두세요.',
            actionRequired: false,
            actionType: 'blood_check',
            actionBtnText: null,
            secondaryBtnText: '🩸 혈압 기록하기'
        };
    }

    // 4. 둘 다 완벽히 완료!
    const gradeName = (blood.grade && blood.grade.name) ? blood.grade.name : '정상';
    return {
        hasAccess: true,
        statusBadge: '건강 관리 완료 🟢',
        badgeClass: 'badge-emerald',
        headline: `오늘 약 복용과 혈압 측정(${blood.systolic}/${blood.diastolic}) 모두 완료!`,
        subText: `최근 혈압: ${gradeName} 수치로 안정적으로 유지되고 있습니다. 훌륭해요! 👍`,
        actionRequired: false,
        actionType: 'done',
        actionBtnText: null,
        secondaryBtnText: null
    };
}

/**
 * 캘린더 오늘 일정 요약 생성
 */
function getScheduleBriefing(todayEvents) {
    if (!Array.isArray(todayEvents) || todayEvents.length === 0) {
        return {
            hasEvents: false,
            count: 0,
            text: '오늘 등록된 예정 일정이 없습니다. 여유로운 하루 보내세요 ☕'
        };
    }

    const count = todayEvents.length;
    const first = todayEvents[0];
    const timeStr = first.event_time ? `[${first.event_time.slice(0, 5)}] ` : '';
    const firstTitle = first.title || '일정';

    if (count === 1) {
        return {
            hasEvents: true,
            count: 1,
            text: `오늘 일정 1건: ${timeStr}${firstTitle}`
        };
    }

    return {
        hasEvents: true,
        count: count,
        text: `오늘 일정 ${count}건: ${timeStr}${firstTitle} 외 ${count - 1}건`
    };
}

/**
 * 🌟 통합 능동형 데일리 브리핑 객체 빌드
 */
function generateDailyBriefing({ summary, todayEvents = [], userRole = 'admin', userName = '가족' }) {
    const now = new Date();
    // KST 시각 기준 시(Hour)
    const kstHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).getHours();
    const timeSlot = getTimeSlot(kstHour);

    const hasBloodAccess = (userRole === 'admin');
    const weather = summary ? summary.weather : null;
    const blood = summary ? summary.blood : null;
    const medication = summary ? summary.medication : null;

    const weatherGuide = getWeatherGuide(weather);
    const health = getHealthBriefing(blood, medication, hasBloodAccess);
    const schedule = getScheduleBriefing(todayEvents);
    const wikiTip = (summary && summary.wiki && summary.wiki.proactiveTip) ? summary.wiki.proactiveTip : null;

    // 원라이너 스마트 인사 (AI 비서 준비용)
    const naturalSummary = `${timeSlot.greeting} ${schedule.hasEvents ? schedule.text : ''} ${weatherGuide}`.trim();

    return {
        timeSlot: timeSlot.key,
        timeSlotLabel: timeSlot.label,
        timeSlotIcon: timeSlot.icon,
        greeting: timeSlot.greeting,
        userName: userName,
        generatedAt: now.toISOString(),
        weather: {
            city: (weather && weather.city === 'Gyeryong' ? '계룡' : (weather && weather.city) || '서울'),
            temp: (weather && weather.temp) || '',
            condition: (weather && weather.condition) || '맑음',
            icon: (weather && weather.icon) || '🌤️',
            feels_like: (weather && weather.feels_like) || '',
            min_temp: (weather && weather.min_temp) || (weather && weather.forecast?.[0]?.min) || '',
            max_temp: (weather && weather.max_temp) || (weather && weather.forecast?.[0]?.max) || '',
            data_source: (weather && weather.data_source) || 'open-meteo',
            source_label: (weather && weather.source_label) || '기상청 공식',
            guide: weatherGuide
        },
        health,
        schedule,
        wikiTip: wikiTip ? {
            title: wikiTip.title,
            slug: wikiTip.slug,
            category: wikiTip.category || '생활',
            reason: wikiTip.reason || '오늘의 추천 가족 지식이에요 💡',
            excerpt: wikiTip.excerpt || ''
        } : null,
        naturalSummary,
        // 3단계 로컬 AI 비서(sLLM / Gemini API)가 연결될 확장 슬롯
        aiSlot: {
            ready: true,
            active: false,
            message: null
        }
    };
}

module.exports = {
    generateDailyBriefing,
    getTimeSlot,
    getWeatherGuide,
    getHealthBriefing,
    getScheduleBriefing
};
