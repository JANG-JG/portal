/**
 * ==============================================================================
 * 두뇌·사고력 퍼즐 블록 렌더러 (study-play-puzzles.js)
 * ------------------------------------------------------------------------------
 * - pattern: 그림 규칙 추론하기
 * - picture_sudoku: 4x4 그림 스도쿠 채우기
 * - tangram_grid: 거울 대칭 칸 채우기
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 44px+ 터치
 * ==============================================================================
 */

(function () {
    'use strict';

    // 1. 규칙 찾기 (pattern)
    function renderPatternBlock(container, blk, speakFn, toastFn, opts = {}) {
        const seq = Array.isArray(blk.sequence) ? blk.sequence : [];
        const strip = document.createElement('div');
        strip.className = 'pattern-strip';
        const isSolved = opts.initialState === 'correct';
        seq.forEach((item) => {
            const box = document.createElement('div');
            const isBlank = item === null || item === '';
            box.className = `pattern-cell ${isBlank ? 'is-blank' : ''}`;
            box.textContent = isBlank ? (isSolved ? blk.answer : '?') : item;
            if (isBlank && isSolved) box.classList.add('is-solved');
            strip.appendChild(box);
        });
        container.appendChild(strip);

        const wrappedOpts = {
            ...opts,
            onStateChange: (info) => {
                if (info?.status === 'correct') {
                    const blank = strip.querySelector('.is-blank');
                    if (blank) {
                        blank.textContent = blk.answer;
                        blank.classList.add('is-solved');
                    }
                }
                opts.onStateChange?.(info);
            }
        };
        window.StudyPlayBlocks?.renderChoicesBlock?.(container, blk, speakFn, wrappedOpts);
    }

    // 2. 4x4 그림 스도쿠 (picture_sudoku)
    function renderSudokuBlock(container, blk, speakFn, toastFn, opts = {}) {
        const onStateChange = opts.onStateChange;
        const symbols = Array.isArray(blk.symbols) ? blk.symbols : ['🐶', '🐱', '🐰', '🐻'];
        const given = Array.isArray(blk.given) ? blk.given : [];
        const solution = Array.isArray(blk.solution) ? blk.solution : [];
        const grid = given.map((row, r) => row.map((cell, c) => (opts.initialState === 'correct' ? solution[r][c] : cell)));

        let selectedCell = null;
        let activeStamp = '';
        let wrongTries = 0;
        let locked = opts.initialState === 'correct';

        const statusBar = document.createElement('div');
        statusBar.className = 'play-status-pill manip-status-bar';
        statusBar.dataset.tone = locked ? 'ok' : 'info';
        statusBar.textContent = locked ? '⭐ 그림 스도쿠 완성!' : '빈칸을 누르고 그림 도장을 찍거나, 도장을 고른 뒤 빈칸을 눌러 보세요 (기회 2번)';

        const board = document.createElement('div');
        board.className = 'sudoku-grid';

        const palette = document.createElement('div');
        palette.className = 'sudoku-palette no-print';

        const redraw = () => {
            board.innerHTML = '';
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    const isGiven = Boolean(given[r]?.[c]);
                    const val = grid[r]?.[c] || '';
                    const isSel = selectedCell && selectedCell.r === r && selectedCell.c === c;
                    const cell = Object.assign(document.createElement('button'), {
                        type: 'button',
                        className: `sudoku-cell ${isGiven ? 'is-given' : 'is-editable'} ${isSel ? 'is-selected' : ''} ${c === 1 ? 'box-right-sep' : ''} ${r === 1 ? 'box-bottom-sep' : ''}`,
                        textContent: val || '?',
                        disabled: locked || isGiven
                    });
                    if (!isGiven && !locked) {
                        cell.addEventListener('click', () => {
                            if (grid[r][c] && (!activeStamp || grid[r][c] === activeStamp)) {
                                grid[r][c] = null;
                                selectedCell = { r, c };
                            } else if (activeStamp) {
                                grid[r][c] = activeStamp;
                                selectedCell = null;
                            } else {
                                selectedCell = { r, c };
                            }
                            window.StudyFx?.tap?.();
                            redraw();
                        });
                    }
                    board.appendChild(cell);
                }
            }

            palette.innerHTML = '';
            symbols.forEach((sym) => {
                const btn = Object.assign(document.createElement('button'), {
                    type: 'button',
                    className: `sudoku-stamp-btn ${activeStamp === sym ? 'active' : ''}`,
                    textContent: sym,
                    disabled: locked
                });
                btn.addEventListener('click', () => {
                    if (locked) return;
                    if (selectedCell) {
                        grid[selectedCell.r][selectedCell.c] = sym;
                        selectedCell = null;
                        activeStamp = '';
                    } else {
                        activeStamp = activeStamp === sym ? '' : sym;
                    }
                    window.StudyFx?.tap?.();
                    redraw();
                });
                palette.appendChild(btn);
            });
        };

        const checkBtn = Object.assign(document.createElement('button'), {
            type: 'button', className: 'study-btn study-btn-primary manip-check-btn no-print', textContent: '⭕ 스도쿠 확인하기!', disabled: locked
        });
        checkBtn.addEventListener('click', () => {
            if (locked) return;
            const hasEmpty = grid.some((row) => row.some((v) => !v));
            if (hasEmpty) {
                toastFn?.('아직 비어 있는 ? 칸이 있어요! 😊');
                return;
            }
            const ok = solution.every((row, r) => row.every((v, c) => grid[r]?.[c] === v));
            if (ok) {
                locked = true;
                checkBtn.disabled = true;
                redraw();
                window.StudyFx?.correct?.();
                statusBar.dataset.tone = 'ok';
                statusBar.textContent = '⭐ 대단해요! 가로·세로·네모 상자 규칙 완벽 성공!';
                toastFn?.('그림 스도쿠 성공! 🧩🌟');
                onStateChange?.({ status: 'correct', grid, attempts: wrongTries + 1, wrongCount: wrongTries });
                return;
            }
            wrongTries += 1;
            window.StudyFx?.retry?.();
            if (wrongTries === 1) {
                statusBar.dataset.tone = 'warn';
                statusBar.textContent = '⚠️ 같은 줄이나 네모 상자에 겹친 그림이 있어요! 한 번 더 고쳐 볼까요? (남은 기회 1번)';
                onStateChange?.({ status: 'retrying', grid, attempts: 1, wrongCount: 1, lastWrongAnswer: 'mismatch' });
            } else {
                locked = true;
                checkBtn.disabled = true;
                solution.forEach((row, r) => row.forEach((v, c) => { grid[r][c] = v; }));
                redraw();
                statusBar.dataset.tone = 'wrong';
                statusBar.textContent = '❌ 정답 스도쿠 배치로 보여드려요! 다음 문제로 도전해요 📝';
                onStateChange?.({ status: 'wrong', grid, attempts: wrongTries, wrongCount: wrongTries, lastWrongAnswer: 'mismatch' });
            }
        });

        redraw();
        container.append(statusBar, board, palette, checkBtn);
    }

    // 3. 거울 대칭 도형 채우기 (tangram_grid)
    function renderTangramBlock(container, blk, speakFn, toastFn, opts = {}) {
        const onStateChange = opts.onStateChange;
        const size = Number(blk.gridSize || 4);
        const emoji = blk.fillEmoji || '🟩';
        const leftSet = new Set(blk.leftCells || []);
        const targetSet = new Set(blk.targetCells || []);
        const fixedRight = new Set(blk.prefilledCells || []);
        const userCells = new Set(opts.initialState === 'correct' ? blk.targetCells : blk.prefilledCells);

        let wrongTries = 0;
        let locked = opts.initialState === 'correct';

        const statusBar = document.createElement('div');
        statusBar.className = 'play-status-pill manip-status-bar';
        statusBar.dataset.tone = locked ? 'ok' : 'info';
        statusBar.textContent = locked ? '⭐ 거울 대칭 완성!' : '오른쪽 빈 칸을 눌러 왼쪽과 똑같이 마주보게 채워 보세요 (기회 2번)';

        const gridEl = document.createElement('div');
        gridEl.className = 'tangram-split-grid';

        const redraw = () => {
            gridEl.innerHTML = '';
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const key = `${r},${c}`;
                    const isLeft = c < size / 2;
                    const isMirroredAxis = c === (size / 2) - 1;
                    const active = isLeft ? leftSet.has(key) : userCells.has(key);
                    const cell = Object.assign(document.createElement('button'), {
                        type: 'button',
                        className: `tangram-cell ${isLeft ? 'is-left' : 'is-right'} ${active ? 'is-active' : ''} ${isMirroredAxis ? 'is-mirror-axis' : ''}`,
                        textContent: active ? emoji : '',
                        disabled: locked || isLeft || fixedRight.has(key)
                    });
                    cell.setAttribute('aria-label', `${r + 1}행 ${c + 1}열`);
                    if (!isLeft && !locked && !fixedRight.has(key)) {
                        cell.addEventListener('click', () => {
                            if (userCells.has(key)) userCells.delete(key);
                            else userCells.add(key);
                            window.StudyFx?.tap?.();
                            redraw();
                        });
                    }
                    gridEl.appendChild(cell);
                }
            }
        };

        const checkBtn = Object.assign(document.createElement('button'), {
            type: 'button', className: 'study-btn study-btn-primary manip-check-btn no-print', textContent: '⭕ 거울 그림 확인하기!', disabled: locked
        });
        checkBtn.addEventListener('click', () => {
            if (locked) return;
            const cellsArr = Array.from(userCells).sort();
            const expArr = Array.from(targetSet).sort();
            if (cellsArr.join('|') === expArr.join('|')) {
                locked = true;
                checkBtn.disabled = true;
                redraw();
                window.StudyFx?.correct?.();
                statusBar.dataset.tone = 'ok';
                statusBar.textContent = '⭐ 거울처럼 똑같이 맞췄어요! 대단해요!';
                toastFn?.('거울 대칭 완성! 🪞🌟');
                onStateChange?.({ status: 'correct', cells: cellsArr, attempts: wrongTries + 1, wrongCount: wrongTries });
                return;
            }
            wrongTries += 1;
            window.StudyFx?.retry?.();
            if (wrongTries === 1) {
                statusBar.dataset.tone = 'warn';
                statusBar.textContent = '⚠️ 왼쪽과 거울 선 거리를 다시 세어 볼까요? (남은 기회 1번)';
                onStateChange?.({ status: 'retrying', cells: cellsArr, attempts: 1, wrongCount: 1, lastWrongAnswer: cellsArr.join(',') });
            } else {
                locked = true;
                checkBtn.disabled = true;
                userCells.clear();
                expArr.forEach((k) => userCells.add(k));
                redraw();
                statusBar.dataset.tone = 'wrong';
                statusBar.textContent = '❌ 정답 거울 그림을 확인해 보아요 📝';
                onStateChange?.({ status: 'wrong', cells: cellsArr, attempts: wrongTries, wrongCount: wrongTries, lastWrongAnswer: cellsArr.join(',') });
            }
        });

        redraw();
        container.append(statusBar, gridEl, checkBtn);
    }

    window.StudyPlayPuzzles = {
        renderPatternBlock,
        renderSudokuBlock,
        renderTangramBlock
    };
})();
