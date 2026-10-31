// ==============================================================================
// 📸 가족 앨범 최신 사진 & 📅 스마트 캘린더 다가오는 일정 렌더링 엔진 (portal-album-calendar.js)
// - 메인 대시보드 Bento Card 비동기 데이터 바인딩
// - 모바일 터치 스와이프 친화적 가로 스트립 렌더링
// ==============================================================================

// 1. 최근 가족 앨범 사진 8선 로드
async function loadRecentAlbumPhotos() {
    const track = document.getElementById('albumThumbTrack');
    const countEl = document.getElementById('albumRecentCount');
    if (!track) return;

    try {
        const res = await fetch('/api/portal/recent-photos');
        const data = await res.json();

        if (!data.success || !Array.isArray(data.photos) || data.photos.length === 0) {
            track.innerHTML = `
                <div class="album-thumb-placeholder">
                    <span>📷 아직 등록된 최근 가족 사진이 없습니다.</span>
                    <div style="margin-top:0.35rem; font-size:0.75rem;">
                        <a href="https://album.j-jg.cc" style="color:#ec4899; text-decoration:underline;">첫 번째 사진을 올려보세요!</a>
                    </div>
                </div>
            `;
            if (countEl) countEl.textContent = '최근 등록된 사진 0장';
            return;
        }

        const photos = data.photos;
        if (countEl) {
            countEl.textContent = `최근 소중한 순간 (${photos.length}선)`;
        }

        track.innerHTML = photos.map(photo => {
            const safeCaption = (photo.caption || '가족 사진').replace(/"/g, '&quot;');
            const safeAuthor = (photo.author || '가족').replace(/</g, '&lt;');
            const emoji = photo.emoji || '😊';
            const batchBadge = photo.batchTotal > 1 
                ? `<div class="album-thumb-batch-badge">📷 ${photo.batchTotal}장</div>` 
                : '';

            const extUrl = photo.externalThumbnailUrl || photo.thumbnailUrl;
            return `
                <a href="https://album.j-jg.cc" class="album-thumb-card" title="${safeCaption}">
                    <div class="album-thumb-img-wrap">
                        <img src="${photo.thumbnailUrl}" 
                             alt="${safeCaption}" 
                             class="album-thumb-img" 
                             loading="lazy" 
                             onerror="if (!this.dataset.fallback && '${extUrl}') { this.dataset.fallback='1'; this.src='${extUrl}'; } else { this.src='/favicon.svg'; this.style.objectFit='contain'; }">
                    </div>
                    <div class="album-thumb-meta">
                        <div class="album-thumb-caption">${safeCaption}</div>
                        <div class="album-thumb-author-row">
                            <span>${emoji} ${safeAuthor}</span>
                            <span>❤️ ${photo.reactionCount}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('');

        bindAlbumDragScroll();
    } catch (err) {
        console.error('최근 앨범 사진 로드 오류:', err);
        track.innerHTML = `<div class="album-thumb-placeholder">사진을 불러오는 중 네트워크 오류가 발생했습니다.</div>`;
    }
}

// 📸 가족 앨범 가로 드래그 & 스와이프 스크롤 엔진
function bindAlbumDragScroll() {
    const track = document.getElementById('albumThumbTrack');
    if (!track || track.dataset.dragBound) return;
    track.dataset.dragBound = '1';

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let isDragging = false;

    track.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false;
        track.style.cursor = 'grabbing';
        startX = e.pageX - track.offsetLeft;
        scrollLeft = track.scrollLeft;
    });

    track.addEventListener('mouseleave', () => {
        isDown = false;
        track.style.cursor = 'grab';
    });

    track.addEventListener('mouseup', () => {
        isDown = false;
        track.style.cursor = 'grab';
    });

    track.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - track.offsetLeft;
        const walk = (x - startX) * 1.5;
        if (Math.abs(walk) > 5) isDragging = true;
        track.scrollLeft = scrollLeft - walk;
    });

    track.addEventListener('click', (e) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = false;
        }
    }, true);
}

// 2. 다가오는 스마트 캘린더 일정 로드 (오늘 및 향후 7일간 일정)
async function loadUpcomingCalendarEvents() {
    const grid = document.getElementById('calendarUpcomingGrid');
    const countEl = document.getElementById('calendarUpcomingCount');
    if (!grid) return;

    try {
        const res = await fetch('/api/calendar/events');
        const data = await res.json();

        if (!data.success || !Array.isArray(data.events) || data.events.length === 0) {
            grid.innerHTML = `
                <div class="calendar-upcoming-empty">
                    <span>📅 예정된 일정이 없습니다.</span>
                    <div style="margin-top:0.35rem; font-size:0.75rem;">
                        <a href="/calendar" style="color:#6366f1; text-decoration:underline;">새 일정을 등록해 보세요!</a>
                    </div>
                </div>
            `;
            if (countEl) countEl.textContent = '다가오는 일정 없음';
            return;
        }

        const now = new Date();
        const todayStr = new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(now).reduce((acc, p) => {
            if (p.type === 'year') acc.y = p.value;
            if (p.type === 'month') acc.m = p.value;
            if (p.type === 'day') acc.d = p.value;
            return acc;
        }, {});
        const todayIso = `${todayStr.y}-${todayStr.m}-${todayStr.d}`;

        // 오늘 이후 일정만 필터링 (최대 6개)
        const upcoming = data.events.filter(ev => {
            const evDate = (ev.event_date || ev.date || '').slice(0, 10);
            return evDate >= todayIso;
        }).sort((a, b) => {
            const da = (a.event_date || a.date || '');
            const db = (b.event_date || b.date || '');
            return da.localeCompare(db);
        }).slice(0, 6);

        if (upcoming.length === 0) {
            grid.innerHTML = `
                <div class="calendar-upcoming-empty">
                    <span>✨ 이번 주 예정된 일정이 없습니다.</span>
                    <div style="margin-top:0.35rem; font-size:0.75rem;">
                        <a href="/calendar" style="color:#6366f1; text-decoration:underline;">새 일정을 등록해 보세요!</a>
                    </div>
                </div>
            `;
            if (countEl) countEl.textContent = '이번 주 예정 일정 0건';
            return;
        }

        if (countEl) {
            countEl.textContent = `다가오는 주요 일정 (${upcoming.length}건)`;
        }

        grid.innerHTML = upcoming.map(ev => {
            const rawDate = (ev.event_date || ev.date || '').slice(0, 10);
            const dateParts = rawDate.split('-');
            const month = dateParts[1] ? `${parseInt(dateParts[1], 10)}월` : '';
            const day = dateParts[2] ? `${parseInt(dateParts[2], 10)}` : '';

            // D-Day 계산
            let ddayText = '';
            let isToday = false;
            if (rawDate === todayIso) {
                ddayText = '오늘';
                isToday = true;
            } else {
                const diffTime = new Date(rawDate + 'T00:00:00') - new Date(todayIso + 'T00:00:00');
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                ddayText = diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
            }

            const title = (ev.title || '일정').replace(/</g, '&lt;');
            const category = ev.category || '일정';
            const color = ev.color || '#6366f1';
            const timeStr = ev.is_all_day ? '종일' : (ev.event_time || '');

            return `
                <a href="/calendar" class="cal-upcoming-card" style="border-left-color:${color};" title="${title}">
                    <div class="cal-upcoming-date-box">
                        <span class="cal-upcoming-month">${month}</span>
                        <span class="cal-upcoming-day">${day}</span>
                    </div>
                    <div class="cal-upcoming-body">
                        <div class="cal-upcoming-title">${title}</div>
                        <div class="cal-upcoming-meta">
                            <span class="cal-dday-badge ${isToday ? 'today' : ''}">${ddayText}</span>
                            <span>${category}</span>
                            ${timeStr ? `<span>· ${timeStr}</span>` : ''}
                        </div>
                    </div>
                </a>
            `;
        }).join('');

    } catch (err) {
        console.error('다가오는 캘린더 일정 로드 오류:', err);
        grid.innerHTML = `<div class="calendar-upcoming-empty">일정을 불러오는 중 오류가 발생했습니다.</div>`;
    }
}

// 3. 메인 포털 초기화 시 동시 로드 (DOM 로드 상태 완벽 방어)
function initPortalAlbumAndCalendar() {
    loadRecentAlbumPhotos();
    loadUpcomingCalendarEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPortalAlbumAndCalendar);
} else {
    initPortalAlbumAndCalendar();
}

// 전역 바인딩
window.loadRecentAlbumPhotos = loadRecentAlbumPhotos;
window.loadUpcomingCalendarEvents = loadUpcomingCalendarEvents;
window.initPortalAlbumAndCalendar = initPortalAlbumAndCalendar;
