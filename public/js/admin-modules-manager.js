/**
 * 🧩 JG 관리자 센터 서비스 모듈 통합 관리 스크립트 (admin-modules-manager.js)
 * - /api/modules/admin/* REST API와 연동하여 웹 GUI에서 모듈 On/Off, 등록, 수정, 삭제 제어
 * - [규칙 2] 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    let cachedModulesData = [];
    let coreModuleSet = new Set();

    document.addEventListener('DOMContentLoaded', () => {
        loadAdminModulesList();
    });

    window.loadAdminModulesList = async function() {
        const tbody = document.getElementById('adminModulesTableBody');
        if (!tbody) return;

        try {
            const res = await fetch('/api/modules/admin/all');
            const data = await res.json();

            if (!data.success || !Array.isArray(data.modules)) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:#ef4444;">${data.message || '모듈 목록 조회 실패'}</td></tr>`;
                return;
            }

            cachedModulesData = data.modules;
            coreModuleSet = new Set(data.coreModuleIds || []);

            // 요약 카운트 갱신
            const total = data.modules.length;
            const active = data.modules.filter(m => m.enabled !== false).length;
            const inactive = total - active;

            const elTotal = document.getElementById('moduleTotalCount');
            const elActive = document.getElementById('moduleActiveCount');
            const elInactive = document.getElementById('moduleInactiveCount');
            if (elTotal) elTotal.textContent = total;
            if (elActive) elActive.textContent = active;
            if (elInactive) elInactive.textContent = inactive;

            renderModulesTable(data.modules);
        } catch (err) {
            console.error('모듈 목록 로드 실패:', err);
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:#ef4444;">서버와 통신할 수 없습니다.</td></tr>`;
        }
    };

    function renderModulesTable(modules) {
        const tbody = document.getElementById('adminModulesTableBody');
        if (!tbody) return;

        if (modules.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:#64748b;">등록된 서비스 모듈이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = modules.map(m => {
            const isCore = coreModuleSet.has(m.id);
            const isEnabled = m.enabled !== false;

            // 권한 뱃지
            let permBadge = '';
            if (m.adminOnly) {
                permBadge = '<span class="badge" style="background:#fee2e2; color:#b91c1c; font-size:0.75rem;">🔒 관리자 전용</span>';
            } else if (m.defaultFamilyAllowed) {
                permBadge = '<span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.75rem;">👨‍👩‍👧 가족 기본</span>';
            } else {
                permBadge = '<span class="badge" style="background:#fef3c7; color:#b45309; font-size:0.75rem;">🔑 선택 허용</span>';
            }

            // 포털 연동 피처 뱃지
            const featureBadges = [];
            if (m.nav?.enabled) featureBadges.push('<span style="font-size:0.72rem; background:#f1f5f9; padding:2px 5px; border-radius:4px;">🌐 내비</span>');
            if (Array.isArray(m.quickStrip) && m.quickStrip.length > 0) featureBadges.push('<span style="font-size:0.72rem; background:#f1f5f9; padding:2px 5px; border-radius:4px;">⚡ 퀵</span>');
            if (m.portalWidget?.enabled) featureBadges.push('<span style="font-size:0.72rem; background:#f1f5f9; padding:2px 5px; border-radius:4px;">🍱 위젯</span>');
            if (m.admin?.enabled) featureBadges.push('<span style="font-size:0.72rem; background:#ede9fe; color:#6d28d9; padding:2px 5px; border-radius:4px;">⚙️ 관리자</span>');

            // 토글 버튼 스타일
            const toggleBtn = isEnabled ? `
                <button type="button" class="btn-admin btn-admin-success btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleModuleStatus('${m.id}')">
                    🟢 활성 중
                </button>
            ` : `
                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 8px; font-size:0.75rem; color:#94a3b8;" onclick="toggleModuleStatus('${m.id}')">
                    ⚪ 비활성
                </button>
            `;

            // 삭제 버튼 (코어 서비스는 비활성화로 유도)
            const deleteBtn = isCore ? `
                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 6px; font-size:0.75rem; opacity:0.4; cursor:not-allowed;" title="시스템 핵심 서비스는 삭제할 수 없습니다.">
                    🔒
                </button>
            ` : `
                <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" style="padding:2px 6px; font-size:0.75rem;" onclick="deleteModuleItem('${m.id}', '${m.name}')" title="모듈 삭제">
                    🗑️
                </button>
            `;

            return `
                <tr style="${isEnabled ? '' : 'opacity:0.6; background:#fbfcfe;'}">
                    <td style="text-align:center; font-family:monospace; font-size:0.85rem; color:#64748b;">
                        ${m.order || 50}
                    </td>
                    <td>
                        <div style="font-weight:700; font-size:0.92rem; color:#0f172a; display:flex; align-items:center; gap:6px;">
                            <span>${m.icon || '📦'}</span>
                            <span>${m.name}</span>
                            ${isCore ? '<span style="font-size:0.68rem; color:#94a3b8; font-weight:normal;">(코어)</span>' : ''}
                        </div>
                        <div style="font-family:monospace; font-size:0.75rem; color:#64748b; margin-top:2px;">
                            ${m.id}
                        </div>
                    </td>
                    <td>
                        <span class="badge" style="background:#f8fafc; border:1px solid #e2e8f0; font-size:0.75rem;">
                            ${m.category || '라이프'}
                        </span>
                    </td>
                    <td>
                        <a href="${m.entryUrl}" target="_blank" style="font-family:monospace; font-size:0.78rem; color:#2563eb; text-decoration:none;">
                            ${m.entryUrl}
                        </a>
                    </td>
                    <td>
                        ${permBadge}
                    </td>
                    <td>
                        <div style="display:flex; flex-wrap:wrap; gap:3px;">
                            ${featureBadges.join('')}
                        </div>
                    </td>
                    <td style="text-align:center;">
                        ${toggleBtn}
                    </td>
                    <td style="text-align:center;">
                        <div style="display:inline-flex; gap:4px; align-items:center;">
                            <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 6px; font-size:0.75rem;" onclick="openModuleModal('${m.id}')" title="설정 수정">
                                ✏️
                            </button>
                            ${deleteBtn}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // 모듈 활성/비활성화 토글
    window.toggleModuleStatus = async function(moduleId) {
        try {
            const res = await fetch(`/api/modules/admin/${moduleId}/toggle`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (data.success) {
                if (typeof showToast === 'function') showToast(data.message);
                await loadAdminModulesList();
            } else {
                alert(data.message || '상태 변경에 실패했습니다.');
            }
        } catch (e) {
            alert('상태 변경 중 서버 오류가 발생했습니다.');
        }
    };

    // 모듈 등록/수정 모달 열기
    window.openModuleModal = function(moduleId) {
        const modal = document.getElementById('moduleEditModal');
        const form = document.getElementById('moduleEditForm');
        const titleEl = document.getElementById('moduleModalTitle');
        const isEditEl = document.getElementById('inputModIsEdit');
        const idInput = document.getElementById('inputModId');
        if (!modal || !form) return;

        form.reset();

        if (moduleId) {
            const mod = cachedModulesData.find(m => m.id === moduleId);
            if (!mod) return;

            titleEl.textContent = `✏️ [${mod.name}] 서비스 모듈 수정`;
            isEditEl.value = 'true';
            idInput.value = mod.id;
            idInput.readOnly = true;
            idInput.style.background = '#f1f5f9';

            document.getElementById('inputModName').value = mod.name || '';
            document.getElementById('inputModIcon').value = mod.icon || '📦';
            document.getElementById('inputModCategory').value = mod.category || '라이프';
            document.getElementById('inputModEntryUrl').value = mod.entryUrl || '';
            document.getElementById('inputModBaseUrl').value = mod.baseUrl || '';
            document.getElementById('inputModOrder').value = mod.order || 50;
            document.getElementById('inputModDesc').value = mod.description || '';

            document.getElementById('chkModAdminOnly').checked = Boolean(mod.adminOnly);
            document.getElementById('chkModFamilyDefault').checked = Boolean(mod.defaultFamilyAllowed);
            document.getElementById('chkModNav').checked = Boolean(mod.nav?.enabled);
            document.getElementById('chkModQuick').checked = Array.isArray(mod.quickStrip) && mod.quickStrip.length > 0;
            document.getElementById('chkModWidget').checked = Boolean(mod.portalWidget?.enabled);
            document.getElementById('chkModAdminTab').checked = Boolean(mod.admin?.enabled);
        } else {
            titleEl.textContent = '➕ 새 서비스 모듈 등록';
            isEditEl.value = 'false';
            idInput.value = '';
            idInput.readOnly = false;
            idInput.style.background = '#fff';
            document.getElementById('inputModOrder').value = 80;
            document.getElementById('chkModFamilyDefault').checked = true;
            document.getElementById('chkModNav').checked = true;
            document.getElementById('chkModQuick').checked = true;
            document.getElementById('chkModWidget').checked = true;
            document.getElementById('chkModAdminTab').checked = true;
        }

        modal.style.display = 'flex';
        modal.classList.add('active');
    };

    window.closeModuleModal = function() {
        const modal = document.getElementById('moduleEditModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    };

    // 폼 제출 저장
    window.submitModuleForm = async function(e) {
        e.preventDefault();
        const isEdit = document.getElementById('inputModIsEdit').value === 'true';
        const id = document.getElementById('inputModId').value.trim();
        const name = document.getElementById('inputModName').value.trim();
        const icon = document.getElementById('inputModIcon').value.trim() || '📦';
        const category = document.getElementById('inputModCategory').value;
        const entryUrl = document.getElementById('inputModEntryUrl').value.trim();
        const baseUrl = document.getElementById('inputModBaseUrl').value.trim();
        const order = parseInt(document.getElementById('inputModOrder').value, 10) || 50;
        const description = document.getElementById('inputModDesc').value.trim();

        const adminOnly = document.getElementById('chkModAdminOnly').checked;
        const defaultFamilyAllowed = document.getElementById('chkModFamilyDefault').checked;
        const navEnabled = document.getElementById('chkModNav').checked;
        const quickEnabled = document.getElementById('chkModQuick').checked;
        const widgetEnabled = document.getElementById('chkModWidget').checked;
        const adminTabEnabled = document.getElementById('chkModAdminTab').checked;

        const payload = {
            id,
            name,
            icon,
            category,
            entryUrl,
            baseUrl,
            ssoEnabled: Boolean(baseUrl),
            order,
            description,
            adminOnly,
            defaultFamilyAllowed: adminOnly ? false : defaultFamilyAllowed,
            nav: navEnabled ? { enabled: true, label: name, entryUrl, subLinks: [] } : { enabled: false },
            quickStrip: quickEnabled ? [{ id: `${id}-quick`, label: name, icon, type: 'link', url: entryUrl }] : [],
            portalWidget: widgetEnabled ? { enabled: true, title: `${name} 현황`, viewMoreUrl: entryUrl, apiEndpoint: `/api/${id}/summary` } : null,
            admin: adminTabEnabled ? {
                enabled: true,
                title: `${name} 제어`,
                icon,
                tabId: `tab-${id}`,
                subMenus: [
                    { id: `subpane-${id}-main`, title: '현황 및 관리', icon: '📊', type: 'iframe', src: entryUrl }
                ]
            } : null
        };

        try {
            const url = isEdit ? `/api/modules/admin/${id}` : '/api/modules/admin';
            const method = isEdit ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const resData = await res.json();

            if (resData.success) {
                closeModuleModal();
                if (typeof showToast === 'function') showToast(resData.message);
                await loadAdminModulesList();
            } else {
                alert(resData.message || '저장 실패');
            }
        } catch (err) {
            alert('설정 저장 중 서버 통신 오류가 발생했습니다.');
        }
    };

    // 모듈 삭제
    window.deleteModuleItem = async function(moduleId, moduleName) {
        if (!confirm(`정말로 [${moduleName} (${moduleId})] 서비스 모듈을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
            return;
        }

        try {
            const res = await fetch(`/api/modules/admin/${moduleId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const resData = await res.json();

            if (resData.success) {
                if (typeof showToast === 'function') showToast(resData.message);
                await loadAdminModulesList();
            } else {
                alert(resData.message || '삭제 실패');
            }
        } catch (err) {
            alert('모듈 삭제 중 서버 오류가 발생했습니다.');
        }
    };
})();
