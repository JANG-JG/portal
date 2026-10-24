// 🛡️ XSS 방어 살균 함수 (Allowlist 기반 DOMParser 살균기)
function sanitizeMemoHtml(dirty) {
    if (!dirty) return '';
    const allowedTags = new Set(['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'blockquote', 'code', 'pre']);
    const allowedAttrs = new Set(['href', 'target', 'rel', 'class', 'data-list', 'style']);
    if (window.DOMPurify) {
        return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: Array.from(allowedTags), ALLOWED_ATTR: Array.from(allowedAttrs) });
    }
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(dirty, 'text/html');
        const allElements = Array.from(doc.body.querySelectorAll('*'));
        for (const el of allElements) {
            const tag = el.tagName.toLowerCase();
            if (!allowedTags.has(tag)) {
                el.remove();
                continue;
            }
            for (let i = el.attributes.length - 1; i >= 0; i--) {
                const attr = el.attributes[i];
                const name = attr.name.toLowerCase();
                const val = attr.value || '';
                if (!allowedAttrs.has(name)) {
                    el.removeAttribute(attr.name);
                } else if (name === 'href') {
                    if (!/^(https?:\/\/|mailto:|\/)/i.test(val.trim()) || val.trim().startsWith('//')) {
                        el.removeAttribute(attr.name);
                    }
                } else if (name === 'style') {
                    if (/expression|url\s*\(|javascript:/i.test(val)) {
                        el.removeAttribute(attr.name);
                    }
                }
            }
        }
        return doc.body.innerHTML;
    } catch (e) { return escapeHtml(dirty).replace(/\n/g, '<br>'); }
}
// 전역 상태 관리
let memoQuill = null;
let editMemoQuill = null;
let allMemosFullList = [];
let allMemosCache = [];
let currentMemoCategory = 'all';
let currentMemoSearch = '';
let memoSearchTimeout = null;
let currentViewMode = localStorage.getItem('memo_view_mode') || 'grid';
const CATEGORY_MAP = {
    'idea': { label: '💡 아이디어', bg: '#fef3c7', color: '#b45309', defaultColor: '#fef3c7' },
    'todo': { label: '✅ 할 일', bg: '#dbeafe', color: '#1d4ed8', defaultColor: '#e0f2fe' },
    'memo': { label: '📝 일반', bg: '#f1f5f9', color: '#334155', defaultColor: '#e0f2fe' },
    'important': { label: '⭐ 중요', bg: '#fee2e2', color: '#b91c1c', defaultColor: '#fee2e2' },
    'scrap': { label: '📰 뉴스스크랩', bg: '#dcfce7', color: '#047857', defaultColor: '#dcfce7' },
    'news': { label: '📰 뉴스스크랩', bg: '#dcfce7', color: '#047857', defaultColor: '#dcfce7' }
};
// 가독성 중심 페이퍼 화이트 & 컬러 액센트 매핑
const COLOR_THEME_MAP = {
    '#fef3c7': { accent: '#f59e0b', border: '#fcd34d', surface: '#fffef7' },
    '#e0f2fe': { accent: '#2563eb', border: '#93c5fd', surface: '#ffffff' },
    '#dcfce7': { accent: '#10b981', border: '#86efac', surface: '#fafffd' },
    '#f3e8ff': { accent: '#8b5cf6', border: '#c4b5fd', surface: '#fdfcff' },
    '#fee2e2': { accent: '#f43f5e', border: '#fda4af', surface: '#fffafb' }
};
// Quill 경량 툴바 구성
const quillToolbarOptions = [
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'check' }, { 'list': 'bullet' }, { 'list': 'ordered' }],
    ['link', 'clean']
];
// 1. 초기화
document.addEventListener('DOMContentLoaded', () => {
    initQuillEditors();
    setMemoView(currentViewMode, false);
    loadMemos();
    // 단축키 바인딩 (Ctrl + Enter 로 즉시 등록, ESC 로 모달/작성창 닫기)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('memoEditModal');
            if (modal && (modal.classList.contains('is-open') || modal.style.display === 'flex')) { closeEditMemoModal(); return; }
            collapseInlineComposer();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const modal = document.getElementById('memoEditModal');
            if (modal && (modal.classList.contains('is-open') || modal.style.display === 'flex')) { e.preventDefault(); submitEditMemo(); } else if (document.activeElement && document.activeElement.closest('.memo-composer-card')) { e.preventDefault(); submitNewMemo(); }
        }
    });
});
// 2. Quill 에디터 인스턴스 생성
function initQuillEditors() {
    memoQuill = new Quill('#memoQuillEditor', {
        theme: 'snow',
        placeholder: '떠오른 아이디어나 할 일 목록을 입력하세요... (Ctrl + Enter로 즉시 등록)',
        modules: { toolbar: quillToolbarOptions }
    });
    editMemoQuill = new Quill('#editMemoQuill', {
        theme: 'snow',
        placeholder: '메모 내용을 자유롭게 작성하세요...',
        modules: { toolbar: quillToolbarOptions }
    });
}
// 빠른 기록 바 클릭 핸들러 (모바일: 모달 오픈 / 데스크톱: 인라인 펼침)
function handleQuickBarClick(e, presetCategory = '') {
    if (e) e.stopPropagation();
    const cat = presetCategory || (currentMemoCategory !== 'all' && currentMemoCategory !== 'pinned' ? currentMemoCategory : 'idea');
    if (window.innerWidth <= 768) { openCreateMemoModal(cat); } else { expandInlineComposer(cat); }
}
function expandInlineComposer(presetCategory = 'idea') {
    const card = document.getElementById('memoComposerCard');
    if (!card) return;
    card.classList.remove('is-collapsed');
    if (presetCategory) {
        const catRadio = document.querySelector(`input[name="memoCategory"][value="${presetCategory}"]`);
        if (catRadio) catRadio.checked = true;
        if (presetCategory === 'todo') {
            const blueRadio = document.getElementById('colorBlue');
            if (blueRadio) blueRadio.checked = true;
            setTimeout(() => {
                if (memoQuill) { memoQuill.focus(); memoQuill.format('list', 'unchecked'); }
            }, 60);
            return;
        }
    }
    setTimeout(() => { const titleInput = document.getElementById('memoInputTitle'); if (titleInput) titleInput.focus(); }, 50);
}
function collapseInlineComposer() {
    const card = document.getElementById('memoComposerCard');
    if (card) card.classList.add('is-collapsed');
}
// 토스트 알림 팝업
function showToast(msg, icon = '✅') {
    const toast = document.getElementById('memoToast');
    const toastMsg = document.getElementById('memoToastMsg');
    const toastIcon = document.getElementById('memoToastIcon');
    if (!toast) return;
    toastMsg.textContent = msg;
    toastIcon.textContent = icon;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2300);
}
// 3. 뷰 모드 전환 (그리드 vs 리스트)
function setMemoView(mode) {
    currentViewMode = mode;
    localStorage.setItem('memo_view_mode', mode);
    const container = document.getElementById('memoContainerView');
    const btnGrid = document.getElementById('btnViewGrid');
    const btnList = document.getElementById('btnViewList');
    if (!container || !btnGrid || !btnList) return;
    if (mode === 'list') {
        container.classList.remove('grid-view');
        container.classList.add('list-view');
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
    } else {
        container.classList.remove('list-view');
        container.classList.add('grid-view');
        btnGrid.classList.add('active');
        btnList.classList.remove('active');
    }
}
// 4. 메모 목록 로드
async function loadMemos() {
    try {
        const res = await fetch('/api/memos?category=all');
        const data = await res.json();
        if (data.success) {
            allMemosFullList = data.memos || [];
            updateStats(allMemosFullList);
            applyFilterAndRender();
        } else { console.error('메모 목록 로드 실패:', data.message); }
    } catch (err) { console.error('메모 로드 통신 에러:', err); }
}
// 통계 뱃지 업데이트
function updateStats(memos) {
    const list = memos || allMemosFullList || [];
    const total = list.length;
    const pinned = list.filter(m => m.is_pinned).length;
    const idea = list.filter(m => m.category === 'idea').length;
    const todo = list.filter(m => m.category === 'todo').length;
    const general = list.filter(m => m.category === 'memo').length;
    const important = list.filter(m => m.category === 'important').length;
    const scrap = list.filter(m => m.category === 'scrap' || m.category === 'news').length;
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('statTotalCount', total); setTxt('statPinnedCount', pinned);
    setTxt('statTodoCount', todo); setTxt('statScrapCount', scrap);
    setTxt('countAll', total); setTxt('countPinned', pinned);
    setTxt('countIdea', idea); setTxt('countTodo', todo);
    setTxt('countMemo', general); setTxt('countImportant', important);
    setTxt('countScrap', scrap);
}
// 실시간 필터 & 렌더링
function applyFilterAndRender() {
    let filtered = [...allMemosFullList];
    if (currentMemoCategory !== 'all') {
        if (currentMemoCategory === 'pinned') { filtered = filtered.filter(m => m.is_pinned); } else if (currentMemoCategory === 'scrap') { filtered = filtered.filter(m => m.category === 'scrap' || m.category === 'news'); } else { filtered = filtered.filter(m => m.category === currentMemoCategory); }
    }
    if (currentMemoSearch) {
        const term = currentMemoSearch.toLowerCase();
        filtered = filtered.filter(m =>
            (m.title && m.title.toLowerCase().includes(term)) ||
            (m.content && m.content.toLowerCase().includes(term))
        );
    }
    allMemosCache = filtered;
    renderMemos(filtered);
}
// 5. 메모 카드 렌더링 (페이퍼 화이트 & 컬러 액센트)
function renderMemos(memos) {
    const container = document.getElementById('memoContainerView');
    if (!container) return;
    if (!memos || memos.length === 0) {
        const emptyMessage = currentMemoSearch
            ? `'${escapeHtml(currentMemoSearch)}' 검색 결과가 없습니다.`
            : (currentMemoCategory !== 'all' ? '해당 카테고리에 등록된 메모가 없습니다.' : '아직 작성된 메모가 없습니다.<br>상단 기록 바 또는 [+ 새 메모] 버튼을 눌러 첫 메모를 남겨보세요!');
        container.innerHTML = `
            <div class="memo-empty-state">
                <span class="memo-empty-icon">📝</span>
                <h3>메모가 비어 있습니다</h3>
                <p>${emptyMessage}</p>
            </div>
        `;
        return;
    }
    container.innerHTML = memos.map(m => {
        const cat = CATEGORY_MAP[m.category] || CATEGORY_MAP['idea'];
        const theme = COLOR_THEME_MAP[m.color] || COLOR_THEME_MAP['#fef3c7'];
        const formattedDate = formatMemoDate(m.updated_at || m.created_at);
        const escapedTitle = m.title ? escapeHtml(m.title) : '';
        let bodyHtml = m.content || '';
        const hasHtmlTags = /<\/?(?:p|div|ul|ol|li|h[1-6]|br|span|strong|b|em|i|u|s|a|blockquote)[>\s]/i.test(bodyHtml);
        if (!hasHtmlTags) { bodyHtml = escapeHtml(bodyHtml).replace(/\n/g, '<br>'); } else { bodyHtml = sanitizeMemoHtml(bodyHtml); }
        if (bodyHtml.includes('[ ]') || bodyHtml.includes('[x]') || bodyHtml.includes('[X]')) {
            bodyHtml = bodyHtml
                .replace(/(?:^|<br>|<p>)(?:-\s*)?\[\s*\]\s*([^<\n]+)/gi, '<li data-list="unchecked">$1</li>')
                .replace(/(?:^|<br>|<p>)(?:-\s*)?\[[xX]\]\s*([^<\n]+)/gi, '<li data-list="checked">$1</li>');
            if (bodyHtml.includes('<li data-list=') && !bodyHtml.includes('<ol>') && !bodyHtml.includes('<ul>')) {
                bodyHtml = `<ol>${bodyHtml}</ol>`;
            }
        }
        if (bodyHtml.includes('원문 링크:')) { bodyHtml = bodyHtml.replace(/원문 링크:\s*(https?:\/\/[^\s<"']+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">원문 이동 ↗</a>'); }
        return `
            <div class="memo-card ${m.is_pinned ? 'pinned' : ''}" style="--card-accent: ${theme.accent}; --card-border: ${theme.border}; --card-surface: ${theme.surface};" data-memo-id="${m.id}">
                <div>
                    <div class="memo-card-top">
                        <div class="memo-card-badges">
                            <span class="memo-card-badge" style="background:${cat.bg}; color:${cat.color};">
                                ${cat.label}
                            </span>
                            ${m.is_pinned ? '<span class="memo-pin-pill">📌 고정됨</span>' : ''}
                        </div>
                        <div class="memo-card-actions">
                            <button type="button" class="memo-action-btn btn-pin ${m.is_pinned ? 'is-active' : ''}" onclick="toggleMemoPin(${m.id})" title="${m.is_pinned ? '고정 해제' : '상단 고정'}">
                                📌
                            </button>
                            <button type="button" class="memo-action-btn" onclick="copyMemoText(${m.id})" title="내용 복사">
                                📋
                            </button>
                            <button type="button" class="memo-action-btn" onclick="openEditMemoModal(${m.id})" title="상세 보기 및 수정">
                                ✏️
                            </button>
                            <button type="button" class="memo-action-btn" onclick="deleteMemo(${m.id})" title="삭제">
                                🗑️
                            </button>
                        </div>
                    </div>
                    <div class="memo-card-body" onclick="handleCardBodyClick(event, ${m.id})" title="클릭하여 상세 보기 및 편집">
                        ${escapedTitle ? `<div class="memo-card-title">${escapedTitle}</div>` : ''}
                        <div class="memo-card-content">${bodyHtml}</div>
                    </div>
                </div>
                <div class="memo-card-footer">
                    <span>${formattedDate}</span>
                    <span style="opacity: 0.65; font-size: 0.72rem;">탭하여 편집 ✏️</span>
                </div>
            </div>
        `;
    }).join('');
}
// 6. 카드 본문 클릭 인터랙션 (체크리스트는 즉시 토글, 링크는 이동, 그 외 본문은 상세 편집 모달 오픈)
function handleCardBodyClick(e, memoId) {
    if (e.target.closest('a')) return;
    const targetLi = e.target.closest('li[data-list]');
    if (targetLi) { handleCardContentClick(e, memoId); return; }
    openEditMemoModal(memoId);
}
async function handleCardContentClick(e, memoId) {
    const targetLi = e.target.closest('li[data-list]');
    if (!targetLi) return;
    const currentStatus = targetLi.getAttribute('data-list');
    const newStatus = currentStatus === 'checked' ? 'unchecked' : 'checked';
    targetLi.setAttribute('data-list', newStatus);
    const cardContentEl = targetLi.closest('.memo-card-content');
    if (!cardContentEl) return;
    const updatedHtml = cardContentEl.innerHTML;
    const memo = allMemosCache.find(m => m.id === memoId);
    if (!memo) return;
    try {
        const res = await fetch(`/api/memos/${memoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: memo.title || '',
                content: updatedHtml,
                category: memo.category,
                color: memo.color,
                is_pinned: memo.is_pinned
            })
        });
        const data = await res.json();
        if (data.success) { memo.content = updatedHtml; showToast(newStatus === 'checked' ? '할 일 완료! 🎉' : '할 일 미완료로 변경', '✅'); }
    } catch (err) { console.error('할 일 체크 업데이트 실패:', err); }
}
// 7. 인라인 신규 메모 등록
async function submitNewMemo() {
    const titleInput = document.getElementById('memoInputTitle');
    const pinCheck = document.getElementById('memoPinCheck');
    const catInput = document.querySelector('input[name="memoCategory"]:checked');
    const colorInput = document.querySelector('input[name="memoColor"]:checked');
    const htmlContent = memoQuill ? memoQuill.root.innerHTML.trim() : '';
    const textContent = memoQuill ? memoQuill.getText().trim() : '';
    if (!textContent && (!htmlContent || htmlContent === '<p><br></p>')) {
        alert('메모 내용을 입력해 주세요.');
        if (memoQuill) memoQuill.focus();
        return;
    }
    const payload = {
        title: titleInput ? titleInput.value.trim() : '',
        content: htmlContent,
        category: catInput ? catInput.value : 'idea',
        color: colorInput ? colorInput.value : '#fef3c7',
        is_pinned: pinCheck && pinCheck.checked ? 1 : 0
    };
    try {
        const res = await fetch('/api/memos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            if (titleInput) titleInput.value = '';
            if (memoQuill) memoQuill.setText('');
            if (pinCheck) pinCheck.checked = false;
            collapseInlineComposer();
            showToast('새 메모가 등록되었습니다! 📝', '✨');
            loadMemos();
        } else { alert('등록 실패: ' + (data.message || '오류 발생')); }
    } catch (e) { alert('네트워크 오류: ' + e.message); }
}
// 8. 핀 고정 토글
async function toggleMemoPin(id) {
    try {
        const res = await fetch(`/api/memos/${id}/pin`, { method: 'PATCH' });
        const data = await res.json();
        if (data.success) { showToast('고정 상태가 변경되었습니다.', '📌'); loadMemos(); } else { alert('고정 상태 변경 실패: ' + (data.message || '오류')); }
    } catch (e) { alert('오류 발생: ' + e.message); }
}
// 9. 메모 복사
function copyMemoText(id) {
    const memo = allMemosCache.find(m => m.id === id);
    if (!memo) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = memo.content;
    const cleanText = tempDiv.innerText || tempDiv.textContent || '';
    const fullText = (memo.title ? `[${memo.title}]\n` : '') + cleanText;
    navigator.clipboard.writeText(fullText).then(() => { showToast('클립보드에 복사되었습니다!', '📋'); }).catch(() => { showToast('복사 실패', '⚠️'); });
}
// 10. 메모 삭제
async function deleteMemo(id) {
    if (!confirm('이 메모를 영구 삭제하시겠습니까?')) return;
    try {
        const res = await fetch(`/api/memos/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) { showToast('메모가 삭제되었습니다.', '🗑️'); loadMemos(); } else { alert('삭제 실패: ' + (data.message || '오류')); }
    } catch (e) { alert('삭제 중 오류: ' + e.message); }
}
function deleteMemoFromModal() {
    const id = document.getElementById('editMemoId').value;
    if (!id) return;
    closeEditMemoModal();
    deleteMemo(Number(id));
}
// 11. 새 메모 작성 모달 열기 & 기존 메모 상세/수정 모달 열기
function openCreateMemoModal(presetCategory = 'idea') {
    document.getElementById('editMemoId').value = '';
    document.getElementById('editMemoTitle').value = '';
    if (editMemoQuill) editMemoQuill.setText('');
    document.getElementById('editMemoPinCheck').checked = false;
    const headerTitle = document.getElementById('memoModalHeaderTitle');
    if (headerTitle) headerTitle.textContent = '✏️ 새 메모 작성';
    const delBtn = document.getElementById('memoModalDeleteBtn');
    if (delBtn) delBtn.style.display = 'none';
    const cat = presetCategory || 'idea';
    const catRadio = document.querySelector(`input[name="editMemoCategory"][value="${cat}"]`);
    if (catRadio) catRadio.checked = true;
    const defaultColor = (CATEGORY_MAP[cat] && CATEGORY_MAP[cat].defaultColor) || '#fef3c7';
    const colorRadio = document.querySelector(`input[name="editMemoColor"][value="${defaultColor}"]`);
    if (colorRadio) colorRadio.checked = true;
    const modal = document.getElementById('memoEditModal');
    if (modal) { modal.classList.add('is-open'); modal.style.display = 'flex'; }
    setTimeout(() => {
        if (editMemoQuill) {
            editMemoQuill.focus();
            if (cat === 'todo') { editMemoQuill.format('list', 'unchecked'); }
        }
    }, 100);
}
function openEditMemoModal(id) {
    const memo = allMemosFullList.find(m => m.id === id) || allMemosCache.find(m => m.id === id);
    if (!memo) return;
    document.getElementById('editMemoId').value = memo.id;
    document.getElementById('editMemoTitle').value = memo.title || '';
    const headerTitle = document.getElementById('memoModalHeaderTitle');
    if (headerTitle) headerTitle.textContent = '✏️ 메모 작성 / 상세 편집';
    const delBtn = document.getElementById('memoModalDeleteBtn');
    if (delBtn) delBtn.style.display = 'inline-flex';
    if (editMemoQuill) { editMemoQuill.root.innerHTML = memo.content || ''; }
    document.getElementById('editMemoPinCheck').checked = memo.is_pinned === 1;
    const catVal = memo.category === 'news' ? 'scrap' : (memo.category || 'idea');
    const catRadio = document.querySelector(`input[name="editMemoCategory"][value="${catVal}"]`);
    if (catRadio) catRadio.checked = true;
    const colorRadio = document.querySelector(`input[name="editMemoColor"][value="${memo.color || '#fef3c7'}"]`);
    if (colorRadio) colorRadio.checked = true;
    const modal = document.getElementById('memoEditModal');
    if (modal) { modal.classList.add('is-open'); modal.style.display = 'flex'; }
}
function closeEditMemoModal() {
    const modal = document.getElementById('memoEditModal');
    if (modal) { modal.classList.remove('is-open'); modal.style.display = 'none'; }
}
// 12. 모달 저장 완료 제출 (신규 생성 & 기존 수정 겸용)
async function submitEditMemo() {
    const id = document.getElementById('editMemoId').value;
    const title = document.getElementById('editMemoTitle').value.trim();
    const pinCheck = document.getElementById('editMemoPinCheck').checked;
    const catInput = document.querySelector('input[name="editMemoCategory"]:checked');
    const colorInput = document.querySelector('input[name="editMemoColor"]:checked');
    const htmlContent = editMemoQuill ? editMemoQuill.root.innerHTML.trim() : '';
    const textContent = editMemoQuill ? editMemoQuill.getText().trim() : '';
    if (!textContent && (!htmlContent || htmlContent === '<p><br></p>')) {
        alert('메모 내용을 입력해 주세요.');
        if (editMemoQuill) editMemoQuill.focus();
        return;
    }
    const payload = {
        title: title,
        content: htmlContent,
        category: catInput ? catInput.value : 'idea',
        color: colorInput ? colorInput.value : '#fef3c7',
        is_pinned: pinCheck ? 1 : 0
    };
    const isCreate = !id;
    const url = isCreate ? '/api/memos' : `/api/memos/${id}`;
    const method = isCreate ? 'POST' : 'PUT';
    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            closeEditMemoModal();
            showToast(isCreate ? '새 메모가 등록되었습니다! 📝' : '메모가 수정되었습니다.', isCreate ? '✨' : '✏️');
            loadMemos();
        } else { alert('저장 실패: ' + (data.message || '오류 발생')); }
    } catch (e) { alert('저장 통신 오류: ' + e.message); }
}
// 13. 필터 & 검색
function filterMemos(cat, btn) {
    currentMemoCategory = cat;
    document.querySelectorAll('.memo-tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyFilterAndRender();
}
function handleMemoSearch(val) {
    currentMemoSearch = val.trim();
    const clearBtn = document.getElementById('memoSearchClearBtn');
    if (clearBtn) { clearBtn.style.display = currentMemoSearch ? 'inline-flex' : 'none'; }
    clearTimeout(memoSearchTimeout);
    memoSearchTimeout = setTimeout(() => { applyFilterAndRender(); }, 80);
}
function clearMemoSearch() {
    const input = document.getElementById('memoSearchInput');
    if (input) input.value = '';
    handleMemoSearch('');
}
// 유틸 함수
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}
function formatMemoDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr.replace(' ', 'T'));
        if (isNaN(d.getTime())) return dateStr;
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        if (isToday) return `오늘 ${h}:${min}`;
        return `${m}월 ${day}일 ${h}:${min}`;
    } catch (e) { return dateStr; }
}
