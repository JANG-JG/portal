/**
 * JG Portal 통합 관리자 센터 - 유틸리티, 비밀번호 모달 & UI 제스처 모듈
 * admin-utils.js
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

// 5. 🔑 관리자 마스터 비밀번호 모달 제어
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

// 6. 관리자 비밀번호 변경 API 호출
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

// 7. 관리자 페이지 전용: 하단 뉴스 티커 & 긴급 속보 배너 숨김 처리
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

// 8. 📱 서브메뉴 내 좌우 터치 스와이프 제스처 핸들러
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
        if (target.closest('.admin-table-container, .table-responsive, .pm2-console, .admin-nav-sticky-wrapper, .admin-sidebar, .admin-modal-backdrop, pre, code, input, textarea, select, canvas, #uplotPrimary, #secUplot')) {
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
            if (typeof SUBTABS_CONFIG === 'undefined' || typeof currentAdminTab === 'undefined') return;
            const subs = (SUBTABS_CONFIG[currentAdminTab] || []).filter(s => !s.isModal);
            if (subs.length <= 1) return;

            const currIdx = subs.findIndex(s => s.id === currentAdminSub);
            if (currIdx === -1) return;

            if (diffX < 0) {
                // 👈 왼쪽으로 스와이프: 다음 서브탭으로 이동 (우측에서 슬라이드 진입)
                if (currIdx < subs.length - 1) {
                    const nextSub = subs[currIdx + 1];
                    if (typeof window.switchAdminSubTab === 'function') {
                        window.switchAdminSubTab(nextSub.id, null, false, 'right');
                    }
                }
            } else {
                // 👉 오른쪽으로 스와이프: 이전 서브탭으로 이동 (좌측에서 슬라이드 진입)
                if (currIdx > 0) {
                    const prevSub = subs[currIdx - 1];
                    if (typeof window.switchAdminSubTab === 'function') {
                        window.switchAdminSubTab(prevSub.id, null, false, 'left');
                    }
                }
            }
        }
    }, { passive: true });
}

// 전역 window 바인딩
window.showToast = showToast;
window.escapeHtml = escapeHtml;
window.stripAnsi = stripAnsi;
window.copyText = copyText;
window.fallbackCopyText = fallbackCopyText;
window.openAdminPasswordModal = openAdminPasswordModal;
window.closeAdminPasswordModal = closeAdminPasswordModal;
window.handlePasswordModalBackdropClick = handlePasswordModalBackdropClick;
window.changeAdminPassword = changeAdminPassword;
window.adjustTickerPosition = adjustTickerPosition;
window.initAdminSwipeGestures = initAdminSwipeGestures;

window.addEventListener('resize', adjustTickerPosition);
window.addEventListener('load', adjustTickerPosition);

// 동적 티커 마운트 감지용 MutationObserver
if (typeof MutationObserver !== 'undefined') {
    const tickerObserver = new MutationObserver(() => {
        adjustTickerPosition();
    });
    if (document.body) {
        tickerObserver.observe(document.body, { childList: true });
    }
}
