// ==============================================================================
// 📊 JG 포털 대시보드 요약 데이터 바인딩 엔진 (portal-summary.js)
// - 혈압·복약·병원·자산 데이터 로드 및 UI 렌더링
// - 원터치 약 복용 기록 (/api/blood/quick-med)
// - 비로그인/세션 만료 시 안전 Fallback 데이터
// ==============================================================================

// 🌤️ 상단 날씨 뱃지 UI 렌더링 헬퍼
function updateWeatherBadge(w) {
    if (!w) return;
    const iconEl = document.getElementById('welcomeWeatherIcon');
    const cityEl = document.getElementById('welcomeWeatherCity');
    const tempEl = document.getElementById('welcomeWeatherTemp');
    const badgeEl = document.getElementById('welcomeWeatherBadge');
    if (iconEl) {
        const iconUrl = w.icon_url || (w.icon_slug ? `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/${w.icon_slug}.svg` : null);
        if (iconUrl) {
            iconEl.innerHTML = `<img src="${iconUrl}" alt="${w.condition || '날씨'}" style="width:18px; height:18px; vertical-align:middle; display:inline-block; flex-shrink:0;" onerror="this.onerror=null; this.outerHTML='${w.icon || '🌤️'}';">`;
        } else if (w.icon) {
            iconEl.textContent = w.icon;
        }
    }
    const displayName = (w.city === 'Gyeryong' ? '계룡' : (w.city || '서울'));
    if (cityEl) cityEl.textContent = displayName;
    if (tempEl && w.temp) tempEl.textContent = w.temp;
    if (badgeEl && w.condition) {
        badgeEl.title = `실시간 날씨: ${displayName} ${w.temp || ''} (${w.condition}) - 클릭 시 날씨 브리핑 이동`;
    }
}
window.updateWeatherBadge = updateWeatherBadge;

