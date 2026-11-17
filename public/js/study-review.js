/**
 * ==============================================================================
 * 틀린 문제 복습 노트 인터랙션 모듈 (study-review.js)
 * ------------------------------------------------------------------------------
 * - 저장된 오답 문제(quiz/count/match)를 2회 기회 규칙으로 재풀이
 * - 학습지의 모든 오답을 맞추면 보류되었던 별(칭찬 도장)을 즉시 지급
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    const SUBJECT_NAMES = {
        korean: '🇰🇷 한글',
        math: '🔢 수학',
        english: '🔤 영어'
    };

    const params = new URLSearchParams(window.location.search);
    const state = {
        childId: params.get('childId') || 'first',
        status: 'pending',
        subject: 'all',
        items: [],
        stats: { pendingCount: 0, resolvedCount: 0 }
    };

    const toastEl = document.getElementById('studyToast');

    function showToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.hidden = false;
        clearTimeout(toastEl._timer);
        toastEl._timer = setTimeout(() => { toastEl.hidden = true; }, 3400);
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function speakText(text, lang = 'ko-KR', triggerBtn = null) {
        if (!text) return;
        if (window.StudyTTS && typeof window.StudyTTS.speak === 'function') {
            window.StudyTTS.speak(text, lang, triggerBtn);
            return;
        }
        if (!('speechSynthesis' in window)) return;
        try {
            const u = new SpeechSynthesisUtterance(String(text));
            u.lang = lang;
            u.rate = 0.88;
            window.speechSynthesis.speak(u);
        } catch (_) {}
    }

    async function loadWrongNotes() {
        const container = document.getElementById('reviewNotesContainer');
        const backBtn = document.getElementById('btnBackFromReview');
        if (backBtn) backBtn.href = `/study?childId=${encodeURIComponent(state.childId)}`;

        try {
            const qs = new URLSearchParams({
                childId: state.childId,
                status: state.status,
                subject: state.subject
            });
            const res = await fetch(`/api/study/wrong-notes?${qs.toString()}`, { credentials: 'include' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                if (container) container.innerHTML = `<p>${escapeHtml(data.message || '복습 문제를 불러오지 못했어요.')}</p>`;
                return;
            }
            if (data.childId) state.childId = data.childId;
            if (backBtn) backBtn.href = `/study?childId=${encodeURIComponent(state.childId)}`;
            state.items = Array.isArray(data.items) ? data.items : [];
            state.stats = data.stats || { pendingCount: 0, resolvedCount: 0 };
            renderHeaderStats();
            renderNotesList();
        } catch (_) {
            if (container) container.innerHTML = '<p>서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.</p>';
        }
    }

    function renderHeaderStats() {
        const metaEl = document.getElementById('reviewMetaLine');
        const badgeEl = document.getElementById('reviewCountBadge');
        const p = Number(state.stats?.pendingCount || 0);
        const r = Number(state.stats?.resolvedCount || 0);
        if (metaEl) metaEl.textContent = `복습할 문제 ${p}개 · 해결한 문제 ${r}개`;
        if (badgeEl) badgeEl.textContent = p > 0 ? `대기 ${p}문제` : '모두 해결! 🌟';
    }

    async function submitNoteAttempt(note, isCorrect, selectedAnswer, cardEl) {
        try {
            const res = await fetch(`/api/study/wrong-notes/${note.id}/attempt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    childId: state.childId,
                    isCorrect,
                    selectedAnswer
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) return;

            if (data.stats) {
                state.stats = data.stats;
                renderHeaderStats();
            }

            if (data.resolved) {
                cardEl.classList.add('is-resolved');
                showToast(data.message || '복습 문제를 맞췄어요! ⭐');
                if (data.stampAwarded) {
                    window.StudyFx?.fanfare?.();
                    window.StudyFx?.celebrate?.({ big: Boolean(data.reachedTen) });
                } else {
                    window.StudyFx?.correct?.();
                }
                if (state.status === 'pending') {
                    setTimeout(() => {
                        state.items = state.items.filter((it) => it.id !== note.id);
                        renderNotesList();
                    }, 1250);
                }
            } else {
                showToast(data.message || '아쉬워요! 다시 도전해 보아요 💪');
                if (!cardEl.querySelector('.review-retry-single-btn')) {
                    const retryBtn = document.createElement('button');
                    retryBtn.type = 'button';
                    retryBtn.className = 'study-btn study-btn-outline review-retry-single-btn';
                    retryBtn.textContent = '🔄 이 문제 다시 풀어보기';
                    retryBtn.addEventListener('click', () => renderSingleNoteCard(note, cardEl));
                    cardEl.appendChild(retryBtn);
                }
            }
        } catch (_) {
            showToast('복습 결과를 저장하지 못했어요.');
        }
    }

    function renderSingleNoteCard(note, existingCard = null) {
        const card = existingCard || document.createElement('article');
        const isResolvedView = note.status === 'resolved';
        card.className = `review-note-card${isResolvedView ? ' is-resolved' : ''}`;

        const subjText = SUBJECT_NAMES[note.subject] || note.subject;
        const blk = note.block || {};
        const sheetInfo = note.sheetTitle ? ` · ${note.sheetTitle}` : '';
        const wrongBadge = isResolvedView
            ? '<span class="block-status-chip" data-state="correct">✅ 복습 완료!</span>'
            : `<span class="block-status-chip" data-state="retrying">❌ ${Number(note.wrongCount || 1)}번 틀림</span>`;

        card.innerHTML = `
            <div class="review-note-meta">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span class="level-badge">${escapeHtml(subjText)} Lv.${escapeHtml(note.level)}</span>
                    ${wrongBadge}
                    <span style="font-size:0.8rem; color:#64748b; font-weight:700;">${escapeHtml(sheetInfo)}</span>
                </div>
                <button type="button" class="study-btn study-btn-secondary btn-block-tts" style="min-block-size:38px; padding:6px 12px; font-size:0.86rem;">🔊 듣기</button>
            </div>
            <p class="block-prompt">${escapeHtml(blk.prompt || note.promptText || '')}</p>
            <div class="review-note-body"></div>
        `;

        card.querySelector('.btn-block-tts')?.addEventListener('click', (ev) => {
            speakText(blk.ttsText || blk.prompt, blk.ttsLang || 'ko-KR', ev.currentTarget);
        });

        const bodyEl = card.querySelector('.review-note-body');
        const opts = {
            initialState: isResolvedView ? 'correct' : null,
            onStateChange: (info) => {
                if (isResolvedView) return;
                if (info.status === 'correct') {
                    submitNoteAttempt(note, true, info.finalAnswer || '', card);
                } else if (info.status === 'wrong') {
                    submitNoteAttempt(note, false, info.lastWrongAnswer || '', card);
                }
            }
        };

        if (blk.type === 'count') {
            window.StudySheetResult?.renderCountBlock?.(bodyEl, blk, speakText, opts);
        } else if (blk.type === 'match' && window.StudyPlayBlocks) {
            window.StudyPlayBlocks.renderMatchBlock(bodyEl, blk, speakText, showToast, { subject: note.subject }, opts);
        } else {
            window.StudySheetResult?.renderQuizBlock?.(bodyEl, blk, note.subject, speakText, opts);
        }

        return card;
    }

    function renderNotesList() {
        const container = document.getElementById('reviewNotesContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!state.items.length) {
            const msg = state.status === 'pending'
                ? '🎉 와! 지금 복습할 틀린 문제가 하나도 없어요! 참 잘했어요 🌟'
                : '아직 복습을 끝낸 문제 기록이 없어요.';
            container.innerHTML = `
                <section class="study-card" style="text-align:center; padding:28px 16px;">
                    <p style="font-size:1.08rem; font-weight:800; color:#334155; margin:0 0 14px;">${msg}</p>
                    <a href="/study?childId=${encodeURIComponent(state.childId)}" class="study-link-btn study-btn-primary">🎒 학습실로 돌아가기</a>
                </section>
            `;
            return;
        }

        const ttsItems = [];
        state.items.forEach((note) => {
            const card = renderSingleNoteCard(note);
            container.appendChild(card);
            const b = note.block;
            if (b) {
                ttsItems.push({ text: b.ttsText || b.prompt, lang: b.ttsLang || 'ko-KR' });
                if (b.type === 'match' && Array.isArray(b.pairs)) {
                    const isLang = note.subject === 'korean' || note.subject === 'english';
                    b.pairs.forEach((p) => {
                        const w = p.ttsText || (isLang ? p.right : '');
                        if (w) ttsItems.push({ text: w, lang: p.ttsLang || (note.subject === 'english' ? 'en-US' : 'ko-KR') });
                    });
                }
            }
        });
        window.StudyTTS?.prefetch?.(ttsItems);
    }

    function bindFilters() {
        document.querySelectorAll('#reviewStatusTabs .review-filter-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.status = btn.dataset.status || 'pending';
                document.querySelectorAll('#reviewStatusTabs .review-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
                loadWrongNotes();
            });
        });

        document.querySelectorAll('#reviewSubjectTabs .review-filter-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.subject = btn.dataset.subject || 'all';
                document.querySelectorAll('#reviewSubjectTabs .review-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
                loadWrongNotes();
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindFilters();
        loadWrongNotes();
    });
})();
