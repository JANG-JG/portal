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
 * 전체 활성 모듈 목록 조회 (관리자용)
 * @returns {Array}
 */
function getAllModules() {
    const modules = loadModulesConfig();
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

module.exports = {
    loadModulesConfig,
    getAllModules,
    getUserModules,
    getModuleById,
    isServiceAllowed,
    getNavModules,
    getQuickStripItems
};