// 🔄 1. 통합 요약 데이터 로드 함수
function loadSummary() {
    fetch('/api/summary')
        .then(res => {
            if (res.status === 401) {
                return getFallbackSummaryData();
            }
            return res.json();
        })
        .then(data => {
            if (!data || !data.success) {
                data = getFallbackSummaryData();
            }

            // 1-1. 상단 날씨 뱃지 바인딩
            if (data.weather) {
                updateWeatherBadge(data.weather);
            }

            // 1-2. 위젯 1: 오늘 복약 상태
            const med = data.medication;
            const isTaken = med && med.is_today_taken;
            const medBadge = document.getElementById('widgetMedBadge');
            const medStatusText = document.getElementById('widgetMedStatusText');
            const medSubText = document.getElementById('widgetMedSubText');
            const btnWidgetMed = document.getElementById('btnWidgetQuickMed');
            if (medBadge && medStatusText && medSubText) {
                if (isTaken) {
                    medBadge.className = 'bento-badge badge-emerald';
                    medBadge.textContent = '약 먹었어요 ✅';
                    medStatusText.textContent = '오늘 약 복용 완료';
                    medSubText.textContent = med.medication_time ? (med.medication_time.replace('T', ' ').slice(5, 16) + ' 기록') : '오늘 약 챙겨먹기 완료';
                    if (btnWidgetMed) btnWidgetMed.style.display = 'none';
                } else {
                    medBadge.className = 'bento-badge badge-amber';
                    medBadge.textContent = '오늘 미복용 ⚠️';
                    medStatusText.textContent = '오늘 약을 아직 안 챙겨드셨어요';
                    medSubText.textContent = (med && med.medication_time) ? ('최근: ' + med.medication_time.replace('T', ' ').slice(5, 16)) : '약 복용 기록 없음';
                    if (btnWidgetMed) btnWidgetMed.style.display = 'inline-flex';
                }
            }

            // 1-3. 위젯 2: 최근 혈압 상태
            const b = data.blood;
            const bloodValMain = document.getElementById('widgetBloodValMain');
            const bloodSubText = document.getElementById('widgetBloodSubText');
            const bloodSummaryTitle = document.getElementById('widgetBloodSummaryTitle');
            const bloodStatusTag = document.getElementById('widgetBloodStatusTag');
            if (bloodValMain && bloodSubText) {
                if (b) {
                    bloodValMain.innerHTML = `${b.systolic} / ${b.diastolic} <span class="bento-stat-unit">mmHg</span>`;
                    const todayTag = b.is_today_measured ? '<span style="color:var(--status-emerald); font-weight:700;">오늘 측정됨</span>' : (b.measured_at ? b.measured_at.slice(5, 10) + ' 측정' : '-');
                    bloodSubText.innerHTML = `맥박 ${b.pulse || '-'}회 · ${todayTag}`;
                    if (bloodSummaryTitle && b.grade) bloodSummaryTitle.textContent = `${b.grade.name} (${b.systolic}/${b.diastolic})`;
                    if (bloodStatusTag && b.grade) {
                        bloodStatusTag.textContent = b.grade.name;
                        // 혈압 수치 등급별 색상 동적 매핑
                        let badgeClass = 'badge-emerald';
                        const key = b.grade.key || '';
                        if (key === 'stage2' || key === 'stage1') {
                            badgeClass = 'badge-rose';
                        } else if (key === 'prehypertension' || key === 'elevated') {
                            badgeClass = 'badge-amber';
                        } else if (key === 'low') {
                            badgeClass = 'badge-blue';
                        } else {
                            badgeClass = 'badge-emerald';
                        }
                        bloodStatusTag.className = 'bento-badge ' + badgeClass;
                    }
                } else {
                    bloodValMain.textContent = '- / -';
                    bloodSubText.textContent = '최근 기록 수집 대기 중';
                    if (bloodStatusTag) {
                        bloodStatusTag.textContent = '측정 대기';
                        bloodStatusTag.className = 'bento-badge badge-gray';
                    }
                }
            }

            // 1-4. 위젯 3: 병원 & 약 D-Day
            const h = data.hospital;
            const hospMain = document.getElementById('widgetHospitalDDayText');
            const hospSub = document.getElementById('widgetHospitalSubText');
            if (hospMain && hospSub) {
                if (h) {
                    hospMain.textContent = `${h.hospitalName || '진료 일정'} ${h.nextVisitDDay ? '(' + h.nextVisitDDay + ')' : ''}`;
                    hospSub.textContent = `처방약 잔여 ${h.remainingPills}일분 · 진료 예약 오픈일 ${h.reservationOpenDate || '-'}`;
                } else {
                    hospMain.textContent = '등록된 진료 일정 없음';
                    hospSub.textContent = '병원 일정을 등록하세요';
                }
            }

            // 1-5. 위젯 4: 총자산 & 시장 요약
            const ast = data.asset;
            const assetTotalMain = document.getElementById('widgetAssetTotalMain');
            const assetCountText = document.getElementById('widgetAssetCountText');
            if (assetTotalMain && ast) {
                assetTotalMain.textContent = ast.totalKrw || '₩4,354,215';
            }
            if (assetCountText && ast) {
                assetCountText.textContent = `${ast.count || (ast.items ? ast.items.length : 18)}개 종목`;
            }

            // 보유 자산 종목 페이드 티커 가동
            const assetEl = document.getElementById('assetSummary');
            if (assetEl && ast && ast.items && ast.items.length > 0) {
                const first = ast.items[0];
                const dirSymbol = first.direction === 'up' ? '▲' : '▼';
                assetEl.innerHTML = `
                    <div class="bento-market-ticker-box" style="margin-bottom: 0;">
                        <div class="market-ticker-inner font-mono" id="assetTickerRow">
                            <span class="ticker-label" style="flex-shrink:0;">보유종목</span>
                            <span class="ticker-val" id="assetTickerBox" style="min-width:0; overflow:hidden; white-space:nowrap;">
                                <span class="stock-kor-name" title="${first.name}" style="color:var(--hm-text-main, #0f172a); font-weight:700; font-size:0.75rem; overflow:hidden; text-overflow:ellipsis;">${first.name}</span>
                                <span class="stock-price" style="color:var(--hm-text-main, #0f172a); font-weight:700; font-size:0.75rem; flex-shrink:0;">${first.formattedTotal}</span>
                                <span class="stock-diff ${first.direction}" style="font-size:0.72rem; flex-shrink:0;">${dirSymbol} ${first.diffPercent}</span>
                            </span>
                        </div>
                    </div>
                `;
                if (typeof startAssetFading === 'function') {
                    startAssetFading(document.getElementById('assetTickerRow'), ast.items);
                }
            }

            // 1-6. 시장 지표 순환 롤링 가동
            if (data.news && data.news.market && typeof startComprehensiveMarketRolling === 'function') {
                startComprehensiveMarketRolling(data.news.market);
            }

            // 1-7. 실시간 뉴스 & 속보 바인딩
            if (data.news) {
                const recListEl = document.getElementById('newsRecommendedList');
                if (recListEl && data.news.recommendedArticles && data.news.recommendedArticles.length > 0) {
                    recListEl.innerHTML = data.news.recommendedArticles.slice(0, 3).map(a => `
                        <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="bento-news-row" style="text-decoration:none; padding:0.45rem 0.6rem; border-bottom:1px solid var(--hm-border, #e2e8f0); display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.82rem; color:var(--hm-text-main, #0f172a); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:75%;">${a.title}</span>
                            <span style="font-size:0.72rem; color:var(--hm-text-muted, #64748b); font-family:var(--font-mono);">${a.media_name || '뉴스'}</span>
                        </a>
                    `).join('');
                }
                if (typeof bindBreakingTicker === 'function') {
                    bindBreakingTicker(data.news.breakingArticles || []);
                }
            }

            // 1-8. 서버 인프라 관리 카드 바인딩 (주서버 & 보조서버)
            if (data.system && typeof bindServerInfraData === 'function') {
                bindServerInfraData(data.system);
            }
        })
        .catch(() => {});
}

