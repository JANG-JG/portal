/**
 * 🤖 JG 포털 전용 AI 비서 풀스크린 페이지 제어 엔진 (portal-ai-page.js)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 대응
 */
(function() {
    'use strict';

    let isSending = false;
    let currentChatHistory = [];

    // DOM 참조 캐싱
    let sidebarEl, backdropEl, messageScrollEl, messageContainerEl, promptInputEl, submitBtnEl, mobileTitleEl, historyListEl, historyCountEl;

    function initPage() {
        sidebarEl = document.getElementById('aiSidebar');
        backdropEl = document.getElementById('aiSidebarBackdrop');
        messageScrollEl = document.getElementById('aiMessagesScroll');
        messageContainerEl = document.getElementById('aiMessagesContainer');
        promptInputEl = document.getElementById('aiPromptInput');
        submitBtnEl = document.getElementById('aiSubmitBtn');
        mobileTitleEl = document.getElementById('aiMobileSessionTitle');
        historyListEl = document.getElementById('aiSidebarHistoryList');
        historyCountEl = document.getElementById('aiHistoryCount');

        initInputAutoResize();
        initVisualViewport();
        renderHistorySidebar();
        restoreActiveSession();
        checkUrlQueryParam();
    }

    /**
     * URL 쿼리 파라미터(?q=...) 감지 및 자동 전송
     */
    function checkUrlQueryParam() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const query = urlParams.get('q');
            if (query && query.trim()) {
                // 새 세션으로 시작하여 질문 자동 실행
                if (window.JgAiHistory) {
                    window.JgAiHistory.createNewSession();
                    restoreActiveSession();
                    renderHistorySidebar();
                }
                setTimeout(() => {
                    sendAiMessage(query.trim());
                    // URL 파라미터 정리 (뒤로가기 시 중복 실행 방지)
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
        sessions.forEach(sess => {
            const item = document.createElement('div');
            item.className = 'ai-history-item' + (sess.id === activeId ? ' active' : '');

            const userMsgCount = sess.messages ? sess.messages.filter(m => m.role === 'user').length : 0;
            const timeStr = window.JgAiHistory.formatRelativeTime ? window.JgAiHistory.formatRelativeTime(sess.updatedAt) : '';
            const metaInfo = `${timeStr} • 대화 ${userMsgCount}개`;

            item.innerHTML = `
                <div class="ai-history-item-info">
                    <div class="ai-history-item-title" title="${escapeHtml(sess.title)}">${escapeHtml(sess.title)}</div>
                    <div class="ai-history-item-meta">${metaInfo}</div>
                </div>
                <button type="button" class="ai-history-del-btn" title="대화 삭제" data-del-id="${sess.id}">🗑️</button>
            `;

            // 세션 선택 클릭
            item.addEventListener('click', (e) => {
                if (e.target.closest('.ai-history-del-btn')) return;
                window.JgAiHistory.setActiveSessionId(sess.id);
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

        const title = (session && session.title) ? session.title : '우리 집 AI 비서';
        if (mobileTitleEl) mobileTitleEl.textContent = title;

        const messages = (session && Array.isArray(session.messages)) ? session.messages : [];

        // 대화 메시지가 없거나 웰컴 메시지만 있는 경우: 히어로 카드 표시
        if (messages.length <= 1) {
            renderHeroWelcomeCard();
        }

        messages.forEach(msg => {
            appendMessageBubble(msg.role, msg.content, msg.timestamp || session.createdAt);
            currentChatHistory.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
        });

        scrollToBottom();
    }

    /**
     * 웰컴 히어로 카드 렌더링
     */
    function renderHeroWelcomeCard() {
        const hero = document.createElement('div');
        hero.className = 'ai-hero-card';
        hero.innerHTML = `
            <div class="ai-hero-icon">🤖</div>
            <h2 class="ai-hero-title">우리 집 전용 AI 비서에게 물어보세요</h2>
            <p class="ai-hero-desc">
                LG EXAONE 3.5 기반 로컬 AI가 가족의 <strong>건강·혈압, 자산·포트폴리오, 오늘 일정, 서버 상태, 가족 위키 지식</strong>까지 무엇이든 안전하게 분석해 드립니다.
            </p>
        `;
        messageContainerEl.appendChild(hero);
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
        promptInputEl.style.height = 'auto';
        const charCounterEl = document.getElementById('aiCharCount');
        if (charCounterEl) {
            charCounterEl.textContent = '0/1000';
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
        appendMessageBubble('user', userText, userTimestamp);
        currentChatHistory.push({ role: 'user', content: userText, timestamp: userTimestamp });

        if (window.JgAiHistory) {
            const updated = window.JgAiHistory.addMessageToActiveSession('user', userText, userTimestamp);
            if (updated && mobileTitleEl) mobileTitleEl.textContent = updated.title;
            renderHistorySidebar();
        }

        isSending = true;
        if (submitBtnEl) submitBtnEl.disabled = true;

        const typingId = 'typing_' + Date.now();
        appendTypingIndicator(typingId);
        scrollToBottom();

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userText,
                    history: currentChatHistory.slice(-4)
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
                currentChatHistory.push({ role: 'assistant', content: data.answer, timestamp: aiTimestamp });
                if (window.JgAiHistory) {
                    window.JgAiHistory.addMessageToActiveSession('assistant', data.answer, aiTimestamp);
                    renderHistorySidebar();
                }
            } else {
                appendMessageBubble('assistant', data.message || '답변을 생성하지 못했습니다.', aiTimestamp);
            }
        } catch (err) {
            removeTypingIndicator(typingId);
            appendMessageBubble('assistant', '로컬 PC AI 엔진과의 연결이 원활하지 않습니다. (PC의 Ollama 구동 상태를 확인해 주세요)', Date.now());
        } finally {
            isSending = false;
            if (submitBtnEl) submitBtnEl.disabled = false;
            scrollToBottom();
            if (promptInputEl) promptInputEl.focus();
        }
    }

    /**
     * 🛡️ [핵심 버그 수정] 마크다운 및 <strong> 태그 안전 렌더러
     */
    function renderAiMarkdown(text) {
        if (!text) return '';

        // 1. 코드 블록 보호 (``` ... ```)
        const codeBlocks = [];
        let str = String(text).replace(/```([a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const placeholder = `__AI_CODE_BLOCK_${codeBlocks.length}__`;
            codeBlocks.push({ lang: lang || 'text', code });
            return placeholder;
        });

        // 2. 인라인 코드 보호 (`...`)
        const inlineCodes = [];
        str = str.replace(/`([^`\n]+)`/g, (match, code) => {
            const placeholder = `__AI_INLINE_CODE_${inlineCodes.length}__`;
            inlineCodes.push(code);
            return placeholder;
        });

        // 3. XSS 방지를 위한 기본 HTML 이스케이프
        let safe = escapeHtml(str);

        // 4. 🛡️ [버그 해결] 안전한 서식 태그 복원 (<strong>, <b>, <em>, <mark>, <del>, <br>)
        safe = safe.replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/gi, '<strong>$1</strong>');
        safe = safe.replace(/&lt;b&gt;([\s\S]*?)&lt;\/b&gt;/gi, '<strong>$1</strong>');
        safe = safe.replace(/&lt;em&gt;([\s\S]*?)&lt;\/em&gt;/gi, '<em>$1</em>');
        safe = safe.replace(/&lt;mark&gt;([\s\S]*?)&lt;\/mark&gt;/gi, '<mark class="ai-highlight">$1</mark>');
        safe = safe.replace(/&lt;del&gt;([\s\S]*?)&lt;\/del&gt;/gi, '<del>$1</del>');
        safe = safe.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

        // 5. 마크다운 헤딩 (#, ##, ###, ####) 및 볼드/취소선/링크 변환
        safe = safe.replace(/^[ \t]*#{1,2}[ \t]+(.*)$/gm, '<strong class="ai-md-heading ai-md-h3">$1</strong>');
        safe = safe.replace(/^[ \t]*#{3,4}[ \t]+(.*)$/gm, '<strong class="ai-md-heading ai-md-h4">$1</strong>');
        safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
        safe = safe.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="ai-link">$1</a>');
        safe = safe.replace(/^[ \t]*[-*][ \t]+(.*)$/gm, '• $1');

        // 6. 인라인 코드 복원
        safe = safe.replace(/__AI_INLINE_CODE_(\d+)__/g, (match, idx) => {
            const item = inlineCodes[parseInt(idx, 10)];
            return `<code class="ai-inline-code">${escapeHtml(item || '')}</code>`;
        });

        // 7. 코드 블록 복원
        safe = safe.replace(/__AI_CODE_BLOCK_(\d+)__/g, (match, idx) => {
            const block = codeBlocks[parseInt(idx, 10)];
            if (!block) return '';
            return `
                <div class="ai-code-wrapper">
                    <div class="ai-code-header">
                        <span>${escapeHtml(block.lang)}</span>
                        <button type="button" class="ai-code-copy-btn" onclick="window.copyAiCodeText(this)">복사</button>
                    </div>
                    <pre class="ai-code-pre"><code>${escapeHtml(block.code || '')}</code></pre>
                </div>
            `;
        });

        // 8. 줄바꿈
        safe = safe.replace(/\n/g, '<br>');
        safe = safe.replace(/<\/div><br>/g, '</div>');

        return safe;
    }

    /**
     * 메시지 버블 DOM 추가
     */
    function appendMessageBubble(role, text, timestamp) {
        if (!messageContainerEl) return;

        const row = document.createElement('div');
        row.className = `ai-bubble-row ${role}`;

        let htmlContent = '';
        if (role === 'assistant') {
            htmlContent = renderAiMarkdown(text);
        } else {
            htmlContent = escapeHtml(text).replace(/\n/g, '<br>');
        }

        const timeStr = (window.JgAiHistory && window.JgAiHistory.formatMessageDateTime) ? window.JgAiHistory.formatMessageDateTime(timestamp) : '';
        const isEligibleForWiki = (role === 'assistant' && text.length >= 25 && !text.includes('가족 위키에') && !text.includes('무엇을 도와드릴까요'));

        let actionsHtml = '';
        if (role === 'assistant') {
            const wikiBtnHtml = isEligibleForWiki ? `
                <button type="button" class="ai-bubble-action-btn wiki" onclick="window.saveBubbleToWiki(this)">
                    <span>📚</span><span>가족 위키로 저장</span>
                </button>
            ` : '';
            actionsHtml = `
                <div class="ai-bubble-actions">
                    <button type="button" class="ai-bubble-action-btn copy" onclick="window.copyBubbleText(this)" title="대화 내용 복사">
                        <span>📋</span><span>내용 복사</span>
                    </button>
                    ${wikiBtnHtml}
                </div>
            `;
        }

        const metaHtml = (role === 'user') ? `
            <div class="ai-bubble-meta">
                <button type="button" class="ai-user-copy-btn" onclick="window.copyBubbleText(this)" title="내용 복사">📋 복사</button>
                ${timeStr ? `<span class="ai-bubble-time">${timeStr}</span>` : ''}
            </div>
        ` : (timeStr ? `<span class="ai-bubble-time">${timeStr}</span>` : '');

        row.innerHTML = `
            <div class="ai-bubble-wrap">
                <div class="ai-bubble">
                    <div class="ai-bubble-content">${htmlContent}</div>
                    ${actionsHtml}
                </div>
                ${metaHtml}
            </div>
        `;

        row.dataset.rawText = text;
        messageContainerEl.appendChild(row);
    }

    /**
     * 말풍선 본문 복사 (클립보드 연동)
     */
    window.copyBubbleText = function(btn) {
        const row = btn.closest('.ai-bubble-row');
        if (!row) return;

        const rawText = row.dataset.rawText || (row.querySelector('.ai-bubble-content') ? row.querySelector('.ai-bubble-content').innerText.trim() : '');
        if (!rawText) return;

        const originalHtml = btn.innerHTML;
        const isUserBtn = btn.classList.contains('ai-user-copy-btn');

        function setFeedback(success) {
            btn.innerHTML = success ? (isUserBtn ? '✅ 복사 완료' : '<span>✅</span><span>복사 완료</span>') : '<span>❌</span><span>실패</span>';
            btn.disabled = true;
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }, 1500);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(rawText).then(() => setFeedback(true)).catch(() => fallbackCopy(rawText, setFeedback));
        } else {
            fallbackCopy(rawText, setFeedback);
        }
    };

    function fallbackCopy(text, callback) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            callback(ok);
        } catch (e) {
            callback(false);
        }
    }

    /**
     * 원터치 가족 위키 저장 연동
     */
    window.saveBubbleToWiki = async function(btn) {
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
                btn.style.backgroundColor = '#d1fae5';
                const successMsg = `가족 위키에 **[${data.category}] ${data.title}** 문서를 등록했습니다! 📚\n\n👉 [**위키 문서 바로가기**](${data.view_url})`;
                appendMessageBubble('assistant', successMsg, Date.now());
                if (window.JgAiHistory) {
                    window.JgAiHistory.addMessageToActiveSession('assistant', successMsg, Date.now());
                }
                scrollToBottom();
            } else {
                btn.disabled = false;
                btn.innerHTML = '<span>❌</span><span>실패 (다시 시도)</span>';
            }
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<span>❌</span><span>연결 오류</span>';
        }
    };

    /**
     * 코드 블록 복사 버튼
     */
    window.copyAiCodeText = function(btn) {
        const wrapper = btn.closest('.ai-code-wrapper');
        const codeEl = wrapper ? wrapper.querySelector('code') : null;
        if (!codeEl) return;

        navigator.clipboard.writeText(codeEl.textContent).then(() => {
            const originalText = btn.textContent;
            btn.textContent = '복사됨 ✓';
            setTimeout(() => { btn.textContent = originalText; }, 1800);
        }).catch(() => {
            btn.textContent = '실패';
        });
    };

    /**
     * 타이핑 대기 인디케이터
     */
    function appendTypingIndicator(id) {
        if (!messageContainerEl) return;
        const row = document.createElement('div');
        row.id = id;
        row.className = 'ai-bubble-row assistant';
        row.innerHTML = `
            <div class="ai-bubble-wrap">
                <div class="ai-bubble">
                    <div class="ai-typing-indicator">
                        <span>AI 비서가 생각하는 중입니다</span>
                        <span class="ai-typing-dot"></span>
                    </div>
                </div>
            </div>
        `;
        messageContainerEl.appendChild(row);
    }

    function removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
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
            charCounterEl.textContent = `${len}/1000`;
            charCounterEl.classList.toggle('warning', len >= 900 && len < 1000);
            charCounterEl.classList.toggle('limit', len >= 1000);
        }

        promptInputEl.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            updateCharCount(this.value.length);
        });

        promptInputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                // 모바일 가상키보드 줄바꿈 유지 고려 (데스크톱은 Enter로 전송)
                if (window.innerWidth > 768) {
                    e.preventDefault();
                    handleComposerSubmit();
                }
            }
        });
    }

    /**
     * 안드로이드 가상 키보드(visualViewport) 및 삼성 인터넷 브라우저 하단 툴바 완벽 대응
     */
    function initVisualViewport() {
        if (!window.visualViewport) return;

        const isSamsung = /SamsungBrowser/i.test(navigator.userAgent);
        if (isSamsung) {
            document.body.classList.add('is-samsung');
        }

        // 초기 화면 높이 기록 (키보드 없는 평상시 전체 화면 높이 기준)
        let baseInnerHeight = Math.max(window.innerHeight, window.visualViewport.height || 0);

        function resetWindowScroll() {
            if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0) {
                window.scrollTo(0, 0);
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
            }
        }

        function handleViewportChange() {
            const vv = window.visualViewport;
            const vh = vv ? vv.height : window.innerHeight;
            document.documentElement.style.setProperty('--ai-viewport-height', `${vh}px`);

            if (window.innerWidth <= 768) {
                // 키보드 열림 판단: 초기 전체 화면 높이 대비 120px 이상 줄어듦
                const currentH = vh || window.innerHeight;
                const isKeyboard = (baseInnerHeight - currentH > 120);
                document.body.classList.toggle('keyboard-open', isKeyboard);

                // 삼성 브라우저 하단 툴바 높이 동적 제어
                if (isSamsung) {
                    if (isKeyboard) {
                        // 키보드 열림 시 오프셋 완전 제거 (키보드 위에 바로 밀착)
                        document.documentElement.style.setProperty('--ai-samsung-offset', '0px');
                    } else {
                        // 사용자가 스크롤하여 삼성 툴바를 숨겼는지 체크
                        const isToolbarHidden = (window.innerHeight - baseInnerHeight >= 45);
                        if (isToolbarHidden) {
                            document.documentElement.style.setProperty('--ai-samsung-offset', '0px');
                        } else {
                            // 툴바 표시 중 (하단 주소창 모드 대비 84px 안전 오프셋 적용)
                            document.documentElement.style.setProperty('--ai-samsung-offset', '84px');
                        }
                    }
                }

                // 모바일 브라우저의 window 레벨 스크롤 강제 원복 (바닥 j-jg.cc 워터마크 및 공백 차단)
                resetWindowScroll();
                scrollToBottom();
            }
        }

        window.visualViewport.addEventListener('resize', handleViewportChange);
        window.visualViewport.addEventListener('scroll', () => {
            if (window.innerWidth <= 768) {
                resetWindowScroll();
            }
        });

        window.addEventListener('resize', () => {
            if (!document.body.classList.contains('keyboard-open')) {
                baseInnerHeight = Math.max(window.innerHeight, window.visualViewport ? window.visualViewport.height : 0);
            }
            handleViewportChange();
        });

        window.addEventListener('scroll', () => {
            if (window.innerWidth <= 768) {
                resetWindowScroll();
            }
        });

        // 초기 가용 높이 세팅
        handleViewportChange();

        // 입력창 포커스/블러 시 가상 키보드 스크롤 밀림 방어
        if (promptInputEl) {
            promptInputEl.addEventListener('focus', () => {
                resetWindowScroll();
                setTimeout(resetWindowScroll, 30);
                setTimeout(() => {
                    resetWindowScroll();
                    scrollToBottom();
                }, 120);
                setTimeout(() => {
                    resetWindowScroll();
                    scrollToBottom();
                }, 300);
            });
            promptInputEl.addEventListener('blur', () => {
                setTimeout(() => {
                    resetWindowScroll();
                    document.body.classList.remove('keyboard-open');
                    handleViewportChange();
                }, 100);
            });
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

    // 초기 마운트
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPage);
    } else {
        initPage();
    }
})();
