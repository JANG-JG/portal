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

    /**
     * 생각 과정 패널 렌더링
     * @param {HTMLElement|null} panelEl 기존 패널 (없으면 생성)
     * @param {HTMLElement} contentEl 답변 본문 요소 (패널은 이 요소 바로 위에 삽입)
     * @param {string} text 생각 과정 전체 텍스트
     * @param {{open?: boolean, live?: boolean}} opts open: 펼침 여부(미지정 시 유지), live: 생각 진행 중 여부
     * @returns {HTMLElement|null} 패널 요소 (내용이 없으면 제거 후 null)
     */
    function render(panelEl, contentEl, text, opts = {}) {
        const body = String(text || '').trim();
        if (!body) {
            if (panelEl) panelEl.remove();
            return null;
        }
        if (!panelEl) {
            if (!contentEl || !contentEl.parentNode) return null;
            panelEl = document.createElement('details');
            panelEl.className = 'ai-thinking';
            panelEl.innerHTML = '<summary class="ai-thinking-summary"></summary><div class="ai-thinking-body"></div>';
            contentEl.parentNode.insertBefore(panelEl, contentEl);
        }
        if (typeof opts.open === 'boolean') panelEl.open = opts.open;
        panelEl.classList.toggle('is-live', !!opts.live);
        panelEl.querySelector('.ai-thinking-summary').textContent = opts.live ? '💭 생각하는 중…' : '💭 생각하는 과정 보기';
        panelEl.querySelector('.ai-thinking-body').innerHTML = escapeText(body).replace(/\n/g, '<br>');
        return panelEl;
    }

    window.JgAiThinking = { render };
})();
