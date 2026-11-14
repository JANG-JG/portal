/**
 * 🌐 JG 상단 내비게이션 바 동적 모듈 주입 엔진 (unified-nav-modules.js)
 * - /api/modules/nav에서 허용된 모듈 목록을 조회하여, HTML에 없는 신규 서비스를 상단바/드로어에 자동 마운트
 * - [규칙 2] 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    if (window.__UNAV_MODULES_INITIALIZED__) return;
    window.__UNAV_MODULES_INITIALIZED__ = true;

    function resolvePortalUrl(rawUrl) {
        if (!rawUrl) return '#';
        const val = String(rawUrl).trim();
        if (!val || val.startsWith('#') || val.startsWith('http://') || val.startsWith('https://') || val.startsWith('javascript:')) {
            return val || '#';
        }
        const host = window.location.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
        if (isLocal) return val;
        return `https://j-jg.cc${val.startsWith('/') ? val : '/' + val}`;
    }

    async function syncDynamicNavModules() {
        try {
            const host = window.location.hostname;
            const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
            const apiBase = isLocal ? '' : 'https://j-jg.cc';
            const res = await fetch(`${apiBase}/api/modules/nav`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !Array.isArray(data.navModules)) return;

            const desktopMenu = document.querySelector('.unav-menu');
            const lifeDropdown = document.getElementById('unavLifeDropdown');
            const mobileList = document.querySelector('.unav-m-list');
            if (!desktopMenu && !mobileList) return;

            const allowedIds = new Set(data.navModules.map(m => m.id));
            // 정적 마운트된 모듈(예: wiki)이 관리자 설정으로 비활성화된 경우 동기화
            if (desktopMenu) {
                desktopMenu.querySelectorAll('[data-service="wiki"]').forEach(el => {
                    el.style.display = allowedIds.has('wiki') ? '' : 'none';
                });
            }
            if (mobileList) {
                mobileList.querySelectorAll('[data-service="wiki"]').forEach(el => {
                    el.style.display = allowedIds.has('wiki') ? '' : 'none';
                });
            }

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
                const entryUrl = resolvePortalUrl(mod.entryUrl || '#');
                const subLinks = Array.isArray(mod.subLinks) ? mod.subLinks : [];

                // 1. 데스크톱 내비바 동적 삽입 (상단 바 비대화 방지를 위해 '생활·가족' 드롭다운 내부에 합류)
                if (desktopMenu && !desktopMenu.querySelector(`[data-nav="${modId}"], [data-service="${modId}"]`)) {
                    if (lifeDropdown && modId !== 'admin' && modId !== 'ops') {
                        const subLink = document.createElement('a');
                        subLink.href = entryUrl;
                        subLink.className = 'unav-sublink';
                        subLink.setAttribute('data-nav', modId);
                        subLink.setAttribute('data-service', modId);
                        subLink.innerHTML = `
                            <span class="unav-sub-icon">${modIcon}</span>
                            <div class="unav-sub-text">
                                <strong>${modLabel}</strong>
                                ${mod.desc ? `<small>${mod.desc}</small>` : ''}
                            </div>
                        `;
                        lifeDropdown.appendChild(subLink);
                    } else {
                        const item = document.createElement('div');
                        item.className = 'unav-item';
                        item.setAttribute('data-service', modId);

                        if (subLinks.length > 0) {
                            const subLinksHtml = subLinks.map(sub => `
                                <a href="${resolvePortalUrl(sub.url)}" class="unav-sublink">
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
                }

                // 2. 모바일 드로어 동적 삽입 (기존 요소가 없을 때만)
                if (mobileList && !mobileList.querySelector(`[data-nav="${modId}"], [data-service="${modId}"]`)) {
                    const group = document.createElement('div');
                    group.className = 'unav-m-group';
                    group.setAttribute('data-nav', modId);
                    group.setAttribute('data-service', modId);

                    if (subLinks.length > 0) {
                        const subHtml = subLinks.map(sub => `<a href="${resolvePortalUrl(sub.url)}">${sub.icon || '🔗'} ${sub.name}</a>`).join('');
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

            if (typeof window.highlightUnavActive === 'function') window.highlightUnavActive();
            if (typeof window.syncUnavLayout === 'function') window.syncUnavLayout();
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
