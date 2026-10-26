/**
 * JG Portal 통합 관리자 센터 - 코어 유틸 & 내비게이션 모듈
 * admin-core.js
 */


// 5. 🗂️ 대메뉴별 서브메뉴(창) 설정 명세 ('전체 보기' 제거 - 개별 서브페이지로 깔끔하게 분리)
const SUBTABS_CONFIG = {
    'tab-overview': [
        { id: 'subpane-overview-processes', label: '프로세스 & 핵심 자원', icon: '🚀' },
        { id: 'subpane-overview-logs', label: '실시간 시스템 로그', icon: '💻' }
    ],
    'tab-blood': [
        { id: 'subpane-blood-backup', label: '데이터 백업 & CSV 복구', icon: '💾' },
        { id: 'subpane-blood-threshold', label: '위험 기준치 설정', icon: '⚙️' },
        { id: 'subpane-blood-records', label: '최근 혈압 측정 기록', icon: '🩸' }
    ],
    'tab-asset': [
        { id: 'subpane-asset-summary', label: '포트폴리오 & 백업', icon: '📊' },
        { id: 'subpane-asset-accounts', label: '증권 계좌별 현황', icon: '📂' },
        { id: 'subpane-asset-holdings', label: '보유 종목 상세', icon: '💼' }
    ],
    'tab-news': [
        { id: 'subpane-news-collect', label: '즉시 수집 & DB현황', icon: '🚀' },
        { id: 'subpane-news-articles', label: '최근 수집 기사 (10선)', icon: '📑' },
        { id: 'subpane-news-history', label: '수집 이력 & 로그 콘솔', icon: '📋' }
    ],
    'tab-album': [
        { id: 'subpane-album-summary', label: '사진첩 통계 & 스토리지', icon: '📊' },
        { id: 'subpane-album-photos', label: '최근 업로드 사진 관리', icon: '🖼️' },
        { id: 'subpane-album-members', label: '가족 구성원 활동 현황', icon: '👥' }
    ],
    'tab-backup': [
        { id: 'subpane-backup-status', label: '정기 백업 & 즉시 실행', icon: '📦' },
        { id: 'subpane-backup-logs', label: '실시간 백업 로그 콘솔', icon: '📋' }
    ],
    'tab-database': [
        { id: 'subpane-db-browse', label: '데이터 브라우징 & 관리', icon: '🗄️' },
        { id: 'subpane-db-query', label: 'SQL 쿼리 콘솔', icon: '⚡' },
        { id: 'subpane-db-schema', label: '테이블 구조 명세', icon: '📐' }
    ],
    'tab-security': [
        { id: 'subpane-security-family', label: '우리 가족 및 권한 관리', icon: '👨‍👩‍👧‍👦' },
        { id: 'subpane-security-logs', label: '최근 로그인 시도 이력', icon: '🔒' },
        { id: 'subpane-security-stack', label: 'SSO & 기술 스택 명세', icon: '🛡️' },
        { id: 'action-password-modal', label: '마스터 비밀번호 변경 (팝업)', icon: '🔑', isModal: true }
    ]
};

let currentAdminTab = 'tab-overview';
let currentAdminSub = 'subpane-overview-processes';

// 6. 관리자 좌측 사이드바 서브메뉴 제어
function toggleAdminSidebar(show) {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('adminSidebarOverlay');
    if (!sidebar || !overlay) return;
    const isOpen = sidebar.classList.contains('active');
    const shouldOpen = (typeof show === 'boolean') ? show : !isOpen;
    if (shouldOpen) {
        sidebar.classList.add('active');
        overlay.classList.add('active');
    } else {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    }
}

// 7. 사이드바 아코디언 그룹 토글
function toggleSidebarGroup(groupKey) {
    const groupEl = document.getElementById(`sidebar-group-${groupKey}`);
    if (!groupEl) return;
    const willExpand = !groupEl.classList.contains('expanded');
    document.querySelectorAll('.admin-sidebar-group').forEach(el => {
        el.classList.remove('expanded');
    });
    if (willExpand) {
        groupEl.classList.add('expanded');
    }
}

