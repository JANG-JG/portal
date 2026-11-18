/**
 * ==============================================================================
 * 한 문제씩 전체 화면 집중 풀이 스테퍼 엔진 (study-sheet-stepper.js)
 * ------------------------------------------------------------------------------
 * - 태블릿/모바일에서 한 화면(100dvh)에 1문제만 크게 표시하고 이전/다음 이동 제공
 * - 방향성 View Transition 슬라이드 + 단계 전환 시 캔버스/SVG 리사이즈 안전 재계산
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 44px+ 터치
 * ==============================================================================
 */

(function () {
    'use strict';

    let cards = [];
    let blocksMeta = [];
    let blockStatesRef = null;
    let currentIndex = 0;
    let totalCount = 0;
    let keyBound = false;

    function prefersReducedMotion() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function syncFocusBar() {
        const backBtn = document.getElementById('btnFocusBack');
        const origBack = document.getElementById('btnBackToDashboard');
        if (backBtn && origBack) {
            backBtn.setAttribute('href', origBack.getAttribute('href') || '/study');
        }
        const titleEl = document.getElementById('sheetFocusTitle');
        const origTitle = document.getElementById('sheetTitleHeading');
        if (titleEl && origTitle) {
            titleEl.textContent = (origTitle.textContent || '').trim() || '오늘의 맞춤 학습지';
        }
        const scoreEl = document.getElementById('sheetFocusScore');
        const origScoreBar = document.getElementById('sheetScoreBar');
        const origScore = document.getElementById('sheetScoreProgress');
        if (scoreEl) {
            const hideScore = !origScoreBar || origScoreBar.hidden;
            scoreEl.hidden = hideScore;
            if (!hideScore && origScore) {
                scoreEl.textContent = (origScore.textContent || '')
                    .replace(/정답\s*/g, '')
                    .replace(/틀림\s*/g, '')
                    .replace(/\s*·\s*/g, ' · ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
        }
        const resetBtn = document.getElementById('btnFocusReset');
        const retryBanner = document.getElementById('sheetRetryBanner');
        if (resetBtn) resetBtn.hidden = !retryBanner || retryBanner.hidden;

        const toggleBtn = document.getElementById('btnToggleSheetTools');
        if (toggleBtn) {
            const open = document.body.classList.contains('is-tools-open');
            toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggleBtn.classList.toggle('is-active', open);
            toggleBtn.textContent = open ? '🔼 메뉴 접기' : '⚙️ 메뉴·설정 ▾';
        }
    }

    function ensureStepChrome(container) {
        document.body.classList.add('is-sheet-step-mode');
        const shell = document.querySelector('.study-shell');
        shell?.classList.add('study-shell--sheet');

        let focusBar = document.getElementById('sheetFocusBar');
        if (!focusBar && shell) {
            focusBar = document.createElement('div');
            focusBar.id = 'sheetFocusBar';
            focusBar.className = 'sheet-focus-bar no-print';
            focusBar.innerHTML = `
                <div class="sheet-focus-left">
                    <a id="btnFocusBack" href="/study" class="study-link-btn study-btn-secondary sheet-focus-back">⬅️ 학습실</a>
                    <span id="sheetFocusTitle" class="sheet-focus-title">오늘의 맞춤 학습지</span>
                </div>
                <div class="sheet-focus-right">
                    <span id="sheetFocusScore" class="sheet-focus-score" hidden></span>
                    <button type="button" id="btnFocusFinishColor" class="study-btn study-btn-primary sheet-focus-mini sheet-focus-finish" hidden>🎨 색칠 완성!</button>
                    <button type="button" id="btnFocusReset" class="study-btn study-btn-outline sheet-focus-mini" hidden>🔄 처음부터</button>
                    <button type="button" id="btnToggleSheetTools" class="study-btn study-btn-outline sheet-focus-toggle" aria-expanded="false">⚙️ 메뉴·설정 ▾</button>
                </div>
            `;
            shell.prepend(focusBar);
            document.getElementById('btnFocusFinishColor')?.addEventListener('click', () => {
                document.getElementById('btnCompleteSheet')?.click();
            });
            document.getElementById('btnFocusReset')?.addEventListener('click', () => {
                document.getElementById('btnResetAllBlocks')?.click();
            });
            document.getElementById('btnToggleSheetTools')?.addEventListener('click', () => {
                document.body.classList.toggle('is-tools-open');
                syncFocusBar();
                requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
            });
        }

        let stepBar = document.getElementById('sheetStepBar');
        if (!stepBar && container?.parentElement) {
            stepBar = document.createElement('section');
            stepBar.id = 'sheetStepBar';
            stepBar.className = 'sheet-step-bar no-print';
            stepBar.setAttribute('aria-label', '문제 진행 순서');
            stepBar.innerHTML = `
                <div class="sheet-step-progress-group">
                    <span id="sheetStepBadge" class="sheet-step-badge">1 / 1 문제</span>
                    <div class="sheet-step-track" aria-hidden="true">
                        <div id="sheetStepFill" class="sheet-step-fill"></div>
                    </div>
                </div>
                <div id="sheetStepDots" class="sheet-step-dots" role="tablist" aria-label="문제 번호 선택"></div>
            `;
            container.parentElement.insertBefore(stepBar, container);
        }

        let stepNav = document.getElementById('sheetStepNav');
        if (!stepNav && container?.parentElement) {
            stepNav = document.createElement('nav');
            stepNav.id = 'sheetStepNav';
            stepNav.className = 'sheet-step-nav no-print';
            stepNav.setAttribute('aria-label', '이전 및 다음 문제 이동');
            stepNav.innerHTML = `
                <button type="button" id="btnStepPrev" class="study-btn study-btn-outline sheet-step-nav-btn">⬅️ 이전 문제</button>
                <p id="sheetStepHint" class="sheet-step-nav-hint" aria-live="polite"></p>
                <button type="button" id="btnStepNext" class="study-btn study-btn-primary sheet-step-nav-btn sheet-step-nav-btn--next">다음 문제 ➡️</button>
            `;
            container.insertAdjacentElement('afterend', stepNav);
            document.getElementById('btnStepPrev')?.addEventListener('click', () => goToStep(currentIndex - 1));
            document.getElementById('btnStepNext')?.addEventListener('click', () => goToStep(currentIndex + 1));
        }

        if (!keyBound) {
            keyBound = true;
            document.addEventListener('keydown', (e) => {
                if (totalCount <= 1) return;
                const tag = e.target?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
                if (document.getElementById('sheetResultDialog')?.open) return;
                if (e.key === 'ArrowLeft') goToStep(currentIndex - 1);
                else if (e.key === 'ArrowRight') goToStep(currentIndex + 1);
            });
        }
    }

    function runDirectionalTransition(updateDom, direction) {
        let executed = false;
        const safeUpdate = () => {
            if (executed) return;
            executed = true;
            updateDom();
        };
        if (!prefersReducedMotion() && typeof document.startViewTransition === 'function') {
            try {
                document.startViewTransition({ update: safeUpdate, types: [direction] });
                return;
            } catch (_) {
                /* ViewTransition types 미지원 브라우저는 즉시 DOM 전환 */
            }
        }
        safeUpdate();
    }

    function getStepState(idx) {
        const st = blockStatesRef?.get?.(idx);
        if (!st) return 'unscored';
        return st.status || 'pending';
    }

    function updateChrome() {
        syncFocusBar();
        const stepBar = document.getElementById('sheetStepBar');
        const stepNav = document.getElementById('sheetStepNav');
        const badgeEl = document.getElementById('sheetStepBadge');
        const fillEl = document.getElementById('sheetStepFill');
        const dotsEl = document.getElementById('sheetStepDots');
        const prevBtn = document.getElementById('btnStepPrev');
        const nextBtn = document.getElementById('btnStepNext');
        const hintEl = document.getElementById('sheetStepHint');
        const footerEl = document.querySelector('.sheet-footer-actions');

        const isSingle = totalCount <= 1;
        if (stepBar) stepBar.hidden = isSingle;
        if (stepNav) stepNav.hidden = isSingle;

        if (!isSingle && badgeEl && fillEl) {
            badgeEl.textContent = `${currentIndex + 1} / ${totalCount} 문제`;
            fillEl.style.width = `${Math.round(((currentIndex + 1) / totalCount) * 100)}%`;
        }

        if (dotsEl) {
            Array.from(dotsEl.children).forEach((dot, idx) => {
                const isCur = idx === currentIndex;
                const state = getStepState(idx);
                dot.classList.toggle('is-current', isCur);
                dot.dataset.stepState = state;
                dot.setAttribute('aria-selected', isCur ? 'true' : 'false');
                if (isCur) dot.setAttribute('aria-current', 'step');
                else dot.removeAttribute('aria-current');
                const mark = state === 'correct' ? '⭐' : (state === 'wrong' ? '❌' : '');
                dot.textContent = mark ? `${idx + 1}${mark}` : String(idx + 1);
            });
        }

        const isLast = currentIndex >= totalCount - 1;
        const activeCard = cards[currentIndex];
        const isColorStep = activeCard?.dataset?.blockType === 'color';
        document.body.classList.toggle('is-step-color', Boolean(isColorStep));
        const finishColorBtn = document.getElementById('btnFocusFinishColor');
        if (finishColorBtn) {
            const isColoringSheet = document.body.classList.contains('is-coloring-sheet');
            finishColorBtn.hidden = !(isColoringSheet && isColorStep && (isSingle || isLast));
        }
        if (footerEl) {
            footerEl.classList.toggle('is-step-footer-hidden', !isSingle && !isLast);
        }
        if (isSingle) return;

        if (prevBtn) prevBtn.disabled = currentIndex <= 0;
        if (nextBtn) nextBtn.hidden = isLast;

        const st = blockStatesRef?.get?.(currentIndex);
        const curBlk = blocksMeta[currentIndex];
        const readyToAdvance = !isLast && (st?.status === 'correct' || st?.status === 'wrong');
        if (nextBtn) nextBtn.classList.toggle('is-ready-pulse', readyToAdvance);

        if (hintEl) {
            if (isLast) {
                hintEl.textContent = '🎉 마지막 문제예요! 다 풀었으면 아래 버튼으로 채점해요';
            } else if (st?.status === 'correct') {
                hintEl.textContent = '⭐ 참 잘했어요! "다음 문제"를 눌러 넘어가요';
            } else if (st?.status === 'wrong') {
                hintEl.textContent = '📝 확인했어요! "다음 문제"로 넘어가서 계속 풀어요';
            } else if (curBlk?.type === 'trace') {
                hintEl.textContent = '✍️ 넓은 칸에 따라 써 보고 "다음 문제"를 눌러요';
            } else {
                hintEl.textContent = '문제를 푼 뒤 "다음 문제"를 눌러 넘어가요';
            }
        }
    }

    function applyStepVisibility(nextIndex, { animate = false } = {}) {
        if (!cards.length) return;
        const clamped = Math.max(0, Math.min(nextIndex, cards.length - 1));
        const direction = clamped >= currentIndex ? 'forward' : 'backward';
        const prevCard = cards[currentIndex];

        if (animate && prevCard && prevCard !== cards[clamped]) {
            prevCard.dispatchEvent(new CustomEvent('study:step-deactivated', { bubbles: true }));
        }

        currentIndex = clamped;
        const updateDom = () => {
            cards.forEach((card, idx) => {
                const active = idx === currentIndex;
                card.classList.toggle('is-step-active', active);
                card.classList.toggle('is-step-hidden', !active);
            });
            updateChrome();
        };

        runDirectionalTransition(updateDom, direction);

        const activeCard = cards[currentIndex];
        if (activeCard) {
            activeCard.scrollTop = 0;
            requestAnimationFrame(() => {
                activeCard.dispatchEvent(new CustomEvent('study:step-activated', { bubbles: true }));
                window.dispatchEvent(new Event('resize'));
            });
        }
    }

    function goToStep(nextIndex) {
        if (!cards.length) return;
        const clamped = Math.max(0, Math.min(Number(nextIndex) || 0, cards.length - 1));
        if (clamped === currentIndex && cards[clamped]?.classList.contains('is-step-active')) return;
        window.StudyTTS?.stop?.();
        applyStepVisibility(clamped, { animate: true });
    }

    function pickInitialIndex(opts = {}) {
        if (typeof opts.focusIndex === 'number' && !Number.isNaN(opts.focusIndex)) {
            return Math.max(0, Math.min(opts.focusIndex, cards.length - 1));
        }
        if (opts.preserveStep) {
            return Math.max(0, Math.min(currentIndex, cards.length - 1));
        }
        if (blockStatesRef && blockStatesRef.size > 0) {
            for (let i = 0; i < cards.length; i += 1) {
                const st = blockStatesRef.get(i);
                if (st && st.status !== 'correct') return i;
            }
        }
        return 0;
    }

    function mount({ container, blocks = [], blockStates = null, focusIndex = null, preserveStep = false } = {}) {
        if (!container) return;
        ensureStepChrome(container);

        cards = Array.from(container.querySelectorAll('.worksheet-block'));
        blocksMeta = Array.isArray(blocks) ? blocks : [];
        blockStatesRef = blockStates;
        totalCount = cards.length;

        cards.forEach((card, idx) => {
            const blk = blocksMeta[idx];
            if (!blk) return;
            card.dataset.blockType = blk.type || 'quiz';
            card.classList.toggle('is-trace-block', blk.type === 'trace');
            if (blk.type === 'trace') {
                const charCount = Array.from(String(blk.targetWord || '').trim()).filter((ch) => !/\s/.test(ch)).length;
                if (charCount > 0 && charCount <= 3) {
                    card.querySelector('.trace-guide')?.classList.add('trace-guide--spacious');
                }
            }
        });

        const dotsEl = document.getElementById('sheetStepDots');
        if (dotsEl) {
            dotsEl.innerHTML = '';
            cards.forEach((_, idx) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'sheet-step-dot';
                dot.setAttribute('role', 'tab');
                dot.setAttribute('aria-label', `${idx + 1}번 문제로 이동`);
                dot.addEventListener('click', () => goToStep(idx));
                dotsEl.appendChild(dot);
            });
        }

        const startIdx = pickInitialIndex({ focusIndex, preserveStep });
        currentIndex = startIdx;
        applyStepVisibility(startIdx, { animate: false });
    }

    function refreshStates(blockStates) {
        if (blockStates) blockStatesRef = blockStates;
        updateChrome();
    }

    window.StudySheetStepper = {
        mount,
        goToStep,
        refreshStates,
        getCurrentIndex: () => currentIndex
    };
})();
