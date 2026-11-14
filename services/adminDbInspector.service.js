/**
 * ==============================================================================
 * 관리자 센터 SQLite 데이터베이스 동적 인트로스펙션 및 자동 감지 서비스
 * portal/services/adminDbInspector.service.js
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적인 한국어 인터페이스 준수
 * [규칙 3] 파일당 500줄 이하 모듈화 준수 (약 200줄)
 * [규칙 5] 외과수술적 코드 수정 절차 준수
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const { WORKSPACE_ROOT } = require('../config/constants');
const { getAllModules } = require('./moduleRegistry.service');
const { isRemoteDb, getSyncStatus } = require('./remoteDbSync.service');

// 동적 등록된 서비스 모듈 DB 인스턴스 캐시 풀 (절대 경로별 인스턴스 싱글톤 관리)
const DYNAMIC_DB_POOL = new Map();

// 자동 스캔 제외 디렉토리 목록 (개발 PC 및 임시/캐시 폴더)
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.gemini', '.aider', 'backups', 'backup',
    'tmp', 'temp', 'scratch', 'dist', 'build', '.cache', 'logs',
    'portal-dev', 'dev', 'development', 'staging', 'test', 'tests', 'fixtures',
    'hp17', 'hp-17', 'hp_17'
]);

/**
 * 스캔 제외 대상 디렉토리 판별 (개발 PC HP 17 및 임시 폴더 차단)
 */
function isIgnoredDir(dirName) {
    if (!dirName) return true;
    if (dirName.startsWith('.')) return true;
    const lower = dirName.toLowerCase();
    if (IGNORE_DIRS.has(lower)) return true;
    if (/(-dev$|^dev-|_dev$|hp17|hp-17)/i.test(lower)) return true;
    return false;
}

/**
 * DB 파일 상대/절대 경로 해결
 */
function resolveDbPath(p) {
    if (!p) return null;
    if (path.isAbsolute(p)) return p;
    const c1 = path.join(WORKSPACE_ROOT, p);
    if (fs.existsSync(c1)) return c1;
    const c2 = path.join(os.homedir(), 'workspace', p);
    if (fs.existsSync(c2)) return c2;
    return c1;
}

/**
 * 워크스페이스 내 모든 SQLite DB 파일 자동 감지 (Auto-Discovery)
 * - 개발 PC(HP 17) 동기화 폴더 및 임시 중복 DB 파일 원천 배제
 */
function findWorkspaceDbs(dir = WORKSPACE_ROOT, depth = 0) {
    if (depth > 3) return [];
    let results = [];
    try {
        if (!fs.existsSync(dir)) return results;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!isIgnoredDir(entry.name)) {
                    results = results.concat(findWorkspaceDbs(path.join(dir, entry.name), depth + 1));
                }
            } else if (entry.isFile()) {
                if (/\.(db|sqlite|sqlite3)$/i.test(entry.name) && !/-(wal|shm|journal)$/i.test(entry.name)) {
                    const fullPath = path.join(dir, entry.name);
                    // 개발 PC(HP 17) 폴더, 임시 복사본(/portal/health.db), 테스트용 임시 파일 필터링
                    if (/hp17|hp-17|portal-dev|\/portal\/health\.db/i.test(fullPath)) continue;
                    if (/^(test|temp|backup|sample)|_(test|temp|bak)\./i.test(entry.name)) continue;
                    results.push(fullPath);
                }
            }
        }
    } catch (e) {
        console.warn('[DB Inspector] 파일 자동 탐색 중 오류 무시:', e.message);
    }
    return results;
}

/**
 * DB 커넥션 풀링 싱글톤 획득
 */
function getDbConnection(resolvedPath) {
    if (!DYNAMIC_DB_POOL.has(resolvedPath)) {
        const dynDb = new sqlite3.Database(resolvedPath, (err) => {
            if (!err) {
                dynDb.run('PRAGMA journal_mode = WAL;');
                dynDb.run('PRAGMA synchronous = NORMAL;');
                dynDb.run('PRAGMA busy_timeout = 5000;');
            }
        });
        DYNAMIC_DB_POOL.set(resolvedPath, dynDb);
    }
    return DYNAMIC_DB_POOL.get(resolvedPath);
}

/**
 * 파일 크기 포맷 문자열
 */
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
 * 모듈 레지스트리 + 워크스페이스 자동 스캔 기반의 전체 동적 DB 맵 수집
 */
