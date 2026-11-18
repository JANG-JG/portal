/**
 * ==============================================================================
 * 무지개 8음계 미니 피아노 & 동요 연주 블록 렌더러 (study-play-piano.js)
 * ------------------------------------------------------------------------------
 * - 외부 음원 없이 Web Audio API(삼각파+사인파 ADSR)로 즉시 반응하는 8건반
 * - 따라 치기 곡 가이드(작은 별 · 나비야 · 학교종) + 자유 연주
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 44px+ 터치
 * ==============================================================================
 */

(function () {
    'use strict';

    const KEYS = [
        { note: '도', freq: 261.63, color: '#ef4444' },
        { note: '레', freq: 293.66, color: '#f97316' },
        { note: '미', freq: 329.63, color: '#eab308' },
        { note: '파', freq: 349.23, color: '#22c55e' },
        { note: '솔', freq: 392.00, color: '#06b6d4' },
        { note: '라', freq: 440.00, color: '#3b82f6' },
        { note: '시', freq: 493.88, color: '#8b5cf6' },
        { note: '높은도', freq: 523.25, color: '#ec4899' }
    ];

    let sharedCtx = null;

    function playPianoTone(freq) {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!sharedCtx) sharedCtx = new Ctx();
            if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});

            const now = sharedCtx.currentTime;
            const osc1 = sharedCtx.createOscillator();
            const osc2 = sharedCtx.createOscillator();
            const gain = sharedCtx.createGain();
            osc1.type = 'triangle';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(freq, now);
            osc2.frequency.setValueAtTime(freq * 2, now);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.28, now + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

            const subGain = sharedCtx.createGain();
            subGain.gain.setValueAtTime(0.22, now);

            osc1.connect(gain);
            osc2.connect(subGain);
            subGain.connect(gain);
            gain.connect(sharedCtx.destination);
            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.6);
            osc2.stop(now + 0.6);
        } catch (_) {}
    }

    function renderPianoBlock(container, blk, _speakFn, toastFn) {
        const songs = Array.isArray(blk.songs) && blk.songs.length ? blk.songs : [
            { id: 'twinkle', title: '⭐ 작은 별', notes: ['도', '도', '솔', '솔', '라', '라', '솔'] }
        ];
        let activeSong = songs[0];
        let freePlay = false;
        let noteCursor = 0;

        const wrap = document.createElement('div');
        wrap.className = 'piano-stage';

        const songBar = document.createElement('div');
        songBar.className = 'piano-song-bar no-print';

        const guideLine = document.createElement('div');
        guideLine.className = 'piano-guide-pill';

        const sheetStrip = document.createElement('div');
        sheetStrip.className = 'piano-sheet-notes';

        const keysRow = document.createElement('div');
        keysRow.className = 'piano-keys-row';

        const syncGuide = () => {
            if (freePlay) {
                guideLine.textContent = '🎵 자유롭게 마음대로 건반을 눌러 연주해 보세요!';
                sheetStrip.innerHTML = '';
            } else {
                const notes = activeSong.notes || [];
                const nextNote = notes[noteCursor];
                guideLine.textContent = nextNote
                    ? `다음에 누를 반짝 건반: 👉 "${nextNote}" (${noteCursor + 1}/${notes.length})`
                    : `🎉 "${activeSong.title}" 끝까지 완벽 연주!`;
                sheetStrip.innerHTML = notes.map((n, idx) => `
                    <span class="piano-score-chip ${idx < noteCursor ? 'is-played' : ''} ${idx === noteCursor ? 'is-current' : ''}">${n}</span>
                `).join('');
            }
            keysRow.querySelectorAll('.piano-key').forEach((btn) => {
                const isNext = !freePlay && activeSong.notes?.[noteCursor] === btn.dataset.note;
                btn.classList.toggle('is-guide-next', isNext);
            });
        };

        const renderSongButtons = () => {
            songBar.innerHTML = '';
            songs.forEach((s) => {
                const btn = Object.assign(document.createElement('button'), {
                    type: 'button',
                    className: `piano-song-pill ${!freePlay && activeSong.id === s.id ? 'active' : ''}`,
                    textContent: s.title
                });
                btn.addEventListener('click', () => {
                    freePlay = false;
                    activeSong = s;
                    noteCursor = 0;
                    renderSongButtons();
                    syncGuide();
                });
                songBar.appendChild(btn);
            });
            const freeBtn = Object.assign(document.createElement('button'), {
                type: 'button',
                className: `piano-song-pill ${freePlay ? 'active' : ''}`,
                textContent: '✨ 자유 연주'
            });
            freeBtn.addEventListener('click', () => {
                freePlay = true;
                renderSongButtons();
                syncGuide();
            });
            songBar.appendChild(freeBtn);
        };

        KEYS.forEach((k) => {
            const keyBtn = document.createElement('button');
            keyBtn.type = 'button';
            keyBtn.className = 'piano-key';
            keyBtn.dataset.note = k.note;
            keyBtn.style.setProperty('--key-color', k.color);
            keyBtn.innerHTML = `<span class="piano-key-name">${k.note}</span>`;
            const pressKey = () => {
                playPianoTone(k.freq);
                keyBtn.classList.add('is-pressed');
                setTimeout(() => keyBtn.classList.remove('is-pressed'), 180);
                if (!freePlay && activeSong.notes?.[noteCursor] === k.note) {
                    noteCursor += 1;
                    if (noteCursor >= activeSong.notes.length) {
                        window.StudyFx?.fanfare?.();
                        window.StudyFx?.celebrate?.();
                        toastFn?.(`🎉 "${activeSong.title}" 연주 완성! 최고예요!`);
                        setTimeout(() => { noteCursor = 0; syncGuide(); }, 1800);
                    }
                    syncGuide();
                }
            };
            keyBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                pressKey();
            });
            keyBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressKey(); }
            });
            keysRow.appendChild(keyBtn);
        });

        renderSongButtons();
        syncGuide();
        wrap.append(songBar, guideLine, sheetStrip, keysRow);
        container.appendChild(wrap);
    }

    window.StudyPlayPiano = { renderPianoBlock };
})();
