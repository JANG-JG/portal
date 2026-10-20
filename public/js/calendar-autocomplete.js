        // =========================================================================
        // 💡 일정 제목 자동완성 (기존 등록 데이터 기반 초성/유사도 추천)
        // =========================================================================
        const HANGUL_CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

        function getChosung(str) {
            if (!str) return '';
            let result = '';
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                if (code >= 0xAC00 && code <= 0xD7A3) {
                    const chosungIndex = Math.floor((code - 0xAC00) / 28 / 21);
                    result += HANGUL_CHOSUNG[chosungIndex];
                } else {
                    result += str.charAt(i);
                }
            }
            return result;
        }

        function isPureChosung(str) {
            if (!str) return false;
            for (let i = 0; i < str.length; i++) {
                const ch = str.charAt(i);
                if (ch !== ' ' && !HANGUL_CHOSUNG.includes(ch)) return false;
            }
            return true;
        }

        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function getHistoricalEventTemplates() {
            const templateMap = new Map();

            allEvents.forEach(ev => {
                if (!ev || !ev.title) return;
                const cleanTitle = ev.title.trim();
                if (!cleanTitle) return;

                const key = cleanTitle.toLowerCase();
                if (templateMap.has(key)) {
                    const existing = templateMap.get(key);
                    existing.count += 1;
                    if (ev.date && (!existing.lastDate || ev.date > existing.lastDate)) {
                        existing.lastDate = ev.date;
                        if (ev.category) existing.category = ev.category;
                        if (ev.color) existing.color = ev.color;
                        if (ev.time) existing.time = ev.time;
                        existing.isAllDay = !!ev.isAllDay;
                        if (ev.notifyTiming) existing.notifyTiming = ev.notifyTiming;
                        if (ev.notifyRepeat) existing.notifyRepeat = ev.notifyRepeat;
                        if (ev.memo) existing.memo = ev.memo;
                    }
                } else {
                    templateMap.set(key, {
                        title: cleanTitle,
                        category: ev.category || '일반',
                        color: ev.color || '#6366f1',
                        time: ev.time || '',
                        isAllDay: !!ev.isAllDay,
                        notifyTiming: ev.notifyTiming || 'exact',
                        notifyRepeat: ev.notifyRepeat || 1,
                        memo: ev.memo || '',
                        lastDate: ev.date || '',
                        count: 1
                    });
                }
            });

            return Array.from(templateMap.values());
        }

        function searchEventTemplates(query) {
            const templates = getHistoricalEventTemplates();
            const q = (query || '').trim().toLowerCase();

            // 입력어가 없으면: 자주 사용한 항목 / 최근 항목 상위 5개 표시
            if (!q) {
                return templates
                    .sort((a, b) => (b.count - a.count) || (b.lastDate.localeCompare(a.lastDate)))
                    .slice(0, 5);
            }

            const qChosung = getChosung(q);
            const isChosungOnly = isPureChosung(q);
            const scored = [];

            templates.forEach(t => {
                const tTitle = t.title.toLowerCase();
                const tChosung = getChosung(tTitle);
                let score = 0;

                if (tTitle === q) {
                    score = 100;
                } else if (tTitle.startsWith(q)) {
                    score = 80;
                } else if (tTitle.includes(q)) {
                    score = 60;
                } else if (isChosungOnly && tChosung.includes(q)) {
                    score = 50;
                } else if (tChosung.includes(qChosung)) {
                    score = 40;
                } else if (t.memo && t.memo.toLowerCase().includes(q)) {
                    score = 25;
                } else if (t.category && t.category.toLowerCase().includes(q)) {
                    score = 20;
                }

                if (score > 0) {
                    score += Math.min(t.count * 2, 10);
                    scored.push({ template: t, score });
                }
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, 6)
                .map(s => s.template);
        }

        let activeAutocompleteIndex = -1;
        let currentAutocompleteMatches = [];

        function renderAutocompleteDropdown(matches, query) {
            const dropdown = document.getElementById('titleAutocompleteDropdown');
            if (!dropdown) return;

            currentAutocompleteMatches = matches || [];
            activeAutocompleteIndex = -1;

            if (!matches || matches.length === 0) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                return;
            }

            const q = (query || '').trim();
            const headerText = q ? `🔍 추천 일정 ${matches.length}개 (선택 시 자동 완성)` : `💡 최근 및 자주 등록한 일정 (${matches.length}개)`;

            let html = `
                <div class="autocomplete-header">
                    <span>${escapeHtml(headerText)}</span>
                    <span style="font-size:0.65rem; color:#94a3b8;">키보드 ↑↓ / Enter 선택</span>
                </div>
                <div class="autocomplete-list">
            `;

            matches.forEach((item, index) => {
                let displayTitle = escapeHtml(item.title);
                if (q) {
                    try {
                        const regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
                        displayTitle = displayTitle.replace(regex, '<span class="autocomplete-match">$1</span>');
                    } catch(e) {}
                }

                const categoryTag = `<span class="autocomplete-badge" style="background-color: ${item.color || '#6366f1'};">${escapeHtml(item.category || '일반')}</span>`;
                const timeTag = item.isAllDay ? '☀️ 종일' : (item.time ? `⏰ ${item.time}` : '');
                const countTag = item.count > 1 ? `자주 사용 (${item.count}회)` : '';
                const metaParts = [timeTag, countTag].filter(Boolean).join(' • ');
                const memoSnippet = item.memo ? `<div style="font-size:0.7rem; color:#64748b; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📝 ${escapeHtml(item.memo)}</div>` : '';

                html += `
                    <div class="autocomplete-item" data-index="${index}" onmousedown="onAutocompleteItemClick(event, ${index})">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                                <span class="autocomplete-title">${displayTitle}</span>
                                ${categoryTag}
                            </div>
                            ${metaParts ? `<div class="autocomplete-meta">${escapeHtml(metaParts)}</div>` : ''}
                            ${memoSnippet}
                        </div>
                        <div style="shrink-0; font-size: 0.72rem; color: #4f46e5; font-weight: 700;">
                            선택 ↵
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
        }

        function updateAutocompleteActiveItem(items) {
            items.forEach((item, idx) => {
                if (idx === activeAutocompleteIndex) {
                    item.classList.add('active');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('active');
                }
            });
        }

        function onAutocompleteItemClick(e, index) {
            e.preventDefault();
            if (index >= 0 && index < currentAutocompleteMatches.length) {
                applyAutocomplete(currentAutocompleteMatches[index]);
            }
        }

        function applyAutocomplete(template) {
            if (!template) return;
            const titleInput = document.getElementById('inputEventTitle');
            const isAllDayCb = document.getElementById('inputEventAllDay');
            const timeInput = document.getElementById('inputEventTime');
            const catSelect = document.getElementById('inputEventCategorySelect');
            const notifyTimingSelect = document.getElementById('inputEventNotifyTiming');
            const notifyRepeatSelect = document.getElementById('inputEventNotifyRepeat');
            const memoInput = document.getElementById('inputEventMemo');

            titleInput.value = template.title;

            if (template.category && catSelect) {
                for (let i = 0; i < catSelect.options.length; i++) {
                    if (catSelect.options[i].value === template.category) {
                        catSelect.selectedIndex = i;
                        if (typeof onCategorySelectChange === 'function') onCategorySelectChange();
                        break;
                    }
                }
            }

            if (isAllDayCb) {
                isAllDayCb.checked = !!template.isAllDay;
                if (typeof toggleAllDayMode === 'function') toggleAllDayMode();
            }
            if (!template.isAllDay && template.time && timeInput) {
                timeInput.value = template.time;
            }

            if (template.notifyTiming && notifyTimingSelect) {
                notifyTimingSelect.value = template.notifyTiming;
            }
            if (template.notifyRepeat && notifyRepeatSelect) {
                notifyRepeatSelect.value = String(template.notifyRepeat);
            }

            if (template.memo && memoInput) {
                memoInput.value = template.memo;
            }

            hideTitleAutocomplete();
            showAutocompleteToast(`'${template.title}' 일정 내용이 자동 입력되었습니다 ✨`);
        }

        function hideTitleAutocomplete() {
            const dropdown = document.getElementById('titleAutocompleteDropdown');
            if (dropdown) dropdown.style.display = 'none';
            activeAutocompleteIndex = -1;
        }

        function showAutocompleteToast(msg) {
            let toast = document.getElementById('calToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'calToast';
                toast.style.cssText = 'position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px); background: #1e293b; color: #ffffff; padding: 0.65rem 1.15rem; border-radius: 2rem; font-size: 0.8rem; font-weight: 700; box-shadow: 0 10px 25px rgba(0,0,0,0.25); opacity: 0; pointer-events: none; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); z-index: 9999; display: flex; align-items: center; gap: 0.4rem; border: 1px solid rgba(255,255,255,0.1);';
                document.body.appendChild(toast);
            }
            toast.innerHTML = `<span>✨</span><span>${escapeHtml(msg)}</span>`;
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
            clearTimeout(toast._timeout);
            toast._timeout = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(20px)';
            }, 2400);
        }

        function initTitleAutocomplete() {
            const titleInput = document.getElementById('inputEventTitle');
            const dropdown = document.getElementById('titleAutocompleteDropdown');
            if (!titleInput || !dropdown) return;

            titleInput.addEventListener('input', () => {
                const matches = searchEventTemplates(titleInput.value);
                renderAutocompleteDropdown(matches, titleInput.value);
            });

            titleInput.addEventListener('focus', () => {
                const matches = searchEventTemplates(titleInput.value);
                renderAutocompleteDropdown(matches, titleInput.value);
            });

            titleInput.addEventListener('keydown', (e) => {
                if (dropdown.style.display === 'none' || currentAutocompleteMatches.length === 0) {
                    return;
                }

                const items = dropdown.querySelectorAll('.autocomplete-item');

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeAutocompleteIndex = (activeAutocompleteIndex + 1) % items.length;
                    updateAutocompleteActiveItem(items);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeAutocompleteIndex = (activeAutocompleteIndex - 1 + items.length) % items.length;
                    updateAutocompleteActiveItem(items);
                } else if (e.key === 'Enter') {
                    if (activeAutocompleteIndex >= 0 && activeAutocompleteIndex < currentAutocompleteMatches.length) {
                        e.preventDefault();
                        applyAutocomplete(currentAutocompleteMatches[activeAutocompleteIndex]);
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    hideTitleAutocomplete();
                }
            });

            document.addEventListener('click', (e) => {
                if (!titleInput.contains(e.target) && !dropdown.contains(e.target)) {
                    hideTitleAutocomplete();
                }
            });
        }
