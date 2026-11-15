/**
 * ==============================================================================
 * 어린이 학습실 칭찬 도장판 & 부모 확인 스티커·수정 모듈 (study-stamps.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 친절한 한국어 UI | [규칙 3] 500줄 이하 모듈화
 * - 잠금 상태에서 종이학습지 도장 임의 적립 차단
 * - 부모 잠금 해제(PIN 또는 1.5초 어른 확인) 후 스티커 부여 & 도장판 수정 가능
 * ==============================================================================
 */
(function () {
    'use strict';

    let ctx = null;
    let lastBoard = null;
    let lastChildProfile = null;
    let editingStampId = null;

    function initDialogFallback(dialogEl, { autoReset = true } = {}) {
        if (!dialogEl) return;
        if (autoReset) {
            dialogEl.addEventListener('close', () => {
                dialogEl.returnValue = '';
            });
        }
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const isOutside = (e) => {
                const r = dialogEl.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            let pressedOutside = false;
            dialogEl.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
            dialogEl.addEventListener('pointerup', (e) => { if (pressedOutside && isOutside(e)) dialogEl.close(); });
        }
    }

    function authPayload(extra = {}) {
        return {
            childId: ctx.state.childId,
            parentPin: ctx.state.parentPinValue,
            longPressVerified: Boolean(ctx.state.parentUnlocked),
            ...extra
        };
    }

    async function callStampApi(url, payload) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(authPayload(payload))
        });
        const data = await res.json();
        if (res.status === 403 && (data.requirePin || data.requireUnlock)) {
            if (typeof ctx.lockParentMode === 'function') ctx.lockParentMode(false);
            if (data.requirePin && typeof ctx.openParentPinDialog === 'function') {
                ctx.openParentPinDialog();
            }
        }
        return { ok: res.ok && data.success, data };
    }

    function renderBoard(board, childProfile) {
        lastBoard = board || lastBoard;
        lastChildProfile = childProfile || lastChildProfile;

        const grid = document.getElementById('stampGrid');
        const badge = document.getElementById('stampCycleBadge');
        const rewardEl = document.getElementById('targetRewardText');
        if (!grid || !lastBoard) return;

        const count = Number(lastBoard.earnedCount || 0);
        if (badge) badge.textContent = `${count} / 10칸 (${lastBoard.cycleNo}판째)`;
        if (rewardEl) {
            rewardEl.textContent = `🎁 약속 선물: ${lastChildProfile?.target_reward || '칭찬 선물'}`;
        }

        const editable = Boolean(ctx?.state?.parentUnlocked);
        const esc = ctx?.escapeHtml || ((s) => String(s || ''));
        const slots = [];

        for (let i = 0; i < 10; i++) {
            const stamp = lastBoard.stamps && lastBoard.stamps[i];
            if (stamp) {
                const icon = stamp.source_type === 'paper' ? '📄' : '🌟';
                if (editable) {
                    slots.push(`
                        <button type="button" class="stamp-slot filled stamp-slot--editable" data-stamp-id="${esc(stamp.id)}" data-slot-index="${i + 1}" title="${esc(stamp.note || '')} (눌러서 수정·삭제)">
                            <span class="stamp-edit-badge" aria-hidden="true">✏️</span>
                            <span class="stamp-slot-icon" aria-hidden="true">${icon}</span>
                            <span>${i + 1}칸</span>
                        </button>
                    `);
                } else {
                    slots.push(`
                        <div class="stamp-slot filled" title="${esc(stamp.note || '')}">
                            <span class="stamp-slot-icon" aria-hidden="true">${icon}</span>
                            <span>${i + 1}칸 완료</span>
                        </div>
                    `);
                }
            } else {
                slots.push(`
                    <div class="stamp-slot">
                        <span>${i + 1}</span>
                    </div>
                `);
            }
        }
        grid.innerHTML = slots.join('');
        syncActionDisabledState();
    }

    function syncActionDisabledState() {
        const count = Number(lastBoard?.earnedCount || 0);
        const undoBtn = document.getElementById('btnStampUndoLast');
        const resetBtn = document.getElementById('btnStampResetBoard');
        if (undoBtn) undoBtn.disabled = count === 0;
        if (resetBtn) resetBtn.disabled = count === 0;
    }

    function syncLockUi(unlocked) {
        const lockNotice = document.getElementById('stampLockNotice');
        const parentPanel = document.getElementById('stampParentPanel');
        if (lockNotice) lockNotice.hidden = Boolean(unlocked);
        if (parentPanel) parentPanel.hidden = !Boolean(unlocked);
        if (lastBoard) renderBoard(lastBoard, lastChildProfile);
    }

    function openStampEditDialog(stampId) {
        if (!ctx?.state?.parentUnlocked || !lastBoard?.stamps) return;
        const stamp = lastBoard.stamps.find((s) => String(s.id) === String(stampId));
        if (!stamp) return;

        editingStampId = stamp.id;
        const dialog = document.getElementById('stampEditDialog');
        const subtitle = document.getElementById('stampEditSubtitle');
        const typeSel = document.getElementById('stampEditTypeSelect');
        const noteInput = document.getElementById('stampEditNoteInput');

        if (subtitle) subtitle.textContent = `획득 시각: ${stamp.earned_at || '-'}`;
        if (typeSel) typeSel.value = stamp.source_type === 'online' ? 'online' : 'paper';
        if (noteInput) noteInput.value = stamp.note || '';
        if (dialog && dialog.showModal) dialog.showModal();
    }

    function bindEvents(dashboardCtx) {
        ctx = dashboardCtx;

        const editDialog = document.getElementById('stampEditDialog');
        const confirmDialog = document.getElementById('stampConfirmDialog');
        initDialogFallback(editDialog);
        initDialogFallback(confirmDialog, { autoReset: false });

        const btnUnlockForStamp = document.getElementById('btnUnlockForStamp');
        if (btnUnlockForStamp) {
            btnUnlockForStamp.addEventListener('click', () => {
                if (ctx.state.hasParentPin) {
                    ctx.openParentPinDialog();
                    return;
                }
                ctx.showToast('상단 "부모 잠금 해제" 버튼을 1.5초간 꾹 눌러 먼저 잠금을 풀어주세요!');
                const topUnlockBtn = document.getElementById('btnParentUnlock');
                if (topUnlockBtn) {
                    topUnlockBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    topUnlockBtn.focus({ preventScroll: true });
                }
            });
        }

        const btnRelock = document.getElementById('btnRelockFromStamp');
        if (btnRelock) {
            btnRelock.addEventListener('click', () => {
                if (typeof ctx.lockParentMode === 'function') ctx.lockParentMode(true);
            });
        }

        const btnPaper = document.getElementById('btnPaperStamp');
        if (btnPaper) {
            btnPaper.addEventListener('click', async () => {
                ctx.touchParentActivity();
                btnPaper.disabled = true;
                try {
                    const noteEl = document.getElementById('paperStampNoteInput');
                    const note = (noteEl?.value || '').trim();
                    const { ok, data } = await callStampApi('/api/study/stamps/paper', { note });
                    ctx.showToast(data.message || (ok ? '종이 학습지 도장을 부여했어요!' : '도장 부여에 실패했어요.'));
                    if (ok) {
                        if (window.StudyFx) {
                            window.StudyFx.stamp();
                            window.StudyFx.celebrate({ big: Boolean(data.reachedTen) });
                        }
                        if (noteEl) noteEl.value = '';
                    }
                    await ctx.reloadDashboard();
                } catch (_) {
                    ctx.showToast('도장 부여 중 오류가 발생했어요.');
                } finally {
                    btnPaper.disabled = false;
                }
            });
        }

        const btnAddOnline = document.getElementById('btnParentAddOnlineStamp');
        if (btnAddOnline) {
            btnAddOnline.addEventListener('click', async () => {
                ctx.touchParentActivity();
                btnAddOnline.disabled = true;
                try {
                    const noteEl = document.getElementById('paperStampNoteInput');
                    const note = (noteEl?.value || '').trim();
                    const { ok, data } = await callStampApi('/api/study/stamps/manage', { action: 'add_online', note });
                    ctx.showToast(data.message || (ok ? '도장을 추가했어요!' : '추가에 실패했어요.'));
                    if (ok) {
                        if (window.StudyFx) {
                            window.StudyFx.stamp();
                            window.StudyFx.celebrate({ big: Boolean(data.reachedTen) });
                        }
                        if (noteEl) noteEl.value = '';
                    }
                    await ctx.reloadDashboard();
                } catch (_) {
                    ctx.showToast('도장 추가 중 오류가 발생했어요.');
                } finally {
                    btnAddOnline.disabled = false;
                }
            });
        }

        const btnUndoLast = document.getElementById('btnStampUndoLast');
        if (btnUndoLast) {
            btnUndoLast.addEventListener('click', async () => {
                ctx.touchParentActivity();
                btnUndoLast.disabled = true;
                try {
                    const { data } = await callStampApi('/api/study/stamps/manage', { action: 'undo_last' });
                    ctx.showToast(data.message || '마지막 도장을 뺐어요.');
                    await ctx.reloadDashboard();
                } catch (_) {
                    ctx.showToast('도장 수정 중 오류가 발생했어요.');
                } finally {
                    syncActionDisabledState();
                }
            });
        }

        const btnReset = document.getElementById('btnStampResetBoard');
        if (btnReset && confirmDialog) {
            btnReset.addEventListener('click', () => {
                ctx.touchParentActivity();
                confirmDialog.showModal();
            });
            confirmDialog.addEventListener('close', async () => {
                const choice = confirmDialog.returnValue;
                confirmDialog.returnValue = '';
                if (choice !== 'confirm') return;
                try {
                    const { data } = await callStampApi('/api/study/stamps/manage', { action: 'reset_board' });
                    ctx.showToast(data.message || '이번 도장판을 비웠어요.');
                    await ctx.reloadDashboard();
                } catch (_) {
                    ctx.showToast('도장판 비우기 중 오류가 발생했어요.');
                }
            });
        }

        const grid = document.getElementById('stampGrid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                if (!ctx.state.parentUnlocked) return;
                const slotBtn = e.target.closest('button[data-stamp-id]');
                if (!slotBtn) return;
                ctx.touchParentActivity();
                openStampEditDialog(slotBtn.dataset.stampId);
            });
        }

        const btnSaveOne = document.getElementById('btnSaveOneStamp');
        if (btnSaveOne) {
            btnSaveOne.addEventListener('click', async () => {
                if (!editingStampId) return;
                ctx.touchParentActivity();
                btnSaveOne.disabled = true;
                try {
                    const sourceType = document.getElementById('stampEditTypeSelect')?.value || 'paper';
                    const note = document.getElementById('stampEditNoteInput')?.value || '';
                    const { ok, data } = await callStampApi('/api/study/stamps/manage', {
                        action: 'update_note',
                        stampId: editingStampId,
                        sourceType,
                        note
                    });
                    if (ok && editDialog) editDialog.close();
                    ctx.showToast(data.message || '수정했어요.');
                    await ctx.reloadDashboard();
                } catch (_) {
                    ctx.showToast('수정 중 오류가 발생했어요.');
                } finally {
                    btnSaveOne.disabled = false;
                }
            });
        }

        const btnDeleteOne = document.getElementById('btnDeleteOneStamp');
        if (btnDeleteOne) {
            btnDeleteOne.addEventListener('click', async () => {
                if (!editingStampId) return;
                ctx.touchParentActivity();
                btnDeleteOne.disabled = true;
                try {
                    const { ok, data } = await callStampApi('/api/study/stamps/manage', {
                        action: 'delete_one',
                        stampId: editingStampId
                    });
                    if (ok && editDialog) editDialog.close();
                    ctx.showToast(data.message || '삭제했어요.');
                    await ctx.reloadDashboard();
                } catch (_) {
                    ctx.showToast('삭제 중 오류가 발생했어요.');
                } finally {
                    btnDeleteOne.disabled = false;
                }
            });
        }

        syncLockUi(ctx.state.parentUnlocked);
    }

    window.StudyStamps = {
        renderBoard,
        syncLockUi,
        bindEvents
    };
})();
