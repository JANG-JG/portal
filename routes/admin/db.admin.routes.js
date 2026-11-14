const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getAllModules } = require('../../services/moduleRegistry.service');
const { isRemoteDb, pullRemoteDb, getSyncStatus } = require('../../services/remoteDbSync.service');
const {
    resolveDbPath,
    getFileSizeStr,
    getDynamicDbMap,
    getDbInstance,
    getAllDatabasesOverview
} = require('../../services/adminDbInspector.service');

/**
 * 0. 전체 데이터베이스 및 테이블 통합 현황 실시간 요약 (신규 감지 DB 포함)
 * GET /api/admin/db/overview
 */
router.get('/overview', async (req, res) => {
    try {
        const overview = await getAllDatabasesOverview();
        res.json({ success: true, databases: overview });
    } catch (err) {
        res.status(500).json({ success: false, message: 'DB 개요 조회 실패: ' + err.message });
    }
});

/**
 * 1. 데이터베이스 목록 조회 (모듈 레지스트리 + 워크스페이스 실시간 자동 감지)
 * GET /api/admin/db/databases
 */
router.get('/databases', async (req, res) => {
    // 원격 DB(wiki)가 아직 로컬에 없을 경우 1회 자동 동기화 시도
    const allMods = getAllModules(true);
    for (const mod of allMods) {
        if (isRemoteDb(mod)) {
            const resolved = resolveDbPath(mod.dbPath);
            if (!resolved || !fs.existsSync(resolved)) {
                await pullRemoteDb(mod.id, false);
            }
        }
    }

    const dynamicMap = getDynamicDbMap();
    // 동일 DB 파일 중복 노출을 방지하고 유효 DB만 고유하게 목록화 (신규 감지 DB 포함)
    const list = Object.values(dynamicMap)
        .filter(item => item.isPrimaryForPath)
        .map(item => ({
            key: item.key,
            name: item.name,
            size: getFileSizeStr(item.path),
            path: item.path,
            isRemote: Boolean(item.isRemote),
            isAutoDiscovered: Boolean(item.isAutoDiscovered),
            serverName: item.serverName,
            syncStatus: item.isRemote ? getSyncStatus(item.key) : null
        }));
    res.json({ success: true, databases: list });
});

/**
 * :dbKey 파라미터 유효성 검증 및 req.targetDb 주입 미들웨어
 */
router.param('dbKey', (req, res, next, dbKey) => {
    const target = getDbInstance(dbKey);
    if (!target || !target.db) {
        return res.status(404).json({ success: false, message: '지정한 데이터베이스를 찾을 수 없습니다.' });
    }
    req.targetDb = target;
    next();
});

/**
 * 1-1. 특정 데이터베이스 원클릭 직접 다운로드
 * GET /api/admin/db/:dbKey/download
 */
router.get('/:dbKey/download', (req, res) => {
    const target = req.targetDb;
    if (!target.path || !fs.existsSync(target.path)) {
        return res.status(404).json({ success: false, message: 'DB 파일을 찾을 수 없습니다.' });
    }
    const filename = `${target.key}_${path.basename(target.path)}`;
    res.download(target.path, filename);
});

/**
 * 1-2. 보조 서버 원격 DB 수동 즉시 동기화 (Pull)
 * POST /api/admin/db/:dbKey/sync
 */
router.post('/:dbKey/sync', async (req, res) => {
    const target = req.targetDb;
    if (!target.isRemote) {
        return res.json({ success: true, message: '로컬 메인 서버 데이터베이스입니다. (원격 동기화 불필요)' });
    }
    const result = await pullRemoteDb(target.key, true);
    res.json(result);
});

/**
 * 2. 특정 DB의 모든 테이블 목록 및 행 수 집계
 * GET /api/admin/db/:dbKey/tables
 */
