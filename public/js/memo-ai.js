/**
 * 🤖 JG 포털 메모장 AI 지식/루틴 연동 모듈 (memo-ai.js)
 * - 로컬 Ollama(LG EXAONE 4.0) 기반 메모 ➔ 위키 정돈, 루틴 추출, 3줄 요약
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 * - [규칙 6] 모바일 360px 터치 및 레이아웃 최적화
 */

// 전역 상태
let activeAiMemoData = null;

/**
 * 1. AI 위키 정리 실행 (특정 메모 ID 또는 현재 편집 중인 메모)
 */
async function triggerMemoToWiki(memoId = null) {
    let title = '';
    let content = '';

    if (memoId) {
        const memo = (allMemosCache || []).find(m => m.id === memoId);
        if (!memo) {
            showToast('메모를 찾을 수 없습니다.', '⚠️');
            return;
        }
        title = memo.title || '';
        content = memo.content || '';
    } else {
        const titleInput = document.getElementById('editMemoTitle');
        title = titleInput ? titleInput.value.trim() : '';
        content = editMemoQuill ? editMemoQuill.root.innerHTML : '';
    }

    // 텍스트 검증
    const plainText = content.replace(/<[^>]+>/g, ' ').trim();
    if (!plainText || plainText.length < 5) {
        showToast('위키로 정리할 내용이 부족합니다.', '⚠️');
        return;
    }

    openAiLoadingModal('🤖 LG EXAONE AI가 메모를 가족 위키 문서로 정돈하고 있습니다...');

    try {
        const res = await fetch('/api/ai/memo-to-wiki', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content })
        });
        const data = await res.json();
        closeAiLoadingModal();

        if (data.success) {
            openWikiResultModal(data);
        } else {
            showToast(data.message || '위키 정리 실패', '❌');
        }
    } catch (err) {
        closeAiLoadingModal();
        console.error('[Memo-to-Wiki] 오류:', err);
        showToast('AI 비서 연결 실패 (Ollama 상태 확인)', '❌');
    }
}

/**
 * 2. 메모 속 루틴 및 할 일 추출 실행
 */
async function triggerExtractRoutine(memoId = null) {
    let title = '';
    let content = '';

    if (memoId) {
        const memo = (allMemosCache || []).find(m => m.id === memoId);
        if (!memo) {
            showToast('메모를 찾을 수 없습니다.', '⚠️');
            return;
        }
        title = memo.title || '';
        content = memo.content || '';
    } else {
        const titleInput = document.getElementById('editMemoTitle');
        title = titleInput ? titleInput.value.trim() : '';
        content = editMemoQuill ? editMemoQuill.root.innerHTML : '';
    }

    const plainText = content.replace(/<[^>]+>/g, ' ').trim();
    if (!plainText || plainText.length < 5) {
        showToast('분석할 메모 내용이 부족합니다.', '⚠️');
        return;
    }

    openAiLoadingModal('⏱️ 메모 속 반복 루틴과 할 일을 분석 중입니다...');

    try {
        const res = await fetch('/api/ai/extract-routine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content })
        });
        const data = await res.json();
        closeAiLoadingModal();

        if (data.success && data.data) {
            openRoutineResultModal(data.data, title);
        } else {
            showToast(data.message || '루틴 분석 실패', '❌');
        }
    } catch (err) {
        closeAiLoadingModal();
        console.error('[Extract-Routine] 오류:', err);
        showToast('AI 비서 연결 실패', '❌');
    }
}

/**
 * 3. 3줄 핵심 요약 실행
 */
async function triggerSummarizeMemo(memoId = null) {
    let text = '';
    if (memoId) {
        const memo = (allMemosCache || []).find(m => m.id === memoId);
        if (!memo) return;
        text = (memo.title ? `${memo.title}\n` : '') + (memo.content || '');
    } else {
        const title = document.getElementById('editMemoTitle')?.value || '';
        const body = editMemoQuill ? editMemoQuill.getText() : '';
        text = `${title}\n${body}`;
    }

    const clean = text.replace(/<[^>]+>/g, ' ').trim();
    if (clean.length < 15) {
        showToast('요약할 메모가 너무 짧습니다.', '⚠️');
        return;
    }

    openAiLoadingModal('📑 3줄 핵심 요약을 생성 중입니다...');

    try {
        const res = await fetch('/api/ai/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: clean, maxLines: 3 })
        });
        const data = await res.json();
        closeAiLoadingModal();

        if (data.success && data.summary) {
            openSummaryResultModal(data.summary);
        } else {
            showToast(data.message || '요약 실패', '❌');
        }
    } catch (err) {
        closeAiLoadingModal();
        console.error('[Summarize] 오류:', err);
        showToast('AI 비서 연결 실패', '❌');
    }
}

