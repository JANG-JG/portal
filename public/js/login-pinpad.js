/**
 * ==============================================================================
 * 가족 간편입장 6자리 PIN 가상 키패드 제어기 (login-pinpad.js)
 * ------------------------------------------------------------------------------
 * - 모바일 OS 가상 키보드 팝업 차단 (inputmode="none" + 포커스 미호출)
 * - Fisher-Yates 기반 숫자 키(0~9) 랜덤 배열
 * - 데스크톱 물리 키보드(0~9, Backspace, Escape/Delete) 입력 지원
 * ==============================================================================
 */
(function () {
    'use strict';

    let currentPin = '';
    let canInputFn = () => false;
    let onCompleteFn = null;

    const hiddenInput = document.getElementById('familyPinHiddenInput');
    const pinDotsWrap = document.getElementById('pinDotsWrap');

    function blurActiveInput() {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && typeof active.blur === 'function') {
            active.blur();
        }
    }

    function updatePinDots(val) {
        if (!pinDotsWrap) return;
        pinDotsWrap.querySelectorAll('.pin-dot').forEach((dot, idx) => {
            dot.classList.toggle('filled', idx < val.length);
        });
    }

    function shuffle() {
        const digitBtns = document.querySelectorAll('#familyPinView .numpad-btn:not(.btn-action)');
        if (!digitBtns.length) return;

        const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const rand = new Uint32Array(digits.length);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(rand);
        } else {
            for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 0x100000000);
        }
        for (let i = digits.length - 1; i > 0; i--) {
            const j = rand[i] % (i + 1);
            [digits[i], digits[j]] = [digits[j], digits[i]];
        }

        digitBtns.forEach((btn, idx) => {
            const d = digits[idx];
            btn.setAttribute('data-key', d);
            btn.textContent = d;
            btn.setAttribute('aria-label', d);
        });
    }

    function reset() {
        currentPin = '';
        if (hiddenInput) hiddenInput.value = '';
        updatePinDots('');
    }

    function applyAction(key) {
        if (!canInputFn()) return;
        if (key === 'clear') {
            currentPin = '';
        } else if (key === 'backspace') {
            currentPin = currentPin.slice(0, -1);
        } else if (/^\d$/.test(key) && currentPin.length < 6) {
            currentPin += key;
        }
        if (hiddenInput) hiddenInput.value = currentPin;
        updatePinDots(currentPin);
        if (currentPin.length === 6 && typeof onCompleteFn === 'function') {
            onCompleteFn(currentPin);
        }
    }

    function init(options) {
        if (options && typeof options.canInput === 'function') canInputFn = options.canInput;
        if (options && typeof options.onComplete === 'function') onCompleteFn = options.onComplete;

        shuffle();
        document.querySelectorAll('#familyPinView .numpad-btn').forEach(btn => {
            btn.addEventListener('click', () => applyAction(btn.getAttribute('data-key')));
        });

        document.addEventListener('keydown', (e) => {
            if (!canInputFn()) return;
            const activeTag = (document.activeElement && document.activeElement.tagName) || '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
            if (document.querySelector('.modal-overlay[style*="flex"]')) return;

            if (/^\d$/.test(e.key)) {
                e.preventDefault();
                applyAction(e.key);
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                applyAction('backspace');
            } else if (e.key === 'Escape' || e.key === 'Delete') {
                e.preventDefault();
                applyAction('clear');
            }
        });
    }

    // 모바일 가상 키보드 팝업 차단을 위해 포커스를 열지 않고 기존 포커스만 해제
    window.focusPinInput = blurActiveInput;
    window.FamilyPinPad = { init, shuffle, reset, blurActiveInput };
})();