// 💊 2. 원터치 약 복용 기록 함수
async function recordQuickMedication() {
    const btn = document.getElementById('btnQuickMed');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 기록 중...';
    }

    try {
        const res = await fetch('/api/blood/quick-med', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ 오늘 약 복용 기록이 성공적으로 저장되었습니다!');
            loadSummary();
        } else {
            alert('⚠️ ' + (data.message || '복용 기록 저장에 실패했습니다.'));
        }
    } catch (e) {
        alert('⚠️ 서버와 통신 중 오류가 발생했습니다.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '💊 복용 완료';
        }
    }
}

// 🛡️ 3. 안전 Fallback 데이터
function getFallbackSummaryData() {
    return {
        success: true,
        weather: { city: 'Gyeryong', temp: '14.2°C', condition: '맑음', icon: '🌤️' },
        blood: {
            systolic: 118, diastolic: 76, pulse: 72,
            measured_at: new Date().toISOString().slice(0, 10),
            is_today_measured: true,
            grade: { name: '정상 혈압', label: '정상 🟢', badgeClass: 'bp-badge-normal', desc: '수축기 120 미만 그리고 이완기 80 미만' }
        },
        medication: { is_today_taken: true, medication_time: new Date().toISOString().slice(0, 16) },
        hospital: { hospitalName: '순천향대 천안병원', nextVisitDDay: 'D-29', remainingPills: 29, reservationOpenDate: '2026-10-25' },
        asset: {
            totalKrw: '₩4,354,215', count: 18,
            items: [
                { symbol: 'TIGER 미국나스닥100', name: 'TIGER 미국나스닥100', formattedTotal: '₩1,390,600', diffPercent: '-2.7%', direction: 'down' },
                { symbol: 'TIGER 미국배당다우존스', name: 'TIGER 미국배당다우존스', formattedTotal: '₩1,086,170', diffPercent: '+56.9%', direction: 'up' },
                { symbol: 'QQQM', name: '나스닥 100 (QQQM)', formattedTotal: '₩836,354', diffPercent: '+9.1%', direction: 'up' },
                { symbol: 'TIGER 미국S&P500', name: 'TIGER 미국S&P500', formattedTotal: '₩610,200', diffPercent: '-2.2%', direction: 'down' }
            ]
        },
        news: {
            market: {
                kospi: { name: '코스피', price: '5,552.74', ratio: '-3.73%', direction: 'down' },
                kosdaq: { name: '코스닥', price: '781.97', ratio: '-3.33%', direction: 'down' },
                sp500: { name: 'S&P 500', price: '5,864.67', ratio: '+0.40%', direction: 'up' },
                nasdaq: { name: '나스닥 100', price: '18,518.61', ratio: '+0.63%', direction: 'up' },
                usd_krw: { name: 'USD/KRW', price: '1,326.80원', ratio: '-0.50%', direction: 'down' },
                jpy_krw: { name: 'JPY/KRW', price: '840.12원', ratio: '-0.16%', direction: 'down' }
            },
            recommendedArticles: []
        },
        system: {
            primary: { name: '주서버 (갤럭시 노트 9)', cpu: '0.0%', ram: '44.7%', disk: '42% (26.8GB / 64.0GB)', network: '정상 (온라인)', status: 'online', statusText: '상시 가동' },
            secondary: { name: '보조서버 (구형 노트북)', cpu: '대기 중', ram: '대기 중', disk: '2.1% (9.6GB / 456GB)', network: '백업 대기 (새벽 04:00)', temp: '38.5°C', status: 'standby', statusText: '백업 대기' }
        }
    };
}
