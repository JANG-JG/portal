// ==============================================================================
// 🌐 JG 포털 메인 오케스트레이터 & 탭 네비게이션 엔진 (portal-main.js)
// - 상단 커맨드 탭 전환 & 부드러운 스크롤 정렬
// - 실시간 스크롤스파이(ScrollSpy) 활성 탭 동기화 (자석 효과 및 바닥 도달 보정)
// - 컴포넌트 모듈 생명주기 조율 (Summary, Market, Infra, Modals)
// ==============================================================================

let currentPortalTab = 'home';

// 🌟 1. 상단 탭 네비게이션 활성 스타일 완벽 동기화 (자석처럼 가로 중앙 스크롤)
function updatePortalTabNavUI(tabName) {
    const tabBtns = document.querySelectorAll('.portal-tab-btn');
    const activeBtns = [];

    tabBtns.forEach(btn => {
        const bTab = btn.getAttribute('data-tab');
        if (bTab === tabName) {
            btn.classList.add('active');
            activeBtns.push(btn);
        } else {
            btn.classList.remove('active');
        }
    });

    // 화면에 실제로 노출 중인 탭 버튼(데스크톱 또는 모바일 스트립)을 자석처럼 중앙 정렬
    activeBtns.forEach(btn => {
        if (btn.offsetParent !== null) {
            try {
                btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            } catch (e) {
                // 구형 브라우저 fallback
                const parent = btn.parentElement;
                if (parent) {
                    const scrollLeft = btn.offsetLeft - (parent.clientWidth / 2) + (btn.clientWidth / 2);
                    parent.scrollTo({ left: scrollLeft, behavior: 'smooth' });
                }
            }
        }
    });
}

