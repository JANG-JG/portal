/**
 * ==============================================================================
 * 우리 가족 간편 입장 & 6자리 PIN 인증 제어기 (login-family.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 자연스러운 일상 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수 (약 430줄)
 * [규칙 6] 모바일 터치(360px) 최적화 핀패드 및 가상 키패드 지원
 * ==============================================================================
 */

(function () {
    'use strict';

    let currentMember = null;
    let currentTempToken = null;
    let isSubmitting = false;

    // DOM 요소 참조
    const familyPickerView = document.getElementById('familyPickerView');
    const familyPinView = document.getElementById('familyPinView');
    const familyChipsContainer = document.getElementById('familyChipsContainer');
    const selectedMemberEmoji = document.getElementById('selectedMemberEmoji');
    const selectedMemberName = document.getElementById('selectedMemberName');
    const familyPinHiddenInput = document.getElementById('familyPinHiddenInput');
    const pinDotsWrap = document.getElementById('pinDotsWrap');
    const familyErrorMsg = document.getElementById('familyErrorMessage');
    const pinChangeModal = document.getElementById('pinChangeModal');
    const pinChangeError = document.getElementById('pinChangeError');
    const btnSubmitNewPin = document.getElementById('btnSubmitNewPin');

    // 1. 모드 전환 (가족 간편 입장 ↔ 아이디 로그인)
    window.switchLoginMode = function (mode) {
        const familySec = document.getElementById('familyLoginSection');
        const adminSec = document.getElementById('adminLoginSection');
        const tabBtnFamily = document.getElementById('tabBtnFamily');
        const tabBtnAdmin = document.getElementById('tabBtnAdmin');
        const loginTitle = document.getElementById('loginTitle');
        const loginSubtitle = document.getElementById('loginSubtitle');

        if (mode === 'admin' || mode === 'id') {
            if (familySec) familySec.style.display = 'none';
            if (adminSec) adminSec.style.display = 'block';
            if (tabBtnFamily) tabBtnFamily.classList.remove('active');
            if (tabBtnAdmin) tabBtnAdmin.classList.add('active');
            if (loginTitle) loginTitle.textContent = 'JG 통합 포털';
            if (loginSubtitle) loginSubtitle.textContent = '아이디와 비밀번호로 안전하게 로그인하세요';
            const usernameInput = document.getElementById('username');
            if (usernameInput) setTimeout(() => usernameInput.focus(), 100);
        } else {
            if (familySec) familySec.style.display = 'block';
            if (adminSec) adminSec.style.display = 'none';
            if (tabBtnFamily) tabBtnFamily.classList.add('active');
            if (tabBtnAdmin) tabBtnAdmin.classList.remove('active');
            if (loginTitle) loginTitle.textContent = '가족 간편입장';
            if (loginSubtitle) loginSubtitle.textContent = '내 프로필을 선택하고 6자리 PIN을 입력하세요';
        }
    };

    // 2. 가족 구성원 목록 비동기 조회 (🛡️ 등록된 가족 기기만 프로필 노출)
    async function loadFamilyMembers() {
        const loginTabs = document.querySelector('.login-tabs');
        const tabBtnFamily = document.getElementById('tabBtnFamily');

        try {
            let deviceToken = null;
            try {
                deviceToken = localStorage.getItem('jg_family_device');
            } catch (e) {}

            const headers = {};
            if (deviceToken) headers['x-family-device'] = deviceToken;

            const urlParams = new URLSearchParams(window.location.search);
            const verifyInvite = urlParams.get('verify_invite');
            if (verifyInvite) headers['x-invite-verify'] = verifyInvite;

            const res = await fetch('/api/auth/family-members', { headers, credentials: 'include' });
            const data = await res.json();

            // 인증된 가족 기기가 아니면 가족 탭을 숨기고 아이디 로그인 화면 유지
            if (!data.hasDevice && !verifyInvite || !data.members || data.members.length === 0) {
                if (loginTabs) loginTabs.style.display = 'none';
                const hasInviteToken = urlParams.get('invite_token') || currentTempToken;
                if (!hasInviteToken) {
                    switchLoginMode('admin');
                    const title = document.getElementById('loginTitle');
                    const sub = document.getElementById('loginSubtitle');
                    if (title) title.textContent = 'JG 통합 포털';
                    if (sub) sub.textContent = '단일 계정으로 모든 서비스를 안전하게 이용하세요';
                }
                return;
            }

            // 인증된 가족 기기 확인: 가족 간편 입장 탭 활성화
            if (loginTabs) loginTabs.style.display = 'flex';
            if (tabBtnFamily) tabBtnFamily.style.display = 'flex';
            switchLoginMode('family');

            if (!familyChipsContainer) return;
            familyChipsContainer.innerHTML = '';
            data.members.forEach(member => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'family-chip';
                btn.innerHTML = `
                    <span class="family-chip-emoji">${member.emoji || '😊'}</span>
                    <span class="family-chip-name">${escapeHtml(member.nickname)}</span>
                `;
                btn.addEventListener('click', () => selectFamilyMember(member));
                familyChipsContainer.appendChild(btn);
            });

            // 해당 가족 기기에 등록된 계정이 1개인 경우 즉시 PIN 패드 활성화
            if (data.members.length === 1) {
                selectFamilyMember(data.members[0]);
                if (verifyInvite) {
                    const sub = document.getElementById('loginSubtitle');
                    if (sub) sub.textContent = '새 기기 등록: 6자리 PIN을 입력해 주세요';
                }
            }
        } catch (err) {
            console.error('가족 기기 인증 확인 실패:', err);
            if (loginTabs) loginTabs.style.display = 'none';
            switchLoginMode('admin');
        }
    }

    // 3. 가족 프로필 선택 처리
    function selectFamilyMember(member) {
        currentMember = member;
        if (selectedMemberEmoji) selectedMemberEmoji.textContent = member.emoji || '😊';
        if (selectedMemberName) selectedMemberName.textContent = member.nickname || member.username;

        if (familyPickerView) familyPickerView.style.display = 'none';
        if (familyPinView) familyPinView.style.display = 'block';
        if (familyErrorMsg) familyErrorMsg.style.display = 'none';

        resetPinInput();
        focusPinInput();
    }

    window.resetFamilySelection = function () {
        currentMember = null;
        if (familyPickerView) familyPickerView.style.display = 'block';
        if (familyPinView) familyPinView.style.display = 'none';
        if (familyErrorMsg) familyErrorMsg.style.display = 'none';
        resetPinInput();
    };

    // 4. PIN 입력 제어 (도트 동기화 & 가상 키패드)
    function resetPinInput() {
        if (familyPinHiddenInput) familyPinHiddenInput.value = '';
        updatePinDots('');
    }

    window.focusPinInput = function () {
        if (familyPinHiddenInput) {
            familyPinHiddenInput.focus();
        }
    };

    function updatePinDots(val) {
        if (!pinDotsWrap) return;
        const dots = pinDotsWrap.querySelectorAll('.pin-dot');
        dots.forEach((dot, idx) => {
            if (idx < val.length) {
                dot.classList.add('filled');
            } else {
                dot.classList.remove('filled');
            }
        });
    }

    function initNumpad() {
        const buttons = document.querySelectorAll('.numpad-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (isSubmitting || !currentMember) return;
                const key = btn.getAttribute('data-key');
                let cur = familyPinHiddenInput ? familyPinHiddenInput.value : '';

                if (key === 'clear') {
                    cur = '';
                } else if (key === 'backspace') {
                    cur = cur.slice(0, -1);
                } else if (/^\d$/.test(key)) {
                    if (cur.length < 6) {
                        cur += key;
                    }
                }

                if (familyPinHiddenInput) familyPinHiddenInput.value = cur;
                updatePinDots(cur);

                if (cur.length === 6) {
                    handleFamilyLogin(cur);
                }
            });
        });

        if (familyPinHiddenInput) {
            familyPinHiddenInput.addEventListener('input', (e) => {
                let clean = e.target.value.replace(/\D/g, '').slice(0, 6);
                e.target.value = clean;
                updatePinDots(clean);
                if (clean.length === 6) {
                    handleFamilyLogin(clean);
                }
            });
        }
    }

    // 5. 가족 PIN 검증 로그인 요청
    async function handleFamilyLogin(pin) {
        if (isSubmitting || !currentMember) return;
        isSubmitting = true;

        if (familyErrorMsg) familyErrorMsg.style.display = 'none';

        try {
            const res = await fetch('/api/auth/family-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentMember.username,
                    pin: pin
                })
            });

            const data = await res.json();

            if (data.success) {
                if (data.deviceToken) {
                    localStorage.setItem('jg_family_device', data.deviceToken);
                }
                if (data.requirePinChange) {
                    openPinChangeModal(data.tempToken, data.username, data.nickname, data.message);
                } else {
                    window.location.href = data.redirect || '/';
                }
            } else {
                if (familyErrorMsg) {
                    familyErrorMsg.textContent = data.message || 'PIN 번호가 올바르지 않습니다.';
                    familyErrorMsg.style.display = 'block';
                }
                resetPinInput();
                focusPinInput();
            }
        } catch (err) {
            console.error('로그인 요청 실패:', err);
            if (familyErrorMsg) {
                familyErrorMsg.textContent = '서버 통신 중 오류가 발생했습니다. 다시 시도해 주세요.';
                familyErrorMsg.style.display = 'block';
            }
            resetPinInput();
        } finally {
            isSubmitting = false;
        }
    }

    // 6. 나만의 6자리 PIN 설정 모달
    window.openPinChangeModal = function (tempToken, username, nickname, desc) {
        currentTempToken = tempToken;
        const modal = document.getElementById('pinChangeModal');
        const titleEl = document.getElementById('pinChangeTitle');
        const descEl = document.getElementById('pinChangeDesc');
        const newPinInput = document.getElementById('newPinInput');
        const confirmPinInput = document.getElementById('confirmPinInput');

        if (titleEl) titleEl.textContent = `${nickname || username || '가족'}님의 6자리 PIN 설정`;
        if (descEl && desc) descEl.textContent = desc;
        if (newPinInput) newPinInput.value = '';
        if (confirmPinInput) confirmPinInput.value = '';
        if (pinChangeError) pinChangeError.style.display = 'none';

        if (modal) modal.style.display = 'flex';
        if (newPinInput) setTimeout(() => newPinInput.focus(), 200);
    }

    async function submitNewPin() {
        const newPin = (document.getElementById('newPinInput')?.value || '').trim();
        const confirmPin = (document.getElementById('confirmPinInput')?.value || '').trim();

        if (!/^\d{6}$/.test(newPin)) {
            showPinChangeError('PIN 번호는 숫자 6자리로 입력해 주세요.');
            return;
        }

        if (newPin !== confirmPin) {
            showPinChangeError('입력하신 두 PIN 번호가 일치하지 않습니다.');
            return;
        }

        if (!currentTempToken) {
            showPinChangeError('인증 세션이 만료되었습니다. 처음부터 다시 시도해 주세요.');
            return;
        }

        if (btnSubmitNewPin) {
            btnSubmitNewPin.disabled = true;
            btnSubmitNewPin.textContent = '저장 중...';
        }

        try {
            const res = await fetch('/api/auth/change-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tempToken: currentTempToken,
                    newPin: newPin
                })
            });

            const data = await res.json();
            if (data.success) {
                if (data.deviceToken) {
                    localStorage.setItem('jg_family_device', data.deviceToken);
                }
                alert(data.message || 'PIN이 안전하게 설정되었습니다! 포털로 입장합니다.');
                window.location.href = data.redirect || '/';
            } else {
                showPinChangeError(data.message || 'PIN 변경에 실패했습니다.');
                if (btnSubmitNewPin) {
                    btnSubmitNewPin.disabled = false;
                    btnSubmitNewPin.textContent = 'PIN 저장 및 입장하기';
                }
            }
        } catch (err) {
            showPinChangeError('서버 연결에 실패했습니다. 다시 시도해 주세요.');
            if (btnSubmitNewPin) {
                btnSubmitNewPin.disabled = false;
                btnSubmitNewPin.textContent = 'PIN 저장 및 입장하기';
            }
        }
    }

    function showPinChangeError(msg) {
        if (pinChangeError) {
            pinChangeError.textContent = msg;
            pinChangeError.style.display = 'block';
        }
    }

    // 7. 기기 간편입장 등록 해제 처리
    window.unlinkFamilyDevice = async function () {
        if (!confirm('이 기기에서 간편 입장을 해제하시겠습니까?\n해제하면 아이디 로그인만 표시되며, 다시 가족 초대 링크를 통해서만 등록할 수 있습니다.')) {
            return;
        }
        try {
            await fetch('/api/auth/unlink-device', { method: 'POST', credentials: 'include' });
        } catch (e) {}
        try { localStorage.removeItem('jg_family_device'); } catch (e) {}
        currentMember = null;
        const loginTabs = document.querySelector('.login-tabs');
        if (loginTabs) loginTabs.style.display = 'none';
        switchLoginMode('admin');
        const title = document.getElementById('loginTitle');
        const sub = document.getElementById('loginSubtitle');
        if (title) title.textContent = 'JG 통합 포털';
        if (sub) sub.textContent = '단일 계정으로 모든 서비스를 안전하게 이용하세요';
        alert('이 기기의 간편 입장이 정상적으로 해제되었습니다.');
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 8. 일반 아이디/비밀번호 로그인 폼 이벤트
    function initAdminLoginForm() {
        const form = document.getElementById('loginForm');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username')?.value.trim();
            const password = document.getElementById('password')?.value;
            const rememberMe = document.getElementById('rememberMe')?.checked;
            const errorEl = document.getElementById('errorMessage');
            const btnSubmit = document.getElementById('btnSubmit');

            if (errorEl) errorEl.style.display = 'none';
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.textContent = '로그인 중...';
            }

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, rememberMe })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = data.redirect || '/';
                } else {
                    if (errorEl) {
                        errorEl.textContent = data.message || '로그인에 실패했습니다.';
                        errorEl.style.display = 'block';
                    }
                    if (btnSubmit) {
                        btnSubmit.disabled = false;
                        btnSubmit.textContent = '로그인';
                    }
                }
            } catch (err) {
                if (errorEl) {
                    errorEl.textContent = '서버 연결에 실패했습니다.';
                    errorEl.style.display = 'block';
                }
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = '로그인';
                }
            }
        });
    }

    // 9. URL 파라미터 처리 및 SSO 로그아웃 동기화
    function handleUrlParameters() {
        const params = new URLSearchParams(window.location.search);
        const legacyInvite = params.get('invite');
        const inviteToken = params.get('invite_token');
        const username = params.get('username');
        const nickname = params.get('nickname');
        const error = params.get('error');

        if (legacyInvite && !inviteToken) {
            window.location.replace(`/invite/${encodeURIComponent(legacyInvite)}`);
            return;
        }

        if (inviteToken) {
            openPinChangeModal(
                inviteToken,
                username,
                nickname,
                `반갑습니다, ${nickname || username || '가족'}님! 앞으로 사용하실 나만의 숫자 6자리 PIN을 설정해 주세요.`
            );
        } else if (error === 'invalid_invite') {
            if (familyErrorMsg) {
                familyErrorMsg.textContent = '유효하지 않거나 만료된 가족 초대 링크입니다.';
                familyErrorMsg.style.display = 'block';
            }
        }
    }

    function syncSingleSignOut() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('logout') === 'success') {
            const subServices = [
                'https://blood.j-jg.cc/logout?local=1',
                'https://asset.j-jg.cc/logout?local=1',
                'https://news.j-jg.cc/logout?local=1'
            ];
            subServices.forEach(url => {
                fetch(url, { credentials: 'include', mode: 'no-cors' }).catch(() => {});
            });
        }
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(err => {
                    console.warn('[PWA] Service Worker registration failed on login:', err);
                });
            });
        }
    }

    // 초기화 바인딩
    document.addEventListener('DOMContentLoaded', () => {
        handleUrlParameters();
        loadFamilyMembers();
        initNumpad();
        initAdminLoginForm();
        syncSingleSignOut();
        registerServiceWorker();

        if (btnSubmitNewPin) {
            btnSubmitNewPin.addEventListener('click', submitNewPin);
        }
    });
})();
