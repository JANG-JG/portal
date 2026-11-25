/**
 * ==============================================================================
 * 빨간패드공부 (/study/login) 로그인 제어 스크립트 (study-login.js)
 * ------------------------------------------------------------------------------
 * - 등록된 태블릿 기기: 6자리 간편 PIN 패드 자동 표시
 * - 아이디/비밀번호 로그인 & 최초 PIN 변경 다이얼로그 지원
 * ==============================================================================
 */
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search || '');
    const rawNext = params.get('next') || '/study';
    const nextUrl = (rawNext === '/study' || rawNext.startsWith('/study/')) ? rawNext : '/study';

    const tabsEl = document.getElementById('slModeTabs');
    const tabPinBtn = document.getElementById('tabStudyPin');
    const tabIdBtn = document.getElementById('tabStudyId');
    const pinSection = document.getElementById('studyPinSection');
    const idForm = document.getElementById('studyIdForm');
    const memberGrid = document.getElementById('studyMemberGrid');
    const pinDots = Array.from(document.querySelectorAll('#studyPinDots .sl-pin-dot'));
    const statusEl = document.getElementById('studyLoginStatus');
    const submitBtn = document.getElementById('btnStudyLoginSubmit');
    const togglePwBtn = document.getElementById('btnTogglePw');
    const pwInput = document.getElementById('studyPassword');
    const pinChangeDialog = document.getElementById('pinChangeDialog');
    const pinChangeForm = document.getElementById('pinChangeForm');
    const pinChangeStatus = document.getElementById('pinChangeStatus');

    let selectedMember = null;
    let enteredPin = '';
    let submitting = false;
    let pendingTempToken = null;

    function setStatus(msg, isInfo) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('info', Boolean(isInfo));
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function switchMode(mode) {
        const isPin = mode === 'pin';
        if (pinSection) pinSection.hidden = !isPin;
        if (idForm) idForm.hidden = isPin;
        if (tabPinBtn) {
            tabPinBtn.classList.toggle('active', isPin);
            tabPinBtn.setAttribute('aria-pressed', isPin ? 'true' : 'false');
        }
        if (tabIdBtn) {
            tabIdBtn.classList.toggle('active', !isPin);
            tabIdBtn.setAttribute('aria-pressed', isPin ? 'false' : 'true');
        }
        setStatus('');
    }

    function renderDots() {
        pinDots.forEach((dot, idx) => {
            dot.classList.toggle('filled', idx < enteredPin.length);
        });
    }

    async function submitFamilyPin() {
        if (submitting || !selectedMember || enteredPin.length !== 6) return;
        submitting = true;
        setStatus('확인 중이에요...', true);
        try {
            const reqHeaders = { 'Content-Type': 'application/json' };
            try {
                const devToken = localStorage.getItem('jg_family_device');
                if (devToken) reqHeaders['x-family-device'] = devToken;
            } catch (e) {}
            const verifyInvite = params.get('verify_invite');
            if (verifyInvite) reqHeaders['x-invite-verify'] = verifyInvite;

            const res = await fetch('/api/auth/family-login', {
                method: 'POST',
                headers: reqHeaders,
                credentials: 'include',
                body: JSON.stringify({
                    username: selectedMember.username,
                    pin: enteredPin,
                    next: nextUrl
                })
            });
            const data = await res.json();
            if (data.success) {
                if (data.requirePinChange && data.tempToken) {
                    pendingTempToken = data.tempToken;
                    enteredPin = '';
                    renderDots();
                    setStatus('');
                    if (pinChangeDialog && pinChangeDialog.showModal) {
                        pinChangeDialog.showModal();
                    }
                    return;
                }
                if (data.deviceToken) {
                    try { localStorage.setItem('jg_family_device', data.deviceToken); } catch (e) {}
                }
                window.location.replace(data.redirect || nextUrl);
                return;
            }
            enteredPin = '';
            renderDots();
            setStatus(data.message || 'PIN 번호를 다시 확인해 주세요.');
        } catch (err) {
            enteredPin = '';
            renderDots();
            setStatus('서버와 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
        } finally {
            submitting = false;
        }
    }

    async function loadPairedTabletMember() {
        try {
            const headers = {};
            try {
                const devToken = localStorage.getItem('jg_family_device');
                if (devToken) headers['x-family-device'] = devToken;
            } catch (e) {}
            const verifyInvite = params.get('verify_invite');
            if (verifyInvite) headers['x-invite-verify'] = verifyInvite;

            const res = await fetch('/api/auth/family-members', { headers, credentials: 'include' });
            const data = await res.json();
            if (!data.hasDevice || !Array.isArray(data.members) || data.members.length === 0) {
                switchMode('id');
                return;
            }

            selectedMember = data.members[0];
            if (memberGrid) {
                memberGrid.innerHTML = data.members.map((m, idx) => `
                    <button type="button" class="sl-member-card${idx === 0 ? ' active' : ''}" data-username="${escapeHtml(m.username)}">
                        <span class="sl-member-emoji" aria-hidden="true">${escapeHtml(m.emoji || '🧒')}</span>
                        <span>${escapeHtml(m.nickname || m.username)}</span>
                    </button>
                `).join('');
                memberGrid.querySelectorAll('.sl-member-card').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const found = data.members.find((m) => m.username === btn.dataset.username);
                        if (found) selectedMember = found;
                        memberGrid.querySelectorAll('.sl-member-card').forEach((el) => {
                            el.classList.toggle('active', el === btn);
                        });
                        enteredPin = '';
                        renderDots();
                    });
                });
            }
            if (tabsEl) tabsEl.hidden = false;
            switchMode('pin');
        } catch (e) {
            switchMode('id');
        }
    }

    if (tabPinBtn) tabPinBtn.addEventListener('click', () => switchMode('pin'));
    if (tabIdBtn) tabIdBtn.addEventListener('click', () => switchMode('id'));

    const keypad = document.getElementById('studyKeypad');
    if (keypad) {
        keypad.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn || submitting) return;
            const digit = btn.dataset.key;
            const action = btn.dataset.action;
            if (digit !== undefined && enteredPin.length < 6) {
                enteredPin += digit;
                renderDots();
                setStatus('');
                if (enteredPin.length === 6) submitFamilyPin();
            } else if (action === 'back') {
                enteredPin = enteredPin.slice(0, -1);
                renderDots();
            } else if (action === 'clear') {
                enteredPin = '';
                renderDots();
                setStatus('');
            }
        });
    }

    if (togglePwBtn && pwInput) {
        togglePwBtn.addEventListener('click', () => {
            const show = pwInput.type === 'password';
            pwInput.type = show ? 'text' : 'password';
            togglePwBtn.textContent = show ? '숨김' : '보기';
            togglePwBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
        });
    }

    if (idForm) {
        idForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (submitting) return;
            const usernameInput = document.getElementById('studyUsername');
            const username = (usernameInput?.value || '').trim();
            const password = pwInput?.value || '';
            if (!username || !password) {
                setStatus('아이디와 비밀번호를 모두 입력해 주세요.');
                (username ? pwInput : usernameInput)?.focus();
                return;
            }
            submitting = true;
            if (submitBtn) submitBtn.disabled = true;
            setStatus('로그인 중이에요...', true);
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        username,
                        password,
                        rememberMe: true,
                        next: nextUrl
                    })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.replace(data.redirect || nextUrl);
                    return;
                }
                setStatus(data.message || '아이디 또는 비밀번호가 맞지 않아요.');
            } catch (err) {
                setStatus('서버와 연결할 수 없어요.');
            } finally {
                submitting = false;
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    const btnClosePinChange = document.getElementById('btnClosePinChange');
    if (btnClosePinChange && pinChangeDialog) {
        btnClosePinChange.addEventListener('click', () => pinChangeDialog.close());
    }

    if (pinChangeForm) {
        pinChangeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPinInput = document.getElementById('newPinInput');
            const newPin = String(newPinInput?.value || '').trim();
            if (!/^\d{6}$/.test(newPin)) {
                if (pinChangeStatus) pinChangeStatus.textContent = '숫자 6자리를 입력해 주세요.';
                newPinInput?.focus();
                return;
            }
            try {
                const res = await fetch('/api/auth/change-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ tempToken: pendingTempToken, newPin, next: nextUrl })
                });
                const data = await res.json();
                if (data.success) {
                    if (data.deviceToken) {
                        try { localStorage.setItem('jg_family_device', data.deviceToken); } catch (err) {}
                    }
                    window.location.replace(data.redirect || nextUrl);
                    return;
                }
                if (pinChangeStatus) pinChangeStatus.textContent = data.message || 'PIN 변경에 실패했어요.';
            } catch (err) {
                if (pinChangeStatus) pinChangeStatus.textContent = '서버 연결 오류입니다.';
            }
        });
    }

    if (params.get('logout') === 'success') {
        setStatus('안전하게 로그아웃되었어요.', true);
    }
    loadPairedTabletMember();
})();
