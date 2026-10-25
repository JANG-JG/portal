// ==============================================================================
// 🪟 JG 포털 팝업 & 모달 제어 엔진 (portal-modals.js)
// - 혈압 판정 기준표 모달 제어
// - 9-dot 패밀리 서비스 런처 토글
// - 통합 퀵 검색(Ctrl+K) 모달
// - PWA 설치 제어
// ==============================================================================

// 🔒 0. 모달 오픈 시 배경 스크롤 완전 차단 헬퍼 (모바일 html + body 동시 잠금)
function lockBodyScroll() {
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
}
window.lockBodyScroll = lockBodyScroll;

function unlockBodyScroll() {
    const bpOpen = document.getElementById('bpGuideModal')?.classList.contains('active');
    const qsOpen = document.getElementById('qsModalBackdrop')?.classList.contains('active');
    const notifOpen = document.getElementById('notificationModal')?.classList.contains('open');
    const logoutOpen = document.getElementById('logoutModal')?.classList.contains('active') || document.getElementById('logoutModal')?.classList.contains('open');
    if (bpOpen || qsOpen || notifOpen || logoutOpen) return;
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
}
window.unlockBodyScroll = unlockBodyScroll;

// 모바일 터치 스크롤 배경 전파 차단 (모달 내부 스크롤 영역만 허용)
document.addEventListener('touchmove', (e) => {
    if (!document.body.classList.contains('modal-open')) return;
    const scrollable = e.target.closest('.bp-modal-body, .qs-body, .qs-tabs, .notif-modal-scroll, .notif-category-bar');
    if (!scrollable) {
        e.preventDefault();
    }
}, { passive: false });

// 🩸 1. 대한고혈압학회 판정 기준표 모달
function openBpGuideModal() {
    const modal = document.getElementById('bpGuideModal');
    if (modal) {
        modal.classList.add('active');
        modal.style.setProperty('display', 'flex', 'important');
        lockBodyScroll();
    }
}

function closeBpGuideModal() {
    const modal = document.getElementById('bpGuideModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.setProperty('display', 'none', 'important');
        unlockBodyScroll();
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
        modal.classList.add('open');
        modal.style.setProperty('display', 'flex', 'important');
        const input = document.getElementById('qsInput');
        if (input) {
            setTimeout(() => {
                input.focus();
                input.select();
            }, 60);
        }
        lockBodyScroll();
    }
}

function closeQuickSearchModal() {
    const modal = document.getElementById('qsModalBackdrop') || document.getElementById('quickSearchModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('open');
        modal.style.setProperty('display', 'none', 'important');
        unlockBodyScroll();
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
        closeLogoutModal();
        const notifModal = document.getElementById('notificationModal');
        if (notifModal && notifModal.style.display !== 'none') {
            notifModal.classList.remove('open');
            notifModal.style.display = 'none';
            unlockBodyScroll();
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

// 🚪 5. 로그아웃 확인 모달 제어
function openLogoutModal(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const modal = document.getElementById('logoutModal');
    if (modal) {
        if (modal.classList.contains('active')) return;
        modal.classList.add('active');
        modal.classList.add('open');
        modal.style.display = 'flex';
        lockBodyScroll();
    }
}
window.openLogoutModal = openLogoutModal;

function closeLogoutModal() {
    const modal = document.getElementById('logoutModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('open');
        modal.style.display = 'none';
        unlockBodyScroll();
    }
}
window.closeLogoutModal = closeLogoutModal;

function executeLogout() {
    const confirmBtn = document.getElementById('btnConfirmLogout');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '로그아웃 중...';
    }
    window.location.href = '/logout';
}
window.executeLogout = executeLogout;

// 네비게이션 로그아웃 버튼 이벤트 바인딩
function initLogoutButton() {
    const logoutBtn = document.getElementById('btnNavLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLogoutModal(e);
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogoutButton);
} else {
    initLogoutButton();
}

// 🌤️ 5. 날씨 지역 설정 모달 제어
let currentSelectedWeatherCity = 'Seoul';

function openWeatherCityModal(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const modal = document.getElementById('weatherCityModal');
    if (!modal) return;

    modal.style.display = 'flex';
    lockBodyScroll();

    const grid = document.getElementById('weatherCityGrid');
    if (grid) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 20px 0;">지역 목록을 불러오는 중...</div>';
    }

    fetch('/api/portal/user/weather-city')
        .then(res => res.json())
        .then(data => {
            if (data && data.success) {
                currentSelectedWeatherCity = data.current_city || 'Seoul';
                renderWeatherCityGrid(currentSelectedWeatherCity, data.cities || []);
            }
        })
        .catch(() => {
            if (grid) {
                grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 20px 0;">지역 목록을 불러오지 못했습니다.</div>';
            }
        });
}
window.openWeatherCityModal = openWeatherCityModal;

function closeWeatherCityModal() {
    const modal = document.getElementById('weatherCityModal');
    if (modal) {
        modal.style.display = 'none';
        unlockBodyScroll();
    }
}
window.closeWeatherCityModal = closeWeatherCityModal;

function renderWeatherCityGrid(currentCity, cities) {
    const grid = document.getElementById('weatherCityGrid');
    if (!grid) return;

    grid.innerHTML = '';
    cities.forEach(c => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'weather-city-item' + (c.code === currentCity ? ' active' : '');
        item.textContent = c.name;
        item.title = `${c.name} (${c.code})`;
        item.onclick = () => selectWeatherCity(c.code, item);
        grid.appendChild(item);
    });
}

function selectWeatherCity(cityCode, buttonEl) {
    const grid = document.getElementById('weatherCityGrid');
    if (grid) {
        const allItems = grid.querySelectorAll('.weather-city-item');
        allItems.forEach(el => el.classList.remove('active'));
    }
    if (buttonEl) buttonEl.classList.add('active');

    fetch('/api/portal/user/weather-city', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ city: cityCode })
    })
    .then(res => res.json())
    .then(data => {
        if (data && data.success) {
            currentSelectedWeatherCity = cityCode;
            if (data.weather && typeof window.updateWeatherBadge === 'function') {
                window.updateWeatherBadge(data.weather);
            }
            setTimeout(() => {
                closeWeatherCityModal();
            }, 250);
        }
    })
    .catch(err => {
        console.error('날씨 지역 변경 실패:', err);
    });
}
window.selectWeatherCity = selectWeatherCity;


