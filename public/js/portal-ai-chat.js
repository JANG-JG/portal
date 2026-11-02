/**
 * 🤖 JG 포털 로컬 AI 비서 (LG EXAONE 3.5) 챗봇 프론트엔드 엔진 (portal-ai-chat.js)
 * - 우하단 플로팅 비서 버튼 및 실시간 대화창 제어
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    let chatHistory = [];
    let isSending = false;

    /**
     * 모바일 배경 스크롤 차단 (Body Scroll Lock)
     */
    function lockBodyScroll() {
        if (window.innerWidth <= 768) {
            const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
            document.body.dataset.aiScrollY = scrollY;
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.width = '100%';
            document.body.style.overflow = 'hidden';
            document.body.classList.add('ai-chat-modal-open');
        }
    }

    /**
     * 모바일 배경 스크롤 복원
     */
    function unlockBodyScroll() {
        if (document.body.classList.contains('ai-chat-modal-open') || document.body.dataset.aiScrollY !== undefined) {
            const scrollY = parseInt(document.body.dataset.aiScrollY || '0', 10);
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
            delete document.body.dataset.aiScrollY;
            document.body.classList.remove('ai-chat-modal-open');
            window.scrollTo(0, scrollY);
        }
    }

    /**
     * 안드로이드 가상 키보드 팝업 시 뷰포트 크기 및 위치 실시간 보정
     */
    function handleVisualViewportResize() {
        const win = document.getElementById('aiChatWindow');
        if (!win || win.style.display !== 'flex') return;
        if (window.innerWidth > 768) return;

        if (window.visualViewport) {
            const vp = window.visualViewport;
            // 키보드가 올라온 가용 뷰포트 높이와 위치에 정확히 동기화
            win.style.height = `${vp.height}px`;
            win.style.top = `${vp.offsetTop}px`;
            win.style.bottom = 'auto';
            win.style.position = 'fixed';
            window.scrollTo(0, 0);
            scrollMessagesToBottom();
        }
    }

    /**
     * AI 챗봇 UI 초기화
     */
    function initAiChat() {
        if (document.getElementById('aiChatFabBtn')) return;

        // 1. 플로팅 트리거 버튼 생성
        const fab = document.createElement('button');
        fab.id = 'aiChatFabBtn';
        fab.className = 'ai-fab-btn';
        fab.type = 'button';
        fab.innerHTML = `
            <span class="ai-fab-pulse"></span>
            <span>🤖</span>
            <span>AI 비서</span>
        `;
        fab.onclick = toggleAiChatWindow;
        document.body.appendChild(fab);

        // 2. 모바일 백드롭 딤 오버레이 생성 (배경 터치 및 스크롤 방지)
        const backdrop = document.createElement('div');
        backdrop.id = 'aiChatBackdrop';
        backdrop.className = 'ai-chat-backdrop';
        backdrop.onclick = () => toggleAiChatWindow(false);
        document.body.appendChild(backdrop);

        // 3. 대화창 모달 생성
        const win = document.createElement('div');
        win.id = 'aiChatWindow';
        win.className = 'ai-chat-window';
        win.innerHTML = `
            <div class="ai-chat-header">
                <div class="ai-chat-header-title">
                    <button type="button" class="ai-header-btn ai-header-btn-icon-only" onclick="toggleAiHistoryDrawer()" title="지난 대화 목록 보기" id="aiChatHistoryToggleBtn">💬</button>
                    <div class="ai-chat-avatar">🤖</div>
                    <div style="min-width:0; overflow:hidden;">
                        <div class="ai-chat-name">
                            <span id="aiChatCurrentTitle" style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;">우리 집 AI 비서</span>
                            <span class="ai-chat-badge" id="aiChatOnlineStatus">LG 엑사원 🟢</span>
                        </div>
                    </div>
                </div>
                <div class="ai-chat-header-actions">
                    <button type="button" class="ai-header-btn" onclick="startNewAiSession()" title="새 대화 시작" id="aiChatNewSessionBtn">➕ 새 대화</button>
                    <button type="button" class="ai-chat-close-btn" onclick="toggleAiChatWindow(false)" title="대화창 닫기">✕</button>
                </div>
            </div>

            <!-- 대화 목록 서랍 (History Drawer) -->
            <div class="ai-chat-history-drawer" id="aiChatHistoryDrawer">
                <div class="ai-history-header">
                    <div class="ai-history-title-area">
                        <span>💬</span>
                        <span>지난 대화 목록</span>
                    </div>
                    <button type="button" class="ai-history-close-btn" onclick="toggleAiHistoryDrawer(false)" title="대화 목록 닫기">✕</button>
                </div>
                <div class="ai-history-actions-bar">
                    <button type="button" class="ai-new-session-full-btn" onclick="startNewAiSession()">
                        <span>➕</span>
                        <span>새 대화 시작하기</span>
                    </button>
                </div>
                <div class="ai-history-list" id="aiHistoryList"></div>
            </div>

            <div class="ai-chat-messages" id="aiChatMessages">
                <div class="ai-bubble-row assistant">
                    <div class="ai-bubble">
                        안녕하세요! JG 포털 전용 AI 비서(LG EXAONE 3.5)입니다. 🇰🇷<br>
                        우리 집 <strong>자산 현황, 혈압 건강, 오늘 일정, 서버 인프라 상태, 최신 뉴스</strong>까지 무엇이든 편하게 물어보세요! 😊
                    </div>
                </div>
            </div>

            <!-- 빠른 질문 칩 바 (전체 서비스 통합) -->
            <div class="ai-quick-prompts">
                <button type="button" class="ai-prompt-chip" onclick="handleQuickPrompt('우리 집 총 자산과 주요 주식 현황 분석해줘')">💰 자산 현황</button>
                <button type="button" class="ai-prompt-chip" onclick="handleQuickPrompt('최근 혈압 상태와 오늘 복약 여부 알려줘')">🩺 혈압·복약</button>
                <button type="button" class="ai-prompt-chip" onclick="handleQuickPrompt('오늘 챙겨야 할 가족 일정과 메모 알려줘')">📅 오늘 일정</button>
                <button type="button" class="ai-prompt-chip" onclick="handleQuickPrompt('주서버와 보조서버 가동 상태 알려줘')">🖥️ 서버 상태</button>
                <button type="button" class="ai-prompt-chip" onclick="handleQuickPrompt('오늘 주요 뉴스와 실시간 속보 알려줘')">📰 주요 뉴스</button>
                <button type="button" class="ai-prompt-chip" onclick="handleQuickPrompt('오늘 날씨와 외출 옷차림 팁 알려줘')">🌤️ 날씨 팁</button>
            </div>

            <form class="ai-chat-input-bar" onsubmit="handleSendAiMessage(event)">
                <input type="text" id="aiChatInput" class="ai-chat-input" placeholder="AI 비서에게 물어보세요 (예: 내 자산 얼마야?)..." autocomplete="off">
                <button type="submit" id="aiChatSendBtn" class="ai-chat-send-btn">전송</button>
            </form>
        `;
        document.body.appendChild(win);

        // 안드로이드 키보드 팝업 시 화면 튕김 방지 리스너 바인딩
        const input = win.querySelector('#aiChatInput');
        if (input) {
            input.addEventListener('focus', () => {
                if (window.innerWidth <= 768) {
                    window.scrollTo(0, 0);
                    setTimeout(() => {
                        window.scrollTo(0, 0);
                        handleVisualViewportResize();
                    }, 100);
                }
            });
        }

        // 저장된 활성 대화 세션 복원
        restoreActiveSessionUI();
    }

    /**
     * 대화창 열기/닫기 토글
     */
    window.toggleAiChatWindow = function(forceState) {
        const win = document.getElementById('aiChatWindow');
        const backdrop = document.getElementById('aiChatBackdrop');
        if (!win) return;

        const isCurrentlyOpen = (win.style.display === 'flex');
        const nextState = (typeof forceState === 'boolean') ? forceState : !isCurrentlyOpen;

        if (nextState) {
            lockBodyScroll();
            win.style.display = 'flex';
            if (backdrop) backdrop.classList.add('active');

            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', handleVisualViewportResize);
                window.visualViewport.addEventListener('scroll', handleVisualViewportResize);
                handleVisualViewportResize();
            }

            const input = document.getElementById('aiChatInput');
            if (input) setTimeout(() => input.focus(), 150);
            scrollMessagesToBottom();
        } else {
            win.style.display = 'none';
            if (backdrop) backdrop.classList.remove('active');

            // 동적 뷰포트 인라인 스타일 초기화
            win.style.height = '';
            win.style.top = '';
            win.style.bottom = '';
            win.style.position = '';

            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
                window.visualViewport.removeEventListener('scroll', handleVisualViewportResize);
            }

            const drawer = document.getElementById('aiChatHistoryDrawer');
            if (drawer) drawer.classList.remove('active');

            unlockBodyScroll();
        }
    };

    window.openAiChatModal = function() {
        window.toggleAiChatWindow(true);
    };

    /**
     * 현재 활성 세션 대화 복원
     */
    function restoreActiveSessionUI() {
        const msgContainer = document.getElementById('aiChatMessages');
        if (!msgContainer || !window.JgAiHistory) return;

        const session = window.JgAiHistory.getActiveSession();
        msgContainer.innerHTML = '';
        chatHistory = [];

        if (session && Array.isArray(session.messages)) {
            session.messages.forEach(msg => {
                appendMessageBubble(msg.role, msg.content, msg.timestamp || session.createdAt);
                chatHistory.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
            });
            updateSessionTitleUI(session.title);
        } else {
            const welcome = window.JgAiHistory.DEFAULT_WELCOME_MSG;
            appendMessageBubble(welcome.role, welcome.content, Date.now());
            updateSessionTitleUI('새 대화');
        }
        scrollMessagesToBottom();
    }

    /**
     * 헤더 세션 제목 UI 갱신
     */
    function updateSessionTitleUI(title) {
        const titleEl = document.getElementById('aiChatCurrentTitle');
        if (titleEl) {
            titleEl.textContent = title || '우리 집 AI 비서';
            titleEl.title = title || '우리 집 AI 비서';
        }
    }

    /**
     * 새 대화 세션 시작
     */
    window.startNewAiSession = function() {
        if (window.JgAiHistory) {
            window.JgAiHistory.createNewSession();
            restoreActiveSessionUI();
            window.toggleAiHistoryDrawer(false);
            const input = document.getElementById('aiChatInput');
            if (input) {
                input.value = '';
                input.focus();
            }
        }
    };

    /**
     * 대화 목록 서랍 열기/닫기 토글
     */
    window.toggleAiHistoryDrawer = function(forceState) {
        const drawer = document.getElementById('aiChatHistoryDrawer');
        const listEl = document.getElementById('aiHistoryList');
        if (!drawer) return;

        const isOpen = drawer.classList.contains('active');
        const nextState = (typeof forceState === 'boolean') ? forceState : !isOpen;

        if (nextState) {
            drawer.classList.add('active');
            if (window.JgAiHistory && listEl) {
                window.JgAiHistory.renderHistoryList(listEl, () => {
                    restoreActiveSessionUI();
                    drawer.classList.remove('active');
                });
            }
        } else {
            drawer.classList.remove('active');
        }
    };

    /**
     * 빠른 추천 질문 클릭 핸들러
     */
    window.handleQuickPrompt = function(promptText) {
        const input = document.getElementById('aiChatInput');
        if (input) {
            input.value = promptText;
            handleSendAiMessage();
        }
    };

    /**
     * 메시지 전송 처리
     */
    window.handleSendAiMessage = async function(e) {
        if (e) e.preventDefault();
        if (isSending) return;

        const input = document.getElementById('aiChatInput');
        const sendBtn = document.getElementById('aiChatSendBtn');
        const msgContainer = document.getElementById('aiChatMessages');
        if (!input || !msgContainer) return;

        const text = input.value.trim();
        if (!text) return;

        // 1. 사용자 메시지 버블 추가 및 세션 보관 (프롬프트 입력 날짜/시각 기록)
        const userTimestamp = Date.now();
        appendMessageBubble('user', text, userTimestamp);
        chatHistory.push({ role: 'user', content: text, timestamp: userTimestamp });
        if (window.JgAiHistory) {
            const updated = window.JgAiHistory.addMessageToActiveSession('user', text, userTimestamp);
            if (updated) updateSessionTitleUI(updated.title);
        }
        input.value = '';
        input.focus();

        // 2. 대기 인디케이터 표시
        isSending = true;
        if (sendBtn) sendBtn.disabled = true;
        const typingId = 'typingIndicator_' + Date.now();
        appendTypingIndicator(typingId);
        scrollMessagesToBottom();

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(-4)
                })
            });

            removeTypingIndicator(typingId);

            const aiTimestamp = Date.now();
            if (!res.ok) {
                appendMessageBubble('assistant', '죄송합니다. 로컬 AI 비서 응답 중 일시적인 오류가 발생했습니다.', aiTimestamp);
                return;
            }

            const data = await res.json();
            if (data.success && data.answer) {
                appendMessageBubble('assistant', data.answer, aiTimestamp);
                chatHistory.push({ role: 'assistant', content: data.answer, timestamp: aiTimestamp });
                if (window.JgAiHistory) {
                    window.JgAiHistory.addMessageToActiveSession('assistant', data.answer, aiTimestamp);
                }
            } else {
                appendMessageBubble('assistant', data.message || '답변을 생성하지 못했습니다.', aiTimestamp);
            }
        } catch (err) {
            removeTypingIndicator(typingId);
            appendMessageBubble('assistant', '로컬 PC와의 연결이 원활하지 않습니다. (PC의 Ollama 구동 상태를 확인해 주세요)', Date.now());
        } finally {
            isSending = false;
            if (sendBtn) sendBtn.disabled = false;
            scrollMessagesToBottom();
        }
    };

    function formatAiMarkdown(text) {
        if (!text) return '';
        if (text.includes('class="ai-') || text.includes('<table')) return text;
        let safe = escapeHtml(text);
        safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:underline; font-weight:700;">$1</a>');
        safe = safe.replace(/^[ \t]*-[ \t]+(.*)$/gm, '• $1');
        return safe.replace(/\n/g, '<br>');
    }

    function appendMessageBubble(role, text, timestamp) {
        const msgContainer = document.getElementById('aiChatMessages');
        if (!msgContainer) return;

        const row = document.createElement('div');
        row.className = `ai-bubble-row ${role}`;

        let htmlContent = '';
        if (role === 'assistant') {
            htmlContent = formatAiMarkdown(text);
        } else {
            htmlContent = escapeHtml(text).replace(/\n/g, '<br>');
        }

        const timeStr = (window.JgAiHistory && window.JgAiHistory.formatMessageDateTime) ? window.JgAiHistory.formatMessageDateTime(timestamp) : '';
        const isEligible = role === 'assistant' && text.length >= 25 && !text.includes('가족 위키에') && !text.includes('무엇을 도와드릴까요');
        const wikiBtn = isEligible ? `<div style="margin-top:6px;display:flex;justify-content:flex-end;"><button type="button" class="ai-bubble-wiki-btn" style="font-size:11px;padding:3px 8px;border-radius:12px;border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" onclick="window.saveChatBubbleToWiki(this)"><span>📚</span><span>위키로 저장</span></button></div>` : '';

        row.innerHTML = `<div class="ai-bubble-wrap"><div class="ai-bubble">${htmlContent}${wikiBtn}</div>${timeStr ? `<span class="ai-bubble-time">${timeStr}</span>` : ''}</div>`;
        if (isEligible) row.dataset.rawText = text;
        msgContainer.appendChild(row);
    }

    window.saveChatBubbleToWiki = async function(btn) {
        const row = btn.closest('.ai-bubble-row');
        const rawText = row ? row.dataset.rawText : '';
        if (!rawText) return;
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span><span>위키 등록 중...</span>';
        try {
            const res = await fetch('/api/ai/publish-to-wiki', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: rawText })
            });
            const data = await res.json();
            if (data.success) {
                btn.innerHTML = '<span>✅</span><span>위키 등록 완료</span>';
                btn.style.background = '#d1fae5';
                const successMsg = `가족 위키에 **[${data.category}] ${data.title}** 문서를 등록했습니다! 📚\n\n👉 [**위키 문서 바로가기**](${data.view_url})`;
                appendMessageBubble('assistant', successMsg, Date.now());
                if (window.JgAiHistory) window.JgAiHistory.addMessageToActiveSession('assistant', successMsg, Date.now());
                scrollMessagesToBottom();
            } else {
                btn.disabled = false;
                btn.innerHTML = '<span>❌</span><span>실패 (다시 시도)</span>';
            }
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<span>❌</span><span>연결 오류</span>';
        }
    };

    function appendTypingIndicator(id) {
        const msgContainer = document.getElementById('aiChatMessages');
        if (!msgContainer) return;
        const row = document.createElement('div');
        row.id = id;
        row.className = 'ai-bubble-row assistant';
        row.innerHTML = `<div class="ai-bubble" style="color:var(--hm-text-muted);font-size:0.8rem;display:flex;align-items:center;gap:6px;"><span>생각하는 중...</span><span class="ai-fab-pulse" style="width:6px;height:6px;"></span></div>`;
        msgContainer.appendChild(row);
    }

    function removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function scrollMessagesToBottom() {
        const c = document.getElementById('aiChatMessages');
        if (c) c.scrollTop = c.scrollHeight;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAiChat);
    } else {
        initAiChat();
    }
})();
