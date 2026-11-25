/**
 * ==============================================================================
 * 영어 파닉스 알파벳 조합 놀이 렌더러 (study-play-phonics.js)
 * ------------------------------------------------------------------------------
 * - ARASAAC 그림카드 + 원어민 발음 + 알파벳 자석 터치 조합 놀이
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 44px+ 터치
 * ==============================================================================
 */

(function () {
    'use strict';

    function renderPhonicsBlendBlock(container, blk, speakFn, toastFn, opts = {}) {
        const answerLetters = Array.isArray(blk.answerLetters) && blk.answerLetters.length
            ? blk.answerLetters.map((c) => String(c).toUpperCase())
            : Array.from(String(blk.targetWord || 'CAT').toUpperCase()).filter((c) => /[A-Z]/.test(c));
        const poolLetters = Array.isArray(blk.poolLetters) && blk.poolLetters.length ? blk.poolLetters : answerLetters;
        const alreadyDone = opts.initialState === 'correct';
        let selected = alreadyDone ? [...answerLetters] : [];
        let wrongCount = 0;
        let locked = alreadyDone;

        const stage = document.createElement('div');
        stage.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:12px; padding:14px; border-radius:16px; background:#f8fafc; border:2px dashed #cbd5e1;';

        const hero = document.createElement('div');
        hero.style.cssText = 'display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:center;';
        if (blk.imageUrl) {
            const img = Object.assign(document.createElement('img'), {
                src: blk.imageUrl,
                alt: blk.meaningKo || blk.targetWord || '그림',
                className: 'quiz-pictogram-img'
            });
            img.onerror = () => {
                img.replaceWith(Object.assign(document.createElement('span'), {
                    textContent: blk.emoji || '🔤',
                    style: 'font-size:2.8rem; line-height:1;'
                }));
            };
            hero.appendChild(img);
        } else {
            hero.appendChild(Object.assign(document.createElement('span'), {
                textContent: blk.emoji || '🔤',
                style: 'font-size:2.8rem; line-height:1;'
            }));
        }

        const hearBtn = Object.assign(document.createElement('button'), {
            type: 'button',
            className: 'study-btn study-btn-secondary',
            textContent: `🔊 ${blk.meaningKo ? `${blk.meaningKo} 듣기` : '단어 듣기'}`
        });
        hearBtn.style.minBlockSize = '44px';
        const playWord = () => {
            if (blk.audioUrl) {
                new Audio(blk.audioUrl).play().catch(() => typeof speakFn === 'function' && speakFn(blk.ttsText || answerLetters.join(''), 'en-US'));
            } else if (typeof speakFn === 'function') {
                speakFn(blk.ttsText || answerLetters.join(''), 'en-US');
            }
        };
        hearBtn.addEventListener('click', playWord);
        hero.appendChild(hearBtn);

        const slotsWrap = document.createElement('div');
        slotsWrap.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; justify-content:center;';

        const poolWrap = document.createElement('div');
        poolWrap.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; justify-content:center;';

        const feedback = document.createElement('div');
        feedback.style.cssText = 'font-weight:800; font-size:0.95rem; min-height:24px; text-align:center;';
        if (alreadyDone) {
            feedback.textContent = `🎉 완성! "${answerLetters.join('')}" (${blk.meaningKo || ''}) ⭐`;
            feedback.style.color = '#15803d';
        }

        const renderSlots = () => {
            slotsWrap.innerHTML = '';
            answerLetters.forEach((_, idx) => {
                const filled = selected[idx] || '';
                const box = document.createElement('div');
                box.textContent = filled || '?';
                box.style.cssText = `width:48px; height:52px; display:flex; align-items:center; justify-content:center; border-radius:12px; font-size:1.35rem; font-weight:900; border:2px solid ${filled ? '#3b82f6' : '#cbd5e1'}; background:${filled ? '#eff6ff' : '#fff'}; color:${filled ? '#1d4ed8' : '#94a3b8'};`;
                slotsWrap.appendChild(box);
            });
        };

        const tileBtns = [];
        const resetSelection = () => {
            selected = [];
            tileBtns.forEach((b) => { b.disabled = false; b.style.opacity = '1'; });
            renderSlots();
        };

        poolLetters.forEach((letter) => {
            const btn = Object.assign(document.createElement('button'), {
                type: 'button',
                className: 'study-btn study-btn-outline',
                textContent: String(letter).toUpperCase()
            });
            btn.style.cssText = 'min-width:50px; min-height:50px; font-size:1.25rem; font-weight:900; padding:6px 12px;';
            btn.disabled = alreadyDone;
            tileBtns.push(btn);

            btn.addEventListener('click', () => {
                if (locked) return;
                const ch = String(letter).toUpperCase();
                selected.push(ch);
                btn.disabled = true;
                btn.style.opacity = '0.45';
                if (window.StudyFx) window.StudyFx.tap();
                if (typeof speakFn === 'function') speakFn(ch.toLowerCase(), 'en-US');
                renderSlots();

                if (selected.length === answerLetters.length) {
                    const got = selected.join('');
                    const expected = answerLetters.join('');
                    if (got === expected) {
                        locked = true;
                        feedback.textContent = `🎉 정답! "${expected}" (${blk.meaningKo || ''}) 참 잘했어요! ⭐`;
                        feedback.style.color = '#15803d';
                        setTimeout(playWord, 250);
                        if (window.StudyFx) window.StudyFx.celebrate();
                        opts.onStateChange?.({ status: 'correct', attempts: wrongCount + 1, wrongCount, finalAnswer: got, tiles: selected });
                        if (typeof toastFn === 'function') toastFn(`🔤 ${expected} 파닉스 완성!`);
                    } else {
                        wrongCount += 1;
                        feedback.textContent = `아쉬워요! (${got}) 다시 순서대로 눌러 볼까요?`;
                        feedback.style.color = '#dc2626';
                        opts.onStateChange?.({ status: 'wrong', attempts: wrongCount, wrongCount, finalAnswer: got, tiles: selected });
                        setTimeout(resetSelection, 650);
                    }
                }
            });
            poolWrap.appendChild(btn);
        });

        const clearBtn = Object.assign(document.createElement('button'), {
            type: 'button',
            className: 'study-btn study-btn-outline no-print',
            textContent: '↩️ 다시 고르기'
        });
        clearBtn.style.cssText = 'min-height:40px; font-size:0.85rem; padding:4px 12px;';
        clearBtn.addEventListener('click', () => { if (!locked) resetSelection(); });

        renderSlots();
        stage.append(hero, slotsWrap, poolWrap, feedback, clearBtn);
        container.appendChild(stage);
    }

    window.StudyPlayPhonics = { renderPhonicsBlendBlock };
})();
