const fs = require('fs');
const path = require('path');
const { getAllModules } = require('./moduleRegistry.service');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'dashboard.json');
const BACKUP_PATH = path.join(__dirname, '..', 'config', 'dashboard.json.bak');

const DEFAULT_SECTIONS = [
    { id: 'today', title: '오늘의 요약 · 빠른 실행', icon: '🌅', order: 10 },
    { id: 'life', title: '우리 가족 생활 · 기록', icon: '🏡', order: 20 },
    { id: 'info', title: '자산 · 뉴스 · 서버 관리', icon: '📊', order: 30 }
];

const VALID_SPAN_MODES = ['third', 'half', 'wide', 'full'];

const DEFAULT_SECTION_BY_WIDGET = {
    smartDailyBriefingCard: 'today',
    homarrHeroCard: 'today',
    'cmd-strip': 'today',
    portalStudyBuddyStrip: 'today',
    breakingBannerBar: 'today',
    'bento-wiki': 'life',
    'card-dday': 'life',
    'bento-calendar': 'life',
    'bento-album': 'life',
    'bento-asset': 'info',
    'bento-news': 'info',
    'bento-ops': 'info'
};

function normalizeSpanMode(w) {
    if (w && VALID_SPAN_MODES.includes(w.spanMode)) {
        return w.spanMode;
    }
    return Number(w && w.colSpan) === 2 ? 'full' : 'half';
}

function sanitizeSections(sectionsInput) {
    const raw = Array.isArray(sectionsInput) && sectionsInput.length > 0
        ? sectionsInput
        : DEFAULT_SECTIONS;
    const seen = new Set();
    const cleaned = [];
    raw.forEach((sec, idx) => {
        if (!sec || typeof sec !== 'object') return;
        let id = String(sec.id || `sec-${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        if (!id) id = `sec-${idx + 1}`;
        while (seen.has(id)) {
            id = `${id}-${idx + 1}`;
        }
        seen.add(id);
        cleaned.push({
            id,
            title: String(sec.title || '새 섹션').trim().slice(0, 48) || '새 섹션',
            icon: String(sec.icon || '📁').trim().slice(0, 8) || '📁',
            order: (idx + 1) * 10
        });
    });
    return cleaned.length > 0 ? cleaned : DEFAULT_SECTIONS.map(s => ({ ...s }));
}

const DEFAULT_WIDGETS = [
    {
        id: 'smartDailyBriefingCard',
        title: '스마트 데일리 브리핑 (능동 비서)',
        icon: '🤖',
        enabled: true,
        order: 10,
        colSpan: 2,
        spanMode: 'full',
        sectionId: 'today',
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
        spanMode: 'full',
        sectionId: 'today',
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
        spanMode: 'full',
        sectionId: 'today',
        selector: '.cmd-strip',
        desc: '원터치 퀵 커맨드 및 바로가기 버튼 바'
    },
    {
        id: 'portalStudyBuddyStrip',
        title: '오늘의 우리 아이 학습 단짝',
        icon: '🐣',
        enabled: true,
        order: 35,
        colSpan: 2,
        spanMode: 'full',
        sectionId: 'today',
        selector: '#portalStudyBuddyStrip',
        desc: '아이별 학습 도장 진행률 및 단짝 포켓몬 현황',
        defaultAfterId: 'cmd-strip'
    },
    {
        id: 'breakingBannerBar',
        title: '실시간 속보 배너',
        icon: '🚨',
        enabled: true,
        order: 40,
        colSpan: 2,
        spanMode: 'full',
        sectionId: 'today',
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
        spanMode: 'half',
        sectionId: 'life',
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
        spanMode: 'half',
        sectionId: 'life',
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
        spanMode: 'half',
        sectionId: 'life',
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
        spanMode: 'half',
        sectionId: 'life',
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
        spanMode: 'half',
        sectionId: 'info',
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
        spanMode: 'half',
        sectionId: 'info',
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
        spanMode: 'full',
        sectionId: 'info',
        selector: '#bento-ops',
        desc: '주서버(노트9) & 보조서버(노트북) 클러스터 상태'
    }
];

/**
 * 저장된 대시보드 섹션 + 위젯 설정 조회 (구 배열 포맷 자동 마이그레이션 및 신규 모듈 병합)
 */
function getDashboardState() {
    let saved = [];
    let sections = DEFAULT_SECTIONS.map(s => ({ ...s }));

    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (Array.isArray(raw)) {
                saved = raw;
            } else if (raw && typeof raw === 'object') {
                saved = Array.isArray(raw.widgets) ? raw.widgets : [];
                if (Array.isArray(raw.sections) && raw.sections.length > 0) {
                    sections = sanitizeSections(raw.sections);
                }
            }
        }
    } catch (e) {
        console.warn('[DashboardConfig] 설정 로드 실패, 기본값 사용:', e.message);
        saved = DEFAULT_WIDGETS.map(w => ({ ...w }));
    }

    if (!Array.isArray(saved) || saved.length === 0) {
        saved = DEFAULT_WIDGETS.map(w => ({ ...w }));
    }

    sections.sort((a, b) => (a.order || 0) - (b.order || 0));
    const sectionIds = new Set(sections.map(s => s.id));
    const fallbackSectionId = sections[sections.length - 1]?.id || sections[0].id;

    const savedMap = new Map();
    saved.forEach(w => {
        if (!w || !w.id) return;
        const spanMode = normalizeSpanMode(w);
        const preferredSection = w.sectionId || DEFAULT_SECTION_BY_WIDGET[w.id] || fallbackSectionId;
        const normalized = {
            ...w,
            spanMode,
            colSpan: spanMode === 'full' ? 2 : 1,
            sectionId: sectionIds.has(preferredSection) ? preferredSection : sections[0].id
        };
        savedMap.set(w.id, normalized);
    });

    const normalizedSaved = Array.from(savedMap.values());

    // 기본 위젯 중 빠진 항목 보충
    let maxOrder = normalizedSaved.reduce((m, w) => Math.max(m, w.order || 0), 0);
    DEFAULT_WIDGETS.forEach(def => {
        if (!savedMap.has(def.id)) {
            const { defaultAfterId, ...widgetDef } = def;
            let insertOrder = maxOrder + 10;
            let insertSection = sectionIds.has(def.sectionId) ? def.sectionId : sections[0].id;
            if (defaultAfterId && savedMap.has(defaultAfterId)) {
                const anchor = savedMap.get(defaultAfterId);
                const anchorOrder = Number(anchor.order || 0);
                insertSection = anchor.sectionId || insertSection;
                const nextOrders = normalizedSaved
                    .map(w => Number(w.order || 0))
                    .filter(ord => ord > anchorOrder)
                    .sort((a, b) => a - b);
                insertOrder = nextOrders.length > 0 ? (anchorOrder + nextOrders[0]) / 2 : anchorOrder + 5;
            } else {
                maxOrder += 10;
                insertOrder = maxOrder;
            }
            const supplemented = { ...widgetDef, order: insertOrder, sectionId: insertSection };
            normalizedSaved.push(supplemented);
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
                        spanMode: 'half',
                        sectionId: fallbackSectionId,
                        selector: `#${widgetId}`,
                        desc: mod.description || `${mod.name} 대시보드 위젯`,
                        isModuleWidget: true,
                        moduleId: mod.id
                    };
                    normalizedSaved.push(newWidget);
                    savedMap.set(widgetId, newWidget);
                }
            }
        });
    } catch (e) {}

    normalizedSaved.sort((a, b) => (a.order || 0) - (b.order || 0));
    return { widgets: normalizedSaved, sections };
}