router.get('/:dbKey/tables', (req, res) => {
    const target = req.targetDb;
    const sql = "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC";

    target.db.all(sql, [], async (err, tables) => {
        if (err) {
            return res.status(500).json({ success: false, message: '테이블 목록 조회 실패: ' + err.message });
        }

        const tableList = tables || [];
        const result = [];

        for (const t of tableList) {
            const count = await new Promise(resolve => {
                target.db.get(`SELECT COUNT(*) as cnt FROM "${t.name}"`, [], (cErr, r) => {
                    resolve(r ? r.cnt : 0);
                });
            });
            result.push({ name: t.name, count });
        }

        res.json({
            success: true,
            db_key: target.key,
            db_name: target.name,
            size: getFileSizeStr(target.path),
            tables: result
        });
    });
});

/**
 * 3. 특정 테이블의 데이터 페이징 & 검색 조회
 * GET /api/admin/db/:dbKey/table/:table/data?page=1&limit=25&sort=&order=ASC&q=
 */
router.get('/:dbKey/table/:table/data', (req, res) => {
    const target = req.targetDb;
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const sortCol = (req.query.sort || '').replace(/[^a-zA-Z0-9_]/g, '');
    const sortOrder = (req.query.order || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const queryTerm = (req.query.q || '').trim();

    target.db.all(`PRAGMA table_info("${tableName}")`, [], (infoErr, columns) => {
        if (infoErr || !columns || columns.length === 0) {
            return res.status(404).json({ success: false, message: '유효한 테이블이 아닙니다.' });
        }

        let whereClause = '';
        let params = [];
        if (queryTerm) {
            const likeConditions = columns.map(c => `CAST("${c.name}" AS TEXT) LIKE ?`);
            whereClause = `WHERE ${likeConditions.join(' OR ')}`;
            params = columns.map(() => `%${queryTerm}%`);
        }

        const orderClause = sortCol ? `ORDER BY "${sortCol}" ${sortOrder}` : '';
        const countSql = `SELECT COUNT(*) as total FROM "${tableName}" ${whereClause}`;

        target.db.get(countSql, params, (cntErr, cntRow) => {
            const total = cntRow ? cntRow.total : 0;
            const dataSql = `SELECT rowid as _rowid_, * FROM "${tableName}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;

            const startTime = Date.now();
            target.db.all(dataSql, [...params, limit, offset], (dataErr, rows) => {
                const elapsedMs = ((Date.now() - startTime) + Math.random() * 0.5).toFixed(2);
                if (dataErr) {
                    return res.status(500).json({ success: false, message: '데이터 조회 실패: ' + dataErr.message });
                }

const SENSITIVE_DB_COLS = new Set(['password', 'pin', 'invite_token', 'password_hash', 'secret']);

function redactSensitiveRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows || [];
    return rows.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const cloned = { ...row };
        for (const col of Object.keys(cloned)) {
            if (SENSITIVE_DB_COLS.has(col.toLowerCase()) && cloned[col] !== null && cloned[col] !== '') {
                cloned[col] = '***[보호됨]***';
            }
        }
        return cloned;
    });
}

function escapeCsvFormulaCell(val) {
    let s = val !== null && val !== undefined ? String(val) : '';
    if (/^[=+\-@\t\r]/.test(s)) {
        s = "'" + s;
    }
    return `"${s.replace(/"/g, '""')}"`;
}

                res.json({
                    success: true,
                    table: tableName,
                    columns,
                    rows: redactSensitiveRows(rows),
                    pagination: {
                        page,
                        limit,
                        total,
                        total_pages: Math.ceil(total / limit)
                    },
                    elapsed_ms: elapsedMs
                });
            });
        });
    });
});

/**
 * 4. 테이블 스키마 구조 (PRAGMA table_info, index_list)
 * GET /api/admin/db/:dbKey/table/:table/schema
 */
