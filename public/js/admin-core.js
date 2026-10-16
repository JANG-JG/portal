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

// 5. 🗂️ 대메뉴별 서브메뉴(창) 설정 명세
const SUBTABS_CONFIG = {
    'tab-overview': [
        { id: 'all', label: '전체 보기', icon: '📋' },
        { id: 'subpane-overview-processes', label: '프로세스 & 핵심 자원', icon: '🚀' },
        { id: 'subpane-overview-logs', label: '실시간 시스템 로그', icon: '💻' },
        { id: 'subpane-overview-db', label: '서비스 DB 현황', icon: '🗄️' }
    ],
    'tab-blood': [
        { id: 'all', label: '전체 보기', icon: '📋' },
        { id: 'subpane-blood-backup', label: '데이터 백업 & CSV 복구', icon: '💾' },
        { id: 'subpane-blood-threshold', label: '위험 기준치 설정', icon: '⚙️' },
        { id: 'subpane-blood-records', label: '최근 혈압 측정 기록', icon: '🩸' }
    ],
    'tab-asset': [
        { id: 'all', label: '전체 보기', icon: '📋' },
        { id: 'subpane-asset-summary', label: '포트폴리오 & 백업', icon: '📊' },
        { id: 'subpane-asset-accounts', label: '증권 계좌별 현황', icon: '📂' },
        { id: 'subpane-asset-holdings', label: '보유 종목 상세', icon: '💼' }
    ],
    'tab-news': [
        { id: 'all', label: '전체 보기', icon: '📋' },
        { id: 'subpane-news-collect', label: '즉시 수집 & DB현황', icon: '🚀' },
        { id: 'subpane-news-articles', label: '최근 수집 기사 (10선)', icon: '📑' },
        { id: 'subpane-news-history', label: '수집 이력 & 로그 콘솔', icon: '📋' }
    ],
    'tab-security': [
        { id: 'all', label: '전체 보기', icon: '📋' },
        { id: 'action-password-modal', label: '마스터 비밀번호 변경 (팝업)', icon: '🔑', isModal: true },
        { id: 'subpane-security-logs', label: '최근 로그인 시도 이력', icon: '🔒' },
        { id: 'subpane-security-stack', label: 'SSO & 기술 스택 명세', icon: '🛡️' }
    ]
};

let currentAdminTab = 'tab-overview';
let currentAdminSub = 'all';

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

// 9. 2단 서브탭 바 동적 렌더링
function renderSubTabs(tabId, activeSubId = 'all') {
    const nav = document.getElementById('adminSubtabsNav');
    if (!nav) return;
    const subs = SUBTABS_CONFIG[tabId] || [];

    nav.innerHTML = subs.map(sub => {
        if (sub.isModal) {
            return `
                <button type="button" class="admin-subtab-btn" onclick="openAdminPasswordModal()">
                    <span>${sub.icon}</span> <span>${sub.label}</span>
                </button>
            `;
        }
        const isActive = (sub.id === activeSubId);
        return `
            <button type="button" class="admin-subtab-btn ${isActive ? 'active' : ''}" data-sub="${sub.id}" onclick="switchAdminSubTab('${sub.id}', this)">
                <span>${sub.icon}</span> <span>${sub.label}</span>
            </button>
        `;
    }).join('');
}

// 10. 서브 창(카드 패널) 전환 핸들러
function switchAdminSubTab(subId, btn) {
    currentAdminSub = subId;
    const currentPane = document.getElementById(currentAdminTab);
    if (!currentPane) return;

    const subPanes = currentPane.querySelectorAll('.admin-sub-pane');
    if (subId === 'all') {
        subPanes.forEach(pane => pane.classList.remove('hidden-pane'));
    } else {
        subPanes.forEach(pane => {
            if (pane.id === subId) {
                pane.classList.remove('hidden-pane');
            } else {
                pane.classList.add('hidden-pane');
            }
        });
    }

    // 상단 서브탭 버튼 active 갱신
    document.querySelectorAll('.admin-subtab-btn').forEach(b => {
        if (b.getAttribute('data-sub') === subId) {
            b.classList.add('active');
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

    // URL 해시 갱신
    if (history.replaceState) {
        const hashVal = subId === 'all' ? `#${currentAdminTab}` : `#${currentAdminTab}:${subId}`;
        history.replaceState(null, '', hashVal);
    }
}

// 사이드바에서 대메뉴 & 서브메뉴 동시 전환
function switchAdminTabAndSub(tabId, subId) {
    switchAdminTab(tabId, null, subId);
    toggleAdminSidebar(false);
}

function switchAdminTabAndClose(tabId) {
    switchAdminTab(tabId, null, 'all');
    toggleAdminSidebar(false);
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
function switchAdminTab(tabId, btn, targetSubId = 'all') {
    const pane = document.getElementById(tabId);
    if (!pane) return;

    currentAdminTab = tabId;
    currentAdminSub = targetSubId;

    // 본문 탭 패널 전환
    document.querySelectorAll('.admin-tab-pane').forEach(el => el.classList.remove('active'));
    pane.classList.add('active');

    // 1단 상단 탭 버튼 active 전환
    document.querySelectorAll('.admin-tab-btn').forEach(el => el.classList.remove('active'));
    const activeBtn = btn || document.querySelector(`.admin-tab-btn[data-tab="${tabId}"]`) || document.querySelector(`.admin-tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // 모바일 하단 내비게이션 바 동기화
    updateBottomNavActive(tabId);

    // 2단 서브탭 렌더링 및 해당 서브메뉴 활성화
    renderSubTabs(tabId, targetSubId);
    switchAdminSubTab(targetSubId);

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

// 14. URL 해시 기반 자동 탭 및 서브탭 전환
function handleHashTab() {
    const rawHash = (window.location.hash || '').substring(1);
    if (!rawHash) return false;

    const [targetTab, targetSub] = rawHash.split(':');
    if (targetTab && document.getElementById(targetTab)) {
        switchAdminTab(targetTab, null, targetSub || 'all');
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

// 16. 모바일 하단 내비게이션 & 뉴스 티커 겹침 방지 동적 보정
function adjustTickerPosition() {
    const isMobile = window.innerWidth <= 768;
    const ticker = document.getElementById('jg-global-ticker-bar');
    const breaking = document.getElementById('jg-global-breaking-bar');
    const bottomNav = document.getElementById('adminBottomNav');

    if (!bottomNav) return;

    if (isMobile) {
        if (ticker) {
            ticker.style.setProperty('bottom', '56px', 'important');
            ticker.style.setProperty('z-index', '999990', 'important');
        }
        if (breaking) {
            breaking.style.setProperty('bottom', '114px', 'important');
            breaking.style.setProperty('z-index', '999991', 'important');
        }
        bottomNav.style.setProperty('bottom', '0px', 'important');
        bottomNav.style.setProperty('z-index', '1000000', 'important');
        document.body.style.setProperty('padding-bottom', '125px', 'important');
    } else {
        if (ticker) {
            ticker.style.setProperty('bottom', '0px', 'important');
        }
        if (breaking) {
            breaking.style.setProperty('bottom', '44px', 'important');
        }
    }
}

window.adjustTickerPosition = adjustTickerPosition;
window.addEventListener('resize', adjustTickerPosition);
window.addEventListener('load', adjustTickerPosition);

// 초기 로드
document.addEventListener('DOMContentLoaded', () => {
    const switchedByHash = handleHashTab();
    if (!switchedByHash) {
        switchAdminTab('tab-overview', null, 'all');
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

