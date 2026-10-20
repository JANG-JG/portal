        // 🛡️ XSS 방어 살균 함수 (DOMPurify + Fallback Parser)
        function sanitizeMemoHtml(dirty) {
            if (!dirty) return '';
            if (window.DOMPurify) {
                return DOMPurify.sanitize(dirty, {
                    ALLOWED_TAGS: ['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'blockquote', 'code', 'pre'],
                    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'data-list', 'style']
                });
            }
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(dirty, 'text/html');
                const forbidden = ['script', 'object', 'embed', 'link', 'iframe', 'form', 'input', 'button', 'svg', 'math'];
                forbidden.forEach(tag => {
                    doc.querySelectorAll(tag).forEach(el => el.remove());
                });
                const allElements = doc.querySelectorAll('*');
                allElements.forEach(el => {
                    for (let i = el.attributes.length - 1; i >= 0; i--) {
                        const attr = el.attributes[i];
                        if (attr.name.toLowerCase().startsWith('on')) {
                            el.removeAttribute(attr.name);
                        } else if (attr.name.toLowerCase() === 'href' || attr.name.toLowerCase() === 'src') {
                            if (/^\s*javascript:/i.test(attr.value) || /^\s*data:/i.test(attr.value)) {
                                el.removeAttribute(attr.name);
                            }
                        }
                    }
                });
                return doc.body.innerHTML;
            } catch (e) {
                return escapeHtml(dirty).replace(/\n/g, '<br>');
            }
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
            'idea': { label: '💡 아이디어', bg: '#fef3c7', color: '#b45309' },
            'todo': { label: '✅ 할 일', bg: '#e0f2fe', color: '#0369a1' },
            'memo': { label: '📝 일반', bg: '#f1f5f9', color: '#475569' },
            'important': { label: '⭐ 중요', bg: '#fee2e2', color: '#b91c1c' },
            'scrap': { label: '📰 뉴스스크랩', bg: '#fef9c3', color: '#854d0e' },
            'news': { label: '📰 뉴스스크랩', bg: '#fef9c3', color: '#854d0e' }
        };

        // Quill 경량 툴바 구성 (모바일 & 데스크톱 최적화)
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

            // 단축키 바인딩 (Ctrl + Enter 로 즉시 등록, ESC 로 수정 모달 닫기)
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const modal = document.getElementById('memoEditModal');
                    if (modal && (modal.classList.contains('is-open') || modal.style.display === 'flex')) {
                        closeEditMemoModal();
                    }
                    return;
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    const modal = document.getElementById('memoEditModal');
                    if (modal && (modal.classList.contains('is-open') || modal.style.display === 'flex')) {
                        e.preventDefault();
                        submitEditMemo();
                    } else if (document.activeElement && (document.activeElement.closest('.memo-composer-card'))) {
                        e.preventDefault();
                        submitNewMemo();
                    }
                }
            });
        });

        // 2. Quill 에디터 인스턴스 생성
        function initQuillEditors() {
            // 등록용 Quill
            memoQuill = new Quill('#memoQuillEditor', {
                theme: 'snow',
                placeholder: '떠오른 아이디어나 할 일 목록을 입력하세요... (단축키: Ctrl + Enter로 즉시 등록)',
                modules: {
                    toolbar: quillToolbarOptions
                }
            });

            // 수정 모달용 Quill
            editMemoQuill = new Quill('#editMemoQuill', {
                theme: 'snow',
                placeholder: '수정할 메모 내용을 입력하세요...',
                modules: {
                    toolbar: quillToolbarOptions
                }
            });
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
            setTimeout(() => {
                toast.classList.remove('show');
            }, 2300);
        }

        // 3. 뷰 모드 전환 (그리드 vs 리스트)
        function setMemoView(mode, render = true) {
            currentViewMode = mode;
            localStorage.setItem('memo_view_mode', mode);
            const container = document.getElementById('memoContainerView');
            const btnGrid = document.getElementById('btnViewGrid');
            const btnList = document.getElementById('btnViewList');

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

        // 4. 메모 목록 로드 (전체 메모를 로드하여 통계 보존 & 클라이언트 고속 필터링)
        async function loadMemos() {
            try {
                const res = await fetch('/api/memos?category=all');
                const data = await res.json();
                if (data.success) {
                    allMemosFullList = data.memos || [];
                    updateStats(allMemosFullList);
                    applyFilterAndRender();
                } else {
                    console.error('메모 목록 로드 실패:', data.message);
                }
            } catch (err) {
                console.error('메모 로드 통신 에러:', err);
            }
        }

        // 통계 뱃지 업데이트 (전체 메모 기준 항구 집계)
        function updateStats(memos) {
            const list = memos || allMemosFullList || [];
            const total = list.length;
            const pinned = list.filter(m => m.is_pinned).length;
            const idea = list.filter(m => m.category === 'idea').length;
            const todo = list.filter(m => m.category === 'todo').length;
            const general = list.filter(m => m.category === 'memo').length;
            const important = list.filter(m => m.category === 'important').length;
            const scrap = list.filter(m => m.category === 'scrap' || m.category === 'news').length;

            const elStatTotal = document.getElementById('statTotalCount');
            const elStatPinned = document.getElementById('statPinnedCount');
            const elStatTodo = document.getElementById('statTodoCount');
            const elStatScrap = document.getElementById('statScrapCount');

            if (elStatTotal) elStatTotal.textContent = total;
            if (elStatPinned) elStatPinned.textContent = pinned;
            if (elStatTodo) elStatTodo.textContent = todo;
            if (elStatScrap) elStatScrap.textContent = scrap;

            const elCountAll = document.getElementById('countAll');
            const elCountPinned = document.getElementById('countPinned');
            const elCountIdea = document.getElementById('countIdea');
            const elCountTodo = document.getElementById('countTodo');
            const elCountMemo = document.getElementById('countMemo');
            const elCountImportant = document.getElementById('countImportant');
            const elCountScrap = document.getElementById('countScrap');

            if (elCountAll) elCountAll.textContent = total;
            if (elCountPinned) elCountPinned.textContent = pinned;
            if (elCountIdea) elCountIdea.textContent = idea;
            if (elCountTodo) elCountTodo.textContent = todo;
            if (elCountMemo) elCountMemo.textContent = general;
            if (elCountImportant) elCountImportant.textContent = important;
            if (elCountScrap) elCountScrap.textContent = scrap;
        }

        // 실시간 필터 & 렌더링
        function applyFilterAndRender() {
            let filtered = [...allMemosFullList];

            // 카테고리 필터
            if (currentMemoCategory !== 'all') {
                if (currentMemoCategory === 'pinned') {
                    filtered = filtered.filter(m => m.is_pinned);
                } else if (currentMemoCategory === 'scrap') {
                    filtered = filtered.filter(m => m.category === 'scrap' || m.category === 'news');
                } else {
                    filtered = filtered.filter(m => m.category === currentMemoCategory);
                }
            }

            // 검색어 필터
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

        // 5. 메모 카드 렌더링
        function renderMemos(memos) {
            const container = document.getElementById('memoContainerView');
            if (!container) return;

            if (!memos || memos.length === 0) {
                const emptyMessage = currentMemoSearch 
                    ? `'${escapeHtml(currentMemoSearch)}' 검색 결과가 없습니다.` 
                    : (currentMemoCategory !== 'all' ? '해당 카테고리에 등록된 메모가 없습니다.' : '아직 작성된 메모가 없습니다.<br>위의 등록창에서 첫 메모를 작성해 보세요!');
                
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
                const formattedDate = formatMemoDate(m.updated_at || m.created_at);
                const escapedTitle = m.title ? escapeHtml(m.title) : '';
                
                // 본문: Quill HTML 및 체크리스트 처리 (구버전 텍스트 호환)
                let bodyHtml = m.content || '';

                // 표준 HTML 태그 포함 여부 정확한 판별 (<p>, <div>, <ul>, <ol>, <li>, <br>, <span> 등)
                const hasHtmlTags = /<\/?(?:p|div|ul|ol|li|h[1-6]|br|span|strong|b|em|i|u|s|a|blockquote)[>\s]/i.test(bodyHtml);
                if (!hasHtmlTags) {
                    // 순수 텍스트 메모만 안전하게 escape 후 줄바꿈 변환
                    bodyHtml = escapeHtml(bodyHtml).replace(/\n/g, '<br>');
                } else {
                    // 🛡️ Stored XSS 완벽 방어 살균
                    bodyHtml = sanitizeMemoHtml(bodyHtml);
                }

                // 마크다운 체크리스트 호환 (- [ ] 할일 / - [x] 완료)
                if (bodyHtml.includes('[ ]') || bodyHtml.includes('[x]') || bodyHtml.includes('[X]')) {
                    bodyHtml = bodyHtml
                        .replace(/(?:^|<br>|<p>)(?:-\s*)?\[\s*\]\s*([^<\n]+)/gi, '<li data-list="unchecked">$1</li>')
                        .replace(/(?:^|<br>|<p>)(?:-\s*)?\[[xX]\]\s*([^<\n]+)/gi, '<li data-list="checked">$1</li>');
                    if (bodyHtml.includes('<li data-list=') && !bodyHtml.includes('<ol>') && !bodyHtml.includes('<ul>')) {
                        bodyHtml = `<ol>${bodyHtml}</ol>`;
                    }
                }

                // 과거 스크랩 메모 호환: "원문 링크: https://..." 텍스트를 "원문 이동 ↗" 하이퍼링크로 자동 치환
                if (bodyHtml.includes('원문 링크:')) {
                    bodyHtml = bodyHtml.replace(/원문 링크:\s*(https?:\/\/[^\s<"']+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2563eb; font-weight:700; text-decoration:underline;">원문 이동 ↗</a>');
                }

                return `
                    <div class="memo-card ${m.is_pinned ? 'pinned' : ''}" style="background-color: ${m.color || '#fef3c7'};" data-memo-id="${m.id}">
                        <div>
                            <div class="memo-card-top">
                                <span class="memo-card-badge" style="background:${cat.bg}; color:${cat.color};">
                                    ${cat.label}
                                </span>
                                <div class="memo-card-actions">
                                    <button type="button" class="memo-action-btn btn-pin ${m.is_pinned ? 'is-active' : ''}" onclick="toggleMemoPin(${m.id})" title="${m.is_pinned ? '고정 해제' : '상단 고정'}">
                                        ${m.is_pinned ? '📌' : '📍'}
                                    </button>
                                    <button type="button" class="memo-action-btn" onclick="copyMemoText(${m.id})" title="내용 복사">
                                        📋
                                    </button>
                                    <button type="button" class="memo-action-btn" onclick="openEditMemoModal(${m.id})" title="수정">
                                        ✏️
                                    </button>
                                    <button type="button" class="memo-action-btn" onclick="deleteMemo(${m.id})" title="삭제">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                            <div class="memo-card-body">
                                ${escapedTitle ? `<div class="memo-card-title">${escapedTitle}</div>` : ''}
                                <div class="memo-card-content" onclick="handleCardContentClick(event, ${m.id})">${bodyHtml}</div>
                            </div>
                        </div>
                        <div class="memo-card-footer">
                            <span>${m.is_pinned ? '📌 고정됨 · ' : ''}${formattedDate}</span>
                            <span style="opacity: 0.6; font-size: 0.7rem;">#${m.id}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 6. 카드 내부 체크박스(할 일 항목) 클릭 인터랙션
        async function handleCardContentClick(e, memoId) {
            const targetLi = e.target.closest('li[data-list]');
            if (!targetLi) return;

            const currentStatus = targetLi.getAttribute('data-list');
            const newStatus = currentStatus === 'checked' ? 'unchecked' : 'checked';
            targetLi.setAttribute('data-list', newStatus);

            // 해당 카드의 전체 HTML 가져와서 백엔드 업데이트
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
                if (data.success) {
                    memo.content = updatedHtml;
                    showToast(newStatus === 'checked' ? '할 일 완료! 🎉' : '할 일 미완료로 변경', '✅');
                }
            } catch (err) {
                console.error('할 일 체크 업데이트 실패:', err);
            }
        }

        // 7. 신규 메모 등록
        async function submitNewMemo() {
            const titleInput = document.getElementById('memoInputTitle');
            const pinCheck = document.getElementById('memoPinCheck');
            const catInput = document.querySelector('input[name="memoCategory"]:checked');
            const colorInput = document.querySelector('input[name="memoColor"]:checked');

            // Quill 에디터 내용 추출 (HTML 및 순수 텍스트)
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
                    // 입력창 초기화
                    if (titleInput) titleInput.value = '';
                    if (memoQuill) memoQuill.setText('');
                    if (pinCheck) pinCheck.checked = false;

                    showToast('새 메모가 등록되었습니다! 📝', '✨');
                    loadMemos();
                } else {
                    alert('등록 실패: ' + (data.message || '오류 발생'));
                }
            } catch (e) {
                alert('네트워크 오류: ' + e.message);
            }
        }

        // 8. 핀 고정 토글
        async function toggleMemoPin(id) {
            try {
                const res = await fetch(`/api/memos/${id}/pin`, { method: 'PATCH' });
                const data = await res.json();
                if (data.success) {
                    showToast('고정 상태가 변경되었습니다.', '📌');
                    loadMemos();
                } else {
                    alert('고정 상태 변경 실패: ' + (data.message || '오류'));
                }
            } catch (e) {
                alert('오류 발생: ' + e.message);
            }
        }

        // 9. 메모 복사
        function copyMemoText(id) {
            const memo = allMemosCache.find(m => m.id === id);
            if (!memo) return;

            // HTML 태그 제거하여 순수 텍스트 생성
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = memo.content;
            const cleanText = tempDiv.innerText || tempDiv.textContent || '';
            const fullText = (memo.title ? `[${memo.title}]\n` : '') + cleanText;

            navigator.clipboard.writeText(fullText).then(() => {
                showToast('클립보드에 복사되었습니다!', '📋');
            }).catch(() => {
                showToast('복사 실패', '⚠️');
            });
        }

        // 10. 메모 삭제
        async function deleteMemo(id) {
            if (!confirm('이 메모를 영구 삭제하시겠습니까?')) return;
            try {
                const res = await fetch(`/api/memos/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast('메모가 삭제되었습니다.', '🗑️');
                    loadMemos();
                } else {
                    alert('삭제 실패: ' + (data.message || '오류'));
                }
            } catch (e) {
                alert('삭제 중 오류: ' + e.message);
            }
        }

        // 11. 수정 모달 열기
        function openEditMemoModal(id) {
            const memo = allMemosCache.find(m => m.id === id);
            if (!memo) return;

            document.getElementById('editMemoId').value = memo.id;
            document.getElementById('editMemoTitle').value = memo.title || '';
            
            // 수정용 Quill 에디터에 기존 HTML 세팅
            if (editMemoQuill) {
                editMemoQuill.root.innerHTML = memo.content || '';
            }

            document.getElementById('editMemoPinCheck').checked = memo.is_pinned === 1;

            const catRadio = document.querySelector(`input[name="editMemoCategory"][value="${memo.category}"]`);
            if (catRadio) catRadio.checked = true;

            const colorRadio = document.querySelector(`input[name="editMemoColor"][value="${memo.color}"]`);
            if (colorRadio) colorRadio.checked = true;

            const modal = document.getElementById('memoEditModal');
            if (modal) {
                modal.classList.add('is-open');
                modal.style.display = 'flex';
            }
            setTimeout(() => {
                if (editMemoQuill) editMemoQuill.focus();
            }, 100);
        }

        function closeEditMemoModal() {
            const modal = document.getElementById('memoEditModal');
            if (modal) {
                modal.classList.remove('is-open');
                modal.style.display = 'none';
            }
        }

        // 12. 수정 완료 제출
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

            try {
                const res = await fetch(`/api/memos/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    closeEditMemoModal();
                    showToast('메모가 수정되었습니다.', '✏️');
                    loadMemos();
                } else {
                    alert('수정 실패: ' + (data.message || '오류 발생'));
                }
            } catch (e) {
                alert('수정 통신 오류: ' + e.message);
            }
        }

        // 13. 필터 & 검색 (클라이언트 즉시 반응 & 카운트 불변 보장)
        function filterMemos(cat, btn) {
            currentMemoCategory = cat;
            document.querySelectorAll('.memo-tab-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            applyFilterAndRender();
        }

        function handleMemoSearch(val) {
            currentMemoSearch = val.trim();
            clearTimeout(memoSearchTimeout);
            memoSearchTimeout = setTimeout(() => {
                applyFilterAndRender();
            }, 80);
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
            } catch (e) {
                return dateStr;
            }
        }