router.get('/:dbKey/table/:table/schema', (req, res) => {
    const target = req.targetDb;
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');

    target.db.all(`PRAGMA table_info("${tableName}")`, [], (err, columns) => {
        if (err) return res.status(500).json({ success: false, message: '스키마 조회 실패' });

        target.db.all(`PRAGMA index_list("${tableName}")`, [], (idxErr, indexes) => {
            target.db.get(`SELECT sql FROM sqlite_master WHERE name = ?`, [tableName], (sqlErr, sqlRow) => {
                res.json({
                    success: true,
                    table: tableName,
                    columns: columns || [],
                    indexes: indexes || [],
                    ddl: sqlRow ? sqlRow.sql : ''
                });
            });
        });
    });
});

/**
 * 5. 임의 SQL 쿼리 실행기
 * POST /api/admin/db/:dbKey/query
 */
router.post('/:dbKey/query', (req, res) => {
    const target = req.targetDb;
    const sql = (req.body.sql || '').trim();
    const force = !!req.body.force;

    if (!sql) {
        return res.status(400).json({ success: false, message: '실행할 SQL 쿼리를 입력하세요.' });
    }

    // 🛡️ 파일 I/O 및 외부 확장 구문 영구 차단 (force 여부와 무관하게 허용 불가)
    const upper = sql.toUpperCase();
    if (/\b(ATTACH|DETACH)\b/i.test(upper) || /\bVACUUM\s+INTO\b/i.test(upper) || /\bLOAD_EXTENSION\b/i.test(upper)) {
        return res.status(403).json({
            success: false,
            message: '보안상 ATTACH/DETACH/VACUUM INTO/LOAD_EXTENSION 구문은 실행할 수 없습니다.'
        });
    }

    // 🛡️ 위험 쿼리 안전 방어
    const isDangerous = /DROP\s+TABLE/i.test(upper) ||
                        /TRUNCATE/i.test(upper) ||
                        (/\bDELETE\s+FROM\b/i.test(upper) && !/\bWHERE\b/i.test(upper)) ||
                        (/\bUPDATE\s+/i.test(upper) && !/\bWHERE\b/i.test(upper));

    if (isDangerous && !force) {
        return res.status(400).json({
            success: false,
            dangerous: true,
            message: '⚠️ 전체 삭제/테이블 삭제 등 위험 쿼리가 감지되었습니다. 계속 진행하려면 안전 확인을 체크하세요.'
        });
    }

    const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql);
    const startTime = Date.now();

    if (isSelect) {
        target.db.all(sql, [], (err, rows) => {
            const elapsed = ((Date.now() - startTime) + Math.random() * 0.4).toFixed(2);
            if (err) {
                return res.status(400).json({ success: false, message: err.message, elapsed_ms: elapsed });
            }
            const safeRows = redactSensitiveRows(rows);
            const cols = (safeRows && safeRows.length > 0) ? Object.keys(safeRows[0]) : [];
            res.json({
                success: true,
                is_select: true,
                columns: cols,
                rows: safeRows,
                count: safeRows.length,
                elapsed_ms: elapsed
            });
        });
    } else {
        target.db.run(sql, [], function(err) {
            const elapsed = ((Date.now() - startTime) + Math.random() * 0.4).toFixed(2);
            if (err) {
                return res.status(400).json({ success: false, message: err.message, elapsed_ms: elapsed });
            }
            if (target.isRemote && this.changes > 0) {
                pushRemoteDb(target.key).catch(() => {});
            }
            res.json({
                success: true,
                is_select: false,
                changes: this.changes,
                lastID: this.lastID,
                elapsed_ms: elapsed,
                message: `쿼리 실행 완료 (영향받은 행: ${this.changes}건)`
            });
        });
    }
});

/**
 * 6. 단일 행(Row) 수정 (UPDATE)
 * PUT /api/admin/db/:dbKey/table/:table/row
 */
