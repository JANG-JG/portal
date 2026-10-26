/**
 * 📅 JG 포털 스마트 캘린더 - 일정 폼 & CRUD 제어 모듈
 * calendar-events.js
 */

// 1. 종일 모드 토글
function toggleAllDayMode() {
    const isAllDayEl = document.getElementById('inputEventAllDay');
    if (!isAllDayEl) return;
    const isAllDay = isAllDayEl.checked;
    const timeWrapper = document.getElementById('timeInputWrapper');
    const timingSelect = document.getElementById('inputEventNotifyTiming');
    if (!timeWrapper || !timingSelect) return;

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

// 2. 폼 초기화 & 취소
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
    const isFamilyCheck = document.getElementById('inputEventIsFamily');
    if (isFamilyCheck) isFamilyCheck.checked = false;
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

// 3. 등록 폼 열기/닫기 토글
function toggleAddForm(forceOpen = null) {
    const formCard = document.getElementById('addEventFormCard');
    if (!formCard) return;
    const isHidden = formCard.style.display === 'none';
    const shouldOpen = forceOpen !== null ? forceOpen : isHidden;
    if (shouldOpen) {
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
        if (titleInput) {
            titleInput.focus();
            if (!document.getElementById('editingEventId')?.value) {
                if (typeof searchEventTemplates === 'function' && typeof renderAutocompleteDropdown === 'function') {
                    const matches = searchEventTemplates(titleInput.value);
                    renderAutocompleteDropdown(matches, titleInput.value);
                }
            }
        }
    } else {
        if (typeof hideTitleAutocomplete === 'function') {
            hideTitleAutocomplete();
        }
    }
}

// 4. 일정 수정 폼 열기
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

    const isFamilyCheckbox = document.getElementById('inputEventIsFamily');
    if (isFamilyCheckbox) isFamilyCheckbox.checked = !!ev.isFamily;

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

    const formCard = document.getElementById('addEventFormCard');
    if (formCard) {
        formCard.style.display = 'block';
        formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (titleInput) titleInput.focus();
}

// 5. 일정 저장 (신규 등록 및 수정)
async function submitEventForm() {
    const editingId = document.getElementById('editingEventId')?.value;
    const titleInput = document.getElementById('inputEventTitle');
    const dateInput = document.getElementById('inputEventDate');
    const isAllDay = document.getElementById('inputEventAllDay')?.checked;
    const isFamily = document.getElementById('inputEventIsFamily')?.checked ? 1 : 0;
    const timeInput = document.getElementById('inputEventTime');
    const categorySelect = document.getElementById('inputEventCategorySelect');
    const notifyTimingSelect = document.getElementById('inputEventNotifyTiming');
    const notifyRepeatSelect = document.getElementById('inputEventNotifyRepeat');
    const memoInput = document.getElementById('inputEventMemo');

    const title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
        alert('일정 제목을 입력해 주세요.');
        if (titleInput) titleInput.focus();
        return;
    }

    const eventDate = (dateInput && dateInput.value) ? dateInput.value : selectedDateStr;
    if (!eventDate) {
        alert('일정 날짜를 선택해 주세요.');
        return;
    }

    const selectedOpt = categorySelect ? categorySelect.options[categorySelect.selectedIndex] : null;
    const categoryName = selectedOpt ? selectedOpt.value : '일반';
    const categoryColor = selectedOpt ? selectedOpt.getAttribute('data-color') : '#6366f1';

    const payload = {
        title,
        event_date: eventDate,
        event_time: isAllDay ? '' : (timeInput ? timeInput.value : ''),
        category: categoryName,
        color: categoryColor,
        memo: memoInput ? memoInput.value : '',
        is_all_day: isAllDay ? 1 : 0,
        is_family: isFamily,
        notify_timing: notifyTimingSelect ? notifyTimingSelect.value : 'exact',
        notify_repeat: parseInt(notifyRepeatSelect ? notifyRepeatSelect.value : '1', 10) || 1
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
            selectedDateStr = eventDate;
            const [ny, nm] = eventDate.split('-').map(Number);
            if (!isNaN(ny) && !isNaN(nm)) {
                currentYear = ny;
                currentMonth = nm - 1;
            }
            if (typeof fetchEvents === 'function') await fetchEvents();
        } else {
            alert((isEdit ? '수정' : '등록') + ' 실패: ' + (data.message || '오류 발생'));
        }
    } catch (e) {
        alert('통신 오류: ' + e.message);
    }
}

function submitNewEvent() {
    return submitEventForm();
}

// 6. 일정 삭제
async function deleteEvent(id) {
    if (!confirm('이 일정을 삭제할까요?')) return;
    try {
        const res = await fetch('/api/calendar/events/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            if (typeof fetchEvents === 'function') await fetchEvents();
        }
    } catch (e) {
        alert('삭제 오류: ' + e.message);
    }
}

// 7. 완료 상태 토글
async function toggleEventComplete(id) {
    try {
        await fetch('/api/calendar/events/' + id + '/toggle', { method: 'PATCH' });
        if (typeof fetchEvents === 'function') await fetchEvents();
    } catch (e) {
        console.error('완료 토글 오류:', e);
    }
}
