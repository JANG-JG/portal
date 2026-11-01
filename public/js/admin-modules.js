/**
 * ⚙️ JG 관리자 센터 동적 모듈 플러그인 로더 (admin-modules.js)
 * - /api/modules/admin/all을 통해 신규 모듈을 자동 감지
 * - 좌측 사이드바, 상단 탭, iframe 마이크로 프론트엔드 서브패널을 동적으로 자동 마운트
 * - [규칙 2] 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    if (window.__ADMIN_MODULES_LOADER_INITIALIZED__) return;
    window.__ADMIN_MODULES_LOADER_INITIALIZED__ = true;

    async function initDynamicAdminModules() {
        try {
            const res = await fetch('/api/modules/admin/all');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !Array.isArray(data.modules)) return;

            const sidebarNav = document.getElementById('adminSidebarNav') || document.querySelector('.admin-sidebar-nav');
            const tabsNav = document.getElementById('adminTabsNav') || document.querySelector('.admin-tabs-nav');
            const dynamicPanes = document.getElementById('adminDynamicPanesContainer');
            if (!sidebarNav) return;

            const targetSidebarAnchor = document.getElementById('sidebar-group-backup') 
                || document.getElementById('sidebar-group-database') 
                || sidebarNav.lastElementChild;

            const targetTabAnchor = tabsNav?.querySelector('[data-tab="tab-backup"]') 
                || tabsNav?.querySelector('[data-tab="tab-database"]') 
                || tabsNav?.lastElementChild;

            data.modules.forEach(mod => {
                if (!mod.admin || mod.admin.enabled === false) return;
                const tabId = mod.admin.tabId || `tab-${mod.id}`;

                // 1. 이미 정적으로 존재하는 탭이면 건너뜀 (기존 로직 100% 보존)
                if (document.getElementById(tabId)) return;

                const modTitle = mod.admin.title || mod.name;
                const modIcon = mod.admin.icon || mod.icon || '⚙️';
                const subMenus = Array.isArray(mod.admin.subMenus) && mod.admin.subMenus.length > 0
                    ? mod.admin.subMenus
                    : [{ id: `subpane-${mod.id}-main`, title: '대시보드', icon: '📊', type: 'iframe', src: mod.entryUrl }];

                // 2. 전역 SUBTABS_CONFIG에 동적 등록 (admin-core.js 호환)
                if (window.SUBTABS_CONFIG) {
                    window.SUBTABS_CONFIG[tabId] = subMenus.map(sub => ({
                        id: sub.id,
                        label: sub.title,
                        icon: sub.icon || '📌',
                        type: sub.type || 'iframe',
                        src: sub.src || ''
                    }));
                }

                // 3. 상단 1단 대메뉴 탭 버튼 동적 삽입
                if (tabsNav && !tabsNav.querySelector(`[data-tab="${tabId}"]`)) {
                    const tabBtn = document.createElement('button');
                    tabBtn.className = 'admin-tab-btn';
                    tabBtn.setAttribute('data-tab', tabId);
                    tabBtn.onclick = function() {
                        if (typeof window.switchAdminTab === 'function') window.switchAdminTab(tabId, this);
                    };
                    tabBtn.innerHTML = `<span>${modIcon}</span> <span>${modTitle}</span>`;
                    if (targetTabAnchor) tabsNav.insertBefore(tabBtn, targetTabAnchor);
                    else tabsNav.appendChild(tabBtn);
                }

                // 4. 좌측 사이드바 아코디언 그룹 동적 삽입
                const sidebarGroupId = `sidebar-group-${mod.id}`;
                if (!document.getElementById(sidebarGroupId)) {
                    const group = document.createElement('div');
                    group.className = 'admin-sidebar-group';
                    group.id = sidebarGroupId;

                    const subLinksHtml = subMenus.map(sub => `
                        <button type="button" class="admin-sidebar-sublink" data-tab="${tabId}" data-sub="${sub.id}" onclick="switchAdminTabAndSub('${tabId}', '${sub.id}')">
                            <span>${sub.icon || '📌'}</span> ${sub.title}
                        </button>
                    `).join('');

                    group.innerHTML = `
                        <button type="button" class="admin-sidebar-parent" onclick="toggleSidebarGroup('${mod.id}')">
                            <span class="admin-sidebar-parent-left">
                                <span>${modIcon}</span>
                                <span>${modTitle}</span>
                            </span>
                            <span class="admin-sidebar-parent-chevron">▼</span>
                        </button>
                        <div class="admin-sidebar-sublist">
                            ${subLinksHtml}
                        </div>
                    `;

                    if (targetSidebarAnchor) sidebarNav.insertBefore(group, targetSidebarAnchor);
                    else sidebarNav.appendChild(group);
                }

                // 5. 본문 탭 패널 및 마이크로 프론트엔드 iframe 서브패널 생성
                if (dynamicPanes && !document.getElementById(tabId)) {
                    const tabPane = document.createElement('div');
                    tabPane.id = tabId;
                    tabPane.className = 'admin-tab-pane';

                    const subPanesHtml = subMenus.map((sub, idx) => {
                        const isFirst = idx === 0;
                        const hiddenClass = isFirst ? '' : 'hidden-pane';

                        if (sub.type === 'builtin-backup') {
                            return `
                                <div id="${sub.id}" class="admin-sub-pane ${hiddenClass}">
                                    <div class="admin-card">
                                        <div class="admin-card-header">
                                            <h3>💾 ${sub.title}</h3>
                                        </div>
                                        <p style="font-size:0.9rem; color:#64748b;">
                                            ${modTitle}의 SQLite 데이터베이스를 안전하게 스냅샷 백업합니다.
                                        </p>
                                        <div style="margin-top:1rem;">
                                            <a href="/api/admin/db/download?db=${encodeURIComponent(sub.dbPath || '')}" class="btn-admin btn-admin-primary">
                                                ⬇️ 데이터베이스 다운로드 (.db)
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }

                        // 마이크로 프론트엔드 iframe 패널
                        const frameSrc = sub.src || mod.entryUrl || 'about:blank';
                        return `
                            <div id="${sub.id}" class="admin-sub-pane ${hiddenClass}" style="min-height: calc(100vh - 160px);">
                                <div class="admin-card" style="padding:0; overflow:hidden; min-height:650px; height:calc(100vh - 170px); border-radius:0.75rem; border:1px solid #e2e8f0; background:#fff;">
                                    <iframe src="${frameSrc}" style="width:100%; height:100%; border:none; display:block;" loading="lazy" title="${sub.title}"></iframe>
                                </div>
                            </div>
                        `;
                    }).join('');

                    tabPane.innerHTML = subPanesHtml;
                    dynamicPanes.appendChild(tabPane);
                }
            });
        } catch (e) {
            console.warn('[AdminModules] 동적 모듈 로드 실패:', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDynamicAdminModules);
    } else {
        initDynamicAdminModules();
    }
})();
