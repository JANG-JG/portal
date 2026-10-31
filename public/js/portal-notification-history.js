/**
 * 🔔 JG 포털 통합 알림 센터 - 수신 내역 & 카테고리 필터링 모듈
 * portal-notification-history.js
 */
(function() {
    'use strict';

    let notifHistoryOffset = 0;
    let notifHistoryTotal = 0;
    let notifHistoryListItems = [];
    let notifSelectedCategory = 'all';
    const NOTIF_HISTORY_LIMIT = 30;

    const NOTIF_CATEGORIES = [
        { key: 'all', label: '전체', icon: '🔔' },
        { key: 'album', label: '가족앨범', icon: '📸' },
        { key: 'breaking', label: '속보', icon: '🚨' },
        { key: 'calendar', label: '일정', icon: '📅' },
        { key: 'weather', label: '날씨', icon: '🌤️' },
        { key: 'finance', label: '금융', icon: '💰' },
        { key: 'health', label: '건강', icon: '🩸' },
        { key: 'system', label: '시스템', icon: '🖥️' }
    ];

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 5. 카테고리 판별 & 필터링 바 (unified-nav.js와 100% 동일 UI)
    function getNotificationCategory(item) {
        const type = (item.type || '').toLowerCase();
        const full = `${type} ${(item.title || '')} ${(item.body || '')}`.toLowerCase();
        if (type === 'album' || full.includes('가족앨범') || full.includes('앨범') || full.includes('새 사진') || full.includes('댓글이 등록') || full.includes('회원님을 언급')) return { key: 'album', label: '가족앨범', icon: '📸', colorClass: 'cat-album' };
        if (type === 'breaking' || full.includes('속보')) return { key: 'breaking', label: '속보', icon: '🚨', colorClass: 'cat-breaking' };
        if (type === 'calendar' || type === 'dday' || full.includes('일정') || full.includes('캘린더') || full.includes('d-day') || full.includes('디데이') || full.includes('소모품')) return { key: 'calendar', label: '일정', icon: '📅', colorClass: 'cat-calendar' };
        if (type === 'weather' || full.includes('날씨') || full.includes('기온') || full.includes('미세먼지') || full.includes('강수')) return { key: 'weather', label: '날씨', icon: '🌤️', colorClass: 'cat-weather' };
        if (['asset', 'economy', 'finance', 'stock'].includes(type) || full.includes('증시') || full.includes('환율') || full.includes('코스피') || full.includes('주가')) return { key: 'finance', label: '금융', icon: '💰', colorClass: 'cat-finance' };
        if (['blood_pressure', 'medication', 'hospital'].includes(type) || full.includes('혈압') || full.includes('복약') || full.includes('병원') || full.includes('약 복용')) return { key: 'health', label: '건강', icon: '🩸', colorClass: 'cat-health' };
        if (['system', 'backup', 'server'].includes(type) || full.includes('서버') || full.includes('백업') || full.includes('경보') || full.includes('다운')) return { key: 'system', label: '시스템', icon: '🖥️', colorClass: 'cat-system' };
        return { key: 'general', label: '일반', icon: '🔔', colorClass: 'cat-general' };
    }

    function renderCategoryChips() {
        const barEl = document.getElementById('notifCategoryBar');
        if (!barEl) return;
        const isFamily = document.documentElement.classList.contains('role-family');
        const visibleCats = isFamily
            ? NOTIF_CATEGORIES.filter(c => !['system', 'health'].includes(c.key))
            : NOTIF_CATEGORIES;
        const counts = { all: notifHistoryListItems.length }, unreads = { all: 0 };
        visibleCats.forEach(c => { if (c.key !== 'all') { counts[c.key] = 0; unreads[c.key] = 0; } });
        notifHistoryListItems.forEach(item => {
            const cat = getNotificationCategory(item);
            if (counts[cat.key] !== undefined) {
                counts[cat.key]++;
                if (item.is_read === 0) unreads[cat.key]++;
            }
            if (item.is_read === 0) unreads.all++;
        });
        barEl.innerHTML = visibleCats.map(cat => {
            const isActive = notifSelectedCategory === cat.key;
            const total = counts[cat.key] || 0;
            const unread = unreads[cat.key] || 0;
            const dot = unread > 0 ? '<span class="notif-cat-unread-dot"></span>' : '';
            return `<button type="button" class="notif-cat-chip ${isActive ? 'active' : ''}" onclick="selectNotificationCategory('${cat.key}')"><span>${cat.icon} ${cat.label}</span>${dot}<span class="notif-cat-badge">${total}</span></button>`;
        }).join('');
    }

    function selectNotificationCategory(catKey) {
        notifSelectedCategory = catKey;
        renderCategoryChips();
        renderFilteredNotificationList();
    }

    function formatNotificationTime(dateStr) {
        if (!dateStr) return '';
        const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
        const target = m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6] || '0', 10)) : new Date(dateStr);
        if (isNaN(target.getTime())) return String(dateStr).replace('T', ' ').slice(5, 16);
        const now = new Date();
        const diffMs = now.getTime() - target.getTime();
        if (now.toDateString() === target.toDateString()) {
            if (diffMs < 60000) return '방금 전';
            const mins = Math.floor(diffMs / 60000);
            if (mins < 60) return `${mins}분 전`;
            const hrs = Math.floor(mins / 60), rem = mins % 60;
            return rem === 0 ? `${hrs}시간 전` : `${hrs}시간 ${rem}분 전`;
        }
        const pad = n => String(n).padStart(2, '0');
        const yest = new Date(now); yest.setDate(now.getDate() - 1);
        if (yest.toDateString() === target.toDateString()) return `어제 ${pad(target.getHours())}:${pad(target.getMinutes())}`;
        return `${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}`;
    }

    function renderFilteredNotificationList() {
        const listEl = document.getElementById('notifHistoryList');
        const countLabel = document.getElementById('notifHistoryCountLabel');
        const loadMoreBox = document.getElementById('notifLoadMoreBox');
        if (!listEl) return;
        const filtered = notifSelectedCategory === 'all'
            ? notifHistoryListItems
            : notifHistoryListItems.filter(item => getNotificationCategory(item).key === notifSelectedCategory);
        const unreadCount = filtered.filter(i => i.is_read === 0).length;
        if (countLabel) {
            const catName = NOTIF_CATEGORIES.find(c => c.key === notifSelectedCategory)?.label || '전체';
            const unreadTxt = unreadCount > 0 ? `, 미확인 ${unreadCount}건` : '';
            countLabel.textContent = notifSelectedCategory === 'all'
                ? `전체 알림 (총 ${notifHistoryTotal}건 중 ${filtered.length}건${unreadTxt})`
                : `${catName} 알림 (${filtered.length}건 / 전체 총 ${notifHistoryTotal}건${unreadTxt})`;
        }
        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 3.5rem 1rem; font-size: 0.9rem;">해당 분류의 알림 내역이 없습니다.</div>';
            if (loadMoreBox) loadMoreBox.style.display = 'none';
            return;
        }
        const cardsHtml = filtered.map(item => {
            const cat = getNotificationCategory(item);
            const timeStr = formatNotificationTime(item.created_at);
            const linkUrl = item.url || '#';
            const isUnread = item.is_read === 0;
            const newBadge = isUnread ? '<span class="notif-badge-new">NEW</span>' : '';
            const safeUrlAttr = escapeHtml(linkUrl);
            return `
                <div class="notif-card-item ${isUnread ? 'is-unread' : 'is-read'}" id="notif-card-${item.id}" data-url="${safeUrlAttr}" onclick="openAndReadNotification(${item.id}, this.getAttribute('data-url'))">
                    <div class="notif-card-header">
                        <span class="notif-card-category-badge ${cat.colorClass}">
                            <span>${cat.icon}</span> <span>${cat.label}</span>
                        </span>
                        <div class="notif-card-meta">
                            <span class="notif-card-time" title="${escapeHtml(item.created_at || '')}">${timeStr}</span>
                            ${newBadge}
                        </div>
                    </div>
                    <div class="notif-card-content">
                        <div class="notif-card-title-row">
                            <h4 class="notif-card-title">${escapeHtml(item.title || '알림')}</h4>
                            <div class="notif-more-menu-wrapper" onclick="event.stopPropagation()">
                                <button type="button" class="btn-notif-more" aria-label="메뉴 더보기" onclick="toggleNotifCardMenu(${item.id}, event)" title="더보기">⋮</button>
                                <div class="notif-dropdown-menu" id="notifDropdown-${item.id}">
                                    <button type="button" class="notif-dropdown-btn btn-action-delete" onclick="handleCardDelete(${item.id}, event)">
                                        <span>🗑️</span> <span>알림 삭제</span>
                                    </button>
                                    <button type="button" class="notif-dropdown-btn btn-action-mute" onclick="handleCardMute('${cat.key}', '${cat.label}', event)">
                                        <span>🔕</span> <span>${cat.label} 알림 끄기</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p class="notif-card-body">${escapeHtml(item.body || '')}</p>
                    </div>
                </div>
            `;
        }).join('');
        const hasMore = notifHistoryListItems.length < notifHistoryTotal;
        const endHtml = hasMore
            ? `<div class="notif-list-end-notice has-more"><div class="notif-end-icon">📄</div><div class="notif-end-text">현재 불러온 알림 목록의 마지막입니다.</div><div class="notif-end-sub">이전 알림을 더 확인하시려면 아래 <strong>[+ 이전 알림 더보기]</strong> 메뉴를 눌러주세요.</div></div>`
            : `<div class="notif-list-end-notice is-complete"><div class="notif-end-icon">✨</div><div class="notif-end-text">모든 알림을 확인했습니다.</div><div class="notif-end-sub">수신된 알림의 마지막입니다.</div></div>`;
        listEl.innerHTML = cardsHtml + endHtml;
        if (loadMoreBox) {
            loadMoreBox.style.display = hasMore ? 'block' : 'none';
            const btn = document.getElementById('btnNotifLoadMore');
            if (btn) btn.textContent = `+ 이전 알림 더보기 (${notifHistoryListItems.length}/${notifHistoryTotal})`;
        }
    }

    // 6. 알림 수신 내역 조회 & 카드 메뉴 액션
    function refreshNotificationHistory() {
        notifHistoryOffset = 0;
        notifHistoryListItems = [];
        fetchNotificationHistory(false);
    }

    function loadMoreNotificationHistory() {
        notifHistoryOffset += NOTIF_HISTORY_LIMIT;
        fetchNotificationHistory(true);
    }

    function updateAllBadges(cnt) {
        const text = cnt > 99 ? '99+' : String(cnt);
        document.querySelectorAll('#unavNotifBadge, #unavMobileNotifBadge, #notifHistoryBadge, .cmd-notif-badge, .unav-notif-badge').forEach(b => {
            b.textContent = text;
            b.style.display = cnt > 0 ? 'inline-block' : 'none';
        });
    }

    async function fetchNotificationHistory(isAppend = false) {
        try {
            const res = await fetch(`/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            const history = data.history || [];
            notifHistoryTotal = data.totalCount || 0;
            updateAllBadges(data.unreadCount || 0);
            notifHistoryListItems = isAppend ? notifHistoryListItems.concat(history) : history;
            renderCategoryChips();
            renderFilteredNotificationList();
        } catch (e) { console.error('[Notification] 내역 조회 오류:', e); }
    }

    async function markAllNotificationsAsRead() {
        try {
            const res = await fetch('/api/notification/history/read-all', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems.forEach(i => i.is_read = 1);
                renderCategoryChips();
                renderFilteredNotificationList();
                updateAllBadges(0);
            }
        } catch (e) { console.error('전체 읽음 처리 오류:', e); }
    }

    async function openAndReadNotification(id, url) {
        try {
            await fetch(`/api/notification/history/${id}/read`, { method: 'POST', credentials: 'include', keepalive: true });
            const item = notifHistoryListItems.find(i => i.id === id);
            if (item) item.is_read = 1;
            renderCategoryChips();
            renderFilteredNotificationList();
            if (typeof window.initUnreadBadge === 'function') window.initUnreadBadge();
        } catch (e) {}
        const item = notifHistoryListItems.find(i => i.id === id);
        const rawUrl = (url && url !== '#') ? url : (item && item.url && item.url !== '#' ? item.url : '');
        const isSafeUrl = rawUrl && (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('/'));
        if (isSafeUrl) {
            if (typeof window.closeNotificationModal === 'function') window.closeNotificationModal();
            window.location.href = rawUrl;
        }
    }

    async function deleteNotificationItem(id) {
        if (!confirm('이 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/notification/history/${id}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = notifHistoryListItems.filter(i => i.id !== id);
                renderCategoryChips();
                renderFilteredNotificationList();
                if (typeof window.initUnreadBadge === 'function') window.initUnreadBadge();
            }
        } catch (e) { alert('삭제 오류: ' + e.message); }
    }

    async function clearAllNotificationHistory() {
        if (!confirm('수신된 모든 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch('/api/notification/history/clear/all', { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = [];
                notifHistoryTotal = 0;
                renderCategoryChips();
                renderFilteredNotificationList();
                updateAllBadges(0);
            }
        } catch (e) { alert('전체 삭제 오류: ' + e.message); }
    }

    function toggleNotifCardMenu(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const targetMenu = document.getElementById(`notifDropdown-${id}`);
        const isAlreadyOpen = targetMenu && targetMenu.classList.contains('show');
        closeAllNotifMenus();
        if (targetMenu && !isAlreadyOpen) targetMenu.classList.add('show');
    }

    function closeAllNotifMenus() {
        document.querySelectorAll('.notif-dropdown-menu.show').forEach(el => el.classList.remove('show'));
    }

    function handleCardDelete(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        closeAllNotifMenus();
        deleteNotificationItem(id);
    }

    function handleCardMute(catKey, catLabel, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        closeAllNotifMenus();
        if (typeof window.muteNotificationCategory === 'function') {
            window.muteNotificationCategory(catKey, catLabel);
        }
    }

    // 전역 window 바인딩
    window.NOTIF_CATEGORIES = NOTIF_CATEGORIES;
    window.getNotificationCategory = getNotificationCategory;
    window.renderCategoryChips = renderCategoryChips;
    window.selectNotificationCategory = selectNotificationCategory;
    window.renderFilteredNotificationList = renderFilteredNotificationList;
    window.refreshNotificationHistory = refreshNotificationHistory;
    window.loadMoreNotificationHistory = loadMoreNotificationHistory;
    window.updateAllBadges = updateAllBadges;
    window.fetchNotificationHistory = fetchNotificationHistory;
    window.markAllNotificationsAsRead = markAllNotificationsAsRead;
    window.openAndReadNotification = openAndReadNotification;
    window.deleteNotificationItem = deleteNotificationItem;
    window.clearAllNotificationHistory = clearAllNotificationHistory;
    window.toggleNotifCardMenu = toggleNotifCardMenu;
    window.closeAllNotifMenus = closeAllNotifMenus;
    window.handleCardDelete = handleCardDelete;
    window.handleCardMute = handleCardMute;
})();
