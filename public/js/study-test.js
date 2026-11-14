/**
 * ==============================================================================
 * 5분 탐험 수준 테스트 제어기 (study-test.js)
 * ------------------------------------------------------------------------------
 * - Lv.3 시작 -> 정답/오답에 따라 Lv.1~5 계단식 분기
 * - Web Speech TTS 음성 읽어주기 지원
 * ==============================================================================
 */

(function () {
    'use strict';

    const SUBJECT_NAMES = {
        korean: '🇰🇷 한글 탐험',
        math: '🔢 숫자·수학 탐험',
        english: '🔤 영어 탐험'
    };

    const params = new URLSearchParams(window.location.search);
    const childId = params.get('childId') || 'first';

    let testId = null;
    let activeQuestion = null;
    let isLocked = false;

    function speakText(text, lang = 'ko-KR', triggerBtn = null) {
        if (!text) return;
        if (window.StudyTTS && typeof window.StudyTTS.speak === 'function') {
            window.StudyTTS.speak(text, lang, triggerBtn);
            return;
        }
        if (!('speechSynthesis' in window)) return;
        try {
            const utter = new SpeechSynthesisUtterance(String(text));
            utter.lang = lang;
            utter.rate = 0.88;
            window.speechSynthesis.speak(utter);
        } catch (e) {}
    }

    async function beginTest() {
        document.getElementById('btnBackToStudy').href = `/study?childId=${encodeURIComponent(childId)}`;
        document.getElementById('btnFinishReturn').href = `/study?childId=${encodeURIComponent(childId)}`;

        try {
            const res = await fetch('/api/study/test/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ childId })
            });
            const data = await res.json();
            if (!data.success) {
                document.getElementById('testPrompt').textContent = data.message || '테스트를 시작할 수 없어요.';
                return;
            }
            testId = data.testId;
            renderQuestion(data.question, data.progress);
        } catch (err) {
            document.getElementById('testPrompt').textContent = '서버 연결에 실패했어요.';
        }
    }

    function renderQuestion(q, progress) {
        activeQuestion = q;
        isLocked = false;

        document.getElementById('testSubjectBadge').textContent = `${SUBJECT_NAMES[q.subject] || q.subject} (Lv.${q.level})`;
        document.getElementById('testStepLabel').textContent = `${progress.current} / ${progress.total}`;
        document.getElementById('testProgressBar').value = progress.current;
        document.getElementById('testPrompt').textContent = q.prompt;
        document.getElementById('testVisualBox').textContent = q.visual || '✨';
        document.getElementById('testEquationText').textContent = q.equationText || '';
        document.getElementById('testFeedbackBanner').textContent = '';

        const grid = document.getElementById('testChoicesGrid');
        grid.innerHTML = '';
        (q.choices || []).forEach((choice) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn';
            btn.textContent = choice;
            btn.addEventListener('click', () => handleChoice(btn, choice));
            grid.appendChild(btn);
        });
    }

    async function handleChoice(btnEl, choice) {
        if (isLocked || !testId) return;
        isLocked = true;

        try {
            const res = await fetch(`/api/study/test/${testId}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ choice })
            });
            const data = await res.json();
            const feedback = document.getElementById('testFeedbackBanner');

            if (data.lastCorrect) {
                btnEl.classList.add('correct');
                if (feedback) feedback.textContent = '딩동댕! 정말 잘했어요! 🌟';
            } else {
                btnEl.classList.add('wrong');
                if (feedback) feedback.textContent = `괜찮아요! 정답은 "${data.correctAnswer}" 예요 😊`;
            }

            setTimeout(() => {
                if (data.status === 'completed') {
                    showFinalResult(data.result);
                } else if (data.question) {
                    renderQuestion(data.question, data.progress);
                }
            }, 950);
        } catch (err) {
            isLocked = false;
        }
    }

    function showFinalResult(result) {
        document.getElementById('testProgressCard').hidden = true;
        document.getElementById('testQuestionCard').hidden = true;
        const resultCard = document.getElementById('testResultCard');
        resultCard.hidden = false;

        document.getElementById('testResultSummary').textContent =
            `총 ${result.totalCount}문제 중 ${result.correctCount}문제를 맞히며 멋지게 탐험했어요!`;

        const levels = result.levels || {};
        document.getElementById('testResultLevels').innerHTML = ['korean', 'math', 'english'].map((s) => {
            const lv = levels[s] || 1;
            return `
                <article class="level-tile">
                    <div class="level-tile-head">
                        <span>${SUBJECT_NAMES[s]}</span>
                        <span class="level-badge">Lv.${lv}</span>
                    </div>
                    <div class="level-stars">${'⭐'.repeat(lv)}${'☆'.repeat(5 - lv)}</div>
                </article>
            `;
        }).join('');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const speakBtn = document.getElementById('btnSpeakQuestion');
        if (speakBtn) {
            speakBtn.addEventListener('click', () => {
                if (activeQuestion) speakText(activeQuestion.ttsText || activeQuestion.prompt, activeQuestion.ttsLang || 'ko-KR', speakBtn);
            });
        }
        beginTest();
    });
})();
