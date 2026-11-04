/**
 * 🤖 JG 포털 로컬 AI 비서 대화 히스토리/세션 관리 엔진 (portal-ai-history.js)
 * - 계정별 격리 SQLite DB 실시간 동기화 + 브라우저 초고속 로컬 캐시
 * - 세션 생성, 복원, 삭제, 제목 자동 추출, 무손실 자동 마이그레이션
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 호환
 */
(function() {
    'use strict';

    const SESSIONS_STORAGE_KEY = 'jg_portal_ai_sessions_v2';
    const LEGACY_STORAGE_KEY = 'jg_portal_ai_sessions_v1';
    const ACTIVE_ID_STORAGE_KEY = 'jg_portal_ai_active_id_v2';

    const DEFAULT_WELCOME_MSG = {
        role: 'assistant',
        content: '안녕하세요! JG 포털 AI 비서(LG EXAONE 4.0)입니다. 🇰🇷<br>궁금한 점이 있으시면 무엇이든 편하게 물어보세요! 😊'
    };

    let activeWelcomeContent = DEFAULT_WELCOME_MSG.content;
    const changeListeners = new Set();
    let isSyncing = false;

    function notifyChange() {
        try {
            window.dispatchEvent(new CustomEvent('jg:ai-history-updated'));
            changeListeners.forEach(fn => { if (typeof fn === 'function') try { fn(); } catch (e) {} });
        } catch (e) {}
    }

    function setCustomWelcomeMessage(rawText) {
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return;
        let f = rawText.trim();
        if (!f.includes('<br>') && !f.includes('<p>')) {
            f = f.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        }
        activeWelcomeContent = f;

        const sessions = loadAllSessions();
        const activeId = getActiveSessionId();
        if (sessions.length > 0) {
            const curSession = sessions.find(s => s.id === activeId) || sessions[0];
            if (curSession?.messages?.length === 1 && curSession.messages[0].role === 'assistant') {
                curSession.messages[0].content = activeWelcomeContent;
                saveAllSessions(sessions);
            }
        }
    }

    function getCustomWelcomeMessage() { return activeWelcomeContent; }

    function loadAllSessions() {
        try {
            let raw = localStorage.getItem(SESSIONS_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
            if (raw && !localStorage.getItem(SESSIONS_STORAGE_KEY)) localStorage.setItem(SESSIONS_STORAGE_KEY, raw);
            return raw ? (JSON.parse(raw) || []) : [];
        } catch (e) {
            console.error('[AI History] 로컬 캐시 세션 로드 오류:', e);
            return [];
        }
    }

    function saveAllSessions(sessions) {
        try { localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions)); }
        catch (e) { console.error('[AI History] 로컬 캐시 세션 저장 오류:', e); }
    }

    function getActiveSessionId() {
        try {
            return sessionStorage.getItem(ACTIVE_ID_STORAGE_KEY) || null;
        } catch (e) {
            return null;
        }
    }
    function setActiveSessionId(id) {
        try {
            if (id) sessionStorage.setItem(ACTIVE_ID_STORAGE_KEY, id);
            else sessionStorage.removeItem(ACTIVE_ID_STORAGE_KEY);
        } catch (e) {}
    }
    function generateSessionId() { return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7); }

    function createNewSession(customTitle) {
        const sessions = loadAllSessions();
        const activeId = getActiveSessionId();
        const curActive = activeId ? sessions.find(s => s.id === activeId) : null;

        // 이미 사용자의 발화가 하나도 없는 빈 '새 대화' 상태라면 중복 생성 없이 기존 빈 세션 유지
        if (curActive && curActive.title === '새 대화' && (!curActive.messages || !curActive.messages.some(m => m.role === 'user'))) {
            setActiveSessionId(curActive.id);
            return curActive;
        }

        const now = Date.now();
        const newSession = {
            id: generateSessionId(),
            title: customTitle || '새 대화',
            createdAt: now,
            updatedAt: now,
            messages: [{ role: 'assistant', content: activeWelcomeContent, timestamp: now }]
        };

        sessions.unshift(newSession);
        if (sessions.length > 50) sessions.length = 50;

        saveAllSessions(sessions);
        setActiveSessionId(newSession.id);

        fetch('/api/ai/history/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ id: newSession.id, title: newSession.title })
        }).catch(err => console.warn('[AI History] 서버 세션 비동기 생성 알림:', err));

        notifyChange();
        return newSession;
    }

    function getActiveSession() {
        const sessions = loadAllSessions();
        const activeId = getActiveSessionId();
        let cur = activeId ? sessions.find(s => s.id === activeId) : null;

        // 활성 세션이 없거나 찾을 수 없으면 과거 대화를 강제로 열지 않고 항상 깨끗한 '새 대화' 시작
        if (!cur) cur = createNewSession();

        if (!cur.messages || cur.messages.length === 0) {
            fetchSessionDetailAsync(cur.id);
        }
        return cur;
    }

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
        if (!session.messages) session.messages = [];
        session.messages.push({ role, content, timestamp: msgTime });
        session.updatedAt = msgTime;

        if (role === 'user' && session.title === '새 대화') {
            const cleanText = content.replace(/<[^>]*>?/gm, '').trim();
            session.title = cleanText.length > 22 ? cleanText.substring(0, 22) + '...' : cleanText;
        }

        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx > 0) {
            sessions.splice(idx, 1);
            sessions.unshift(session);
        }
        saveAllSessions(sessions);

        fetch(`/api/ai/history/sessions/${encodeURIComponent(session.id)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ role, content, timestamp: msgTime })
        }).catch(err => console.warn('[AI History] 서버 메시지 비동기 저장 알림:', err));

        return session;
    }

    function deleteSession(sessionId) {
        let sessions = loadAllSessions();
        const target = sessions.find(s => s.id === sessionId);
        const title = target ? target.title : '선택한 대화';

        if (!confirm(`"${title}" 대화 기록을 완전히 삭제하시겠습니까?`)) return false;

        sessions = sessions.filter(s => s.id !== sessionId);
        saveAllSessions(sessions);

        if (getActiveSessionId() === sessionId) {
            if (sessions.length > 0) setActiveSessionId(sessions[0].id);
            else createNewSession();
        }

        fetch(`/api/ai/history/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            headers: { 'Accept': 'application/json' }
        }).catch(err => console.warn('[AI History] 서버 세션 비동기 삭제 알림:', err));

        notifyChange();
        return true;
    }

    async function updateSessionTitle(sessionId, newTitle) {
        if (!sessionId || !newTitle || typeof newTitle !== 'string') return false;
        const cleanTitle = newTitle.trim().substring(0, 50);
        if (!cleanTitle) return false;

        const sessions = loadAllSessions();
        const target = sessions.find(s => s.id === sessionId);
        if (!target) return false;

        target.title = cleanTitle;
        target.updatedAt = Date.now();
        saveAllSessions(sessions);
        notifyChange();

        try {
            const res = await fetch(`/api/ai/history/sessions/${encodeURIComponent(sessionId)}/title`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ title: cleanTitle })
            });
            return res.ok;
        } catch (err) {
            console.warn('[AI History] 서버 대화명 변경 비동기 알림 실패:', err);
            return false;
        }
    }

    async function fetchSessionDetailAsync(sessionId) {
        if (!sessionId) return null;
        try {
            const res = await fetch(`/api/ai/history/sessions/${encodeURIComponent(sessionId)}`, {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (data.success && data.session) {
                const sessions = loadAllSessions();
                const idx = sessions.findIndex(s => s.id === sessionId);
                if (idx !== -1) {
                    sessions[idx].title = data.session.title || sessions[idx].title;
                    sessions[idx].messages = (data.session.messages && data.session.messages.length > 0)
                        ? data.session.messages
                        : [{ role: 'assistant', content: activeWelcomeContent, timestamp: data.session.createdAt }];
                    saveAllSessions(sessions);
                    notifyChange();
                    return sessions[idx];
                }
            }
        } catch (e) {
            console.warn('[AI History] 세션 상세 비동기 로드 실패:', e);
        }
        return null;
    }

    async function syncInitialServerData() {
        if (isSyncing) return;
        isSyncing = true;
        try {
            const res = await fetch('/api/ai/history/sessions', { headers: { 'Accept': 'application/json' } });
            if (!res.ok) { isSyncing = false; return; }

            const data = await res.json();
            if (data.success && Array.isArray(data.sessions)) {
                const serverSessions = data.sessions;
                const localSessions = loadAllSessions();

                if (serverSessions.length === 0 && localSessions.length > 0) {
                    if (localSessions.some(s => s.messages && s.messages.some(m => m.role === 'user'))) {
                        await fetch('/api/ai/history/sync', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                            body: JSON.stringify({ sessions: localSessions })
                        }).catch(() => {});
                    }
                } else if (serverSessions.length > 0) {
                    const mergedSessions = serverSessions.map(srv => {
                        const local = localSessions.find(l => l.id === srv.id);
                        return {
                            id: srv.id,
                            title: srv.title,
                            createdAt: srv.createdAt,
                            updatedAt: srv.updatedAt,
                            messageCount: srv.messageCount || 0,
                            messages: (local?.messages?.length > 0) ? local.messages : null
                        };
                    });
                    // 로컬 전용 신규 세션(새 대화 등) 보존
                    localSessions.forEach(loc => {
                        if (!mergedSessions.some(s => s.id === loc.id)) {
                            mergedSessions.unshift(loc);
                        }
                    });
                    saveAllSessions(mergedSessions);

                    const activeId = getActiveSessionId();
                    // 사용자가 현재 보고 있는 세션이 서버 목록에 있는 경우에만 상세 동기화
                    if (activeId && mergedSessions.some(s => s.id === activeId)) {
                        const cur = mergedSessions.find(s => s.id === activeId);
                        if (!cur?.messages?.length) await fetchSessionDetailAsync(activeId);
                        else notifyChange();
                    } else {
                        notifyChange();
                    }
                }
            }
        } catch (e) {
            console.warn('[AI History] 서버 동기화 예외:', e);
        } finally {
            isSyncing = false;
        }
    }

    function formatRelativeTime(ts) {
        if (!ts) return '';
        const diffSec = Math.floor((Date.now() - ts) / 1000);
        if (diffSec < 60) return '방금 전';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}분 전`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour}시간 전`;
        const diffDay = Math.floor(diffHour / 24);
        if (diffDay === 1) return '어제';
        if (diffDay < 7) return `${diffDay}일 전`;
        const d = new Date(ts);
        return `${d.getMonth() + 1}월 ${d.getDate()}일`;
    }

    function formatMessageDateTime(ts) {
        const d = new Date(ts || Date.now());
        if (isNaN(d.getTime())) return '';
        let hours = d.getHours();
        const ampm = hours >= 12 ? '오후' : '오전';
        hours = hours % 12 || 12;
        return `${d.getMonth() + 1}월 ${d.getDate()}일 ${ampm} ${hours}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function renderHistoryList(containerEl, onSelectSession) {
        if (!containerEl) return;
        const sessions = loadAllSessions();
        const activeId = getActiveSessionId();
        const displaySessions = sessions.filter(s => {
            const hasUser = s.messages ? s.messages.some(m => m.role === 'user') : (s.messageCount > 0);
            return hasUser || s.id === activeId;
        });

        if (displaySessions.length === 0) {
            containerEl.innerHTML = `<div class="ai-history-empty"><div class="ai-history-empty-icon">💬</div><div class="ai-history-empty-text">저장된 대화 기록이 없습니다.<br>AI 비서에게 새로운 질문을 해보세요!</div></div>`;
            return;
        }

        containerEl.innerHTML = '';
        displaySessions.forEach(sess => {
            const item = document.createElement('div');
            item.className = 'ai-history-item' + (sess.id === activeId ? ' active' : '');
            const count = sess.messages ? sess.messages.filter(m => m.role === 'user').length : (sess.messageCount || 0);
            const metaInfo = `${formatRelativeTime(sess.updatedAt)} • 대화 ${count}개`;

            item.innerHTML = `
                <div class="ai-history-item-info">
                    <div class="ai-history-item-title" title="${escapeHtml(sess.title)}">${escapeHtml(sess.title)}</div>
                    <div class="ai-history-item-meta">${metaInfo}</div>
                </div>
                <button type="button" class="ai-history-del-btn" title="대화 삭제" data-del-id="${sess.id}">🗑️</button>
            `;

            item.addEventListener('click', async (e) => {
                if (e.target.closest('.ai-history-del-btn')) return;
                setActiveSessionId(sess.id);
                if (!sess.messages?.length) await fetchSessionDetailAsync(sess.id);
                if (typeof onSelectSession === 'function') onSelectSession(sess);
            });

            const delBtn = item.querySelector('.ai-history-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (deleteSession(sess.id)) {
                        renderHistoryList(containerEl, onSelectSession);
                        if (typeof onSelectSession === 'function') onSelectSession(getActiveSession());
                    }
                });
            }
            containerEl.appendChild(item);
        });
    }

    function escapeHtml(str) {
        return str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '';
    }

    function onHistoryChange(cb) { if (typeof cb === 'function') changeListeners.add(cb); }

    window.JgAiHistory = {
        loadAllSessions,
        getActiveSessionId,
        setActiveSessionId,
        getActiveSession,
        createNewSession,
        addMessageToActiveSession,
        deleteSession,
        updateSessionTitle,
        fetchSessionDetailAsync,
        syncInitialServerData,
        onHistoryChange,
        renderHistoryList,
        formatRelativeTime,
        formatMessageDateTime,
        setCustomWelcomeMessage,
        getCustomWelcomeMessage,
        DEFAULT_WELCOME_MSG
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncInitialServerData);
    else syncInitialServerData();
})();
