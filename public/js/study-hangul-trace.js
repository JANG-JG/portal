/**
 * ==============================================================================
 * 한글 획순 애니메이션 & 따라쓰기 순서 힌트 모듈 (study-hangul-trace.js)
 * ------------------------------------------------------------------------------
 * - mirodn/hangul-writer 기반 획순 데모(👀 쓰는 순서) + 퀴즈(✍️ 순서대로)
 * - 자유 S펜 캔버스 모드를 그대로 보존하면서 한글 글자에만 스마트 강화 적용
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

(function () {
    'use strict';

    const HANGUL_CHAR_RE = /^[\u3131-\u318E\uAC00-\uD7A3]$/;

    function isHangulChar(ch) {
        return HANGUL_CHAR_RE.test(String(ch || ''));
    }

    function prefersReducedMotion() {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function isGuideFeatureEnabled() {
        if (window.StudyTabletConfig && typeof window.StudyTabletConfig.hangulGuideEnabled === 'boolean') {
            return window.StudyTabletConfig.hangulGuideEnabled;
        }
        return true;
    }

    function enhanceTraceBlock({ meta, wrap, rawWord, speakFn, toastFn, onSelectFreeMode }) {
        if (!meta || !wrap || !window.HangulWriter || !isGuideFeatureEnabled()) return null;

        const chars = Array.from(String(rawWord || '').trim());
        const hangulChars = chars.filter(isHangulChar);
        if (!hangulChars.length) return null;

        const toolbar = meta.querySelector('.trace-toolbar');
        const guide = wrap.querySelector('.trace-guide');
        if (!toolbar || !guide) return null;

        const boxList = Array.from(guide.querySelectorAll('.trace-char-box'));
        if (!boxList.length) return null;

        // 1. 툴바 버튼 추가: 👀 쓰는 순서 / ✍️ 순서대로
        const animBtn = document.createElement('button');
        animBtn.type = 'button';
        animBtn.className = 'study-btn study-btn-secondary trace-tool-btn';
        animBtn.dataset.hangulAction = 'animate';
        animBtn.textContent = '👀 쓰는 순서';

        const quizBtn = document.createElement('button');
        quizBtn.type = 'button';
        quizBtn.className = 'study-btn study-btn-outline trace-tool-btn';
        quizBtn.dataset.hangulAction = 'quiz';
        quizBtn.setAttribute('aria-pressed', 'false');
        quizBtn.textContent = '🎯 획순 퀴즈';

        const clearBtn = toolbar.querySelector('.btn-clear-canvas');
        if (clearBtn) {
            toolbar.insertBefore(animBtn, clearBtn);
            toolbar.insertBefore(quizBtn, clearBtn);
        } else {
            toolbar.append(animBtn, quizBtn);
        }

        // 2. 글자별 HangulWriter 오버레이 생성
        const hintEl = document.createElement('p');
        hintEl.className = 'trace-hw-hint no-print';
        hintEl.setAttribute('aria-live', 'polite');
        hintEl.textContent = '👀 "쓰는 순서"로 획순을 보거나, 자유롭게 따라 써 보세요!';
        wrap.insertAdjacentElement('afterend', hintEl);

        const hwSlots = [];
        let charIdxCursor = 0;

        chars.forEach((ch) => {
            if (/\s/.test(ch)) return;
            const boxEl = boxList[charIdxCursor++];
            if (!boxEl || !isHangulChar(ch)) return;

            const host = document.createElement('div');
            host.className = 'trace-hw-slot';
            boxEl.appendChild(host);
            hwSlots.push({ ch, boxEl, host, writer: null });
        });

        let activeQuizIdx = -1;
        let mode = 'free'; // 'free' | 'animate' | 'quiz'

        function getWriterSize(boxEl) {
            const rect = boxEl.getBoundingClientRect();
            const w = Math.max(76, Math.min(138, Math.floor((rect.width || 110) * 0.92)));
            const h = Math.max(76, Math.min(138, Math.floor((rect.height || 110) * 0.92)));
            return Math.min(w, h);
        }

        function ensureWriters() {
            const reduced = prefersReducedMotion();
            hwSlots.forEach((slot) => {
                if (slot.writer) return;
                const size = getWriterSize(slot.boxEl);
                try {
                    slot.writer = window.HangulWriter.create(slot.host, slot.ch, {
                        width: size,
                        height: size,
                        padding: 6,
                        strokeColor: '#ea580c',
                        outlineColor: '#cbd5e1',
                        highlightColor: '#2563eb',
                        drawingColor: '#ea580c',
                        drawingWidth: 16,
                        strokeAnimationSpeed: reduced ? 4 : 1.15,
                        delayBetweenStrokes: reduced ? 60 : 280,
                        showCharacter: false,
                        showOutline: true,
                        showHintAfterMisses: 1,
                        acceptBackwardsStrokes: false
                    });
                } catch (_) {
                    slot.writer = null;
                }
            });
        }

        function syncModeUi(nextMode) {
            mode = nextMode;
            wrap.classList.toggle('is-hw-active', nextMode !== 'free');
            wrap.classList.toggle('is-hw-quiz', nextMode === 'quiz');
            quizBtn.classList.toggle('active', nextMode === 'quiz');
            quizBtn.setAttribute('aria-pressed', nextMode === 'quiz' ? 'true' : 'false');
            hwSlots.forEach((s, i) => {
                s.boxEl.classList.toggle('is-hw-focus', nextMode === 'quiz' && i === activeQuizIdx);
            });
        }

        function cancelAllHw() {
            activeQuizIdx = -1;
            hwSlots.forEach((s) => {
                if (!s.writer) return;
                try {
                    if (typeof s.writer.cancelQuiz === 'function') s.writer.cancelQuiz();
                    s.writer.hideCharacter();
                } catch (_) { /* ignore */ }
            });
            syncModeUi('free');
        }

        function playSequenceAnimation() {
            ensureWriters();
            if (!hwSlots.some((s) => s.writer)) {
                if (toastFn) toastFn('이 글자는 자유 쓰기로 연습해 보아요!');
                return;
            }
            cancelAllHw();
            syncModeUi('animate');
            if (window.StudyFx) window.StudyFx.tap();
            hintEl.style.color = '#0284c7';
            hintEl.textContent = '👀 주황색 선이 움직이는 방향대로 눈으로 먼저 따라가 보아요!';
            if (speakFn) speakFn(`${rawWord} 쓰는 순서를 함께 보아요!`, 'ko-KR');

            let idx = 0;
            const runNext = () => {
                if (mode !== 'animate') return;
                if (idx >= hwSlots.length) {
                    hintEl.style.color = '#047857';
                    hintEl.textContent = '✨ 순서를 다 봤어요! 이제 직접 따라 써 보거나 획순 퀴즈에 도전해 보세요!';
                    setTimeout(() => {
                        if (mode === 'animate') cancelAllHw();
                    }, 1200);
                    return;
                }
                const slot = hwSlots[idx];
                idx += 1;
                if (!slot.writer) {
                    runNext();
                    return;
                }
                slot.boxEl.classList.add('is-hw-focus');
                slot.writer.animateCharacter({
                    onComplete: () => {
                        slot.boxEl.classList.remove('is-hw-focus');
                        setTimeout(runNext, 220);
                    }
                });
            };
            runNext();
        }

        function runQuizAt(idx) {
            if (mode !== 'quiz') return;
            if (idx >= hwSlots.length) {
                activeQuizIdx = -1;
                syncModeUi('quiz');
                hintEl.style.color = '#047857';
                hintEl.textContent = `🎉 우와! '${rawWord}' 글자 획순을 모두 완벽하게 썼어요!`;
                if (window.StudyFx) {
                    window.StudyFx.correct();
                    window.StudyFx.celebrate({ big: false });
                }
                if (speakFn) speakFn(`우와! ${rawWord}를 순서대로 정말 잘 썼어요!`, 'ko-KR');
                return;
            }
            const slot = hwSlots[idx];
            if (!slot.writer) {
                runQuizAt(idx + 1);
                return;
            }
            activeQuizIdx = idx;
            syncModeUi('quiz');
            hintEl.style.color = '#c2410c';
            hintEl.textContent = `✍️ ${idx + 1}번째 글자 '${slot.ch}'를 파란 반짝 힌트 방향대로 따라 써 보세요!`;

            slot.writer.quiz({
                onCorrectStroke: () => {
                    if (window.StudyFx) window.StudyFx.tap();
                },
                onMistake: (strokeData) => {
                    if (window.StudyFx) window.StudyFx.retry();
                    const msg = strokeData && strokeData.isBackwards
                        ? `방향이 반대예요! '${slot.ch}' 반짝이는 파란 화살표 방향대로 위에서 아래, 왼쪽에서 오른쪽으로 그려 보세요!`
                        : `'${slot.ch}' 파란색으로 반짝이는 선의 순서대로 천천히 그려 볼까요? 😊`;
                    hintEl.style.color = '#d97706';
                    hintEl.textContent = msg;
                },
                onComplete: () => {
                    if (window.StudyFx) window.StudyFx.tap();
                    setTimeout(() => runQuizAt(idx + 1), 350);
                }
            });
        }

        animBtn.addEventListener('click', playSequenceAnimation);

        quizBtn.addEventListener('click', () => {
            if (mode === 'quiz') {
                cancelAllHw();
                if (typeof onSelectFreeMode === 'function') onSelectFreeMode('pen');
                hintEl.style.color = '#475569';
                hintEl.textContent = '✏️ 자유 쓰기 모드로 돌아왔어요!';
                return;
            }
            ensureWriters();
            if (!hwSlots.some((s) => s.writer)) {
                if (toastFn) toastFn('이 단어는 자유 쓰기로 연습해 주세요!');
                return;
            }
            cancelAllHw();
            mode = 'quiz';
            runQuizAt(0);
        });

        toolbar.querySelectorAll('[data-tool]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (mode !== 'free') {
                    cancelAllHw();
                    hintEl.style.color = '#475569';
                    hintEl.textContent = '✏️ S펜이나 손가락으로 자유롭게 써 보세요!';
                }
            });
        });

        return {
            reset: () => {
                cancelAllHw();
                hintEl.style.color = '#475569';
                hintEl.textContent = '👀 "쓰는 순서"로 획순을 보거나, 자유롭게 따라 써 보세요!';
            }
        };
    }

    window.StudyHangulTrace = {
        enhanceTraceBlock,
        isHangulChar
    };
})();
