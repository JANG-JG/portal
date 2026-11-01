const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const { WORKSPACE_ROOT } = require('../config/constants');
const { getModuleById, getAllModules } = require('./moduleRegistry.service');

function resolveDbPath(p) {
    if (!p) return null;
    if (path.isAbsolute(p)) return p;
    const c1 = path.join(WORKSPACE_ROOT, p);
    if (fs.existsSync(c1)) return c1;
    const c2 = path.join(os.homedir(), 'workspace', p);
    if (fs.existsSync(c2)) return c2;
    return c1;
}

function getFileSizeStr(filePath) {
    try {
        const bytes = fs.statSync(filePath).size;
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    } catch (e) {
        return '-';
    }
}

/**
 * DB 파일 메타데이터 및 테이블/레코드 수 집계 (Promise)
 */
async function queryDbStats(fullDbPath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(fullDbPath)) {
            return resolve(null);
        }
        const tempDb = new sqlite3.Database(fullDbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return resolve(null);
        });

        tempDb.all("SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%'", [], async (err, tables) => {
            if (err || !tables) {
                try { tempDb.close(); } catch (e) {}
                return resolve(null);
            }

            const tableCount = tables.length;
            let totalRows = 0;

            for (const t of tables) {
                const count = await new Promise(r => {
                    tempDb.get(`SELECT COUNT(*) as cnt FROM "${t.name}"`, [], (cErr, row) => {
                        r(row ? (row.cnt || 0) : 0);
                    });
                });
                totalRows += count;
            }

            try { tempDb.close(); } catch (e) {}
            resolve({ tableCount, totalRows });
        });
    });
}

/**
 * 특정 모듈의 표준 KPI 메트릭 생성
 * @param {string} moduleId
 * @returns {Promise<object>}
 */
async function getModuleMetrics(moduleId) {
    const mod = getModuleById(moduleId);
    if (!mod) {
        throw new Error(`모듈을 찾을 수 없습니다: ${moduleId}`);
    }

    const cards = [];

    // 1. 서비스 기본 상태 카드
    cards.push({
        id: 'status',
        label: '서비스 운영 상태',
        value: mod.enabled !== false ? '정상 가동 중' : '일시 정지됨',
        icon: mod.enabled !== false ? '🟢' : '⚪',
        badge: mod.enabled !== false ? '정상' : '비활성',
        color: mod.enabled !== false ? 'success' : 'slate',
        subtext: `카테고리: ${mod.category || '라이프'} · 우선순위: ${mod.order || 50}`
    });

    // 2. 접근 권한 카드
    const permLabel = mod.adminOnly ? '관리자 전용' : (mod.defaultFamilyAllowed ? '가족 기본 허용' : '가족 선택 허용');
    const permIcon = mod.adminOnly ? '🔒' : (mod.defaultFamilyAllowed ? '👨‍👩‍👧' : '🔑');
    cards.push({
        id: 'permission',
        label: '접근 및 보안 권한',
        value: permLabel,
        icon: permIcon,
        color: mod.adminOnly ? 'danger' : 'primary',
        subtext: mod.baseUrl ? `SSO 베이스: ${mod.baseUrl}` : '포털 단독 실행 서비스'
    });

    // 3. DB 연동 메트릭 분석
    let dbStats = null;
    let resolvedDb = null;
    if (mod.dbPath) {
        resolvedDb = resolveDbPath(mod.dbPath);
        if (resolvedDb && fs.existsSync(resolvedDb)) {
            dbStats = await queryDbStats(resolvedDb);
        }
    }

    if (dbStats && resolvedDb) {
        const dbFileName = path.basename(resolvedDb);
        const dbSize = getFileSizeStr(resolvedDb);
        let mtimeStr = '-';
        try {
            const stat = fs.statSync(resolvedDb);
            const d = new Date(stat.mtime);
            mtimeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch (e) {}

        cards.push({
            id: 'db_records',
            label: '총 데이터 레코드',
            value: `${dbStats.totalRows.toLocaleString()}건`,
            icon: '📊',
            color: 'primary',
            subtext: `${dbStats.tableCount}개 테이블 실시간 집계`
        });

        cards.push({
            id: 'db_storage',
            label: '데이터베이스 용량',
            value: dbSize,
            icon: '🗄️',
            color: 'purple',
            subtext: `${dbFileName} (최근 갱신: ${mtimeStr})`
        });
    } else {
        cards.push({
            id: 'db_none',
            label: '데이터베이스 연동',
            value: mod.dbPath ? '파일 확인 대기' : '독립/무저장소',
            icon: '📁',
            color: 'slate',
            subtext: mod.dbPath ? `경로: ${mod.dbPath}` : '외부 API 또는 정적 서비스'
        });
    }

    // 4. 포털 인터페이스 노출 현황 카드
    const exposedList = [];
    if (mod.nav?.enabled) exposedList.push('상단 내비');
    if (Array.isArray(mod.quickStrip) && mod.quickStrip.length > 0) exposedList.push('원터치 퀵');
    if (mod.portalWidget?.enabled) exposedList.push('홈 대시보드');
    if (mod.admin?.enabled) exposedList.push('관리자 센터');

    cards.push({
        id: 'integration',
        label: '포털 노출 및 연동 채널',
        value: `${exposedList.length}개 채널`,
        icon: '🍱',
        color: 'warning',
        subtext: exposedList.length > 0 ? exposedList.join(' · ') : '외부 단독 노출'
    });

    return {
        success: true,
        moduleId: mod.id,
        moduleName: mod.name,
        icon: mod.icon || '📦',
        entryUrl: mod.entryUrl,
        dbPath: mod.dbPath || null,
        metrics: cards
    };
}

/**
 * 전체 모듈의 요약 통계 집계
 */
async function getAllModulesKpiSummary() {
    const modules = getAllModules(true);
    const total = modules.length;
    const active = modules.filter(m => m.enabled !== false).length;
    const withDb = modules.filter(m => !!m.dbPath).length;
    const adminOnly = modules.filter(m => m.adminOnly).length;

    return {
        success: true,
        total,
        active,
        withDb,
        adminOnly
    };
}

module.exports = {
    getModuleMetrics,
    getAllModulesKpiSummary,
    resolveDbPath
};
