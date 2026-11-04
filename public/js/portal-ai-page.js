/**
 * 🤖 JG 포털 전용 AI 비서 풀스크린 페이지 제어 엔진 (portal-ai-page.js)
 * - [핵심 역할] 대화 세션 관리, 메시지 송수신 오케스트레이션, 컴포저 인터랙션
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 대응
 */
(function() {
    'use strict';

    let isSending = false;
    let currentChatHistory = [];
    let currentMaxPromptLength = 1000;
    let currentAiConfig = null;

    // DOM 참조 캐싱
    let sidebarEl, backdropEl, messageScrollEl, messageContainerEl, promptInputEl, submitBtnEl, mobileTitleEl, historyListEl, historyCountEl;

    /** 서버 런타임 설정 비동기 로드 */
    async function loadAiRuntimeConfig() {
        try {
            const res = await fetch('/api/ai/config', { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.config) {
                currentAiConfig = data.config;
                // 1. 최대 글자 수 한도 적용
                if (data.config.maxPromptLength && Number.isInteger(data.config.maxPromptLength)) {
                    currentMaxPromptLength = data.config.maxPromptLength;
                    if (promptInputEl) promptInputEl.maxLength = currentMaxPromptLength;
                    const charCounterEl = document.getElementById('aiCharCount');
                    if (charCounterEl && (!promptInputEl || !promptInputEl.value.length)) {
                        charCounterEl.textContent = `0/${currentMaxPromptLength}`;
                        charCounterEl.title = `현재 글자 수 / 최대 ${currentMaxPromptLength.toLocaleString()}자`;
                    }
                    if (submitBtnEl) submitBtnEl.title = `메시지 전송 (최대 ${currentMaxPromptLength.toLocaleString()}자)`;
                    const disclaimerEl = document.querySelector('.ai-disclaimer span');
                    if (disclaimerEl) disclaimerEl.textContent = `🛡️ 가족 데이터 전용 로컬 AI (LG EXAONE 4.0) • 1회 질문당 최대 ${currentMaxPromptLength.toLocaleString()}자`;
                }
                // 2. 첫 환영 인사말 적용
                if (data.config.welcomeMessage && window.JgAiHistory && typeof window.JgAiHistory.setCustomWelcomeMessage === 'function') {
                    window.JgAiHistory.setCustomWelcomeMessage(data.config.welcomeMessage);
                    const firstBubble = messageContainerEl ? messageContainerEl.querySelector('.ai-bubble-row.assistant .ai-bubble-content') : null;
                    const activeSession = window.JgAiHistory.getActiveSession();
                    if (firstBubble && activeSession && activeSession.messages && activeSession.messages.length === 1) {
                        firstBubble.innerHTML = window.JgAiRender ? window.JgAiRender.renderMarkdown(window.JgAiHistory.getCustomWelcomeMessage()) : window.JgAiHistory.getCustomWelcomeMessage();
                    }
                }
                // 3. 현재 화면에 표시된 히어로 카드 즉시 갱신
                const existingHero = messageContainerEl ? messageContainerEl.querySelector('.ai-hero-card') : null;
                if (existingHero) {
                    const iconEl = existingHero.querySelector('.ai-hero-icon');
                    const titleEl = existingHero.querySelector('.ai-hero-title');
                    const descEl = existingHero.querySelector('.ai-hero-desc');
                    if (iconEl && data.config.heroIcon) iconEl.textContent = data.config.heroIcon;
                    if (titleEl && data.config.heroTitle) titleEl.textContent = data.config.heroTitle;
                    if (descEl && data.config.heroDescription) descEl.innerHTML = data.config.heroDescription.replace(/\n/g, '<br>');
                }
            }
        } catch (e) {
            console.warn('[AI Page] 런타임 설정 로드 실패 (기본값 유지):', e);
        }
    }

    /**
     * 메인 페이지 초기화
     */
    function initPage() {
        // 🛡️ 공통 상단 네비게이션 및 하단 티커 DOM 완전 제거 가드
        const purgeNav = () => document.querySelectorAll('#unified-nav-root, #unavRoot, .unav-header, #unavDrawer, header#jg-unified-nav, #jg-global-ticker-bar, #jg-global-breaking-bar, #jg-ticker-container').forEach(el => el.remove());
        purgeNav(); setTimeout(purgeNav, 100); setTimeout(purgeNav, 500);

        sidebarEl = document.getElementById('aiSidebar'); backdropEl = document.getElementById('aiSidebarBackdrop');
        messageScrollEl = document.getElementById('aiMessagesScroll'); messageContainerEl = document.getElementById('aiMessagesContainer');
        promptInputEl = document.getElementById('aiPromptInput'); submitBtnEl = document.getElementById('aiSubmitBtn');
        mobileTitleEl = document.getElementById('aiMobileSessionTitle'); historyListEl = document.getElementById('aiSidebarHistoryList');
        historyCountEl = document.getElementById('aiHistoryCount');

        const voiceBtnEl = document.getElementById('aiVoiceBtn');
        if (voiceBtnEl && window.JgAiVoice) window.JgAiVoice.initVoiceButton(voiceBtnEl, promptInputEl);

        const searchInputEl = document.getElementById('aiHistorySearchInput');
        if (searchInputEl) {
            let searchDebounceTimer = null;
            searchInputEl.addEventListener('input', (e) => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => renderHistorySidebar(e.target.value), 120);
            });
        }

        window.JgAiRenderEvents = {
            onWikiSuccess: function(successMsg) {
                if (window.JgAiRender) window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', successMsg, Date.now());
                if (window.JgAiHistory) window.JgAiHistory.addMessageToActiveSession('assistant', successMsg, Date.now());
                scrollToBottom();
            }
        };

        initInputAutoResize();
        if (window.JgAiViewport && typeof window.JgAiViewport.init === 'function') {
            window.JgAiViewport.init(promptInputEl, scrollToBottom);
        }

        // 🌐 URL 기반 세션 격리 라우팅 (Gemini/ChatGPT 표준)
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const querySessionId = urlParams.get('session');
            const queryQ = urlParams.get('q');
            if (querySessionId && window.JgAiHistory) {
                window.JgAiHistory.setActiveSessionId(querySessionId);
            } else if (!queryQ && window.JgAiHistory) {
                // 파라미터 없는 /ai 진입 시: 이전 세션 자동 복원 금지, 항상 새 대화 시작
                window.JgAiHistory.setActiveSessionId(null);
                window.JgAiHistory.createNewSession();
                currentChatHistory = [];
            }
        } catch (e) {}

        renderHistorySidebar();
        restoreActiveSession();
        checkUrlQueryParam();
        loadAiRuntimeConfig();

        // 🔄 서버 DB 대화 히스토리 동기화 완료 시 사이드바 목록 갱신
        window.addEventListener('jg:ai-history-updated', () => {
            renderHistorySidebar();
            const curActive = window.JgAiHistory?.getActiveSession();
            if (curActive?.title && mobileTitleEl) mobileTitleEl.textContent = curActive.title;
        });

        // 🔄 브라우저 뒤로가기/앞으로가기 세션 동기화
        window.addEventListener('popstate', async () => {
            try {
                const sId = new URLSearchParams(window.location.search).get('session');
                if (sId && window.JgAiHistory) {
                    window.JgAiHistory.setActiveSessionId(sId);
                    const cur = window.JgAiHistory.getActiveSession();
                    if (!cur?.messages?.length && window.JgAiHistory.fetchSessionDetailAsync) await window.JgAiHistory.fetchSessionDetailAsync(sId);
                } else if (!sId && window.JgAiHistory) {
                    window.JgAiHistory.setActiveSessionId(null);
                    window.JgAiHistory.createNewSession();
                    currentChatHistory = [];
                }
                restoreActiveSession();
                renderHistorySidebar();
            } catch (err) {}
        });
    }

    /**
     * URL 쿼리 파라미터(?q=...) 감지 및 자동 전송
     */
    function checkUrlQueryParam() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const query = urlParams.get('q');
            if (query && query.trim()) {
                if (window.JgAiHistory) {
                    window.JgAiHistory.setActiveSessionId(null);
                    window.JgAiHistory.createNewSession();
                    currentChatHistory = [];
                    restoreActiveSession();
                    renderHistorySidebar();
                }
                setTimeout(() => {
                    sendAiMessage(query.trim());
                    window.history.replaceState({}, document.title, window.location.pathname);
                }, 300);
            }
        } catch (e) {
            console.warn('[AI Page] URL 쿼리 처리 건너뜀:', e);
        }
    }

    /**
     * 사이드바 토글 (모바일 슬라이드 드로어)
     */
    window.toggleSidebar = function(forceState) {
        if (!sidebarEl) return;
        const isOpen = sidebarEl.classList.contains('active');
        const nextState = (typeof forceState === 'boolean') ? forceState : !isOpen;

        sidebarEl.classList.toggle('active', nextState);
        if (backdropEl) backdropEl.classList.toggle('active', nextState);
    };

    /**
     * 새 대화 시작 버튼 클릭 (완전 격리된 새 대화창으로 리셋)
     */
    window.handleNewChatClick = function() {
        if (window.JgAiHistory) {
            window.JgAiHistory.setActiveSessionId(null);
            window.JgAiHistory.createNewSession();
            currentChatHistory = [];
            restoreActiveSession();
            renderHistorySidebar();
            window.toggleSidebar(false);
            try {
                if (window.location.search.includes('session=')) {
                    window.history.pushState({ sessionId: null }, document.title, window.location.pathname);
                }
            } catch (e) {}
            if (promptInputEl) {
                promptInputEl.value = '';
                promptInputEl.style.height = '24px';
                promptInputEl.style.overflowY = 'hidden';
                promptInputEl.focus();
            }
        }
    };

    let currentSearchKeyword = '';

    /**
     * 사이드바 대화 히스토리 목록 렌더링 (키워드 검색 지원)
     */
    function renderHistorySidebar(keyword) {
        if (typeof keyword === 'string') currentSearchKeyword = keyword.trim().toLowerCase();
        if (!historyListEl || !window.JgAiHistory) return;
        let sessions = window.JgAiHistory.loadAllSessions();
        const activeId = window.JgAiHistory.getActiveSessionId();
        if (historyCountEl) historyCountEl.textContent = sessions.length;

        if (currentSearchKeyword) {
            sessions = sessions.filter(s => {
                const titleMatch = s.title && s.title.toLowerCase().includes(currentSearchKeyword);
                const msgMatch = s.messages && s.messages.some(m => m.content && m.content.toLowerCase().includes(currentSearchKeyword));
                return titleMatch || msgMatch;
            });
        }

        if (sessions.length === 0) {
            const emptyMsg = currentSearchKeyword ? '일치하는 대화가 없습니다.' : '저장된 대화가 없습니다.<br>새로운 질문을 시작해보세요!';
            historyListEl.innerHTML = `<div style="text-align:center;padding:2rem 1rem;color:var(--ai-text-muted);font-size:0.8rem;line-height:1.5;">${emptyMsg}</div>`;
            return;
        }

        historyListEl.innerHTML = '';
        const escapeFn = (window.JgAiRender && window.JgAiRender.escapeHtml) ? window.JgAiRender.escapeHtml : (s => s);

        sessions.forEach(sess => {
            const item = document.createElement('div');
            item.className = 'ai-history-item' + (sess.id === activeId ? ' active' : '');
            const userMsgCount = sess.messages ? sess.messages.filter(m => m.role === 'user').length : 0;
            const timeStr = window.JgAiHistory.formatRelativeTime ? window.JgAiHistory.formatRelativeTime(sess.updatedAt) : '';

            item.innerHTML = `
                <div class="ai-history-item-info">
                    <div class="ai-history-item-title" title="${escapeFn(sess.title)}">${escapeFn(sess.title)}</div>
                    <div class="ai-history-item-meta">${timeStr} • 대화 ${userMsgCount}개</div>
                </div>
                <div class="ai-history-item-actions">
                    <button type="button" class="ai-history-action-btn ai-history-edit-btn" title="대화명 변경" data-edit-id="${sess.id}">✏️</button>
                    <button type="button" class="ai-history-action-btn ai-history-del-btn" title="대화 삭제" data-del-id="${sess.id}">🗑️</button>
                </div>
            `;

            item.addEventListener('click', async (e) => {
                if (e.target.closest('.ai-history-item-actions')) return;
                window.JgAiHistory.setActiveSessionId(sess.id);
                try {
                    const newUrl = window.location.pathname + '?session=' + encodeURIComponent(sess.id);
                    window.history.pushState({ sessionId: sess.id }, document.title, newUrl);
                } catch (err) {}
                if (!sess.messages || !sess.messages.length) {
                    if (window.JgAiHistory.fetchSessionDetailAsync) await window.JgAiHistory.fetchSessionDetailAsync(sess.id);
                }
                restoreActiveSession();
                renderHistorySidebar();
                window.toggleSidebar(false);
            });

            const editBtn = item.querySelector('.ai-history-edit-btn');
            if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); if (window.openRenameModal) window.openRenameModal(sess.id); });

            const delBtn = item.querySelector('.ai-history-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const wasActive = (window.JgAiHistory.getActiveSessionId() === sess.id);
                    if (window.JgAiHistory.deleteSession(sess.id)) {
                        if (wasActive) {
                            try { window.history.replaceState({ sessionId: null }, document.title, window.location.pathname); } catch (e) {}
                        }
                        renderHistorySidebar();
                        restoreActiveSession();
                    }
                });
            }
            historyListEl.appendChild(item);
        });
    }

    /**
     * 현재 활성 세션의 대화 복원 및 렌더링
     */
    function restoreActiveSession() {
        if (!messageContainerEl || !window.JgAiHistory) return;
        const session = window.JgAiHistory.getActiveSession();
        messageContainerEl.innerHTML = '';
        currentChatHistory = [];

        const title = (session && session.title) ? session.title : 'AI 비서';
        if (mobileTitleEl) mobileTitleEl.textContent = title;

        const messages = (session && Array.isArray(session.messages)) ? session.messages : [];

        // 대화 메시지가 없거나 웰컴 메시지만 있는 경우: 히어로 카드 표시
        if (messages.length <= 1 && window.JgAiRender) {
            window.JgAiRender.renderHeroWelcomeCard(messageContainerEl, currentAiConfig);
        }

        messages.forEach(msg => {
            if (window.JgAiRender) {
                window.JgAiRender.appendMessageBubble(messageContainerEl, msg.role, msg.content, msg.timestamp || session.createdAt);
            }
            currentChatHistory.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
        });

        scrollToBottom();
    }

    /** 빠른 추천 질문 클릭 핸들러 */
    window.sendQuickPrompt = function(promptText) {
        if (promptInputEl) { promptInputEl.value = promptText; handleComposerSubmit(); }
    };

    /** 전송 및 생성 중단 버튼 UI 상태 동기화 */
    function updateSubmitButtonState(isBusy) {
        if (!submitBtnEl) return;
        if (isBusy) {
            submitBtnEl.classList.add('stopping');
            submitBtnEl.title = '답변 생성 중단';
            submitBtnEl.setAttribute('aria-label', '답변 생성 중단');
            submitBtnEl.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>';
        } else {
            submitBtnEl.classList.remove('stopping');
            submitBtnEl.title = `메시지 전송 (최대 ${currentMaxPromptLength.toLocaleString()}자)`;
            submitBtnEl.setAttribute('aria-label', '메시지 전송');
            submitBtnEl.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        }
    }

    /** 입력 폼 제출 핸들러 (생성 중 클릭 시 즉시 중단) */
    window.handleComposerSubmit = function(e) {
        if (e) e.preventDefault();
        // 🛑 이미 생성 중일 때 버튼 누르면 즉시 중단 (Stop Generating)
        if (isSending) {
            if (window.JgAiStream) window.JgAiStream.abortStream();
            return;
        }
        if (!promptInputEl) return;
        const text = promptInputEl.value.trim();
        if (!text) return;
        sendAiMessage(text);
        promptInputEl.value = '';
        promptInputEl.style.height = '24px';
        promptInputEl.style.overflowY = 'hidden';
        const charCounterEl = document.getElementById('aiCharCount');
        if (charCounterEl) {
            charCounterEl.textContent = `0/${currentMaxPromptLength}`;
            charCounterEl.classList.remove('warning', 'limit');
        }
    };

    /**
     * ⚡ AI 비서 실시간 SSE 스트리밍 메시지 송수신 처리
     */
    async function sendAiMessage(userText) {
        if (isSending) return;
        const hero = messageContainerEl.querySelector('.ai-hero-card');
        if (hero) hero.remove();

        // 🛡️ 이번 질문 이전의 최근 히스토리(최대 4개)만 전송 (새 대화일 때는 빈 배열 [])
        const priorHistory = currentChatHistory.slice(-4);
        const userTimestamp = Date.now();
        if (window.JgAiRender) window.JgAiRender.appendMessageBubble(messageContainerEl, 'user', userText, userTimestamp);
        currentChatHistory.push({ role: 'user', content: userText, timestamp: userTimestamp });

        if (window.JgAiHistory) {
            const updated = window.JgAiHistory.addMessageToActiveSession('user', userText, userTimestamp);
            if (updated && mobileTitleEl) mobileTitleEl.textContent = updated.title;
            renderHistorySidebar();
            try {
                if (updated?.id && !window.location.search.includes('session=')) {
                    const newUrl = window.location.pathname + '?session=' + encodeURIComponent(updated.id);
                    window.history.replaceState({ sessionId: updated.id }, document.title, newUrl);
                }
            } catch (e) {}
        }

        isSending = true;
        updateSubmitButtonState(true);
        const typingId = 'typing_' + Date.now();
        if (window.JgAiRender) window.JgAiRender.appendTypingIndicator(messageContainerEl, typingId);
        scrollToBottom();

        const aiTimestamp = Date.now();
        let streamingBubble = null;

        if (window.JgAiStream && typeof window.JgAiStream.streamChat === 'function') {
            await window.JgAiStream.streamChat({
                message: userText,
                history: priorHistory,
                onToken: (token) => {
                    if (!streamingBubble) {
                        if (window.JgAiRender) window.JgAiRender.removeTypingIndicator(typingId);
                        streamingBubble = window.JgAiRender ? window.JgAiRender.createStreamingBubble(messageContainerEl, aiTimestamp) : null;
                    }
                    if (streamingBubble) streamingBubble.appendToken(token);
                    scrollToBottom();
                },
                onThinking: (token) => {
                    if (!streamingBubble) {
                        if (window.JgAiRender) window.JgAiRender.removeTypingIndicator(typingId);
                        streamingBubble = window.JgAiRender ? window.JgAiRender.createStreamingBubble(messageContainerEl, aiTimestamp) : null;
                    }
                    if (streamingBubble && streamingBubble.appendThinking) streamingBubble.appendThinking(token);
                    scrollToBottom();
                },
                onDone: (fullText, doneData) => {
                    if (window.JgAiRender) window.JgAiRender.removeTypingIndicator(typingId);
                    if (!streamingBubble) {
                        streamingBubble = window.JgAiRender ? window.JgAiRender.createStreamingBubble(messageContainerEl, aiTimestamp) : null;
                    }
                    if (streamingBubble) streamingBubble.complete(fullText, doneData && doneData.thinkingText);
                    currentChatHistory.push({ role: 'assistant', content: fullText, timestamp: aiTimestamp });
                    if (window.JgAiHistory) {
                        window.JgAiHistory.addMessageToActiveSession('assistant', fullText, aiTimestamp);
                        renderHistorySidebar();
                    }
                },
                onError: (errMsg) => {
                    if (window.JgAiRender) {
                        window.JgAiRender.removeTypingIndicator(typingId);
                        window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', errMsg, aiTimestamp);
                    }
                },
                onAbort: (abortMsg) => {
                    if (window.JgAiRender) window.JgAiRender.removeTypingIndicator(typingId);
                    if (streamingBubble) {
                        streamingBubble.abort(abortMsg);
                        const partialText = streamingBubble.getRawText();
                        if (partialText) {
                            currentChatHistory.push({ role: 'assistant', content: partialText, timestamp: aiTimestamp });
                            if (window.JgAiHistory) {
                                window.JgAiHistory.addMessageToActiveSession('assistant', partialText, aiTimestamp);
                                renderHistorySidebar();
                            }
                        }
                    }
                }
            });
        }

        isSending = false;
        updateSubmitButtonState(false);
        scrollToBottom();
        if (promptInputEl) promptInputEl.focus();
    }

    function scrollToBottom() {
        if (messageScrollEl) messageScrollEl.scrollTop = messageScrollEl.scrollHeight;
    }

    /** textarea 자동 높이 조절 및 키보드 엔터 핸들링 */
    function initInputAutoResize() {
        if (!promptInputEl) return;
        const charCounterEl = document.getElementById('aiCharCount');
        function updateCharCount(len) {
            if (!charCounterEl) return;
            charCounterEl.textContent = `${len}/${currentMaxPromptLength}`;
            const warnThreshold = Math.floor(currentMaxPromptLength * 0.9);
            charCounterEl.classList.toggle('warning', len >= warnThreshold && len < currentMaxPromptLength);
            charCounterEl.classList.toggle('limit', len >= currentMaxPromptLength);
        }
        function resizeInput() {
            promptInputEl.style.height = 'auto';
            const scrollH = promptInputEl.scrollHeight;
            promptInputEl.style.height = Math.max(24, Math.min(scrollH, 120)) + 'px';
            promptInputEl.style.overflowY = (scrollH > 120) ? 'auto' : 'hidden';
        }
        promptInputEl.addEventListener('input', function() { resizeInput(); updateCharCount(this.value.length); });
        promptInputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
                e.preventDefault();
                handleComposerSubmit();
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
    else initPage();
})();
