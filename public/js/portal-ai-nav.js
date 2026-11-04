/**
 * 🤖 JG 포털 AI 비서 상단 네비게이션 및 대화명 변경 모달 컨트롤러 (portal-ai-nav.js)
 * - [핵심 역할] 대화명 변경 모달 제어, 상단 새로고침 제어, 포털 홈 네비게이션
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    let currentEditingSessionId = null;

    /**
     * 대화명 변경 모달 열기
     * @param {string} [sessionId] - 수정할 대상 세션 ID (생략 시 현재 활성 세션)
     */
    window.openRenameModal = function(sessionId) {
        const modalBackdrop = document.getElementById('aiRenameModalBackdrop');
        const renameInput = document.getElementById('aiRenameInput');
        if (!modalBackdrop || !renameInput || !window.JgAiHistory) return;

        // 대상 세션 결정
        currentEditingSessionId = sessionId || window.JgAiHistory.getActiveSessionId();
        const sessions = window.JgAiHistory.loadAllSessions();
        const targetSession = sessions.find(s => s.id === currentEditingSessionId);

        const currentTitle = targetSession ? targetSession.title : (document.getElementById('aiMobileSessionTitle')?.textContent || '새 대화');
        renameInput.value = (currentTitle === 'AI 비서') ? '새 대화' : currentTitle;

        modalBackdrop.classList.add('active');
        setTimeout(() => {
            renameInput.focus();
            renameInput.select();
        }, 80);
    };

    /**
     * 대화명 변경 모달 닫기
     * @param {Event} [e] - 클릭 이벤트 객체
     */
    window.closeRenameModal = function(e) {
        if (e && e.target && e.target.id !== 'aiRenameModalBackdrop' && !e.target.classList.contains('ai-modal-close-btn') && !e.target.classList.contains('cancel')) {
            return;
        }
        const modalBackdrop = document.getElementById('aiRenameModalBackdrop');
        if (modalBackdrop) modalBackdrop.classList.remove('active');
        currentEditingSessionId = null;
    };

    /**
     * 대화명 변경 폼 제출 처리
     * @param {Event} e - 폼 제출 이벤트
     */
    window.handleRenameSubmit = async function(e) {
        if (e) e.preventDefault();
        const renameInput = document.getElementById('aiRenameInput');
        if (!renameInput || !window.JgAiHistory) return;

        const newTitle = renameInput.value.trim();
        if (!newTitle) {
            alert('대화명을 1글자 이상 입력해주세요.');
            renameInput.focus();
            return;
        }

        const targetId = currentEditingSessionId || window.JgAiHistory.getActiveSessionId();
        if (!targetId) {
            window.closeRenameModal();
            return;
        }

        // 로컬 및 서버 동기화 업데이트 실행
        await window.JgAiHistory.updateSessionTitle(targetId, newTitle);

        // 현재 활성 세션과 일치하면 상단 헤더 제목도 즉시 갱신
        const activeId = window.JgAiHistory.getActiveSessionId();
        if (targetId === activeId) {
            const headerTitleEl = document.getElementById('aiMobileSessionTitle');
            if (headerTitleEl) headerTitleEl.textContent = newTitle;
        }

        window.closeRenameModal();
    };

    /**
     * 상단 새로고침 버튼 핸들러 (Pull-to-refresh 대체)
     */
    window.handleHeaderRefresh = function() {
        const refreshBtn = document.getElementById('aiHeaderRefreshBtn');
        if (refreshBtn) {
            refreshBtn.classList.add('spinning');
        }

        // 스트리밍 진행 중인 경우 중단
        if (window.JgAiStream && typeof window.JgAiStream.abortStream === 'function') {
            try { window.JgAiStream.abortStream(); } catch (err) {}
        }

        // 부드러운 회전 피드백 후 새로고침 (현재 세션 ID는 sessionStorage에 보존됨)
        setTimeout(() => {
            window.location.reload();
        }, 180);
    };

    // ESC 키로 모달 닫기
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const modalBackdrop = document.getElementById('aiRenameModalBackdrop');
            if (modalBackdrop && modalBackdrop.classList.contains('active')) {
                window.closeRenameModal();
            }
        }
    });
})();