// 🌟 2. 탭 클릭 시 해당 벤토 카드로 부드럽게 스크롤 정렬
function switchPortalTab(tabName, smooth = true) {
    if (tabName === 'blood' && document.documentElement.classList.contains('hide-blood')) {
        tabName = 'home';
    }
    currentPortalTab = tabName;
    updatePortalTabNavUI(tabName);

    let targetEl = null;
    if (tabName === 'home') {
        targetEl = document.getElementById('portal-bento-root') || document.body;
    } else if (tabName === 'blood') {
        targetEl = document.querySelector('.homarr-health-summary-box') || document.querySelector('.homarr-hero-card') || document.getElementById('bento-blood');
    } else if (tabName === 'wiki') {
        targetEl = document.getElementById('bento-wiki');
    } else if (tabName === 'calendar') {
        targetEl = document.getElementById('bento-calendar');
    } else if (tabName === 'album') {
        targetEl = document.getElementById('bento-album');
    } else if (tabName === 'asset') {
        targetEl = document.getElementById('bento-asset');
    } else if (tabName === 'news') {
        targetEl = document.getElementById('bento-news');
    } else if (tabName === 'ops') {
        targetEl = document.getElementById('bento-ops');
    }

    if (targetEl) {
        const navBar = document.getElementById('portal-tab-bar');
        const navHeight = navBar ? navBar.getBoundingClientRect().height : 52;
        const bodyRect = document.body.getBoundingClientRect().top;
        const elementRect = targetEl.getBoundingClientRect().top;
        const elementPosition = elementRect - bodyRect;
        const offsetPosition = Math.max(0, elementPosition - navHeight - 16);

        window.scrollTo({
            top: offsetPosition,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    if (history.replaceState) {
        const cleanUrl = window.location.pathname + window.location.search + (tabName === 'home' ? '' : '#' + tabName);
        history.replaceState(null, null, cleanUrl);
    }
}

// 🌟 3. 스크롤 위치 기반 실시간 탭 활성화 감지 (ScrollSpy)
function initBentoScrollSpy() {
    const sectionMap = [
        { selector: '.homarr-health-summary-box', tab: 'blood' },
        { id: 'bento-wiki',     tab: 'wiki' },
        { id: 'bento-calendar', tab: 'calendar' },
        { id: 'bento-album',    tab: 'album' },
        { id: 'bento-asset',    tab: 'asset' },
        { id: 'bento-news',     tab: 'news' },
        { id: 'bento-ops',      tab: 'ops' }
    ];

    let ticking = false;

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                const scrollY = window.scrollY || window.pageYOffset;
                const windowH = window.innerHeight;
                const docH = document.documentElement.scrollHeight;
                const navBar = document.getElementById('portal-tab-bar');
                const navH = navBar ? navBar.getBoundingClientRect().height : 52;

                let activeMatch = 'home';

                // 1) 최상단 근처는 대시보드
                if (scrollY < 120) {
                    activeMatch = 'home';
                }
                // 2) 페이지 최하단 도달 시: 서버 인프라 카드가 작아도 100% 활성화
                else if (windowH + scrollY >= docH - 80) {
                    activeMatch = 'ops';
                }
                // 3) 섹션별 역순 판정 (스크롤 진행에 따라 자석처럼 순차 이동)
                else {
                    const threshold = navH + 130;
                    for (let i = sectionMap.length - 1; i >= 0; i--) {
                        const item = sectionMap[i];
                        const el = item.id ? document.getElementById(item.id) : (item.selector ? document.querySelector(item.selector) : null);
                        if (el) {
                            const rect = el.getBoundingClientRect();
                            if (rect.top <= threshold) {
                                activeMatch = item.tab;
                                break;
                            }
                        }
                    }
                }

                if (currentPortalTab !== activeMatch) {
                    currentPortalTab = activeMatch;
                    updatePortalTabNavUI(activeMatch);
                }
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
}

// 🌟 4. 전역 DOMContentLoaded 진입점
document.addEventListener('DOMContentLoaded', () => {
    // 4-1. 스크롤스파이 활성화
    initBentoScrollSpy();

    // 4-2. URL 해시 기반 탭 자동 이동
    const hash = window.location.hash.replace('#', '');
    if (hash && ['home', 'blood', 'asset', 'album', 'calendar', 'med', 'news', 'ops'].includes(hash)) {
        setTimeout(() => switchPortalTab(hash, false), 150);
    }

    // 4-3. 사용자 정보 비동기 로드 및 가족 계정 RBAC 격리
    fetch('/api/me')
        .then(res => res.json())
        .then(data => {
            if (data && data.success) {
                const u = document.getElementById('usernameDisplay');
                if (u) u.textContent = data.nickname || data.username;

                // 권한 캐시 동기화 및 FOUC 방지 클래스 업데이트
                document.documentElement.classList.remove('role-pending');
                const role = data.role || 'family';
                const allowed = data.allowedServices || ['album', 'news'];
                try {
                    localStorage.setItem('jg_user_role', role);
                    localStorage.setItem('jg_allowed_services', allowed.join(','));
                } catch (e) {}

                // 🛡️ 계정 권한 분리 및 혈압 관리자 전용 제어
                if (role !== 'admin') {
                    // 🩸 혈압은 관리자 전용 기능 -> 비관리자 원천 은폐
                    document.documentElement.classList.add('hide-blood');
                    document.querySelectorAll('[data-service="blood"]').forEach(el => el.style.setProperty('display', 'none', 'important'));
                    const healthBox = document.querySelector('.homarr-health-summary-box');
                    if (healthBox) healthBox.style.setProperty('display', 'none', 'important');
                    const bloodBento = document.getElementById('bento-blood');
                    if (bloodBento) bloodBento.style.display = 'none';
                    document.querySelectorAll('.portal-tab-btn[data-tab="blood"]').forEach(el => el.style.display = 'none');
                    document.querySelectorAll('a[href="/go/blood"], a[href="https://blood.j-jg.cc"]').forEach(el => el.style.display = 'none');
                    const medBtn = document.querySelector('button[onclick="recordQuickMedication()"]');
                    if (medBtn) medBtn.style.display = 'none';

                    if (role === 'family') {
                        document.documentElement.classList.add('role-family', 'hide-ops');
                        if (!allowed.includes('asset')) document.documentElement.classList.add('hide-asset');
                        else document.documentElement.classList.remove('hide-asset');

                        // 1) 헤더 가족 환영 뱃지 표시
                        const badge = document.getElementById('familyGreetingBadge');
                        if (badge) {
                            const name = data.nickname || data.username;
                            badge.textContent = `🌸 ${name}님`;
                            badge.title = `${name}님 (가족 계정)`;
                            badge.style.display = 'inline-flex';
                        }

                        // 2) 서버 인프라 카드 및 탭 원천 차단/숨김 (방어 로직)
                        const opsBento = document.getElementById('bento-ops');
                        if (opsBento) opsBento.style.display = 'none';
                        document.querySelectorAll('.portal-tab-btn[data-tab="ops"]').forEach(el => el.style.display = 'none');
                        document.querySelectorAll('a[href="/admin"]').forEach(el => el.style.display = 'none');

                        // 3) 허용되지 않은 서브 서비스 숨김 (자산 등)
                        if (!allowed.includes('asset')) {
                            const assetBento = document.getElementById('bento-asset');
                            if (assetBento) assetBento.style.display = 'none';
                            document.querySelectorAll('.portal-tab-btn[data-tab="asset"]').forEach(el => el.style.display = 'none');
                            document.querySelectorAll('a[href="/go/asset"], a[href="https://asset.j-jg.cc"]').forEach(el => el.style.display = 'none');
                        }
                    }
                } else {
                    document.documentElement.classList.remove('role-family', 'hide-blood', 'hide-asset', 'hide-ops');
                    document.documentElement.classList.add('role-admin');
                }
            }
        })
        .catch(() => {});

    // 4-4. 통합 요약 데이터 로드 (portal-summary.js 모듈 호출)
    if (typeof loadSummary === 'function') {
        loadSummary();
    }

    // 4-5. 모듈 레지스트리 기반 원터치 빠른 실행 동적 동기화
    loadDynamicQuickStrip();

    // 4-6. 모듈 레지스트리 기반 신규 벤토 위젯 카드 동적 마운트
    syncDynamicBentoWidgets();
});

// 🌟 5. 모듈 레지스트리 기반 원터치 빠른 실행(Quick Strip) 동적 로드 (신규 서비스 자동 연동)
async function loadDynamicQuickStrip() {
    const grid = document.getElementById('portalQuickStripGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/modules/quick-strip');
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.quickItems) && data.quickItems.length > 0) {
            grid.innerHTML = data.quickItems.map(item => {
                const icon = item.icon || '🚀';
                const label = item.label || '바로가기';
                const modId = item.moduleId || '';
                if (item.type === 'action') {
                    return `
                        <button type="button" class="cmd-strip-btn" onclick="${item.action}" title="${label}" data-service="${modId}">
                            <span class="cmd-strip-icon">${icon}</span>
                            <span>${label}</span>
                        </button>
                    `;
                }
                const url = item.url || '#';
                return `
                    <a href="${url}" class="cmd-strip-btn" title="${label}" data-service="${modId}">
                        <span class="cmd-strip-icon">${icon}</span>
                        <span>${label}</span>
                    </a>
                `;
            }).join('');
        }
    } catch (e) {}
}

