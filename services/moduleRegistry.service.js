const fs = require('fs');
const path = require('path');

const MODULES_CONFIG_PATH = path.join(__dirname, '..', 'config', 'modules.json');

let cachedModules = null;
let lastMtime = 0;

/**
 * modules.json 파일에서 모듈 설정 목록을 읽어옵니다. (캐시 및 변경 감지 리로드)
 * @returns {Array} 모듈 설정 배열
 */
function loadModulesConfig() {
    try {
        if (!fs.existsSync(MODULES_CONFIG_PATH)) {
            console.warn('[ModuleRegistry] modules.json 파일을 찾을 수 없습니다.');
            return [];
        }

        const stat = fs.statSync(MODULES_CONFIG_PATH);
        if (cachedModules && stat.mtimeMs <= lastMtime) {
            return cachedModules;
        }

        const raw = fs.readFileSync(MODULES_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            cachedModules = parsed.sort((a, b) => (a.order || 999) - (b.order || 999));
            lastMtime = stat.mtimeMs;
        } else {
            cachedModules = [];
        }
        return cachedModules;
    } catch (err) {
        console.error('[ModuleRegistry] modules.json 파싱 실패:', err.message);
        return cachedModules || [];
    }
}

/**
 * 사용자 권한(allowed_services) 파싱 헬퍼
 * @param {string|Array} allowedServices 
 * @returns {string[]} 서비스 ID 목록
 */
function parseAllowedServices(allowedServices) {
    if (!allowedServices) return [];
    if (Array.isArray(allowedServices)) return allowedServices;
    if (typeof allowedServices === 'string') {
        const trimmed = allowedServices.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                return JSON.parse(trimmed);
            } catch (e) {
                // fall through
            }
        }
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

/**
 * 전체 모듈 목록 조회 (includeDisabled = true 시 비활성 모듈 포함)
 * @param {boolean} includeDisabled 
 * @returns {Array}
 */
function getAllModules(includeDisabled = false) {
    const modules = loadModulesConfig();
    if (includeDisabled) return [...modules];
    return modules.filter(m => m.enabled !== false);
}

/**
 * 특정 사용자(req.user)에게 허용된 모듈 목록 조회
 * @param {object} user - { username, role, allowed_services, ... }
 * @returns {Array} 필터링된 모듈 목록
 */
function getUserModules(user) {
    const modules = getAllModules();
    if (!user) {
        return modules.filter(m => !m.adminOnly && m.defaultFamilyAllowed);
    }

    if (user.role === 'admin') {
        return modules;
    }

    const allowedList = parseAllowedServices(user.allowed_services);
    const isAllAllowed = allowedList.includes('all');

    return modules.filter(m => {
        // 관리자 전용 모듈은 가족 사용자 차단
        if (m.adminOnly) return false;

        // 전체 허용이거나 명시적으로 허용된 경우
        if (isAllAllowed || allowedList.includes(m.id)) return true;

        // 기본 가족 허용 서비스 (defaultFamilyAllowed)
        return Boolean(m.defaultFamilyAllowed);
    });
}

/**
 * 특정 모듈 ID 조회
 * @param {string} id 
 * @returns {object|null}
 */
function getModuleById(id) {
    const modules = loadModulesConfig();
    return modules.find(m => m.id === id) || null;
}

/**
 * 사용자가 특정 서비스에 접근할 권한이 있는지 검사
 * @param {object} user 
 * @param {string} serviceId 
 * @returns {boolean}
 */
function isServiceAllowed(user, serviceId) {
    if (!user) return false;
    if (user.role === 'admin') return true;

    const mod = getModuleById(serviceId);
    if (!mod || mod.enabled === false) return false;
    if (mod.adminOnly) return false;

    const allowedList = parseAllowedServices(user.allowed_services);
    if (allowedList.includes('all') || allowedList.includes(serviceId)) return true;

    return Boolean(mod.defaultFamilyAllowed);
}

/**
 * 네비게이션 렌더링용 간소화된 모듈 데이터 추출
 * @param {object} user 
 * @returns {Array}
 */
function getNavModules(user) {
    const modules = getUserModules(user);
    return modules
        .filter(m => m.nav && m.nav.enabled)
        .map(m => ({
            id: m.id,
            name: m.name,
            icon: m.icon,
            entryUrl: m.nav.entryUrl || m.entryUrl,
            label: m.nav.label || m.name,
            subLinks: m.nav.subLinks || []
        }));
}

