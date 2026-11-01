/**
 * 🤖 JG 포털 로컬 AI 비서 대화 히스토리/세션 관리 엔진 (portal-ai-history.js)
 * - 브라우저 영구 보관 (localStorage) 기반 다중 세션 관리
 * - 세션 생성, 선택 복원, 삭제, 첫 질문 기반 자동 제목 추출
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    const SESSIONS_STORAGE_KEY = 'jg_portal_ai_sessions_v1';
    const ACTIVE_ID_STORAGE_KEY = 'jg_portal_ai_active_id_v1';

    const DEFAULT_WELCOME_MSG = {
        role: 'assistant',
        content: '안녕하세요! JG 포털 전용 AI 비서(LG EXAONE 3.5)입니다. 🇰🇷<br>우리 집 <strong>자산 현황, 혈압 건강, 오늘 일정, 서버 인프라 상태, 최신 뉴스</strong>까지 무엇이든 편하게 물어보세요! 😊'
    };

    /**
     * 로컬 스토리지에서 전체 세션 배열 로드
     */
    function loadAllSessions() {
        try {
            const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.error('[AI History] 세션 데이터 로드 오류:', e);
            return [];
        }
    }

    /**
     * 로컬 스토리지에 전체 세션 배열 저장
     */
    function saveAllSessions(sessions) {
        try {
            localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
        } catch (e) {
            console.error('[AI History] 세션 데이터 저장 오류:', e);
        }
    }

    /**
     * 현재 활성 세션 ID 가져오기
     */
    function getActiveSessionId() {
        return localStorage.getItem(ACTIVE_ID_STORAGE_KEY) || null;
    }

    /**
     * 현재 활성 세션 ID 저장
     */
    function setActiveSessionId(id) {
        if (id) {
            localStorage.setItem(ACTIVE_ID_STORAGE_KEY, id);
        } else {
            localStorage.removeItem(ACTIVE_ID_STORAGE_KEY);
        }
    }

    /**
     * 고유 세션 ID 생성
     */
    function generateSessionId() {
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    }

    /**
     * 새 세션 생성
     */
    function createNewSession(customTitle) {
        const sessions = loadAllSessions();
        const now = Date.now();
        const newSession = {
            id: generateSessionId(),
            title: customTitle || '새 대화',
            createdAt: now,
            updatedAt: now,
            messages: [Object.assign({}, DEFAULT_WELCOME_MSG, { timestamp: now })]
        };

        sessions.unshift(newSession);
        // 최대 30개 세션 보관 (용량 및 성능 보호)
        if (sessions.length > 30) {
            sessions.length = 30;
        }

        saveAllSessions(sessions);
        setActiveSessionId(newSession.id);
        return newSession;
    }

    /**
     * 현재 활성 세션 가져오기 (없으면 새로 생성)
     */
    function getActiveSession() {
        const sessions = loadAllSessions();
        const activeId = getActiveSessionId();

        if (activeId) {
            const found = sessions.find(s => s.id === activeId);
            if (found) return found;
        }

        // 활성 세션이 없거나 유효하지 않으면 가장 최근 세션 사용
        if (sessions.length > 0) {
            setActiveSessionId(sessions[0].id);
            return sessions[0];
        }

        // 아무 세션도 없으면 새로 생성
        return createNewSession();
    }

    /**
     * 활성 세션에 메시지 추가 및 제목 자동 갱신
     */
    function addMessageToActiveSession(role, content, timestamp) {
        const sessions = loadAllSessions();
        let activeId = getActiveSessionId();
        let session = sessions.find(s => s.id === activeId);

        if (!session) {
            session = createNewSession();
            sessions.unshift(session);
            activeId = session.id;
        }

        const msgTime = timestamp || Date.now();
        session.messages.push({ role, content, timestamp: msgTime });
        session.updatedAt = msgTime;

        // 사용자의 첫 질문인 경우 대화 세션 제목 자동 업데이트
        if (role === 'user' && session.title === '새 대화') {
            const cleanText = content.replace(/<[^>]*>?/gm, '').trim();
            session.title = cleanText.length > 22 ? cleanText.substring(0, 22) + '...' : cleanText;
        }

        // 최신 업데이트된 세션을 목록 상단으로 이동
        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx > 0) {
            sessions.splice(idx, 1);
            sessions.unshift(session);
        }

        saveAllSessions(sessions);
        return session;
    }

    /**
     * 특정 세션 삭제
     */
    function deleteSession(sessionId) {
        let sessions = loadAllSessions();
        const target = sessions.find(s => s.id === sessionId);
        const title = target ? target.title : '선택한 대화';

        if (!confirm(`"${title}" 대화 기록을 완전히 삭제하시겠습니까?`)) {
            return false;
        }

        sessions = sessions.filter(s => s.id !== sessionId);
        saveAllSessions(sessions);

        // 삭제된 세션이 활성 세션이었던 경우 처리
        if (getActiveSessionId() === sessionId) {
            if (sessions.length > 0) {
                setActiveSessionId(sessions[0].id);
            } else {
                createNewSession();
            }
        }
        return true;
    }

    /**
     * 상대 시간 포맷팅 (친근한 한국어)
     */
    function formatRelativeTime(ts) {
        if (!ts) return '';
        const now = Date.now();
        const diffMs = now - ts;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 60) return '방금 전';
        if (diffMin < 60) return `${diffMin}분 전`;
        if (diffHour < 24) return `${diffHour}시간 전`;
        if (diffDay === 1) return '어제';
        if (diffDay < 7) return `${diffDay}일 전`;

        const d = new Date(ts);
        return `${d.getMonth() + 1}월 ${d.getDate()}일`;
    }

    /**
     * 대화 목록 드로어 UI 렌더링
     */
    function renderHistoryList(containerEl, onSelectSession) {
        if (!containerEl) return;
        const sessions = loadAllSessions();
        const activeId = getActiveSessionId();

        if (sessions.length === 0) {
            containerEl.innerHTML = `
                <div class="ai-history-empty">
                    <div class="ai-history-empty-icon">💬</div>
                    <div class="ai-history-empty-text">
                        저장된 대화 기록이 없습니다.<br>
                        AI 비서에게 새로운 질문을 해보세요!
                    </div>
                </div>
            `;
            return;
        }

        containerEl.innerHTML = '';
        sessions.forEach(sess => {
            const item = document.createElement('div');
            item.className = 'ai-history-item' + (sess.id === activeId ? ' active' : '');
            
            // 메시지 개수 계산 (사용자 발화 수 기준)
            const userMsgCount = sess.messages ? sess.messages.filter(m => m.role === 'user').length : 0;
            const metaInfo = `${formatRelativeTime(sess.updatedAt)} • 대화 ${userMsgCount}개`;

            item.innerHTML = `
                <div class="ai-history-item-info">
                    <div class="ai-history-item-title" title="${escapeHtml(sess.title)}">${escapeHtml(sess.title)}</div>
                    <div class="ai-history-item-meta">${metaInfo}</div>
                </div>
                <button type="button" class="ai-history-del-btn" title="대화 삭제" data-del-id="${sess.id}">🗑️</button>
            `;

            // 세션 클릭 시 전환
            item.addEventListener('click', (e) => {
                if (e.target.closest('.ai-history-del-btn')) return;
                setActiveSessionId(sess.id);
                if (typeof onSelectSession === 'function') {
                    onSelectSession(sess);
                }
            });

            // 개별 삭제 버튼 핸들러
            const delBtn = item.querySelector('.ai-history-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (deleteSession(sess.id)) {
                        renderHistoryList(containerEl, onSelectSession);
                        if (typeof onSelectSession === 'function') {
                            onSelectSession(getActiveSession());
                        }
                    }
                });
            }

            containerEl.appendChild(item);
        });
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

    /**
     * 메시지 날짜/시간 포맷팅 (예: "11월 2일 오전 4:08")
     */
    function formatMessageDateTime(ts) {
        if (!ts) ts = Date.now();
        const d = new Date(ts);
        if (isNaN(d.getTime())) return '';

        const month = d.getMonth() + 1;
        const date = d.getDate();
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? '오후' : '오전';
        hours = hours % 12;
        hours = hours ? hours : 12;

        return `${month}월 ${date}일 ${ampm} ${hours}:${minutes}`;
    }

    // 전역 네임스페이스 등록
    window.JgAiHistory = {
        loadAllSessions,
        getActiveSessionId,
        setActiveSessionId,
        getActiveSession,
        createNewSession,
        addMessageToActiveSession,
        deleteSession,
        renderHistoryList,
        formatRelativeTime,
        formatMessageDateTime,
        DEFAULT_WELCOME_MSG
    };

})();
