        let currentQsQuery = '';
        let currentQsCategory = 'all';
        let qsSearchDebounceTimer = null;
        let qsLastResults = null;
        let qsFocusedIndex = -1;

        // 플랫폼별 단축키 감지 (Mac: ⌘K, 기타: Ctrl+K)
        document.addEventListener('DOMContentLoaded', () => {
            const isMac = navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const kbdElem = document.getElementById('qsPlatformKbd');
            if (kbdElem && isMac) {
                kbdElem.textContent = '⌘';
            }

            const qsInput = document.getElementById('qsInput');
            if (qsInput) {
                qsInput.addEventListener('input', (e) => {
                    const q = e.target.value.trim();
                    const clearBtn = document.getElementById('qsClearBtn');
                    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

                    clearTimeout(qsSearchDebounceTimer);
                    if (!q) {
                        currentQsQuery = '';
                        qsLastResults = null;
                        renderQsInitialState();
                        return;
                    }

                    // 200ms 디바운스 검색
                    qsSearchDebounceTimer = setTimeout(() => {
                        performQuickSearch(q);
                    }, 200);
                });

                qsInput.addEventListener('keydown', handleQsKeyNavigation);
            }
        });

        // 글로벌 단축키 바인딩 (Ctrl+K, Cmd+K, /)
        window.addEventListener('keydown', (e) => {
            const modal = document.getElementById('qsModalBackdrop');
            const isOpen = modal && modal.classList.contains('active');

            if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                if (isOpen) {
                    closeQuickSearchModal();
                } else {
                    openQuickSearchModal();
                }
                return;
            }

            if (e.key === '/' && !isOpen) {
                const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
                const isInput = tag === 'input' || tag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable);
                if (!isInput) {
                    e.preventDefault();
                    openQuickSearchModal();
                    return;
                }
            }

            if (e.key === 'Escape' && isOpen) {
                e.preventDefault();
                closeQuickSearchModal();
            }
        });

        function openQuickSearchModal() {
            const modal = document.getElementById('qsModalBackdrop') || document.getElementById('quickSearchModal');
            const input = document.getElementById('qsInput');
            if (!modal) return;
            modal.classList.add('active');
            modal.classList.add('open');
            modal.style.setProperty('display', 'flex', 'important');
            document.body.style.overflow = 'hidden';
            setTimeout(() => {
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 50);
        }
        window.openQuickSearchModal = openQuickSearchModal;

        function closeQuickSearchModal() {
            const modal = document.getElementById('qsModalBackdrop') || document.getElementById('quickSearchModal');
            if (!modal) return;
            modal.classList.remove('active');
            modal.classList.remove('open');
            modal.style.setProperty('display', 'none', 'important');
            document.body.style.overflow = '';
            qsFocusedIndex = -1;
        }
        window.closeQuickSearchModal = closeQuickSearchModal;

        function handleQsBackdropClick(e) {
            if (e.target.id === 'qsModalBackdrop' || e.target.classList.contains('qs-modal-backdrop') || e.target.id === 'quickSearchModal') {
                closeQuickSearchModal();
            }
        }
        window.handleQsBackdropClick = handleQsBackdropClick;

        function clearQsInput() {
            const input = document.getElementById('qsInput');
            if (input) {
                input.value = '';
                input.focus();
            }
            const clearBtn = document.getElementById('qsClearBtn');
            if (clearBtn) clearBtn.style.display = 'none';
            currentQsQuery = '';
            qsLastResults = null;
            renderQsInitialState();
        }
        window.clearQsInput = clearQsInput;

        function selectQsCategory(cat) {
            currentQsCategory = cat;
            document.querySelectorAll('#qsTabs .qs-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.category === cat);
            });
            if (qsLastResults) {
                renderQsResults(qsLastResults, currentQsQuery);
            }
        }

        function renderQsInitialState() {
            document.getElementById('qsInitialState').style.display = 'block';
            document.getElementById('qsResultsList').style.display = 'none';
            document.getElementById('qsNoResults').style.display = 'none';
            document.getElementById('qsLoading').style.display = 'none';
            resetBadgeCounts({ total: 0, memos: [], news: [], hospitals: [], assets: [] });
            qsFocusedIndex = -1;
        }

        function resetBadgeCounts(data) {
            const mCount = (data.memos || []).length;
            const nCount = (data.news || []).length;
            const hCount = (data.hospitals || []).length;
            const aCount = (data.assets || []).length;
            const total = (data.total !== undefined) ? data.total : (mCount + nCount + hCount + aCount);

            document.getElementById('qsBadgeAll').textContent = total;
            document.getElementById('qsBadgeMemo').textContent = mCount;
            document.getElementById('qsBadgeNews').textContent = nCount;
            document.getElementById('qsBadgeHospital').textContent = hCount;
            document.getElementById('qsBadgeAsset').textContent = aCount;
        }

        async function performQuickSearch(query) {
            currentQsQuery = query;
            document.getElementById('qsInitialState').style.display = 'none';
            document.getElementById('qsNoResults').style.display = 'none';
            document.getElementById('qsResultsList').style.display = 'none';
            document.getElementById('qsLoading').style.display = 'block';

            try {
                const res = await fetch(`/api/search/unified?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                document.getElementById('qsLoading').style.display = 'none';

                if (!data.success) {
                    throw new Error(data.message || '검색 실패');
                }

                qsLastResults = data.results || { memos: [], news: [], hospitals: [], assets: [] };
                resetBadgeCounts({
                    total: data.total || 0,
                    memos: qsLastResults.memos,
                    news: qsLastResults.news,
                    hospitals: qsLastResults.hospitals,
                    assets: qsLastResults.assets
                });

                if (data.total === 0) {
                    document.getElementById('qsNoResultsQuery').textContent = `‘${query}’에 대한 검색 결과가 없습니다.`;
                    document.getElementById('qsNoResults').style.display = 'block';
                    document.getElementById('qsResultsList').style.display = 'none';
                } else {
                    renderQsResults(qsLastResults, query);
                }
            } catch (err) {
                console.error('[QuickSearch Error]:', err);
                document.getElementById('qsLoading').style.display = 'none';
                document.getElementById('qsNoResultsQuery').textContent = '검색 중 오류가 발생했습니다.';
                document.getElementById('qsNoResults').style.display = 'block';
            }
        }

        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function highlightMatch(text, query) {
            if (!text || !query) return (text || '');
            const safeText = String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            const cleanQuery = query.trim();
            if (!cleanQuery) return safeText;
            const regex = new RegExp(`(${escapeRegExp(cleanQuery)})`, 'gi');
            return safeText.replace(regex, '<mark class="qs-highlight">$1</mark>');
        }

        function renderQsResults(results, query) {
            const listEl = document.getElementById('qsResultsList');
            const noResultsEl = document.getElementById('qsNoResults');
            listEl.innerHTML = '';
            qsFocusedIndex = -1;

            const memos = results.memos || [];
            const news = results.news || [];
            const hospitals = results.hospitals || [];
            const assets = results.assets || [];

            let renderedCount = 0;

            // 1. 메모 섹션
            if ((currentQsCategory === 'all' || currentQsCategory === 'memo') && memos.length > 0) {
                const sec = document.createElement('div');
                sec.className = 'qs-section';
                sec.innerHTML = `<div class="qs-section-title"><span>📝</span> 포털 메모 (${memos.length}건)</div>`;
                
                memos.forEach(m => {
                    const item = document.createElement('a');
                    item.className = 'qs-item';
                    item.href = `/memo`;
                    const catMap = { idea: '아이디어', todo: '할 일', memo: '메모', important: '중요' };
                    const catName = catMap[m.category] || '메모';
                    const titleHtml = highlightMatch(m.title || '(제목 없음)', query);
                    const contentHtml = highlightMatch(m.content || '', query);
                    const dateStr = (m.updated_at || '').slice(0, 16);

                    item.innerHTML = `
                        <div class="qs-item-top">
                            <span class="qs-item-title">${m.is_pinned ? '📌 ' : ''}${titleHtml}</span>
                            <span class="qs-item-badge" style="background:#fef3c7; color:#92400e;">${catName}</span>
                        </div>
                        <div class="qs-item-desc">${contentHtml}</div>
                        <div class="qs-item-meta">
                            <span>🕒 ${dateStr}</span>
                            <span>•</span>
                            <span style="color:#2563eb;">메모장 열기 ↗</span>
                        </div>
                    `;
                    sec.appendChild(item);
                    renderedCount++;
                });
                listEl.appendChild(sec);
            }

            // 2. 뉴스 브리핑 섹션
            if ((currentQsCategory === 'all' || currentQsCategory === 'news') && news.length > 0) {
                const sec = document.createElement('div');
                sec.className = 'qs-section';
                sec.innerHTML = `<div class="qs-section-title"><span>📰</span> 뉴스 브리핑 (${news.length}건)</div>`;

                news.forEach(n => {
                    const item = document.createElement('a');
                    item.className = 'qs-item';
                    item.href = n.link || 'https://news.j-jg.cc';
                    item.target = '_blank';
                    item.rel = 'noopener noreferrer';
                    const titleHtml = highlightMatch(n.title || '', query);
                    const descHtml = highlightMatch(n.summary || '', query);
                    const timeStr = n.published_at ? n.published_at.slice(0, 16) : n.date;

                    item.innerHTML = `
                        <div class="qs-item-top">
                            <span class="qs-item-title">${titleHtml}</span>
                            <span class="qs-item-badge" style="background:#dbeafe; color:#1e40af;">${n.category_name || '뉴스'}</span>
                        </div>
                        ${descHtml ? `<div class="qs-item-desc">${descHtml}</div>` : ''}
                        <div class="qs-item-meta">
                            <span>${n.media_name || '언론사'}</span>
                            <span>•</span>
                            <span>${timeStr}</span>
                            <span>•</span>
                            <span style="color:#2563eb;">원문 읽기 ↗</span>
                        </div>
                    `;
                    sec.appendChild(item);
                    renderedCount++;
                });
                listEl.appendChild(sec);
            }

            // 3. 병원 진료 일정 섹션
            if ((currentQsCategory === 'all' || currentQsCategory === 'hospital') && hospitals.length > 0) {
                const sec = document.createElement('div');
                sec.className = 'qs-section';
                sec.innerHTML = `<div class="qs-section-title"><span>🏥</span> 병원 진료 일정 (${hospitals.length}건)</div>`;

                hospitals.forEach(h => {
                    const item = document.createElement('a');
                    item.className = 'qs-item';
                    item.href = `https://blood.j-jg.cc/hospital.html`;
                    const hospNameHtml = highlightMatch(h.hospital_name || '병원', query);
                    const deptHtml = highlightMatch(h.department || '', query);
                    const memoHtml = highlightMatch(h.memo || '', query);

                    item.innerHTML = `
                        <div class="qs-item-top">
                            <span class="qs-item-title">${hospNameHtml} ${deptHtml ? `(${deptHtml})` : ''}</span>
                            <span class="qs-item-badge" style="background:#fee2e2; color:#991b1b;">진료</span>
                        </div>
                        ${memoHtml ? `<div class="qs-item-desc">${memoHtml}</div>` : ''}
                        <div class="qs-item-meta">
                            <span>진료일: ${h.visit_date || '-'}</span>
                            ${h.next_visit_date ? `<span>• 다음 예약: <b>${h.next_visit_date}</b></span>` : ''}
                            <span>•</span>
                            <span style="color:#dc2626;">병원 관리 ↗</span>
                        </div>
                    `;
                    sec.appendChild(item);
                    renderedCount++;
                });
                listEl.appendChild(sec);
            }

            // 4. 자산 및 종목 섹션
            if ((currentQsCategory === 'all' || currentQsCategory === 'asset') && assets.length > 0) {
                const sec = document.createElement('div');
                sec.className = 'qs-section';
                sec.innerHTML = `<div class="qs-section-title"><span>💰</span> 보유 자산 (${assets.length}건)</div>`;

                assets.forEach(a => {
                    const item = document.createElement('a');
                    item.className = 'qs-item';
                    item.href = `https://asset.j-jg.cc`;
                    const symHtml = highlightMatch(a.symbol || '', query);
                    const nameHtml = highlightMatch(a.full_name || a.symbol || '', query);

                    item.innerHTML = `
                        <div class="qs-item-top">
                            <span class="qs-item-title">${symHtml} - ${nameHtml}</span>
                            <span class="qs-item-badge" style="background:#dcfce7; color:#166534;">${a.asset_type || '주식'}</span>
                        </div>
                        <div class="qs-item-meta">
                            <span>보유 수량: <b>${a.quantity || 0}주</b></span>
                            <span>•</span>
                            <span>평단가: ${(a.avg_price || 0).toLocaleString()} ${a.currency || 'KRW'}</span>
                            <span>•</span>
                            <span style="color:#16a34a;">자산 앱 열기 ↗</span>
                        </div>
                    `;
                    sec.appendChild(item);
                    renderedCount++;
                });
                listEl.appendChild(sec);
            }

            if (renderedCount === 0) {
                noResultsEl.style.display = 'block';
                noResultsEl.querySelector('.qs-no-results-text').textContent = '해당 카테고리의 결과가 없습니다.';
                listEl.style.display = 'none';
            } else {
                noResultsEl.style.display = 'none';
                listEl.style.display = 'block';
            }
        }

        // 키보드 방향키 및 엔터 탐색 제어
        function handleQsKeyNavigation(e) {
            const items = document.querySelectorAll('#qsResultsList .qs-item');
            if (!items || items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                qsFocusedIndex = (qsFocusedIndex + 1) % items.length;
                updateQsFocus(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                qsFocusedIndex = (qsFocusedIndex - 1 + items.length) % items.length;
                updateQsFocus(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (qsFocusedIndex >= 0 && items[qsFocusedIndex]) {
                    items[qsFocusedIndex].click();
                } else if (items.length > 0) {
                    items[0].click();
                }
            }
        }

        function updateQsFocus(items) {
            items.forEach((item, idx) => {
                if (idx === qsFocusedIndex) {
                    item.classList.add('focused');
                    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    item.classList.remove('focused');
                }
            });
        }
