/**
 * JG Portal 통합 관리자 센터 - 경량 SQLite DB 매니저 모듈
 * admin-db-manager.js
 */

const DbManager = {
    state: {
        currentDb: 'portal',
        currentTable: '',
        viewMode: window.innerWidth < 768 ? 'card' : 'table', // 모바일 카드 뷰 기본
        page: 1,
        limit: 25,
        sort: '',
        order: 'ASC',
        searchQuery: '',
        databases: [],
        tables: [],
        columns: [],
        rows: [],
        pagination: { total: 0, total_pages: 1 }
    },

    // 초기화
    async init() {
        const savedMode = localStorage.getItem('jg_db_view_mode');
        if (savedMode) this.state.viewMode = savedMode;
        this.updateViewModeButtons();
        await this.loadDatabases();
    },

    // 1. 데이터베이스 목록 조회
    async loadDatabases() {
        try {
            const res = await fetch('/api/admin/db/databases');
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            this.state.databases = data.databases || [];
            this.renderDbSelector();
            if (this.state.databases.length > 0) {
                await this.switchDb(this.state.currentDb || this.state.databases[0].key);
            }
        } catch (err) {
            showToast('DB 목록 조회 실패: ' + err.message, true);
        }
    },

    // DB 선택 드롭다운 렌더링
    renderDbSelector() {
        const select = document.getElementById('dbSelect');
        if (!select) return;
        select.innerHTML = this.state.databases.map(db => `
            <option value="${db.key}" ${db.key === this.state.currentDb ? 'selected' : ''}>
                ${escapeHtml(db.name)} (${db.size})
            </option>
        `).join('');
    },

    // DB 전환
    async switchDb(dbKey) {
        this.state.currentDb = dbKey;
        this.state.page = 1;
        this.state.searchQuery = '';
        this.state.sort = '';
        const searchInput = document.getElementById('dbSearchInput');
        if (searchInput) searchInput.value = '';

        try {
            const res = await fetch(`/api/admin/db/${dbKey}/tables`);
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            this.state.tables = data.tables || [];
            this.renderTableSelector();

            if (this.state.tables.length > 0) {
                await this.switchTable(this.state.tables[0].name);
            } else {
                this.state.currentTable = '';
                this.clearViews();
            }
        } catch (err) {
            showToast('테이블 목록 조회 실패: ' + err.message, true);
        }
    },

    // 테이블 드롭다운 렌더링
    renderTableSelector() {
        const select = document.getElementById('tableSelect');
        if (!select) return;
        select.innerHTML = this.state.tables.map(t => `
            <option value="${t.name}" ${t.name === this.state.currentTable ? 'selected' : ''}>
                📋 ${escapeHtml(t.name)} (${t.count.toLocaleString()}행)
            </option>
        `).join('');
    },

    // 테이블 전환
    async switchTable(tableName) {
        this.state.currentTable = tableName;
        this.state.page = 1;
        this.state.searchQuery = '';
        this.state.sort = '';
        const searchInput = document.getElementById('dbSearchInput');
        if (searchInput) searchInput.value = '';
        const select = document.getElementById('tableSelect');
        if (select) select.value = tableName;

        await Promise.all([
            this.loadTableData(),
            this.loadTableSchema()
        ]);
    },

    // 2. 테이블 데이터 페이징 조회
    async loadTableData() {
        if (!this.state.currentDb || !this.state.currentTable) return;
        const container = document.getElementById('dbDataContainer');
        if (container) {
            container.innerHTML = '<div style="text-align:center; padding:3rem; color:#94a3b8;">데이터를 불러오는 중...</div>';
        }

        try {
            const q = encodeURIComponent(this.state.searchQuery);
            const url = `/api/admin/db/${this.state.currentDb}/table/${this.state.currentTable}/data?page=${this.state.page}&limit=${this.state.limit}&sort=${this.state.sort}&order=${this.state.order}&q=${q}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            this.state.columns = data.columns || [];
            this.state.rows = data.rows || [];
            this.state.pagination = data.pagination || { total: 0, total_pages: 1 };

            // 소요시간 뱃지 갱신
            const statusEl = document.getElementById('dbExecutionStatus');
            if (statusEl) {
                statusEl.textContent = `⚡ ${data.pagination.total.toLocaleString()}개 중 ${this.state.rows.length}개 조회 완료 (${data.elapsed_ms}ms)`;
            }

            this.renderDataView();
            this.renderPagination();
        } catch (err) {
            showToast('데이터 조회 실패: ' + err.message, true);
        }
    },

    // 뷰 모드 전환 (표 보기 vs 카드 보기)
    setViewMode(mode) {
        this.state.viewMode = mode;
        try { localStorage.setItem('jg_db_view_mode', mode); } catch (e) {}
        this.updateViewModeButtons();
        this.renderDataView();
    },

    updateViewModeButtons() {
        const btnTable = document.getElementById('btnViewModeTable');
        const btnCard = document.getElementById('btnViewModeCard');
        if (btnTable && btnCard) {
            btnTable.classList.toggle('active', this.state.viewMode === 'table');
            btnCard.classList.toggle('active', this.state.viewMode === 'card');
        }
    },

    // 데이터 뷰 렌더링 분기
    renderDataView() {
        const container = document.getElementById('dbDataContainer');
        if (!container) return;

        if (this.state.rows.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:3.5rem 1rem; color:#94a3b8;">
                    <div style="font-size:2.5rem; margin-bottom:0.5rem;">📭</div>
                    <div style="font-weight:600; color:#64748b;">조건에 일치하는 데이터가 없습니다.</div>
                </div>`;
            return;
        }

        if (this.state.viewMode === 'card') {
            this.renderCardsView(container);
        } else {
            this.renderTableView(container);
        }
    },

    // 카드 뷰 렌더링 (모바일 360px 최적화)
    renderCardsView(container) {
        const cols = this.state.columns;
        const html = `
            <div class="db-cards-grid">
                ${this.state.rows.map(row => {
                    const rowid = row._rowid_;
                    const primaryField = cols[0] ? cols[0].name : 'id';
                    return `
                        <div class="db-record-card">
                            <div class="db-record-card-header">
                                <div class="db-record-card-id">
                                    <span class="db-rowid-badge">#${rowid}</span>
                                    <strong>${escapeHtml(String(row[primaryField] ?? ''))}</strong>
                                </div>
                                <div class="db-record-actions">
                                    <button class="btn-admin-icon" onclick="DbManager.openEditModal(${rowid})" title="수정">✏️</button>
                                    <button class="btn-admin-icon btn-danger-icon" onclick="DbManager.deleteRow(${rowid})" title="삭제">🗑️</button>
                                </div>
                            </div>
                            <div class="db-record-fields">
                                ${cols.filter(c => c.name !== primaryField).map(c => `
                                    <div class="db-record-field-row">
                                        <span class="db-field-key">${escapeHtml(c.name)}</span>
                                        <span class="db-field-val" title="${escapeHtml(String(row[c.name] ?? ''))}">
                                            ${row[c.name] === null ? '<em style="color:#94a3b8;">NULL</em>' : escapeHtml(String(row[c.name]))}
                                        </span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        container.innerHTML = html;
    },

    // 표 뷰 렌더링 (데스크톱 최적화 + 고정 액션 열)
    renderTableView(container) {
        const cols = this.state.columns;
        const html = `
            <div class="table-responsive db-table-wrapper">
                <table class="admin-table db-data-table">
                    <thead>
                        <tr>
                            <th class="sticky-action-col">관리</th>
                            <th class="db-sortable" onclick="DbManager.sortBy('_rowid_')">
                                # ${this.getSortIcon('_rowid_')}
                            </th>
                            ${cols.map(c => `
                                <th class="db-sortable" onclick="DbManager.sortBy('${c.name}')">
                                    ${escapeHtml(c.name)}
                                    <span class="db-col-type">${c.type}</span>
                                    ${this.getSortIcon(c.name)}
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${this.state.rows.map(row => `
                            <tr>
                                <td class="sticky-action-col">
                                    <div style="display:flex; gap:0.25rem;">
                                        <button class="btn-admin-icon" onclick="DbManager.openEditModal(${row._rowid_})" title="수정">✏️</button>
                                        <button class="btn-admin-icon btn-danger-icon" onclick="DbManager.deleteRow(${row._rowid_})" title="삭제">🗑️</button>
                                    </div>
                                </td>
                                <td><span class="db-rowid-badge">#${row._rowid_}</span></td>
                                ${cols.map(c => `
                                    <td class="db-cell-val" title="${escapeHtml(String(row[c.name] ?? ''))}">
                                        ${row[c.name] === null ? '<em style="color:#94a3b8;">NULL</em>' : escapeHtml(String(row[c.name]))}
                                    </td>
                                `).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
    },

    getSortIcon(col) {
        if (this.state.sort !== col) return '<span style="color:#cbd5e1; font-size:0.75rem;">↕</span>';
        return this.state.order === 'ASC' ? '▲' : '▼';
    },

    sortBy(col) {
        if (this.state.sort === col) {
            this.state.order = this.state.order === 'ASC' ? 'DESC' : 'ASC';
        } else {
            this.state.sort = col;
            this.state.order = 'ASC';
        }
        this.loadTableData();
    },

    // 페이지네이션 렌더링
    renderPagination() {
        const p = this.state.pagination;
        const nav = document.getElementById('dbPagination');
        if (!nav) return;

        nav.innerHTML = `
            <div style="font-size:0.85rem; color:#64748b;">
                전체 <strong>${p.total.toLocaleString()}</strong>건 (페이지 ${p.page} / ${p.total_pages || 1})
            </div>
            <div class="db-pagination-controls">
                <button class="btn-admin btn-admin-outline btn-admin-sm" ${p.page <= 1 ? 'disabled' : ''} onclick="DbManager.goPage(${p.page - 1})">◀ 이전</button>
                <span class="db-page-num">${p.page}</span>
                <button class="btn-admin btn-admin-outline btn-admin-sm" ${p.page >= p.total_pages ? 'disabled' : ''} onclick="DbManager.goPage(${p.page + 1})">다음 ▶</button>
            </div>
        `;
    },

    goPage(page) {
        this.state.page = page;
        this.loadTableData();
    },

    setLimit(limit) {
        this.state.limit = parseInt(limit);
        this.state.page = 1;
        this.loadTableData();
    },

    handleSearch(val) {
        this.state.searchQuery = val.trim();
        this.state.page = 1;
        this.loadTableData();
    },


    // 5. 단일 행 모달 (추가 / 수정)
    openInsertModal() {
        this.openRowModal(true, null);
    },

    openEditModal(rowid) {
        const row = this.state.rows.find(r => r._rowid_ === rowid);
        if (!row) return;
        this.openRowModal(false, row);
    },

    openRowModal(isNew, rowData) {
        const modal = document.getElementById('dbRowModal');
        const form = document.getElementById('dbRowForm');
        const title = document.getElementById('dbRowModalTitle');
        if (!modal || !form) return;

        title.textContent = isNew ? `➕ 새 레코드 추가 (${this.state.currentTable})` : `✏️ 레코드 수정 (Row #${rowData._rowid_})`;
        
        form.innerHTML = `
            <input type="hidden" name="_is_new_" value="${isNew ? '1' : '0'}">
            <input type="hidden" name="_rowid_" value="${rowData ? rowData._rowid_ : ''}">
            <div class="db-modal-fields-grid">
                ${this.state.columns.map(c => {
                    const val = rowData ? (rowData[c.name] ?? '') : '';
                    const isPk = c.pk && !isNew;
                    return `
                        <div class="db-modal-field">
                            <label>
                                <span>${escapeHtml(c.name)}</span>
                                <span class="badge-tag">${c.type}</span>
                                ${c.pk ? '<span style="color:#ef4444; font-size:0.75rem;">(PK)</span>' : ''}
                            </label>
                            <input type="text" name="${escapeHtml(c.name)}" value="${escapeHtml(String(val))}" 
                                   ${isPk ? 'readonly style="background:#f1f5f9; cursor:not-allowed;"' : ''} 
                                   placeholder="${c.notnull ? '필수 입력' : 'NULL 허용'}">
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        modal.style.display = 'flex';
    },

    closeRowModal() {
        const modal = document.getElementById('dbRowModal');
        if (modal) modal.style.display = 'none';
    },

    async submitRowForm(e) {
        e.preventDefault();
        const form = document.getElementById('dbRowForm');
        if (!form) return;

        const formData = new FormData(form);
        const isNew = formData.get('_is_new_') === '1';
        const rowid = formData.get('_rowid_');
        const data = {};

        for (const [key, val] of formData.entries()) {
            if (key === '_is_new_' || key === '_rowid_') continue;
            data[key] = val === '' ? null : val;
        }

        try {
            const url = `/api/admin/db/${this.state.currentDb}/table/${this.state.currentTable}/row`;
            const method = isNew ? 'POST' : 'PUT';
            const body = isNew ? { data } : { _rowid_: rowid, data };

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (!result.success) throw new Error(result.message);

            showToast(result.message || '저장되었습니다.');
            this.closeRowModal();
            this.loadTableData();
        } catch (err) {
            showToast('저장 실패: ' + err.message, true);
        }
    },

    // 단일 행 삭제
    async deleteRow(rowid) {
        if (!confirm(`정말로 Row #${rowid} 레코드를 삭제하시겠습니까?\n이 작업은 즉시 데이터베이스에 반영됩니다.`)) return;

        try {
            const res = await fetch(`/api/admin/db/${this.state.currentDb}/table/${this.state.currentTable}/row`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ _rowid_: rowid })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            showToast('레코드가 삭제되었습니다.');
            this.loadTableData();
        } catch (err) {
            showToast('삭제 실패: ' + err.message, true);
        }
    },

    // CSV 내보내기
    exportCsv() {
        if (!this.state.currentDb || !this.state.currentTable) return;
        window.location.href = `/api/admin/db/${this.state.currentDb}/table/${this.state.currentTable}/export/csv`;
    },

    clearViews() {
        const container = document.getElementById('dbDataContainer');
        if (container) container.innerHTML = '<div style="text-align:center; padding:3rem; color:#94a3b8;">테이블이 없습니다.</div>';
    }
};

window.DbManager = DbManager;
window.initDbManager = () => DbManager.init();
