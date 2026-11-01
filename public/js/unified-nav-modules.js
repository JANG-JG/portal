/**
 * 🌐 JG 상단 내비게이션 바 동적 모듈 주입 엔진 (unified-nav-modules.js)
 * - /api/modules/nav에서 허용된 모듈 목록을 조회하여, HTML에 없는 신규 서비스를 상단바/드로어에 자동 마운트
 * - [규칙 2] 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    if (window.__UNAV_MODULES_INITIALIZED__) return;
    window.__UNAV_MODULES_INITIALIZED__ = true;

    async function syncDynamicNavModules() {
        try {
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const apiBase = isLocal ? '' : 'https://j-jg.cc';
            const res = await fetch(`${apiBase}/api/modules/nav`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !Array.isArray(data.navModules)) return;

            const desktopMenu = document.querySelector('.unav-menu');
            const mobileList = document.querySelector('.unav-m-list');
            if (!desktopMenu && !mobileList) return;

            const targetInsertDesktop = desktopMenu?.querySelector('[data-service="ops"]') 
                || desktopMenu?.querySelector('.unav-notif-btn')?.closest('.unav-item') 
                || desktopMenu?.querySelector('.unav-logout-btn')?.closest('.unav-item');

            const targetInsertMobile = mobileList?.querySelector('[data-service="ops"]')
                || mobileList?.querySelector('.unav-m-install-btn')?.closest('.unav-m-group')
                || mobileList?.lastElementChild;

            data.navModules.forEach(mod => {
                const modId = mod.id;
                const modLabel = mod.label || mod.name;
                const modIcon = mod.icon || '📦';
                const entryUrl = mod.entryUrl || '#';
                const subLinks = Array.isArray(mod.subLinks) ? mod.subLinks : [];

                // 1. 데스크톱 내비바 동적 삽입 (기존 요소가 없을 때만)
                if (desktopMenu && !desktopMenu.querySelector(`[data-nav="${modId}"], [data-service="${modId}"]`)) {
                    const item = document.createElement('div');
                    item.className = 'unav-item';
                    item.setAttribute('data-service', modId);

                    if (subLinks.length > 0) {
                        const subLinksHtml = subLinks.map(sub => `
                            <a href="${sub.url}" class="unav-sublink">
                                <span class="unav-sub-icon">${sub.icon || '🔗'}</span>
                                <div class="unav-sub-text">
                                    <strong>${sub.name}</strong>
                                    ${sub.desc ? `<small>${sub.desc}</small>` : ''}
                                </div>
                            </a>
                        `).join('');

                        item.innerHTML = `
                            <a href="${entryUrl}" class="unav-link" data-nav="${modId}">
                                <span class="unav-item-icon">${modIcon}</span>
                                <span>${modLabel}</span>
                                <span class="unav-arrow">▾</span>
                            </a>
                            <div class="unav-dropdown">
                                ${subLinksHtml}
                            </div>
                        `;
                    } else {
                        item.innerHTML = `
                            <a href="${entryUrl}" class="unav-link" data-nav="${modId}">
                                <span class="unav-item-icon">${modIcon}</span>
                                <span>${modLabel}</span>
                            </a>
                        `;
                    }

                    if (targetInsertDesktop) desktopMenu.insertBefore(item, targetInsertDesktop);
                    else desktopMenu.appendChild(item);
                }

                // 2. 모바일 드로어 동적 삽입 (기존 요소가 없을 때만)
                if (mobileList && !mobileList.querySelector(`[data-nav="${modId}"], [data-service="${modId}"]`)) {
                    const group = document.createElement('div');
                    group.className = 'unav-m-group';
                    group.setAttribute('data-nav', modId);
                    group.setAttribute('data-service', modId);

                    if (subLinks.length > 0) {
                        const subHtml = subLinks.map(sub => `<a href="${sub.url}">${sub.icon || '🔗'} ${sub.name}</a>`).join('');
                        group.innerHTML = `
                            <button type="button" class="unav-m-title" onclick="toggleUnavAccordion(this)">
                                <span>${modIcon} ${modLabel}</span>
                                <span class="unav-m-chevron">▾</span>
                            </button>
                            <div class="unav-m-submenu">
                                ${subHtml}
                            </div>
                        `;
                    } else {
                        group.innerHTML = `
                            <a href="${entryUrl}" class="unav-m-title" style="text-decoration: none; display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                <span>${modIcon} ${modLabel}</span>
                                <span class="unav-m-chevron" style="transform: none; font-size: 0.9rem; opacity: 0.7;">↗</span>
                            </a>
                        `;
                    }

                    if (targetInsertMobile) mobileList.insertBefore(group, targetInsertMobile);
                    else mobileList.appendChild(group);
                }
            });
        } catch (e) {
            // 조용히 fallback
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncDynamicNavModules);
    } else {
        syncDynamicNavModules();
    }
})();
