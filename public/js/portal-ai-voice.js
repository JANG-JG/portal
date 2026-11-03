/**
 * 🎙️ JG 포털 AI 비서 음성 입력 전담 엔진 (portal-ai-voice.js)
 * - 브라우저 표준 Web Speech API(ko-KR) 기반 실시간 음성 인식(STT)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    let recognition = null;
    let isListening = false;
    let baseTextBeforeSpeech = '';
    let voiceBtnRef = null;
    let inputElRef = null;
    let originalPlaceholder = '';

    function isSupported() {
        return !!SpeechRecognition;
    }

    function createRecognitionInstance() {
        if (!isSupported()) return null;
        try {
            const inst = new SpeechRecognition();
            inst.lang = 'ko-KR';
            inst.continuous = false; // 한 문장 단위 자연스러운 인식
            inst.interimResults = true; // 실시간 변환 텍스트 점진적 반영
            inst.maxAlternatives = 1;

            inst.onstart = handleSpeechStart;
            inst.onresult = handleSpeechResult;
            inst.onerror = handleSpeechError;
            inst.onend = handleSpeechEnd;

            return inst;
        } catch (e) {
            console.warn('[AI Voice] 음성 인식 인스턴스 생성 실패:', e);
            return null;
        }
    }

    function handleSpeechStart() {
        isListening = true;
        if (voiceBtnRef) {
            voiceBtnRef.classList.add('recording');
            voiceBtnRef.setAttribute('aria-label', '음성 인식 중지');
            voiceBtnRef.setAttribute('title', '음성 인식 중... (클릭하여 중지)');
        }
        if (inputElRef) {
            originalPlaceholder = inputElRef.placeholder || '메시지를 입력하세요...';
            inputElRef.placeholder = '듣고 있어요... 말씀해주세요 🎙️';
            // 기존 텍스트 뒤에 띄어쓰기 추가 후 음성 추가 준비
            baseTextBeforeSpeech = inputElRef.value ? inputElRef.value.trimEnd() + ' ' : '';
        }
    }

    function handleSpeechResult(event) {
        if (!inputElRef || !event.results) return;

        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const trans = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalText += trans;
            } else {
                interimText += trans;
            }
        }

        const currentSpoken = finalText || interimText;
        if (currentSpoken) {
            inputElRef.value = baseTextBeforeSpeech + currentSpoken;
            // 인풋 리사이징 및 글자 수 카운터 연동 이벤트 발생
            inputElRef.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function handleSpeechError(event) {
        console.warn('[AI Voice] 음성 인식 오류:', event.error);
        if (event.error === 'not-allowed') {
            alert('마이크 접근 권한이 차단되어 있습니다. 브라우저 설정에서 마이크를 허용해주세요.');
        } else if (event.error === 'network') {
            console.warn('[AI Voice] 네트워크 상태를 확인해주세요.');
        }
        stopListening();
    }

    function handleSpeechEnd() {
        isListening = false;
        if (voiceBtnRef) {
            voiceBtnRef.classList.remove('recording');
            voiceBtnRef.setAttribute('aria-label', '음성으로 말하기');
            voiceBtnRef.setAttribute('title', '음성으로 입력하기');
        }
        if (inputElRef) {
            if (originalPlaceholder) {
                inputElRef.placeholder = originalPlaceholder;
            }
            // 텍스트 맨 끝에 포커스 위치
            inputElRef.focus();
            const len = inputElRef.value.length;
            inputElRef.setSelectionRange(len, len);
            inputElRef.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function startListening() {
        if (!isSupported()) {
            alert('현재 브라우저에서는 음성 인식(STT) 기능을 지원하지 않습니다.\n(Chrome, Safari, Samsung Internet 최신 버전 권장)');
            return;
        }
        if (isListening) return;

        if (!recognition) {
            recognition = createRecognitionInstance();
        }
        if (!recognition) return;

        try {
            recognition.start();
        } catch (e) {
            console.warn('[AI Voice] 인식 시작 예외 (재초기화 시도):', e);
            recognition = createRecognitionInstance();
            if (recognition) {
                try { recognition.start(); } catch (err) { console.error(err); }
            }
        }
    }

    function stopListening() {
        if (!recognition || !isListening) return;
        try {
            recognition.stop();
        } catch (e) {
            console.warn('[AI Voice] 인식 중지 예외:', e);
        }
        isListening = false;
        if (voiceBtnRef) voiceBtnRef.classList.remove('recording');
    }

    function toggleListening() {
        if (isListening) stopListening();
        else startListening();
    }

    function initVoiceButton(buttonEl, targetInputEl) {
        if (!buttonEl) return;
        voiceBtnRef = buttonEl;
        inputElRef = targetInputEl;

        if (!isSupported()) {
            buttonEl.classList.add('unsupported');
            buttonEl.title = '이 브라우저는 음성 인식을 지원하지 않습니다';
            buttonEl.style.opacity = '0.5';
            return;
        }

        buttonEl.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleListening();
        });
    }

    window.JgAiVoice = {
        isSupported,
        isListening: () => isListening,
        startListening,
        stopListening,
        toggleListening,
        initVoiceButton
    };
})();
