        // =====================================================================
        // 🌐 포털 메인 스와이프 슬라이더 & 카테고리 탭 연동 엔진
        // =====================================================================
        let currentPortalTab = 'home';

        // 🌟 스티키 탭 위치로 부드럽게 스크롤 정렬
        function scrollToPortalTab(force = false, smooth = true) {
            const anchor = document.getElementById('portal-tab-anchor');
            const tabEl = document.getElementById('portal-tab-bar');
            if (!anchor && !tabEl) return;

            const navHeader = document.querySelector('.unav-header') || document.getElementById('unified-nav-root');
            const navHeight = navHeader ? navHeader.getBoundingClientRect().height : 54;

            let baseTop = 0;
            if (anchor) {
                baseTop = anchor.getBoundingClientRect().top + window.scrollY;
            } else if (tabEl) {
                const prev = tabEl.previousElementSibling;
                baseTop = prev ? (prev.getBoundingClientRect().bottom + window.scrollY + 16) : (tabEl.offsetTop || 0);
            }

            const targetY = Math.max(0, Math.round(baseTop - navHeight));

            if (window.scrollY > targetY || (force && Math.abs(window.scrollY - targetY) > 8)) {
                window.scrollTo({
                    top: targetY,
                    behavior: smooth ? 'smooth' : 'auto'
                });
            }
        }

        // 🌟 활성 패널 높이에 맞추어 트랙 높이 실시간 동적 피팅 (빈 스크롤 방지)
        function updatePortalTrackHeight(targetPanel) {
            const track = document.getElementById('portal-swipe-track');
            if (!track) return;
            let panel = null;
            if (targetPanel) {
                panel = (typeof targetPanel === 'string') ? document.getElementById(targetPanel) : targetPanel;
            }
            if (!panel) {
                panel = document.getElementById('panel-portal-' + currentPortalTab);
            }
            if (panel) {
                const h = Math.max(panel.scrollHeight, panel.offsetHeight);
                if (h > 50) {
                    track.style.height = h + 'px';
                }
            }
        }

        // 🌟 상단 탭 네비게이션 가로 스크롤 및 활성 스타일 완벽 동기화 (클릭 & 스와이프 공통)
        function updatePortalTabNavUI(tabName) {
            const nav = document.getElementById('portal-tab-nav');
            const tabBtns = document.querySelectorAll('.portal-tab-btn');
            let activeBtn = null;

            tabBtns.forEach(btn => {
                const bTab = btn.getAttribute('data-tab');
                if (bTab === tabName) {
                    btn.classList.add('active');
                    activeBtn = btn;
                } else {
                    btn.classList.remove('active');
                }
            });

            if (nav && activeBtn) {
                const navRect = nav.getBoundingClientRect();
                const btnRect = activeBtn.getBoundingClientRect();
                const scrollLeft = nav.scrollLeft + (btnRect.left - navRect.left) - (navRect.width / 2) + (btnRect.width / 2);
                nav.scrollTo({ left: scrollLeft, behavior: 'smooth' });
            }
        }

        // 🌟 탭 스위칭 함수 (클릭 & 스와이프 공통)
        function switchPortalTab(tabName, smooth = true, scrollToTab = true) {
            const isChanged = (currentPortalTab !== tabName);
            currentPortalTab = tabName;

            const track = document.getElementById('portal-swipe-track');
            const panel = document.getElementById('panel-portal-' + tabName);

            if (panel && track) {
                updatePortalTrackHeight(panel);
                track.scrollTo({
                    left: panel.offsetLeft,
                    behavior: smooth ? 'smooth' : 'auto'
                });
            }

            // 탭 버튼 스타일 및 가로 스크롤 동기화
            updatePortalTabNavUI(tabName);

            // URL 해시 동기화
            if (history.replaceState) {
                const cleanUrl = window.location.pathname + window.location.search + (tabName === 'home' ? '' : '#' + tabName);
                history.replaceState(null, null, cleanUrl);
            }

            // 탭 전환 시 카테고리 탭 위치로 스크롤 이동
            if (scrollToTab && isChanged) {
                requestAnimationFrame(() => {
                    scrollToPortalTab(true, smooth);
                });
            }
        }

        // 🌟 모바일 터치 스와이프 및 PC 드래그 리스너
        function initPortalSwipeListeners() {
            const track = document.getElementById('portal-swipe-track');
            if (!track) return;

            let timer = null;
            track.addEventListener('scroll', function() {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const panels = track.querySelectorAll('.swipe-panel');
                    const scrollLeft = track.scrollLeft;
                    let closest = null;
                    let minDist = Infinity;

                    panels.forEach(p => {
                        const dist = Math.abs(p.offsetLeft - scrollLeft);
                        if (dist < minDist) {
                            minDist = dist;
                            closest = p;
                        }
                    });

                    if (closest) {
                        updatePortalTrackHeight(closest);
                        const tName = closest.getAttribute('data-tab-name');
                        if (tName && tName !== currentPortalTab) {
                            currentPortalTab = tName;

                            // 탭 버튼 스타일 및 상단 가로 스크롤 동기화
                            updatePortalTabNavUI(tName);

                            if (history.replaceState) {
                                const cleanUrl = window.location.pathname + window.location.search + (tName === 'home' ? '' : '#' + tName);
                                history.replaceState(null, null, cleanUrl);
                            }

                            scrollToPortalTab(false, true);
                        }
                    }
                }, 50);
            }, { passive: true });

            // PC 마우스 드래그 지원
            let isDown = false;
            let startX = 0;
            let scrollStart = 0;

            track.addEventListener('mousedown', (e) => {
                if (e.target.closest('a, button, input, textarea, [role="button"]')) return;
                isDown = true;
                track.classList.add('is-dragging');
                startX = e.pageX - track.offsetLeft;
                scrollStart = track.scrollLeft;
            });

            window.addEventListener('mouseup', () => {
                if (!isDown) return;
                isDown = false;
                track.classList.remove('is-dragging');
            });

            track.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX - track.offsetLeft;
                const walk = (x - startX) * 1.5;
                track.scrollLeft = scrollStart - walk;
            });
        }

        // 페이지 진입 시 해시 확인 및 스와이프 초기화
        document.addEventListener("DOMContentLoaded", function() {
            initPortalSwipeListeners();
            const hash = window.location.hash.replace('#', '');
            if (hash && ['home', 'news', 'blood', 'asset', 'life'].includes(hash)) {
                switchPortalTab(hash, false, false);
            } else {
                updatePortalTrackHeight();
            }
        });

        window.addEventListener('resize', () => {
            updatePortalTrackHeight();
        });
        window.addEventListener('load', () => {
            updatePortalTrackHeight();
        });
        setTimeout(updatePortalTrackHeight, 300);
        setTimeout(updatePortalTrackHeight, 1000);

        // 1. 사용자 정보 로드
        fetch('/api/me')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.username) {
                    document.getElementById('usernameDisplay').textContent = data.username;
                }
            })
            .catch(() => {});

        // 2. 통합 요약 데이터 로드 함수 (혈압 + 병원/약 + 자산)
        function loadSummary() {
            fetch('/api/summary')
                .then(res => res.json())
                .then(data => {
                    if (!data.success) return;

                    // 2-0. 인사말 옆 날씨 뱃지 바인딩
                    if (data.weather) {
                        const w = data.weather;
                        const badgeEl = document.getElementById('welcomeWeatherBadge');
                        const iconEl = document.getElementById('welcomeWeatherIcon');
                        const cityEl = document.getElementById('welcomeWeatherCity');
                        const tempEl = document.getElementById('welcomeWeatherTemp');
                        const descEl = document.getElementById('welcomeWeatherDesc');
                        if (iconEl) {
                            const slug = w.icon_slug || (w.icon_url ? w.icon_url.split('/').pop().replace('.svg', '') : '');
                            if (slug) {
                                iconEl.innerHTML = `<img src="https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${slug}.svg" alt="${w.condition || '날씨'}" style="width:18px; height:18px; vertical-align:middle; display:inline-block;" onerror="this.onerror=null; this.outerHTML='${w.icon || '🌤️'}';">`;
                            } else if (w.icon) {
                                iconEl.textContent = w.icon;
                            }
                        }
                        if (cityEl && w.city) cityEl.textContent = (w.city === 'Gyeryong' ? '계룡' : w.city);
                        if (tempEl && w.temp) tempEl.textContent = w.temp;
                        if (descEl && w.condition) descEl.textContent = w.condition;
                        if (badgeEl && w.condition) {
                            badgeEl.title = `실시간 날씨: ${w.city} ${w.temp} (${w.condition}) - 클릭 시 날씨 브리핑 이동`;
                        }
                    }

                    // 2-0-1. 📱 [신규] 상단 스마트 대시보드 위젯 4종 바인딩
                    // 위젯 1: 오늘 복약 상태
                    const med = data.medication;
                    const isTaken = med && med.is_today_taken;
                    const medBadge = document.getElementById('widgetMedBadge');
                    const medStatusText = document.getElementById('widgetMedStatusText');
                    const medSubText = document.getElementById('widgetMedSubText');
                    const btnWidgetMed = document.getElementById('btnWidgetQuickMed');
                    if (medBadge && medStatusText && medSubText) {
                        if (isTaken) {
                            medBadge.className = 'today-widget-badge badge-state-ok';
                            medBadge.textContent = '복용 완료 ✅';
                            medStatusText.textContent = '오늘 복용 완료';
                            medSubText.textContent = med.medication_time ? (med.medication_time.replace('T', ' ').slice(5, 16) + ' 기록') : '오늘 복약 완료됨';
                            if (btnWidgetMed) btnWidgetMed.style.display = 'none';
                        } else {
                            medBadge.className = 'today-widget-badge badge-state-warn';
                            medBadge.textContent = '오늘 미복용 ⚠️';
                            medStatusText.textContent = '아직 안 드셨어요';
                            medSubText.textContent = (med && med.medication_time) ? ('최근: ' + med.medication_time.replace('T', ' ').slice(5, 16)) : '복약 기록 없음';
                            if (btnWidgetMed) btnWidgetMed.style.display = 'inline-flex';
                        }
                    }

                    // 위젯 2: 최근 혈압 상태
                    const b = data.blood;
                    const bloodBadge = document.getElementById('widgetBloodBadge');
                    const bloodValMain = document.getElementById('widgetBloodValMain');
                    const bloodSubText = document.getElementById('widgetBloodSubText');
                    if (bloodBadge && bloodValMain && bloodSubText) {
                        if (b) {
                            bloodBadge.className = 'today-widget-badge ' + (b.grade ? b.grade.badgeClass : 'bp-badge-normal');
                            bloodBadge.textContent = b.grade ? b.grade.label : '정상 🟢';
                            bloodBadge.title = b.grade ? `대한고혈압학회 기준: ${b.grade.name} (${b.grade.desc}) - 클릭 시 기준표 보기` : '클릭 시 판정 기준표 보기';
                            bloodValMain.innerHTML = `${b.systolic} / ${b.diastolic} <small style="font-size:0.75rem; color:#64748b; font-weight:normal;">mmHg</small>`;
                            const todayTag = b.is_today_measured ? '<span style="color:#059669; font-weight:700;">오늘 측정됨</span>' : (b.measured_at ? b.measured_at.slice(5, 10) + ' 측정' : '-');
                            bloodSubText.innerHTML = `맥박 ${b.pulse || '-'}회 · ${todayTag}`;
                        } else {
                            bloodValMain.textContent = '기록 없음';
                            bloodSubText.textContent = '혈압을 측정해 보세요';
                        }
                    }

                    // 위젯 3: 병원 & 약 D-Day
                    const h = data.hospital;
                    const hospBadge = document.getElementById('widgetHospitalBadge');
                    const hospMain = document.getElementById('widgetHospitalDDayText');
                    const hospSub = document.getElementById('widgetHospitalSubText');
                    if (hospBadge && hospMain && hospSub) {
                        if (h) {
                            hospBadge.textContent = h.nextVisitDDay || '예정';
                            hospBadge.className = 'today-widget-badge ' + (h.remainingPills <= 7 ? 'badge-state-danger' : 'badge-state-info');
                            hospMain.textContent = `${h.hospitalName || '진료일'} ${h.nextVisitDDay ? '(' + h.nextVisitDDay + ')' : ''}`;
                            hospSub.textContent = `약 잔여 ${h.remainingPills}일분 · 예약오픈 ${h.reservationOpenDate || '-'}`;
                        } else {
                            hospMain.textContent = '등록된 진료 없음';
                            hospSub.textContent = '병원 일정을 등록하세요';
                        }
                    }

                    // 위젯 4: 총자산 & 시장 요약
                    const ast = data.asset;
                    const assetTotalMain = document.getElementById('widgetAssetTotalMain');
                    const marketSubText = document.getElementById('widgetMarketSubText');
                    if (assetTotalMain && ast) {
                        assetTotalMain.textContent = ast.totalKrw || '-';
                    }
                    if (marketSubText && data.news && data.news.market) {
                        const m = data.news.market;
                        const kospi = m.kospi && m.kospi.price ? `코스피 ${m.kospi.price}` : '';
                        const usd = (m.usd_krw || m.fx) && (m.usd_krw || m.fx).price ? `USD ${(m.usd_krw || m.fx).price}원` : '';
                        marketSubText.textContent = [kospi, usd].filter(Boolean).join(' · ') || '시장 지표 수집 완료';
                    }

                    // 2-1. 혈압 카드 현황판 (최근 혈압, 투약, 병원 진료일, 남은 약, 예약 오픈일)
                    const bloodEl = document.getElementById('bloodSummary');
                    if (bloodEl) {
                        let html = '<div class="bp-stat-list">';

                        // 1) 최근 혈압 측정치
                        if (data.blood) {
                            const b = data.blood;
                            const todayTag = b.is_today_measured ? ' <span class="badge-state-ok" style="font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; margin-left:0.2rem;">오늘</span>' : '';
                            const gradeBadge = b.grade ? ` <span class="${b.grade.badgeClass}" style="font-size:0.72rem; padding:0.12rem 0.4rem; border-radius:4px; cursor:pointer;" onclick="openBpGuideModal()" title="${b.grade.desc} - 클릭 시 판정 기준표 보기">${b.grade.name}</span>` : '';
                            html += `
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">🩸 최근 혈압</span>
                                    <span class="bp-stat-val">${b.systolic}/${b.diastolic} <small style="font-weight:normal; color:#64748b;">mmHg</small> (${b.pulse}회)${todayTag}${gradeBadge}</span>
                                </div>
                            `;
                        } else {
                            html += `
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">🩸 최근 혈압</span>
                                    <span class="bp-stat-val" style="color:#94a3b8; font-size:0.8rem;">기록 없음</span>
                                </div>
                            `;
                        }

                        // 2) 최근 복용 일시
                        if (data.medication && data.medication.medication_time) {
                            const medTime = data.medication.medication_time.replace('T', ' ');
                            const isTodayMedTag = data.medication.is_today_taken ? ' <span class="badge-state-ok" style="font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; margin-left:0.3rem;">오늘 완료</span>' : '';
                            html += `
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">💊 최근 복용</span>
                                    <span class="badge-med">${medTime}${isTodayMedTag}</span>
                                </div>
                            `;
                        } else {
                            html += `
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">💊 최근 복용</span>
                                    <span style="color:#94a3b8; font-size:0.8rem;">기록 없음</span>
                                </div>
                            `;
                        }

                        // 3) 병원 일정 & 남은 약 & 진료 예약 오픈일
                        if (data.hospital) {
                            const h = data.hospital;
                            const pillClass = h.remainingPills <= 7 ? 'badge-pill' : 'badge-pill safe';
                            const dDayText = h.nextVisitDDay ? ` (${h.nextVisitDDay})` : '';
                            html += `
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">🏥 다음 진료일</span>
                                    <span class="bp-stat-val" style="color:#2563eb;">${h.displayNextVisit || '-'}${dDayText}</span>
                                </div>
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">💊 남은 약 수량</span>
                                    <span class="${pillClass}">${h.remainingPills}일분 남음</span>
                                </div>
                                <div class="bp-stat-row">
                                    <span class="bp-stat-label">📅 진료 예약 오픈일</span>
                                    <span class="bp-stat-val" style="color:#d97706; font-size:0.82rem;">${h.reservationOpenDate || '-'}${h.reservationOpenDDay ? ' (' + h.reservationOpenDDay + ')' : ''}</span>
                                </div>
                            `;
                        }

                        html += '</div>';
                        bloodEl.innerHTML = html;
                    }

                    // 혈압 카드의 복약 버튼 안내문 최적화
                    const btnQuickMed = document.getElementById('btnQuickMed');
                    if (btnQuickMed && data.medication && data.medication.is_today_taken) {
                        btnQuickMed.textContent = '💊 오늘 혈압약 복용 완료 (추가 기록)';
                        btnQuickMed.style.background = '#059669';
                    }

                // 2-2. 자산 현황판 (총 자산 + 친절한 한글 종목명 컴팩트 페이드 전환)
                const assetEl = document.getElementById('assetSummary');
                if (assetEl && data.asset) {
                    const ast = data.asset;
                    let html = `
                        <div class="summary-line asset-main-line">
                            <strong>총 자산:</strong>
                            <span class="asset-total-badge">${ast.totalKrw}</span>
                        </div>
                    `;

                    if (ast.items && ast.items.length > 0) {
                        const first = ast.items[0];
                        const dirSymbol = first.direction === 'up' ? '▲' : '▼';
                        html += `
                            <div class="summary-line asset-sub-line">
                                <strong>📊 종목:</strong>
                                <div class="asset-ticker-inline" id="assetTickerBox">
                                    <span class="stock-kor-name" title="${first.name}">${first.name}</span>
                                    <span class="stock-price">${first.formattedTotal}</span>
                                    <span class="stock-diff ${first.direction}">${dirSymbol} ${first.diffPercent}</span>
                                </div>
                            </div>
                        `;
                        assetEl.innerHTML = html;

                        // 3.5초 간격으로 밀림 없이 제자리에서 부드럽게 페이드 전환
                        startAssetFading(document.getElementById('assetTickerBox'), ast.items);
                    } else {
                        html += `<div class="summary-line"><span style="color:#94a3b8; font-size:0.8rem;">등록된 자산 종목 없음</span></div>`;
                        assetEl.innerHTML = html;
                    }
                }

                // 2-3. 메모 카드 최근 메모 동적 렌더링
                if (data.memo && data.memo.recent && data.memo.recent.length > 0) {
                    const memoListEl = document.getElementById('memoRecentList');
                    if (memoListEl) {
                        memoListEl.innerHTML = data.memo.recent.map(m => {
                            const title = m.title || '제목 없는 메모';
                            const cat = m.category || '아이디어';
                            return `
                                <a href="/memo?id=${m.id}" class="memo-recent-item" title="${title}">
                                    <span class="memo-item-title">${m.is_pinned ? '📌 ' : '📝 '}${title}</span>
                                    <span class="memo-item-tag">${cat}</span>
                                </a>
                            `;
                        }).join('');
                    }
                }

                // 2-4. 뉴스 브리핑 현황판 (시장 지표 미니 칩 + 관심분야 자동 추천 기사)
                if (data.news) {
                    const n = data.news;
                    // 1) 시장 지표 바인딩 및 순환 페이드 전환
                    if (n.market) {
                        startMarketFading(n.market);
                    }

                    // 2) 관심분야 추천 기사 바인딩 (네이버 뉴스 / 뉴스 브리핑 2단 카드 스타일)
                    const recListEl = document.getElementById('newsRecommendedList');
                    if (recListEl) {
                        if (n.recommendedArticles && n.recommendedArticles.length > 0) {
                            recListEl.innerHTML = n.recommendedArticles.map(a => {
                                const cat = a.category_name || '주요';
                                const media = a.media_name ? `<span class="news-feed-media" style="font-weight:600; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${a.media_name}</span>` : '';
                                const timeAgo = formatNewsTimeAgo(a.published_at);
                                const timeHtml = timeAgo ? `<span class="news-feed-dot" style="color:#cbd5e1; margin:0 2px;">·</span><span class="news-feed-time" style="color:#94a3b8; white-space:nowrap;">${timeAgo}</span>` : '';
                                const thumbHtml = (a.image_url && a.image_url.trim() !== '') ? `
                                    <div class="news-feed-thumb" style="flex-shrink:0; width:80px; height:64px; border-radius:0.75rem; overflow:hidden; background-color:#f1f5f9; border:1px solid rgba(226,232,240,0.8); box-shadow:0 1px 2px rgba(0,0,0,0.04); display:block;">
                                        <img src="${a.image_url}" alt="" loading="lazy" style="width:100%; height:100%; max-width:100%; object-fit:cover; display:block;" onerror="this.parentElement.style.display='none'">
                                    </div>
                                ` : '';

                                return `
                                    <article class="news-feed-card" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:0.85rem; padding:0.75rem 0.85rem; margin-bottom:0.6rem; box-shadow:0 1px 3px rgba(0,0,0,0.03); display:flex; flex-direction:column; width:100%; box-sizing:border-box;">
                                        <div class="news-feed-main" style="display:flex; align-items:flex-start; justify-content:space-between; gap:0.75rem; width:100%; min-width:0; box-sizing:border-box;">
                                            <div class="news-feed-text" style="flex:1 1 0%; min-width:0;">
                                                <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="news-feed-title" title="${a.title}" style="font-size:0.95rem; font-weight:700; color:#0f172a; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:keep-all; text-decoration:none; margin:0; display:block;">
                                                    ${a.title}
                                                </a>
                                            </div>
                                            ${thumbHtml}
                                        </div>
                                        <div class="news-feed-meta" style="display:flex; align-items:center; justify-content:space-between; padding-top:0.5rem; margin-top:0.5rem; border-top:1px solid #f1f5f9; font-size:0.76rem; color:#64748b; width:100%; min-width:0; box-sizing:border-box;">
                                            <div class="news-feed-meta-left" style="display:flex; align-items:center; gap:0.35rem; min-width:0; overflow:hidden;">
                                                <span class="news-cat-badge" style="background:#eff6ff; color:#2563eb; font-weight:700; padding:2px 7px; border-radius:6px; font-size:0.72rem; flex-shrink:0;">${cat}</span>
                                                ${media}
                                                ${timeHtml}
                                            </div>
                                            <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="news-feed-link" title="원문 보기" style="color:#2563eb; font-weight:600; text-decoration:none; font-size:0.75rem; flex-shrink:0;">
                                                원문 읽기 ↗
                                            </a>
                                        </div>
                                    </article>
                                `;
                            }).join('');

                            // 이미지 로딩 완료 시 패널 높이 동적 재계산
                            recListEl.querySelectorAll('img').forEach(img => {
                                if (img.complete) {
                                    updatePortalTrackHeight();
                                } else {
                                    img.addEventListener('load', () => updatePortalTrackHeight(), { once: true });
                                    img.addEventListener('error', () => updatePortalTrackHeight(), { once: true });
                                }
                            });
                        } else {
                            recListEl.innerHTML = '<div style="color:#94a3b8; font-size:0.8rem; padding:0.4rem 0;">수집된 추천 뉴스가 없습니다.</div>';
                        }
                    }

                    // 3) 실시간 속보 한줄 티커 & 호버 전체목록 바인딩
                    bindBreakingTicker(n.breakingArticles || []);

                    // 데이터 로드 완료 후 현재 활성 패널 높이 자동 피팅
                    setTimeout(updatePortalTrackHeight, 100);
                }
            })
            .catch(() => {});
        }

        // 🕒 실시간 뉴스 상대 시간 계산 헬퍼 (예: 방금 전, 15분 전, 2시간 전, 어제)
        function formatNewsTimeAgo(dateStr) {
            if (!dateStr) return '';
            try {
                const s = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
                const published = new Date(s);
                if (isNaN(published.getTime())) {
                    return dateStr.length >= 16 ? dateStr.slice(5, 16) : dateStr;
                }
                const now = new Date();
                const diffMs = now - published;
                if (diffMs < 0) return '방금 전';
                const diffSec = Math.floor(diffMs / 1000);
                if (diffSec < 60) return '방금 전';
                const diffMin = Math.floor(diffSec / 60);
                if (diffMin < 60) return `${diffMin}분 전`;
                const diffHour = Math.floor(diffMin / 60);
                if (diffHour < 24) return `${diffHour}시간 전`;
                const diffDay = Math.floor(diffHour / 24);
                if (diffDay === 1) return '어제';
                if (diffDay < 7) return `${diffDay}일 전`;
                return dateStr.length >= 10 ? dateStr.slice(5, 10) : dateStr;
            } catch (e) {
                return '';
            }
        }

        // 🚨 실시간 속보 세로 롤링 및 호버 전체목록 제어 (동적 높이 기반 완벽 정렬)
        let breakingTickerTimer = null;
        function bindBreakingTicker(articles) {
            const trackEl = document.getElementById('breakingTickerTrack');
            const viewportEl = document.getElementById('breakingTickerViewport');
            const dropdownListEl = document.getElementById('breakingDropdownItems');
            const bannerEl = document.getElementById('breakingBannerBar');
            if (!trackEl || !dropdownListEl) return;

            if (!articles || articles.length === 0) {
                if (bannerEl) bannerEl.style.display = 'none';
                return;
            }
            if (bannerEl) bannerEl.style.display = 'flex';

            // 1) 롤링 트랙 아이템 주입
            trackEl.innerHTML = articles.map(a => `
                <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="breaking-ticker-item" title="${a.title}">
                    <span class="breaking-item-title">${a.title}</span>
                    ${a.media_name ? `<span class="breaking-item-media">${a.media_name}</span>` : ''}
                </a>
            `).join('');

            // 2) 호버 시 노출될 드롭다운 전체 목록 주입
            dropdownListEl.innerHTML = articles.map(a => {
                const timeStr = a.published_at ? (a.published_at.slice(11, 16) || a.published_at.slice(5, 16)) : '';
                return `
                    <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="breaking-dropdown-item" title="${a.title}">
                        <span class="breaking-dropdown-item-title">${a.title}</span>
                        <div class="breaking-dropdown-item-meta">
                            ${a.media_name ? `<span>${a.media_name}</span>` : ''}
                            ${timeStr ? `<span>${timeStr}</span>` : ''}
                        </div>
                    </a>
                `;
            }).join('');

            // 3) 1줄 세로 슬라이드 롤링 타이머 (3.5초 간격, 동적 뷰포트 높이 실시간 측정)
            if (breakingTickerTimer) clearInterval(breakingTickerTimer);
            let curIdx = 0;
            const count = articles.length;
            if (count <= 1) {
                trackEl.style.transform = 'translateY(0px)';
                return;
            }

            // 기기별 실제 렌더링된 뷰포트/아이템 높이를 실시간 동적 측정 (하드코딩 배제)
            function getTickerStepHeight() {
                if (viewportEl && viewportEl.clientHeight > 0) {
                    return viewportEl.clientHeight;
                }
                const firstItem = trackEl.firstElementChild;
                if (firstItem && firstItem.offsetHeight > 0) {
                    return firstItem.offsetHeight;
                }
                return window.innerWidth <= 768 ? 26 : 28;
            }

            function applySlide() {
                const step = getTickerStepHeight();
                trackEl.style.transform = `translateY(-${curIdx * step}px)`;
            }

            function startRolling() {
                if (breakingTickerTimer) clearInterval(breakingTickerTimer);
                breakingTickerTimer = setInterval(() => {
                    curIdx = (curIdx + 1) % count;
                    applySlide();
                }, 3500);
            }

            function stopRolling() {
                if (breakingTickerTimer) clearInterval(breakingTickerTimer);
            }

            // 초기 1회 정렬 보정
            setTimeout(applySlide, 50);
            startRolling();

            // 마우스 호버 및 모바일 터치 시 롤링 일시 정지, 떠나면 재개
            if (bannerEl) {
                bannerEl.onmouseenter = stopRolling;
                bannerEl.onmouseleave = startRolling;
                bannerEl.ontouchstart = stopRolling;
                bannerEl.ontouchend = () => {
                    setTimeout(startRolling, 2500);
                };
            }

            // 모바일 화면 회전 및 브라우저 리사이즈 시 즉시 오프셋 재계산
            window.addEventListener('resize', applySlide, { passive: true });
        }

        // 초기 요약 데이터 로드 실행
        loadSummary();

        // 3. 지금 혈압약 복용 (원터치 등록)
        async function recordQuickMedication() {
            const btn = document.getElementById('btnQuickMed');
            if (!confirm('💊 지금 오늘 혈압약 복용을 기록하시겠습니까?')) return;

            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ 기록 처리 중...';
            }

            try {
                const res = await fetch('/api/blood/quick-med', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.success) {
                    alert(data.message || '💊 복용 기록이 성공적으로 저장되었습니다!');
                    // 즉시 대시보드 요약 갱신
                    loadSummary();
                } else {
                    alert('복약 기록 실패: ' + (data.message || '오류 발생'));
                }
            } catch (err) {
                alert('서버 통신 실패: ' + err.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '💊 지금 혈압약 복용 (원터치)';
                }
            }
        }

        // 자산 종목별 부드러운 인라인 페이드 전환 함수 (밀림/레이아웃 흔들림 완전 방지)
        function startAssetFading(box, items) {
            if (!box || items.length <= 1) return;
            let cur = 0;
            setInterval(() => {
                box.style.opacity = '0';
                box.style.transform = 'translateY(-2px)';
                setTimeout(() => {
                    cur = (cur + 1) % items.length;
                    const item = items[cur];
                    const dirSymbol = item.direction === 'up' ? '▲' : '▼';
                    box.innerHTML = `
                        <span class="stock-kor-name" title="${item.name}">${item.name}</span>
                        <span class="stock-price">${item.formattedTotal}</span>
                        <span class="stock-diff ${item.direction}">${dirSymbol} ${item.diffPercent}</span>
                    `;
                    box.style.opacity = '1';
                    box.style.transform = 'translateY(0)';
                }, 250);
            }, 3500);
        }

        // 시장 지표(지수/환율) 부드러운 인라인 페이드 전환 함수 (밀림/레이아웃 흔들림 완전 방지)
        let marketFadeTimer = null;
        function startMarketFading(market) {
            if (!market) return;
            if (marketFadeTimer) {
                clearInterval(marketFadeTimer);
                marketFadeTimer = null;
            }

            // 1) 지수 목록 (코스피, 코스닥)
            const indexList = [];
            if (market.kospi && market.kospi.price && market.kospi.price !== '-') {
                indexList.push({ ...market.kospi, name: '코스피' });
            }
            if (market.kosdaq && market.kosdaq.price && market.kosdaq.price !== '-') {
                indexList.push({ ...market.kosdaq, name: '코스닥' });
            }

            // 2) 환율 목록 (USD, JPY, EUR)
            const fxList = [];
            const usd = market.usd_krw || market.fx;
            if (usd && usd.price && usd.price !== '-') {
                fxList.push({ ...usd, name: 'USD/KRW' });
            }
            if (market.jpy_krw && market.jpy_krw.price && market.jpy_krw.price !== '-') {
                fxList.push({ ...market.jpy_krw, name: 'JPY/KRW' });
            }
            if (market.eur_krw && market.eur_krw.price && market.eur_krw.price !== '-') {
                fxList.push({ ...market.eur_krw, name: 'EUR/KRW' });
            }

            const indexNameEl = document.getElementById('marketIndexName');
            const fxNameEl = document.getElementById('marketFxName');
            const indexBox = document.getElementById('marketIndexBox');
            const fxBox = document.getElementById('marketFxBox');

            let indexCur = 0;
            let fxCur = 0;

            function renderIndex(item) {
                if (!item || !indexNameEl || !indexBox) return;
                indexNameEl.textContent = item.name;
                const arrow = item.direction === 'up' ? '▲ ' : (item.direction === 'down' ? '▼ ' : '');
                indexBox.innerHTML = `
                    <span class="market-price">${item.price || '-'}</span>
                    <span class="market-diff ${item.direction || 'up'}">${arrow}${item.ratio || '-'}</span>
                `;
            }

            function renderFx(item) {
                if (!item || !fxNameEl || !fxBox) return;
                fxNameEl.textContent = item.name;
                const arrow = item.direction === 'up' ? '▲ ' : (item.direction === 'down' ? '▼ ' : '');
                fxBox.innerHTML = `
                    <span class="market-price">${item.price || '-'}</span>
                    <span class="market-diff ${item.direction || 'up'}">${arrow}${item.ratio || '-'}</span>
                `;
            }

            // 초기 렌더링
            if (indexList.length > 0) renderIndex(indexList[0]);
            if (fxList.length > 0) renderFx(fxList[0]);

            if (indexList.length <= 1 && fxList.length <= 1) return;

            // 3.5초 주기로 제자리에서 부드럽게 페이드 전환
            marketFadeTimer = setInterval(() => {
                if (indexList.length > 1 && indexBox) {
                    indexBox.style.opacity = '0';
                    indexBox.style.transform = 'translateY(-2px)';
                    setTimeout(() => {
                        indexCur = (indexCur + 1) % indexList.length;
                        renderIndex(indexList[indexCur]);
                        indexBox.style.opacity = '1';
                        indexBox.style.transform = 'translateY(0)';
                    }, 220);
                }

                if (fxList.length > 1 && fxBox) {
                    fxBox.style.opacity = '0';
                    fxBox.style.transform = 'translateY(-2px)';
                    setTimeout(() => {
                        fxCur = (fxCur + 1) % fxList.length;
                        renderFx(fxList[fxCur]);
                        fxBox.style.opacity = '1';
                        fxBox.style.transform = 'translateY(0)';
                    }, 220);
                }
            }, 3500);
        }

        // ---------------------------------------------------------------------
        // 📲 PWA 웹앱 설치 제어 및 서비스 워커 등록
        // ---------------------------------------------------------------------
        let deferredInstallPrompt = null;

        function checkPwaInstalled() {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            const isInstalledStorage = localStorage.getItem('pwa_installed') === 'true';

            const btn = document.getElementById('btnPwaInstall');
            const mBtn = document.getElementById('btnPwaInstallMobile');

            if (isStandalone || isInstalledStorage) {
                if (btn) btn.style.display = 'none';
                if (mBtn) mBtn.style.display = 'none';
                return true;
            }
            return false;
        }

        // 페이지 진입 즉시 설치 여부 검사
        checkPwaInstalled();

        // 1. 서비스 워커 등록
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                checkPwaInstalled();
                navigator.serviceWorker.register('/sw.js?v=4')
                    .then(reg => {
                        console.log('[PWA] Service Worker registered with scope:', reg.scope);
                    })
                    .catch(err => {
                        console.warn('[PWA] Service Worker registration failed:', err);
                    });
            });
        }

        // 2. 브라우저 설치 가능 이벤트 감지
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            console.log('[PWA] beforeinstallprompt captured');

            // 이미 설치된 환경이면 버튼을 노출하지 않음
            if (checkPwaInstalled()) return;

            const btn = document.getElementById('btnPwaInstall');
            const mBtn = document.getElementById('btnPwaInstallMobile');
            if (btn) btn.style.display = 'inline-flex';
            if (mBtn) mBtn.style.display = 'flex';
        });

        // 3. 설치 버튼 클릭 시 실행 함수
        async function triggerPwaInstall() {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                console.log('[PWA] User choice:', outcome);
                if (outcome === 'accepted') {
                    console.log('[PWA] User accepted the install prompt');
                    localStorage.setItem('pwa_installed', 'true');
                    checkPwaInstalled();
                }
                deferredInstallPrompt = null;
            } else {
                const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

                if (isStandalone) {
                    localStorage.setItem('pwa_installed', 'true');
                    checkPwaInstalled();
                    alert('이미 JG 포털 앱이 홈 화면에 설치되어 실행 중입니다. 📱');
                } else if (isIos) {
                    alert('아이폰/아이패드 Safari 설치 방법:\n하단 공유 버튼(네모+화살표)을 누른 후\n[홈 화면에 추가]를 선택하시면 앱으로 설치됩니다. 📲');
                } else {
                    alert('브라우저 우측 상단 메뉴(⋮)에서 [앱 설치] 또는 [홈 화면에 추가]를 눌러 바로 설치하실 수 있습니다. 📲');
                }
            }
        }

        // 4. 설치 완료 이벤트
        window.addEventListener('appinstalled', () => {
            console.log('[PWA] App successfully installed');
            localStorage.setItem('pwa_installed', 'true');
            checkPwaInstalled();
            deferredInstallPrompt = null;
            alert('🎉 JG 통합 포털 앱이 홈 화면에 성공적으로 설치되었습니다!');
        });

        // 🩸 대한고혈압학회 혈압 분류 기준 모달 제어
        function openBpGuideModal() {
            const modal = document.getElementById('bpGuideModal');
            if (modal) {
                modal.classList.add('active');
                modal.style.setProperty('display', 'flex', 'important');
                document.body.style.overflow = 'hidden';
            }
        }
        function closeBpGuideModal() {
            const modal = document.getElementById('bpGuideModal');
            if (modal) {
                modal.classList.remove('active');
                modal.style.setProperty('display', 'none', 'important');
                document.body.style.overflow = '';
            }
        }
