/**
 * ==============================================================================
 * 학습지 채점 결과 다이얼로그 & 별(도장) 보상 안내 모듈 (study-sheet-result.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    function initDialogDismissFallback(dialogEl) {
        if (!dialogEl) return;
        dialogEl.addEventListener('close', () => {
            dialogEl.returnValue = '';
        });
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const isOutside = (e) => {
                const r = dialogEl.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            let pressedOutside = false;
            dialogEl.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
            dialogEl.addEventListener('pointerup', (e) => {
                if (pressedOutside && isOutside(e)) dialogEl.close();
            });
        }
    }

    function openResultDialog({ sheet, data, onRetryWrong }) {
        const dialogEl = document.getElementById('sheetResultDialog');
        if (!dialogEl) return;
        if (!dialogEl.dataset.bound) {
            dialogEl.dataset.bound = '1';
            initDialogDismissFallback(dialogEl);
        }

        const heroEl = document.getElementById('sheetResultHero');
        const emojiEl = document.getElementById('sheetResultEmoji');
        const titleEl = document.getElementById('sheetResultTitle');
        const descEl = document.getElementById('sheetResultDesc');
        const chipsEl = document.getElementById('sheetResultChips');
        const actionsEl = document.getElementById('sheetResultActions');

        const awarded = Boolean(data.stampAwarded);
        const childId = sheet?.child_id || 'first';
        const dashUrl = `/study?childId=${encodeURIComponent(childId)}`;
        const reviewUrl = `/study/review?childId=${encodeURIComponent(childId)}`;

        if (heroEl) {
            heroEl.classList.toggle('is-awarded', awarded);
            heroEl.classList.toggle('is-denied', !awarded);
        }
        if (emojiEl) emojiEl.textContent = awarded ? (data.reachedTen ? '🎉' : '🌟') : '📝';
        if (titleEl) {
            titleEl.textContent = awarded
                ? (data.reachedTen ? '도장판 10칸 완성! 알이 부화해요!' : '별(칭찬 도장)을 받았어요!')
                : `틀린 문제가 ${Number(data.wrongCount || 0)}개 있어요`;
        }
        if (descEl) {
            const snacks = Array.isArray(data.earnedSnacks) ? data.earnedSnacks : [];
            const snackTxt = snacks.length
                ? ` (+ 포켓몬 간식 ${snacks.map((sn) => `${sn.emoji} ${sn.name} ${sn.qty}개`).join(', ')} 획득!)`
                : '';
            const bonusTxt = data.missionProgress?.bonusMessage ? ` ${data.missionProgress.bonusMessage}` : '';
            const ptsTxt = data.earnedPoints?.totalAwarded > 0 ? ` [⭐ +${data.earnedPoints.totalAwarded}P 적립!]` : '';
            descEl.textContent = `${data.message || ''}${snackTxt}${bonusTxt}${ptsTxt}`.trim();
        }

        if (chipsEl) {
            const list = Array.isArray(data.blockResults) ? data.blockResults : [];
            chipsEl.innerHTML = list.map((item) => {
                const ok = item.status === 'correct';
                const num = Number(item.blockIndex || 0) + 1;
                return `<span class="result-prob-chip ${ok ? 'is-ok' : 'is-wrong'}">${num}번 ${ok ? '⭐ 정답' : '❌ 별 없음'}</span>`;
            }).join('');
        }

        const prevPromo = dialogEl.querySelector('#sheetPromotionBox');
        if (prevPromo) prevPromo.remove();
        if (awarded && data.levelPromotion?.eligible && actionsEl) {
            const promo = data.levelPromotion;
            const promoBox = document.createElement('div');
            promoBox.id = 'sheetPromotionBox';
            promoBox.className = 'result-promotion-box';
            promoBox.innerHTML = `
                <div class="result-promotion-title">🎓 Lv.${promo.currentLevel} 마스터! (최근 ${promo.recentCount}회 평균 ${promo.avgAccuracyPct}%)</div>
                <p class="result-promotion-desc">다음 단계(<strong>Lv.${promo.nextLevel}</strong>)에 도전할 준비가 되었어요!</p>
                <div class="result-promotion-actions">
                    <button type="button" class="study-btn study-btn-primary btn-accept-promo">🚀 Lv.${promo.nextLevel}로 승급하기</button>
                    <button type="button" class="study-btn study-btn-outline btn-keep-promo">현재 레벨 유지</button>
                </div>
            `;
            promoBox.querySelector('.btn-accept-promo').addEventListener('click', async (ev) => {
                const acceptBtn = ev.currentTarget;
                acceptBtn.disabled = true;
                try {
                    const res = await fetch('/api/study/levels/accept-promotion', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ childId, subject: sheet?.subject })
                    });
                    const out = await res.json();
                    if (res.ok && out.promoted) {
                        window.StudyFx?.fanfare?.();
                        promoBox.innerHTML = `<div class="result-promotion-title">✅ Lv.${out.newLevel}로 승급했어요! 🎉</div><p class="result-promotion-desc">다음 학습지부터 새 단계로 나와요 🌟</p>`;
                    } else {
                        acceptBtn.disabled = false;
                    }
                } catch (_) {
                    acceptBtn.disabled = false;
                }
            });
            promoBox.querySelector('.btn-keep-promo').addEventListener('click', () => {
                promoBox.remove();
            });
            actionsEl.before(promoBox);
        }

        if (actionsEl) {
            actionsEl.innerHTML = '';
            if (!awarded) {
                const retryBtn = document.createElement('button');
                retryBtn.type = 'button';
                retryBtn.className = 'study-btn study-btn-primary';
                retryBtn.textContent = '🔄 틀린 문제 바로 다시 풀기 (맞추면 별 지급!)';
                retryBtn.autofocus = true;
                retryBtn.addEventListener('click', () => {
                    dialogEl.close();
                    if (typeof onRetryWrong === 'function') onRetryWrong();
                });
                actionsEl.appendChild(retryBtn);

                const reviewLink = document.createElement('a');
                reviewLink.href = reviewUrl;
                reviewLink.className = 'study-link-btn study-btn-secondary';
                reviewLink.textContent = '📝 오답 복습 노트로 가기';
                actionsEl.appendChild(reviewLink);
            }

            const backLink = document.createElement('a');
            backLink.href = dashUrl;
            backLink.className = `study-link-btn ${awarded ? 'study-btn-primary' : 'study-btn-outline'}`;
            backLink.textContent = awarded ? '🎒 학습실로 가기' : '⬅️ 학습실로 돌아가기';
            if (awarded) backLink.autofocus = true;
            actionsEl.appendChild(backLink);
        }

        if (typeof dialogEl.showModal === 'function') {
            dialogEl.showModal();
        }
    }

    function renderCountBlock(container, blk, speakFn, choiceOpts = {}) {
        const count = Number(blk.count || 3);
        let tappedSeq = 0;

        const grid = document.createElement('div');
        grid.className = 'count-grid';
        for (let i = 0; i < count; i++) {
            const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'count-item-btn', textContent: blk.emoji || '🍎' });
            btn.addEventListener('click', () => {
                if (btn.classList.contains('counted')) return;
                tappedSeq += 1;
                btn.classList.add('counted');
                const badge = Object.assign(document.createElement('span'), { className: 'count-badge', textContent: String(tappedSeq) });
                btn.appendChild(badge);
                if (window.StudyFx) window.StudyFx.tap();
                if (typeof speakFn === 'function') speakFn(String(tappedSeq), 'ko-KR');
            });
            grid.appendChild(btn);
        }
        container.appendChild(grid);
        window.StudyPlayBlocks?.renderChoicesBlock?.(container, blk, speakFn, choiceOpts);
    }

    function renderQuizBlock(container, blk, subject, speakFn, choiceOpts = {}) {
        if (blk.visualLeft || blk.visualRight || blk.equationText || blk.imageUrl) {
            const box = document.createElement('div');
            box.className = 'quiz-visual-box';
            if (blk.visualLeft && blk.visualRight) {
                const mk = (cls, txt) => Object.assign(document.createElement('span'), { className: cls, textContent: txt });
                const row = document.createElement('div');
                row.className = 'quiz-visual-equation-row';
                row.append(mk('quiz-visual-side', blk.visualLeft), mk('quiz-visual-op', blk.operator || '+'), mk('quiz-visual-side', blk.visualRight));
                box.appendChild(row);
            } else if (blk.imageUrl) {
                const isLangQuiz = (subject === 'korean' || subject === 'english') && (blk.ttsText || blk.audioUrl);
                const img = document.createElement('img');
                img.src = blk.imageUrl;
                img.alt = blk.answer ? `${blk.answer} 그림` : '문제 그림';
                img.loading = 'lazy';
                img.className = 'quiz-pictogram-img' + (isLangQuiz ? ' is-speakable' : '');
                img.onerror = () => {
                    const fallback = document.createElement('div');
                    fallback.className = 'quiz-visual-hero' + (isLangQuiz ? ' is-speakable' : '');
                    fallback.textContent = String(blk.visualLeft || '🌟').trim();
                    if (isLangQuiz && typeof speakFn === 'function') {
                        fallback.addEventListener('click', () => speakFn(blk.ttsText, blk.ttsLang || 'ko-KR'));
                    }
                    img.replaceWith(fallback);
                };
                if (isLangQuiz) {
                    img.addEventListener('click', () => {
                        if (blk.audioUrl) {
                            new Audio(blk.audioUrl).play().catch(() => typeof speakFn === 'function' && speakFn(blk.ttsText, blk.ttsLang || 'ko-KR'));
                        } else if (typeof speakFn === 'function') {
                            speakFn(blk.ttsText, blk.ttsLang || 'ko-KR');
                        }
                    });
                }
                box.appendChild(img);
            } else if (blk.visualLeft || blk.visualRight) {
                const text = String(blk.visualLeft || blk.visualRight).trim();
                const vis = document.createElement('div');
                const isLangQuiz = (subject === 'korean' || subject === 'english') && blk.ttsText;
                vis.className = (!/\s/.test(text) ? 'quiz-visual-hero' : 'quiz-visual-group') + (isLangQuiz ? ' is-speakable' : '');
                vis.textContent = text;
                if (isLangQuiz && typeof speakFn === 'function') {
                    vis.addEventListener('click', () => speakFn(blk.ttsText, blk.ttsLang || 'ko-KR'));
                }
                box.appendChild(vis);
            }
            if (blk.equationText) {
                box.appendChild(Object.assign(document.createElement('div'), { className: 'quiz-equation-text', textContent: blk.equationText }));
            }
            container.appendChild(box);
        }
        window.StudyPlayBlocks?.renderChoicesBlock?.(container, blk, speakFn, choiceOpts);
    }

    const SCORED_TYPES = new Set(['quiz', 'count', 'match', 'clock', 'coins', 'hangul_tiles', 'phonics_blend', 'pattern', 'picture_sudoku', 'tangram_grid']);

    function initBlockStatesFromSheet(sheet, retryAllMode = false) {
        const map = new Map();
        const blocks = Array.isArray(sheet?.content?.blocks) ? sheet.content.blocks : [];
        const prevResults = (!retryAllMode && !sheet?.completed_at && Array.isArray(sheet?.lastResult?.blockResults))
            ? sheet.lastResult.blockResults
            : [];
        const prevMap = new Map(prevResults.map((r) => [Number(r.blockIndex), r]));

        blocks.forEach((blk, idx) => {
            if (!SCORED_TYPES.has(blk?.type)) return;
            const prev = prevMap.get(idx);
            const restoredOk = prev && prev.status === 'correct';
            map.set(idx, {
                blockIndex: idx,
                blockId: blk.id || `block-${idx + 1}`,
                blockType: blk.type,
                status: restoredOk ? 'correct' : 'pending',
                attempts: restoredOk ? Number(prev.attempts || 1) : 0,
                wrongCount: restoredOk ? Number(prev.wrongCount || 0) : 0,
                finalAnswer: restoredOk ? String(blk.answer || '') : '',
                matchedCount: restoredOk && blk.type === 'match' ? (blk.pairs?.length || 0) : 0,
                lastWrongAnswer: '',
                restored: Boolean(restoredOk)
            });
        });
        return map;
    }

    function updateScoreBar(sheet, blockStates) {
        const bar = document.getElementById('sheetScoreBar');
        const pill = document.getElementById('sheetScoreProgress');
        if (!bar || !pill) return;
        if (!sheet || sheet.subject === 'coloring' || !blockStates || blockStates.size === 0) {
            bar.hidden = true;
            return;
        }
        bar.hidden = false;
        let okCnt = 0;
        let wrongCnt = 0;
        blockStates.forEach((st) => {
            if (st.status === 'correct') okCnt += 1;
            else if (st.status === 'wrong') wrongCnt += 1;
        });
        const total = blockStates.size;
        const left = Math.max(0, total - okCnt - wrongCnt);
        pill.textContent = `⭐ 정답 ${okCnt}  ·  ❌ 틀림 ${wrongCnt}  ·  남음 ${left} / ${total}`;
    }

    function syncBlockChip(card, state) {
        const chip = card?.querySelector('.block-status-chip');
        const swapBtn = card?.querySelector('.btn-block-swap');
        if (chip && state) {
            chip.dataset.state = state.status;
            if (state.status === 'correct') chip.textContent = '⭐ 정답!';
            else if (state.status === 'wrong') chip.textContent = '❌ 틀림 (별 없음)';
            else if (state.status === 'retrying') chip.textContent = '⚠️ 기회 1번 남음';
            else chip.textContent = '기회 2번';
        }
        if (swapBtn && state && state.status !== 'pending') {
            swapBtn.disabled = true;
            swapBtn.hidden = true;
        }
    }

    const TYPE_LABELS = {
        trace: '✍️ 손가락 따라쓰기', count: '👆 하나씩 콕! 숫자 세기', match: '🔗 두 번 탭 선 잇기',
        clock: '⏰ 시계 바늘 맞추기', coins: '🪙 동전·수모형 모으기', hangul_tiles: '🧩 글자 자석 조립',
        phonics_blend: '🔤 파닉스 조합 놀이',
        pattern: '🔍 규칙 찾기', picture_sudoku: '🔢 4x4 그림 스도쿠', tangram_grid: '🪞 거울 대칭 채우기',
        storybook: '📖 그림 동화책', voice_repeat: '🎤 따라 말해 봐요', piano: '🎹 무지개 피아노'
    };

    function getBlockTypeLabel(type) {
        return TYPE_LABELS[type] || window.StudyPlayBlocks?.typeLabel?.(type) || '🎯 골라보기 퀴즈';
    }

    function renderBlockContent({ bodyEl, blk, sheet, opts, speakText, showToast, renderTraceBlock }) {
        const mApi = window.StudyPlayManipulatives, pApi = window.StudyPlayPuzzles, sApi = window.StudyPlayStorybook, pb = window.StudyPlayBlocks;
        const pianoVoiceAllowed = window.StudyTabletConfig?.pianoVoiceEnabled !== false;
        const disabledNotice = () => {
            bodyEl.innerHTML = '<p style="margin:0; padding:14px; border-radius:12px; background:#f8fafc; color:#475569; font-weight:700; text-align:center;">🔇 부모님이 미니 피아노·음성 말하기 기능을 잠시 쉬는 중으로 설정했어요.</p>';
        };
        const handlers = {
            trace: () => renderTraceBlock(bodyEl, blk),
            count: () => renderCountBlock(bodyEl, blk, speakText, opts),
            match: () => pb?.renderMatchBlock(bodyEl, blk, speakText, showToast, sheet, opts),
            dot_to_dot: () => pb?.renderDotToDotBlock(bodyEl, blk, speakText, showToast),
            maze: () => pb?.renderMazeBlock(bodyEl, blk, speakText, showToast),
            color: () => pb?.renderColorBlock(bodyEl, blk, speakText, showToast, sheet),
            clock: () => mApi?.renderClockBlock(bodyEl, blk, speakText, showToast, opts),
            coins: () => mApi?.renderCoinsBlock(bodyEl, blk, speakText, showToast, opts),
            hangul_tiles: () => mApi?.renderHangulTilesBlock(bodyEl, blk, speakText, showToast, opts),
            phonics_blend: () => window.StudyPlayPhonics?.renderPhonicsBlendBlock(bodyEl, blk, speakText, showToast, opts),
            pattern: () => pApi?.renderPatternBlock(bodyEl, blk, speakText, showToast, opts),
            picture_sudoku: () => pApi?.renderSudokuBlock(bodyEl, blk, speakText, showToast, opts),
            tangram_grid: () => pApi?.renderTangramBlock(bodyEl, blk, speakText, showToast, opts),
            storybook: () => sApi?.renderStorybookBlock(bodyEl, blk, speakText),
            voice_repeat: () => (pianoVoiceAllowed ? sApi?.renderVoiceRepeatBlock(bodyEl, blk, speakText, showToast) : disabledNotice()),
            piano: () => (pianoVoiceAllowed ? window.StudyPlayPiano?.renderPianoBlock(bodyEl, blk, speakText, showToast) : disabledNotice())
        };
        (handlers[blk.type] || (() => renderQuizBlock(bodyEl, blk, sheet?.subject, speakText, opts)))();
    }

    window.StudySheetResult = {
        initBlockStatesFromSheet,
        updateScoreBar,
        syncBlockChip,
        openResultDialog,
        renderCountBlock,
        renderQuizBlock,
        getBlockTypeLabel,
        renderBlockContent
    };
})();