/**
 * AI 로딩 모달 제어
 */
function openAiLoadingModal(msg) {
    let el = document.getElementById('memoAiLoadingModal');
    if (!el) {
        el = document.createElement('div');
        el.id = 'memoAiLoadingModal';
        el.className = 'memo-ai-modal-overlay';
        el.innerHTML = `
            <div class="memo-ai-loading-box">
                <div class="memo-ai-spinner"></div>
                <div id="memoAiLoadingMsg" class="memo-ai-loading-text">${escapeHtml(msg)}</div>
                <div class="memo-ai-loading-sub">로컬 PC의 LG EXAONE 4.0 모델이 처리 중입니다</div>
            </div>
        `;
        document.body.appendChild(el);
    } else {
        document.getElementById('memoAiLoadingMsg').textContent = msg;
    }
    el.style.display = 'flex';
}

function closeAiLoadingModal() {
    const el = document.getElementById('memoAiLoadingModal');
    if (el) el.style.display = 'none';
}

/**
 * 위키 정리 결과 모달
 */
function openWikiResultModal(aiData) {
    activeAiMemoData = aiData;
    let modal = document.getElementById('memoWikiResultModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'memoWikiResultModal';
        modal.className = 'memo-ai-modal-overlay';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="memo-ai-modal-card">
            <div class="memo-ai-modal-header">
                <div class="memo-ai-modal-title">
                    <span>📚</span>
                    <span>위키 문서로 정리 완료</span>
                </div>
                <button type="button" class="memo-modal-close-btn" onclick="closeWikiResultModal()">✕</button>
            </div>
            <div class="memo-ai-modal-body">
                <p class="memo-ai-notice">LG EXAONE이 메모 내용을 바탕으로 가족 위키용 마크다운 문서를 작성했습니다. 확인 후 [가족 위키에 등록]을 누르세요.</p>
                <div class="memo-ai-field-group">
                    <label class="memo-ai-field-label">카테고리</label>
                    <input type="text" id="aiWikiCategory" class="memo-ai-input" value="${escapeHtml(aiData.category || '생활')}">
                </div>
                <div class="memo-ai-field-group">
                    <label class="memo-ai-field-label">문서 제목</label>
                    <input type="text" id="aiWikiTitle" class="memo-ai-input" value="${escapeHtml(aiData.title || '')}">
                </div>
                <div class="memo-ai-field-group">
                    <label class="memo-ai-field-label">마크다운 본문 (수정 가능)</label>
                    <textarea id="aiWikiContent" class="memo-ai-textarea" rows="8">${escapeHtml(aiData.content_md || '')}</textarea>
                </div>
            </div>
            <div class="memo-ai-modal-footer">
                <button type="button" class="memo-modal-btn cancel" onclick="closeWikiResultModal()">닫기</button>
                <button type="button" id="btnPublishToWiki" class="memo-modal-btn save" style="background:#059669; color:#fff;" onclick="publishAiToWiki()">
                    <span>🚀 가족 위키에 바로 등록</span>
                </button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function closeWikiResultModal() {
    const m = document.getElementById('memoWikiResultModal');
    if (m) m.style.display = 'none';
}

/**
 * 위키에 실제로 문서 등록 API 호출
 */
async function publishAiToWiki() {
    const category = document.getElementById('aiWikiCategory')?.value.trim() || '생활';
    const title = document.getElementById('aiWikiTitle')?.value.trim();
    const content_md = document.getElementById('aiWikiContent')?.value.trim();

    if (!title || !content_md) {
        showToast('제목과 본문을 모두 입력해 주세요.', '⚠️');
        return;
    }

    const btn = document.getElementById('btnPublishToWiki');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '위키 등록 중...';
    }

    try {
        const res = await fetch('/api/wiki/pages/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, title, content_md })
        });
        const data = await res.json();

        if (data.success) {
            closeWikiResultModal();
            showToast('가족 위키에 문서가 등록되었습니다! ✅', '📚');
            // 등록 성공 모달
            setTimeout(() => {
                if (confirm(`'${title}' 문서가 등록되었습니다!\n위키에서 바로 확인하시겠습니까?`)) {
                    window.open(data.view_url || '/wiki', '_blank');
                }
            }, 300);
        } else {
            showToast(data.message || '위키 등록 실패', '❌');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🚀 가족 위키에 바로 등록';
            }
        }
    } catch (err) {
        console.error('[Publish to Wiki] 오류:', err);
        showToast('위키 서버 통신 실패', '❌');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 가족 위키에 바로 등록';
        }
    }
}

