/**
 * 🛠️ JG 포털 AI 비서 - 도구 레지스트리 및 RBAC 디스패처 (aiTools.registry.js)
 * - 3계층 권한(관리자 전용 / 가족 공용 / 개인 전용)에 따른 도구 동적 필터링
 * - 사용자 세션(req.user)에 없는 도구는 목록에서 아예 은닉 (Security by Design)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { isServiceAllowed } = require('../moduleRegistry.service');
const {
    isAdmin,
    fetchBloodSummary,
    fetchAssetSummary,
    fetchSystemStatus,
    fetchWeatherSummary,
    fetchMarketIndicators,
    fetchNewsTop,
    fetchFamilyCalendar,
    fetchFamilyWiki,
    fetchFamilyPhotos,
    fetchPersonalCalendar,
    fetchPersonalMemos
} = require('./aiDataFetchers.service');

/**
 * 📋 3계층 전체 도구 마스터 정의
 */
const MASTER_TOOLS = {
    // =========================================================================
    // 🔒 1. 관리자 전용 도구 (role === 'admin')
    // =========================================================================
    get_blood_records: {
        name: 'get_blood_records',
        description: '관리자 본인의 최근 혈압 측정치(수축기/이완기/맥박), 정상 여부, 오늘 복약 완료 여부를 확인합니다.',
        category: 'admin',
        parameters: { type: 'object', properties: {} },
        handler: async (params, user) => fetchBloodSummary(user)
    },
    get_asset_summary: {
        name: 'get_asset_summary',
        description: '관리자 본인의 총 금융 자산 평가액, 원달러 환율, 주요 보유 주식/포트폴리오 비중을 확인합니다.',
        category: 'admin',
        parameters: { type: 'object', properties: {} },
        handler: async (params, user) => fetchAssetSummary(user)
    },
    get_system_status: {
        name: 'get_system_status',
        description: '포털 메인 서버의 CPU 사용률, 메모리 점유율, 디스크 용량 등 시스템 관제 지표를 확인합니다.',
        category: 'admin',
        parameters: { type: 'object', properties: {} },
        handler: async (params, user) => fetchSystemStatus(user)
    },

    // =========================================================================
    // 👥 2. 가족 공용 도구 (모든 사용자 허용, 서비스 권한 연동)
    // =========================================================================
    get_weather: {
        name: 'get_weather',
        description: '현재 거주 지역의 실시간 날씨, 기온, 체감온도, 미세먼지 상태, 강수 확률을 확인합니다.',
        category: 'family',
        parameters: { type: 'object', properties: {} },
        handler: async (params, user) => fetchWeatherSummary(user)
    },
    get_market_indicators: {
        name: 'get_market_indicators',
        description: '코스피, 코스닥 지수 및 원달러 환율 등 공개 거시 경제 지표를 확인합니다. (개인 자산과 무관)',
        category: 'family',
        parameters: { type: 'object', properties: {} },
        handler: async () => fetchMarketIndicators()
    },
    get_news_top: {
        name: 'get_news_top',
        description: '실시간 주요 뉴스 헤드라인을 확인하거나 특정 주제/키워드 뉴스를 검색합니다.',
        category: 'family',
        requiredService: 'news',
        parameters: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '검색할 뉴스 키워드 (생략 시 주요 헤드라인)' }
            }
        },
        handler: async (params) => fetchNewsTop(params?.keyword)
    },
    get_family_calendar: {
        name: 'get_family_calendar',
        description: '가족 전체가 공유하는 가족 행사, 모임, 제사, 가족 여행 일정을 조회합니다.',
        category: 'family',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'string', description: '시작일 (YYYY-MM-DD, 생략 시 오늘)' },
                endDate: { type: 'string', description: '종료일 (YYYY-MM-DD, 생략 시 시작일과 동일)' }
            }
        },
        handler: async (params) => fetchFamilyCalendar(params?.startDate, params?.endDate)
    },
    get_family_wiki: {
        name: 'get_family_wiki',
        description: '가족 위키에 기록된 가전 매뉴얼, 생활 팁, 집안 규칙, 레시피 지식을 검색합니다.',
        category: 'family',
        requiredService: 'wiki',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색할 위키 키워드' }
            },
            required: ['query']
        },
        handler: async (params) => fetchFamilyWiki(params?.query)
    },
    get_family_photos: {
        name: 'get_family_photos',
        description: '가족 사진첩(앨범)에서 특정 날짜, 장소, 인물 등의 추억 사진을 검색합니다.',
        category: 'family',
        requiredService: 'album',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색할 사진 키워드 (예: 제주도, 생일, 크리스마스 등)' }
            }
        },
        handler: async (params) => fetchFamilyPhotos(params?.query)
    },

    // =========================================================================
    // 👤 3. 개인 전용 도구 (본인 계정의 데이터만 엄격 격리)
    // =========================================================================
    get_personal_calendar: {
        name: 'get_personal_calendar',
        description: '로그인한 본인의 개인 약속, 업무, 병원 방문 등 개인 캘린더 일정을 조회합니다.',
        category: 'personal',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'string', description: '시작일 (YYYY-MM-DD, 생략 시 오늘)' },
                endDate: { type: 'string', description: '종료일 (YYYY-MM-DD, 생략 시 시작일과 동일)' }
            }
        },
        handler: async (params, user) => fetchPersonalCalendar(user?.username, params?.startDate, params?.endDate)
    },
    get_personal_memos: {
        name: 'get_personal_memos',
        description: '로그인한 본인이 작성한 개인 메모장을 검색하거나 최근 메모를 확인합니다. (타인 메모 열람 불가)',
        category: 'personal',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색할 메모 단어 또는 내용 (생략 시 최근 메모)' }
            }
        },
        handler: async (params, user) => fetchPersonalMemos(user?.username, params?.query)
    }
};

function isToolPermittedForUser(toolDef, user) {
    if (!toolDef) return false;
    if (toolDef.category === 'admin' && !isAdmin(user)) {
        return false;
    }
    if (toolDef.requiredService && !isAdmin(user) && !isServiceAllowed(user, toolDef.requiredService)) {
        return false;
    }
    return true;
}

/**
 * 🛡️ [RBAC 보안 필터] 현재 사용자 권한에 허용된 도구 목록만 선별 반환
 */
function getPermittedTools(user) {
    const permitted = [];

    for (const [, toolDef] of Object.entries(MASTER_TOOLS)) {
        if (!isToolPermittedForUser(toolDef, user)) {
            continue;
        }
        permitted.push({
            type: 'function',
            function: {
                name: toolDef.name,
                description: toolDef.description,
                parameters: toolDef.parameters
            }
        });
    }

    return permitted;
}

/**
 * ⚡ [보안 실행 디스패처] 도구 호출 실행 (이중 권한 체크)
 */
async function executeTool(toolName, params = {}, user = null) {
    const tool = MASTER_TOOLS[toolName];
    if (!tool) {
        return { success: false, error: `알 수 없는 도구 요청입니다: ${toolName}` };
    }

    if (!isToolPermittedForUser(tool, user)) {
        return {
            success: false,
            error: '해당 기능에 대한 조회 권한이 없습니다.'
        };
    }

    try {
        const data = await tool.handler(params, user);
        return { success: true, toolName, data };
    } catch (err) {
        console.error(`[aiTools.registry] 도구 ${toolName} 실행 중 오류:`, err);
        return { success: false, error: '데이터 조회 중 오류가 발생했습니다.' };
    }
}

module.exports = {
    MASTER_TOOLS,
    getPermittedTools,
    executeTool
};