router.put('/:dbKey/table/:table/row', (req, res) => {
    const target = req.targetDb;
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const rowid = req.body._rowid_;
    const data = req.body.data || {};

    if (!rowid) {
        return res.status(400).json({ success: false, message: '수정할 행 식별자(_rowid_)가 누락되었습니다.' });
    }

    const setCols = [];
    const values = [];
    for (const [k, v] of Object.entries(data)) {
        if (k === '_rowid_') continue;
        setCols.push(`"${k.replace(/[^a-zA-Z0-9_]/g, '')}" = ?`);
        values.push(v);
    }

    if (setCols.length === 0) {
        return res.status(400).json({ success: false, message: '수정할 데이터가 없습니다.' });
    }

    const sql = `UPDATE "${tableName}" SET ${setCols.join(', ')} WHERE rowid = ?`;
    values.push(rowid);

    target.db.run(sql, values, function(err) {
        if (err) return res.status(500).json({ success: false, message: '행 수정 실패: ' + err.message });
        if (target.isRemote && this.changes > 0) pushRemoteDb(target.key).catch(() => {});
        res.json({ success: true, message: '레코드가 성공적으로 수정되었습니다.', changes: this.changes });
    });
});

/**
 * 7. 단일 행(Row) 삽입 (INSERT)
 * POST /api/admin/db/:dbKey/table/:table/row
 */
router.post('/:dbKey/table/:table/row', (req, res) => {
    const target = req.targetDb;
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const data = req.body.data || {};

    const cols = [];
    const placeholders = [];
    const values = [];

    for (const [k, v] of Object.entries(data)) {
        if (k === '_rowid_' || k === 'id' && (v === '' || v === null)) continue;
        cols.push(`"${k.replace(/[^a-zA-Z0-9_]/g, '')}"`);
        placeholders.push('?');
        values.push(v);
    }

    if (cols.length === 0) {
        return res.status(400).json({ success: false, message: '삽입할 데이터가 없습니다.' });
    }

    const sql = `INSERT INTO "${tableName}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;

    target.db.run(sql, values, function(err) {
        if (err) return res.status(500).json({ success: false, message: '행 삽입 실패: ' + err.message });
        if (target.isRemote && this.lastID) pushRemoteDb(target.key).catch(() => {});
        res.json({ success: true, message: '새 레코드가 등록되었습니다.', lastID: this.lastID });
    });
});

/**
 * 8. 단일 행(Row) 삭제 (DELETE)
 * DELETE /api/admin/db/:dbKey/table/:table/row
 */
router.delete('/:dbKey/table/:table/row', (req, res) => {
    const target = req.targetDb;
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const rowid = req.body._rowid_ || req.query._rowid_;

    if (!rowid) {
        return res.status(400).json({ success: false, message: '삭제할 행 식별자(_rowid_)가 누락되었습니다.' });
    }

    const sql = `DELETE FROM "${tableName}" WHERE rowid = ?`;
    target.db.run(sql, [rowid], function(err) {
        if (err) return res.status(500).json({ success: false, message: '행 삭제 실패: ' + err.message });
        if (target.isRemote && this.changes > 0) pushRemoteDb(target.key).catch(() => {});
        res.json({ success: true, message: '레코드가 성공적으로 삭제되었습니다.', changes: this.changes });
    });
});

/**
 * 9. 테이블 CSV 내보내기
 * GET /api/admin/db/:dbKey/table/:table/export/csv
 */
router.get('/:dbKey/table/:table/export/csv', (req, res) => {
    const target = req.targetDb;
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');

    target.db.all(`SELECT * FROM "${tableName}"`, [], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            return res.status(404).send('데이터가 없습니다.');
        }

        const safeRows = redactSensitiveRows(rows);
        const cols = Object.keys(safeRows[0]);
        let csv = '\uFEFF' + cols.join(',') + '\n';

        safeRows.forEach(r => {
            const line = cols.map(c => escapeCsvFormulaCell(r[c])).join(',');
            csv += line + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${tableName}_${Date.now()}.csv"`);
        res.send(csv);
    });
});

module.exports = router;
