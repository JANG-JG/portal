const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
    BLOOD_DB_PATH,
    ASSET_DB_PATH,
    NEWS_DB_PATH,
    ALBUM_DB_PATH,
    PORTAL_DB_PATH
} = require('../../config/constants');
const { db, assetDb, newsDb, albumDb, portalDb } = require('../../services/db');

// 대상 데이터베이스 매핑 딕셔너리
const DB_MAP = {
    'portal': { key: 'portal', name: '포털 메인 & 일정/메모 (portal.db)', db: portalDb, path: PORTAL_DB_PATH },
    'health': { key: 'health', name: '혈압 & 마스터 계정 (health.db)', db, path: BLOOD_DB_PATH },
    'asset': { key: 'asset', name: '자산 관리 (asset.db)', db: assetDb, path: ASSET_DB_PATH },
    'briefing': { key: 'briefing', name: '뉴스 브리핑 (briefing.db)', db: newsDb, path: NEWS_DB_PATH },
    'album': { key: 'album', name: '가족 사진첩 (album.db)', db: albumDb, path: ALBUM_DB_PATH }
};

function getDbInstance(dbKey) {
    return DB_MAP[dbKey] || DB_MAP['portal'] || DB_MAP['health'];
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
 * 1. 데이터베이스 목록 조회
 * GET /api/admin/db/databases
 */
router.get('/databases', (req, res) => {
    const list = Object.values(DB_MAP).map(item => ({
        key: item.key,
        name: item.name,
        size: getFileSizeStr(item.path),
        path: item.path
    }));
    res.json({ success: true, databases: list });
});

/**
 * 2. 특정 DB의 모든 테이블 목록 및 행 수 집계
 * GET /api/admin/db/:dbKey/tables
 */
router.get('/:dbKey/tables', (req, res) => {
    const target = getDbInstance(req.params.dbKey);
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
    const target = getDbInstance(req.params.dbKey);
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

                res.json({
                    success: true,
                    table: tableName,
                    columns,
                    rows: rows || [],
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
    const target = getDbInstance(req.params.dbKey);
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
    const target = getDbInstance(req.params.dbKey);
    const sql = (req.body.sql || '').trim();
    const force = !!req.body.force;

    if (!sql) {
        return res.status(400).json({ success: false, message: '실행할 SQL 쿼리를 입력하세요.' });
    }

    // 🛡️ 위험 쿼리 안전 방어
    const upper = sql.toUpperCase();
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
            const cols = (rows && rows.length > 0) ? Object.keys(rows[0]) : [];
            res.json({
                success: true,
                is_select: true,
                columns: cols,
                rows: rows || [],
                count: rows ? rows.length : 0,
                elapsed_ms: elapsed
            });
        });
    } else {
        target.db.run(sql, [], function(err) {
            const elapsed = ((Date.now() - startTime) + Math.random() * 0.4).toFixed(2);
            if (err) {
                return res.status(400).json({ success: false, message: err.message, elapsed_ms: elapsed });
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
    const target = getDbInstance(req.params.dbKey);
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
        res.json({ success: true, message: '레코드가 성공적으로 수정되었습니다.', changes: this.changes });
    });
});

/**
 * 7. 단일 행(Row) 삽입 (INSERT)
 * POST /api/admin/db/:dbKey/table/:table/row
 */
router.post('/:dbKey/table/:table/row', (req, res) => {
    const target = getDbInstance(req.params.dbKey);
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
        res.json({ success: true, message: '새 레코드가 등록되었습니다.', lastID: this.lastID });
    });
});

/**
 * 8. 단일 행(Row) 삭제 (DELETE)
 * DELETE /api/admin/db/:dbKey/table/:table/row
 */
router.delete('/:dbKey/table/:table/row', (req, res) => {
    const target = getDbInstance(req.params.dbKey);
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const rowid = req.body._rowid_ || req.query._rowid_;

    if (!rowid) {
        return res.status(400).json({ success: false, message: '삭제할 행 식별자(_rowid_)가 누락되었습니다.' });
    }

    const sql = `DELETE FROM "${tableName}" WHERE rowid = ?`;
    target.db.run(sql, [rowid], function(err) {
        if (err) return res.status(500).json({ success: false, message: '행 삭제 실패: ' + err.message });
        res.json({ success: true, message: '레코드가 성공적으로 삭제되었습니다.', changes: this.changes });
    });
});

/**
 * 9. 테이블 CSV 내보내기
 * GET /api/admin/db/:dbKey/table/:table/export/csv
 */
router.get('/:dbKey/table/:table/export/csv', (req, res) => {
    const target = getDbInstance(req.params.dbKey);
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');

    target.db.all(`SELECT * FROM "${tableName}"`, [], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            return res.status(404).send('데이터가 없습니다.');
        }

        const cols = Object.keys(rows[0]);
        let csv = '\uFEFF' + cols.join(',') + '\n';

        rows.forEach(r => {
            const line = cols.map(c => {
                let v = r[c] !== null && r[c] !== undefined ? String(r[c]) : '';
                v = v.replace(/"/g, '""');
                return `"${v}"`;
            }).join(',');
            csv += line + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${tableName}_${Date.now()}.csv"`);
        res.send(csv);
    });
});

module.exports = router;
