/**
 * ==============================================================================
 * 대시보드 '오늘의 3종 미션' 카드 위젯 (study-missions.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 6] 360px 모바일~태블릿 대응
 * ==============================================================================
 */

(function () {
    'use strict';

    const SUBJ_META = {
        korean: { icon: '🇰🇷', name: '한글' },
        english: { icon: '🔤', name: '영어' },
        math: { icon: '🔢', name: '수학' },
        logic: { icon: '🧩', name: '퍼즐' },
        reading: { icon: '📖', name: '동화' },
        science: { icon: '🌱', name: '과학' },
        music: { icon: '🎹', name: '피아노' },
        coloring: { icon: '🎨', name: '색칠' }
    };

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function launchMissionSlot(childId, slotIndex, preferredSubject, triggerBtn, toastFn) {
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.dataset.prevText = triggerBtn.textContent;
            triggerBtn.textContent = '✨ 준비 중...';
        }
        try {
            const res = await fetch('/api/study/missions/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ childId, slotIndex, subject: preferredSubject || '' })
            });
            const data = await res.json();
            if (data.success && data.url) {
                window.location.href = data.url;
                return;
            }
            toastFn?.(data.message || '미션을 시작하지 못했어요.');
        } catch (_) {
            toastFn?.('서버 연결을 확인해 주세요.');
        } finally {
            if (triggerBtn) {
                triggerBtn.disabled = false;
                if (triggerBtn.dataset.prevText) triggerBtn.textContent = triggerBtn.dataset.prevText;
            }
        }
    }

    function renderMissionsCard(missionsState, childId, toastFn) {
        const mount = document.getElementById('dailyMissionsMount');
        if (!mount) return;
        if (!missionsState || missionsState.enabled === false) {
            mount.hidden = true;
            mount.innerHTML = '';
            return;
        }
        mount.hidden = false;

        const list = Array.isArray(missionsState.missions) ? missionsState.missions : [];
        const doneCount = Number(missionsState.completedCount || 0);
        const total = Math.max(3, list.length || 3);
        const nextPending = list.find((m) => m.status !== 'completed') || list[0];

        const badgeText = missionsState.allCompleted
            ? '🎉 3종 미션 올클리어! (보너스 ⭐+🍬 지급됨)'
            : `오늘 진행: ${doneCount} / ${total}`;

        mount.innerHTML = `
            <div class="study-card study-missions-card">
                <div class="study-card-head">
                    <div>
                        <h2 class="study-card-title">🚀 오늘의 3종 미션</h2>
                        <p class="missions-sub-desc">기초(한글·영어) + 수학·퍼즐 + 동화·과학·피아노 3가지를 끝내면 <strong>보너스 칭찬 도장 ⭐ + 별사탕 🍬</strong>을 받아요!</p>
                    </div>
                    <span class="level-badge ${missionsState.allCompleted ? 'is-all-done' : ''}">${badgeText}</span>
                </div>
                <div class="missions-grid">
                    ${list.map((m) => {
                        const isDone = m.status === 'completed';
                        const subjInfo = SUBJ_META[m.subject] || { icon: m.emoji, name: m.subject };
                        const altPills = (m.acceptedSubjects || []).map((sk) => {
                            const info = SUBJ_META[sk] || { icon: '🌟', name: sk };
                            return `<button type="button" class="mission-mini-subj ${m.subject === sk ? 'is-default' : ''}" data-slot="${m.slotIndex}" data-subj="${sk}">${info.icon} ${info.name}</button>`;
                        }).join('');
                        return `
                            <article class="mission-slot-card ${isDone ? 'is-done' : ''}">
                                <div class="mission-slot-head">
                                    <span class="mission-slot-num">${isDone ? '✅' : `미션 ${m.slotIndex}`}</span>
                                    <span class="mission-slot-pick">${subjInfo.icon} ${escapeHtml(subjInfo.name)}</span>
                                </div>
                                <h3 class="mission-slot-title">${escapeHtml(m.title)}</h3>
                                <p class="mission-slot-desc">${escapeHtml(m.description)}</p>
                                <div class="mission-alt-row">${altPills}</div>
                                <button type="button" class="study-btn ${isDone ? 'study-btn-outline' : 'study-btn-primary'} mission-start-btn" data-slot="${m.slotIndex}" data-subj="${escapeHtml(m.subject)}">
                                    ${isDone ? '🔁 한 번 더 풀기' : '▶ 이 미션 시작!'}
                                </button>
                            </article>
                        `;
                    }).join('')}
                </div>
                ${nextPending && !missionsState.allCompleted ? `
                    <button type="button" id="btnQuickStartNextMission" class="study-btn study-btn-green missions-hero-cta">
                        🚀 ${nextPending.slotIndex}번 미션 (${escapeHtml(SUBJ_META[nextPending.subject]?.name || nextPending.title)}) 바로 시작하기!
                    </button>
                ` : ''}
            </div>
        `;

        mount.querySelectorAll('.mission-start-btn, .mission-mini-subj').forEach((btn) => {
            btn.addEventListener('click', () => {
                window.StudyFx?.tap?.();
                launchMissionSlot(childId, Number(btn.dataset.slot), btn.dataset.subj, btn, toastFn);
            });
        });

        document.getElementById('btnQuickStartNextMission')?.addEventListener('click', (e) => {
            window.StudyFx?.tap?.();
            launchMissionSlot(childId, nextPending.slotIndex, nextPending.subject, e.currentTarget, toastFn);
        });
    }

    window.StudyMissions = { renderMissionsCard };
})();
