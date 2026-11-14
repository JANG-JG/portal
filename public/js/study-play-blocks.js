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
    const CRAYONS = [
        { name: '빨강', hex: '#ef4444' },
        { name: '주황', hex: '#fb923c' },
        { name: '노랑', hex: '#facc15' },
        { name: '초록', hex: '#22c55e' },
        { name: '파랑', hex: '#3b82f6' },
        { name: '보라', hex: '#a855f7' },
        { name: '분홍', hex: '#f472b6' },
        { name: '하양(지우개)', hex: '#ffffff' }
    ];

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
                        if (speakFn) speakFn(`와! 멋진 ${blk.shapeName || '그림'}을 완성했어요!`, 'ko-KR');
                    } else {
                        statusBadge.textContent = `다음 점: ${points[nextIdx].label}`;
                        banner.style.color = '#0284c7';
                        banner.textContent = `잘했어요! 다음은 '${points[nextIdx].label}'을 찾아보세요.`;
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
                                if (speakFn) speakFn('만세! 길을 끝까지 잘 찾았어요!', 'ko-KR');
                            } else {
                                const upcoming = path[stepIdx + 1];
                                statusBadge.textContent = `다음 칸: ${upcoming.label}`;
                                banner.style.color = '#0284c7';
                                banner.textContent = `한 걸음 전진! 이제 '${upcoming.label}' 칸을 눌러 보세요.`;
                            }
                            renderGrid();
                        } else {
                            btn.classList.remove('is-shake');
                            void btn.offsetWidth;
                            btn.classList.add('is-shake');
                            banner.style.color = '#d97706';
                            banner.textContent = `붙어 있는 '${nextTarget.label}' 칸으로 이동해 보아요!`;
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

    function renderColorBlock(container, blk, speakFn) {
        let activeHex = CRAYONS[0].hex;
        let paintedCount = 0;

        const palette = document.createElement('div');
        palette.className = 'color-palette no-print';
        palette.setAttribute('role', 'group');
        palette.setAttribute('aria-label', '색연필 고르기');

        CRAYONS.forEach((c, idx) => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = `color-swatch${idx === 0 ? ' active' : ''}`;
            sw.style.backgroundColor = c.hex;
            sw.setAttribute('aria-label', `${c.name} 색연필`);
            sw.title = c.name;
            sw.addEventListener('click', () => {
                activeHex = c.hex;
                palette.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('active', b === sw));
            });
            palette.appendChild(sw);
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'study-btn study-btn-outline play-reset-btn';
        clearBtn.textContent = '🧹 다시 칠하기';
        palette.appendChild(clearBtn);

        const stage = document.createElement('div');
        stage.className = 'coloring-stage';
        stage.innerHTML = window.StudyIllustrations
            ? window.StudyIllustrations.getColoringSvg(blk.templateId || 'dino')
            : '<p>색칠 도안을 불러오지 못했어요.</p>';

        const banner = document.createElement('p');
        banner.className = 'play-feedback';
        banner.textContent = blk.hint || '원하는 색연필을 고른 뒤 그림 안을 톡톡 눌러 보세요!';

        const parts = stage.querySelectorAll('[data-color-part]');
        parts.forEach((part) => {
            part.addEventListener('click', () => {
                part.setAttribute('fill', activeHex);
                if (activeHex !== '#ffffff' && !part.dataset.painted) {
                    part.dataset.painted = '1';
                    paintedCount += 1;
                    if (paintedCount === 3) {
                        banner.style.color = '#047857';
                        banner.textContent = '우와, 색감이 정말 예뻐요! 계속 멋지게 칠해 보세요 🎨';
                        if (speakFn) speakFn('우와! 정말 예쁘게 칠하고 있네요!', 'ko-KR');
                    }
                }
            });
        });

        clearBtn.addEventListener('click', () => {
            parts.forEach((p) => {
                p.setAttribute('fill', '#ffffff');
                delete p.dataset.painted;
            });
            paintedCount = 0;
            banner.style.color = '#64748b';
            banner.textContent = '깨끗해졌어요! 다시 예쁘게 칠해 보아요 🎨';
        });

        container.appendChild(palette);
        container.appendChild(stage);
        container.appendChild(banner);
    }

    window.StudyPlayBlocks = {
        typeLabel,
        renderDotToDotBlock,
        renderMazeBlock,
        renderColorBlock
    };
})();
