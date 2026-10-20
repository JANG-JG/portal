        let currentYear = new Date().getFullYear();
        let currentMonth = new Date().getMonth(); // 0-indexed
        let selectedDateStr = new Date().toISOString().slice(0, 10);
        let allEvents = [];
        let categories = [];
        let selectedCategoryColor = '#6366f1';

        // 1. 범례(카테고리) 목록 가져오기
        async function fetchCategories() {
            try {
                const res = await fetch('/api/calendar/categories');
                const data = await res.json();
                if (data.success && Array.isArray(data.categories)) {
                    categories = data.categories;
                } else {
                    categories = [
                        { id: 1, name: '업무', color: '#6366f1' },
                        { id: 2, name: '개인', color: '#10b981' },
                        { id: 3, name: '중요', color: '#f43f5e' },
                        { id: 4, name: '모임', color: '#f59e0b' },
                        { id: 5, name: '기타', color: '#0ea5e9' }
                    ];
                }
            } catch (e) {
                console.error('범례 로드 실패:', e);
            }
            renderCategorySelect();
            renderCustomLegendsBottom();
            renderModalCategories();
        }

        // 일정 등록 폼의 범례 드롭다운 렌더링
        function renderCategorySelect() {
            const select = document.getElementById('inputEventCategorySelect');
            if (!select) return;
            select.innerHTML = categories.map((cat, idx) => `
                <option value="${cat.name}" data-color="${cat.color}" ${idx === 0 ? 'selected' : ''}>
                    ● ${cat.name}
                </option>
            `).join('');
            // 기본 선택 색상 반영
            if (categories.length > 0) {
                select.style.borderLeft = `5px solid ${categories[0].color}`;
            }
        }

        function onCategorySelectChange() {
            const select = document.getElementById('inputEventCategorySelect');
            const selectedOpt = select.options[select.selectedIndex];
            if (selectedOpt) {
                const color = selectedOpt.getAttribute('data-color') || '#6366f1';
                select.style.borderLeft = `5px solid ${color}`;
            }
        }

        // 캘린더 하단 커스텀 범례 렌더링
        function renderCustomLegendsBottom() {
            const container = document.getElementById('customLegendsContainer');
            if (!container) return;
            container.innerHTML = categories.map(cat => `
                <span style="display: flex; align-items: center; gap: 0.25rem;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${cat.color};"></span>
                    ${escapeHtml(cat.name)}
                </span>
            `).join('');
        }

        // 모달 내 범례 리스트 렌더링
        function renderModalCategories() {
            const list = document.getElementById('modalCategoryList');
            if (!list) return;

            if (categories.length === 0) {
                list.innerHTML = `<div style="text-align: center; color: #94a3b8; font-size: 0.8rem; padding: 1rem;">등록된 범례가 없습니다. 위에서 새 범례를 추가해보세요.</div>`;
                return;
            }

            list.innerHTML = categories.map(cat => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="color-dot" style="background: ${cat.color};"></span>
                        <span style="font-size: 0.82rem; font-weight: 700; color: #1e293b;">${escapeHtml(cat.name)}</span>
                        <span style="font-size: 0.7rem; color: #94a3b8; font-family: monospace;">${cat.color}</span>
                    </div>
                    <button type="button" onclick="deleteCategory(${cat.id}, '${escapeHtml(cat.name)}')" style="background: none; border: none; color: #ef4444; font-size: 0.8rem; cursor: pointer; padding: 2px 6px;" title="삭제">
                        ✕
                    </button>
                </div>
            `).join('');
        }

        // 모달 열기/닫기
        function openCategoryModal() {
            document.getElementById('categoryModal').classList.add('active');
            renderModalCategories();
        }

        function closeCategoryModal() {
            document.getElementById('categoryModal').classList.remove('active');
        }

        function handleModalOverlayClick(e) {
            if (e.target.id === 'categoryModal') {
                closeCategoryModal();
            }
        }

        // 모달 색상 선택기
        function selectCategoryColor(color, el) {
            selectedCategoryColor = color;
            document.querySelectorAll('.color-preset-circle').forEach(c => c.classList.remove('selected'));
            if (el) el.classList.add('selected');
            document.getElementById('newCategoryCustomColor').value = color;
        }

        function onCustomColorPickerChange(val) {
            selectedCategoryColor = val;
            document.querySelectorAll('.color-preset-circle').forEach(c => c.classList.remove('selected'));
        }

        // 새 범례 저장
        async function submitNewCategory() {
            const nameInput = document.getElementById('newCategoryName');
            const name = nameInput.value.trim();
            if (!name) {
                alert('범례 이름을 입력해주세요.');
                nameInput.focus();
                return;
            }

            try {
                const res = await fetch('/api/calendar/categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color: selectedCategoryColor })
                });
                const data = await res.json();
                if (data.success) {
                    nameInput.value = '';
                    await fetchCategories();
                } else {
                    alert('범례 추가 실패: ' + (data.message || '오류 발생'));
                }
            } catch (e) {
                alert('통신 오류: ' + e.message);
            }
        }

        // 범례 삭제
        async function deleteCategory(id, name) {
            if (!confirm(`'${name}' 범례를 삭제할까요?`)) return;
            try {
                const res = await fetch(`/api/calendar/categories/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    await fetchCategories();
                } else {
                    alert('삭제 실패: ' + (data.message || '오류 발생'));
                }
            } catch (e) {
                alert('삭제 통신 오류: ' + e.message);
            }
        }

        // 2. 종일 모드 토글
        function toggleAllDayMode() {
            const isAllDay = document.getElementById('inputEventAllDay').checked;
            const timeWrapper = document.getElementById('timeInputWrapper');
            const timingSelect = document.getElementById('inputEventNotifyTiming');

            if (isAllDay) {
                timeWrapper.style.display = 'none';
                timingSelect.innerHTML = `
                    <option value="exact">당일 오전 09:00</option>
                    <option value="1d">1일 전 오전 09:00</option>
                    <option value="none">🔕 알림 안 받음</option>
                `;
            } else {
                timeWrapper.style.display = 'flex';
                timingSelect.innerHTML = `
                    <option value="exact">정시 (시작 시각)</option>
                    <option value="10m">10분 전</option>
                    <option value="30m">30분 전</option>
                    <option value="1h">1시간 전</option>
                    <option value="1d">1일 전</option>
                    <option value="none">🔕 알림 안 받음</option>
                `;
            }
        }

        // 3. 전체 일정 가져오기
        async function fetchEvents() {
            try {
                const res = await fetch('/api/calendar/events');
                const data = await res.json();
                if (data.success && Array.isArray(data.events)) {
                    allEvents = data.events;
                }
                if (data.routineBriefingTimes && Array.isArray(data.routineBriefingTimes)) {
                    const badge = document.getElementById('calRoutineBadge');
                    if (badge) {
                        badge.textContent = `🔔 매일 브리핑: ${data.routineBriefingTimes.join(', ')}`;
                    }
                }
            } catch (e) {
                console.error('이벤트 로드 실패:', e);
            }
            renderCalendar();
            renderSelectedDateEvents();
        }

        function renderCalendar() {
            const grid = document.getElementById('calendarGrid');
            const monthDisplay = document.getElementById('calMonthDisplay');
            monthDisplay.textContent = `${currentYear}년 ${currentMonth + 1}월`;

            while (grid.children.length > 7) {
                grid.removeChild(grid.lastChild);
            }

            const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
            const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();
            const prevLastDate = new Date(currentYear, currentMonth, 0).getDate();

            const todayStr = new Date().toISOString().slice(0, 10);

            // 이전 달 날짜 채우기
            for (let i = firstDayIndex - 1; i >= 0; i--) {
                const d = prevLastDate - i;
                const cell = document.createElement('div');
                cell.className = 'cal-cell other-month';
                cell.innerHTML = `<span class="cal-date-num">${d}</span>`;
                grid.appendChild(cell);
            }

            // 이번 달 날짜 생성
            for (let day = 1; day <= lastDate; day++) {
                const cell = document.createElement('div');
                const dayOfWeek = (firstDayIndex + day - 1) % 7;
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                const dayEvents = allEvents.filter(ev => ev.date === dateStr);
                const hasHoliday = dayEvents.some(ev => ev.type === 'holiday');

                let cellClass = 'cal-cell';
                if (dayOfWeek === 0) cellClass += ' sun';
                if (dayOfWeek === 6) cellClass += ' sat';
                if (hasHoliday) cellClass += ' holiday';
                if (dateStr === todayStr) cellClass += ' today';
                if (dateStr === selectedDateStr) cellClass += ' selected';

                cell.className = cellClass;
                cell.setAttribute('data-date', dateStr);
                cell.onclick = () => selectDate(dateStr);

                let html = `<span class="cal-date-num">${day}</span>`;

                const MAX_VISIBLE_EVENTS = 2;
                const visibleEvents = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
                const hiddenCount = dayEvents.length - MAX_VISIBLE_EVENTS;

                visibleEvents.forEach(ev => {
                    const compClass = ev.isCompleted ? 'completed' : '';
                    const allDayPrefix = ev.isAllDay ? '☀️ ' : (ev.time ? `${ev.time} ` : '');
                    const badgeText = `${allDayPrefix}${ev.title}`;
                    html += `<span class="event-badge ${compClass}" style="background-color: ${ev.color};" title="${escapeHtml(badgeText)}">${escapeHtml(badgeText)}</span>`;
                });

                if (hiddenCount > 0) {
                    html += `<span class="event-more-badge">+${hiddenCount}개</span>`;
                }

                cell.innerHTML = html;
                grid.appendChild(cell);
            }

            // 다음 달 잔여 셀 채우기
            const totalCells = firstDayIndex + lastDate;
            const remaining = (7 - (totalCells % 7)) % 7;
            for (let i = 1; i <= remaining; i++) {
                const cell = document.createElement('div');
                cell.className = 'cal-cell other-month';
                cell.innerHTML = `<span class="cal-date-num">${i}</span>`;
                grid.appendChild(cell);
            }
        }

        function selectDate(dateStr) {
            selectedDateStr = dateStr;
            renderCalendar();
            renderSelectedDateEvents();
        }

        function renderSelectedDateEvents() {
            const display = document.getElementById('selectedDateDisplay');
            const list = document.getElementById('selectedDateEventsList');
            const dateInput = document.getElementById('inputEventDate');

            const [y, m, d] = selectedDateStr.split('-');
            display.textContent = `${y}년 ${parseInt(m)}월 ${parseInt(d)}일 일정`;
            if (dateInput && !document.getElementById('editingEventId')?.value) {
                dateInput.value = selectedDateStr;
            }

            const dayEvents = allEvents.filter(ev => ev.date === selectedDateStr);

            if (dayEvents.length === 0) {
                list.innerHTML = `
                    <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8; font-size: 0.85rem;">
                        <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">🏖️</span>
                        등록된 일정이 없습니다. [+ 일정 추가]를 눌러 등록해보세요.
                    </div>
                `;
                return;
            }

            list.innerHTML = dayEvents.map(ev => {
                const isPersonal = ev.type === 'personal';

                // 시간 및 종일 태그
                let timeBadge = '';
                if (ev.isAllDay) {
                    timeBadge = `<span style="font-size:0.72rem; font-weight:800; background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; margin-right:0.35rem;">☀️ 종일</span>`;
                } else if (ev.time) {
                    timeBadge = `<span style="font-size:0.75rem; font-weight:700; color:#475569; margin-right:0.35rem;">⏰ ${ev.time}</span>`;
                }

                // 카테고리 태그
                const categoryBadge = ev.category ? `
                    <span style="font-size:0.68rem; font-weight:700; background:${ev.color}15; color:${ev.color}; border:1px solid ${ev.color}40; padding:1px 5px; border-radius:3px; margin-right:0.35rem;">
                        ${escapeHtml(ev.category)}
                    </span>
                ` : '';

                // 알림 태그
                let notifyBadge = '';
                if (isPersonal && ev.notifyTiming && ev.notifyTiming !== 'none') {
                    const timingMap = {
                        'exact': ev.isAllDay ? '오전9시' : '정시',
                        '10m': '10분전',
                        '30m': '30분전',
                        '1h': '1시간전',
                        '1d': '1일전'
                    };
                    const tText = timingMap[ev.notifyTiming] || ev.notifyTiming;
                    notifyBadge = `<span style="font-size:0.68rem; color:#64748b; background:#f1f5f9; padding:1px 5px; border-radius:3px; margin-left:0.25rem;">🔔 ${tText} (${ev.notifyRepeat || 1}회)</span>`;
                }

                const memoStr = ev.memo ? `<div style="font-size:0.75rem; color:#64748b; margin-top:3px;">${escapeHtml(ev.memo)}</div>` : '';

                // 서비스 바로가기 또는 관리 버튼 생성
                let actionBtn = '';
                if (isPersonal) {
                    actionBtn = `
                        <div style="display:flex; align-items:center; gap:0.3rem; flex-shrink:0;">
                            <button type="button" onclick="openEditEvent(${ev.dbId})" style="background:#eef2ff; border:1px solid #c7d2fe; color:#4f46e5; font-size:0.75rem; font-weight:700; cursor:pointer; padding:3px 7px; border-radius:4px;" title="일정 수정">✏️ 수정</button>
                            <button type="button" onclick="deleteEvent(${ev.dbId})" style="background:none; border:none; color:#ef4444; font-size:0.95rem; cursor:pointer; padding:0.2rem;" title="삭제">✕</button>
                        </div>
                    `;
                } else if (ev.type && ev.type.startsWith('hospital')) {
                    actionBtn = `<a href="https://blood.j-jg.cc/hospital.html" target="_blank" style="font-size:0.75rem; color:#059669; font-weight:700; text-decoration:none; padding:2px 6px; background:#ecfdf5; border-radius:4px; flex-shrink:0;">병원예약 →</a>`;
                } else if (ev.type && ev.type.startsWith('health')) {
                    actionBtn = `<a href="https://blood.j-jg.cc/" target="_blank" style="font-size:0.75rem; color:#e11d48; font-weight:700; text-decoration:none; padding:2px 6px; background:#fff1f2; border-radius:4px; flex-shrink:0;">혈압앱 →</a>`;
                }

                // 대표 아이콘 결정
                let icon = '📌';
                if (ev.type === 'holiday') icon = '🚩';
                else if (ev.type === 'health-bp') icon = '❤️';
                else if (ev.type === 'health-med') icon = '💊';
                else if (ev.type && ev.type.startsWith('hospital')) icon = '🏥';

                return `
                    <div class="event-item ${ev.isCompleted ? 'completed' : ''}">
                        <div style="display:flex; align-items:flex-start; gap:0.5rem; flex:1; min-width:0;">
                            ${isPersonal ? `
                                <input type="checkbox" ${ev.isCompleted ? 'checked' : ''} onchange="toggleEventComplete(${ev.dbId})" style="cursor:pointer; width:16px; height:16px; margin-top:2px;">
                            ` : `<span style="font-size:0.9rem; margin-top:2px;">${icon}</span>`}
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px; margin-bottom:2px;">
                                    ${timeBadge}
                                    ${categoryBadge}
                                    ${notifyBadge}
                                </div>
                                <div style="font-size:0.85rem; font-weight:700; color:#0f172a; text-decoration:${ev.isCompleted ? 'line-through' : 'none'}; word-break:break-all;">
                                    ${escapeHtml(ev.title)}
                                </div>
                                ${memoStr}
                            </div>
                        </div>
                        ${actionBtn}
                    </div>
                `;
            }).join('');
        }

        function resetEventForm() {
            const editingIdEl = document.getElementById('editingEventId');
            if (editingIdEl) editingIdEl.value = '';
            const titleEl = document.getElementById('formModeTitle');
            if (titleEl) titleEl.textContent = '📅 새 일정 등록';
            const btnEl = document.getElementById('btnSubmitEvent');
            if (btnEl) btnEl.textContent = '일정 저장';
            const dateInput = document.getElementById('inputEventDate');
            if (dateInput) dateInput.value = selectedDateStr;
            const titleInput = document.getElementById('inputEventTitle');
            if (titleInput) titleInput.value = '';
            const memoInput = document.getElementById('inputEventMemo');
            if (memoInput) memoInput.value = '';
            const allDayCheck = document.getElementById('inputEventAllDay');
            if (allDayCheck) allDayCheck.checked = false;
            const timeInput = document.getElementById('inputEventTime');
            if (timeInput) timeInput.value = '';
            toggleAllDayMode();
            const catSelect = document.getElementById('inputEventCategorySelect');
            if (catSelect && catSelect.options.length > 0) catSelect.selectedIndex = 0;
            const notifyTiming = document.getElementById('inputEventNotifyTiming');
            if (notifyTiming) notifyTiming.value = 'exact';
            const notifyRepeat = document.getElementById('inputEventNotifyRepeat');
            if (notifyRepeat) notifyRepeat.value = '1';
            if (typeof hideTitleAutocomplete === 'function') {
                hideTitleAutocomplete();
            }
        }

        function cancelEventForm() {
            resetEventForm();
            toggleAddForm(false);
        }

        function toggleAddForm(forceOpen = null) {
            const formCard = document.getElementById('addEventFormCard');
            const isHidden = formCard.style.display === 'none';
            const shouldOpen = forceOpen !== null ? forceOpen : isHidden;
            if (shouldOpen) {
                // 수정 중인 상태에서 상단 [+ 일정 추가]를 누르면 신규 등록 모드로 초기화
                if (forceOpen === null && document.getElementById('editingEventId')?.value) {
                    resetEventForm();
                } else if (!document.getElementById('editingEventId')?.value) {
                    const dateInput = document.getElementById('inputEventDate');
                    if (dateInput) dateInput.value = selectedDateStr;
                }
            }
            formCard.style.display = shouldOpen ? 'block' : 'none';
            if (shouldOpen) {
                const titleInput = document.getElementById('inputEventTitle');
                titleInput.focus();
                // 폼 열릴 때 최근/자주 사용하는 추천 일정 즉시 표시 (신규 등록 시)
                if (!document.getElementById('editingEventId')?.value) {
                    if (typeof searchEventTemplates === 'function' && typeof renderAutocompleteDropdown === 'function') {
                        const matches = searchEventTemplates(titleInput.value);
                        renderAutocompleteDropdown(matches, titleInput.value);
                    }
                }
            } else {
                if (typeof hideTitleAutocomplete === 'function') {
                    hideTitleAutocomplete();
                }
            }
        }

        function openEditEvent(dbId) {
            const ev = allEvents.find(e => e.type === 'personal' && e.dbId === dbId);
            if (!ev) {
                alert('해당 일정을 찾을 수 없습니다.');
                return;
            }

            const editingIdEl = document.getElementById('editingEventId');
            if (editingIdEl) editingIdEl.value = String(dbId);
            const titleEl = document.getElementById('formModeTitle');
            if (titleEl) titleEl.textContent = '✏️ 일정 수정';
            const btnEl = document.getElementById('btnSubmitEvent');
            if (btnEl) btnEl.textContent = '수정 완료';

            const dateInput = document.getElementById('inputEventDate');
            if (dateInput) dateInput.value = ev.date || selectedDateStr;

            const titleInput = document.getElementById('inputEventTitle');
            if (titleInput) titleInput.value = ev.title || '';

            const memoInput = document.getElementById('inputEventMemo');
            if (memoInput) memoInput.value = ev.memo || '';

            const allDayCheckbox = document.getElementById('inputEventAllDay');
            if (allDayCheckbox) allDayCheckbox.checked = !!ev.isAllDay;
            toggleAllDayMode();

            const timeInput = document.getElementById('inputEventTime');
            if (timeInput) timeInput.value = ev.time || '';

            const catSelect = document.getElementById('inputEventCategorySelect');
            if (catSelect) {
                for (let i = 0; i < catSelect.options.length; i++) {
                    if (catSelect.options[i].value === ev.category) {
                        catSelect.selectedIndex = i;
                        break;
                    }
                }
            }

            const timingSelect = document.getElementById('inputEventNotifyTiming');
            if (timingSelect) {
                timingSelect.value = ev.notifyTiming || 'exact';
            }

            const repeatSelect = document.getElementById('inputEventNotifyRepeat');
            if (repeatSelect) {
                repeatSelect.value = String(ev.notifyRepeat || 1);
            }

            if (typeof hideTitleAutocomplete === 'function') {
                hideTitleAutocomplete();
            }

            // 폼 열기 및 스크롤
            const formCard = document.getElementById('addEventFormCard');
            formCard.style.display = 'block';
            formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (titleInput) titleInput.focus();
        }

        async function submitEventForm() {
            const editingId = document.getElementById('editingEventId')?.value;
            const titleInput = document.getElementById('inputEventTitle');
            const dateInput = document.getElementById('inputEventDate');
            const isAllDay = document.getElementById('inputEventAllDay').checked;
            const timeInput = document.getElementById('inputEventTime');
            const categorySelect = document.getElementById('inputEventCategorySelect');
            const notifyTimingSelect = document.getElementById('inputEventNotifyTiming');
            const notifyRepeatSelect = document.getElementById('inputEventNotifyRepeat');
            const memoInput = document.getElementById('inputEventMemo');

            const title = titleInput.value.trim();
            if (!title) {
                alert('일정 제목을 입력해 주세요.');
                titleInput.focus();
                return;
            }

            const eventDate = (dateInput && dateInput.value) ? dateInput.value : selectedDateStr;
            if (!eventDate) {
                alert('일정 날짜를 선택해 주세요.');
                return;
            }

            const selectedOpt = categorySelect.options[categorySelect.selectedIndex];
            const categoryName = selectedOpt ? selectedOpt.value : '일반';
            const categoryColor = selectedOpt ? selectedOpt.getAttribute('data-color') : '#6366f1';

            const payload = {
                title,
                event_date: eventDate,
                event_time: isAllDay ? '' : timeInput.value,
                category: categoryName,
                color: categoryColor,
                memo: memoInput.value,
                is_all_day: isAllDay ? 1 : 0,
                notify_timing: notifyTimingSelect.value,
                notify_repeat: parseInt(notifyRepeatSelect.value, 10) || 1
            };

            const isEdit = !!editingId;
            const url = isEdit ? `/api/calendar/events/${editingId}` : '/api/calendar/events';
            const method = isEdit ? 'PUT' : 'POST';

            try {
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    resetEventForm();
                    toggleAddForm(false);
                    // 수정된 날짜로 이동하여 바로 확인 가능하게 처리
                    selectedDateStr = eventDate;
                    const [ny, nm] = eventDate.split('-').map(Number);
                    if (!isNaN(ny) && !isNaN(nm)) {
                        currentYear = ny;
                        currentMonth = nm - 1;
                    }
                    await fetchEvents();
                } else {
                    alert((isEdit ? '수정' : '등록') + ' 실패: ' + (data.message || '오류 발생'));
                }
            } catch (e) {
                alert('통신 오류: ' + e.message);
            }
        }

        // 구버전 호출 호환
        function submitNewEvent() {
            return submitEventForm();
        }

        async function deleteEvent(id) {
            if (!confirm('이 일정을 삭제할까요?')) return;
            try {
                const res = await fetch('/api/calendar/events/' + id, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    await fetchEvents();
                }
            } catch (e) {
                alert('삭제 오류: ' + e.message);
            }
        }

        async function toggleEventComplete(id) {
            try {
                await fetch('/api/calendar/events/' + id + '/toggle', { method: 'PATCH' });
                await fetchEvents();
            } catch (e) {
                console.error('완료 토글 오류:', e);
            }
        }

        function prevMonth() {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendar();
        }

        function nextMonth() {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendar();
        }

        function goToday() {
            const today = new Date();
            currentYear = today.getFullYear();
            currentMonth = today.getMonth();
            selectedDateStr = today.toISOString().slice(0, 10);
            renderCalendar();
            renderSelectedDateEvents();
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/[&<>"']/g, function(m) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
            });
        }


        document.addEventListener('DOMContentLoaded', () => {
            fetchCategories();
            fetchEvents();
            initTitleAutocomplete();
        });
