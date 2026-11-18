/**
 * ==============================================================================
 * 유아 조작형 교구 블록 렌더러 (study-play-manipulatives.js)
 * ------------------------------------------------------------------------------
 * - clock: 드래그 + 터치 버튼으로 아날로그 시계 바늘 맞추기
 * - coins: 동전(100·50·10원) / 수모형(십·일) 상자에 모아 목표 만들기
 * - hangul_tiles: 자음·모음 / 알파벳 자석 타일 낱말 조립
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 44px+ 터치
 * ==============================================================================
 */

(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs = {}) {
        const el = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
        return el;
    }

    function createStatusRow(initialOk, okText, guideText) {
        const bar = document.createElement('div');
        bar.className = 'play-status-pill manip-status-bar';
        bar.dataset.tone = initialOk ? 'ok' : 'info';
        bar.textContent = initialOk ? okText : guideText;
        return bar;
    }

    // 1. 시계 바늘 돌리기 (clock)
    function renderClockBlock(container, blk, speakFn, toastFn, opts = {}) {
        const onStateChange = opts.onStateChange;
        const targetH = Number(blk.targetHour || 3);
        const targetM = Number(blk.targetMinute || 0);
        let curH = opts.initialState === 'correct' ? targetH : ((targetH % 12) + 2) % 12 || 12;
        let curM = opts.initialState === 'correct' ? targetM : 0;
        let wrongTries = 0;
        let locked = opts.initialState === 'correct';

        const statusBar = createStatusRow(locked, `⭐ 정답! (${blk.displayTime})`, `짧은/긴 바늘을 돌리거나 버튼으로 ${blk.displayTime}을 맞추세요 (기회 2번)`);
        const wrap = document.createElement('div');
        wrap.className = 'clock-stage';

        const svg = svgEl('svg', { viewBox: '0 0 260 260', class: 'clock-svg', role: 'img', 'aria-label': '아날로그 시계' });
        svg.appendChild(svgEl('circle', { cx: 130, cy: 130, r: 118, fill: '#fffdf7', stroke: '#f59e0b', 'stroke-width': 8 }));
        svg.appendChild(svgEl('circle', { cx: 130, cy: 130, r: 108, fill: 'none', stroke: '#fde68a', 'stroke-width': 2 }));

        for (let i = 0; i < 60; i++) {
            const a = (i * 6 - 90) * Math.PI / 180;
            const r1 = i % 5 === 0 ? 94 : 99;
            svg.appendChild(svgEl('line', {
                x1: 130 + Math.cos(a) * r1, y1: 130 + Math.sin(a) * r1,
                x2: 130 + Math.cos(a) * 105, y2: 130 + Math.sin(a) * 105,
                stroke: i % 5 === 0 ? '#475569' : '#cbd5e1', 'stroke-width': i % 5 === 0 ? 3 : 1.5, 'stroke-linecap': 'round'
            }));
        }
        for (let n = 1; n <= 12; n++) {
            const a = (n * 30 - 90) * Math.PI / 180;
            const txt = svgEl('text', {
                x: 130 + Math.cos(a) * 78, y: 130 + Math.sin(a) * 78 + 6,
                'text-anchor': 'middle', 'font-size': '18', 'font-weight': '900', fill: '#1e293b'
            });
            txt.textContent = String(n);
            svg.appendChild(txt);
        }

        const hourHand = svgEl('line', { x1: 130, y1: 130, x2: 130, y2: 75, stroke: '#ef4444', 'stroke-width': 8, 'stroke-linecap': 'round' });
        const minHand = svgEl('line', { x1: 130, y1: 130, x2: 130, y2: 42, stroke: '#2563eb', 'stroke-width': 5.5, 'stroke-linecap': 'round' });
        const dragRing = svgEl('circle', { cx: 130, cy: 42, r: 18, fill: 'rgba(37,99,235,0.16)', stroke: '#2563eb', 'stroke-width': 2, class: 'clock-drag-handle' });
        const centerDot = svgEl('circle', { cx: 130, cy: 130, r: 8, fill: '#1e293b' });
        svg.append(hourHand, minHand, dragRing, centerDot);

        const readout = document.createElement('div');
        readout.className = 'clock-readout';

        const drawHands = () => {
            const mAng = (curM * 6 - 90) * Math.PI / 180;
            const hAng = (((curH % 12) + curM / 60) * 30 - 90) * Math.PI / 180;
            hourHand.setAttribute('x2', String(130 + Math.cos(hAng) * 56));
            hourHand.setAttribute('y2', String(130 + Math.sin(hAng) * 56));
            const mx = 130 + Math.cos(mAng) * 86;
            const my = 130 + Math.sin(mAng) * 86;
            minHand.setAttribute('x2', String(mx));
            minHand.setAttribute('y2', String(my));
            dragRing.setAttribute('cx', String(mx));
            dragRing.setAttribute('cy', String(my));
            readout.textContent = `지금 바늘: ${curH}시 ${curM === 0 ? '정각(00분)' : `${curM}분`}`;
        };
        drawHands();

        let draggingMode = null;
        const updateFromPointer = (ev) => {
            if (locked || !draggingMode) return;
            const r = svg.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 450) % 360;
            if (draggingMode === 'minute') {
                const snappedM = (Math.round(deg / 30) * 5) % 60;
                if (curM >= 45 && snappedM <= 15) curH = (curH % 12) + 1;
                else if (curM <= 15 && snappedM >= 45) curH = curH === 1 ? 12 : curH - 1;
                curM = snappedM;
            } else {
                curH = Math.round(deg / 30) % 12 || 12;
            }
            drawHands();
        };

        svg.addEventListener('pointerdown', (e) => {
            if (locked || e.isPrimary === false || (typeof e.button === 'number' && e.button > 0)) return;
            const r = svg.getBoundingClientRect();
            const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
            draggingMode = dist < r.width * 0.24 ? 'hour' : 'minute';
            dragRing.classList.add('dragging');
            svg.setPointerCapture?.(e.pointerId);
            updateFromPointer(e);
        });
        svg.addEventListener('pointermove', (e) => {
            if (draggingMode) updateFromPointer(e);
        });
        const stopDrag = () => {
            draggingMode = null;
            dragRing.classList.remove('dragging');
        };
        svg.addEventListener('pointerup', stopDrag);
        svg.addEventListener('lostpointercapture', stopDrag);

        const ctrlRow = document.createElement('div');
        ctrlRow.className = 'manip-btn-row no-print';
        const stepButtons = [
            { label: '⏰ +1시간', fn: () => { curH = (curH % 12) + 1; } },
            { label: '🕒 +30분', fn: () => { const next = curM + 30; if (next >= 60) curH = (curH % 12) + 1; curM = next % 60; } },
            { label: '➕ +5분', fn: () => { const next = curM + 5; if (next >= 60) curH = (curH % 12) + 1; curM = next % 60; } },
            { label: '➖ -5분', fn: () => { if (curM < 5) { curH = curH === 1 ? 12 : curH - 1; curM = 55; } else curM -= 5; } }
        ];
        stepButtons.forEach((sb) => {
            const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-outline', textContent: sb.label });
            btn.addEventListener('click', () => {
                if (locked) return;
                sb.fn();
                window.StudyFx?.tap?.();
                drawHands();
            });
            ctrlRow.appendChild(btn);
        });

        const checkBtn = Object.assign(document.createElement('button'), {
            type: 'button', className: 'study-btn study-btn-primary manip-check-btn no-print', textContent: '⭕ 시계 시간 확인하기!', disabled: locked
        });
        checkBtn.addEventListener('click', () => {
            if (locked) return;
            if (curH === targetH && curM === targetM) {
                locked = true;
                checkBtn.disabled = true;
                window.StudyFx?.correct?.();
                statusBar.dataset.tone = 'ok';
                statusBar.textContent = `⭐ 정답! ${blk.displayTime}을 멋지게 맞췄어요!`;
                toastFn?.('시계 맞추기 성공! ⏰🌟');
                speakFn?.(`${blk.displayTime}! 정답이에요!`, 'ko-KR');
                onStateChange?.({ status: 'correct', hour: curH, minute: curM, attempts: wrongTries + 1, wrongCount: wrongTries });
                return;
            }
            wrongTries += 1;
            window.StudyFx?.retry?.();
            if (wrongTries === 1) {
                statusBar.dataset.tone = 'warn';
                statusBar.textContent = `⚠️ 아까워요! 지금은 ${curH}시 ${curM}분이에요. 한 번 더 맞춰 볼까요? (남은 기회 1번)`;
                onStateChange?.({ status: 'retrying', hour: curH, minute: curM, attempts: 1, wrongCount: 1, lastWrongAnswer: `${curH}:${curM}` });
            } else {
                locked = true;
                checkBtn.disabled = true;
                curH = targetH;
                curM = targetM;
                drawHands();
                statusBar.dataset.tone = 'wrong';
                statusBar.textContent = `❌ 정답 시계(${blk.displayTime})를 확인해 보아요!`;
                onStateChange?.({ status: 'wrong', hour: curH, minute: curM, attempts: wrongTries, wrongCount: wrongTries, lastWrongAnswer: `${curH}:${curM}` });
            }
        });

        wrap.append(svg, readout, ctrlRow, checkBtn);
        container.append(statusBar, wrap);
    }

    // 2. 동전·수모형 모으기 (coins)
    function renderCoinsBlock(container, blk, speakFn, toastFn, opts = {}) {
        const onStateChange = opts.onStateChange;
        const targetAmount = Number(blk.targetAmount || 100);
        const unit = blk.unitLabel || '원';
        const denoms = Array.isArray(blk.denominations) ? blk.denominations : [{ value: 100, label: '100원', emoji: '🪙' }, { value: 10, label: '10원', emoji: '🟠' }];
        let placed = [];
        let wrongTries = 0;
        let locked = opts.initialState === 'correct';

        if (locked) {
            let rem = targetAmount;
            for (const d of denoms) {
                while (rem >= d.value) { placed.push(d); rem -= d.value; }
            }
        }

        const statusBar = createStatusRow(locked, `⭐ 정답! (${targetAmount}${unit})`, `아래 ${blk.mode === 'blocks' ? '블록' : '동전'}을 눌러 ${targetAmount}${unit}을 모아 보세요 (기회 2번)`);
        const tray = document.createElement('div');
        tray.className = 'coins-tray';
        const countLabel = document.createElement('div');
        countLabel.className = 'coins-count-info';

        const redrawTray = () => {
            tray.innerHTML = '';
            if (!placed.length) {
                tray.innerHTML = `<span class="coins-tray-empty">여기를 채워 주세요! 아래 버튼을 누르면 쏙 들어가요 👇</span>`;
            } else {
                placed.forEach((item, idx) => {
                    const chip = Object.assign(document.createElement('button'), {
                        type: 'button',
                        className: 'coin-placed-chip',
                        textContent: `${item.emoji} ${item.label}`,
                        disabled: locked
                    });
                    chip.setAttribute('aria-label', `${item.label} 빼기`);
                    chip.addEventListener('click', () => {
                        if (locked) return;
                        placed.splice(idx, 1);
                        window.StudyFx?.tap?.();
                        redrawTray();
                    });
                    tray.appendChild(chip);
                });
            }
            const sum = placed.reduce((acc, x) => acc + x.value, 0);
            countLabel.textContent = `담은 조각: ${placed.length}개${blk.mode === 'blocks' || targetAmount <= 100 ? ` · 현재 ${sum}${unit}` : ''}`;
        };

        const palette = document.createElement('div');
        palette.className = 'coin-palette no-print';
        denoms.forEach((d) => {
            const btn = Object.assign(document.createElement('button'), {
                type: 'button',
                className: 'coin-add-btn',
                textContent: `+ ${d.emoji} ${d.label}`,
                disabled: locked
            });
            btn.addEventListener('click', () => {
                if (locked || placed.length >= 16) return;
                placed.push(d);
                window.StudyFx?.tap?.();
                redrawTray();
            });
            palette.appendChild(btn);
        });

        const clearBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-outline', textContent: '🔄 비우기', disabled: locked });
        clearBtn.addEventListener('click', () => {
            if (locked) return;
            placed = [];
            redrawTray();
        });
        palette.appendChild(clearBtn);

        const checkBtn = Object.assign(document.createElement('button'), {
            type: 'button', className: 'study-btn study-btn-primary manip-check-btn no-print', textContent: '⭕ 다 모았어요! 확인하기', disabled: locked
        });
        checkBtn.addEventListener('click', () => {
            if (locked) return;
            const total = placed.reduce((acc, x) => acc + x.value, 0);
            if (total === targetAmount) {
                locked = true;
                checkBtn.disabled = true;
                redrawTray();
                window.StudyFx?.correct?.();
                statusBar.dataset.tone = 'ok';
                statusBar.textContent = `⭐ 딱 맞게 모았어요! (${targetAmount}${unit})`;
                toastFn?.('정확하게 모으기 성공! 🌟');
                onStateChange?.({ status: 'correct', amount: total, attempts: wrongTries + 1, wrongCount: wrongTries });
                return;
            }
            wrongTries += 1;
            window.StudyFx?.retry?.();
            const hintDir = total < targetAmount ? '조금 더 담아 보아요!' : '조금 많아요! 몇 개를 눌러서 빼 보아요!';
            if (wrongTries === 1) {
                statusBar.dataset.tone = 'warn';
                statusBar.textContent = `⚠️ 지금은 ${total}${unit}이에요. ${hintDir} (남은 기회 1번)`;
                onStateChange?.({ status: 'retrying', amount: total, attempts: 1, wrongCount: 1, lastWrongAnswer: String(total) });
            } else {
                locked = true;
                checkBtn.disabled = true;
                redrawTray();
                statusBar.dataset.tone = 'wrong';
                statusBar.textContent = `❌ 목표는 ${targetAmount}${unit}이었어요! 복습에서 다시 도전해요 📝`;
                onStateChange?.({ status: 'wrong', amount: total, attempts: wrongTries, wrongCount: wrongTries, lastWrongAnswer: String(total) });
            }
        });

        redrawTray();
        container.append(statusBar, tray, countLabel, palette, checkBtn);
    }

    // 3. 자모 / 알파벳 자석판 (hangul_tiles)
    function renderHangulTilesBlock(container, blk, speakFn, toastFn, opts = {}) {
        const onStateChange = opts.onStateChange;
        const answerTiles = Array.isArray(blk.answerTiles) ? blk.answerTiles : [];
        const poolTiles = Array.isArray(blk.poolTiles) ? blk.poolTiles : answerTiles;
        const poolState = poolTiles.map((label, idx) => ({ id: idx, label, used: false }));
        const placedIds = Array(answerTiles.length).fill(null);
        let wrongTries = 0;
        let locked = opts.initialState === 'correct';

        if (locked) {
            answerTiles.forEach((ch, slotIdx) => {
                const found = poolState.find((p) => !p.used && p.label === ch);
                if (found) { found.used = true; placedIds[slotIdx] = found.id; }
            });
        }

        const statusBar = createStatusRow(locked, `⭐ 완성! "${blk.targetWord}"`, `자석 타일을 순서대로 눌러 "${blk.targetWord}" 조각을 맞추세요 (기회 2번)`);
        const heroRow = document.createElement('div');
        heroRow.className = 'tiles-hero-row';
        const emojiBox = Object.assign(document.createElement('span'), { className: 'tiles-hero-emoji', textContent: blk.emoji || '🧩' });
        const speakWordBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-secondary', textContent: `🔊 "${blk.targetWord}" 듣기` });
        speakWordBtn.addEventListener('click', () => speakFn?.(blk.ttsText || blk.targetWord, blk.ttsLang || 'ko-KR', speakWordBtn));
        heroRow.append(emojiBox, speakWordBtn);

        const slotsWrap = document.createElement('div');
        slotsWrap.className = 'tile-slots';
        const poolWrap = document.createElement('div');
        poolWrap.className = 'tile-pool no-print';

        const redraw = () => {
            slotsWrap.innerHTML = '';
            placedIds.forEach((pid, slotIdx) => {
                const tile = poolState.find((p) => p.id === pid);
                const btn = Object.assign(document.createElement('button'), {
                    type: 'button',
                    className: `tile-slot ${tile ? 'is-filled' : ''}`,
                    textContent: tile ? tile.label : '?',
                    disabled: locked || !tile
                });
                btn.addEventListener('click', () => {
                    if (locked || !tile) return;
                    tile.used = false;
                    placedIds[slotIdx] = null;
                    window.StudyFx?.tap?.();
                    redraw();
                });
                slotsWrap.appendChild(btn);
            });

            poolWrap.innerHTML = '';
            poolState.forEach((p) => {
                const btn = Object.assign(document.createElement('button'), {
                    type: 'button',
                    className: `magnet-tile ${p.used ? 'is-used' : ''}`,
                    textContent: p.label,
                    disabled: locked || p.used
                });
                btn.addEventListener('click', () => {
                    if (locked || p.used) return;
                    const emptySlot = placedIds.findIndex((x) => x === null);
                    if (emptySlot === -1) return;
                    p.used = true;
                    placedIds[emptySlot] = p.id;
                    window.StudyFx?.tap?.();
                    redraw();
                });
                poolWrap.appendChild(btn);
            });
        };

        const checkBtn = Object.assign(document.createElement('button'), {
            type: 'button', className: 'study-btn study-btn-primary manip-check-btn no-print', textContent: '⭕ 낱말 조립 확인하기!', disabled: locked
        });
        checkBtn.addEventListener('click', () => {
            if (locked) return;
            const currentTiles = placedIds.map((pid) => poolState.find((p) => p.id === pid)?.label || '');
            if (currentTiles.some((t) => !t)) {
                toastFn?.('빈칸 자석을 모두 채워 주세요! 😊');
                return;
            }
            if (currentTiles.join('') === answerTiles.join('')) {
                locked = true;
                checkBtn.disabled = true;
                redraw();
                window.StudyFx?.correct?.();
                statusBar.dataset.tone = 'ok';
                statusBar.textContent = `⭐ 정말 잘했어요! "${blk.targetWord}" 완성!`;
                speakFn?.(blk.ttsText || blk.targetWord, blk.ttsLang || 'ko-KR');
                onStateChange?.({ status: 'correct', tiles: currentTiles, attempts: wrongTries + 1, wrongCount: wrongTries });
                return;
            }
            wrongTries += 1;
            window.StudyFx?.retry?.();
            if (wrongTries === 1) {
                statusBar.dataset.tone = 'warn';
                statusBar.textContent = '⚠️ 순서가 조금 달라요! 칸을 눌러 빼고 다시 맞춰 볼까요? (남은 기회 1번)';
                onStateChange?.({ status: 'retrying', tiles: currentTiles, attempts: 1, wrongCount: 1, lastWrongAnswer: currentTiles.join('') });
            } else {
                locked = true;
                checkBtn.disabled = true;
                redraw();
                statusBar.dataset.tone = 'wrong';
                statusBar.textContent = `❌ 정답 순서: ${answerTiles.join(' · ')}`;
                onStateChange?.({ status: 'wrong', tiles: currentTiles, attempts: wrongTries, wrongCount: wrongTries, lastWrongAnswer: currentTiles.join('') });
            }
        });

        redraw();
        container.append(statusBar, heroRow, slotsWrap, poolWrap, checkBtn);
    }

    window.StudyPlayManipulatives = {
        renderClockBlock,
        renderCoinsBlock,
        renderHangulTilesBlock
    };
})();
