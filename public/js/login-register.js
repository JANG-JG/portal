/**
 * ==============================================================================
 * 초대 기반 가족 회원가입 제어기 (login-register.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수 (약 130줄)
 * [규칙 6] 모바일 터치 및 폼 무결성 준수
 * ==============================================================================
 */

(function () {
    'use strict';

    let currentInviteToken = null;

    const registerModal = document.getElementById('registerModal');
    const regUsername = document.getElementById('regUsername');
    const regEmail = document.getElementById('regEmail');
    const regPassword = document.getElementById('regPassword');
    const regPasswordConfirm = document.getElementById('regPasswordConfirm');
    const regNickname = document.getElementById('regNickname');
    const regBirthdate = document.getElementById('regBirthdate');
    const regError = document.getElementById('registerError');
    const btnSubmit = document.getElementById('btnSubmitRegister');

    window.openRegisterModal = function (inviteToken, defaultNickname) {
        currentInviteToken = inviteToken;
        if (!registerModal) return;

        if (regUsername) regUsername.value = '';
        if (regEmail) regEmail.value = '';
        if (regPassword) regPassword.value = '';
        if (regPasswordConfirm) regPasswordConfirm.value = '';
        if (regNickname) regNickname.value = defaultNickname || '';
        if (regBirthdate) regBirthdate.value = '';
        if (regError) regError.style.display = 'none';

        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.textContent = '가입 완료 및 PIN 설정하기';
        }

        registerModal.style.display = 'flex';
        setTimeout(() => {
            if (regNickname && !regNickname.value) regNickname.focus();
            else if (regUsername) regUsername.focus();
        }, 150);
    };

    window.closeRegisterModal = function () {
        if (registerModal) registerModal.style.display = 'none';
    };

    window.handleRegisterSubmit = async function (e) {
        e.preventDefault();

        const username = (regUsername?.value || '').trim().toLowerCase();
        const email = (regEmail?.value || '').trim().toLowerCase();
        const password = regPassword?.value || '';
        const passwordConfirm = regPasswordConfirm?.value || '';
        const nickname = (regNickname?.value || '').trim();
        const birthdate = (regBirthdate?.value || '').trim();

        if (!currentInviteToken) {
            showRegisterError('초대 정보가 유효하지 않습니다. 링크를 다시 확인해 주세요.');
            return;
        }

        if (!username || !email || !password || !nickname || !birthdate) {
            showRegisterError('모든 항목을 빠짐없이 입력해 주세요.');
            return;
        }

        if (!/^[a-z0-9_]{4,20}$/.test(username)) {
            showRegisterError('아이디는 영문 소문자와 숫자, _ 조합으로 4~20자 이내여야 합니다.');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showRegisterError('올바른 이메일 주소를 입력해 주세요.');
            return;
        }

        if (password.length < 8) {
            showRegisterError('비밀번호는 최소 8자 이상으로 입력해 주세요.');
            return;
        }

        if (password !== passwordConfirm) {
            showRegisterError('입력하신 두 비밀번호가 일치하지 않습니다.');
            return;
        }

        if (regError) regError.style.display = 'none';
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.textContent = '가입 처리 중...';
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inviteToken: currentInviteToken,
                    username,
                    email,
                    password,
                    nickname,
                    birthdate
                })
            });

            const data = await res.json();

            if (data.success) {
                closeRegisterModal();

                // 가입 완료 후 바로 나만의 6자리 PIN 설정 모달로 부드럽게 전환
                if (typeof window.openPinChangeModal === 'function') {
                    window.openPinChangeModal(
                        data.tempToken,
                        data.username,
                        data.nickname,
                        data.message || '가입이 완료되었습니다! 앞으로 사용할 나만의 6자리 PIN을 설정해 주세요.'
                    );
                } else {
                    alert(data.message || '회원가입이 완료되었습니다!');
                    window.location.href = '/login';
                }
            } else {
                showRegisterError(data.message || '회원가입에 실패했습니다.');
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = '가입 완료 및 PIN 설정하기';
                }
            }
        } catch (err) {
            showRegisterError('서버 연결 중 오류가 발생했습니다. 다시 시도해 주세요.');
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = '가입 완료 및 PIN 설정하기';
            }
        }
    };

    function showRegisterError(msg) {
        if (regError) {
            regError.textContent = msg;
            regError.style.display = 'block';
        }
    }

    // URL 파라미터 감지 및 자동 오픈
    document.addEventListener('DOMContentLoaded', () => {
        const urlParams = new URLSearchParams(window.location.search);
        const registerInvite = urlParams.get('register_invite');
        const defaultNick = urlParams.get('nickname') || '';

        if (registerInvite) {
            window.openRegisterModal(registerInvite, defaultNick);
        }

        if (registerModal) {
            registerModal.addEventListener('click', (e) => {
                if (e.target === registerModal) closeRegisterModal();
            });
        }
    });
})();