/**
 * 루틴 및 할 일 추출 결과 모달
 */
function openRoutineResultModal(routineData, originalTitle) {
    let modal = document.getElementById('memoRoutineResultModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'memoRoutineResultModal';
        modal.className = 'memo-ai-modal-overlay';
        document.body.appendChild(modal);
    }

    const hasRoutine = routineData.hasRoutine;
    const routineTitle = routineData.routineTitle || originalTitle || '루틴 항목';
    const cycleText = routineData.cycleText || '주기 미정';
    const targetDate = routineData.targetDate || new Date().toISOString().slice(0, 10);
    const todoText = routineData.todoText || routineTitle;

    modal.innerHTML = `
        <div class="memo-ai-modal-card">
            <div class="memo-ai-modal-header">
                <div class="memo-ai-modal-title">
                    <span>⏱️</span>
                    <span>감지된 루틴 & 일정</span>
                </div>
                <button type="button" class="memo-modal-close-btn" onclick="closeRoutineResultModal()">✕</button>
            </div>
            <div class="memo-ai-modal-body">
                <div class="memo-ai-summary-badge">💡 ${escapeHtml(routineData.summary || '일정 및 루틴이 감지되었습니다.')}</div>

                <div class="memo-ai-routine-card">
                    <div class="memo-ai-routine-row">
                        <span class="memo-ai-routine-tag ${hasRoutine ? 'routine' : 'event'}">${hasRoutine ? '🔁 반복 루틴' : '📌 일반 일정'}</span>
                        <strong class="memo-ai-routine-title">${escapeHtml(routineTitle)}</strong>
                    </div>
                    <div class="memo-ai-routine-details">
                        ${hasRoutine ? `<div><span>반복 주기:</span> <strong>${escapeHtml(cycleText)}</strong></div>` : ''}
                        <div><span>예정 일자:</span> <strong>${escapeHtml(targetDate)}</strong></div>
                        ${routineData.hasTodo ? `<div><span>할 일 내용:</span> <strong>${escapeHtml(todoText)}</strong></div>` : ''}
                    </div>
                </div>

                <div class="memo-ai-action-buttons">
                    <button type="button" class="memo-ai-action-btn cal" onclick="registerRoutineToCalendar('${escapeHtml(routineTitle)}', '${escapeHtml(targetDate)}', '${escapeHtml(cycleText)}')">
                        <span>📅</span>
                        <span>포털 캘린더 일정으로 등록</span>
                    </button>
                    <button type="button" class="memo-ai-action-btn wiki" onclick="registerRoutineToWikiTodo('${escapeHtml(todoText)}', ${hasRoutine ? 1 : 0})">
                        <span>✅</span>
                        <span>가족 위키 할 일/루틴으로 등록</span>
                    </button>
                </div>
            </div>
            <div class="memo-ai-modal-footer">
                <button type="button" class="memo-modal-btn cancel" onclick="closeRoutineResultModal()">닫기</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function closeRoutineResultModal() {
    const m = document.getElementById('memoRoutineResultModal');
    if (m) m.style.display = 'none';
}

/**
 * 포털 캘린더에 일정 등록 API 호출
 */
async function registerRoutineToCalendar(title, eventDate, memo) {
    try {
        const res = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                event_date: eventDate,
                event_time: '09:00',
                category: '생활',
                color: '#6366f1',
                memo: `[메모장 AI 루틴 추출] ${memo || ''}`,
                is_all_day: 1,
                is_family: 1
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('포털 캘린더에 일정이 등록되었습니다! 📅', '✅');
            closeRoutineResultModal();
        } else {
            showToast(data.message || '캘린더 등록 실패', '❌');
        }
    } catch (err) {
        console.error('[Calendar Register] 오류:', err);
        showToast('캘린더 등록 중 오류 발생', '❌');
    }
}

/**
 * 가족 위키 Todo/루틴에 등록 API 호출
 */
async function registerRoutineToWikiTodo(content, isRoutine) {
    try {
        const res = await fetch('/api/wiki/todo/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                is_routine: isRoutine ? 1 : 0,
                routine_days: isRoutine ? '0,1,2,3,4,5,6' : '',
                assignee: '전체'
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('가족 위키 할 일에 등록되었습니다! ✅', '📋');
            closeRoutineResultModal();
        } else {
            showToast(data.message || '위키 할 일 등록 실패', '❌');
        }
    } catch (err) {
        console.error('[Wiki Todo Register] 오류:', err);
        showToast('위키 할 일 등록 중 오류 발생', '❌');
    }
}

/**
 * 3줄 요약 결과 모달
 */
function openSummaryResultModal(summaryText) {
    let modal = document.getElementById('memoSummaryResultModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'memoSummaryResultModal';
        modal.className = 'memo-ai-modal-overlay';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="memo-ai-modal-card">
            <div class="memo-ai-modal-header">
                <div class="memo-ai-modal-title">
                    <span>📑</span>
                    <span>3줄 핵심 요약</span>
                </div>
                <button type="button" class="memo-modal-close-btn" onclick="closeSummaryResultModal()">✕</button>
            </div>
            <div class="memo-ai-modal-body">
                <div class="memo-ai-summary-box">
                    ${escapeHtml(summaryText).replace(/\n/g, '<br>')}
                </div>
            </div>
            <div class="memo-ai-modal-footer">
                <button type="button" class="memo-modal-btn cancel" onclick="copySummaryText('${escapeHtml(summaryText)}')">📋 요약 복사</button>
                <button type="button" class="memo-modal-btn save" onclick="closeSummaryResultModal()">확인</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function closeSummaryResultModal() {
    const m = document.getElementById('memoSummaryResultModal');
    if (m) m.style.display = 'none';
}

function copySummaryText(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('요약문이 클립보드에 복사되었습니다! 📋', '✅');
    }).catch(() => {
        showToast('복사 실패', '⚠️');
    });
}

/**
 * 카드에서 직접 AI 도구 메뉴 오픈 (원클릭 액션 시트)
 */
function openMemoAiQuickMenu(event, memoId) {
    if (event) event.stopPropagation();
    let modal = document.getElementById('memoAiQuickMenuModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'memoAiQuickMenuModal';
        modal.className = 'memo-ai-modal-overlay';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="memo-ai-modal-card" style="max-width: 340px;">
            <div class="memo-ai-modal-header">
                <div class="memo-ai-modal-title"><span>🤖</span><span>AI 스마트 도구</span></div>
                <button type="button" class="memo-modal-close-btn" onclick="document.getElementById('memoAiQuickMenuModal').style.display='none'">✕</button>
            </div>
            <div class="memo-ai-modal-body" style="padding: 14px; gap: 8px;">
                <button type="button" class="memo-ai-action-btn wiki" onclick="document.getElementById('memoAiQuickMenuModal').style.display='none'; triggerMemoToWiki(${memoId});">
                    <span>📚</span><span>위키 문서로 정리</span>
                </button>
                <button type="button" class="memo-ai-action-btn cal" onclick="document.getElementById('memoAiQuickMenuModal').style.display='none'; triggerExtractRoutine(${memoId});">
                    <span>⏱️</span><span>루틴/일정 추출</span>
                </button>
                <button type="button" class="memo-ai-action-btn" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1;" onclick="document.getElementById('memoAiQuickMenuModal').style.display='none'; triggerSummarizeMemo(${memoId});">
                    <span>📑</span><span>3줄 핵심 요약</span>
                </button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

