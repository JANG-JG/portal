/**
 * ==============================================================================
 * JG 포털: 가족 위키 & 데일리 루틴/D-Day 대시보드 위젯 엔진 (portal-wiki.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 준수 (약 180줄)
 * [규칙 2] 100% 한국어 및 일상 친화적 용어
 * [규칙 6] 모바일 퍼스트 360px 무넘침 보장
 * ==============================================================================
 */

let portalWikiData = null;

// 1. 위젯 데이터 초기화 및 비동기 수신
async function initFamilyWikiWidget() {
    const ddayContainer = document.getElementById('portalWidgetDdayList');
    const todoContainer = document.getElementById('portalWidgetTodoList');
    if (!ddayContainer && !todoContainer) return;

    try {
        const res = await fetch('/api/wiki/dashboard-summary');
        if (!res.ok) throw new Error('서버 응답 오류');
        const data = await res.json();
        if (data && data.success) {
            portalWikiData = data;
            renderPortalWikiWidget(data);
        }
    } catch (e) {
        console.warn('위키 요약 데이터 수신 실패:', e);
        if (ddayContainer) ddayContainer.innerHTML = '<div class="portal-wiki-empty">보조서버 연결 대기 중</div>';
        if (todoContainer) todoContainer.innerHTML = '<div class="portal-wiki-empty">보조서버 연결 대기 중</div>';
    }
}

// 2. 위젯 UI 렌더링
function renderPortalWikiWidget(data) {
    // 2-1. D-Day 소모품 주기 바인딩
    const ddayContainer = document.getElementById('portalWidgetDdayList');
    const ddayCount = document.getElementById('portalWidgetDdayCount');

    if (ddayContainer && data.dday) {
        if (ddayCount) {
            ddayCount.textContent = `${data.dday.length}개 임박`;
        }

        if (data.dday.length === 0) {
            ddayContainer.innerHTML = '<div class="portal-wiki-empty">현재 예정된 D-Day가 없습니다.</div>';
        } else {
            ddayContainer.innerHTML = data.dday.map(item => {
                const info = item.dday_info || {};
                const isImminent = info.is_imminent;
                const badgeStyle = isImminent
                    ? 'background:rgba(244,63,94,0.18); color:#f43f5e; border:1px solid rgba(244,63,94,0.4); font-weight:700;'
                    : 'background:rgba(6,182,212,0.15); color:#22d3ee; border:1px solid rgba(6,182,212,0.3);';

                return `
                <div class="portal-dday-chip" onclick="handlePortalDdayClick(${item.id}, '${escapeHtml(item.title)}', ${item.cycle_days})" title="클릭하여 완료 및 주기 갱신">
                    <div class="portal-dday-badge font-mono" style="${badgeStyle}">
                        ${info.text || 'D-Day'}
                    </div>
                    <div class="portal-dday-info">
                        <div class="portal-dday-title truncate">${escapeHtml(item.title)}</div>
                        <div class="portal-dday-sub">
                            <span>${item.target_date}</span>
                            ${item.cycle_days > 0 ? `<span style="color:#10b981;">(${item.cycle_days}일 주기)</span>` : ''}
                        </div>
                    </div>
                    <button type="button" class="portal-dday-check-btn" title="완료 처리">✓</button>
                </div>
                `;
            }).join('');
        }
    }

    // 2-2. 오늘 가족 루틴 및 장보기 체크리스트 바인딩
    const todoContainer = document.getElementById('portalWidgetTodoList');
    const routineStats = document.getElementById('portalWidgetRoutineStats');
    const progressBar = document.getElementById('portalWidgetProgressBar');

    if (data.routine_stats && routineStats) {
        const stats = data.routine_stats;
        routineStats.textContent = `${stats.percent}% (${stats.completed}/${stats.total})`;
        if (progressBar) {
            progressBar.style.width = `${stats.percent}%`;
        }
    }

    if (todoContainer && data.todos) {
        if (data.todos.length === 0) {
            todoContainer.innerHTML = '<div class="portal-wiki-empty">오늘 등록된 루틴 및 할 일이 없습니다.</div>';
        } else {
            todoContainer.innerHTML = data.todos.map(todo => {
                const isRoutine = todo.is_routine === 1;
                const isDone = todo.is_completed === 1;
                return `
                <div class="portal-todo-item ${isDone ? 'done' : ''}" id="portal-todo-${todo.id}">
                    <label class="portal-todo-label">
                        <input type="checkbox" ${isDone ? 'checked' : ''} onchange="togglePortalTodo(${todo.id})" class="portal-todo-cb">
                        <span class="portal-todo-text ${isDone ? 'line-through text-muted' : ''}">${escapeHtml(todo.content)}</span>
                    </label>
                    <span class="portal-todo-tag ${isRoutine ? 'tag-routine' : 'tag-todo'}">
                        ${isRoutine ? '루틴' : '장보기'}
                    </span>
                </div>
                `;
            }).join('');
        }
    }
}

// 3. 할 일 완료 상태 토글 (낙관적 UI 적용)
async function togglePortalTodo(id) {
    const row = document.getElementById(`portal-todo-${id}`);
    const text = row ? row.querySelector('.portal-todo-text') : null;
    const cb = row ? row.querySelector('.portal-todo-cb') : null;
    const currentChecked = cb ? cb.checked : false;

    // 즉시 UI 반영
    if (text) {
        if (currentChecked) {
            text.classList.add('line-through', 'text-muted');
        } else {
            text.classList.remove('line-through', 'text-muted');
        }
    }

    try {
        const res = await fetch(`/api/wiki/todo/toggle/${id}`, { method: 'POST' });
        const resData = await res.json();
        if (!resData.success) {
            // 실패 시 롤백
            if (cb) cb.checked = !currentChecked;
            if (text) text.classList.toggle('line-through');
        } else {
            // 통계 갱신
            initFamilyWikiWidget();
        }
    } catch (e) {
        console.error('할 일 토글 오류:', e);
        if (cb) cb.checked = !currentChecked;
    }
}

// 4. D-Day 항목 클릭 완료 처리
async function handlePortalDdayClick(id, title, cycleDays) {
    const confirmMsg = cycleDays > 0
        ? `[${title}]\n소모품 교체를 완료하셨습니까?\n완료 시 다음 주기(${cycleDays}일 후)로 자동 갱신됩니다.`
        : `[${title}]\n해당 일정을 완료 처리하시겠습니까?`;

    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch(`/api/wiki/dday/complete/${id}`, { method: 'POST' });
        const resData = await res.json();
        if (resData.success) {
            if (typeof showToast === 'function') {
                showToast(`✅ ${resData.message || '완료 처리되었습니다.'}`);
            } else {
                alert(resData.message || '완료 처리되었습니다.');
            }
            initFamilyWikiWidget();
        }
    } catch (e) {
        alert('D-Day 완료 처리 중 오류가 발생했습니다.');
    }
}

// 5. 빠른 할 일 인라인 추가
async function handlePortalQuickTodo(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('portalWidgetTodoInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    try {
        const res = await fetch('/api/wiki/todo/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content, is_routine: 0 })
        });
        const resData = await res.json();
        if (resData.success) {
            input.value = '';
            initFamilyWikiWidget();
        }
    } catch (e) {
        console.error('할 일 추가 오류:', e);
    }
}

// 6. 특수문자 이스케이프 헬퍼
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// DOM 준비 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    initFamilyWikiWidget();
    // 60초 주기 자동 리프레시
    setInterval(initFamilyWikiWidget, 60000);
});
