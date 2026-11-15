/**
 * ==============================================================================
 * 내가 칠한 그림 PNG 합성 & 가족앨범 자랑하기 모듈 (study-artwork.js)
 * ------------------------------------------------------------------------------
 * - baseSvg(채우기 색상) + drawCanvas(S펜 붓칠) + outlineSvg(검은 선화) -> PNG 합성
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | ObjectURL 누수 방지
 * ==============================================================================
 */

(function () {
    'use strict';

    function loadSvgAsImage(svgEl, width, height) {
        return new Promise((resolve, reject) => {
            if (!svgEl) return resolve(null);
            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(width));
            clone.setAttribute('height', String(height));
            const xml = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = (err) => {
                URL.revokeObjectURL(url);
                reject(err);
            };
            img.src = url;
        });
    }

    async function exportColoringPng({ baseSvg, drawCanvas, outlineSvg, title = '내 색칠 그림', childName = '' }) {
        const outW = 1200;
        const outH = 900;
        const offscreen = document.createElement('canvas');
        offscreen.width = outW;
        offscreen.height = outH;
        const ctx = offscreen.getContext('2d');
        if (!ctx) throw new Error('그림 합성 캔버스를 열 수 없습니다.');

        // 1. 도화지 흰 배경
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);

        // 2. 밑그림 SVG 채우기 레이어
        const baseImg = await loadSvgAsImage(baseSvg, outW, outH);
        if (baseImg) ctx.drawImage(baseImg, 0, 0, outW, outH);

        // 3. 아이 S펜/손가락 자유 색칠 레이어
        if (drawCanvas && drawCanvas.width > 0 && drawCanvas.height > 0) {
            ctx.drawImage(drawCanvas, 0, 0, outW, outH);
        }

        // 4. 최상단 검은 윤곽선 레이어
        const outlineImg = await loadSvgAsImage(outlineSvg, outW, outH);
        if (outlineImg) ctx.drawImage(outlineImg, 0, 0, outW, outH);

        // 5. 귀여운 하단 서명 배지
        ctx.save();
        ctx.fillStyle = 'rgba(255, 247, 237, 0.9)';
        ctx.strokeStyle = '#fdba74';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(24, outH - 64, 420, 44, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#9a3412';
        ctx.font = 'bold 21px sans-serif';
        const label = childName ? `🎨 ${childName} · ${title}` : `🎨 ${title}`;
        ctx.fillText(label.slice(0, 28), 40, outH - 35);
        ctx.restore();

        return offscreen.toDataURL('image/png');
    }

    function isAlbumShareAllowed() {
        if (window.StudyTabletConfig && typeof window.StudyTabletConfig.kidAlbumShareEnabled === 'boolean') {
            return window.StudyTabletConfig.kidAlbumShareEnabled;
        }
        return true;
    }

    function createShareControl({ actionsBar, getContext, toastFn, speakFn }) {
        if (!actionsBar) return null;

        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'study-btn study-btn-primary color-share-btn';

        const updateLabel = () => {
            shareBtn.textContent = isAlbumShareAllowed()
                ? '🖼️ 가족앨범에 자랑하기'
                : '💾 내 그림 보관하기';
        };
        updateLabel();
        document.addEventListener('study-tablet-config', updateLabel);

        const downloadLinkBtn = document.createElement('button');
        downloadLinkBtn.type = 'button';
        downloadLinkBtn.className = 'study-btn study-btn-outline color-download-btn';
        downloadLinkBtn.textContent = '⬇️ 그림 저장';

        actionsBar.append(shareBtn, downloadLinkBtn);

        let lastExportUrl = '';

        downloadLinkBtn.addEventListener('click', async () => {
            downloadLinkBtn.disabled = true;
            try {
                const payload = getContext();
                const dataUrl = await exportColoringPng(payload);
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = `${(payload.title || 'coloring').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                if (window.StudyFx) window.StudyFx.tap();
                if (toastFn) toastFn('내 기기에 그림을 예쁘게 저장했어요! ⬇️');
            } catch (err) {
                if (toastFn) toastFn('그림 파일을 만드는 중 문제가 생겼어요.');
            } finally {
                downloadLinkBtn.disabled = false;
            }
        });

        shareBtn.addEventListener('click', async () => {
            const payload = getContext();
            if (!payload.hasAnyPaint) {
                if (window.StudyFx) window.StudyFx.retry();
                if (toastFn) toastFn('먼저 예쁜 색으로 조금 칠한 뒤에 자랑해 보아요! 🖍️');
                return;
            }

            shareBtn.disabled = true;
            const prevText = shareBtn.textContent;
            shareBtn.textContent = '⏳ 그림 보내는 중...';
            try {
                const dataUrl = await exportColoringPng(payload);
                const res = await fetch('/api/study/artworks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        childId: payload.childId || 'first',
                        title: payload.title || '내가 칠한 그림',
                        templateId: payload.templateId || '',
                        sheetId: payload.sheetId || 0,
                        imageDataUrl: dataUrl,
                        shareToAlbum: isAlbumShareAllowed()
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '그림을 저장하지 못했어요.');
                }

                lastExportUrl = data.artwork?.imageUrl || '';
                if (window.StudyFx) {
                    window.StudyFx.fanfare();
                    window.StudyFx.celebrate({ big: true });
                }
                if (speakFn) speakFn('우와! 정말 멋진 작품이에요! 가족들에게 자랑했어요!', 'ko-KR');
                if (toastFn) toastFn(data.message || '내 그림을 멋지게 자랑했어요!');
                if (typeof payload.onSaved === 'function') {
                    payload.onSaved(data.artwork, lastExportUrl);
                }
            } catch (err) {
                if (window.StudyFx) window.StudyFx.retry();
                if (toastFn) toastFn(err?.message || '작품 전송 중 문제가 생겼어요.');
            } finally {
                shareBtn.disabled = false;
                updateLabel();
                if (!shareBtn.textContent) shareBtn.textContent = prevText;
            }
        });

        return { shareBtn, downloadLinkBtn };
    }

    window.StudyArtwork = {
        exportColoringPng,
        createShareControl
    };
})();
