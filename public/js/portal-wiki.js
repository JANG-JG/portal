/**
 * ==============================================================================
 * JG 포털: 가족 위키 & 데일리 루틴/D-Day 대시보드 위젯 엔진 (portal-wiki.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 준수 (약 200줄)
 * [규칙 2] 100% 한국어 및 일상 친화적 용어
 * [규칙 6] 모바일 퍼스트 360px 무넘침 보장 (40px+ 터치 타겟)
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
    // -------------------------------------------------------------------------
    // 2-1. D-Day 소모품 주기: [D-7 이내 임박 항목] 집중 렌더링
    // -------------------------------------------------------------------------
    const ddayContainer = document.getElementById('portalWidgetDdayList');
    const ddayCount = document.getElementById('portalWidgetDdayCount');

    if (ddayContainer && data.dday) {
        // D-7 이내이거나 이미 날짜 지난(overdue) 임박 항목 필터링
        const imminentItems = data.dday.filter(item => {
            const info = item.dday_info || {};
            return info.is_imminent === true || (info.days_diff !== undefined && info.days_diff <= 7);
        });

        if (ddayCount) {
            if (imminentItems.length > 0) {
                ddayCount.textContent = `${imminentItems.length}건 임박`;
                ddayCount.className = 'portal-imminent-count count-alert';
            } else {
                ddayCount.textContent = '임박 일정 없음';
                ddayCount.className = 'portal-imminent-count count-normal';
            }
        }

        if (imminentItems.length > 0) {
            // 임박한 항목들 큼직하고 직관적인 가로 칩 카드로 표시
            ddayContainer.innerHTML = imminentItems.map(item => {
                const info = item.dday_info || {};
                const isOverdue = info.is_overdue;
                const isToday = info.days_diff === 0;
                
                let badgeClass = 'badge-imminent';
                let icon = '⏳';
                if (isOverdue) {
                    badgeClass = 'badge-overdue';
                    icon = '🚨';
                } else if (isToday) {
                    badgeClass = 'badge-today';
                    icon = '🔥';
                }

                return `
                <div class="portal-imminent-chip ${badgeClass}" onclick="handlePortalDdayClick(${item.id}, '${escapeHtml(item.title)}', ${item.cycle_days})" title="클릭하여 교체 완료 및 다음 주기 갱신">
                    <span class="portal-imminent-chip-badge font-mono">
                        ${icon} ${info.text || 'D-Day'}
                    </span>
                    <span class="portal-imminent-chip-title truncate">${escapeHtml(item.title)}</span>
                    ${item.cycle_days > 0 ? `<span class="portal-imminent-cycle font-mono">${item.cycle_days}일 주기</span>` : ''}
                    <button type="button" class="portal-imminent-action-btn" title="완료 처리">✓</button>
                </div>
                `;
            }).join('');
        } else {
            // 임박한 항목이 없을 때: 가장 가까운 일정 1개 안내 및 여유 상태 표시
            const nextItem = data.dday[0];
            const nextText = nextItem 
                ? `(다음 교체: <b>${escapeHtml(nextItem.title)}</b> ${nextItem.dday_info ? nextItem.dday_info.text : ''})`
                : '';

            ddayContainer.innerHTML = `
            <div class="portal-imminent-safe-bar">
                <span>✨ 7일 이내 예정된 긴급 소모품 교체 일정이 없습니다.</span>
                ${nextText ? `<span class="portal-safe-sub">${nextText}</span>` : ''}
            </div>
            `;
        }
    }

    // -------------------------------------------------------------------------
    // 2-2. 메인: 오늘 가족 루틴 & 장보기 체크리스트 (전면 집중)
    // -------------------------------------------------------------------------
    const todoContainer = document.getElementById('portalWidgetTodoList');
    const routineStats = document.getElementById('portalWidgetRoutineStats');
    const progressBar = document.getElementById('portalWidgetProgressBar');
    const ringBar = document.getElementById('portalRingProgress');
    const ringDesc = document.getElementById('homarrRingDesc');

    if (data.routine_stats) {
        const stats = data.routine_stats;
        const percent = Math.min(Math.max(stats.percent || 0, 0), 100);

        if (routineStats) {
            routineStats.textContent = `${percent}%`;
        }
        if (ringDesc) {
            ringDesc.textContent = `${stats.completed}/${stats.total}개 완료됨`;
        }
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
        if (ringBar) {
            // 원형 둘레 C = 2 * PI * 40 ~= 251.2
            const offset = 251.2 * (1 - percent / 100);
            ringBar.style.strokeDashoffset = offset;
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
                <div class="portal-todo-row ${isDone ? 'is-completed' : ''}" id="portal-todo-${todo.id}">
                    <label class="portal-todo-touch-label">
                        <input type="checkbox" ${isDone ? 'checked' : ''} onchange="togglePortalTodo(${todo.id})" class="portal-todo-check-input">
                        <span class="portal-todo-text ${isDone ? 'line-through text-muted' : ''}">${escapeHtml(todo.content)}</span>
                    </label>
                    <span class="portal-todo-type-badge ${isRoutine ? 'type-routine' : 'type-todo'}">
                        ${isRoutine ? '매일 루틴' : '장보기'}
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
    const cb = row ? row.querySelector('.portal-todo-check-input') : null;
    const currentChecked = cb ? cb.checked : false;

    // 즉시 UI 반영
    if (row && text) {
        if (currentChecked) {
            row.classList.add('is-completed');
            text.classList.add('line-through', 'text-muted');
        } else {
            row.classList.remove('is-completed');
            text.classList.remove('line-through', 'text-muted');
        }
    }

    try {
        const res = await fetch(`/api/wiki/todo/toggle/${id}`, { method: 'POST' });
        const resData = await res.json();
        if (!resData.success) {
            // 실패 시 롤백
            if (cb) cb.checked = !currentChecked;
            if (row) row.classList.toggle('is-completed');
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
        ? `[${title}]\n소모품 교체를 완료하셨습니까?\n확인 시 다음 주기(${cycleDays}일 후)로 자동 갱신됩니다.`
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
