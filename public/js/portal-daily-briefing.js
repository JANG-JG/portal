/**
 * 🌅 JG 포털 능동형 스마트 데일리 브리핑 프론트엔드 엔진 (portal-daily-briefing.js)
 * - /api/summary 내 briefing 객체 실시간 파싱 및 렌더링
 * - 능동적 복약 알림 원터치 액션 바인딩
 * - 접기/펼치기 사용자 상태 기억 (localStorage)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 대응
 */
(function() {
    'use strict';

    const STORAGE_KEY_COLLAPSED = 'jg_briefing_collapsed';

    /**
     * 스마트 데일리 브리핑 카드 렌더링 메인 함수
     */
    function renderDailyBriefing(briefing) {
        const card = document.getElementById('smartDailyBriefingCard');
        if (!card) return;

        if (!briefing) {
            // 브리핑 데이터가 없을 경우 숨김 처리
            card.style.display = 'none';
            return;
        }

        // 1. 헤더 시간대 뱃지 및 태그 바인딩
        const tagEl = document.getElementById('briefingTimeSlotTag');
        const iconEl = document.getElementById('briefingTimeSlotIcon');
        if (tagEl) {
            tagEl.textContent = `${briefing.timeSlotIcon || '🌅'} ${briefing.timeSlotLabel || '오늘의 브리핑'}`;
        }
        if (iconEl && briefing.timeSlotIcon) {
            iconEl.textContent = briefing.timeSlotIcon;
        }

        // 2. 다정한 인사 문구 바인딩
        const greetingEl = document.getElementById('briefingGreetingText');
        if (greetingEl) {
            const userName = briefing.userName ? `${briefing.userName}님, ` : '';
            greetingEl.textContent = `${userName}${briefing.greeting || '오늘도 활기찬 하루 되세요!'}`;
        }

        // 3. 칩 1: 건강 & 복약 능동 칩
        renderHealthChip(briefing.health);

        // 4. 칩 2: 캘린더 오늘 일정 칩
        renderScheduleChip(briefing.schedule);

        // 5. 칩 3: 실시간 날씨 & 생활 가이드 칩
        renderWeatherChip(briefing.weather);

        // 6. 하단 자연어 가이드 문구
        const naturalEl = document.getElementById('briefingNaturalSummaryText');
        if (naturalEl) {
            naturalEl.textContent = briefing.naturalSummary || '가족 중심 스마트 홈서버가 오늘도 함께합니다.';
        }

        // 6-1. 🤖 LG EXAONE 로컬 AI 비서 맞춤 조언 비동기 갱신
        fetchAiBriefingAsync();

        // 7. 접기 상태 복원
        applyCollapseState();

        // 8. 노출
        if (card.style.display === 'none' && !card.getAttribute('data-hidden-by-auth')) {
            card.style.display = '';
        }
    }

    /**
     * 건강 & 복약 칩 렌더링
     */
    function renderHealthChip(health) {
        const chip = document.getElementById('briefingChipHealth');
        const iconEl = document.getElementById('briefingChipHealthIcon');
        const titleEl = document.getElementById('briefingChipHealthTitle');
        const descEl = document.getElementById('briefingChipHealthDesc');
        const actionWrap = document.getElementById('briefingChipHealthAction');
        if (!chip || !titleEl || !descEl) return;

        if (!health || !health.hasAccess) {
            // 비관리자/가족 모드인 경우: 일상 응원 문구로 표시
            chip.className = 'briefing-chip';
            if (iconEl) iconEl.textContent = '🌿';
            titleEl.textContent = (health && health.headline) || '오늘도 건강한 하루 되세요!';
            descEl.textContent = (health && health.subText) || '가족 루틴과 일정 관리를 함께 확인해 보세요.';
            if (actionWrap) actionWrap.innerHTML = '';
            return;
        }

        if (health.actionRequired && health.actionType === 'quick_med') {
            // 🚨 오늘 약 미복용 상태
            chip.className = 'briefing-chip chip-warning';
            if (iconEl) iconEl.textContent = '💊';
            titleEl.textContent = health.headline || '오늘 약을 아직 안 챙겨드셨어요';
            descEl.textContent = health.subText || '규칙적인 복약이 혈압 관리의 기본입니다.';
            if (actionWrap) {
                actionWrap.innerHTML = `
                    <button type="button" class="briefing-action-btn btn-warning" onclick="handleBriefingQuickMed(event)" title="클릭 시 오늘 복약 즉시 기록">
                        <span>💊</span><span>약 먹었어요</span>
                    </button>
                `;
            }
        } else if (health.actionType === 'blood_check') {
            // 약은 복용했으나 오늘 혈압 미측정
            chip.className = 'briefing-chip';
            if (iconEl) iconEl.textContent = '🩺';
            titleEl.textContent = health.headline || '오늘 혈압 측정이 아직 안 되었어요';
            descEl.textContent = health.subText || '편안한 시간에 혈압을 기록해 두세요.';
            if (actionWrap) {
                actionWrap.innerHTML = `
                    <a href="/go/blood" class="briefing-action-btn" style="text-decoration:none;" title="혈압 관리 앱으로 이동">
                        <span>🩸</span><span>혈압 기록</span>
                    </a>
                `;
            }
        } else {
            // 복약 & 혈압 모두 완료!
            chip.className = 'briefing-chip chip-success';
            if (iconEl) iconEl.textContent = '✅';
            titleEl.textContent = health.headline || '오늘 건강 관리 완료';
            descEl.textContent = health.subText || '수치가 안정적으로 유지되고 있습니다.';
            if (actionWrap) {
                actionWrap.innerHTML = `
                    <span style="font-size:0.75rem; font-weight:700; color:#059669; padding:4px 8px; border-radius:6px; background:#dcfce7;">
                        완료됨 ✨
                    </span>
                `;
            }
        }
    }

    /**
     * 일정 칩 렌더링
     */
    function renderScheduleChip(schedule) {
        const titleEl = document.getElementById('briefingChipScheduleTitle');
        const descEl = document.getElementById('briefingChipScheduleDesc');
        const iconEl = document.getElementById('briefingChipScheduleIcon');
        if (!titleEl || !descEl) return;

        if (schedule && schedule.hasEvents) {
            if (iconEl) iconEl.textContent = '📅';
            titleEl.textContent = `오늘 일정 (${schedule.count}건)`;
            descEl.textContent = schedule.text || '예정된 일정이 있습니다.';
        } else {
            if (iconEl) iconEl.textContent = '☕';
            titleEl.textContent = '오늘 예정된 일정 없음';
            descEl.textContent = '등록된 일정이 없습니다. 여유로운 하루 보내세요.';
        }
    }

    /**
     * 날씨 칩 렌더링
     */
    function renderWeatherChip(weather) {
        const titleEl = document.getElementById('briefingChipWeatherTitle');
        const descEl = document.getElementById('briefingChipWeatherDesc');
        const iconEl = document.getElementById('briefingChipWeatherIcon');
        if (!titleEl || !descEl) return;

        if (weather && weather.temp) {
            if (iconEl) iconEl.textContent = weather.icon || '🌤️';
            titleEl.textContent = `${weather.city || '서울'} ${weather.temp} (${weather.condition || '맑음'})`;
            descEl.textContent = weather.guide || '상쾌한 하루 되세요.';
        } else {
            if (iconEl) iconEl.textContent = '🌤️';
            titleEl.textContent = '오늘의 날씨';
            descEl.textContent = '실시간 기상 정보를 불러오는 중입니다.';
        }
    }

    /**
     * 브리핑 카드 내 '약 먹었어요' 원클릭 액션 핸들러
     */
    window.handleBriefingQuickMed = async function(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (typeof window.recordQuickMedication === 'function') {
            await window.recordQuickMedication();
            // 포털 요약 데이터 재조회하여 브리핑 카드 즉시 갱신
            if (typeof window.loadSummary === 'function') {
                setTimeout(window.loadSummary, 400);
            }
        } else {
            try {
                const res = await fetch('/api/blood/quick-med', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof showToast === 'function') {
                        showToast('오늘 혈압약 복용이 완료되었습니다! ✅', 'success');
                    }
                    if (typeof window.loadSummary === 'function') {
                        window.loadSummary();
                    }
                }
            } catch (err) {
                console.error('브리핑 약 복용 기록 실패:', err);
            }
        }
    };

    /**
     * 브리핑 새로고침 핸들러
     */
    window.refreshDailyBriefing = function() {
        const btn = document.getElementById('btnRefreshBriefing');
        if (btn) {
            btn.classList.add('rotating');
            setTimeout(() => btn.classList.remove('rotating'), 600);
        }
        if (typeof window.loadSummary === 'function') {
            window.loadSummary();
        }
    };

    /**
     * 브리핑 본문 접기/펼치기 토글
     */
    window.toggleDailyBriefingCollapse = function() {
        const bodyEl = document.getElementById('briefingBodyWrapper');
        const toggleBtn = document.getElementById('btnToggleBriefing');
        if (!bodyEl) return;

        const isCurrentlyCollapsed = (bodyEl.style.display === 'none');
        if (isCurrentlyCollapsed) {
            bodyEl.style.display = '';
            if (toggleBtn) toggleBtn.innerHTML = '<span>▲</span><span>접기</span>';
            localStorage.setItem(STORAGE_KEY_COLLAPSED, '0');
        } else {
            bodyEl.style.display = 'none';
            if (toggleBtn) toggleBtn.innerHTML = '<span>▼</span><span>펼치기</span>';
            localStorage.setItem(STORAGE_KEY_COLLAPSED, '1');
        }
    };

    function applyCollapseState() {
        const bodyEl = document.getElementById('briefingBodyWrapper');
        const toggleBtn = document.getElementById('btnToggleBriefing');
        if (!bodyEl) return;

        const isCollapsed = (localStorage.getItem(STORAGE_KEY_COLLAPSED) === '1');
        if (isCollapsed) {
            bodyEl.style.display = 'none';
            if (toggleBtn) toggleBtn.innerHTML = '<span>▼</span><span>펼치기</span>';
        } else {
            bodyEl.style.display = '';
            if (toggleBtn) toggleBtn.innerHTML = '<span>▲</span><span>접기</span>';
        }
    }

    /**
     * LG EXAONE 로컬 AI 비서 데일리 조언 비동기 패치 (0ms 무기다림 SWR)
     */
    async function fetchAiBriefingAsync() {
        const naturalEl = document.getElementById('briefingNaturalSummaryText');
        const aiBadge = document.querySelector('.briefing-ai-chip');
        if (!naturalEl) return;

        try {
            const res = await fetch('/api/ai/briefing');
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.briefing) {
                naturalEl.style.transition = 'opacity 0.3s ease';
                naturalEl.style.opacity = '0.4';
                setTimeout(() => {
                    naturalEl.textContent = '🤖 AI 조언: ' + data.briefing;
                    naturalEl.style.opacity = '1';
                }, 300);

                if (aiBadge) {
                    aiBadge.textContent = 'LG 엑사원 AI 🟢';
                    aiBadge.style.background = '#dbeafe';
                    aiBadge.style.color = '#1d4ed8';
                    aiBadge.style.cursor = 'pointer';
                    aiBadge.title = '클릭 시 우리 집 AI 비서 챗봇 열기';
                    aiBadge.onclick = () => {
                        if (typeof window.openAiChatModal === 'function') window.openAiChatModal();
                    };
                }
            }
        } catch (e) {
            // 무장애 폴백: 에러 시 기존 문구 유지
        }
    }

    // 전역 함수 등록
    window.renderDailyBriefing = renderDailyBriefing;

})();
