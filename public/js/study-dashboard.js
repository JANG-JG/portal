/**
 * ==============================================================================
 * 어린이 학습실 대시보드 제어 스크립트 (study-dashboard.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 친절한 한국어 UI
 * [규칙 3] 500줄 이하 모듈화 | [규칙 6] classList.toggle / DOM 안전 바인딩
 * ==============================================================================
 */

(function () {
    'use strict';

    const SUBJECT_LABELS = {
        korean: '🇰🇷 한글 놀이', math: '🔢 숫자·수학', english: '🔤 영어 놀이',
        logic: '🧩 두뇌 퍼즐', reading: '📖 동화·말하기', science: '🌱 자연·과학',
        music: '🎹 리듬 피아노', coloring: '🎨 색칠놀이'
    };

    const state = {
        childId: new URLSearchParams(window.location.search).get('childId') || '',
        selectedSubject: 'korean',
        selectedTheme: '동물 친구',
        selectedColoringMode: 'auto_3',
        hasParentPin: false,
        parentUnlocked: false,
        parentPinValue: '',
        holdTimer: null,
        dashboard: null
    };

    const toastEl = document.getElementById('studyToast');
    const pinDialog = document.getElementById('parentPinDialog');
    const pinInput = document.getElementById('parentPinInput');
    const pinError = document.getElementById('parentPinError');

    function showToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.hidden = false;
        clearTimeout(toastEl._timer);
        toastEl._timer = setTimeout(() => {
            toastEl.hidden = true;
        }, 3200);
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function loadDashboard() {
        try {
            const qs = state.childId ? `?childId=${encodeURIComponent(state.childId)}` : '';
            const res = await fetch(`/api/study/dashboard${qs}`, {
                credentials: 'include'
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || '정보를 불러오지 못했어요.');
                return;
            }
            if (data.activeChild?.id) {
                state.childId = data.activeChild.id;
            } else if (!state.childId) {
                state.childId = 'first';
            }
            state.dashboard = data;
            state.hasParentPin = Boolean(data.hasParentPin);
            renderDashboard(data);
        } catch (err) {
            console.error('대시보드 로드 오류:', err);
            showToast('서버 연결 상태를 확인해 주세요.');
        }
    }

    function renderDashboard(data) {
        // 어린이 계정(kid)에는 포털 홈 돌아가기 버튼 숨김 유지
        const portalBack = document.getElementById('portalBackLink');
        if (portalBack) {
            portalBack.hidden = data.viewer?.role === 'kid';
        }

        // 모든 등록된 아이 프로필 탭 동적 렌더링
        const tabsNav = document.getElementById('childTabsNav');
        if (tabsNav && Array.isArray(data.profiles) && data.profiles.length > 0) {
            tabsNav.innerHTML = data.profiles.map((p) => {
                const active = p.id === state.childId;
                return `
                    <button type="button" class="child-tab-btn${active ? ' active' : ''}" data-child="${escapeHtml(p.id)}" aria-pressed="${active ? 'true' : 'false'}">
                        <span class="child-tab-emoji" aria-hidden="true">${escapeHtml(p.avatar_emoji || '🧒')}</span>
                        <span>
                            <span>${escapeHtml(p.display_name || p.id)}</span>
                            <span class="child-tab-sub">${escapeHtml(p.birth_year || '')}년생</span>
                        </span>
                    </button>
                `;
            }).join('');
        }

        const explorerBtn = document.getElementById('btnStartExplorerTest');
        if (explorerBtn) {
            explorerBtn.href = `/study/test?childId=${encodeURIComponent(state.childId)}`;
        }

        // 주간 균형 추천 배너
        const wb = data.weeklyBalance;
        const wbText = document.getElementById('weeklyBalanceText');
        if (wb && wbText) {
            wbText.textContent = wb.reason;
            if (wb.recommendedSubject && !state._userPickedSubject) {
                selectSubjectChip(wb.recommendedSubject, false);
            }
        }

        // Gemini 남은 횟수
        const qBadge = document.getElementById('quotaBadge');
        if (qBadge && data.quota) {
            qBadge.textContent = `오늘 AI 남은 횟수: ${data.quota.remaining} / ${data.quota.dailyLimit}`;
        }

        renderLevels(data.levels || { korean: 1, math: 1, english: 1 });
        renderStampBoard(data.stampBoard, data.activeChild);
        if (window.StudyPokemon && typeof window.StudyPokemon.render === 'function') {
            window.StudyPokemon.render(data.pokemon, data.activeChild);
        }
        const phase3Enabled = data.missions?.phase3SubjectsEnabled !== false;
        document.querySelectorAll('[data-phase3-subj]').forEach((el) => { el.hidden = !phase3Enabled; });
        window.StudyMissions?.renderMissionsCard?.(data.missions, state.childId, showToast);
        renderWrongReviewSummary(data.wrongNoteStats);
        renderArchive(data.recentSheets || []);
    }

    function renderLevels(levels) {
        const grid = document.getElementById('levelsGrid');
        if (!grid) return;

        grid.innerHTML = ['korean', 'math', 'english'].map((subj) => {
            const lv = Number(levels[subj] || 1);
            const stars = '⭐'.repeat(lv) + '☆'.repeat(5 - lv);
            return `
                <article class="level-tile">
                    <div class="level-tile-head">
                        <span>${SUBJECT_LABELS[subj]}</span>
                        <span class="level-badge">Lv.${lv}</span>
                    </div>
                    <div class="level-stars" aria-label="레벨 ${lv}점">${stars}</div>
                    <div class="level-stepper" ${state.parentUnlocked ? '' : 'hidden'}>
                        <button type="button" class="stepper-btn" data-subj="${subj}" data-delta="-1" ${lv <= 1 ? 'disabled' : ''}>➖ 낮추기</button>
                        <button type="button" class="stepper-btn" data-subj="${subj}" data-delta="1" ${lv >= 5 ? 'disabled' : ''}>➕ 높이기</button>
                    </div>
                </article>
            `;
        }).join('');

        grid.querySelectorAll('.stepper-btn').forEach((btn) => {
            btn.addEventListener('click', () => handleLevelAdjust(btn.dataset.subj, Number(btn.dataset.delta)));
        });
    }

    async function handleLevelAdjust(subject, delta) {
        try {
            const res = await fetch('/api/study/levels/adjust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    childId: state.childId,
                    subject,
                    delta,
                    parentPin: state.parentPinValue,
                    longPressVerified: state.parentUnlocked
                })
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || '레벨을 변경할 수 없어요.');
                return;
            }
            showToast(`${SUBJECT_LABELS[subject]} 레벨이 Lv.${data.level}로 변경되었어요!`);
            loadDashboard();
        } catch (err) {
            showToast('레벨 변경 중 오류가 발생했어요.');
        }
    }

    function renderStampBoard(board, childProfile) {
        if (window.StudyStamps && typeof window.StudyStamps.renderBoard === 'function') {
            window.StudyStamps.renderBoard(board, childProfile);
        }
    }

    function renderWrongReviewSummary(stats) {
        const s = stats || { pendingCount: 0, resolvedCount: 0, bySubject: {} };
        const pending = Number(s.pendingCount || 0);
        const resolved = Number(s.resolvedCount || 0);
        const badge = document.getElementById('wrongNoteCountBadge');
        const text = document.getElementById('wrongNoteSummaryText');
        const pills = document.getElementById('wrongNoteSubjStats');
        const link = document.getElementById('btnOpenWrongReview');
        if (badge) badge.textContent = pending > 0 ? `복습 ${pending}문제` : '모두 해결! 🌟';
        if (text) text.textContent = pending > 0 ? `아직 다시 풀어야 할 문제가 ${pending}개 있어요! 맞추면 못 받았던 별을 받을 수 있어요 ⭐` : `와! 틀린 문제가 하나도 없어요! (${resolved}문제 복습 완료 🌟)`;
        if (pills) pills.innerHTML = ['korean', 'math', 'english'].map((k) => `<span class="wrong-subj-pill">${SUBJECT_LABELS[k]} <strong>${Number(s.bySubject?.[k] || 0)}</strong>개</span>`).join('');
        if (link) {
            link.href = `/study/review?childId=${encodeURIComponent(state.childId)}`;
            link.textContent = pending > 0 ? `📝 틀린 ${pending}문제 복습하러 가기` : '📖 해결한 오답 복습 기록 보기';
            link.className = `study-link-btn ${pending > 0 ? 'study-btn-primary' : 'study-btn-secondary'}`;
        }
    }

    function renderArchive(sheets) {
        const list = document.getElementById('archiveList');
        if (!list) return;
        if (!sheets.length) {
            list.innerHTML = '<p style="color: #64748b; margin: 0;">아직 만든 학습지가 없어요. 위에서 첫 학습지를 만들어 보세요!</p>';
            return;
        }
        list.innerHTML = sheets.map((s) => {
            const hasPendingWrong = s.subject !== 'coloring' && !s.completed_at && Number(s.lastResult?.wrongCount || 0) > 0;
            const doneText = s.subject === 'coloring'
                ? (s.completed_at ? '🎨 색칠 완료' : '🖍️ 자유 색칠')
                : (s.completed_at ? '✅ 완료함' : (hasPendingWrong ? `😅 오답 ${s.lastResult.wrongCount}개` : '📝 풀기 전'));
            const subjText = SUBJECT_LABELS[s.subject] || s.subject;
            const metaText = s.subject === 'coloring' ? subjText : `${subjText} · Lv.${s.level}`;
            const sharePill = s.shared_from_child_id ? `<span class="archive-pill-share">🔁 ${escapeHtml(s.shared_from_name || '교차출제')}</span>` : '';
            const retryLabel = hasPendingWrong ? '🎯 다시 풀고 별 받기' : '📱 다시 풀기';
            return `
                <article class="archive-item">
                    <div>
                        <div class="archive-meta">
                            <span>${metaText} ${sharePill}</span>
                            <span>${doneText}</span>
                        </div>
                        <h3 class="archive-title">${escapeHtml(s.title)}</h3>
                    </div>
                    <div class="archive-actions">
                        <a href="/study/sheet/${s.id}" class="study-link-btn study-btn-secondary">${retryLabel}</a>
                        <a href="/study/sheet/${s.id}?print=1" class="study-link-btn study-btn-outline">🖨️ A4 인쇄</a>
                    </div>
                </article>
            `;
        }).join('');
    }

    function selectSubjectChip(subject, byUser = true) {
        if (!['korean', 'math', 'english', 'logic', 'reading', 'science', 'music'].includes(subject)) return;
        state.selectedSubject = subject;
        if (byUser) state._userPickedSubject = true;
        document.querySelectorAll('.subject-chip').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.subject === subject);
        });
        const playRow = document.getElementById('playMissionRow');
        if (playRow) playRow.hidden = ['logic', 'reading', 'science', 'music'].includes(subject);
    }

    function bindEvents() {
        const tabsNav = document.getElementById('childTabsNav');
        if (tabsNav) {
            tabsNav.addEventListener('click', (e) => {
                const btn = e.target.closest('.child-tab-btn');
                if (!btn) return;
                state.childId = btn.dataset.child;
                state._userPickedSubject = false;
                loadDashboard();
            });
        }

        const modeTablist = document.querySelector('.gen-mode-tabs[role="tablist"]');
        const panelWorksheet = document.getElementById('panelGenWorksheet');
        const panelColoring = document.getElementById('panelGenColoring');
        if (modeTablist && window.StudyPokemonColoring?.bindAccessibleTablist) {
            window.StudyPokemonColoring.bindAccessibleTablist(modeTablist, (tab) => {
                const isColoring = tab.dataset.genMode === 'coloring';
                if (panelWorksheet) panelWorksheet.hidden = isColoring;
                if (panelColoring) panelColoring.hidden = !isColoring;
                if (isColoring) {
                    window.StudyPokemonColoring.syncDashboardSelection();
                }
            });
        }

        if (window.StudyPokemonColoring?.initColoringCategoryTabs) {
            window.StudyPokemonColoring.initColoringCategoryTabs({
                getSelectedMode: () => state.selectedColoringMode,
                onSelectMode: (mode) => {
                    state.selectedColoringMode = mode || 'auto_3';
                }
            });
        }

        document.querySelectorAll('.subject-chip').forEach((btn) => {
            btn.addEventListener('click', () => selectSubjectChip(btn.dataset.subject, true));
        });

        document.querySelectorAll('.theme-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.selectedTheme = btn.dataset.theme;
                document.querySelectorAll('.theme-pill').forEach((p) => p.classList.toggle('active', p === btn));
                const custom = document.getElementById('customThemeInput');
                if (custom) custom.value = '';
            });
        });

        // 부모 잠금 해제 상태 동기화 & 3분 미활동 자동 재잠금
        let autoRelockTimer = null;
        const unlockBtn = document.getElementById('btnParentUnlock');

        function applyParentLockState(unlocked, notifyMsg = '') {
            state.parentUnlocked = Boolean(unlocked);
            clearTimeout(autoRelockTimer);
            if (!state.parentUnlocked) {
                state.parentPinValue = '';
            } else {
                autoRelockTimer = setTimeout(() => {
                    applyParentLockState(false, '시간이 지나 안전을 위해 부모 잠금이 다시 잠겼어요.');
                }, 3 * 60 * 1000);
            }
            if (unlockBtn) {
                unlockBtn.textContent = state.parentUnlocked
                    ? '🔓 부모 잠금 해제됨 (잠그기)'
                    : '🔒 부모 잠금 해제 (2초 꾹 / PIN)';
            }
            document.querySelectorAll('.level-stepper').forEach((el) => {
                el.hidden = !state.parentUnlocked;
            });
            if (window.StudyStamps?.syncLockUi) window.StudyStamps.syncLockUi(state.parentUnlocked);
            window.StudyPlazaShop?.syncLockUi?.(state.parentUnlocked, state.parentPinValue);
            if (notifyMsg) showToast(notifyMsg);
        }

        function touchParentActivity() {
            if (!state.parentUnlocked) return;
            clearTimeout(autoRelockTimer);
            autoRelockTimer = setTimeout(() => {
                applyParentLockState(false, '시간이 지나 안전을 위해 부모 잠금이 다시 잠겼어요.');
            }, 3 * 60 * 1000);
        }

        function openParentPinDialog() {
            if (!pinDialog) return;
            if (pinError) pinError.textContent = '';
            if (pinInput) pinInput.value = '';
            pinDialog.showModal();
        }

        if (unlockBtn) {
            const startHold = () => {
                if (state.parentUnlocked || state.hasParentPin) return;
                clearTimeout(state.holdTimer);
                state.holdTimer = setTimeout(() => {
                    applyParentLockState(true, '어른 잠금이 해제되었어요! 레벨 조절 및 도장판 관리가 가능해요.');
                }, 1400);
            };
            const cancelHold = () => clearTimeout(state.holdTimer);

            unlockBtn.addEventListener('pointerdown', startHold);
            unlockBtn.addEventListener('pointerup', cancelHold);
            unlockBtn.addEventListener('pointerleave', cancelHold);
            unlockBtn.addEventListener('pointercancel', cancelHold);

            unlockBtn.addEventListener('click', () => {
                if (state.parentUnlocked) {
                    applyParentLockState(false, '부모 잠금이 다시 잠겼어요.');
                    return;
                }
                if (state.hasParentPin && pinDialog) {
                    openParentPinDialog();
                } else {
                    showToast('버튼을 1.5초간 꾹 누르면 어른 잠금이 해제돼요!');
                }
            });
        }

        if (pinDialog) {
            pinDialog.addEventListener('close', () => {
                pinDialog.returnValue = '';
            });
        }
        // closedby="any" Safari/구형 브라우저 라이트 디스미스 폴백 (modern-web-guidance)
        if (pinDialog && !('closedBy' in HTMLDialogElement.prototype)) {
            const isOutside = (e) => {
                const r = pinDialog.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            let pressedOutside = false;
            pinDialog.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
            pinDialog.addEventListener('pointerup', (e) => { if (pressedOutside && isOutside(e)) pinDialog.close(); });
        }

        async function verifyAndUnlockParentPin() {
            const entered = (pinInput?.value || '').trim();
            if (!/^\d{4,8}$/.test(entered)) {
                if (pinError) pinError.textContent = '숫자 4~8자리 PIN을 입력해 주세요.';
                return;
            }
            const btnConfirmPin = document.getElementById('btnConfirmParentPin');
            if (btnConfirmPin) btnConfirmPin.disabled = true;
            try {
                const res = await fetch('/api/study/parent/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ parentPin: entered })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    if (pinError) pinError.textContent = data.message || '부모님 잠금 PIN 번호가 올바르지 않습니다.';
                    return;
                }
                state.parentPinValue = entered;
                if (pinDialog) pinDialog.close();
                applyParentLockState(true, '어른 잠금이 해제되었어요! 레벨과 도장판을 관리할 수 있습니다.');
            } catch (_) {
                if (pinError) pinError.textContent = '서버 확인 중 오류가 발생했어요.';
            } finally {
                if (btnConfirmPin) btnConfirmPin.disabled = false;
            }
        }

        document.getElementById('btnConfirmParentPin')?.addEventListener('click', verifyAndUnlockParentPin);
        document.getElementById('parentPinForm')?.addEventListener('submit', (e) => {
            if (e.submitter && e.submitter.value === 'cancel') return;
            e.preventDefault();
            verifyAndUnlockParentPin();
        });

        window.StudyStamps?.bindEvents?.({
            state, showToast, escapeHtml, reloadDashboard: loadDashboard,
            openParentPinDialog, touchParentActivity,
            lockParentMode: (notify) => applyParentLockState(false, notify ? '부모 잠금이 다시 잠겼어요.' : '')
        });
        window.StudyPokemon?.bindEvents?.({ state, showToast, escapeHtml, reloadDashboard: loadDashboard });

        async function submitSheetGeneration(subject, triggerBtn) {
            if (!triggerBtn) return;
            const customVal = (document.getElementById('customThemeInput')?.value || '').trim();
            const theme = customVal || state.selectedTheme || '동물 친구';
            const playChk = document.getElementById('chkIncludePlayBlock');
            const includePlayBlock = subject === 'coloring' ? false : (playChk ? Boolean(playChk.checked) : true);
            triggerBtn.disabled = true;
            const origText = triggerBtn.textContent;
            triggerBtn.textContent = subject === 'coloring' ? '🖍️ 색칠 도안을 준비하고 있어요...' : '✨ 재미있는 학습지를 만들고 있어요...';
            const customPrompt = (subject === 'coloring' && state.selectedColoringMode === 'ai_custom')
                ? (document.getElementById('aiColorPromptInput')?.value || '').trim()
                : '';
            try {
                const res = await fetch('/api/study/sheets/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ childId: state.childId, subject, theme, includePlayBlock, coloringMode: state.selectedColoringMode, customPrompt })
                });
                const data = await res.json();
                if (data.success && data.sheet) {
                    window.location.href = `/study/sheet/${data.sheet.id}`;
                } else {
                    showToast(data.message || '학습지 생성에 실패했어요.');
                    triggerBtn.disabled = false;
                    triggerBtn.textContent = origText;
                }
            } catch (err) {
                showToast('학습지를 만드는 중 문제가 생겼어요.');
                triggerBtn.disabled = false;
                triggerBtn.textContent = origText;
            }
        }

        const btnGen = document.getElementById('btnGenerateSheet');
        btnGen?.addEventListener('click', () => submitSheetGeneration(state.selectedSubject, btnGen));
        const btnGenColor = document.getElementById('btnGenerateColoring');
        btnGenColor?.addEventListener('click', () => submitSheetGeneration('coloring', btnGenColor));

        const btnRefresh = document.getElementById('btnRefreshDashboard');
        btnRefresh?.addEventListener('click', async () => {
            if (btnRefresh.disabled) return;
            btnRefresh.disabled = true;
            const prevText = btnRefresh.textContent;
            btnRefresh.textContent = '🔄 불러오는 중...';
            window.StudyFx?.tap?.();
            try {
                await loadDashboard();
                await window.StudyPokemonSocial?.loadState?.();
                showToast('🔄 학습실 정보를 최신 상태로 새로 불러왔어요!');
            } finally {
                btnRefresh.disabled = false;
                btnRefresh.textContent = prevText;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        loadDashboard();
    });
})();