// 9-0. 🧲 탭/서브탭 캡슐 버튼 컨테이너 내부 안전 자석 중앙 정렬 헬퍼
function scrollTabIntoCenter(container, button, smooth = true) {
    if (!container || !button) return;
    
    // 만약 전체 내용이 컨테이너 너비보다 작거나 같으면 스크롤 불필요 (맨 왼쪽 0 고정)
    if (container.scrollWidth <= container.clientWidth) {
        container.scrollTo({ left: 0, behavior: smooth ? 'smooth' : 'auto' });
        return;
    }

    // 만약 첫 번째 버튼이면 항상 맨 왼쪽(scrollLeft = 0)으로 고정
    if (button === container.firstElementChild) {
        container.scrollTo({ left: 0, behavior: smooth ? 'smooth' : 'auto' });
        return;
    }
    // 만약 마지막 버튼이면 항상 맨 오른쪽 끝으로 스크롤
    if (button === container.lastElementChild) {
        container.scrollTo({ left: Math.max(0, container.scrollWidth - container.clientWidth), behavior: smooth ? 'smooth' : 'auto' });
        return;
    }

    // 현재 버튼이 이미 화면 안에 온전히 다 보이고 있다면 굳이 스크롤 이동하지 않음
    const curScroll = container.scrollLeft;
    const contWidth = container.clientWidth;
    const btnLeft = button.offsetLeft;
    const btnRight = btnLeft + button.offsetWidth;
    if (btnLeft >= curScroll + 10 && btnRight <= curScroll + contWidth - 10) {
        return;
    }

    // 버튼이 가려져 있는 경우만 부드럽게 중심 정렬
    const targetScrollLeft = btnLeft - (contWidth / 2) + (button.offsetWidth / 2);
    container.scrollTo({
        left: Math.max(0, targetScrollLeft),
        behavior: smooth ? 'smooth' : 'auto'
    });
}

// 9. 2단 서브탭 바 동적 렌더링
function renderSubTabs(tabId, activeSubId = null) {
    const nav = document.getElementById('adminSubtabsNav');
    if (!nav) return;
    const subs = SUBTABS_CONFIG[tabId] || [];
    const targetId = (activeSubId && activeSubId !== 'all') ? activeSubId : (subs[0] ? subs[0].id : '');

    nav.innerHTML = subs.map(sub => {
        if (sub.isModal) {
            return `
                <button type="button" class="admin-subtab-btn" onclick="openAdminPasswordModal()">
                    <span>${sub.icon}</span> <span>${sub.label}</span>
                </button>
            `;
        }
        const isActive = (sub.id === targetId);
        return `
            <button type="button" class="admin-subtab-btn ${isActive ? 'active' : ''}" data-sub="${sub.id}" onclick="switchAdminSubTab('${sub.id}', this, true)">
                <span>${sub.icon}</span> <span>${sub.label}</span>
            </button>
        `;
    }).join('');

    // 🧲 2단 서브탭 렌더링 직후 활성 서브탭 자석 중앙 정렬
    setTimeout(() => {
        const activeSubBtn = nav.querySelector('.admin-subtab-btn.active');
        if (activeSubBtn) {
            scrollTabIntoCenter(nav, activeSubBtn, true);
        }
    }, 40);
}

// 9-1. 관리자 페이지 상단 스크롤 헬퍼 (모바일/PC 지원)
function scrollAdminToTop(smooth = true) {
    try {
        window.scrollTo({
            top: 0,
            left: 0,
            behavior: smooth ? 'smooth' : 'auto'
        });
    } catch (e) {
        window.scrollTo(0, 0);
    }
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
}

