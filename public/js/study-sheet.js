/**
 * ==============================================================================
 * 학습지 태블릿 터치 인터랙션 & 부분 교체·도장 완료 엔진 (study-sheet.js)
 * ------------------------------------------------------------------------------
 * - 캔버스 손가락 따라쓰기 (pointerdown/move/up) + 지우기
 * - 터치 카운팅 (하나씩 콕 누르며 숫자 배지 표시)
 * - 두 번 탭 선 긋기 (SVG 직선 연결)
 * - Web Speech TTS 읽어주기 + ④ 영역별 부분 교체 버튼
 * ==============================================================================
 */

(function () {
    'use strict';

    const SUBJECT_NAMES = {
        korean: '한글 놀이',
        math: '숫자·수학 놀이',
        english: '영어 놀이',
        coloring: '색칠놀이'
    };

    const matchSegments = window.location.pathname.match(/\/study\/sheet\/(\d+)/);
    const sheetId = matchSegments ? matchSegments[1] : null;
    const autoPrint = new URLSearchParams(window.location.search).get('print') === '1';

    let currentSheet = null;
    const toastEl = document.getElementById('studyToast');

    function showToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.hidden = false;
        clearTimeout(toastEl._timer);
        toastEl._timer = setTimeout(() => { toastEl.hidden = true; }, 3200);
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
        } catch (e) {}
    }

    async function loadSheet() {
        if (!sheetId) {
            document.getElementById('sheetBlocksContainer').innerHTML = '<p>학습지 번호가 올바르지 않아요.</p>';
            return;
        }
        try {
            const res = await fetch(`/api/study/sheets/${sheetId}`, { credentials: 'include' });
            const data = await res.json();
            if (!data.success || !data.sheet) {
                document.getElementById('sheetBlocksContainer').innerHTML = `<p>${escapeHtml(data.message || '학습지를 찾을 수 없어요.')}</p>`;
                return;
            }
            currentSheet = data.sheet;
            renderSheet(currentSheet);
            if (autoPrint) {
                setTimeout(() => window.print(), 450);
            }
        } catch (err) {
            document.getElementById('sheetBlocksContainer').innerHTML = '<p>학습지를 불러오지 못했어요.</p>';
        }
    }

    function renderSheet(sheet) {
        const childLabel = sheet.child_name || (sheet.child_id === 'first' ? '첫째' : (sheet.child_id === 'second' ? '둘째' : sheet.child_id));
        const isColoringSheet = sheet.subject === 'coloring';
        document.getElementById('btnBackToDashboard').href = `/study?childId=${encodeURIComponent(sheet.child_id)}`;
        document.getElementById('sheetTitleHeading').textContent = sheet.title;
        document.getElementById('sheetMetaLine').textContent = isColoringSheet
            ? `${childLabel} · 🎨 ${SUBJECT_NAMES.coloring}`
            : `${childLabel} · ${SUBJECT_NAMES[sheet.subject] || sheet.subject} · Lv.${sheet.level}`;
        document.getElementById('sheetInfoLine').textContent =
            `어린이: ${childLabel}  |  주제: ${sheet.theme}  |  날짜: ${String(sheet.created_at || '').slice(0, 10)}`;
        const sourceBadge = sheet.source === 'coloring_studio'
            ? '🎨 색칠 도안 스튜디오'
            : (String(sheet.source || '').startsWith('gemini') ? '✨ AI 맞춤 학습' : '📚 안전 학습 은행');
        document.getElementById('sheetSourceBadge').textContent = sourceBadge;

        const themeArtEl = document.getElementById('sheetThemeArt');
        if (themeArtEl && window.StudyIllustrations) {
            themeArtEl.innerHTML = window.StudyIllustrations.getThemeBannerSvg(sheet.theme, sheet.title);
        }

        const container = document.getElementById('sheetBlocksContainer');
        const blocks = Array.isArray(sheet.content?.blocks) ? sheet.content.blocks : [];
        container.innerHTML = '';

        blocks.forEach((blk, idx) => {
            const card = document.createElement('article');
            card.className = (isColoringSheet && blocks.length === 1)
                ? 'worksheet-block coloring-sheet-solo'
                : 'worksheet-block';
            const swapLabel = blk.type === 'color' ? '🔄 다른 그림으로' : '🔄 문제 바꾸기';
            card.innerHTML = `
                <div class="block-head">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="block-num">${idx + 1}</span>
                        <span style="font-weight: 800; color: #475569;">${blockTypeLabel(blk.type)}</span>
                    </div>
                    <div class="block-actions no-print" style="display: flex; gap: 6px;">
                        <button type="button" class="study-btn study-btn-secondary btn-block-tts" style="min-block-size: 38px; padding: 6px 12px; font-size: 0.86rem;">🔊 듣기</button>
                        <button type="button" class="study-btn study-btn-outline btn-block-swap" style="min-block-size: 38px; padding: 6px 12px; font-size: 0.86rem;">${swapLabel}</button>
                    </div>
                </div>
                <p class="block-prompt">${escapeHtml(blk.prompt)}</p>
                <div class="block-body"></div>
            `;

            card.querySelector('.btn-block-tts').addEventListener('click', (ev) => {
                speakText(blk.ttsText || blk.prompt, blk.ttsLang || 'ko-KR', ev.currentTarget);
            });

            card.querySelector('.btn-block-swap').addEventListener('click', async (ev) => {
                const btn = ev.currentTarget;
                btn.disabled = true;
                try {
                    const res = await fetch(`/api/study/sheets/${sheetId}/regenerate-block`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ blockIndex: idx })
                    });
                    const data = await res.json();
                    if (data.success && data.content) {
                        currentSheet.content = data.content;
                        renderSheet(currentSheet);
                        showToast(`${idx + 1}번 문제를 새로운 문제로 바꿨어요!`);
                    }
                } catch (e) {
                    showToast('문제를 바꾸는 중 오류가 났어요.');
                    btn.disabled = false;
                }
            });

            const bodyEl = card.querySelector('.block-body');
            if (blk.type === 'trace') renderTraceBlock(bodyEl, blk);
            else if (blk.type === 'count') renderCountBlock(bodyEl, blk);
            else if (blk.type === 'match') renderMatchBlock(bodyEl, blk);
            else if (blk.type === 'dot_to_dot' && window.StudyPlayBlocks) window.StudyPlayBlocks.renderDotToDotBlock(bodyEl, blk, speakText, showToast);
            else if (blk.type === 'maze' && window.StudyPlayBlocks) window.StudyPlayBlocks.renderMazeBlock(bodyEl, blk, speakText, showToast);
            else if (blk.type === 'color' && window.StudyPlayBlocks) window.StudyPlayBlocks.renderColorBlock(bodyEl, blk, speakText, showToast);
            else renderQuizBlock(bodyEl, blk);

            container.appendChild(card);
        });

        const compBtn = document.getElementById('btnCompleteSheet');
        if (sheet.completed_at && compBtn) {
            compBtn.textContent = '✅ 이미 완료해서 칭찬 도장을 받았어요!';
        }
        if (window.StudyTTS && typeof window.StudyTTS.prefetch === 'function') {
            window.StudyTTS.prefetch(blocks.map((b) => ({ text: b.ttsText || b.prompt, lang: b.ttsLang || 'ko-KR' })));
        }
    }

    function blockTypeLabel(type) {
        if (type === 'trace') return '✍️ 손가락 따라쓰기';
        if (type === 'count') return '👆 하나씩 콕! 숫자 세기';
        if (type === 'match') return '🔗 두 번 탭 선 잇기';
        if (window.StudyPlayBlocks) {
            const playLbl = window.StudyPlayBlocks.typeLabel(type);
            if (playLbl) return playLbl;
        }
        return '🎯 골라보기 퀴즈';
    }

    function renderTraceBlock(container, blk) {
        const rawWord = String(blk.targetWord || '').trim();
        const chars = Array.from(rawWord);
        const nonSpaceCount = chars.filter((ch) => !/\s/.test(ch)).length;

        const meta = document.createElement('div');
        meta.className = 'trace-meta-bar';
        meta.innerHTML = `
            <span class="trace-word-label">${escapeHtml(blk.emoji || '✏️')} <strong>${escapeHtml(rawWord)}</strong></span>
            <div class="trace-toolbar no-print" role="group" aria-label="따라쓰기 도구">
                <button type="button" class="study-btn trace-tool-btn active" data-tool="pen" aria-pressed="true">✏️ 쓰기</button>
                <button type="button" class="study-btn trace-tool-btn" data-tool="eraser" aria-pressed="false">🧽 지우개</button>
                <button type="button" class="study-btn study-btn-outline trace-tool-btn btn-clear-canvas">🧹 다 지우기</button>
            </div>
        `;

        const wrap = document.createElement('div');
        wrap.className = 'trace-wrap trace-wrap-roomy';
        wrap.dataset.tool = 'pen';

        const guide = document.createElement('div');
        guide.className = nonSpaceCount >= 6 ? 'trace-guide trace-guide--dense' : 'trace-guide';
        guide.setAttribute('aria-hidden', 'true');

        guide.innerHTML = chars.length
            ? chars.map((ch) => /\s/.test(ch)
                ? '<div class="trace-char-gap"></div>'
                : `<div class="trace-char-box"><span>${escapeHtml(ch)}</span></div>`).join('')
            : '<div class="trace-char-box"></div>';

        const canvas = document.createElement('canvas');
        canvas.className = 'trace-canvas';
        wrap.append(guide, canvas);
        container.append(meta, wrap);

        const ctx = canvas.getContext('2d');
        let activeTool = 'pen';
        let hasInk = false;
        let drawing = false;

        const applyToolStyle = () => {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const isEraser = activeTool === 'eraser';
            ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
            ctx.lineWidth = isEraser ? 28 : 8;
            ctx.strokeStyle = '#ea580c';
        };

        const resizeCanvas = () => {
            const rect = wrap.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const targetW = Math.max(200, Math.floor(rect.width * dpr));
            const targetH = Math.max(160, Math.floor(rect.height * dpr));
            if (targetW === canvas.width && targetH === canvas.height) return;

            let snapshot = null;
            if (canvas.width > 0 && canvas.height > 0 && hasInk) {
                snapshot = document.createElement('canvas');
                snapshot.width = canvas.width;
                snapshot.height = canvas.height;
                snapshot.getContext('2d').drawImage(canvas, 0, 0);
            }
            canvas.width = targetW;
            canvas.height = targetH;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (snapshot) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(snapshot, 0, 0, rect.width, rect.height);
            }
            applyToolStyle();
        };
        requestAnimationFrame(resizeCanvas);
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(resizeCanvas).observe(wrap);
        } else {
            window.addEventListener('resize', resizeCanvas);
        }

        const getPos = (e) => {
            const r = canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        canvas.addEventListener('pointerdown', (e) => {
            drawing = true;
            if (activeTool === 'pen') hasInk = true;
            canvas.setPointerCapture(e.pointerId);
            applyToolStyle();
            const p = getPos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 0.01, p.y + 0.01);
            ctx.stroke();
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drawing) return;
            const p = getPos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        });
        const endDraw = () => { drawing = false; };
        canvas.addEventListener('pointerup', endDraw);
        canvas.addEventListener('pointercancel', endDraw);

        const toolBtns = Array.from(meta.querySelectorAll('[data-tool]'));
        toolBtns.forEach((btn) => btn.addEventListener('click', () => {
            activeTool = btn.dataset.tool;
            wrap.dataset.tool = activeTool;
            toolBtns.forEach((b) => {
                const on = b.dataset.tool === activeTool;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            applyToolStyle();
        }));
        meta.querySelector('.btn-clear-canvas').addEventListener('click', () => {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
            hasInk = false;
            applyToolStyle();
        });
    }

    function renderCountBlock(container, blk) {
        const count = Number(blk.count || 3);
        let tappedSeq = 0;

        const grid = document.createElement('div');
        grid.className = 'count-grid';
        for (let i = 0; i < count; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'count-item-btn';
            btn.textContent = blk.emoji || '🍎';
            btn.addEventListener('click', () => {
                if (btn.classList.contains('counted')) return;
                tappedSeq += 1;
                btn.classList.add('counted');
                const badge = document.createElement('span');
                badge.className = 'count-badge';
                badge.textContent = String(tappedSeq);
                btn.appendChild(badge);
                speakText(String(tappedSeq), 'ko-KR');
            });
            grid.appendChild(btn);
        }
        container.appendChild(grid);
        renderChoicesBlock(container, blk);
    }

    function renderQuizBlock(container, blk) {
        if (blk.visualLeft || blk.visualRight || blk.equationText) {
            const box = document.createElement('div');
            box.className = 'quiz-visual-box';
            if (blk.visualLeft && blk.visualRight) {
                const mk = (cls, txt) => Object.assign(document.createElement('span'), { className: cls, textContent: txt });
                const row = document.createElement('div');
                row.className = 'quiz-visual-equation-row';
                row.append(
                    mk('quiz-visual-side', blk.visualLeft),
                    mk('quiz-visual-op', blk.operator || '+'),
                    mk('quiz-visual-side', blk.visualRight)
                );
                box.appendChild(row);
            } else if (blk.visualLeft || blk.visualRight) {
                const text = String(blk.visualLeft || blk.visualRight).trim();
                const vis = document.createElement('div');
                vis.className = !/\s/.test(text) ? 'quiz-visual-hero' : 'quiz-visual-group';
                vis.textContent = text;
                box.appendChild(vis);
            }
            if (blk.equationText) {
                const eq = document.createElement('div');
                eq.className = 'quiz-equation-text';
                eq.textContent = blk.equationText;
                box.appendChild(eq);
            }
            container.appendChild(box);
        }
        renderChoicesBlock(container, blk);
    }

    function renderChoicesBlock(container, blk) {
        const grid = document.createElement('div');
        grid.className = 'choice-grid';
        const feedback = document.createElement('p');
        feedback.style.cssText = 'font-weight:800; margin:10px 0 0; min-height:1.4em;';

        (blk.choices || []).forEach((ch) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn';
            btn.textContent = ch;
            btn.addEventListener('click', () => {
                const isOk = String(ch).trim().toUpperCase() === String(blk.answer).trim().toUpperCase();
                grid.querySelectorAll('.choice-btn').forEach((b) => b.classList.remove('correct', 'wrong'));
                btn.classList.add(isOk ? 'correct' : 'wrong');
                feedback.style.color = isOk ? '#047857' : '#dc2626';
                feedback.textContent = isOk ? '딩동댕! 정답이에요! 🌟' : '한 번 더 생각해 볼까요? 😊';
                if (isOk) speakText('딩동댕! 참 잘했어요!', 'ko-KR');
            });
            grid.appendChild(btn);
        });

        container.appendChild(grid);
        container.appendChild(feedback);
    }

    function renderMatchBlock(container, blk) {
        const board = document.createElement('div');
        board.className = 'match-board';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'match-svg');

        const leftCol = document.createElement('div');
        leftCol.className = 'match-col';
        const rightCol = document.createElement('div');
        rightCol.className = 'match-col';

        let selectedLeft = null;
        const pairs = blk.pairs || [];
        const rights = blk.shuffledRights || pairs.map((p) => p.right);

        const drawLineBetween = (elA, elB, color = '#10b981') => {
            const bRect = board.getBoundingClientRect();
            const aRect = elA.getBoundingClientRect();
            const cRect = elB.getBoundingClientRect();
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(aRect.right - bRect.left));
            line.setAttribute('y1', String(aRect.top + aRect.height / 2 - bRect.top));
            line.setAttribute('x2', String(cRect.left - bRect.left));
            line.setAttribute('y2', String(cRect.top + cRect.height / 2 - bRect.top));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', '5');
            line.setAttribute('stroke-linecap', 'round');
            svg.appendChild(line);
        };

        pairs.forEach((p) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isVisual = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(p.left || ''));
            btn.className = isVisual ? 'match-node match-node--visual' : 'match-node';
            btn.textContent = p.left;
            btn.dataset.answer = p.right;
            btn.addEventListener('click', () => {
                if (btn.classList.contains('matched')) return;
                leftCol.querySelectorAll('.match-node').forEach((n) => n.classList.remove('selected'));
                selectedLeft = btn;
                btn.classList.add('selected');
            });
            leftCol.appendChild(btn);
        });

        rights.forEach((rVal) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'match-node';
            btn.textContent = rVal;
            btn.addEventListener('click', () => {
                if (!selectedLeft || btn.classList.contains('matched')) return;
                if (selectedLeft.dataset.answer === rVal) {
                    selectedLeft.classList.remove('selected');
                    selectedLeft.classList.add('matched');
                    btn.classList.add('matched');
                    drawLineBetween(selectedLeft, btn, '#10b981');
                    selectedLeft = null;
                    showToast('짝꿍 찾기 성공! 🌟');
                } else {
                    selectedLeft.classList.remove('selected');
                    selectedLeft = null;
                    showToast('다른 짝꿍을 찾아 볼까요?');
                }
            });
            rightCol.appendChild(btn);
        });

        board.appendChild(svg);
        board.appendChild(leftCol);
        board.appendChild(rightCol);
        container.appendChild(board);
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btnPrintA4')?.addEventListener('click', () => window.print());
        document.getElementById('btnCompleteSheet')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
                const res = await fetch(`/api/study/sheets/${sheetId}/complete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                });
                const data = await res.json();
                showToast(data.message || '칭찬 도장을 받았어요!');
                if (data.success) {
                    btn.textContent = '✅ 칭찬 도장을 받았어요! (학습실로 가기)';
                    btn.disabled = false;
                    btn.onclick = () => {
                        window.location.href = `/study?childId=${encodeURIComponent(currentSheet?.child_id || 'first')}`;
                    };
                }
            } catch (e) {
                btn.disabled = false;
                showToast('완료 저장 중 문제가 생겼어요.');
            }
        });
        loadSheet();
    });
})();
