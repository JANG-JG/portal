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
        logic: '두뇌·사고력 퍼즐',
        reading: 'AI 그림 동화·말하기',
        science: '자연·과학 탐험',
        music: '리듬 피아노',
        coloring: '색칠놀이'
    };

    const matchSegments = window.location.pathname.match(/\/study\/sheet\/(\d+)/);
    const sheetId = matchSegments ? matchSegments[1] : null;
    const autoPrint = new URLSearchParams(window.location.search).get('print') === '1';

    let currentSheet = null;
    let blockStates = new Map();
    let retryAllMode = false;
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

    function getTraceBilingualSegments(blk, subject) {
        if (subject !== 'english' || !blk || blk.type !== 'trace') return null;
        const enWord = String(blk.ttsText || blk.targetWord || '').trim();
        const koMeaning = window.StudyTTS?.buildKoreanMeaningSpeech?.(blk.hint, blk.prompt) || String(blk.hint || '').trim();
        if (!enWord || !koMeaning) return null;
        return [{ text: enWord, lang: blk.ttsLang || 'en-US' }, { text: koMeaning, lang: 'ko-KR' }];
    }

    const initBlockStatesFromSheet = (sheet) => {
        blockStates = window.StudySheetResult?.initBlockStatesFromSheet?.(sheet, retryAllMode) || new Map();
    };
    const updateScoreBar = (sheet) => window.StudySheetResult?.updateScoreBar?.(sheet, blockStates);
    const syncBlockChip = (card, state) => window.StudySheetResult?.syncBlockChip?.(card, state);

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
            initBlockStatesFromSheet(currentSheet);
            renderSheet(currentSheet);
            if (autoPrint) {
                setTimeout(() => window.print(), 450);
            }
        } catch (err) {
            document.getElementById('sheetBlocksContainer').innerHTML = '<p>학습지를 불러오지 못했어요.</p>';
        }
    }

    function renderSheet(sheet, stepOpts = {}) {
        const childLabel = sheet.child_name || (sheet.child_id === 'first' ? '첫째' : (sheet.child_id === 'second' ? '둘째' : sheet.child_id));
        const isColoringSheet = sheet.subject === 'coloring';
        document.body.classList.toggle('is-coloring-sheet', isColoringSheet);
        document.getElementById('btnBackToDashboard').href = `/study?childId=${encodeURIComponent(sheet.child_id)}`;
        document.getElementById('sheetTitleHeading').textContent = sheet.title;
        document.getElementById('sheetMetaLine').textContent = isColoringSheet
            ? `${childLabel} · 🎨 ${SUBJECT_NAMES.coloring}`
            : `${childLabel} · ${SUBJECT_NAMES[sheet.subject] || sheet.subject} · Lv.${sheet.level}`;
        document.getElementById('sheetInfoLine').textContent =
            `어린이: ${childLabel}  |  주제: ${sheet.theme}  |  날짜: ${String(sheet.created_at || '').slice(0, 10)}`;
        const baseBadge = sheet.source === 'coloring_studio'
            ? '🎨 색칠 도안 스튜디오'
            : (String(sheet.source || '').startsWith('gemini') ? '✨ AI 맞춤 학습' : '📚 안전 학습 은행');
        document.getElementById('sheetSourceBadge').textContent = sheet.shared_from_child_id
            ? `🔁 ${baseBadge} (${sheet.shared_from_name || sheet.shared_from_child_id} 교차 출제)`
            : baseBadge;

        const retryBanner = document.getElementById('sheetRetryBanner');
        const retryText = document.getElementById('sheetRetryText');
        if (retryBanner) {
            const hasPendingWrong = !isColoringSheet && !retryAllMode && !sheet.completed_at && Number(sheet.lastResult?.wrongCount || 0) > 0;
            retryBanner.hidden = !hasPendingWrong;
            if (hasPendingWrong && retryText) {
                retryText.textContent = `📝 지난번에 틀린 ${sheet.lastResult.wrongCount}문제를 다시 풀어서 맞추면 별을 받을 수 있어요!`;
            }
        }

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
            card.dataset.blockIndex = String(idx);
            const swapLabel = blk.type === 'color' ? '🔄 다른 그림으로' : '🔄 문제 바꾸기';
            const scoredState = blockStates.get(idx) || null;
            const chipHtml = scoredState ? '<span class="block-status-chip no-print" data-state="pending">기회 2번</span>' : '';

            card.innerHTML = `
                <div class="block-head">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="block-num">${idx + 1}</span>
                        <span style="font-weight: 800; color: #475569;">${blockTypeLabel(blk.type)}</span>
                        ${chipHtml}
                    </div>
                    <div class="block-actions no-print" style="display: flex; gap: 6px;">
                        <button type="button" class="study-btn study-btn-secondary btn-block-tts" style="min-block-size: 38px; padding: 6px 12px; font-size: 0.86rem;">🔊 듣기</button>
                        <button type="button" class="study-btn study-btn-outline btn-block-swap" style="min-block-size: 38px; padding: 6px 12px; font-size: 0.86rem;">${swapLabel}</button>
                    </div>
                </div>
                ${blk.isWrongReview ? `<div class="block-review-badge">🔁 ${escapeHtml(blk.reviewBadge || '지난번 헷갈렸던 문제 복습!')}</div>` : ''}
                <p class="block-prompt">${escapeHtml(blk.prompt)}</p>
                <div class="block-body"></div>
            `;

            card.querySelector('.btn-block-tts').addEventListener('click', (ev) => {
                const targetBtn = ev.currentTarget;
                const fallbackSpeak = () => {
                    const seq = getTraceBilingualSegments(blk, sheet.subject);
                    if (seq && window.StudyTTS && typeof window.StudyTTS.speakSequence === 'function') {
                        window.StudyTTS.speakSequence(seq, targetBtn);
                    } else {
                        speakText(blk.ttsText || blk.prompt, blk.ttsLang || 'ko-KR', targetBtn);
                    }
                };
                if (blk.audioUrl) {
                    const audio = new Audio(blk.audioUrl);
                    audio.play().catch(fallbackSpeak);
                } else {
                    fallbackSpeak();
                }
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
                        initBlockStatesFromSheet(currentSheet);
                        renderSheet(currentSheet, { preserveStep: true });
                        showToast(`${idx + 1}번 문제를 새로운 문제로 바꿨어요!`);
                    }
                } catch (e) {
                    showToast('문제를 바꾸는 중 오류가 났어요.');
                    btn.disabled = false;
                }
            });

            const onScoredStateChange = (info) => {
                const cur = blockStates.get(idx);
                if (!cur) return;
                Object.assign(cur, info);
                syncBlockChip(card, cur);
                updateScoreBar(sheet);
                window.StudySheetStepper?.refreshStates?.(blockStates);
            };

            const initialState = scoredState?.status === 'correct' ? 'correct' : null;
            const bodyEl = card.querySelector('.block-body');
            const opts = { initialState, onStateChange: onScoredStateChange };
            if (window.StudySheetResult?.renderBlockContent) {
                window.StudySheetResult.renderBlockContent({ bodyEl, blk, sheet, opts, speakText, showToast, renderTraceBlock });
            } else if (blk.type === 'trace') {
                renderTraceBlock(bodyEl, blk);
            } else {
                renderQuizBlock(bodyEl, blk, opts);
            }

            if (scoredState) syncBlockChip(card, scoredState);
            container.appendChild(card);
        });

        updateScoreBar(sheet);
        window.StudySheetStepper?.mount?.({ container, blocks, blockStates, ...stepOpts });

        const encEl = document.getElementById('sheetEncouragement');
        const compBtn = document.getElementById('btnCompleteSheet');
        if (encEl) {
            encEl.textContent = isColoringSheet
                ? '색칠놀이는 별·도장 없이 자유롭게 즐기는 시간이에요! 다 칠했으면 저장하고 마무리해 보아요 🎨'
                : '모든 문제를 다 풀었다면 아래 버튼을 눌러 채점하고 별(칭찬 도장)을 받아 보세요!';
        }
        if (compBtn && isColoringSheet) {
            compBtn.textContent = sheet.completed_at ? '✅ 색칠 완료! (학습실로 가기)' : '🎨 색칠놀이 완성! (별 없이 마무리)';
        } else if (compBtn && sheet.completed_at) {
            compBtn.textContent = '✅ 이미 완료해서 별(칭찬 도장)을 받았어요!';
        } else if (compBtn) {
            compBtn.textContent = '🌟 채점하고 별(칭찬 도장) 받기';
        }
        const ttsItems = [];
        blocks.forEach((b) => {
            const seq = getTraceBilingualSegments(b, sheet.subject);
            if (seq) {
                seq.forEach((s) => ttsItems.push(s));
            } else {
                ttsItems.push({ text: b.ttsText || b.prompt, lang: b.ttsLang || 'ko-KR' });
            }
            if (b.type === 'match' && Array.isArray(b.pairs)) {
                const isLang = sheet.subject === 'korean' || sheet.subject === 'english';
                b.pairs.forEach((p) => { const w = p.ttsText || (isLang ? p.right : ''); if (w) ttsItems.push({ text: w, lang: p.ttsLang || (sheet.subject === 'english' ? 'en-US' : 'ko-KR') }); });
            }
        });
        window.StudyTTS?.prefetch?.(ttsItems);
    }

    function blockTypeLabel(type) {
        return window.StudySheetResult?.getBlockTypeLabel?.(type) || '🎯 골라보기 퀴즈';
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
            ctx.lineWidth = isEraser ? 32 : 10;
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
        wrap.closest('.worksheet-block')?.addEventListener('study:step-activated', resizeCanvas);
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(resizeCanvas).observe(wrap);
        } else {
            window.addEventListener('resize', resizeCanvas);
        }

        const getPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        const applyStrokeWidth = (e) => {
            if (activeTool === 'eraser') { ctx.lineWidth = 32; return; }
            ctx.lineWidth = (e && e.pointerType === 'pen' && e.pressure > 0) ? (5.2 + Math.min(1, e.pressure) * 10.8) : 10;
        };
        const beginStroke = (p, e) => {
            drawing = true;
            if (activeTool === 'pen') hasInk = true;
            applyToolStyle(); applyStrokeWidth(e);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y + 0.01); ctx.stroke();
        };
        const moveStroke = (p, e) => {
            if (!drawing) return;
            if (activeTool === 'pen' && e && e.pointerType === 'pen' && e.pressure > 0) applyStrokeWidth(e);
            ctx.lineTo(p.x, p.y); ctx.stroke();
        };
        const endDraw = () => { drawing = false; };
        if (window.StudyTablet && window.StudyTablet.bindDrawingCanvas) {
            window.StudyTablet.bindDrawingCanvas(canvas, { getPos, onStart: beginStroke, onMove: moveStroke, onEnd: endDraw, onResize: resizeCanvas });
        } else {
            canvas.addEventListener('pointerdown', (e) => { if (e.isPrimary !== false) { canvas.setPointerCapture(e.pointerId); beginStroke(getPos(e), e); } });
            canvas.addEventListener('pointermove', (e) => moveStroke(getPos(e), e));
            canvas.addEventListener('pointerup', endDraw);
            canvas.addEventListener('pointercancel', endDraw);
        }

        const toolBtns = Array.from(meta.querySelectorAll('[data-tool]'));
        const selectTool = (nextTool) => {
            activeTool = nextTool; wrap.dataset.tool = activeTool;
            toolBtns.forEach((b) => {
                const on = b.dataset.tool === activeTool;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            applyToolStyle();
        };
        toolBtns.forEach((btn) => btn.addEventListener('click', () => selectTool(btn.dataset.tool)));
        const hwCtrl = window.StudyHangulTrace
            ? window.StudyHangulTrace.enhanceTraceBlock({ meta, wrap, rawWord, speakFn: speakText, toastFn: showToast, onSelectFreeMode: selectTool })
            : null;
        meta.querySelector('.btn-clear-canvas').addEventListener('click', () => {
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
            hasInk = false; applyToolStyle();
            if (hwCtrl && typeof hwCtrl.reset === 'function') hwCtrl.reset();
        });
    }

    function renderCountBlock(container, blk, choiceOpts = {}) {
        window.StudySheetResult?.renderCountBlock?.(container, blk, speakText, choiceOpts);
    }

    function renderQuizBlock(container, blk, choiceOpts = {}) {
        window.StudySheetResult?.renderQuizBlock?.(container, blk, currentSheet?.subject, speakText, choiceOpts);
    }

    function retryWrongBlocksOnly() {
        if (!currentSheet) return;
        const blocks = Array.isArray(currentSheet.content?.blocks) ? currentSheet.content.blocks : [];
        let firstWrongIdx = -1;
        blockStates.forEach((st, idx) => {
            if (st.status !== 'correct') {
                if (firstWrongIdx === -1) firstWrongIdx = idx;
                const blk = blocks[idx];
                blockStates.set(idx, {
                    blockIndex: idx,
                    blockId: blk?.id || `block-${idx + 1}`,
                    blockType: blk?.type || st.blockType,
                    status: 'pending',
                    attempts: 0,
                    wrongCount: 0,
                    finalAnswer: '',
                    matchedCount: 0,
                    lastWrongAnswer: '',
                    restored: false
                });
            }
        });
        currentSheet.lastResult = {
            totalScored: blockStates.size,
            correctCount: Array.from(blockStates.values()).filter((s) => s.status === 'correct').length,
            wrongCount: Array.from(blockStates.values()).filter((s) => s.status !== 'correct').length,
            blockResults: Array.from(blockStates.values())
        };
        retryAllMode = false;
        renderSheet(currentSheet, { focusIndex: firstWrongIdx >= 0 ? firstWrongIdx : 0 });
        if (firstWrongIdx >= 0 && !window.StudySheetStepper) {
            const targetCard = document.querySelector(`.worksheet-block[data-block-index="${firstWrongIdx}"]`);
            targetCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btnPrintA4')?.addEventListener('click', () => window.print());
        document.getElementById('btnResetAllBlocks')?.addEventListener('click', () => {
            if (!currentSheet) return;
            retryAllMode = true;
            initBlockStatesFromSheet(currentSheet);
            renderSheet(currentSheet, { focusIndex: 0 });
            showToast('전체 문제를 처음부터 다시 풀어요!');
        });
        document.getElementById('btnCompleteSheet')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            if (!currentSheet) return;
            const isColoring = currentSheet.subject === 'coloring';
            if (!isColoring) {
                for (const [idx, st] of blockStates.entries()) {
                    if (st.status !== 'correct' && st.status !== 'wrong') {
                        window.StudySheetStepper?.goToStep?.(idx);
                        const targetCard = document.querySelector(`.worksheet-block[data-block-index="${idx}"]`);
                        targetCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        showToast(`${idx + 1}번 문제를 먼저 풀어야 채점할 수 있어요 😊`);
                        return;
                    }
                }
            }
            btn.disabled = true;
            try {
                const blockResults = isColoring ? [] : Array.from(blockStates.values());
                const res = await fetch(`/api/study/sheets/${sheetId}/complete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ blockResults })
                });
                const data = await res.json();
                showToast(data.message || '완료되었어요!');
                if (!data.success) { btn.disabled = false; return; }
                if (isColoring) {
                    window.StudyFx?.tap?.();
                    btn.textContent = '✅ 색칠 완성! (학습실로 가기)';
                    btn.disabled = false;
                    btn.onclick = () => { window.location.href = `/study?childId=${encodeURIComponent(currentSheet?.child_id || 'first')}`; };
                    return;
                }
                if (data.stampAwarded) {
                    window.StudyFx?.fanfare?.();
                    window.StudyFx?.celebrate?.({ big: Boolean(data.reachedTen) });
                    btn.textContent = data.reachedTen ? '🎉 도장 10칸 완성! 알 부화 보러 가기 🥚✨' : '✅ 별(칭찬 도장)을 받았어요! (학습실로 가기)';
                } else {
                    window.StudyFx?.retry?.();
                    btn.textContent = '🔄 틀린 문제 다시 풀고 별 받기';
                }
                btn.disabled = false;
                window.StudySheetResult?.openResultDialog({ sheet: currentSheet, data, onRetryWrong: retryWrongBlocksOnly });
            } catch (e) { btn.disabled = false; showToast('완료 저장 중 문제가 생겼어요.'); }
        });
        loadSheet();
    });
})();
