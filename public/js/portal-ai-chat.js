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

        // 2. 대화창 모달 생성
        const win = document.createElement('div');
        win.id = 'aiChatWindow';
        win.className = 'ai-chat-window';
        win.innerHTML = `
            <div class="ai-chat-header">
                <div class="ai-chat-header-title">
                    <div class="ai-chat-avatar">🤖</div>
                    <div>
                        <div class="ai-chat-name">
                            <span>우리 집 AI 비서</span>
                            <span class="ai-chat-badge" id="aiChatOnlineStatus">LG 엑사원 🟢</span>
                        </div>
                    </div>
                </div>
                <button type="button" class="ai-chat-close-btn" onclick="toggleAiChatWindow(false)" title="대화창 닫기">✕</button>
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
    }

    /**
     * 대화창 열기/닫기 토글
     */
    window.toggleAiChatWindow = function(forceState) {
        const win = document.getElementById('aiChatWindow');
        if (!win) return;

        const isCurrentlyOpen = (win.style.display === 'flex');
        const nextState = (typeof forceState === 'boolean') ? forceState : !isCurrentlyOpen;

        if (nextState) {
            win.style.display = 'flex';
            const input = document.getElementById('aiChatInput');
            if (input) setTimeout(() => input.focus(), 150);
            scrollMessagesToBottom();
        } else {
            win.style.display = 'none';
        }
    };

    window.openAiChatModal = function() {
        window.toggleAiChatWindow(true);
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

        // 1. 사용자 메시지 버블 추가
        appendMessageBubble('user', text);
        chatHistory.push({ role: 'user', content: text });
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

            if (!res.ok) {
                appendMessageBubble('assistant', '죄송합니다. 로컬 AI 비서 응답 중 일시적인 오류가 발생했습니다.');
                return;
            }

            const data = await res.json();
            if (data.success && data.answer) {
                appendMessageBubble('assistant', data.answer);
                chatHistory.push({ role: 'assistant', content: data.answer });
            } else {
                appendMessageBubble('assistant', data.message || '답변을 생성하지 못했습니다.');
            }
        } catch (err) {
            removeTypingIndicator(typingId);
            appendMessageBubble('assistant', '로컬 PC와의 연결이 원활하지 않습니다. (PC의 Ollama 구동 상태를 확인해 주세요)');
        } finally {
            isSending = false;
            if (sendBtn) sendBtn.disabled = false;
            scrollMessagesToBottom();
        }
    };

    function appendMessageBubble(role, text) {
        const msgContainer = document.getElementById('aiChatMessages');
        if (!msgContainer) return;

        const row = document.createElement('div');
        row.className = `ai-bubble-row ${role}`;

        // 줄바꿈 보존 및 HTML 안전 이스케이프
        const safeText = escapeHtml(text).replace(/\n/g, '<br>');
        row.innerHTML = `<div class="ai-bubble">${safeText}</div>`;
        msgContainer.appendChild(row);
    }

    function appendTypingIndicator(id) {
        const msgContainer = document.getElementById('aiChatMessages');
        if (!msgContainer) return;

        const row = document.createElement('div');
        row.id = id;
        row.className = 'ai-bubble-row assistant';
        row.innerHTML = `
            <div class="ai-bubble" style="color:var(--hm-text-muted); font-size:0.8rem; display:flex; align-items:center; gap:6px;">
                <span>생각하는 중...</span>
                <span class="ai-fab-pulse" style="width:6px; height:6px;"></span>
            </div>
        `;
        msgContainer.appendChild(row);
    }

    function removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function scrollMessagesToBottom() {
        const msgContainer = document.getElementById('aiChatMessages');
        if (msgContainer) {
            msgContainer.scrollTop = msgContainer.scrollHeight;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // DOM 준비 시 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAiChat);
    } else {
        initAiChat();
    }

})();
