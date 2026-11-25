/**
 * ==============================================================================
 * 유아 학습지 놀이형 블록 인터랙션 렌더러 (study-play-blocks.js)
 * ------------------------------------------------------------------------------
 * - dot_to_dot: 순서대로 점 이어 그림 완성 (SVG 벡터 + A4 점선 인쇄 겸용)
 * - maze: 숫자/글자 순서 따라 길 찾기 미로
 * - color: 크레파스 팔레트 터치 색칠하기 (인쇄 시 흑백 선화 자동 변환)
 * ==============================================================================
 */

(function () {
    'use strict';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function createSvgEl(tag, attrs = {}) {
        const el = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
        return el;
    }
    function typeLabel(type) {
        if (type === 'dot_to_dot') return '✨ 점 이어 그림 완성';
        if (type === 'maze') return '🧭 길 찾기 미로 놀이';
        if (type === 'color') return '🖍️ 톡톡 색칠 놀이';
        return '';
    }

    function renderDotToDotBlock(container, blk, speakFn, toastFn) {
        const points = Array.isArray(blk.points) ? blk.points : [];
        if (points.length < 3) return;

        let nextIdx = 0;

        const toolbar = document.createElement('div');
        toolbar.className = 'play-toolbar no-print';
        const statusBadge = document.createElement('span');
        statusBadge.className = 'play-status-pill';
        statusBadge.textContent = `다음 점: ${points[0].label}`;
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'study-btn study-btn-outline play-reset-btn';
        resetBtn.textContent = '🔄 다시 잇기';
        toolbar.appendChild(statusBadge);
        toolbar.appendChild(resetBtn);
        container.appendChild(toolbar);

        const stage = document.createElement('div');
        stage.className = 'dot-stage';

        const svg = createSvgEl('svg', { viewBox: '0 0 320 220', class: 'dot-svg' });
        const guidePolyPts = points.map((p) => `${p.x},${p.y}`).join(' ');
        svg.appendChild(createSvgEl('polygon', {
            points: guidePolyPts,
            fill: 'none',
            stroke: '#cbd5e1',
            'stroke-width': 2.5,
            'stroke-dasharray': '5 6'
        }));

        const rewardLayer = createSvgEl('g', { class: 'dot-reward-layer', hidden: 'true' });
        const linesLayer = createSvgEl('g', { class: 'dot-lines-layer' });
        const nodesLayer = createSvgEl('g', { class: 'dot-nodes-layer' });
        svg.appendChild(rewardLayer);
        svg.appendChild(linesLayer);
        svg.appendChild(nodesLayer);

        const banner = document.createElement('p');
        banner.className = 'play-feedback';
        banner.textContent = '';

        function redrawNodes() {
            nodesLayer.innerHTML = '';
            points.forEach((pt, idx) => {
                const isDone = idx < nextIdx;
                const isNext = idx === nextIdx;
                const g = createSvgEl('g', {
                    class: `dot-node ${isDone ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`,
                    role: 'button',
                    tabindex: '0',
                    'aria-label': `${pt.label}번 점`
                });

                // 넓은 터치 히트 영역 (44px+ 확보)
                g.appendChild(createSvgEl('circle', {
                    cx: pt.x, cy: pt.y, r: 22, fill: 'transparent'
                }));

                if (isNext) {
                    g.appendChild(createSvgEl('circle', {
                        cx: pt.x, cy: pt.y, r: 19,
                        class: 'dot-pulse-ring',
                        fill: 'none', stroke: '#ff7a45', 'stroke-width': 2.5
                    }));
                }

                g.appendChild(createSvgEl('circle', {
                    cx: pt.x, cy: pt.y, r: 14,
                    fill: isDone ? '#10b981' : (isNext ? '#ff7a45' : '#ffffff'),
                    stroke: isDone ? '#047857' : (isNext ? '#c2410c' : '#475569'),
                    'stroke-width': 2.5
                }));

                const labelEl = createSvgEl('text', {
                    x: pt.x,
                    y: pt.y + 4.5,
                    'text-anchor': 'middle',
                    'font-size': pt.label.length > 1 ? '10' : '11.5',
                    'font-weight': '800',
                    fill: (isDone || isNext) ? '#ffffff' : '#1e293b'
                });
                labelEl.textContent = pt.label;
                g.appendChild(labelEl);

                const handleTap = () => {
                    if (nextIdx >= points.length) return;
                    if (idx !== nextIdx) {
                        const expected = points[nextIdx].label;
                        banner.style.color = '#d97706';
                        banner.textContent = `지금은 '${expected}' 점을 눌러 볼까요? 😊`;
                        if (window.StudyFx) window.StudyFx.retry();
                        if (toastFn) toastFn(`다음 순서는 '${expected}'예요!`);
                        return;
                    }

                    if (nextIdx > 0) {
                        const prev = points[nextIdx - 1];
                        linesLayer.appendChild(createSvgEl('line', {
                            x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y,
                            stroke: '#ff7a45', 'stroke-width': 5, 'stroke-linecap': 'round'
                        }));
                    }

                    nextIdx += 1;
                    if (nextIdx >= points.length) {
                        const first = points[0];
                        linesLayer.appendChild(createSvgEl('line', {
                            x1: pt.x, y1: pt.y, x2: first.x, y2: first.y,
                            stroke: '#ff7a45', 'stroke-width': 5, 'stroke-linecap': 'round'
                        }));
                        if (window.StudyIllustrations) {
                            rewardLayer.innerHTML = window.StudyIllustrations.getShapeRewardSvg(blk.shapeId, blk.fillColor);
                            rewardLayer.removeAttribute('hidden');
                        }
                        statusBadge.textContent = `완성! ${blk.shapeEmoji || '🌟'} ${blk.shapeName || '그림'}`;
                        banner.style.color = '#047857';
                        banner.textContent = `와! 멋진 '${blk.shapeName || '그림'}' 완성했어요! 🎉`;
                        if (window.StudyFx) {
                            window.StudyFx.correct();
                            window.StudyFx.celebrate({ big: false });
                        }
                        if (speakFn) speakFn(`와! 멋진 ${blk.shapeName || '그림'}을 완성했어요!`, 'ko-KR');
                    } else {
                        statusBadge.textContent = `다음 점: ${points[nextIdx].label}`;
                        banner.style.color = '#0284c7';
                        banner.textContent = `잘했어요! 다음은 '${points[nextIdx].label}'을 찾아보세요.`;
                        if (window.StudyFx) window.StudyFx.tap();
                    }
                    redrawNodes();
                };

                g.addEventListener('click', handleTap);
                g.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleTap();
                    }
                });
                nodesLayer.appendChild(g);
            });
        }

        resetBtn.addEventListener('click', () => {
            nextIdx = 0;
            linesLayer.innerHTML = '';
            rewardLayer.innerHTML = '';
            rewardLayer.setAttribute('hidden', 'true');
            statusBadge.textContent = `다음 점: ${points[0].label}`;
            banner.textContent = '';
            redrawNodes();
        });

        redrawNodes();
        stage.appendChild(svg);
        container.appendChild(stage);
        container.appendChild(banner);
    }

    function renderMazeBlock(container, blk, speakFn, toastFn) {
        const path = Array.isArray(blk.path) ? blk.path : [];
        const cells = Array.isArray(blk.cells) ? blk.cells : [];
        if (!path.length || !cells.length) return;

        let stepIdx = 0;

        const toolbar = document.createElement('div');
        toolbar.className = 'play-toolbar no-print';
        const statusBadge = document.createElement('span');
        statusBadge.className = 'play-status-pill';
        statusBadge.textContent = path[1] ? `다음 칸: ${path[1].label}` : '도착!';
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'study-btn study-btn-outline play-reset-btn';
        resetBtn.textContent = '🔄 처음부터';
        toolbar.appendChild(statusBadge);
        toolbar.appendChild(resetBtn);
        container.appendChild(toolbar);

        const grid = document.createElement('div');
        grid.className = 'maze-grid';
        grid.style.setProperty('--maze-cols', String(blk.cols || 4));

        const banner = document.createElement('p');
        banner.className = 'play-feedback';
        banner.textContent = '';

        function renderGrid() {
            grid.innerHTML = '';
            const curPos = path[stepIdx];

            cells.forEach((row) => {
                row.forEach((cell) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'maze-cell';

                    const pathPosIdx = path.findIndex((p) => p.r === cell.r && p.c === cell.c);
                    const isVisited = pathPosIdx !== -1 && pathPosIdx <= stepIdx;
                    const isCurrent = curPos && curPos.r === cell.r && curPos.c === cell.c;
                    const isGoal = cell.kind === 'goal';

                    if (cell.kind === 'obstacle') btn.classList.add('is-obstacle');
                    if (isVisited) btn.classList.add('is-visited');
                    if (isCurrent) btn.classList.add('is-current');
                    if (isGoal) btn.classList.add('is-goal');

                    const topIcon = isCurrent
                        ? `<span class="maze-char">${blk.startEmoji || '🐾'}</span>`
                        : (isGoal ? `<span class="maze-char">${blk.goalEmoji || '🎁'}</span>` : '');

                    btn.innerHTML = `${topIcon}<span class="maze-label">${cell.label}</span>`;

                    btn.addEventListener('click', () => {
                        if (stepIdx >= path.length - 1) return;
                        const nextTarget = path[stepIdx + 1];
                        if (!nextTarget) return;

                        if (cell.r === nextTarget.r && cell.c === nextTarget.c) {
                            stepIdx += 1;
                            if (stepIdx >= path.length - 1) {
                                statusBadge.textContent = `도착! ${blk.goalEmoji || '🎁'}`;
                                banner.style.color = '#047857';
                                banner.textContent = `만세! ${blk.goalEmoji || '보물'}까지 길을 모두 찾았어요! 🎉`;
                                if (window.StudyFx) {
                                    window.StudyFx.correct();
                                    window.StudyFx.celebrate({ big: false });
                                }
                                if (speakFn) speakFn('만세! 길을 끝까지 잘 찾았어요!', 'ko-KR');
                            } else {
                                const upcoming = path[stepIdx + 1];
                                statusBadge.textContent = `다음 칸: ${upcoming.label}`;
                                banner.style.color = '#0284c7';
                                banner.textContent = `한 걸음 전진! 이제 '${upcoming.label}' 칸을 눌러 보세요.`;
                                if (window.StudyFx) window.StudyFx.tap();
                            }
                            renderGrid();
                        } else {
                            btn.classList.remove('is-shake');
                            void btn.offsetWidth;
                            btn.classList.add('is-shake');
                            banner.style.color = '#d97706';
                            banner.textContent = `붙어 있는 '${nextTarget.label}' 칸으로 이동해 보아요!`;
                            if (window.StudyFx) window.StudyFx.retry();
                            if (toastFn) toastFn(`옆에 있는 '${nextTarget.label}' 칸을 눌러요!`);
                        }
                    });

                    grid.appendChild(btn);
                });
            });
        }

        resetBtn.addEventListener('click', () => {
            stepIdx = 0;
            statusBadge.textContent = path[1] ? `다음 칸: ${path[1].label}` : '도착!';
            banner.textContent = '';
            renderGrid();
        });

        renderGrid();
        container.appendChild(grid);
        container.appendChild(banner);
    }

    function renderColorBlock(container, blk, speakFn, toastFn, sheetMeta) {
        if (window.StudyColorBlock && typeof window.StudyColorBlock.renderColorBlock === 'function') {
            window.StudyColorBlock.renderColorBlock(container, blk, speakFn, toastFn, sheetMeta);
        }
    }

    function renderChoicesBlock(container, blk, speakFn, opts = {}) {
        const { initialState = null, onStateChange = null } = opts || {};
        const grid = document.createElement('div');
        grid.className = 'choice-grid';
        const feedback = document.createElement('p');
        feedback.className = 'choice-feedback';
        feedback.setAttribute('aria-live', 'polite');

        let wrongTries = 0;
        let locked = initialState === 'correct';
        let lastWrongAnswer = '';
        const norm = (v) => String(v ?? '').trim().toUpperCase();
        const ansNorm = norm(blk.answer);

        (blk.choices || []).forEach((ch) => {
            const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'choice-btn', textContent: ch });
            if (locked) {
                btn.disabled = true;
                if (norm(ch) === ansNorm) btn.classList.add('correct');
            }
            btn.addEventListener('click', () => {
                if (locked || btn.disabled) return;
                if (norm(ch) === ansNorm) {
                    locked = true;
                    btn.classList.add('correct');
                    grid.querySelectorAll('.choice-btn').forEach((b) => { b.disabled = true; });
                    feedback.style.color = '#047857';
                    feedback.textContent = wrongTries === 0 ? '딩동댕! 한 번에 맞췄어요! ⭐' : '딩동댕! 두 번째 도전에 맞췄어요! 🌟';
                    if (window.StudyFx) window.StudyFx.correct();
                    if (typeof speakFn === 'function') speakFn('딩동댕! 참 잘했어요!', 'ko-KR');
                    onStateChange?.({ status: 'correct', attempts: wrongTries + 1, wrongCount: wrongTries, finalAnswer: ch, lastWrongAnswer });
                    return;
                }
                wrongTries += 1;
                lastWrongAnswer = String(ch);
                btn.classList.add('wrong');
                btn.disabled = true;
                if (window.StudyFx) window.StudyFx.retry();
                if (wrongTries === 1) {
                    feedback.style.color = '#d97706';
                    feedback.textContent = '아쉬워요! 한 번만 더 선택할 수 있어요 (남은 기회 1번) 🤔';
                    onStateChange?.({ status: 'retrying', attempts: 1, wrongCount: 1, finalAnswer: '', lastWrongAnswer });
                } else {
                    locked = true;
                    grid.querySelectorAll('.choice-btn').forEach((b) => {
                        b.disabled = true;
                        if (norm(b.textContent) === ansNorm) b.classList.add('answer-reveal');
                    });
                    feedback.style.color = '#dc2626';
                    feedback.textContent = `두 번 모두 틀렸어요! 정답은 "${blk.answer}" 예요. 다시 풀면 별을 받을 수 있어요 📝`;
                    onStateChange?.({ status: 'wrong', attempts: wrongTries, wrongCount: wrongTries, finalAnswer: ch, lastWrongAnswer });
                }
            });
            grid.appendChild(btn);
        });
        if (locked) {
            feedback.style.color = '#047857';
            feedback.textContent = '⭐ 이미 맞춘 문제예요!';
        }
        container.append(grid, feedback);
    }

    function renderMatchBlock(container, blk, speakFn, toastFn, sheetMeta, opts = {}) {
        const { initialState = null, onStateChange = null } = opts || {};
        const statusBar = document.createElement('div');
        statusBar.className = 'match-attempt-bar';
        const board = Object.assign(document.createElement('div'), { className: 'match-board' });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'match-svg');
        const leftCol = Object.assign(document.createElement('div'), { className: 'match-col' });
        const rightCol = Object.assign(document.createElement('div'), { className: 'match-col' });
        const pairs = blk.pairs || [];
        const rights = blk.shuffledRights || pairs.map((p) => p.right);
        const subj = sheetMeta?.subject || '';

        let selectedLeft = null;
        let wrongTries = 0;
        let matchedCount = initialState === 'correct' ? pairs.length : 0;
        let locked = initialState === 'correct';
        let lastWrongAnswer = '';

        const updateBar = (text, tone = 'info') => { statusBar.textContent = text; statusBar.dataset.tone = tone; };
        updateBar(locked ? '⭐ 이미 모든 짝꿍을 맞춘 문제예요!' : '짝꿍을 이어 보세요 (남은 기회: 2번)', locked ? 'ok' : 'info');

        const linkRecords = [];
        const drawLineBetween = (elA, elB, color = '#10b981', dashed = false, record = true) => {
            if (record) linkRecords.push({ elA, elB, color, dashed });
            const bRect = board.getBoundingClientRect();
            const aRect = elA.getBoundingClientRect();
            const cRect = elB.getBoundingClientRect();
            if (!bRect.width || !aRect.width || !cRect.width) return;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const attrs = {
                x1: aRect.right - bRect.left, y1: aRect.top + aRect.height / 2 - bRect.top,
                x2: cRect.left - bRect.left, y2: cRect.top + cRect.height / 2 - bRect.top,
                stroke: color, 'stroke-width': dashed ? 3.5 : 5, 'stroke-linecap': 'round'
            };
            if (dashed) attrs['stroke-dasharray'] = '6 5';
            Object.entries(attrs).forEach(([k, v]) => line.setAttribute(k, String(v)));
            svg.appendChild(line);
        };
        const redrawMatchLines = () => {
            if (!linkRecords.length || !board.getBoundingClientRect().width) return;
            svg.innerHTML = '';
            linkRecords.forEach(({ elA, elB, color, dashed }) => drawLineBetween(elA, elB, color, dashed, false));
        };

        const leftBtns = [];
        const rightBtns = [];

        pairs.forEach((p) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isVisual = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(p.left || ''));
            const isLangMatch = subj === 'korean' || subj === 'english' || Boolean(p.ttsText);
            const wordSpeech = String(p.ttsText || (isLangMatch ? p.right : '') || '').trim();
            const wordLang = String(p.ttsLang || (subj === 'english' ? 'en-US' : 'ko-KR'));
            btn.className = (isVisual || p.imageUrl) ? 'match-node match-node--visual' : 'match-node';
            if (p.imageUrl) {
                const img = document.createElement('img');
                img.src = p.imageUrl;
                img.alt = p.right ? `${p.right} 그림` : '낱말 그림';
                img.loading = 'lazy';
                img.className = 'match-pictogram-img';
                img.onerror = () => {
                    img.remove();
                    btn.prepend(document.createTextNode(p.left || '🌟'));
                };
                btn.appendChild(img);
            } else {
                btn.textContent = p.left;
            }
            btn.dataset.answer = p.right;
            if (locked) btn.classList.add('matched');
            if (wordSpeech) {
                btn.dataset.preserveLabel = '1';
                btn.setAttribute('aria-label', `${wordSpeech} 그림 듣기`);
                if (isVisual || p.imageUrl) btn.appendChild(Object.assign(document.createElement('span'), { className: 'match-sound-badge', textContent: '🔊' })).setAttribute('aria-hidden', 'true');
            }
            btn.addEventListener('click', () => {
                if (wordSpeech && typeof speakFn === 'function') speakFn(wordSpeech, wordLang, btn);
                if (locked || btn.classList.contains('matched')) return;
                leftCol.querySelectorAll('.match-node').forEach((n) => n.classList.remove('selected'));
                selectedLeft = btn;
                btn.classList.add('selected');
            });
            leftBtns.push(btn);
            leftCol.appendChild(btn);
        });

        rights.forEach((rVal) => {
            const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'match-node', textContent: rVal });
            btn.dataset.value = rVal;
            if (locked) btn.classList.add('matched');
            btn.addEventListener('click', () => {
                if (locked || !selectedLeft || btn.classList.contains('matched')) return;
                if (selectedLeft.dataset.answer === rVal) {
                    selectedLeft.classList.remove('selected');
                    selectedLeft.classList.add('matched');
                    btn.classList.add('matched');
                    drawLineBetween(selectedLeft, btn, '#10b981');
                    selectedLeft = null;
                    matchedCount += 1;
                    if (window.StudyFx) window.StudyFx.correct();
                    if (matchedCount >= pairs.length) {
                        locked = true;
                        updateBar(wrongTries === 0 ? '⭐ 한 번에 모두 연결했어요!' : '🌟 두 번째 도전에 모두 연결했어요!', 'ok');
                        toastFn?.('짝꿍 선 잇기 완료! 🌟');
                        onStateChange?.({ status: 'correct', attempts: wrongTries + 1, wrongCount: wrongTries, matchedCount, lastWrongAnswer });
                    } else toastFn?.('짝꿍 찾기 성공! 🌟');
                    return;
                }
                wrongTries += 1;
                lastWrongAnswer = String(rVal);
                selectedLeft.classList.remove('selected');
                selectedLeft = null;
                btn.classList.add('wrong');
                setTimeout(() => btn.classList.remove('wrong'), 550);
                if (window.StudyFx) window.StudyFx.retry();
                if (wrongTries === 1) {
                    updateBar('⚠️ 아쉬워요! 한 번만 더 선택할 수 있어요 (남은 기회 1번) 🤔', 'warn');
                    toastFn?.('한 번 더 골라볼 수 있어요! (남은 기회 1번)');
                    onStateChange?.({ status: 'retrying', attempts: 1, wrongCount: 1, matchedCount, lastWrongAnswer });
                } else {
                    locked = true;
                    updateBar('❌ 두 번 틀려서 오답으로 기록했어요! 정답 선을 확인해요 📝', 'wrong');
                    leftBtns.forEach((lBtn) => {
                        if (!lBtn.classList.contains('matched')) {
                            const rBtn = rightBtns.find((rb) => rb.dataset.value === lBtn.dataset.answer && !rb.classList.contains('matched'));
                            if (rBtn) drawLineBetween(lBtn, rBtn, '#f59e0b', true);
                        }
                    });
                    toastFn?.('두 번 틀려서 복습 노트에 저장돼요 📝');
                    onStateChange?.({ status: 'wrong', attempts: wrongTries, wrongCount: wrongTries, matchedCount, lastWrongAnswer });
                }
            });
            rightBtns.push(btn);
            rightCol.appendChild(btn);
        });
        board.append(svg, leftCol, rightCol);
        container.append(statusBar, board);
        if (typeof ResizeObserver === 'function') new ResizeObserver(redrawMatchLines).observe(board);
        board.closest('.worksheet-block')?.addEventListener('study:step-activated', redrawMatchLines);
        if (locked) {
            leftBtns.forEach((lBtn) => {
                const rBtn = rightBtns.find((rb) => rb.dataset.value === lBtn.dataset.answer);
                if (rBtn) linkRecords.push({ elA: lBtn, elB: rBtn, color: '#10b981', dashed: false });
            });
            requestAnimationFrame(redrawMatchLines);
        }
    }

    window.StudyPlayBlocks = { typeLabel, renderDotToDotBlock, renderMazeBlock, renderColorBlock, renderChoicesBlock, renderMatchBlock };
})();
