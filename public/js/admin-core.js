/**
 * JG Portal 통합 관리자 센터 - 코어 유틸 & 내비게이션 모듈
 * admin-core.js
 */

// 1. 토스트 알림 표시
function showToast(msg, isError = false) {
    const toast = document.getElementById('adminToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.background = isError ? '#dc2626' : '#0f172a';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);
}

// 2. HTML 특수문자 이스케이프 유틸리티
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// 3. 터미널 ANSI 색상 이스케이프 코드 제거 유틸리티
function stripAnsi(str) {
    if (!str) return '';
    return String(str).replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// 4. 텍스트 클립보드 원클릭 복사 유틸리티
function copyText(text, msg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(msg || '클립보드에 복사되었습니다.');
        }).catch(() => {
            fallbackCopyText(text, msg);
        });
    } else {
        fallbackCopyText(text, msg);
    }
}

function fallbackCopyText(text, msg) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(msg || '클립보드에 복사되었습니다.');
    } catch (e) {
        showToast('클립보드 복사 실패: ' + e.message, true);
    }
}

// 5. 🗂️ 대메뉴별 서브메뉴(창) 설정 명세 ('전체 보기' 제거 - 개별 서브페이지로 깔끔하게 분리)
const SUBTABS_CONFIG = {
    'tab-overview': [
        { id: 'subpane-overview-processes', label: '프로세스 & 핵심 자원', icon: '🚀' },
        { id: 'subpane-overview-logs', label: '실시간 시스템 로그', icon: '💻' },
        { id: 'subpane-overview-db', label: '서비스 DB 현황', icon: '🗄️' }
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

// 8. 🔑 관리자 마스터 비밀번호 모달 제어
function openAdminPasswordModal() {
    const modal = document.getElementById('adminPasswordModal');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(() => {
        const passInput = document.getElementById('currentPassInput');
        if (passInput) passInput.focus();
    }, 50);
}

function closeAdminPasswordModal() {
    const modal = document.getElementById('adminPasswordModal');
    if (!modal) return;
    modal.style.display = 'none';
    const c = document.getElementById('currentPassInput');
    const n = document.getElementById('newPassInput');
    const f = document.getElementById('confirmPassInput');
    if (c) c.value = '';
    if (n) n.value = '';
    if (f) f.value = '';
}

function handlePasswordModalBackdropClick(e) {
    if (e.target && e.target.id === 'adminPasswordModal') {
        closeAdminPasswordModal();
    }
}

// 9-0. 🧲 탭/서브탭 캡슐 버튼 컨테이너 내부 안전 자석 중앙 정렬 헬퍼
function scrollTabIntoCenter(container, button, smooth = true) {
    if (!container || !button) return;
    
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
    // 중간 버튼이면 컨테이너 중심에 정확히 자석 스냅
    const containerWidth = container.clientWidth;
    const buttonLeft = button.offsetLeft;
    const buttonWidth = button.offsetWidth;
    const targetScrollLeft = buttonLeft - (containerWidth / 2) + (buttonWidth / 2);

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
    } else if (tabId === 'tab-security') {
        if (typeof window.loadSecurityLogs === 'function') window.loadSecurityLogs();
    }
}

// 13. 관리자 비밀번호 변경
async function changeAdminPassword(e) {
    if (e) e.preventDefault();
    const currentPassword = document.getElementById('currentPassInput').value;
    const newPassword = document.getElementById('newPassInput').value;
    const confirmPassword = document.getElementById('confirmPassInput').value;

    if (newPassword !== confirmPassword) {
        return alert('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.');
    }
    if (newPassword.length < 6) {
        return alert('비밀번호는 최소 6자 이상으로 설정해주세요.');
    }

    try {
        const res = await fetch('/api/admin/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message);
            closeAdminPasswordModal();
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast('비밀번호 변경 실패: ' + err.message, true);
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
window.showToast = showToast;
window.escapeHtml = escapeHtml;
window.stripAnsi = stripAnsi;
window.copyText = copyText;
window.fallbackCopyText = fallbackCopyText;
window.toggleAdminSidebar = toggleAdminSidebar;
window.toggleSidebarGroup = toggleSidebarGroup;
window.openAdminPasswordModal = openAdminPasswordModal;
window.closeAdminPasswordModal = closeAdminPasswordModal;
window.handlePasswordModalBackdropClick = handlePasswordModalBackdropClick;
window.renderSubTabs = renderSubTabs;
window.scrollAdminToTop = scrollAdminToTop;
window.switchAdminSubTab = switchAdminSubTab;
window.switchAdminTabAndSub = switchAdminTabAndSub;
window.switchAdminTabAndClose = switchAdminTabAndClose;
window.updateBottomNavActive = updateBottomNavActive;
window.switchAdminTab = switchAdminTab;
window.changeAdminPassword = changeAdminPassword;
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

// 16. 관리자 페이지 전용: 하단 뉴스 티커 & 긴급 속보 배너 숨김 처리
function adjustTickerPosition() {
    const ticker = document.getElementById('jg-global-ticker-bar');
    const breaking = document.getElementById('jg-global-breaking-bar');
    const bottomNav = document.getElementById('adminBottomNav');

    if (ticker) {
        ticker.style.setProperty('display', 'none', 'important');
        ticker.style.setProperty('visibility', 'hidden', 'important');
        ticker.style.setProperty('height', '0px', 'important');
    }
    if (breaking) {
        breaking.style.setProperty('display', 'none', 'important');
        breaking.style.setProperty('visibility', 'hidden', 'important');
        breaking.style.setProperty('height', '0px', 'important');
    }
    if (bottomNav) {
        bottomNav.style.setProperty('display', 'none', 'important');
    }
    document.body.style.setProperty('padding-bottom', '1.5rem', 'important');
}

window.adjustTickerPosition = adjustTickerPosition;
window.addEventListener('resize', adjustTickerPosition);
window.addEventListener('load', adjustTickerPosition);

// 17. 📱 서브메뉴 내 좌우 터치 스와이프 제스처 핸들러
function initAdminSwipeGestures() {
    const mainContainer = document.querySelector('.admin-main-container');
    if (!mainContainer) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isTouchCancelled = false;

    mainContainer.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) {
            isTouchCancelled = true;
            return;
        }

        const target = e.target;
        // 테이블, 터미널 콘솔, 상단 탭바, 모달, 사이드바, 폼 입력, 차트 등 내부 터치는 서브탭 스와이프 제외
        if (target.closest('.admin-table-container, .pm2-console, .admin-nav-sticky-wrapper, .admin-sidebar, .admin-modal-backdrop, pre, code, input, textarea, select, canvas, #uplotPrimary, #secUplot')) {
            isTouchCancelled = true;
            return;
        }

        isTouchCancelled = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
    }, { passive: true });

    mainContainer.addEventListener('touchend', (e) => {
        if (isTouchCancelled || !e.changedTouches || e.changedTouches.length === 0) return;

        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = endX - touchStartX;
        const diffY = endY - touchStartY;
        const elapsed = Date.now() - touchStartTime;

        // 600ms 이내의 제스처, 최소 45px 이동, 세로 스크롤보다 1.4배 이상 가로 지배적인 경우만 스와이프
        if (elapsed < 600 && Math.abs(diffX) >= 45 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
            const subs = (SUBTABS_CONFIG[currentAdminTab] || []).filter(s => !s.isModal);
            if (subs.length <= 1) return;

            const currIdx = subs.findIndex(s => s.id === currentAdminSub);
            if (currIdx === -1) return;

            if (diffX < 0) {
                // 👈 왼쪽으로 스와이프: 다음 서브탭으로 이동 (우측에서 슬라이드 진입)
                if (currIdx < subs.length - 1) {
                    const nextSub = subs[currIdx + 1];
                    switchAdminSubTab(nextSub.id, null, false, 'right');
                }
            } else {
                // 👉 오른쪽으로 스와이프: 이전 서브탭으로 이동 (좌측에서 슬라이드 진입)
                if (currIdx > 0) {
                    const prevSub = subs[currIdx - 1];
                    switchAdminSubTab(prevSub.id, null, false, 'left');
                }
            }
        }
    }, { passive: true });
}

window.initAdminSwipeGestures = initAdminSwipeGestures;

// 초기 로드: 명시적 해시 -> 마지막 저장된 탭 -> 기본 서버 모니터링 순으로 복원
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

// 동적 티커 마운트 감지용 MutationObserver
if (typeof MutationObserver !== 'undefined') {
    const tickerObserver = new MutationObserver(() => {
        adjustTickerPosition();
    });
    if (document.body) {
        tickerObserver.observe(document.body, { childList: true });
    }
}