/**
 * 빠른 실행(Quick Strip)용 간소화된 데이터 추출
 * @param {object} user 
 * @returns {Array}
 */
function getQuickStripItems(user) {
    const modules = getUserModules(user);
    const items = [];
    for (const m of modules) {
        if (Array.isArray(m.quickStrip)) {
            for (const qs of m.quickStrip) {
                items.push({
                    moduleId: m.id,
                    ...qs
                });
            }
        }
    }
    return items;
}

const CORE_MODULE_IDS = new Set(['portal', 'blood', 'asset', 'news', 'album', 'wiki', 'calendar', 'memo']);

/**
 * modules.json 안전 저장 (백업 생성 + 캐시 동기화)
 * @param {Array} modules 
 */
function saveModulesConfig(modules) {
    try {
        if (!Array.isArray(modules)) throw new Error('모듈 데이터는 배열이어야 합니다.');
        
        // 1) 안전 백업 (.bak)
        if (fs.existsSync(MODULES_CONFIG_PATH)) {
            const bakPath = `${MODULES_CONFIG_PATH}.bak`;
            fs.copyFileSync(MODULES_CONFIG_PATH, bakPath);
        }

        // 2) 순서 정렬 후 저장
        const sorted = modules.sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999));
        fs.writeFileSync(MODULES_CONFIG_PATH, JSON.stringify(sorted, null, 2), 'utf8');

        // 3) 캐시 즉시 갱신
        cachedModules = sorted;
        const stat = fs.statSync(MODULES_CONFIG_PATH);
        lastMtime = stat.mtimeMs;
        return true;
    } catch (err) {
        console.error('[ModuleRegistry] 저장 실패:', err.message);
        throw err;
    }
}

/**
 * 특정 모듈 On/Off 활성화 토글
 * @param {string} moduleId 
 * @returns {object} 업데이트된 모듈
 */
function toggleModuleEnabled(moduleId) {
    const modules = loadModulesConfig();
    const target = modules.find(m => m.id === moduleId);
    if (!target) throw new Error('해당 모듈을 찾을 수 없습니다.');

    target.enabled = (target.enabled === false);
    saveModulesConfig(modules);
    return target;
}

/**
 * 신규 모듈 등록 또는 기존 모듈 수정
 * @param {object} data 
 * @param {boolean} isNew 
 * @returns {object}
 */
function createOrUpdateModule(data, isNew = false) {
    if (!data.id || !data.name || !data.entryUrl) {
        throw new Error('모듈 ID, 한글명, 진입 URL은 필수 입력 항목입니다.');
    }

    const cleanId = String(data.id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!cleanId) throw new Error('모듈 ID는 영문 소문자, 숫자, 하이픈(-)만 가능합니다.');

    const modules = loadModulesConfig();
    const existingIdx = modules.findIndex(m => m.id === cleanId);

    if (isNew && existingIdx !== -1) {
        throw new Error(`이미 존재하는 모듈 ID입니다: ${cleanId}`);
    }

    const existingMod = existingIdx !== -1 ? modules[existingIdx] : null;

    const modPayload = {
        id: cleanId,
        name: String(data.name).trim(),
        icon: data.icon ? String(data.icon).trim() : '📦',
        description: data.description ? String(data.description).trim() : '',
        category: data.category ? String(data.category).trim() : '라이프',
        entryUrl: String(data.entryUrl).trim(),
        baseUrl: data.baseUrl ? String(data.baseUrl).trim() : '',
        ssoEnabled: Boolean(data.ssoEnabled !== undefined ? data.ssoEnabled : data.baseUrl),
        adminOnly: Boolean(data.adminOnly),
        defaultFamilyAllowed: Boolean(data.defaultFamilyAllowed),
        enabled: data.enabled !== false,
        nav: data.nav || { enabled: true, label: data.name, entryUrl: data.entryUrl, subLinks: [] },
        quickStrip: Array.isArray(data.quickStrip) ? data.quickStrip : [
            { id: `${cleanId}-quick`, label: data.name, icon: data.icon || '📦', type: 'link', url: data.entryUrl }
        ],
        portalWidget: data.portalWidget || null,
        admin: data.admin || null,
        dbPath: (data.dbPath !== undefined) ? String(data.dbPath).trim() : (existingMod ? (existingMod.dbPath || '') : '')
    };

    // 노출 순서 위치(1-based) 처리
    let targetPos = null;
    if (data.targetPosition !== undefined && data.targetPosition !== null && data.targetPosition !== '') {
        targetPos = parseInt(data.targetPosition, 10);
    } else if (data.order !== undefined && data.order !== null && data.order !== '') {
        const raw = parseInt(data.order, 10);
        if (!isNaN(raw)) targetPos = raw;
    }

    if (existingIdx !== -1) {
        // 기존 모듈 업데이트
        const merged = { ...modules[existingIdx], ...modPayload };
        modules.splice(existingIdx, 1);

        if (targetPos && targetPos >= 1) {
            const insertIdx = Math.min(targetPos - 1, modules.length);
            modules.splice(insertIdx, 0, merged);
        } else {
            modules.splice(existingIdx, 0, merged);
        }
    } else {
        // 신규 모듈 등록
        if (targetPos && targetPos >= 1 && targetPos <= modules.length) {
            modules.splice(targetPos - 1, 0, modPayload);
        } else {
            modules.push(modPayload);
        }
    }

    // 전체 순서 10단위 정규화 (10, 20, 30, ...)
    modules.forEach((m, i) => {
        m.order = (i + 1) * 10;
    });

    saveModulesConfig(modules);
    return modules.find(m => m.id === cleanId) || modPayload;
}

