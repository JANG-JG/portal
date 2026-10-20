// ==============================================================================
// 🪟 JG 포털 팝업 & 모달 제어 엔진 (portal-modals.js)
// - 혈압 판정 기준표 모달 제어
// - 9-dot 패밀리 서비스 런처 토글
// - 통합 퀵 검색(Ctrl+K) 모달
// - PWA 설치 제어
// ==============================================================================

// 🩸 1. 대한고혈압학회 판정 기준표 모달
function openBpGuideModal() {
    const modal = document.getElementById('bpGuideModal');
    if (modal) {
        modal.classList.add('active');
        modal.style.setProperty('display', 'flex', 'important');
        document.body.style.overflow = 'hidden';
    }
}

function closeBpGuideModal() {
    const modal = document.getElementById('bpGuideModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.setProperty('display', 'none', 'important');
        document.body.style.overflow = '';
    }
}

// ⊞ 2. 9-dot 패밀리 서비스 런처 토글
function toggleAppLauncher() {
    const menu = document.getElementById('cmdLauncherMenu');
    if (menu) {
        const isHidden = (menu.style.display === 'none' || !menu.style.display);
        menu.style.display = isHidden ? 'block' : 'none';
    }
}

document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.cmd-launcher-wrap');
    const menu = document.getElementById('cmdLauncherMenu');
    if (wrap && menu && !wrap.contains(e.target)) {
        menu.style.display = 'none';
    }
});

// 🔍 3. 통합 퀵 검색 모달 (Ctrl+K)
function openQuickSearchModal() {
    const modal = document.getElementById('qsModalBackdrop') || document.getElementById('quickSearchModal');
    if (modal) {
        modal.classList.add('active');
        modal.style.setProperty('display', 'flex', 'important');
        const input = document.getElementById('qsInput');
        if (input) {
            setTimeout(() => input.focus(), 100);
        }
        document.body.style.overflow = 'hidden';
    }
}

function closeQuickSearchModal() {
    const modal = document.getElementById('qsModalBackdrop') || document.getElementById('quickSearchModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.setProperty('display', 'none', 'important');
        document.body.style.overflow = '';
    }
}

// 단축키 Ctrl+K 감지
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const modal = document.getElementById('qsModalBackdrop') || document.getElementById('quickSearchModal');
        if (modal && (modal.classList.contains('active') || modal.style.display === 'flex')) {
            closeQuickSearchModal();
        } else {
            openQuickSearchModal();
        }
    } else if (e.key === 'Escape') {
        closeBpGuideModal();
        closeQuickSearchModal();
        const notifModal = document.getElementById('notificationModal');
        if (notifModal && notifModal.style.display !== 'none') {
            notifModal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }
});

// 📲 4. PWA 설치 프롬프트
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btnPwaInstall');
    if (btn) btn.style.display = 'inline-flex';
});

function triggerPwaInstall() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(() => {
            deferredInstallPrompt = null;
        });
    } else {
        alert('브라우저 설정(⋮)에서 [앱 설치] 또는 [홈 화면에 추가]를 눌러 바로 설치할 수 있습니다. 📲');
    }
}
