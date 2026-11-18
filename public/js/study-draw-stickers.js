/**
 * ==============================================================================
 * 그림 스튜디오 스티커 도장 & 말풍선 꾸미기 모듈 (study-draw-stickers.js)
 * ------------------------------------------------------------------------------
 * - 꾸미기 이모지 12종, 수집한 내 포켓몬 미니 스티커, 짧은 말풍선 스탬프
 * - 캔버스 탭 시 선택 위치(대칭 시 좌우 동시)에 선명하게 도장 찍기 + Undo 지원
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    const EMOJI_STICKERS = [
        { id: 'star', char: '⭐', label: '별' },
        { id: 'heart', char: '❤️', label: '하트' },
        { id: 'crown', char: '👑', label: '왕관' },
        { id: 'rainbow', char: '🌈', label: '무지개' },
        { id: 'flower', char: '🌸', label: '꽃' },
        { id: 'butterfly', char: '🦋', label: '나비' },
        { id: 'ribbon', char: '🎀', label: '리본' },
        { id: 'music', char: '🎵', label: '음표' },
        { id: 'rocket', char: '🚀', label: '로켓' },
        { id: 'dino', char: '🦕', label: '공룡' },
        { id: 'sparkle', char: '✨', label: '반짝' },
        { id: 'smile', char: '😊', label: '웃음' }
    ];

    const SPEECH_PRESETS = ['최고!', '안녕!', '사랑해 ♥', '화이팅!'];
    const pokemonImageCache = new Map();
    let fetchedChildId = '';
    let cachedChildPokemon = [];

    async function loadCollectedPokemon(childId) {
        const cid = String(childId || 'first');
        if (fetchedChildId === cid && cachedChildPokemon.length > 0) return cachedChildPokemon;
        try {
            const res = await fetch(`/api/study/pokemon/state?childId=${encodeURIComponent(cid)}`, { credentials: 'include' });
            const json = await res.json();
            if (json && json.success && json.pokemon) {
                const list = Array.isArray(json.pokemon.collected) ? json.pokemon.collected : [];
                fetchedChildId = cid;
                cachedChildPokemon = list.slice(0, 12);
                return cachedChildPokemon;
            }
        } catch (_) {}
        return [];
    }

    function loadPokemonImg(url) {
        if (pokemonImageCache.has(url)) return Promise.resolve(pokemonImageCache.get(url));
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                pokemonImageCache.set(url, img);
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    function drawSpeechBubble(ctx, x, y, text, pxSize) {
        const label = String(text || '최고!').trim().slice(0, 10) || '최고!';
        ctx.save();
        ctx.font = `bold ${Math.round(pxSize * 0.42)}px Pretendard, sans-serif`;
        const metrics = ctx.measureText(label);
        const padX = 16;
        const w = Math.max(74, metrics.width + padX * 2);
        const h = Math.round(pxSize * 0.85);
        const bx = x - w / 2;
        const by = y - h / 2;

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(bx, by, w, h, 16);
        ctx.fill();
        ctx.stroke();

        // 말풍선 꼬리
        ctx.beginPath();
        ctx.moveTo(x - 6, by + h - 1);
        ctx.lineTo(x, by + h + 10);
        ctx.lineTo(x + 8, by + h - 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#9a3412';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 1);
        ctx.restore();
    }

    async function stampStickerOnCanvas({ ctx, x, y, sticker, sizeMode, logicalW, mirror }) {
        if (!ctx || !sticker) return;
        const pxSize = sizeMode === 'lg' ? 68 : 48;
        const coords = mirror && logicalW > 0
            ? [{ x, y }, { x: Math.max(0, logicalW - x), y }]
            : [{ x, y }];

        if (sticker.kind === 'pokemon' && sticker.url) {
            const img = await loadPokemonImg(sticker.url);
            if (!img) return;
            for (const pt of coords) {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(img, pt.x - pxSize / 2, pt.y - pxSize / 2, pxSize, pxSize);
                ctx.restore();
            }
            return;
        }

        if (sticker.kind === 'bubble') {
            for (const pt of coords) {
                drawSpeechBubble(ctx, pt.x, pt.y, sticker.text, pxSize);
            }
            return;
        }

        for (const pt of coords) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.font = `${pxSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(sticker.char || '⭐', pt.x, pt.y);
            ctx.restore();
        }
    }

    function createStickerTray({ childId, onPick }) {
        let activeCat = 'emoji';
        let sizeMode = 'md';
        let currentSticker = { kind: 'emoji', id: 'star', char: '⭐', label: '별' };
        let customBubbleText = SPEECH_PRESETS[0];

        const tray = document.createElement('div');
        tray.className = 'draw-sticker-tray no-print';
        tray.hidden = true;

        const head = document.createElement('div');
        head.className = 'sticker-tray-head';

        const catRow = document.createElement('div');
        catRow.className = 'sticker-cat-pills';
        const btnEmojiCat = Object.assign(document.createElement('button'), { type: 'button', className: 'draw-brush-pill active', textContent: '😊 꾸미기 스티커' });
        const btnPokeCat = Object.assign(document.createElement('button'), { type: 'button', className: 'draw-brush-pill', textContent: '⚡ 내 포켓몬 스티커' });
        const btnBubbleCat = Object.assign(document.createElement('button'), { type: 'button', className: 'draw-brush-pill', textContent: '💬 말풍선 도장' });
        catRow.append(btnEmojiCat, btnPokeCat, btnBubbleCat);

        const sizeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'draw-brush-pill', textContent: '크기: 보통' });
        sizeBtn.addEventListener('click', () => {
            sizeMode = sizeMode === 'md' ? 'lg' : 'md';
            sizeBtn.textContent = sizeMode === 'lg' ? '크기: 크게 🔍' : '크기: 보통';
        });
        head.append(catRow, sizeBtn);

        const body = document.createElement('div');
        tray.append(head, body);

        const emitPick = (st) => {
            currentSticker = st;
            if (typeof onPick === 'function') onPick(st);
        };

        const renderEmojiGrid = () => {
            body.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'sticker-items-grid';
            EMOJI_STICKERS.forEach((st) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `sticker-item-btn${currentSticker.kind === 'emoji' && currentSticker.id === st.id ? ' active' : ''}`;
                btn.title = st.label;
                btn.setAttribute('aria-label', `${st.label} 스티커`);
                btn.textContent = st.char;
                btn.addEventListener('click', () => {
                    emitPick({ kind: 'emoji', ...st });
                    renderEmojiGrid();
                });
                grid.appendChild(btn);
            });
            body.appendChild(grid);
        };

        const renderPokemonGrid = async () => {
            body.innerHTML = '<p style="margin:4px 0; font-size:0.86rem; color:#047857; font-weight:700;">내 포켓몬 스티커를 불러오는 중...</p>';
            const pokes = await loadCollectedPokemon(childId);
            body.innerHTML = '';
            if (!pokes.length) {
                body.innerHTML = '<p style="margin:4px 0; font-size:0.86rem; color:#475569; font-weight:700;">칭찬 도장판 알을 부화시키면 내 포켓몬 스티커가 생겨요! 🥚</p>';
                return;
            }
            const grid = document.createElement('div');
            grid.className = 'sticker-items-grid';
            pokes.forEach((p) => {
                const artUrl = p.artworkUrl || `/api/study/pokemon/sprite/${p.id}?kind=artwork`;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `sticker-item-btn${currentSticker.kind === 'pokemon' && currentSticker.id === p.id ? ' active' : ''}`;
                btn.title = p.nameKo;
                btn.setAttribute('aria-label', `${p.nameKo} 포켓몬 스티커`);
                btn.innerHTML = `<img src="${artUrl}" alt="${p.nameKo}">`;
                btn.addEventListener('click', () => {
                    emitPick({ kind: 'pokemon', id: p.id, nameKo: p.nameKo, url: artUrl });
                    renderPokemonGrid();
                });
                grid.appendChild(btn);
            });
            body.appendChild(grid);
        };

        const renderBubblePicker = () => {
            body.innerHTML = '';
            const row = document.createElement('div');
            row.className = 'sticker-bubble-row';
            const input = Object.assign(document.createElement('input'), {
                type: 'text',
                className: 'sticker-text-input',
                maxLength: 10,
                value: customBubbleText,
                placeholder: '짧은 말 입력(10자)'
            });
            input.addEventListener('input', () => {
                customBubbleText = input.value.trim() || '최고!';
                emitPick({ kind: 'bubble', text: customBubbleText });
            });
            SPEECH_PRESETS.forEach((txt) => {
                const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'draw-brush-pill', textContent: `💬 ${txt}` });
                btn.addEventListener('click', () => {
                    customBubbleText = txt;
                    input.value = txt;
                    emitPick({ kind: 'bubble', text: txt });
                });
                row.appendChild(btn);
            });
            row.appendChild(input);
            body.appendChild(row);
            emitPick({ kind: 'bubble', text: customBubbleText });
        };

        const switchCat = (cat) => {
            activeCat = cat;
            btnEmojiCat.classList.toggle('active', cat === 'emoji');
            btnPokeCat.classList.toggle('active', cat === 'pokemon');
            btnBubbleCat.classList.toggle('active', cat === 'bubble');
            if (cat === 'emoji') renderEmojiGrid();
            else if (cat === 'pokemon') renderPokemonGrid();
            else renderBubblePicker();
        };

        btnEmojiCat.addEventListener('click', () => switchCat('emoji'));
        btnPokeCat.addEventListener('click', () => switchCat('pokemon'));
        btnBubbleCat.addEventListener('click', () => switchCat('bubble'));
        renderEmojiGrid();

        return {
            el: tray,
            setVisible: (v) => { tray.hidden = !v; },
            getCurrentSticker: () => currentSticker,
            getSizeMode: () => sizeMode
        };
    }

    window.StudyDrawStickers = {
        EMOJI_STICKERS,
        stampStickerOnCanvas,
        createStickerTray
    };
})();
