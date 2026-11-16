/**
 * ==============================================================================
 * 「빨간패드공부」 갤럭시 탭 전용 UX·화면 꺼짐 방지·S펜 팜 리젝션 (study-tablet.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 태블릿 터치·필기 안정성
 * ==============================================================================
 */
(function () {
    'use strict';

    const STORAGE_WAKELOCK = 'jg_study_wakelock';
    const STORAGE_PEN_ONLY = 'jg_study_pen_only';

    let wakeSentinel = null;
    let wakeEnabled = true;
    let penOnlyMode = false;
    let lastPenAt = 0;
    const resizeCallbacks = new Set();

    function readFlag(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            if (v === 'on') return true;
            if (v === 'off') return false;
        } catch (_) { /* ignore storage restrictions */ }
        return fallback;
    }

    function writeFlag(key, value) {
        try {
            localStorage.setItem(key, value ? 'on' : 'off');
        } catch (_) { /* ignore storage restrictions */ }
    }

    function hasStoredFlag(key) {
        try {
            const v = localStorage.getItem(key);
            return v === 'on' || v === 'off';
        } catch (_) {
            return false;
        }
    }

    function supportsWakeLock() {
        return typeof navigator !== 'undefined' && Boolean(navigator.wakeLock && navigator.wakeLock.request);
    }

    function syncWakeButton() {
        const btn = document.getElementById('btnWakeLockToggle');
        if (!btn) return;
        if (!supportsWakeLock()) {
            btn.hidden = true;
            return;
        }
        btn.hidden = false;
        const active = Boolean(wakeSentinel);
        btn.classList.toggle('is-active', wakeEnabled);
        btn.setAttribute('aria-pressed', wakeEnabled ? 'true' : 'false');
        if (!wakeEnabled) {
            btn.textContent = '🌙 화면 자동 꺼짐';
            btn.title = '태블릿 기본 화면 꺼짐 설정을 따르고 있어요. 누르면 공부 중 화면을 계속 켜 둡니다.';
        } else if (active) {
            btn.textContent = '💡 화면 유지 중';
            btn.title = '공부하는 동안 화면이 자동으로 꺼지지 않도록 켜 두었어요.';
        } else {
            btn.textContent = '💡 화면 유지 대기';
            btn.title = '화면을 한 번 터치하면 화면 꺼짐 방지가 바로 시작돼요.';
        }
    }

    async function requestWakeLock() {
        if (!wakeEnabled || !supportsWakeLock()) {
            syncWakeButton();
            return false;
        }
        if (document.visibilityState !== 'visible') {
            syncWakeButton();
            return false;
        }
        if (wakeSentinel) {
            syncWakeButton();
            return true;
        }
        try {
            const sentinel = await navigator.wakeLock.request('screen');
            wakeSentinel = sentinel;
            sentinel.addEventListener('release', () => {
                if (wakeSentinel === sentinel) wakeSentinel = null;
                syncWakeButton();
            });
            syncWakeButton();
            return true;
        } catch (_) {
            wakeSentinel = null;
            syncWakeButton();
            return false;
        }
    }

    async function releaseWakeLock() {
        if (!wakeSentinel) {
            syncWakeButton();
            return;
        }
        const s = wakeSentinel;
        wakeSentinel = null;
        try { await s.release(); } catch (_) { /* ignore */ }
        syncWakeButton();
    }

    async function setWakeLockEnabled(enabled, persist = true) {
        wakeEnabled = Boolean(enabled);
        if (persist) writeFlag(STORAGE_WAKELOCK, wakeEnabled);
        if (wakeEnabled) await requestWakeLock();
        else await releaseWakeLock();
    }

    function syncPenOnlyButton() {
        const btn = document.getElementById('btnPenOnlyToggle');
        if (!btn) return;
        const isTouchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        btn.hidden = !isTouchDevice && lastPenAt === 0 && !penOnlyMode;
        btn.classList.toggle('is-active', penOnlyMode);
        btn.setAttribute('aria-pressed', penOnlyMode ? 'true' : 'false');
        btn.textContent = penOnlyMode ? '🖊️ 펜만 쓰기' : '🖐️ 손·펜 모두';
        btn.title = penOnlyMode
            ? 'S펜(스타일러스)으로만 그려져 손바닥이 닿아도 묻지 않아요.'
            : '손가락과 S펜 모두 사용할 수 있어요. S펜을 대면 손바닥을 자동으로 피해요.';
    }

    function setPenOnlyMode(enabled, persist = true) {
        penOnlyMode = Boolean(enabled);
        if (persist) writeFlag(STORAGE_PEN_ONLY, penOnlyMode);
        syncPenOnlyButton();
    }

    function trackPenActivity(e) {
        if (e && e.pointerType === 'pen') {
            const firstPen = lastPenAt === 0;
            lastPenAt = Date.now();
            if (firstPen) syncPenOnlyButton();
        }
    }

    function shouldAcceptCanvasPointer(e) {
        if (!e) return false;
        if (e.isPrimary === false) return false;
        if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return false;

        if (e.pointerType === 'pen') {
            trackPenActivity(e);
            return true;
        }

        if (e.pointerType === 'touch') {
            if (penOnlyMode) return false;
            // S펜 필기 직후 1.5초 이내의 손바닥 접촉 무시
            if (lastPenAt && (Date.now() - lastPenAt) < 1500) return false;
            // 손바닥 면적처럼 비정상적으로 넓은 접촉(>= 48px) 무시
            const maxSpan = Math.max(Number(e.width) || 0, Number(e.height) || 0);
            if (maxSpan >= 48) return false;
        }
        return true;
    }

    function bindDrawingCanvas(canvas, opts) {
        if (!canvas || !opts) return;
        let activePointerId = null;

        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        canvas.addEventListener('pointerdown', (e) => {
            if (opts.canStart && !opts.canStart(e)) return;
            if (!shouldAcceptCanvasPointer(e)) return;
            if (activePointerId !== null) return;

            activePointerId = e.pointerId;
            try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            const pos = opts.getPos ? opts.getPos(e) : { x: e.offsetX, y: e.offsetY };
            if (opts.onStart) opts.onStart(pos, e);
        });

        canvas.addEventListener('pointermove', (e) => {
            trackPenActivity(e);
            if (activePointerId === null || e.pointerId !== activePointerId) return;
            const pos = opts.getPos ? opts.getPos(e) : { x: e.offsetX, y: e.offsetY };
            if (opts.onMove) opts.onMove(pos, e);
        });

        const finishStroke = (e) => {
            if (activePointerId === null || (e && e.pointerId !== activePointerId)) return;
            const pid = activePointerId;
            activePointerId = null;
            try {
                if (canvas.hasPointerCapture && canvas.hasPointerCapture(pid)) {
                    canvas.releasePointerCapture(pid);
                }
            } catch (_) { /* ignore */ }
            if (opts.onEnd) opts.onEnd(e);
        };

        canvas.addEventListener('pointerup', finishStroke);
        canvas.addEventListener('pointercancel', finishStroke);
        canvas.addEventListener('lostpointercapture', finishStroke);

        if (typeof opts.onResize === 'function') {
            resizeCallbacks.add(opts.onResize);
        }
    }

    async function syncServerTabletConfig() {
        try {
            const res = await fetch('/api/study/tablet-config', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.success || !data.config) return;
            window.StudyTabletConfig = data.config;
            document.dispatchEvent(new CustomEvent('study-tablet-config', { detail: data.config }));
            if (!hasStoredFlag(STORAGE_WAKELOCK) && typeof data.config.wakeLockDefault === 'boolean') {
                await setWakeLockEnabled(data.config.wakeLockDefault, false);
            }
            if (!hasStoredFlag(STORAGE_PEN_ONLY) && typeof data.config.penOnlyDefault === 'boolean') {
                setPenOnlyMode(data.config.penOnlyDefault, false);
            }
        } catch (_) { /* 오프라인/초기 로드 시 기본값 유지 */ }
    }

    function init() {
        wakeEnabled = readFlag(STORAGE_WAKELOCK, true);
        penOnlyMode = readFlag(STORAGE_PEN_ONLY, false);

        document.addEventListener('pointerdown', trackPenActivity, { passive: true, capture: true });
        document.addEventListener('pointermove', trackPenActivity, { passive: true, capture: true });

        // 초기 로드가 제스처 전이라 실패한 경우 첫 터치·클릭 시 화면 유지 재요청
        const retryOnGesture = () => {
            if (wakeEnabled && !wakeSentinel) requestWakeLock();
        };
        document.addEventListener('pointerdown', retryOnGesture, { passive: true });
        document.addEventListener('keydown', retryOnGesture, { passive: true });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && wakeEnabled) requestWakeLock();
        });
        window.addEventListener('focus', () => {
            if (wakeEnabled && !wakeSentinel) requestWakeLock();
        });

        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                resizeCallbacks.forEach((fn) => {
                    try { fn(); } catch (_) { /* ignore */ }
                });
            }, 160);
        });

        const wakeBtn = document.getElementById('btnWakeLockToggle');
        if (wakeBtn) {
            wakeBtn.addEventListener('click', () => {
                setWakeLockEnabled(!wakeEnabled, true);
            });
        }

        const penBtn = document.getElementById('btnPenOnlyToggle');
        if (penBtn) {
            penBtn.addEventListener('click', () => {
                setPenOnlyMode(!penOnlyMode, true);
            });
        }

        // 놀이 위젯 길게 누르기 메뉴 억제
        document.addEventListener('contextmenu', (e) => {
            if (e.target && e.target.closest && e.target.closest('.trace-wrap, .coloring-stage, .dot-stage, .maze-grid')) {
                e.preventDefault();
            }
        });

        syncWakeButton();
        syncPenOnlyButton();
        requestWakeLock();
        syncServerTabletConfig();
    }

    function drawFreehandStroke(ctx, rawPoints, hex, baseSize, useRealPressure) {
        if (!ctx || !rawPoints.length || !window.PerfectFreehand) return false;
        const pts = window.PerfectFreehand.getStroke(rawPoints, {
            size: baseSize,
            thinning: useRealPressure ? 0.65 : 0.35,
            smoothing: 0.55,
            streamline: 0.45,
            simulatePressure: !useRealPressure
        });
        if (!pts.length) return false;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = hex;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < pts.length - 1; i++) {
            const [x0, y0] = pts[i];
            const [x1, y1] = pts[i + 1];
            ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return true;
    }

    window.StudyTablet = {
        shouldAcceptCanvasPointer,
        bindDrawingCanvas,
        drawFreehandStroke,
        setWakeLockEnabled,
        setPenOnlyMode,
        getState: () => ({
            wakeEnabled,
            wakeActive: Boolean(wakeSentinel),
            penOnlyMode
        })
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
