/**
 * 🍱 JG 포털 동적 커스텀 위젯 & 오픈소스 프리셋 서비스 (customWidgets.service.js)
 * - 오픈소스 서비스(Uptime Kuma, Glances, 웹 임베드 등) 및 사용자 정의 위젯 관리
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */
const fs = require('fs');
const path = require('path');

const WIDGETS_FILE = path.join(__dirname, '..', 'config', 'custom-widgets.json');

// 오픈소스 및 유용한 위젯 템플릿 프리셋
const BUILTIN_PRESETS = [
    {
        id: 'preset-server-resources',
        type: 'metric',
        title: '실시간 시스템 자원',
        icon: '📊',
        desc: '서버 CPU, 메모리, 디스크 실시간 사용률 게이지',
        colSpan: 1,
        endpoint: '/api/summary',
        refreshInterval: 15,
        renderType: 'system_gauge'
    },
    {
        id: 'preset-uptime-kuma',
        type: 'embed',
        title: '서비스 모니터링 (Uptime)',
        icon: '🛡️',
        desc: '서버/서비스 상태 모니터링 대시보드 임베드',
        colSpan: 2,
        embedUrl: 'https://uptime.j-jg.cc',
        embedHeight: 320
    },
    {
        id: 'preset-iframe-embed',
        type: 'embed',
        title: '반응형 웹 임베드 카드',
        icon: '🌐',
        desc: '오픈소스 웹 도구나 대시보드를 대시보드 카드에 바로 삽입',
        colSpan: 2,
        embedUrl: 'https://',
        embedHeight: 300
    },
    {
        id: 'preset-custom-api',
        type: 'metric',
        title: 'REST API 수치 위젯',
        icon: '⚡',
        desc: '외부 API에서 실시간 수치를 가져와 카운터/상태로 표시',
        colSpan: 1,
        endpoint: '',
        refreshInterval: 30,
        renderType: 'api_metric'
    }
];

function ensureConfigFile() {
    if (!fs.existsSync(WIDGETS_FILE)) {
        try {
            fs.writeFileSync(WIDGETS_FILE, JSON.stringify([], null, 2), 'utf8');
        } catch (e) {
            console.error('[CustomWidgets] 파일 생성 실패:', e);
        }
    }
}

/**
 * 등록된 전체 커스텀 위젯 목록 조회
 */
function getCustomWidgets() {
    ensureConfigFile();
    try {
        const raw = fs.readFileSync(WIDGETS_FILE, 'utf8');
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch (e) {
        console.error('[CustomWidgets] 로드 실패:', e);
        return [];
    }
}

/**
 * 커스텀 위젯 저장
 */
function saveCustomWidgets(list) {
    try {
        fs.writeFileSync(WIDGETS_FILE, JSON.stringify(list, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[CustomWidgets] 저장 실패:', e);
        return false;
    }
}

/**
 * 신규 커스텀 위젯 등록 또는 수정
 */
function upsertCustomWidget(widgetData) {
    if (!widgetData || !widgetData.title) {
        throw new Error('위젯 제목은 필수입니다.');
    }

    const list = getCustomWidgets();
    const id = widgetData.id || `custom-w-${Date.now()}`;
    const idx = list.findIndex(w => w.id === id);

    const newWidget = {
        id,
        title: widgetData.title.trim(),
        icon: widgetData.icon || '📦',
        desc: widgetData.desc || '사용자 커스텀 위젯',
        type: widgetData.type || 'embed', // 'embed' | 'metric' | 'quick-link'
        colSpan: (widgetData.colSpan === 2) ? 2 : 1,
        embedUrl: widgetData.embedUrl || '',
        embedHeight: Number(widgetData.embedHeight) || 280,
        endpoint: widgetData.endpoint || '',
        refreshInterval: Number(widgetData.refreshInterval) || 30,
        renderType: widgetData.renderType || 'custom',
        enabled: widgetData.enabled !== false,
        updatedAt: new Date().toISOString()
    };

    if (idx >= 0) {
        list[idx] = { ...list[idx], ...newWidget };
    } else {
        list.push(newWidget);
    }

    saveCustomWidgets(list);
    return newWidget;
}

/**
 * 커스텀 위젯 삭제
 */
function deleteCustomWidget(id) {
    const list = getCustomWidgets();
    const filtered = list.filter(w => w.id !== id);
    if (filtered.length === list.length) {
        throw new Error('해당 위젯을 찾을 수 없습니다.');
    }
    saveCustomWidgets(filtered);
    return true;
}

module.exports = {
    BUILTIN_PRESETS,
    getCustomWidgets,
    upsertCustomWidget,
    deleteCustomWidget
};
