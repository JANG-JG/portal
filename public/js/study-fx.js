/**
 * ==============================================================================
 * 어린이 학습실 효과음 팩 & 축하 폭죽 모듈 (study-fx.js)
 * ------------------------------------------------------------------------------
 * - Web Audio API 실시간 합성음 (외부 MP3 파일 0개, 오프라인 100% 동작)
 * - canvas-confetti 축하 폭죽 (prefers-reduced-motion 자동 존중)
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

(function () {
    'use strict';

    const STORAGE_SFX = 'jg_study_sfx_v1';
    let audioCtx = null;
    let enabled = true;

    function hasStoredPref() {
        try {
            return localStorage.getItem(STORAGE_SFX) !== null;
        } catch (_) {
            return false;
        }
    }

    function readPref() {
        try {
            const raw = localStorage.getItem(STORAGE_SFX);
            if (raw === '0' || raw === 'false') return false;
            if (raw === '1' || raw === 'true') return true;
        } catch (_) { /* ignore */ }
        if (window.StudyTabletConfig && typeof window.StudyTabletConfig.soundFxDefault === 'boolean') {
            return window.StudyTabletConfig.soundFxDefault;
        }
        return true;
    }

    function savePref(on) {
        try {
            localStorage.setItem(STORAGE_SFX, on ? '1' : '0');
        } catch (_) { /* ignore */ }
    }

    function syncButton() {
        const btn = document.getElementById('btnSoundFxToggle');
        if (!btn) return;
        btn.classList.toggle('is-active', enabled);
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        btn.textContent = enabled ? '🔔 효과음' : '🔇 조용히';
    }

    function ensureAudioContext() {
        if (!enabled) return null;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!audioCtx) {
            try {
                audioCtx = new Ctx();
            } catch (_) {
                return null;
            }
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    function playTone(freq, { delay = 0, duration = 0.12, type = 'sine', gain = 0.14, endFreq = null } = {}) {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        try {
            const start = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const amp = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, start);
            if (endFreq && endFreq !== freq) {
                osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), start + duration);
            }
            amp.gain.setValueAtTime(0.0001, start);
            amp.gain.exponentialRampToValueAtTime(gain, start + 0.014);
            amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            osc.connect(amp);
            amp.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + duration + 0.02);
        } catch (_) { /* ignore audio policy errors */ }
    }

    const sfx = {
        tap() {
            playTone(540, { duration: 0.065, type: 'triangle', gain: 0.11, endFreq: 660 });
        },
        crayon() {
            playTone(460, { duration: 0.075, type: 'sine', gain: 0.12, endFreq: 690 });
        },
        correct() {
            playTone(523.25, { delay: 0, duration: 0.11, type: 'triangle', gain: 0.15 });
            playTone(659.25, { delay: 0.08, duration: 0.12, type: 'triangle', gain: 0.15 });
            playTone(783.99, { delay: 0.16, duration: 0.22, type: 'sine', gain: 0.17 });
        },
        retry() {
            playTone(310, { delay: 0, duration: 0.12, type: 'sine', gain: 0.12, endFreq: 210 });
            playTone(230, { delay: 0.1, duration: 0.14, type: 'sine', gain: 0.1, endFreq: 180 });
        },
        stamp() {
            playTone(150, { delay: 0, duration: 0.09, type: 'sine', gain: 0.2, endFreq: 75 });
            playTone(659.25, { delay: 0.07, duration: 0.12, type: 'triangle', gain: 0.14 });
            playTone(987.77, { delay: 0.14, duration: 0.22, type: 'sine', gain: 0.15 });
        },
        fanfare() {
            const notes = [523.25, 659.25, 783.99, 1046.5];
            notes.forEach((f, idx) => {
                playTone(f, {
                    delay: idx * 0.09,
                    duration: idx === notes.length - 1 ? 0.34 : 0.14,
                    type: 'triangle',
                    gain: 0.16
                });
            });
        }
    };

    function prefersReducedMotion() {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function celebrate({ big = false } = {}) {
        if (prefersReducedMotion()) return;
        if (typeof window.confetti !== 'function') return;
        const colors = ['#ff7a45', '#facc15', '#22c55e', '#3b82f6', '#ec4899'];
        try {
            if (!big) {
                window.confetti({
                    particleCount: 48,
                    spread: 68,
                    origin: { y: 0.65 },
                    colors
                });
                return;
            }
            window.confetti({ particleCount: 75, spread: 80, origin: { x: 0.25, y: 0.6 }, colors });
            setTimeout(() => {
                window.confetti({ particleCount: 75, spread: 80, origin: { x: 0.75, y: 0.6 }, colors });
            }, 180);
        } catch (_) { /* ignore canvas errors */ }
    }

    function setEnabled(nextOn, persist = true) {
        enabled = Boolean(nextOn);
        if (persist) savePref(enabled);
        syncButton();
        if (enabled) sfx.tap();
    }

    function init() {
        enabled = readPref();
        syncButton();

        const btn = document.getElementById('btnSoundFxToggle');
        if (btn) {
            btn.addEventListener('click', () => setEnabled(!enabled, true));
        }

        document.addEventListener('study-tablet-config', (e) => {
            const cfg = e && e.detail;
            if (cfg && !hasStoredPref() && typeof cfg.soundFxDefault === 'boolean') {
                enabled = cfg.soundFxDefault;
                syncButton();
            }
        });
    }

    window.StudyFx = {
        ...sfx,
        celebrate,
        setEnabled,
        isEnabled: () => enabled
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
