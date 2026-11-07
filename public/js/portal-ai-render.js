/**
 * 🤖 JG 포털 AI 비서 - 마크다운 및 메시지 버블 렌더링 엔진 (portal-ai-render.js)
 * - [핵심 기능] XSS 방어 후 안전 서식 복원, 에디토리얼 레이아웃 렌더링, 코드/위키 복사 상호작용
 * - [규칙 3] 500줄 이하 모듈화 | [규칙 4] AI 서식 복원 무결성 준수
 */
(function() {
    'use strict';

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * 🛡️ 마크다운 및 <strong> 태그 안전 렌더러
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

        // 4. 🛡️ 안전한 서식 태그 복원 (<strong>, <b>, <em>, <mark>, <del>, <br>)
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
    function appendMessageBubble(container, role, text, timestamp) {
        if (!container) return;

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
        container.appendChild(row);
        return row;
    }

    /**
     * 웰컴 히어로 카드 렌더링
     */
    function renderHeroWelcomeCard(container, config = {}) {
        if (!container) return;
        const icon = (config && config.heroIcon && config.heroIcon.trim()) ? escapeHtml(config.heroIcon.trim()) : '🤖';
        const title = (config && config.heroTitle && config.heroTitle.trim()) ? escapeHtml(config.heroTitle.trim()) : 'AI 비서에게 무엇이든 물어보세요';
        const desc = (config && config.heroDescription && config.heroDescription.trim())
            ? escapeHtml(config.heroDescription.trim()).replace(/\n/g, '<br>')
            : 'JG 포털 로컬 AI가 질문에 친절하고 안전하게 답변해 드립니다.';

        const hero = document.createElement('div');
        hero.className = 'ai-hero-card';
        hero.innerHTML = `
            <div class="ai-hero-icon">${icon}</div>
            <h2 class="ai-hero-title">${title}</h2>
            <p class="ai-hero-desc">${desc}</p>
        `;
        container.appendChild(hero);
    }

    /**
     * 클립보드 복사 헬퍼
     */
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
     * 말풍선 본문 복사
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
                if (window.JgAiRenderEvents && typeof window.JgAiRenderEvents.onWikiSuccess === 'function') {
                    window.JgAiRenderEvents.onWikiSuccess(successMsg);
                }
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
     * 타이핑 대기 인디케이터
     */
    function appendTypingIndicator(container, id) {
        if (!container) return;
        const row = document.createElement('div');
        row.id = id;
        row.className = 'ai-bubble-row assistant';
        row.innerHTML = `
            <div class="ai-bubble-wrap">
                <div class="ai-bubble">
                    <div class="ai-typing-indicator">
                        <span>AI 비서가 생각하는 중입니다</span>
                        <span class="ai-typing-dots">
                            <span class="ai-typing-dot"></span>
                            <span class="ai-typing-dot"></span>
                            <span class="ai-typing-dot"></span>
                        </span>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(row);
    }

    function removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    /**
     * ⚡ 클로드/제미나이 스타일 점진적 타이핑 스트리밍 렌더러
     * @param {HTMLElement} container 메시지 컨테이너
     * @param {string} fullText 완성된 답변 전체 텍스트
     * @param {number} timestamp 수신 시각 타임스탬프
     * @param {Object} options { onProgress: Function, onComplete: Function }
     */
    function streamAssistantBubble(container, fullText, timestamp, options = {}) {
        if (!container) return null;
        if (!fullText) {
            return appendMessageBubble(container, 'assistant', '', timestamp);
        }

        const row = document.createElement('div');
        row.className = 'ai-bubble-row assistant';
        row.dataset.rawText = fullText;

        const timeStr = (window.JgAiHistory && window.JgAiHistory.formatMessageDateTime) ? window.JgAiHistory.formatMessageDateTime(timestamp) : '';
        const isEligibleForWiki = (fullText.length >= 25 && !fullText.includes('가족 위키에') && !fullText.includes('무엇을 도와드릴까요'));

        const wikiBtnHtml = isEligibleForWiki ? `
            <button type="button" class="ai-bubble-action-btn wiki" onclick="window.saveBubbleToWiki(this)">
                <span>📚</span><span>가족 위키로 저장</span>
            </button>
        ` : '';

        const actionsHtml = `
            <div class="ai-bubble-actions" style="display:none;">
                <button type="button" class="ai-bubble-action-btn copy" onclick="window.copyBubbleText(this)" title="대화 내용 복사">
                    <span>📋</span><span>내용 복사</span>
                </button>
                ${wikiBtnHtml}
            </div>
        `;

        const metaHtml = timeStr ? `<span class="ai-bubble-time">${timeStr}</span>` : '';

        row.innerHTML = `
            <div class="ai-bubble-wrap">
                <div class="ai-bubble">
                    <div class="ai-bubble-content"><span class="ai-typing-cursor"></span></div>
                    ${actionsHtml}
                </div>
                ${metaHtml}
            </div>
        `;

        container.appendChild(row);

        const contentEl = row.querySelector('.ai-bubble-content');
        const actionsEl = row.querySelector('.ai-bubble-actions');

        const len = fullText.length;
        // 템포 계산: 전체 텍스트를 약 60~75프레임 (약 1.0~1.3초) 동안 매끄럽게 흘려보냄
        const step = Math.max(1, Math.ceil(len / 70));
        let currentIndex = 0;
        let isDone = false;

        function finish() {
            if (isDone) return;
            isDone = true;
            clearInterval(timer);
            if (contentEl) {
                contentEl.innerHTML = renderAiMarkdown(fullText);
            }
            if (actionsEl) {
                actionsEl.style.display = 'flex';
            }
            if (typeof options.onComplete === 'function') {
                options.onComplete(fullText);
            }
        }

        // 사용자가 말풍선을 클릭/터치하면 즉시 전체 내용 표시 (스킵)
        row.addEventListener('click', finish, { once: true });

        const timer = setInterval(() => {
            currentIndex += step;
            if (currentIndex >= len) {
                finish();
            } else {
                const sliceText = fullText.slice(0, currentIndex);
                if (contentEl) {
                    contentEl.innerHTML = renderAiMarkdown(sliceText) + '<span class="ai-typing-cursor"></span>';
                }
                if (typeof options.onProgress === 'function') {
                    options.onProgress();
                }
            }
        }, 16);

        return row;
    }

    /**
     * ⚡ 실시간 SSE 토큰 스트리밍 버블 생성기
     */
    function createStreamingBubble(container, timestamp) {
        if (!container) return null;

        const row = document.createElement('div');
        row.className = 'ai-bubble-row assistant';

        const timeStr = (window.JgAiHistory && window.JgAiHistory.formatMessageDateTime) ? window.JgAiHistory.formatMessageDateTime(timestamp) : '';
        const metaHtml = timeStr ? `<span class="ai-bubble-time">${timeStr}</span>` : '';

        row.innerHTML = `
            <div class="ai-bubble-wrap">
                <div class="ai-bubble">
                    <div class="ai-bubble-content"><span class="ai-typing-cursor"></span></div>
                    <div class="ai-bubble-actions" style="display:none;"></div>
                </div>
                ${metaHtml}
            </div>
        `;

        container.appendChild(row);

        const contentEl = row.querySelector('.ai-bubble-content');
        const actionsEl = row.querySelector('.ai-bubble-actions');
        let accumulatedText = '', isDone = false, isThinkingClosed = false;
        let thinkingText = '', thinkingEl = null;
        // 💭 생각하는 과정 패널 (portal-ai-thinking.js 위임: 생각 중 펼침 → 답변 시작 시 자동 접힘)
        const renderThinking = (open) => {
            if (window.JgAiThinking) thinkingEl = window.JgAiThinking.render(thinkingEl, contentEl, thinkingText, { open, live: !isDone && !isThinkingClosed });
        };

        function refreshActions() {
            if (!actionsEl) return;
            const isEligibleForWiki = (accumulatedText.length >= 25 && !accumulatedText.includes('가족 위키에') && !accumulatedText.includes('무엇을 도와드릴까요'));
            const wikiBtnHtml = isEligibleForWiki ? `
                <button type="button" class="ai-bubble-action-btn wiki" onclick="window.saveBubbleToWiki(this)">
                    <span>📚</span><span>가족 위키로 저장</span>
                </button>
            ` : '';
            actionsEl.innerHTML = `
                <button type="button" class="ai-bubble-action-btn copy" onclick="window.copyBubbleText(this)" title="대화 내용 복사">
                    <span>📋</span><span>내용 복사</span>
                </button>
                ${wikiBtnHtml}
            `;
            actionsEl.style.display = 'flex';
        }

        return {
            element: row,
            appendThinking(token) {
                if (isDone || !token || isThinkingClosed) return;
                thinkingText += token;
                renderThinking(thinkingEl ? undefined : true);
            },
            appendToken(token) {
                if (isDone || !token) return;
                if (!isThinkingClosed) { isThinkingClosed = true; renderThinking(false); }
                accumulatedText += token;
                row.dataset.rawText = accumulatedText;
                if (contentEl) {
                    contentEl.innerHTML = renderAiMarkdown(accumulatedText) + '<span class="ai-typing-cursor"></span>';
                }
            },
            complete(fullText, finalThinking) {
                if (isDone) return;
                isDone = true; isThinkingClosed = true;
                if (typeof fullText === 'string') accumulatedText = fullText;
                if (typeof finalThinking === 'string') thinkingText = finalThinking;
                renderThinking(false);
                row.dataset.rawText = accumulatedText;
                if (contentEl) {
                    contentEl.innerHTML = renderAiMarkdown(accumulatedText);
                }
                refreshActions();
            },
            abort(msg = '생성이 중단되었습니다.') {
                if (isDone) return;
                isDone = true; isThinkingClosed = true;
                renderThinking(false);
                row.dataset.rawText = accumulatedText;
                if (contentEl) {
                    const noticeHtml = `<span class="ai-stream-aborted-badge">⏹️ ${escapeHtml(msg)}</span>`;
                    contentEl.innerHTML = (accumulatedText ? renderAiMarkdown(accumulatedText) + '<br>' : '') + noticeHtml;
                }
                if (accumulatedText) {
                    refreshActions();
                }
            },
            getRawText() {
                return accumulatedText;
            }
        };
    }

    // 전역 렌더러 노출
    window.JgAiRender = {
        escapeHtml: escapeHtml,
        renderMarkdown: renderAiMarkdown,
        appendMessageBubble: appendMessageBubble,
        streamAssistantBubble: streamAssistantBubble,
        createStreamingBubble: createStreamingBubble,
        appendTypingIndicator: appendTypingIndicator,
        removeTypingIndicator: removeTypingIndicator,
        renderHeroWelcomeCard: renderHeroWelcomeCard
    };
})();