// 🌟 6. 모듈 레지스트리 기반 메인 대시보드 벤토 위젯 동적 마운트 (신규 모듈 슬롯 자동 렌더링)
async function syncDynamicBentoWidgets() {
    const grid = document.getElementById('portalHomarrGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/modules');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success || !Array.isArray(data.modules)) return;

        for (const mod of data.modules) {
            if (!mod.portalWidget || mod.portalWidget.enabled === false) continue;
            const cardId = mod.portalWidget.cardId || `bento-${mod.id}`;

            // 이미 정적으로 존재하는 위젯이면 건너뜀 (기존 정상 로직 100% 보존)
            if (document.getElementById(cardId)) continue;

            const title = mod.portalWidget.title || mod.name;
            const icon = mod.icon || '📦';
            const viewMoreUrl = mod.portalWidget.viewMoreUrl || mod.entryUrl || '#';
            const apiEndpoint = mod.portalWidget.apiEndpoint;

            const card = document.createElement('div');
            card.className = `homarr-card card-${mod.id}`;
            card.id = cardId;
            card.setAttribute('data-service', mod.id);

            card.innerHTML = `
                <div class="homarr-card-header">
                    <div class="homarr-card-title-group">
                        <span class="homarr-card-icon">${icon}</span>
                        <h3 class="homarr-card-title">${title}</h3>
                    </div>
                    <a href="${viewMoreUrl}" class="homarr-card-link">바로가기 →</a>
                </div>
                <div class="portal-widget-dynamic-body" id="${cardId}-body" style="padding: 0.75rem 0;">
                    <div style="font-size:0.85rem; color:#64748b;">데이터를 불러오는 중입니다...</div>
                </div>
                <div class="bento-card-footer">
                    <span id="${cardId}-status">${mod.description || title}</span>
                    <a href="${viewMoreUrl}" style="color:var(--hm-blue); text-decoration:none; font-weight:600;">열기 ↗</a>
                </div>
            `;
            grid.appendChild(card);

            if (apiEndpoint) {
                fetch(apiEndpoint, { credentials: 'include' })
                    .then(r => r.json())
                    .then(resData => {
                        const bodyEl = document.getElementById(`${cardId}-body`);
                        if (!bodyEl) return;
                        if (resData && resData.success !== false) {
                            const val = resData.mainVal || resData.value || resData.summary || resData.count || '';
                            const sub = resData.subVal || resData.subText || resData.desc || '';
                            const badge = resData.badge ? `<span class="bento-badge badge-emerald" style="margin-left:8px;">${resData.badge}</span>` : '';
                            bodyEl.innerHTML = `
                                <div style="display:flex; align-items:baseline; gap:8px;">
                                    <strong style="font-size:1.35rem; color:var(--hm-text); font-family:monospace;">${val || '정상 운영 중'}</strong>
                                    ${badge}
                                </div>
                                ${sub ? `<div style="font-size:0.82rem; color:var(--hm-text-muted); margin-top:4px;">${sub}</div>` : ''}
                            `;
                        } else {
                            bodyEl.innerHTML = `<div style="font-size:0.85rem; color:#64748b;">${mod.description || '정상 운영 중'}</div>`;
                        }
                    })
                    .catch(() => {
                        const bodyEl = document.getElementById(`${cardId}-body`);
                        if (bodyEl) bodyEl.innerHTML = `<div style="font-size:0.85rem; color:#64748b;">${mod.description || '정상 운영 중'}</div>`;
                    });
            }
        }
    } catch (e) {}
}
