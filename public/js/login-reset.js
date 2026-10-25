/**
 * ==============================================================================
 * 계정 비밀번호 분실 초기화 제어기 (login-reset.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스 준수
 * [규칙 3] 500줄 이하 모듈화 준수 (약 80줄)
 * ==============================================================================
 */

(function () {
    'use strict';

    const resetModal = document.getElementById('resetPasswordModal');
    const usernameInput = document.getElementById('resetUsername');
    const emailInput = document.getElementById('resetEmail');
    const errEl = document.getElementById('resetPasswordError');
    const succEl = document.getElementById('resetPasswordSuccess');
    const btnSubmit = document.getElementById('btnSubmitReset');

    window.openResetPasswordModal = function () {
        if (!resetModal) return;
        const currentLoginUsername = document.getElementById('username')?.value.trim();
        if (usernameInput) usernameInput.value = currentLoginUsername || '';
        if (emailInput) emailInput.value = '';
        if (errEl) errEl.style.display = 'none';
        if (succEl) succEl.style.display = 'none';
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.textContent = '임시 비밀번호 발송';
        }

        resetModal.style.display = 'flex';
        setTimeout(() => {
            if (usernameInput && !usernameInput.value) usernameInput.focus();
            else if (emailInput) emailInput.focus();
        }, 150);
    };

    window.closeResetPasswordModal = function () {
        if (resetModal) resetModal.style.display = 'none';
    };

    window.handleResetPassword = async function (e) {
        e.preventDefault();
        const username = usernameInput?.value.trim();
        const email = emailInput?.value.trim();

        if (!username || !email) {
            if (errEl) {
                errEl.textContent = '아이디와 이메일 주소를 모두 입력해 주세요.';
                errEl.style.display = 'block';
            }
            return;
        }

        if (errEl) errEl.style.display = 'none';
        if (succEl) succEl.style.display = 'none';
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.textContent = '발송 중...';
        }

        try {
            const res = await fetch('/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email })
            });

            const data = await res.json();
            if (data.success) {
                if (succEl) {
                    succEl.textContent = data.message || '등록된 이메일로 임시 비밀번호가 발송되었습니다.';
                    succEl.style.display = 'block';
                }
                if (btnSubmit) btnSubmit.textContent = '발송 완료';
                setTimeout(() => {
                    closeResetPasswordModal();
                }, 3000);
            } else {
                if (errEl) {
                    errEl.textContent = data.message || '임시 비밀번호 발송에 실패했습니다.';
                    errEl.style.display = 'block';
                }
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = '임시 비밀번호 발송';
                }
            }
        } catch (err) {
            if (errEl) {
                errEl.textContent = '서버 연결에 실패했습니다. 다시 시도해 주세요.';
                errEl.style.display = 'block';
            }
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = '임시 비밀번호 발송';
            }
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeResetPasswordModal();
        });

        if (resetModal) {
            resetModal.addEventListener('click', (e) => {
                if (e.target === resetModal) closeResetPasswordModal();
            });
        }
    });
})();
