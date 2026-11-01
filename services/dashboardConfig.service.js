const fs = require('fs');
const path = require('path');
const { getAllModules } = require('./moduleRegistry.service');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'dashboard.json');
const BACKUP_PATH = path.join(__dirname, '..', 'config', 'dashboard.json.bak');

const DEFAULT_WIDGETS = [
    {
        id: 'smartDailyBriefingCard',
        title: '스마트 데일리 브리핑 (능동 비서)',
        icon: '🤖',
        enabled: true,
        order: 10,
        colSpan: 2,
        selector: '#smartDailyBriefingCard',
        desc: '시간대별 인사, 날씨 팁, 복약/혈압 능동 리마인드 및 오늘 일정 요약'
    },
    {
        id: 'homarrHeroCard',
        title: '일과 & 활동 링 / 복약 요약',
        icon: '🌟',
        enabled: true,
        order: 20,
        colSpan: 2,
        selector: '#homarrHeroCard',
        desc: 'Apple Activity Ring 일과 달성률 및 복약 퀵체크'
    },
    {
        id: 'cmd-strip',
        title: '원터치 빠른 실행 스트립',
        icon: '⚡',
        enabled: true,
        order: 30,
        colSpan: 2,
        selector: '.cmd-strip',
        desc: '원터치 퀵 커맨드 및 바로가기 버튼 바'
    },
    {
        id: 'breakingBannerBar',
        title: '실시간 속보 배너',
        icon: '🚨',
        enabled: true,
        order: 40,
        colSpan: 2,
        selector: '#breakingBannerBar',
        desc: '실시간 주요 속보 롤링 티커'
    },
    {
        id: 'bento-wiki',
        title: '오늘의 가족 루틴 & 장보기',
        icon: '✅',
        enabled: true,
        order: 50,
        colSpan: 1,
        selector: '#bento-wiki',
        desc: '오늘 할 일 체크리스트 및 실시간 장보기 목록'
    },
    {
        id: 'card-dday',
        title: '소모품 & 계약 D-Day',
        icon: '⏳',
        enabled: true,
        order: 60,
        colSpan: 1,
        selector: '.card-dday',
        desc: '정기 결제 및 소모품 교체 주기 D-Day'
    },
    {
        id: 'bento-calendar',
        title: '스마트 캘린더 다가오는 일정',
        icon: '📅',
        enabled: true,
        order: 70,
        colSpan: 1,
        selector: '#bento-calendar',
        desc: '이번 주 및 다가오는 가족 일정 요약'
    },
    {
        id: 'bento-album',
        title: '가족 앨범 최신 사진',
        icon: '📸',
        enabled: true,
        order: 80,
        colSpan: 1,
        selector: '#bento-album',
        desc: '최근 등록된 가족 사진 썸네일 스트립'
    },
    {
        id: 'bento-asset',
        title: '총 자산 포트폴리오',
        icon: '💰',
        enabled: true,
        order: 90,
        colSpan: 1,
        selector: '#bento-asset',
        desc: '총 자산 평가액 및 시장 지표 요약'
    },
    {
        id: 'bento-news',
        title: '실시간 주요 뉴스',
        icon: '📰',
        enabled: true,
        order: 100,
        colSpan: 1,
        selector: '#bento-news',
        desc: '분야별 주요 뉴스 및 시장 지표'
    },
    {
        id: 'bento-ops',
        title: '서버 인프라 관리 (듀얼)',
        icon: '🖥️',
        enabled: true,
        order: 110,
        colSpan: 2,
        selector: '#bento-ops',
        desc: '주서버(노트9) & 보조서버(노트북) 클러스터 상태'
    }
];

/**
 * 저장된 대시보드 위젯 설정 조회 (신규 모듈 위젯 자동 병합)
 */
function getDashboardConfig() {
    let saved = [];
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (e) {
        console.warn('[DashboardConfig] 설정 로드 실패, 기본값 사용:', e.message);
        saved = [...DEFAULT_WIDGETS];
    }

    if (!Array.isArray(saved) || saved.length === 0) {
        saved = [...DEFAULT_WIDGETS];
    }

    const savedMap = new Map();
    saved.forEach(w => savedMap.set(w.id, w));

    // 기본 위젯 중 빠진 항목 보충 (기존 설정 순서 보존을 위해 맨 뒤로 편입)
    let maxOrder = saved.reduce((m, w) => Math.max(m, w.order || 0), 0);
    DEFAULT_WIDGETS.forEach(def => {
        if (!savedMap.has(def.id)) {
            maxOrder += 10;
            const supplemented = { ...def, order: maxOrder };
            saved.push(supplemented);
            savedMap.set(def.id, supplemented);
        }
    });

    // modules.json의 신규 모듈 위젯 감지 및 자동 편입
    try {
        const modules = getAllModules(true);
        modules.forEach(mod => {
            if (mod.portalWidget && mod.portalWidget.enabled) {
                const widgetId = mod.portalWidget.cardId || `bento-${mod.id}`;
                if (!savedMap.has(widgetId)) {
                    maxOrder += 10;
                    const newWidget = {
                        id: widgetId,
                        title: mod.portalWidget.title || mod.name,
                        icon: mod.icon || '📦',
                        enabled: true,
                        order: maxOrder,
                        colSpan: 1,
                        selector: `#${widgetId}`,
                        desc: mod.description || `${mod.name} 대시보드 위젯`,
                        isModuleWidget: true,
                        moduleId: mod.id
                    };
                    saved.push(newWidget);
                    savedMap.set(widgetId, newWidget);
                }
            }
        });
    } catch (e) {}

    // order 순 정렬
    saved.sort((a, b) => (a.order || 0) - (b.order || 0));
    return saved;
}

/**
 * 대시보드 위젯 설정 저장
 */
function saveDashboardConfig(newWidgets) {
    if (!Array.isArray(newWidgets) || newWidgets.length === 0) {
        throw new Error('유효한 위젯 설정 배열이 필요합니다.');
    }

    // 순서 정규화
    const sanitized = newWidgets.map((w, idx) => ({
        id: String(w.id),
        title: String(w.title || w.id),
        icon: String(w.icon || '📦'),
        enabled: Boolean(w.enabled !== false),
        order: (idx + 1) * 10,
        colSpan: [1, 2].includes(Number(w.colSpan)) ? Number(w.colSpan) : 1,
        selector: String(w.selector || `#${w.id}`),
        desc: String(w.desc || ''),
        isModuleWidget: Boolean(w.isModuleWidget),
        moduleId: w.moduleId || undefined
    }));

    // 백업 생성
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
        }
    } catch (e) {}

    // 원자적 저장
    const tempPath = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(sanitized, null, 2), 'utf8');
    fs.renameSync(tempPath, CONFIG_PATH);

    return sanitized;
}

/**
 * 기본 설정으로 리셋
 */
function resetDashboardConfig() {
    return saveDashboardConfig(DEFAULT_WIDGETS);
}

module.exports = {
    getDashboardConfig,
    saveDashboardConfig,
    resetDashboardConfig
};
