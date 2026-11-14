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
        korean: '🇰🇷 한글 놀이',
        math: '🔢 숫자·수학',
        english: '🔤 영어 놀이'
    };

    const state = {
        childId: new URLSearchParams(window.location.search).get('childId') || '',
        selectedSubject: 'korean',
        selectedTheme: '동물 친구',
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
        const grid = document.getElementById('stampGrid');
        const badge = document.getElementById('stampCycleBadge');
        const rewardEl = document.getElementById('targetRewardText');
        if (!grid || !board) return;

        const count = Number(board.earnedCount || 0);
        if (badge) badge.textContent = `${count} / 10칸 (${board.cycleNo}판째)`;
        if (rewardEl) rewardEl.textContent = `🎁 약속 선물: ${childProfile?.target_reward || '칭찬 선물'}`;

        const slots = [];
        for (let i = 0; i < 10; i++) {
            const stamp = board.stamps && board.stamps[i];
            if (stamp) {
                const icon = stamp.source_type === 'paper' ? '📄' : '🌟';
                slots.push(`
                    <div class="stamp-slot filled" title="${escapeHtml(stamp.note || '')}">
                        <span class="stamp-slot-icon" aria-hidden="true">${icon}</span>
                        <span>${i + 1}칸 완료</span>
                    </div>
                `);
            } else {
                slots.push(`
                    <div class="stamp-slot">
                        <span>${i + 1}</span>
                    </div>
                `);
            }
        }
        grid.innerHTML = slots.join('');
    }

    function renderArchive(sheets) {
        const list = document.getElementById('archiveList');
        if (!list) return;
        if (!sheets.length) {
            list.innerHTML = '<p style="color: #64748b; margin: 0;">아직 만든 학습지가 없어요. 위에서 첫 학습지를 만들어 보세요!</p>';
            return;
        }
        list.innerHTML = sheets.map((s) => {
            const doneText = s.completed_at ? '✅ 완료함' : '📝 풀기 전';
            const subjText = SUBJECT_LABELS[s.subject] || s.subject;
            return `
                <article class="archive-item">
                    <div>
                        <div class="archive-meta">
                            <span>${subjText} · Lv.${s.level}</span>
                            <span>${doneText}</span>
                        </div>
                        <h3 class="archive-title">${escapeHtml(s.title)}</h3>
                    </div>
                    <div class="archive-actions">
                        <a href="/study/sheet/${s.id}" class="study-link-btn study-btn-secondary">📱 다시 풀기</a>
                        <a href="/study/sheet/${s.id}?print=1" class="study-link-btn study-btn-outline">🖨️ A4 인쇄</a>
                    </div>
                </article>
            `;
        }).join('');
    }

    function selectSubjectChip(subject, byUser = true) {
        state.selectedSubject = subject;
        if (byUser) state._userPickedSubject = true;
        document.querySelectorAll('.subject-chip').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.subject === subject);
        });
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

        // 부모 잠금 해제 (PIN 설정 시 다이얼로그, 미설정 시 1.5초 꾹 누르기)
        const unlockBtn = document.getElementById('btnParentUnlock');
        if (unlockBtn) {
            const toggleUnlockState = () => {
                state.parentUnlocked = !state.parentUnlocked;
                unlockBtn.textContent = state.parentUnlocked ? '🔓 부모 잠금 해제됨 (잠그기)' : '🔒 부모 잠금 해제 (2초 꾹 / PIN)';
                document.querySelectorAll('.level-stepper').forEach((el) => {
                    el.hidden = !state.parentUnlocked;
                });
                if (state.parentUnlocked) showToast('어른 잠금이 해제되었어요! 레벨을 조절할 수 있습니다.');
            };

            const startHold = () => {
                if (state.parentUnlocked) return;
                if (state.hasParentPin) return;
                clearTimeout(state.holdTimer);
                state.holdTimer = setTimeout(() => {
                    toggleUnlockState();
                }, 1400);
            };
            const cancelHold = () => clearTimeout(state.holdTimer);

            unlockBtn.addEventListener('pointerdown', startHold);
            unlockBtn.addEventListener('pointerup', cancelHold);
            unlockBtn.addEventListener('pointerleave', cancelHold);
            unlockBtn.addEventListener('pointercancel', cancelHold);

            unlockBtn.addEventListener('click', () => {
                if (state.parentUnlocked) {
                    toggleUnlockState();
                    return;
                }
                if (state.hasParentPin && pinDialog) {
                    if (pinError) pinError.textContent = '';
                    if (pinInput) pinInput.value = '';
                    pinDialog.showModal();
                } else {
                    showToast('버튼을 1.5초간 꾹 누르면 어른 잠금이 해제돼요!');
                }
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

        const btnConfirmPin = document.getElementById('btnConfirmParentPin');
        if (btnConfirmPin) {
            btnConfirmPin.addEventListener('click', () => {
                const entered = (pinInput?.value || '').trim();
                if (!/^\d{4,6}$/.test(entered)) {
                    if (pinError) pinError.textContent = '숫자 4~6자리 PIN을 입력해 주세요.';
                    return;
                }
                state.parentPinValue = entered;
                state.parentUnlocked = true;
                pinDialog.close();
                document.getElementById('btnParentUnlock').textContent = '🔓 부모 잠금 해제됨 (잠그기)';
                document.querySelectorAll('.level-stepper').forEach((el) => { el.hidden = false; });
                showToast('어른 잠금이 해제되었어요!');
            });
        }

        // 종이 학습지 수동 도장 적립
        const btnPaper = document.getElementById('btnPaperStamp');
        if (btnPaper) {
            btnPaper.addEventListener('click', async () => {
                btnPaper.disabled = true;
                try {
                    const res = await fetch('/api/study/stamps/paper', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ childId: state.childId })
                    });
                    const data = await res.json();
                    showToast(data.message || '도장을 찍었어요!');
                    await loadDashboard();
                } catch (e) {
                    showToast('도장 적립에 실패했어요.');
                } finally {
                    btnPaper.disabled = false;
                }
            });
        }

        // 맞춤 학습지 생성
        const btnGen = document.getElementById('btnGenerateSheet');
        if (btnGen) {
            btnGen.addEventListener('click', async () => {
                const customVal = (document.getElementById('customThemeInput')?.value || '').trim();
                const theme = customVal || state.selectedTheme || '동물 친구';
                btnGen.disabled = true;
                const origText = btnGen.textContent;
                btnGen.textContent = '✨ 재미있는 학습지를 만들고 있어요...';
                try {
                    const res = await fetch('/api/study/sheets/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            childId: state.childId,
                            subject: state.selectedSubject,
                            theme
                        })
                    });
                    const data = await res.json();
                    if (data.success && data.sheet) {
                        window.location.href = `/study/sheet/${data.sheet.id}`;
                    } else {
                        showToast(data.message || '학습지 생성에 실패했어요.');
                        btnGen.disabled = false;
                        btnGen.textContent = origText;
                    }
                } catch (err) {
                    showToast('학습지를 만드는 중 문제가 생겼어요.');
                    btnGen.disabled = false;
                    btnGen.textContent = origText;
                }
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        loadDashboard();
    });
})();
