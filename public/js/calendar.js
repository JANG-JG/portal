        let currentYear = new Date().getFullYear();
        let currentMonth = new Date().getMonth(); // 0-indexed
        let selectedDateStr = new Date().toISOString().slice(0, 10);
        let allEvents = [];
        let currentUsername = '';
        let currentUserRole = '';

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

        function selectDate(dateStr, openModalOnMobile = true) {
            selectedDateStr = dateStr;
            renderCalendar();
            renderSelectedDateEvents();
            if (openModalOnMobile && window.innerWidth <= 1023) {
                openMobileScheduleModal();
            }
        }

        function openMobileScheduleModal() {
            const card = document.getElementById('scheduleDetailCard');
            const backdrop = document.getElementById('scheduleModalBackdrop');
            if (card) card.classList.add('mobile-modal-open');
            if (backdrop) backdrop.classList.add('active');
        }

        function closeMobileScheduleModal() {
            const card = document.getElementById('scheduleDetailCard');
            const backdrop = document.getElementById('scheduleModalBackdrop');
            if (card) card.classList.remove('mobile-modal-open');
            if (backdrop) backdrop.classList.remove('active');
            cancelEventForm();
        }

        function formatLocalIsoDate(dateObj) {
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        // 어제(-1) / 내일(+1) 날짜 이동 (모달 내 버튼 및 좌우 스와이프 연동)
        function shiftSelectedDate(offsetDays) {
            const [y, m, d] = selectedDateStr.split('-').map(Number);
            const target = new Date(y, m - 1, d + offsetDays);
            const nextDateStr = formatLocalIsoDate(target);

            currentYear = target.getFullYear();
            currentMonth = target.getMonth();
            selectedDateStr = nextDateStr;

            renderCalendar();
            renderSelectedDateEvents();
        }

        function renderSelectedDateEvents() {
            const display = document.getElementById('selectedDateDisplay');
            const subtext = document.getElementById('selectedDateSubtext');
            const list = document.getElementById('selectedDateEventsList');
            const dateInput = document.getElementById('inputEventDate');
            const prevBtn = document.getElementById('btnPrevDay');
            const nextBtn = document.getElementById('btnNextDay');

            const [y, m, d] = selectedDateStr.split('-').map(Number);
            const selDateObj = new Date(y, m - 1, d);
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            const dowName = dayNames[selDateObj.getDay()];

            display.textContent = `${y}년 ${m}월 ${d}일 (${dowName}) 일정`;

            // 어제 / 내일 버튼 라벨에 날짜 표시
            if (prevBtn && nextBtn) {
                const prevObj = new Date(y, m - 1, d - 1);
                const nextObj = new Date(y, m - 1, d + 1);
                prevBtn.textContent = `‹ 어제 (${prevObj.getMonth() + 1}/${prevObj.getDate()})`;
                nextBtn.textContent = `내일 (${nextObj.getMonth() + 1}/${nextObj.getDate()}) ›`;
            }

            if (dateInput && !document.getElementById('editingEventId')?.value) {
                dateInput.value = selectedDateStr;
            }

            const dayEvents = allEvents.filter(ev => ev.date === selectedDateStr);
            if (subtext) {
                subtext.textContent = dayEvents.length > 0
                    ? `총 ${dayEvents.length}건의 일정이 있습니다.`
                    : '일정을 추가하거나 완료 체크하세요.';
            }

            if (dayEvents.length === 0) {
                list.innerHTML = `
                    <div style="text-align: center; padding: 2.2rem 1rem; color: #94a3b8; font-size: 0.85rem;">
                        <span style="font-size: 1.85rem; display: block; margin-bottom: 0.45rem;">🏖️</span>
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

                // 가족 공유 뱃지
                const familyBadge = ev.isFamily ? `
                    <span style="font-size:0.68rem; font-weight:700; background:#fdf2f8; color:#db2777; border:1px solid #fbcfe8; padding:1px 5px; border-radius:3px; margin-right:0.35rem;">
                        👨‍👩‍👧‍👦 가족공유
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

                // 서비스 바로가기 또는 관리 버튼 생성 (본인 일정 또는 관리자만 수정/삭제 가능)
                let actionBtn = '';
                const canManage = isPersonal && (!ev.userId || ev.userId === currentUsername || currentUserRole === 'admin');
                if (canManage) {
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
                                    ${familyBadge}
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


        // 모바일 상세 일정 모달 및 달력 좌우 스와이프 제스처 바인딩
        function initScheduleModalSwipe() {
            const modalCard = document.getElementById('scheduleDetailCard');
            if (!modalCard) return;

            let startX = 0;
            let startY = 0;
            let isSwiping = false;

            modalCard.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                // 입력 폼 컨트롤 위에서 터치한 경우는 스와이프 제외
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                    isSwiping = false;
                    return;
                }
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                isSwiping = true;
            }, { passive: true });

            modalCard.addEventListener('touchend', (e) => {
                if (!isSwiping || e.changedTouches.length !== 1) return;
                isSwiping = false;

                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const dx = endX - startX;
                const dy = endY - startY;

                // 가로 이동 거리가 50px 이상이고 세로 스크롤보다 1.5배 이상 클 때만 어제/내일 전환
                if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    if (dx < 0) {
                        // 왼쪽으로 밀기 -> 내일(+1일) 일정
                        shiftSelectedDate(1);
                    } else {
                        // 오른쪽으로 밀기 -> 어제(-1일) 일정
                        shiftSelectedDate(-1);
                    }
                }
            }, { passive: true });

            // ESC 키로 모바일 상세 모달 닫기
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modalCard.classList.contains('mobile-modal-open')) {
                    closeMobileScheduleModal();
                }
            });
        }

        async function fetchCurrentUser() {
            try {
                const res = await fetch('/api/me');
                const data = await res.json();
                if (data.success) {
                    currentUsername = data.username || '';
                    currentUserRole = data.role || '';
                }
            } catch (e) {}
        }

        document.addEventListener('DOMContentLoaded', async () => {
            await fetchCurrentUser();
            fetchCategories();
            fetchEvents();
            initTitleAutocomplete();
            initScheduleModalSwipe();
        });