/**
 * 모듈 순서 한 단계 위/아래 이동 (스왑 및 10단위 정규화)
 * @param {string} moduleId 
 * @param {'up'|'down'} direction 
 * @returns {Array} 업데이트된 모듈 목록
 */
function moveModuleOrder(moduleId, direction) {
    const modules = loadModulesConfig();
    const idx = modules.findIndex(m => m.id === moduleId);
    if (idx === -1) throw new Error('해당 모듈을 찾을 수 없습니다.');

    if (direction === 'up') {
        if (idx === 0) return modules;
        const temp = modules[idx];
        modules[idx] = modules[idx - 1];
        modules[idx - 1] = temp;
    } else if (direction === 'down') {
        if (idx === modules.length - 1) return modules;
        const temp = modules[idx];
        modules[idx] = modules[idx + 1];
        modules[idx + 1] = temp;
    } else {
        throw new Error('유효하지 않은 이동 방향입니다. (up 또는 down만 가능)');
    }

    // 10단위 정규화
    modules.forEach((m, i) => {
        m.order = (i + 1) * 10;
    });

    saveModulesConfig(modules);
    return modules;
}

/**
 * 전체 모듈 순서 일괄 재배열 (ID 순서 기반 정규화)
 * @param {string[]} orderedIds 
 * @returns {Array}
 */
function reorderAllModules(orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        throw new Error('재배열할 모듈 ID 배열이 필요합니다.');
    }

    const modules = loadModulesConfig();
    const moduleMap = new Map(modules.map(m => [m.id, m]));
    const nextList = [];

    for (const id of orderedIds) {
        if (moduleMap.has(id)) {
            nextList.push(moduleMap.get(id));
            moduleMap.delete(id);
        }
    }

    for (const remaining of moduleMap.values()) {
        nextList.push(remaining);
    }

    nextList.forEach((m, i) => {
        m.order = (i + 1) * 10;
    });

    saveModulesConfig(nextList);
    return nextList;
}

/**
 * 모듈 삭제 (핵심 7대 코어 모듈은 삭제 차단)
 * @param {string} moduleId 
 */
function deleteModule(moduleId) {
    if (CORE_MODULE_IDS.has(moduleId)) {
        throw new Error('시스템 핵심 서비스는 삭제할 수 없습니다. (비활성화 스위치를 사용하세요)');
    }

    const modules = loadModulesConfig();
    const nextModules = modules.filter(m => m.id !== moduleId);
    if (nextModules.length === modules.length) {
        throw new Error('삭제할 모듈을 찾을 수 없습니다.');
    }

    // 삭제 후 순서 10단위 재정규화
    nextModules.forEach((m, i) => {
        m.order = (i + 1) * 10;
    });

    saveModulesConfig(nextModules);
    return true;
}

module.exports = {
    loadModulesConfig,
    getAllModules,
    getUserModules,
    getModuleById,
    isServiceAllowed,
    getNavModules,
    getQuickStripItems,
    saveModulesConfig,
    toggleModuleEnabled,
    createOrUpdateModule,
    moveModuleOrder,
    reorderAllModules,
    deleteModule,
    CORE_MODULE_IDS
};