function getDashboardConfig() {
    return getDashboardState().widgets;
}

/**
 * 대시보드 섹션 + 위젯 설정 저장
 */
function saveDashboardConfig(newWidgets, newSections) {
    if (!Array.isArray(newWidgets) || newWidgets.length === 0) {
        throw new Error('유효한 위젯 설정 배열이 필요합니다.');
    }

    const currentSections = getDashboardState().sections;
    const sections = sanitizeSections(
        Array.isArray(newSections) && newSections.length > 0 ? newSections : currentSections
    );
    const validSectionIds = new Set(sections.map(s => s.id));
    const defaultSectionId = sections[0].id;

    const sanitizedWidgets = newWidgets.map((w, idx) => {
        const spanMode = normalizeSpanMode(w);
        const prefSec = w.sectionId || DEFAULT_SECTION_BY_WIDGET[w.id] || defaultSectionId;
        return {
            id: String(w.id),
            title: String(w.title || w.id),
            icon: String(w.icon || '📦'),
            enabled: Boolean(w.enabled !== false),
            order: (idx + 1) * 10,
            colSpan: spanMode === 'full' ? 2 : 1,
            spanMode,
            sectionId: validSectionIds.has(prefSec) ? prefSec : defaultSectionId,
            selector: String(w.selector || `#${w.id}`),
            desc: String(w.desc || ''),
            isModuleWidget: Boolean(w.isModuleWidget),
            moduleId: w.moduleId || undefined
        };
    });

    // 백업 생성
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
        }
    } catch (e) {}

    // 원자적 저장 ({ sections, widgets } 통합 포맷)
    const tempPath = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ sections, widgets: sanitizedWidgets }, null, 2), 'utf8');
    fs.renameSync(tempPath, CONFIG_PATH);

    return { widgets: sanitizedWidgets, sections };
}

/**
 * 기본 설정으로 리셋
 */
function resetDashboardConfig() {
    return saveDashboardConfig(DEFAULT_WIDGETS, DEFAULT_SECTIONS);
}

module.exports = {
    getDashboardState,
    getDashboardConfig,
    saveDashboardConfig,
    resetDashboardConfig
};
