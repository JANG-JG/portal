/**
 * ==============================================================================
 * AI 그림 동화책 & 로컬 음성 말하기(따라 읽기) 렌더러 (study-play-storybook.js)
 * ------------------------------------------------------------------------------
 * - storybook: 5쪽 그림 동화책 넘기기 + StudyTTS 자동 낭독 지원
 * - voice_repeat: 서버 업로드 0% (브라우저 로컬 메모리 MediaRecorder 즉시 다시 듣기)
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 44px+ 터치
 * ==============================================================================
 */

(function () {
    'use strict';

    function renderStorybookBlock(container, blk, speakFn) {
        const pages = Array.isArray(blk.pages) && blk.pages.length ? blk.pages : [{ pageNo: 1, sceneEmoji: '📖', text: '재미있는 이야기예요!' }];
        let pageIdx = 0;

        const stage = document.createElement('div');
        stage.className = 'storybook-stage';

        const topRow = document.createElement('div');
        topRow.className = 'storybook-top-row';
        const badgeWrap = document.createElement('div');
        badgeWrap.className = 'storybook-badge-wrap';
        const badge = Object.assign(document.createElement('span'), { className: 'storybook-badge', textContent: blk.badge || '📖 그림 동화책' });
        badgeWrap.appendChild(badge);
        if (blk.sourceBadge) {
            badgeWrap.appendChild(Object.assign(document.createElement('span'), { className: 'storybook-source-badge', textContent: blk.sourceBadge }));
        }
        const pageCounter = Object.assign(document.createElement('span'), { className: 'storybook-counter' });
        topRow.append(badgeWrap, pageCounter);

        const card = document.createElement('div');
        card.className = 'storybook-page-card';
        const artBox = document.createElement('div');
        artBox.className = 'storybook-art-box';
        const bannerSlot = document.createElement('div');
        bannerSlot.className = 'storybook-banner-slot';
        if (window.StudyIllustrations) {
            bannerSlot.innerHTML = window.StudyIllustrations.getThemeBannerSvg(blk.theme || '', blk.badge || '');
        }
        const photoEl = document.createElement('img');
        photoEl.className = 'storybook-real-photo';
        photoEl.hidden = true;
        photoEl.loading = 'lazy';
        photoEl.onerror = () => { photoEl.hidden = true; };
        const emojiEl = Object.assign(document.createElement('div'), { className: 'storybook-scene-emoji' });
        artBox.append(bannerSlot, photoEl, emojiEl);

        const textEl = Object.assign(document.createElement('p'), { className: 'storybook-page-text' });
        card.append(artBox, textEl);

        const dots = document.createElement('div');
        dots.className = 'storybook-dots';

        const controls = document.createElement('div');
        controls.className = 'storybook-controls no-print';
        const prevBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-outline', textContent: '◀ 이전 쪽' });
        const readBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-secondary', textContent: '🔊 이 쪽 읽어주기' });
        const nextBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-primary', textContent: '다음 쪽 ▶' });
        controls.append(prevBtn, readBtn, nextBtn);

        const drawPage = () => {
            const pg = pages[pageIdx] || pages[0];
            pageCounter.textContent = `${pageIdx + 1} / ${pages.length} 쪽`;
            if (pg.imageUrl) {
                photoEl.src = pg.imageUrl;
                photoEl.alt = pg.title || blk.theme || '자연·역사 관찰 사진';
                photoEl.hidden = false;
                emojiEl.classList.add('is-corner');
            } else {
                photoEl.hidden = true;
                emojiEl.classList.remove('is-corner');
            }
            emojiEl.textContent = pg.sceneEmoji || '✨';
            textEl.textContent = pg.text || '';
            prevBtn.disabled = pageIdx === 0;
            nextBtn.textContent = pageIdx >= pages.length - 1 ? '✅ 마지막 쪽이에요!' : '다음 쪽 ▶';
            nextBtn.disabled = pageIdx >= pages.length - 1;
            dots.innerHTML = pages.map((_, i) => `<button type="button" class="storybook-dot ${i === pageIdx ? 'active' : ''}" data-pg="${i}" aria-label="${i + 1}쪽으로 이동"></button>`).join('');
            dots.querySelectorAll('.storybook-dot').forEach((d) => {
                d.addEventListener('click', () => { pageIdx = Number(d.dataset.pg); drawPage(); });
            });
        };

        prevBtn.addEventListener('click', () => {
            if (pageIdx <= 0) return;
            pageIdx -= 1;
            window.StudyFx?.tap?.();
            drawPage();
        });
        nextBtn.addEventListener('click', () => {
            if (pageIdx >= pages.length - 1) return;
            pageIdx += 1;
            window.StudyFx?.tap?.();
            drawPage();
            const pg = pages[pageIdx];
            if (pg && typeof speakFn === 'function') speakFn(pg.ttsText || pg.text, 'ko-KR', nextBtn);
        });
        readBtn.addEventListener('click', () => {
            const pg = pages[pageIdx];
            if (pg && typeof speakFn === 'function') speakFn(pg.ttsText || pg.text, 'ko-KR', readBtn);
        });

        drawPage();
        stage.append(topRow, card, dots, controls);
        container.appendChild(stage);
    }

    function renderVoiceRepeatBlock(container, blk, speakFn, toastFn) {
        const targetText = String(blk.targetSentence || blk.ttsText || '안녕 반가워!').trim();
        const wrap = document.createElement('div');
        wrap.className = 'voice-repeat-card';

        const promptRow = document.createElement('div');
        promptRow.className = 'voice-target-box';
        const emojiEl = Object.assign(document.createElement('span'), { className: 'voice-target-emoji', textContent: blk.emoji || '🎤' });
        const wordEl = Object.assign(document.createElement('strong'), { className: 'voice-target-text', textContent: targetText });
        const listenBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-secondary', textContent: '🔊 먼저 들어보기' });
        listenBtn.addEventListener('click', () => speakFn?.(targetText, blk.ttsLang || 'ko-KR', listenBtn));
        promptRow.append(emojiEl, wordEl, listenBtn);

        const meter = document.createElement('div');
        meter.className = 'voice-meter-bars no-print';
        meter.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';

        const statusLine = Object.assign(document.createElement('p'), {
            className: 'voice-status-line',
            textContent: '💡 녹음된 목소리는 서버에 저장되지 않고, 내 패드에서만 바로 들려요!'
        });

        const btnRow = document.createElement('div');
        btnRow.className = 'voice-btn-row no-print';
        const recBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-primary', textContent: '🎤 내 목소리 녹음하기' });
        const playBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-outline', textContent: '🎧 내 목소리 다시 듣기', hidden: true });
        const cheerBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-outline', textContent: '👏 큰 소리로 따라 읽었어요!' });
        btnRow.append(recBtn, playBtn, cheerBtn);

        let recordedUrl = '';
        let mediaRecorder = null;
        let stopTimer = null;
        let streamRef = null;
        let isRecording = false;

        const stopMedia = () => {
            clearTimeout(stopTimer);
            isRecording = false;
            meter.classList.remove('is-recording');
            recBtn.textContent = '🎤 다시 녹음하기';
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                try { mediaRecorder.stop(); } catch (_) {}
            }
            if (streamRef) {
                streamRef.getTracks().forEach((t) => t.stop());
                streamRef = null;
            }
        };

        recBtn.addEventListener('click', async () => {
            if (isRecording) {
                stopMedia();
                return;
            }
            if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
                statusLine.textContent = '이 기기에서는 마이크 녹음이 지원되지 않아요. 큰 소리로 읽고 👏 버튼을 눌러 주세요!';
                return;
            }
            try {
                streamRef = await navigator.mediaDevices.getUserMedia({ audio: true });
                const chunks = [];
                mediaRecorder = new MediaRecorder(streamRef);
                mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
                mediaRecorder.onstop = () => {
                    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
                    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                    recordedUrl = URL.createObjectURL(blob);
                    playBtn.hidden = false;
                    window.StudyFx?.correct?.();
                    statusLine.textContent = '🌟 녹음 완료! "내 목소리 다시 듣기"를 눌러 들어 보세요!';
                    if (streamRef) { streamRef.getTracks().forEach((t) => t.stop()); streamRef = null; }
                };
                isRecording = true;
                meter.classList.add('is-recording');
                recBtn.textContent = '⏹️ 멈추기 (최대 5초)';
                statusLine.textContent = '🔴 지금 말하고 있어요! 예쁜 목소리로 따라 읽어 보아요~';
                mediaRecorder.start();
                stopTimer = setTimeout(stopMedia, 5200);

                const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (Rec) {
                    try {
                        const sr = new Rec();
                        sr.lang = blk.ttsLang || 'ko-KR';
                        sr.onresult = (ev) => {
                            const said = ev.results?.[0]?.[0]?.transcript || '';
                            if (said) toastFn?.(`멋지게 말했어요: "${said}" 👏`);
                        };
                        sr.start();
                    } catch (_) {}
                }
            } catch (_) {
                statusLine.textContent = '마이크 권한이 없어도 괜찮아요! 큰 소리로 읽고 👏 버튼을 눌러 주세요.';
                stopMedia();
            }
        });

        playBtn.addEventListener('click', () => {
            if (!recordedUrl) return;
            const audio = new Audio(recordedUrl);
            audio.play().catch(() => {});
        });

        cheerBtn.addEventListener('click', () => {
            window.StudyFx?.fanfare?.();
            statusLine.textContent = '🎉 씩씩하고 또박또박하게 정말 잘 읽었어요! 최고예요!';
            toastFn?.('씩씩하게 말하기 성공! 🎤🌟');
        });

        wrap.append(promptRow, meter, statusLine, btnRow);
        container.appendChild(wrap);
    }

    window.StudyPlayStorybook = {
        renderStorybookBlock,
        renderVoiceRepeatBlock
    };
})();