function getDynamicDbMap() {
    const map = {};
    const seenPaths = new Set();

    // 1단계: 모듈 레지스트리에 등록된 DB 수집
    try {
        const allMods = getAllModules(true);
        allMods.forEach(mod => {
            if (!mod.dbPath) return;
            const resolved = resolveDbPath(mod.dbPath);
            const isRemote = isRemoteDb(mod);

            if (resolved && fs.existsSync(resolved)) {
                const dbConn = getDbConnection(resolved);
                const isFirst = !seenPaths.has(resolved);
                seenPaths.add(resolved);

                map[mod.id] = {
                    key: mod.id,
                    name: `${mod.icon || '📦'} ${mod.name} (${path.basename(resolved)})`,
                    db: dbConn,
                    path: resolved,
                    isPrimaryForPath: isFirst,
                    isRemote,
                    serverName: isRemote ? '💻 HP 보조 서버 (192.168.50.75)' : (mod.serverName || '📱 메인 서버 (로컬)'),
                    remoteHost: mod.remoteHost || null,
                    isAutoDiscovered: false
                };
            }
        });
    } catch (e) {
        console.error('[DB Inspector] 등록 모듈 DB 매핑 실패:', e.message);
    }

    // 2단계: 워크스페이스 내에 존재하지만 모듈에 등록되지 않은 신규 DB 파일 자동 감지 (Auto-Discovery)
    try {
        const discoveredFiles = findWorkspaceDbs();
        discoveredFiles.forEach(filePath => {
            if (!seenPaths.has(filePath)) {
                seenPaths.add(filePath);
                const baseName = path.basename(filePath, path.extname(filePath));
                const key = `auto_${baseName}`.replace(/[^a-zA-Z0-9_]/g, '_');
                const dbConn = getDbConnection(filePath);
                const isSecondaryFile = /wiki|secondary/i.test(filePath);

                map[key] = {
                    key: key,
                    name: `📦 자동 감지 DB (${path.basename(filePath)})`,
                    db: dbConn,
                    path: filePath,
                    isPrimaryForPath: true,
                    isRemote: isSecondaryFile,
                    serverName: isSecondaryFile ? '💻 HP 보조 서버 (192.168.50.75)' : '📱 메인 서버 (로컬 자동 감지)',
                    remoteHost: isSecondaryFile ? (process.env.SECONDARY_HOST || '192.168.50.75') : null,
                    isAutoDiscovered: true
                };
            }
        });
    } catch (e) {
        console.error('[DB Inspector] 미등록 DB 자동 감지 실패:', e.message);
    }

    return map;
}

/**
 * DB 키로 인스턴스 검색 (하위 호환 별칭 매핑 포함)
 */
function getDbInstance(dbKey) {
    const dynamicMap = getDynamicDbMap();
    if (dynamicMap[dbKey]) return dynamicMap[dbKey];

    // 하위 호환 별칭 매핑 (구 URL / 캐시 호환)
    if (dbKey === 'health' && dynamicMap['blood']) return dynamicMap['blood'];
    if (dbKey === 'briefing' && dynamicMap['news']) return dynamicMap['news'];
    if (dbKey === 'portal' && (dynamicMap['portal'] || dynamicMap['calendar'] || dynamicMap['memo'])) {
        return dynamicMap['portal'] || dynamicMap['calendar'] || dynamicMap['memo'];
    }

    return null;
}

/**
 * 모든 활성 데이터베이스의 테이블 목록 및 레코드 수 실시간 통합 요약
 */
async function getAllDatabasesOverview() {
    const dynamicMap = getDynamicDbMap();
    const primaryDbs = Object.values(dynamicMap).filter(item => item.isPrimaryForPath);
    const overviewList = [];

    for (const item of primaryDbs) {
        try {
            const tables = await new Promise((resolve) => {
                const sql = "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC";
                item.db.all(sql, [], async (err, rows) => {
                    if (err || !rows) return resolve([]);
                    const tList = [];
                    for (const row of rows) {
                        const cnt = await new Promise(rCnt => {
                            item.db.get(`SELECT COUNT(*) as cnt FROM "${row.name}"`, [], (cErr, cRow) => {
                                rCnt(cRow ? cRow.cnt : 0);
                            });
                        });
                        tList.push({ name: row.name, count: cnt });
                    }
                    resolve(tList);
                });
            });

            const totalRows = tables.reduce((acc, cur) => acc + (cur.count || 0), 0);
            let mtime = null;
            try {
                mtime = fs.statSync(item.path).mtime;
            } catch (e) {}

            overviewList.push({
                key: item.key,
                name: item.name,
                path: item.path,
                size: getFileSizeStr(item.path),
                isRemote: Boolean(item.isRemote),
                serverName: item.serverName,
                syncStatus: item.isRemote ? getSyncStatus(item.key) : null,
                isAutoDiscovered: Boolean(item.isAutoDiscovered),
                tableCount: tables.length,
                totalRows: totalRows,
                updatedAt: mtime,
                tables: tables
            });
        } catch (e) {
            console.error(`[DB Inspector] ${item.name} 개요 수집 실패:`, e.message);
        }
    }

    return overviewList;
}

module.exports = {
    resolveDbPath,
    findWorkspaceDbs,
    getDbConnection,
    getFileSizeStr,
    getDynamicDbMap,
    getDbInstance,
    getAllDatabasesOverview
};
