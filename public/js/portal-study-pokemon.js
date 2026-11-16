/**
 * ==============================================================================
 * 포털 메인 대시보드 - 오늘의 아이들 단짝 포켓몬 미니 위젯 (portal-study-pokemon.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 6] 360px 모바일 무넘침 & 고정 이미지 비율 준수
 * ==============================================================================
 */
(function () {
    'use strict';

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureBuddyWidgetStyles() {
        if (document.getElementById('portalStudyBuddyStyles')) return;
        const style = document.createElement('style');
        style.id = 'portalStudyBuddyStyles';
        style.textContent = `
            #portalStudyBuddyStrip {
                display: none;
                min-width: 0;
                max-width: 100%;
                box-sizing: border-box;
            }
            #portalStudyBuddyStrip.has-study-buddies {
                display: block;
            }
            #portalHomarrGrid > #portalStudyBuddyStrip .portal-study-buddy-card {
                margin-bottom: 0;
            }
            .portal-study-buddy-card {
                background: var(--hm-bg-card, #ffffff);
                border: 1px solid var(--hm-border, #e2e8f0);
                border-radius: var(--hm-radius-card, 16px);
                padding: 1.25rem;
                margin-bottom: 1rem;
                box-shadow: var(--hm-shadow-md, 0 4px 16px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03));
                box-sizing: border-box;
                max-width: 100%;
                min-width: 0;
            }
            @media (prefers-reduced-motion: no-preference) {
                .portal-study-buddy-card {
                    transition: border-color 0.2s ease, box-shadow 0.2s ease;
                }
            }
            @media (hover: hover) {
                .portal-study-buddy-card:hover {
                    border-color: var(--hm-border-strong, #cbd5e1);
                    box-shadow: var(--hm-shadow-lg, 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 4px 10px -2px rgba(15, 23, 42, 0.04));
                }
            }
            [data-theme="dark"] .portal-study-buddy-card {
                background: var(--hm-bg-card, #1e293b);
                border-color: var(--hm-border, rgba(255, 255, 255, 0.08));
                box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.4);
            }
            .portal-study-buddy-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
                padding-bottom: 0.7rem;
                margin-bottom: 0.85rem;
                border-bottom: 1px solid var(--hm-border-subtle, #f1f5f9);
            }
            .portal-study-buddy-title {
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--hm-text-main, #0f172a);
                display: flex;
                align-items: center;
                gap: 0.4rem;
                min-width: 0;
            }
            .portal-study-buddy-link {
                font-size: 0.78rem;
                font-weight: 600;
                color: var(--hm-blue, #2563eb);
                text-decoration: none;
                flex-shrink: 0;
            }
            @media (max-width: 480px) {
                .portal-study-buddy-card {
                    padding: 0.95rem 1rem;
                }
            }
            .portal-study-buddy-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
                gap: 0.55rem;
            }
            .portal-study-buddy-item {
                display: flex;
                align-items: center;
                gap: 0.65rem;
                background: rgba(255, 255, 255, 0.92);
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 0.5rem 0.65rem;
                text-decoration: none;
                color: inherit;
                min-width: 0;
                box-sizing: border-box;
                transition: transform 0.16s ease, box-shadow 0.16s ease;
            }
            .portal-study-buddy-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 14px rgba(15, 23, 42, 0.07);
            }
            .portal-study-buddy-avatar {
                width: 46px;
                height: 46px;
                border-radius: 11px;
                background: #fef9c3;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                flex-shrink: 0;
                font-size: 1.4rem;
            }
            .portal-study-buddy-avatar img {
                width: 40px;
                height: 40px;
                object-fit: contain;
                animation: portalBuddyBob 2.4s ease-in-out infinite;
            }
            @keyframes portalBuddyBob {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-3px); }
            }
            .portal-study-buddy-meta {
                min-width: 0;
                flex: 1 1 auto;
            }
            .portal-study-buddy-name {
                font-size: 0.82rem;
                font-weight: 800;
                color: #0f172a;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .portal-study-buddy-sub {
                font-size: 0.74rem;
                color: #475569;
                margin-top: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .portal-study-buddy-pill {
                font-size: 0.7rem;
                font-weight: 800;
                padding: 2px 7px;
                border-radius: 999px;
                background: #fef3c7;
                color: #b45309;
                flex-shrink: 0;
            }
            .portal-study-buddy-pill.is-hatched {
                background: #dcfce7;
                color: #15803d;
            }
            @media (prefers-reduced-motion: reduce) {
                .portal-study-buddy-avatar img { animation: none; }
            }
        `;
        document.head.appendChild(style);
    }

    async function loadPortalStudyBuddies() {
        const container = document.getElementById('portalStudyBuddyStrip');
        if (!container) return;

        try {
            const res = await fetch('/api/portal/study-buddies', { credentials: 'same-origin' });
            if (!res.ok) {
                container.classList.remove('has-study-buddies');
                container.style.display = 'none';
                return;
            }
            const data = await res.json();
            if (!data?.success || !data.enabled || !Array.isArray(data.buddies) || data.buddies.length === 0) {
                container.classList.remove('has-study-buddies');
                container.style.display = 'none';
                return;
            }

            ensureBuddyWidgetStyles();
            const itemsHtml = data.buddies.map((b) => {
                const avatarHtml = b.partner
                    ? `<img src="${esc(b.partner.animatedUrl)}" data-fallback="${esc(b.partner.artworkUrl)}" alt="${esc(b.partner.nameKo)}">`
                    : `<span>${esc(b.hatched ? '🎉' : '🥚')}</span>`;
                const subLine = b.partner
                    ? `단짝 ${esc(b.partner.nameKo)} · 도감 ${Number(b.collectedCount || 0)}마리`
                    : `${esc(b.stageLabel || '도장 모으는 중')}`;
                const pillText = b.hatched ? '부화 🎉' : `${Number(b.steps || 0)}/10`;
                const pillCls = b.hatched ? 'portal-study-buddy-pill is-hatched' : 'portal-study-buddy-pill';

                return `
                    <a href="/study?childId=${encodeURIComponent(b.childId)}" class="portal-study-buddy-item">
                        <div class="portal-study-buddy-avatar">${avatarHtml}</div>
                        <div class="portal-study-buddy-meta">
                            <div class="portal-study-buddy-name">${esc(b.avatarEmoji || '🌟')} ${esc(b.displayName)}</div>
                            <div class="portal-study-buddy-sub">${subLine}</div>
                        </div>
                        <span class="${pillCls}">${esc(pillText)}</span>
                    </a>
                `;
            }).join('');

            container.innerHTML = `
                <div class="portal-study-buddy-card">
                    <div class="portal-study-buddy-head">
                        <div class="portal-study-buddy-title">🐣 오늘의 우리 아이 학습 단짝</div>
                        <a href="/study" class="portal-study-buddy-link">학습실 열기 →</a>
                    </div>
                    <div class="portal-study-buddy-grid">${itemsHtml}</div>
                </div>
            `;
            container.classList.add('has-study-buddies');
            if (container.dataset.dashboardHidden !== '1') {
                container.style.display = '';
            }
            if (typeof window.refreshBentoSectionStates === 'function') {
                window.refreshBentoSectionStates();
            }

            container.querySelectorAll('img[data-fallback]').forEach((img) => {
                img.addEventListener('error', () => {
                    if (img.dataset.triedFallback === '1') return;
                    img.dataset.triedFallback = '1';
                    if (img.dataset.fallback) img.src = img.dataset.fallback;
                });
            });
        } catch (_) {
            container.classList.remove('has-study-buddies');
            container.style.display = 'none';
            if (typeof window.refreshBentoSectionStates === 'function') {
                window.refreshBentoSectionStates();
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadPortalStudyBuddies);
    } else {
        loadPortalStudyBuddies();
    }
})();