// 10. 서브 창(카드 패널) 전환 핸들러
function switchAdminSubTab(subId, btn, shouldScroll = false, slideDirection = null) {
    if (shouldScroll) {
        scrollAdminToTop(true);
    }
    const subs = SUBTABS_CONFIG[currentAdminTab] || [];
    if (!subId || subId === 'all' || !subs.some(s => s.id === subId)) {
        subId = subs[0] ? subs[0].id : '';
    }
    currentAdminSub = subId;
    const currentPane = document.getElementById(currentAdminTab);
    if (!currentPane) return;

    const subPanes = currentPane.querySelectorAll('.admin-sub-pane');
    subPanes.forEach(pane => {
        pane.classList.remove('slide-from-right', 'slide-from-left');
        if (pane.id === subId) {
            pane.classList.remove('hidden-pane');
            if (slideDirection === 'right') {
                void pane.offsetWidth;
                pane.classList.add('slide-from-right');
            } else if (slideDirection === 'left') {
                void pane.offsetWidth;
                pane.classList.add('slide-from-left');
            }
        } else {
            pane.classList.add('hidden-pane');
        }
    });

    // 💻 로그 서브패널 전환 시 최신 로그(최하단) 자동 스크롤 보정
    if (subId === 'subpane-overview-logs' && typeof window.scrollPm2LogsToBottom === 'function') {
        setTimeout(window.scrollPm2LogsToBottom, 60);
    }

    // 상단 서브탭 버튼 active 갱신 및 🧲 서브탭 자석 스크롤 효과 (중앙 정렬)
    const subNav = document.getElementById('adminSubtabsNav');
    document.querySelectorAll('.admin-subtab-btn').forEach(b => {
        if (b.getAttribute('data-sub') === subId) {
            b.classList.add('active');
            if (subNav) scrollTabIntoCenter(subNav, b, true);
        } else {
            b.classList.remove('active');
        }
    });

    // 사이드바 서브링크 active 갱신
    document.querySelectorAll('.admin-sidebar-sublink').forEach(link => {
        const linkTab = link.getAttribute('data-tab');
        const linkSub = link.getAttribute('data-sub');
        if (linkTab === currentAdminTab && linkSub === subId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // URL 해시 갱신 (명시적 해시가 있을 때만 갱신)
    if (history.replaceState && window.location.hash) {
        history.replaceState(null, '', `#${currentAdminTab}:${subId}`);
    }

    // 마지막 선택 서브탭 저장
    try {
        localStorage.setItem('admin_last_sub', subId);
    } catch (e) {}
}

// 사이드바에서 대메뉴 & 서브메뉴 동시 전환
function switchAdminTabAndSub(tabId, subId) {
    switchAdminTab(tabId, null, subId, true);
    toggleAdminSidebar(false);
    scrollAdminToTop(true);
}

function switchAdminTabAndClose(tabId) {
    switchAdminTab(tabId, null, null, true);
    toggleAdminSidebar(false);
    scrollAdminToTop(true);
}

// 11. 모바일 하단 내비게이션 바 활성 탭 동기화
function updateBottomNavActive(tabId) {
    document.querySelectorAll('.admin-bottom-nav-item').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// 12. 대메뉴 탭 전환 핸들러
function switchAdminTab(tabId, btn, targetSubId = null, shouldScroll = true) {
    const pane = document.getElementById(tabId);
    if (!pane) return;

    if (shouldScroll) {
        scrollAdminToTop(true);
    }

    const subs = SUBTABS_CONFIG[tabId] || [];
    const validTargetSubId = targetSubId && targetSubId !== 'all' 
        ? targetSubId 
        : (subs[0] ? subs[0].id : 'all');

    currentAdminTab = tabId;
    currentAdminSub = validTargetSubId;

    // 마지막 선택 대메뉴 탭 저장 (자동 오버뷰 강제 초기화 방지)
    try {
        localStorage.setItem('admin_last_tab', tabId);
        localStorage.setItem('admin_last_sub', validTargetSubId);
    } catch (e) {}

    // 본문 탭 패널 전환
    document.querySelectorAll('.admin-tab-pane').forEach(el => el.classList.remove('active'));
    pane.classList.add('active');

    // 1단 상단 탭 버튼 active 전환 및 🧲 대메뉴 탭 자석 스크롤 효과 (중앙 정렬)
    document.querySelectorAll('.admin-tab-btn').forEach(el => el.classList.remove('active'));
    const activeBtn = btn || document.querySelector(`.admin-tab-btn[data-tab="${tabId}"]`) || document.querySelector(`.admin-tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        const mainNav = document.getElementById('adminTabsNav');
        if (mainNav) scrollTabIntoCenter(mainNav, activeBtn, true);
    }

    // 모바일 하단 내비게이션 바 동기화
    updateBottomNavActive(tabId);

    // 2단 서브탭 렌더링 및 해당 서브메뉴 활성화
    renderSubTabs(tabId, validTargetSubId);
    switchAdminSubTab(validTargetSubId);

    // 사이드바 아코디언 동기화
    const groupKey = tabId.replace('tab-', '');
    document.querySelectorAll('.admin-sidebar-group').forEach(grp => {
        if (grp.id === `sidebar-group-${groupKey}`) {
            grp.classList.add('expanded');
            const parentBtn = grp.querySelector('.admin-sidebar-parent');
            if (parentBtn) parentBtn.classList.add('active');
        } else {
            const parentBtn = grp.querySelector('.admin-sidebar-parent');
            if (parentBtn) parentBtn.classList.remove('active');
        }
    });

    // 데이터 로드 디스패치
    if (tabId === 'tab-overview') {
        if (typeof window.loadOverviewData === 'function') window.loadOverviewData();
        if (typeof window.fetchPm2Logs === 'function') window.fetchPm2Logs();
    } else if (tabId === 'tab-blood') {
        if (typeof window.loadBloodData === 'function') window.loadBloodData();
        if (typeof window.fetchBloodConfigs === 'function') window.fetchBloodConfigs();
    } else if (tabId === 'tab-asset') {
        if (typeof window.loadAssetData === 'function') window.loadAssetData();
    } else if (tabId === 'tab-news') {
        if (typeof window.loadNewsData === 'function') window.loadNewsData();
        if (typeof window.loadNewsLogs === 'function') window.loadNewsLogs();
        if (typeof window.fetchNewsFileLogs === 'function') window.fetchNewsFileLogs();
    } else if (tabId === 'tab-album') {
        if (typeof window.loadAlbumAdminStats === 'function') window.loadAlbumAdminStats();
        if (typeof window.loadAlbumAdminPhotos === 'function') window.loadAlbumAdminPhotos();
        if (typeof window.loadAlbumAdminMembers === 'function') window.loadAlbumAdminMembers();
    } else if (tabId === 'tab-backup') {
        if (typeof window.loadBackupAdminStatus === 'function') window.loadBackupAdminStatus();
        if (typeof window.loadBackupAdminLogs === 'function') window.loadBackupAdminLogs();
    } else if (tabId === 'tab-database') {
        if (typeof window.initDbManager === 'function') window.initDbManager();
    } else if (tabId === 'tab-security') {
        if (typeof window.loadSecurityLogs === 'function') window.loadSecurityLogs();
    }
}

// 14. URL 해시 기반 탭 전환 (명시적 해시가 있을 때만 동작)
function handleHashTab() {
    const rawHash = (window.location.hash || '').substring(1);
    if (!rawHash) return false;

    const [targetTab, targetSub] = rawHash.split(':');
    if (targetTab && document.getElementById(targetTab)) {
        switchAdminTab(targetTab, null, targetSub && targetSub !== 'all' ? targetSub : null, false);
        return true;
    }
    return false;
}

// 전역 window 바인딩
window.toggleAdminSidebar = toggleAdminSidebar;
window.toggleSidebarGroup = toggleSidebarGroup;
window.renderSubTabs = renderSubTabs;
window.scrollAdminToTop = scrollAdminToTop;
window.switchAdminSubTab = switchAdminSubTab;
window.switchAdminTabAndSub = switchAdminTabAndSub;
window.switchAdminTabAndClose = switchAdminTabAndClose;
window.updateBottomNavActive = updateBottomNavActive;
window.switchAdminTab = switchAdminTab;
window.handleHashTab = handleHashTab;

// 15. 이벤트 리스너 등록
window.addEventListener('hashchange', handleHashTab);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('adminPasswordModal');
        if (modal && modal.style.display === 'flex') {
            closeAdminPasswordModal();
        } else {
            toggleAdminSidebar(false);
        }
    }
});


// 17. 초기 로드: 명시적 해시 -> 마지막 저장된 탭 -> 기본 서버 모니터링 순으로 복원
document.addEventListener('DOMContentLoaded', () => {
    const switchedByHash = handleHashTab();
    if (!switchedByHash) {
        let initialTab = 'tab-overview';
        let initialSub = null;
        try {
            const savedTab = localStorage.getItem('admin_last_tab');
            const savedSub = localStorage.getItem('admin_last_sub');
            if (savedTab && document.getElementById(savedTab)) {
                initialTab = savedTab;
            }
            if (savedSub && savedSub !== 'all') {
                initialSub = savedSub;
            }
        } catch (e) {}
        switchAdminTab(initialTab, null, initialSub, false);
    }

    // 이전에 선택했던 서버 탭(주 서버 / 보조 서버) 복원
    try {
        const savedServer = localStorage.getItem('admin_selected_server_tab');
        if (savedServer === 'secondary' && typeof window.switchServerTab === 'function') {
            window.switchServerTab('secondary');
        }
    } catch (e) {}

    if (typeof window.startOverviewPolling === 'function') {
        window.startOverviewPolling();
    }

    // 📱 서브메뉴 좌우 스와이프 제스처 활성화
    initAdminSwipeGestures();

    // 🧲 초기 진입 시 활성 대메뉴 탭 및 서브탭 자석 중앙 정렬
    setTimeout(() => {
        const activeTab = document.querySelector('.admin-tab-btn.active');
        const mainNav = document.getElementById('adminTabsNav');
        if (activeTab && mainNav) {
            scrollTabIntoCenter(mainNav, activeTab, false);
        }
        const activeSub = document.querySelector('.admin-subtab-btn.active');
        const subNav = document.getElementById('adminSubtabsNav');
        if (activeSub && subNav) {
            scrollTabIntoCenter(subNav, activeSub, false);
        }
    }, 100);

    adjustTickerPosition();
    setTimeout(adjustTickerPosition, 300);
    setTimeout(adjustTickerPosition, 1000);
});


