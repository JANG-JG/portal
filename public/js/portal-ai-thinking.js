/**
 * 💭 JG 포털 AI 비서 - 생각하는 과정 접이식 패널 모듈 (portal-ai-thinking.js)
 * - [핵심 역할] EXAONE 4.0 등 추론 모델의 생각 과정을 Claude/GPT처럼 실시간 표시 → 답변 시작 시 자동 접힘
 * - [규칙 3] XSS 방어: 생각 내용은 escape 후 줄바꿈만 <br>로 복원
 */
(function() {
    'use strict';

    function escapeText(str) {
        return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function elapsedSec(panelEl) {
        const fixedSec = Number(panelEl.dataset.durationSec || 0);
        if (fixedSec > 0) return Math.max(1, Math.round(fixedSec));
        const start = Number(panelEl.dataset.startedAt || 0);
        if (!start) return null;
        const end = Number(panelEl.dataset.endedAt || 0) || Date.now();
        return Math.max(1, Math.round((end - start) / 1000));
    }

    function updateLabel(panelEl, live) {
        const sec = elapsedSec(panelEl);
        const label = live
            ? `💭 생각하는 중…${sec ? ` ${sec}초` : ''}`
            : `💭 생각하는 과정 보기${sec ? ` (${sec}초 동안 생각함)` : ''}`;
        const summaryEl = panelEl.querySelector('.ai-thinking-summary');
        if (summaryEl) summaryEl.textContent = label;
    }

    function stopTimer(panelEl) {
        if (panelEl._thinkTimer) {
            clearInterval(panelEl._thinkTimer);
            panelEl._thinkTimer = null;
        }
    }

    /**
     * 생각 과정 패널 렌더링
     * @param {HTMLElement|null} panelEl 기존 패널 (없으면 생성)
     * @param {HTMLElement} contentEl 답변 본문 요소 (패널은 이 요소 바로 위에 삽입)
     * @param {string} text 생각 과정 전체 텍스트
     * @param {{open?: boolean, live?: boolean, startedAt?: number, endedAt?: number, durationSec?: number}} opts
     * @returns {HTMLElement|null} 패널 요소 (내용이 없으면 제거 후 null)
     */
    function render(panelEl, contentEl, text, opts = {}) {
        const body = String(text || '').trim();
        if (!body) {
            if (panelEl) { stopTimer(panelEl); panelEl.remove(); }
            return null;
        }
        if (!panelEl) {
            if (!contentEl || !contentEl.parentNode) return null;
            panelEl = document.createElement('details');
            panelEl.className = 'ai-thinking';
            panelEl.innerHTML = '<summary class="ai-thinking-summary"></summary><div class="ai-thinking-body"></div>';
            contentEl.parentNode.insertBefore(panelEl, contentEl);
            panelEl.dataset.startedAt = String(opts.startedAt || Date.now());
        }

        if (opts.durationSec) panelEl.dataset.durationSec = String(opts.durationSec);
        if (opts.startedAt && !panelEl.dataset.startedAt) panelEl.dataset.startedAt = String(opts.startedAt);
        if (opts.endedAt) panelEl.dataset.endedAt = String(opts.endedAt);

        if (typeof opts.open === 'boolean') panelEl.open = opts.open;
        panelEl.classList.toggle('is-live', !!opts.live);

        if (opts.live) {
            if (!panelEl.dataset.startedAt) panelEl.dataset.startedAt = String(Date.now());
            if (!panelEl._thinkTimer && !panelEl.dataset.endedAt) {
                const el = panelEl;
                el._thinkTimer = setInterval(() => {
                    if (!el.isConnected) return stopTimer(el);
                    updateLabel(el, true);
                }, 1000);
            }
        } else {
            stopTimer(panelEl);
            if (panelEl.dataset.startedAt && !panelEl.dataset.endedAt) {
                panelEl.dataset.endedAt = String(opts.endedAt || Date.now());
            }
        }
        updateLabel(panelEl, !!opts.live);
        panelEl.querySelector('.ai-thinking-body').innerHTML = escapeText(body).replace(/\n/g, '<br>');
        return panelEl;
    }

    window.JgAiThinking = { render };
})();
