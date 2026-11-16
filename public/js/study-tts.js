/**
 * ==============================================================================
 * 유아 학습실 이중 안전 음성 엔진 (study-tts.js)
 * ------------------------------------------------------------------------------
 * [원인 해결]
 * 1) Android/Chrome Web Speech의 cancel()+speak() 경합/GC/보이스 미지정 무음 버그 해결
 * 2) 기기 음성 엔진 미탑재/오류 시 즉시 서버 MP3/WAV 캐시(/api/study/tts)로 폴백
 * 3) 모바일 자동재생 차단 방지를 위해 서버 모드 전환 후 클릭 핸들러 내 동기 audio.play()
 * ==============================================================================
 */

(function () {
    'use strict';

    const MODE_STORAGE_KEY = 'jg_study_tts_mode_v2'; // 'server' | 'device'
    const MAX_PREFETCH_CACHE = 32;
    const prefetchedUrls = new Map();
    const inflightPrefetch = new Map();
    let prefetchWorkerActive = false;
    const prefetchPending = [];
    let sharedAudio = null;
    let activeUtterance = null;
    let cachedVoices = [];
    let voicesLoaded = false;
    let watchdogTimer = null;
    let speakDelayTimer = null;
    let currentTriggerBtn = null;
    let runtimeDeviceBroken = false;

    function normalizeClientTtsText(text) {
        return String(text || '')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160);
    }

    function getMode() {
        try {
            const saved = localStorage.getItem(MODE_STORAGE_KEY);
            if (saved === 'server' || saved === 'device') return saved;
        } catch (e) {}
        return 'server';
    }

    function setMode(nextMode) {
        const clean = nextMode === 'device' ? 'device' : 'server';
        try {
            localStorage.setItem(MODE_STORAGE_KEY, clean);
        } catch (e) {}
        if (clean === 'device') runtimeDeviceBroken = false;
        updateModeButtons();
        return clean;
    }

    function toggleMode() {
        const cur = getMode();
        const next = cur === 'server' ? 'device' : 'server';
        return setMode(next);
    }

    function updateModeButtons() {
        const mode = getMode();
        document.querySelectorAll('#btnTtsModeToggle, [data-tts-mode-btn]').forEach((btn) => {
            btn.textContent = mode === 'server' ? '🎙️ AI 자연 음성' : '📱 기기 음성';
            btn.setAttribute('aria-pressed', mode === 'server' ? 'true' : 'false');
        });
    }

    function loadVoices() {
        if (!('speechSynthesis' in window)) return [];
        try {
            const list = window.speechSynthesis.getVoices();
            if (Array.isArray(list) && list.length > 0) {
                cachedVoices = list;
                voicesLoaded = true;
            }
        } catch (e) {}
        return cachedVoices;
    }

    function findVoiceForLang(lang) {
        const list = loadVoices();
        if (!list.length) return null;
        const prefix = String(lang || 'ko-KR').toLowerCase().slice(0, 2);
        const matched = list.filter((v) => String(v.lang || '').toLowerCase().replace('_', '-').startsWith(prefix));
        if (!matched.length) return null;
        return matched.find((v) => /google|samsung|yuna|sora|natural|online/i.test(v.name || '')) || matched[0];
    }

    function ensureAudio() {
        if (!sharedAudio) {
            sharedAudio = new Audio();
            sharedAudio.preload = 'none';
            sharedAudio.setAttribute('playsinline', '');
        }
        return sharedAudio;
    }

    function clearVisualSpeaking() {
        if (currentTriggerBtn) {
            currentTriggerBtn.classList.remove('is-speaking');
            if (currentTriggerBtn.dataset.preserveLabel !== '1' && currentTriggerBtn.dataset.origLabel) {
                currentTriggerBtn.textContent = currentTriggerBtn.dataset.origLabel;
            }
            currentTriggerBtn = null;
        }
    }

    function setVisualSpeaking(btn) {
        clearVisualSpeaking();
        if (!btn) return;
        const preserve = btn.dataset.preserveLabel === '1';
        if (!preserve && !btn.dataset.origLabel) {
            btn.dataset.origLabel = btn.textContent;
        }
        currentTriggerBtn = btn;
        btn.classList.add('is-speaking');
        if (!preserve) btn.textContent = '🔈 읽는 중...';
    }

    function stop() {
        clearTimeout(watchdogTimer);
        clearTimeout(speakDelayTimer);
        if (sharedAudio) {
            try {
                sharedAudio.pause();
                sharedAudio.currentTime = 0;
            } catch (e) {}
        }
        if ('speechSynthesis' in window) {
            try {
                window.speechSynthesis.cancel();
            } catch (e) {}
        }
        activeUtterance = null;
        clearVisualSpeaking();
    }

    function showToastFallback(msg) {
        const toast = document.getElementById('studyToast');
        if (!toast) return;
        toast.textContent = msg;
        toast.hidden = false;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.hidden = true; }, 3200);
    }

    function rememberPrefetchedUrl(key, objectUrl) {
        if (prefetchedUrls.has(key)) {
            prefetchedUrls.delete(key);
        } else if (prefetchedUrls.size >= MAX_PREFETCH_CACHE) {
            const oldestKey = prefetchedUrls.keys().next().value;
            const oldestUrl = prefetchedUrls.get(oldestKey);
            prefetchedUrls.delete(oldestKey);
            if (oldestUrl) {
                try { URL.revokeObjectURL(oldestUrl); } catch (e) {}
            }
        }
        prefetchedUrls.set(key, objectUrl);
    }

    function prefetchSingle(cleanText, lang) {
        const key = `${lang}:${cleanText}`;
        if (!cleanText || prefetchedUrls.has(key)) return Promise.resolve();
        if (inflightPrefetch.has(key)) return inflightPrefetch.get(key);

        const url = `/api/study/tts?text=${encodeURIComponent(cleanText)}&lang=${encodeURIComponent(lang)}`;
        const job = fetch(url, { credentials: 'include' })
            .then((res) => (res.ok ? res.blob() : null))
            .then((blob) => {
                if (blob && blob.size > 150) {
                    rememberPrefetchedUrl(key, URL.createObjectURL(blob));
                }
            })
            .catch(() => {})
            .finally(() => { inflightPrefetch.delete(key); });

        inflightPrefetch.set(key, job);
        return job;
    }

    async function processPrefetchQueue() {
        if (prefetchWorkerActive) return;
        prefetchWorkerActive = true;
        try {
            while (prefetchPending.length > 0) {
                if (getMode() === 'device') {
                    prefetchPending.length = 0;
                    break;
                }
                const next = prefetchPending.shift();
                await prefetchSingle(next.text, next.lang);
            }
        } finally {
            prefetchWorkerActive = false;
        }
    }

    function prefetch(items) {
        if (getMode() === 'device' || !Array.isArray(items) || !items.length) return;
        const seen = new Set();
        items.forEach((entry) => {
            const rawText = typeof entry === 'string' ? entry : entry?.text;
            const lang = (typeof entry === 'object' && entry?.lang) ? String(entry.lang).trim() : 'ko-KR';
            const cleanText = normalizeClientTtsText(rawText);
            if (!cleanText) return;
            const key = `${lang}:${cleanText}`;
            if (seen.has(key) || prefetchedUrls.has(key) || inflightPrefetch.has(key)) return;
            seen.add(key);
            if (prefetchPending.length < MAX_PREFETCH_CACHE) {
                prefetchPending.push({ text: cleanText, lang });
            }
        });
        if (prefetchPending.length > 0) {
            setTimeout(() => { processPrefetchQueue(); }, 80);
        }
    }

    function speakDeviceFallbackOnce(cleanText, lang, triggerBtn) {
        if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
            clearVisualSpeaking();
            showToastFallback('음성을 재생할 수 없어요. 기기 음량을 확인해 주세요 🔇');
            return;
        }
        try {
            const synth = window.speechSynthesis;
            const u = new SpeechSynthesisUtterance(cleanText);
            activeUtterance = u;
            u.lang = lang;
            const v = findVoiceForLang(lang);
            if (v) u.voice = v;
            u.rate = 0.92;
            u.onend = () => { activeUtterance = null; clearVisualSpeaking(); };
            u.onerror = () => { activeUtterance = null; clearVisualSpeaking(); };
            if (synth.paused) synth.resume();
            synth.speak(u);
        } catch (e) {
            clearVisualSpeaking();
        }
    }

    function playServerAudio(cleanText, lang, triggerBtn, allowDeviceFallback = true) {
        const audio = ensureAudio();
        const remoteUrl = `/api/study/tts?text=${encodeURIComponent(cleanText)}&lang=${encodeURIComponent(lang)}`;
        const key = `${lang}:${cleanText}`;
        const cachedBlobUrl = prefetchedUrls.get(key);
        let retriedRemote = false;

        const handleFailure = () => {
            if (allowDeviceFallback) {
                speakDeviceFallbackOnce(cleanText, lang, triggerBtn);
                return;
            }
            clearVisualSpeaking();
            showToastFallback('음성을 재생할 수 없어요. 기기 음량을 확인해 주세요 🔇');
        };

        try {
            audio.pause();
            audio.onended = () => clearVisualSpeaking();
            audio.onerror = () => {
                if (!retriedRemote && cachedBlobUrl && audio.src === cachedBlobUrl) {
                    retriedRemote = true;
                    prefetchedUrls.delete(key);
                    try { URL.revokeObjectURL(cachedBlobUrl); } catch (e) {}
                    audio.src = remoteUrl;
                    audio.play().catch(handleFailure);
                    return;
                }
                handleFailure();
            };
            audio.src = cachedBlobUrl || remoteUrl;
            setVisualSpeaking(triggerBtn);
            const p = audio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    if (allowDeviceFallback) {
                        speakDeviceFallbackOnce(cleanText, lang, triggerBtn);
                    } else {
                        clearVisualSpeaking();
                        showToastFallback('🔊 버튼을 한 번 더 누르면 음성이 나와요!');
                    }
                });
            }
        } catch (e) {
            handleFailure();
        }
    }

    function speak(text, lang = 'ko-KR', triggerBtn = null) {
        const cleanText = normalizeClientTtsText(text);
        if (!cleanText) return;

        clearTimeout(watchdogTimer);
        clearTimeout(speakDelayTimer);
        if (sharedAudio) {
            try { sharedAudio.pause(); } catch (e) {}
        }

        const mode = getMode();
        const hasWebSpeech = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
        const matchedVoice = hasWebSpeech ? findVoiceForLang(lang) : null;

        // 1) 기본 'server' 모드 (자연 AI 음성) 또는 기기 음성 미지원 시 -> 클릭 즉시 서버 신경망 음성 재생
        const shouldUseServerDirect = mode === 'server'
            || !hasWebSpeech
            || runtimeDeviceBroken
            || (voicesLoaded && !matchedVoice);

        if (shouldUseServerDirect) {
            playServerAudio(cleanText, lang, triggerBtn, mode === 'server' && hasWebSpeech && !runtimeDeviceBroken);
            return;
        }

        // 2) Web Speech API (안드로이드/크로미움 경합·GC 방어 패턴)
        try {
            const synth = window.speechSynthesis;
            const runUtterance = () => {
                const u = new SpeechSynthesisUtterance(cleanText);
                activeUtterance = u; // GC 방지
                u.lang = lang;
                if (matchedVoice) u.voice = matchedVoice;
                u.rate = 0.88;
                u.pitch = 1.06;

                let started = false;
                let settled = false;
                setVisualSpeaking(triggerBtn);

                u.onstart = () => {
                    started = true;
                    clearTimeout(watchdogTimer);
                };
                u.onend = () => {
                    settled = true;
                    clearTimeout(watchdogTimer);
                    activeUtterance = null;
                    clearVisualSpeaking();
                };
                u.onerror = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(watchdogTimer);
                    activeUtterance = null;
                    runtimeDeviceBroken = true;
                    if (mode !== 'device') {
                        playServerAudio(cleanText, lang, triggerBtn);
                    } else {
                        clearVisualSpeaking();
                        showToastFallback('기기 음성 엔진에서 오류가 발생했어요.');
                    }
                };

                if (synth.paused) synth.resume();
                synth.speak(u);

                // Android WebView/데스크톱 무음 행(Hang) 감시 -> 750ms 내 시작 안 하면 서버 음성 즉시 폴백
                watchdogTimer = setTimeout(() => {
                    if (!started && !settled && !synth.speaking) {
                        settled = true;
                        try { synth.cancel(); } catch (e) {}
                        runtimeDeviceBroken = true;
                        if (mode !== 'device') {
                            playServerAudio(cleanText, lang, triggerBtn);
                        } else {
                            clearVisualSpeaking();
                        }
                    }
                }, 750);
            };

            // 이미 말하고 있을 때만 cancel 후 45ms 대기 (대기 중일 땐 동기 speak로 user-gesture 유지)
            if (synth.speaking || synth.pending) {
                synth.cancel();
                speakDelayTimer = setTimeout(runUtterance, 45);
            } else {
                runUtterance();
            }
        } catch (e) {
            runtimeDeviceBroken = true;
            playServerAudio(cleanText, lang, triggerBtn, false);
        }
    }

    if ('speechSynthesis' in window) {
        loadVoices();
        if (typeof window.speechSynthesis.addEventListener === 'function') {
            window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
        } else {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateModeButtons();
        document.querySelectorAll('#btnTtsModeToggle, [data-tts-mode-btn]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = toggleMode();
                showToastFallback(next === 'server'
                    ? '🎙️ 자연스러운 AI 선생님 음성으로 바꿨어요!'
                    : '📱 기기 기본 음성으로 바꿨어요!');
            });
        });
    });

    window.StudyTTS = {
        speak,
        stop,
        prefetch,
        getMode,
        setMode,
        toggleMode
    };
})();
