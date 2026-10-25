/**
 * ==============================================================================
 * 우리 가족 간편 입장 & 6자리 PIN 인증 제어기 (login-family.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 자연스러운 일상 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수
 * [규칙 6] 모바일 터치(360px) 최적화 핀패드 및 가상 키패드 지원
 * ==============================================================================
 */

(function () {
    'use strict';

    let currentMember = null;
    let currentTempToken = null;
    let isSubmitting = false;

    // DOM 참조
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

    // 1. 모드 전환 (가족 간편 입장 ↔ 관리자 로그인)
    window.switchLoginMode = function (mode) {
        const familySec = document.getElementById('familyLoginSection');
        const adminSec = document.getElementById('adminLoginSection');
        const tabBtnFamily = document.getElementById('tabBtnFamily');
        const tabBtnAdmin = document.getElementById('tabBtnAdmin');
        const loginTitle = document.getElementById('loginTitle');
        const loginSubtitle = document.getElementById('loginSubtitle');

        if (mode === 'admin') {
            if (familySec) familySec.style.display = 'none';
            if (adminSec) adminSec.style.display = 'block';
            if (tabBtnFamily) tabBtnFamily.classList.remove('active');
            if (tabBtnAdmin) tabBtnAdmin.classList.add('active');
            if (loginTitle) loginTitle.textContent = '관리자 로그인';
            if (loginSubtitle) loginSubtitle.textContent = '서버 관리자 계정으로 접속합니다';
            const usernameInput = document.getElementById('username');
            if (usernameInput) usernameInput.focus();
        } else {
            if (familySec) familySec.style.display = 'block';
            if (adminSec) adminSec.style.display = 'none';
            if (tabBtnFamily) tabBtnFamily.classList.add('active');
            if (tabBtnAdmin) tabBtnAdmin.classList.remove('active');
            if (loginTitle) loginTitle.textContent = '우리 가족 간편 입장';
            if (loginSubtitle) loginSubtitle.textContent = '내 프로필을 선택하고 6자리 PIN을 입력하세요';
        }
    };

    // 2. 가족 구성원 목록 비동기 조회 및 렌더링
    async function loadFamilyMembers() {
        if (!familyChipsContainer) return;

        try {
            const res = await fetch('/api/auth/family-members');
            const data = await res.json();

            if (!data.success || !data.members || data.members.length === 0) {
                familyChipsContainer.innerHTML = `
                    <div style="color: #a1a1aa; font-size: 0.85rem; grid-column: 1 / -1; text-align: center; padding: 1.5rem 0;">
                        등록된 가족 구성원이 없습니다.<br>
                        <a href="javascript:void(0)" onclick="switchLoginMode('admin')" style="color: #60a5fa; text-decoration: underline; margin-top: 0.5rem; display: inline-block;">
                            관리자 계정으로 로그인하기 →
                        </a>
                    </div>
                `;
                return;
            }

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
        } catch (err) {
            console.error('가족 목록 로드 실패:', err);
            familyChipsContainer.innerHTML = `
                <div style="color: #f43f5e; font-size: 0.85rem; grid-column: 1 / -1; text-align: center; padding: 1rem 0;">
                    가족 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
                </div>
            `;
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
                if (data.requirePinChange) {
                    // 최초 접속 PIN 변경 모달 오픈
                    openPinChangeModal(data.tempToken, data.username, data.nickname, data.message);
                } else {
                    // 로그인 성공 시 포털 메인으로 즉시 이동
                    window.location.href = data.redirect || '/';
                }
            } else {
                // 실패 메시지 표시 (남은 기회 또는 잠금 안내)
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
    function openPinChangeModal(tempToken, username, nickname, desc) {
        currentTempToken = tempToken;
        const titleEl = document.getElementById('pinChangeTitle');
        const descEl = document.getElementById('pinChangeDesc');
        const newPinInput = document.getElementById('newPinInput');
        const confirmPinInput = document.getElementById('confirmPinInput');

        if (titleEl) titleEl.textContent = `${nickname || username}님의 6자리 PIN 설정`;
        if (descEl && desc) descEl.textContent = desc;
        if (newPinInput) newPinInput.value = '';
        if (confirmPinInput) confirmPinInput.value = '';
        if (pinChangeError) pinChangeError.style.display = 'none';

        if (pinChangeModal) pinChangeModal.style.display = 'flex';
        if (newPinInput) setTimeout(() => newPinInput.focus(), 150);
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

    // 7. URL 파라미터 확인 (초대 토큰 등)
    function handleUrlParameters() {
        const params = new URLSearchParams(window.location.search);
        const inviteToken = params.get('invite_token');
        const username = params.get('username');
        const nickname = params.get('nickname');
        const error = params.get('error');

        if (inviteToken) {
            // 주소창에서 긴 토큰 난수 즉시 클렌징 (깨끗한 주소창 유지)
            window.history.replaceState({}, document.title, window.location.pathname);
            openPinChangeModal(
                inviteToken,
                username,
                nickname,
                `반갑습니다, ${nickname || username}님! 앞으로 사용하실 나만의 숫자 6자리 PIN을 설정해 주세요.`
            );
        } else if (error === 'invalid_invite') {
            if (familyErrorMsg) {
                familyErrorMsg.textContent = '유효하지 않거나 만료된 가족 초대 링크입니다.';
                familyErrorMsg.style.display = 'block';
            }
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

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

    // 🌟 [SSO 단일 로그아웃 동기화]
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

    // 🌟 [PWA 서비스 워커 등록]
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(err => {
                    console.warn('[PWA] Service Worker registration failed on login:', err);
                });
            });
        }
    }

    // 초기화
    document.addEventListener('DOMContentLoaded', () => {
        loadFamilyMembers();
        initNumpad();
        handleUrlParameters();
        initAdminLoginForm();
        syncSingleSignOut();
        registerServiceWorker();

        if (btnSubmitNewPin) {
            btnSubmitNewPin.addEventListener('click', submitNewPin);
        }
    });
})();
