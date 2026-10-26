/**
 * JG Portal 통합 관리자 센터 - SQLite DB SQL 쿼리 콘솔 & 스키마 뷰어 모듈
 * admin-db-sql.js
 */

(function() {
    'use strict';

    if (!window.DbManager) window.DbManager = {};

    // 3. 테이블 스키마 조회
    DbManager.loadTableSchema = async function() {
        if (!this.state.currentDb || !this.state.currentTable) return;
        try {
            const res = await fetch(`/api/admin/db/${this.state.currentDb}/table/${this.state.currentTable}/schema`);
            const data = await res.json();
            if (!data.success) return;

            const tbody = document.getElementById('dbSchemaTableBody');
            if (tbody) {
                tbody.innerHTML = (data.columns || []).map(c => `
                    <tr>
                        <td><strong>${c.cid}</strong></td>
                        <td><code>${escapeHtml(c.name)}</code></td>
                        <td><span class="badge-tag">${escapeHtml(c.type || 'TEXT')}</span></td>
                        <td>${c.notnull ? '❌ NOT NULL' : '⭕ NULL'}</td>
                        <td>${c.dflt_value !== null ? escapeHtml(String(c.dflt_value)) : '-'}</td>
                        <td>${c.pk ? '🔑 PK' : '-'}</td>
                    </tr>
                `).join('');
            }

            const ddlEl = document.getElementById('dbSchemaDdl');
            if (ddlEl) ddlEl.textContent = data.ddl || 'DDL 정보 없음';
        } catch (err) {
            console.error(err);
        }
    };

    // 4. SQL 쿼리 콘솔 실행
    DbManager.runQuery = async function() {
        const editor = document.getElementById('dbSqlEditor');
        const forceCheck = document.getElementById('dbSqlForceCheck');
        const resultContainer = document.getElementById('dbQueryResultContainer');
        if (!editor || !resultContainer) return;

        const sql = editor.value.trim();
        if (!sql) {
            showToast('실행할 SQL 쿼리를 입력하세요.', true);
            return;
        }

        resultContainer.innerHTML = '<div style="color:#94a3b8; padding:1.5rem; text-align:center;">쿼리 실행 중...</div>';

        try {
            const res = await fetch(`/api/admin/db/${this.state.currentDb}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, force: forceCheck ? forceCheck.checked : false })
            });
            const data = await res.json();

            if (!res.ok) {
                if (data.dangerous) {
                    showToast('⚠️ 위험 쿼리 방어: 하단 안전 확인 체크 후 다시 시도하세요.', true);
                } else {
                    showToast('쿼리 오류: ' + data.message, true);
                }
                resultContainer.innerHTML = `<div class="db-sql-error">❌ ${escapeHtml(data.message)}</div>`;
                return;
            }

            if (data.is_select) {
                let html = `
                    <div style="font-size:0.85rem; color:#10b981; font-weight:600; margin-bottom:0.75rem;">
                        ✅ ${data.count.toLocaleString()}건 조회 완료 (${data.elapsed_ms}ms)
                    </div>
                    <div class="table-responsive">
                        <table class="admin-table db-data-table">
                            <thead>
                                <tr>${data.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>
                            </thead>
                            <tbody>
                                ${data.rows.map(r => `
                                    <tr>${data.columns.map(c => `<td>${escapeHtml(String(r[c] ?? 'NULL'))}</td>`).join('')}</tr>
                                `)}
                            </tbody>
                        </table>
                    </div>
                `;
                resultContainer.innerHTML = html;
            } else {
                resultContainer.innerHTML = `
                    <div class="db-sql-success">
                        ✅ ${escapeHtml(data.message)} (${data.elapsed_ms}ms)
                    </div>
                `;
                // 테이블 데이터 및 테이블 목록 자동 갱신
                this.loadTableData();
            }
        } catch (err) {
            resultContainer.innerHTML = `<div class="db-sql-error">❌ ${escapeHtml(err.message)}</div>`;
        }
    };

    DbManager.setQueryTemplate = function(type) {
        const editor = document.getElementById('dbSqlEditor');
        if (!editor) return;
        const tbl = this.state.currentTable || '테이블명';

        switch (type) {
            case 'select':
                editor.value = `SELECT * FROM "${tbl}" LIMIT 25;`;
                break;
            case 'count':
                editor.value = `SELECT COUNT(*) FROM "${tbl}";`;
                break;
            case 'pragma':
                editor.value = `PRAGMA table_info("${tbl}");`;
                break;
            case 'insert':
                const cols = this.state.columns.filter(c => c.name !== 'id').map(c => `"${c.name}"`).join(', ');
                const vals = this.state.columns.filter(c => c.name !== 'id').map(() => `''`).join(', ');
                editor.value = `INSERT INTO "${tbl}" (${cols})\nVALUES (${vals});`;
                break;
            case 'update':
                editor.value = `UPDATE "${tbl}"\nSET column_name = 'value'\nWHERE rowid = 1;`;
                break;
        }
        editor.focus();
    };
})();
