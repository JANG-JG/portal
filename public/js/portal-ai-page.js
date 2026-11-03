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

    /**
     * 서버 런타임 설정 비동기 로드
     */
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
                    if (promptInputEl) {
                        promptInputEl.maxLength = currentMaxPromptLength;
                    }
                    const charCounterEl = document.getElementById('aiCharCount');
                    if (charCounterEl && (!promptInputEl || !promptInputEl.value.length)) {
                        charCounterEl.textContent = `0/${currentMaxPromptLength}`;
                        charCounterEl.title = `현재 글자 수 / 최대 ${currentMaxPromptLength.toLocaleString()}자`;
                    }
                    if (submitBtnEl) {
                        submitBtnEl.title = `메시지 전송 (최대 ${currentMaxPromptLength.toLocaleString()}자)`;
                    }
                    const disclaimerEl = document.querySelector('.ai-disclaimer span');
                    if (disclaimerEl) {
                        disclaimerEl.textContent = `🛡️ 가족 데이터 전용 로컬 AI (LG EXAONE 3.5) • 1회 질문당 최대 ${currentMaxPromptLength.toLocaleString()}자`;
                    }
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
                    if (descEl && data.config.heroDescription) {
                        descEl.innerHTML = data.config.heroDescription.replace(/\n/g, '<br>');
                    }
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
        const purgeUnifiedNav = () => {
            document.querySelectorAll('#unified-nav-root, #unavRoot, .unav-header, #unavDrawer, header#jg-unified-nav, #jg-global-ticker-bar, #jg-global-breaking-bar, #jg-ticker-container')
                .forEach(el => el.remove());
        };
        purgeUnifiedNav();
        setTimeout(purgeUnifiedNav, 100);
        setTimeout(purgeUnifiedNav, 500);

        sidebarEl = document.getElementById('aiSidebar');
        backdropEl = document.getElementById('aiSidebarBackdrop');
        messageScrollEl = document.getElementById('aiMessagesScroll');
        messageContainerEl = document.getElementById('aiMessagesContainer');
        promptInputEl = document.getElementById('aiPromptInput');
        submitBtnEl = document.getElementById('aiSubmitBtn');
        mobileTitleEl = document.getElementById('aiMobileSessionTitle');
        historyListEl = document.getElementById('aiSidebarHistoryList');
        historyCountEl = document.getElementById('aiHistoryCount');

        // 위키 등록 성공 시 콜백 등록
        window.JgAiRenderEvents = {
            onWikiSuccess: function(successMsg) {
                if (window.JgAiRender) {
                    window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', successMsg, Date.now());
                }
                if (window.JgAiHistory) {
                    window.JgAiHistory.addMessageToActiveSession('assistant', successMsg, Date.now());
                }
                scrollToBottom();
            }
        };

        initInputAutoResize();
        if (window.JgAiViewport && typeof window.JgAiViewport.init === 'function') {
            window.JgAiViewport.init(promptInputEl, scrollToBottom);
        }
        renderHistorySidebar();
        restoreActiveSession();
        checkUrlQueryParam();
        loadAiRuntimeConfig();

        // 🔄 서버 DB 대화 히스토리 동기화 완료 이벤트 감지
        window.addEventListener('jg:ai-history-updated', () => {
            renderHistorySidebar();
            restoreActiveSession();
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
                    window.JgAiHistory.createNewSession();
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
     * 새 대화 시작 버튼 클릭
     */
    window.handleNewChatClick = function() {
        if (window.JgAiHistory) {
            window.JgAiHistory.createNewSession();
            restoreActiveSession();
            renderHistorySidebar();
            window.toggleSidebar(false);
            if (promptInputEl) {
                promptInputEl.value = '';
                promptInputEl.style.height = '24px';
                promptInputEl.style.overflowY = 'hidden';
                promptInputEl.focus();
            }
        }
    };

    /**
     * 사이드바 대화 히스토리 목록 렌더링
     */
    function renderHistorySidebar() {
        if (!historyListEl || !window.JgAiHistory) return;
        const sessions = window.JgAiHistory.loadAllSessions();
        const activeId = window.JgAiHistory.getActiveSessionId();

        if (historyCountEl) {
            historyCountEl.textContent = sessions.length;
        }

        if (sessions.length === 0) {
            historyListEl.innerHTML = `
                <div style="text-align:center;padding:2rem 1rem;color:var(--ai-text-muted);font-size:0.8rem;line-height:1.5;">
                    저장된 대화가 없습니다.<br>새로운 질문을 시작해보세요!
                </div>
            `;
            return;
        }

        historyListEl.innerHTML = '';
        const escapeFn = (window.JgAiRender && window.JgAiRender.escapeHtml) ? window.JgAiRender.escapeHtml : (s => s);

        sessions.forEach(sess => {
            const item = document.createElement('div');
            item.className = 'ai-history-item' + (sess.id === activeId ? ' active' : '');

            const userMsgCount = sess.messages ? sess.messages.filter(m => m.role === 'user').length : 0;
            const timeStr = window.JgAiHistory.formatRelativeTime ? window.JgAiHistory.formatRelativeTime(sess.updatedAt) : '';
            const metaInfo = `${timeStr} • 대화 ${userMsgCount}개`;

            item.innerHTML = `
                <div class="ai-history-item-info">
                    <div class="ai-history-item-title" title="${escapeFn(sess.title)}">${escapeFn(sess.title)}</div>
                    <div class="ai-history-item-meta">${metaInfo}</div>
                </div>
                <button type="button" class="ai-history-del-btn" title="대화 삭제" data-del-id="${sess.id}">🗑️</button>
            `;

            // 세션 선택 클릭
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.ai-history-del-btn')) return;
                window.JgAiHistory.setActiveSessionId(sess.id);
                if (!sess.messages || sess.messages.length === 0) {
                    if (window.JgAiHistory.fetchSessionDetailAsync) {
                        await window.JgAiHistory.fetchSessionDetailAsync(sess.id);
                    }
                }
                restoreActiveSession();
                renderHistorySidebar();
                window.toggleSidebar(false);
            });

            // 삭제 버튼 핸들러
            const delBtn = item.querySelector('.ai-history-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (window.JgAiHistory.deleteSession(sess.id)) {
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

    /**
     * 빠른 추천 질문 클릭 핸들러
     */
    window.sendQuickPrompt = function(promptText) {
        if (promptInputEl) {
            promptInputEl.value = promptText;
            handleComposerSubmit();
        }
    };

    /**
     * 입력 폼 제출 핸들러
     */
    window.handleComposerSubmit = function(e) {
        if (e) e.preventDefault();
        if (isSending || !promptInputEl) return;

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
     * AI 비서 메시지 송수신 처리
     */
    async function sendAiMessage(userText) {
        if (isSending) return;

        // 히어로 카드 제거 (첫 질문 시)
        const hero = messageContainerEl.querySelector('.ai-hero-card');
        if (hero) hero.remove();

        const userTimestamp = Date.now();
        if (window.JgAiRender) {
            window.JgAiRender.appendMessageBubble(messageContainerEl, 'user', userText, userTimestamp);
        }
        currentChatHistory.push({ role: 'user', content: userText, timestamp: userTimestamp });

        if (window.JgAiHistory) {
            const updated = window.JgAiHistory.addMessageToActiveSession('user', userText, userTimestamp);
            if (updated && mobileTitleEl) mobileTitleEl.textContent = updated.title;
            renderHistorySidebar();
        }

        isSending = true;
        if (submitBtnEl) submitBtnEl.disabled = true;

        const typingId = 'typing_' + Date.now();
        if (window.JgAiRender) {
            window.JgAiRender.appendTypingIndicator(messageContainerEl, typingId);
        }
        scrollToBottom();

        let isStreaming = false;
        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userText,
                    history: currentChatHistory.slice(-4)
                })
            });

            if (window.JgAiRender) {
                window.JgAiRender.removeTypingIndicator(typingId);
            }
            const aiTimestamp = Date.now();

            if (!res.ok) {
                if (window.JgAiRender) {
                    window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', '죄송합니다. 로컬 AI 비서 응답 중 일시적인 오류가 발생했습니다.', aiTimestamp);
                }
                return;
            }

            const data = await res.json();
            if (data.success && data.answer) {
                currentChatHistory.push({ role: 'assistant', content: data.answer, timestamp: aiTimestamp });
                if (window.JgAiHistory) {
                    window.JgAiHistory.addMessageToActiveSession('assistant', data.answer, aiTimestamp);
                    renderHistorySidebar();
                }

                if (window.JgAiRender && typeof window.JgAiRender.streamAssistantBubble === 'function') {
                    isStreaming = true;
                    window.JgAiRender.streamAssistantBubble(messageContainerEl, data.answer, aiTimestamp, {
                        onProgress: () => scrollToBottom(),
                        onComplete: () => {
                            isSending = false;
                            if (submitBtnEl) submitBtnEl.disabled = false;
                            scrollToBottom();
                            if (promptInputEl) promptInputEl.focus();
                        }
                    });
                    scrollToBottom();
                } else if (window.JgAiRender) {
                    window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', data.answer, aiTimestamp);
                }
            } else {
                if (window.JgAiRender) {
                    window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', data.message || '답변을 생성하지 못했습니다.', aiTimestamp);
                }
            }
        } catch (err) {
            if (window.JgAiRender) {
                window.JgAiRender.removeTypingIndicator(typingId);
                window.JgAiRender.appendMessageBubble(messageContainerEl, 'assistant', '로컬 PC AI 엔진과의 연결이 원활하지 않습니다. (PC의 Ollama 구동 상태를 확인해 주세요)', Date.now());
            }
        } finally {
            if (!isStreaming) {
                isSending = false;
                if (submitBtnEl) submitBtnEl.disabled = false;
                scrollToBottom();
                if (promptInputEl) promptInputEl.focus();
            }
        }
    }

    function scrollToBottom() {
        if (messageScrollEl) {
            messageScrollEl.scrollTop = messageScrollEl.scrollHeight;
        }
    }

    /**
     * textarea 자동 높이 조절 및 키보드 엔터 핸들링
     */
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
            const targetH = Math.max(24, Math.min(scrollH, 120));
            promptInputEl.style.height = targetH + 'px';
            promptInputEl.style.overflowY = (scrollH > 120) ? 'auto' : 'hidden';
        }

        promptInputEl.addEventListener('input', function() {
            resizeInput();
            updateCharCount(this.value.length);
        });

        promptInputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (window.innerWidth > 768) {
                    e.preventDefault();
                    handleComposerSubmit();
                }
            }
        });
    }

    // 초기 마운트
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPage);
    } else {
        initPage();
    }
})();
