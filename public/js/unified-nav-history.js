/**
 * 📜 JG 통합 상단 내비게이션 - 알림 수신 내역 및 카테고리 필터링 관리자
 * - 알림 목록 조회, 무한 스크롤, 카테고리 필터 칩 렌더링
 * - 개별/전체 읽음 처리 및 삭제, 알림 음소거 액션
 * - 미확인 알림 뱃지 카운트 비동기 동기화
 */
(function() {
    const NOTIF_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://j-jg.cc';

    let notifHistoryOffset = 0;
    const NOTIF_HISTORY_LIMIT = 30;
    let notifHistoryTotal = 0;
    let notifHistoryListItems = [];
    let notifSelectedCategory = 'all';

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ⏱️ 알림 시간 상대 표기 (오늘 온 알림은 몇분 전, 몇시간 전)
    function formatNotificationTime(dateStr) {
        if (!dateStr) return '';
        const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
        let targetDate = null;
        if (m) {
            targetDate = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6] || '0', 10));
        } else {
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) targetDate = parsed;
        }
        if (!targetDate) return String(dateStr).replace('T', ' ').slice(5, 16);

        const now = new Date();
        const diffMs = now.getTime() - targetDate.getTime();
        const isToday = (now.getFullYear() === targetDate.getFullYear() && now.getMonth() === targetDate.getMonth() && now.getDate() === targetDate.getDate());

        if (isToday) {
            if (diffMs < 60 * 1000) return '방금 전';
            const diffMinutes = Math.floor(diffMs / (60 * 1000));
            if (diffMinutes < 60) return `${diffMinutes}분 전`;
            const diffHours = Math.floor(diffMinutes / 60);
            const remainMinutes = diffMinutes % 60;
            return remainMinutes === 0 ? `${diffHours}시간 전` : `${diffHours}시간 ${remainMinutes}분 전`;
        }

        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = (yesterday.getFullYear() === targetDate.getFullYear() && yesterday.getMonth() === targetDate.getMonth() && yesterday.getDate() === targetDate.getDate());

        const pad = n => String(n).padStart(2, '0');
        const hours = pad(targetDate.getHours()), minutes = pad(targetDate.getMinutes());
        const month = pad(targetDate.getMonth() + 1), date = pad(targetDate.getDate());

        if (isYesterday) return `어제 ${hours}:${minutes}`;
        if (now.getFullYear() === targetDate.getFullYear()) return `${month}-${date} ${hours}:${minutes}`;
        return `${targetDate.getFullYear()}-${month}-${date} ${hours}:${minutes}`;
    }

    // 🏷️ 알림 카테고리 메타 정의
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

    function getNotificationCategory(item) {
        const type = (item.type || '').toLowerCase();
        const title = (item.title || '').toLowerCase();
        const body = (item.body || '').toLowerCase();
        const full = `${type} ${title} ${body}`;

        if (type === 'album' || full.includes('가족앨범') || full.includes('앨범') || full.includes('새 사진') || full.includes('댓글이 등록') || full.includes('회원님을 언급')) {
            return { key: 'album', label: '가족앨범', icon: '📸', colorClass: 'cat-album' };
        }
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
        const visibleCats = isFamily ? NOTIF_CATEGORIES.filter(c => !['system', 'health'].includes(c.key)) : NOTIF_CATEGORIES;

        const counts = { all: notifHistoryListItems.length };
        const unreads = { all: 0 };
        visibleCats.forEach(c => {
            if (c.key !== 'all') { counts[c.key] = 0; unreads[c.key] = 0; }
        });

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
            const unreadDot = unread > 0 ? '<span class="notif-cat-unread-dot"></span>' : '';
            return `
                <button type="button" class="notif-cat-chip ${isActive ? 'active' : ''}" onclick="selectNotificationCategory('${cat.key}')">
                    <span>${cat.icon} ${cat.label}</span>
                    ${unreadDot}
                    <span class="notif-cat-badge">${total}</span>
                </button>
            `;
        }).join('');
    }

    window.selectNotificationCategory = function(catKey) {
        notifSelectedCategory = catKey;
        renderCategoryChips();
        renderFilteredNotificationList();
    };

    function renderFilteredNotificationList() {
        const listEl = document.getElementById('notifHistoryList');
        const countLabel = document.getElementById('notifHistoryCountLabel');
        const loadMoreBox = document.getElementById('notifLoadMoreBox');
        if (!listEl) return;

        const filteredItems = notifSelectedCategory === 'all'
            ? notifHistoryListItems
            : notifHistoryListItems.filter(item => getNotificationCategory(item).key === notifSelectedCategory);

        const filteredUnread = filteredItems.filter(i => i.is_read === 0).length;

        if (countLabel) {
            const catName = NOTIF_CATEGORIES.find(c => c.key === notifSelectedCategory)?.label || '전체';
            const unreadText = filteredUnread > 0 ? `, 미확인 ${filteredUnread}건` : '';
            if (notifSelectedCategory === 'all') {
                countLabel.textContent = `전체 알림 (총 ${notifHistoryTotal}건 중 ${filteredItems.length}건${unreadText})`;
            } else {
                countLabel.textContent = `${catName} 알림 (${filteredItems.length}건 / 전체 총 ${notifHistoryTotal}건${unreadText})`;
            }
        }

        if (filteredItems.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 3.5rem 1rem; font-size: 0.9rem;">해당 분류의 알림 내역이 없습니다.</div>';
            if (loadMoreBox) loadMoreBox.style.display = 'none';
            return;
        }

        const cardsHtml = filteredItems.map(item => {
            const cat = getNotificationCategory(item);
            const timeStr = formatNotificationTime(item.created_at);
            const linkUrl = item.url || '#';
            const isUnread = item.is_read === 0;
            const cardClass = isUnread ? 'notif-card-item is-unread' : 'notif-card-item is-read';
            const newBadge = isUnread ? '<span class="notif-badge-new">NEW</span>' : '';
            const safeUrl = linkUrl.replace(/'/g, "\\'");

            return `
                <div class="${cardClass}" id="notif-card-${item.id}" onclick="openAndReadNotification(${item.id}, '${safeUrl}')">
                    <div class="notif-card-header">
                        <span class="notif-card-category-badge ${cat.colorClass}">
                            <span>${cat.icon}</span>
                            <span>${cat.label}</span>
                        </span>
                        <div class="notif-card-meta">
                            <span class="notif-card-time" title="${item.created_at || ''}">${timeStr}</span>
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
                                        <span>🗑️</span>
                                        <span>알림 삭제</span>
                                    </button>
                                    <button type="button" class="notif-dropdown-btn btn-action-mute" onclick="handleCardMute('${cat.key}', '${cat.label}', event)">
                                        <span>🔕</span>
                                        <span>${cat.label} 알림 끄기</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p class="notif-card-body">${escapeHtml(item.body || '')}</p>
                    </div>
                </div>
            `;
        }).join('');

        const hasMoreInDb = notifHistoryListItems.length < notifHistoryTotal;
        const endNoticeHtml = hasMoreInDb
            ? `<div class="notif-list-end-notice has-more">
                   <div class="notif-end-icon">📄</div>
                   <div class="notif-end-text">현재 불러온 알림 목록의 마지막입니다.</div>
                   <div class="notif-end-sub">이전 알림을 더 확인하시려면 아래 <strong>[+ 이전 알림 더보기]</strong> 메뉴를 눌러주세요.</div>
               </div>`
            : `<div class="notif-list-end-notice is-complete">
                   <div class="notif-end-icon">✨</div>
                   <div class="notif-end-text">모든 알림을 확인했습니다.</div>
                   <div class="notif-end-sub">수신된 알림의 마지막입니다.</div>
               </div>`;

        listEl.innerHTML = cardsHtml + endNoticeHtml;

        if (loadMoreBox) {
            loadMoreBox.style.display = hasMoreInDb ? 'block' : 'none';
            const btn = document.getElementById('btnNotifLoadMore');
            if (btn) btn.textContent = `+ 이전 알림 더보기 (${notifHistoryListItems.length}/${notifHistoryTotal})`;
        }
    }

    window.refreshNotificationHistory = function() {
        notifHistoryOffset = 0;
        notifHistoryListItems = [];
        window.fetchNotificationHistory(false);
    };

    window.loadMoreNotificationHistory = function() {
        notifHistoryOffset += NOTIF_HISTORY_LIMIT;
        window.fetchNotificationHistory(true);
    };

    window.fetchNotificationHistory = async function(isAppend = false) {
        const listEl = document.getElementById('notifHistoryList');
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history?limit=${NOTIF_HISTORY_LIMIT}&offset=${notifHistoryOffset}`, {
                credentials: 'include'
            });
            const data = await res.json();
            const history = data.history || [];
            const unreadCount = data.unreadCount || 0;
            notifHistoryTotal = data.totalCount || 0;

            const updateBadge = (id, cnt) => {
                const b = document.getElementById(id);
                if (b) {
                    b.textContent = cnt;
                    b.style.display = cnt > 0 ? 'inline-block' : 'none';
                }
            };
            updateBadge('unavNotifBadge', unreadCount);
            updateBadge('unavMobileNotifBadge', unreadCount);
            updateBadge('unavMNotifBadge', unreadCount);
            updateBadge('notifHistoryBadge', unreadCount);

            if (isAppend) {
                notifHistoryListItems = notifHistoryListItems.concat(history);
            } else {
                notifHistoryListItems = history;
            }

            renderCategoryChips();
            renderFilteredNotificationList();
        } catch (e) {
            console.error('[알림 내역 조회 오류]:', e);
            if (listEl) listEl.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 2rem 0; font-size: 0.88rem;">알림 내역을 불러오지 못했습니다.</div>';
        }
    };

    window.markAllNotificationsAsRead = async function() {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/read-all`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems.forEach(i => i.is_read = 1);
                renderCategoryChips();
                renderFilteredNotificationList();
                const updateBadge = (bId) => {
                    const b = document.getElementById(bId);
                    if (b) b.style.display = 'none';
                };
                updateBadge('unavNotifBadge');
                updateBadge('unavMobileNotifBadge');
                updateBadge('unavMNotifBadge');
                updateBadge('notifHistoryBadge');
            } else {
                alert('읽음 처리 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            console.error('전체 읽음 처리 오류:', e);
        }
    };

    window.openAndReadNotification = async function(id, url) {
        try {
            await fetch(`${NOTIF_BASE_URL}/api/notification/history/${id}/read`, {
                method: 'POST',
                credentials: 'include',
                keepalive: true
            });
            const item = notifHistoryListItems.find(i => i.id === id);
            if (item) item.is_read = 1;
            renderCategoryChips();
            renderFilteredNotificationList();
        } catch (e) {
            console.error('Failed to mark read', e);
        }

        const item = notifHistoryListItems.find(i => i.id === id);
        const targetUrl = (url && url !== '#' && !url.startsWith('javascript:'))
            ? url
            : (item && item.url && item.url !== '#' && !item.url.startsWith('javascript:') ? item.url : '');

        if (targetUrl) {
            if (typeof window.closeNotificationModal === 'function') {
                window.closeNotificationModal();
            }
            window.location.href = targetUrl;
        }
    };

    window.markSingleAsRead = async function(id) {
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/${id}/read`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                const item = notifHistoryListItems.find(i => i.id === id);
                if (item) item.is_read = 1;
                renderCategoryChips();
                renderFilteredNotificationList();

                const currentUnread = parseInt(document.getElementById('unavNotifBadge')?.textContent || '1', 10);
                const newUnread = Math.max(0, currentUnread - 1);
                const updateBadge = (bId, cnt) => {
                    const b = document.getElementById(bId);
                    if (b) {
                        b.textContent = cnt;
                        b.style.display = cnt > 0 ? 'inline-block' : 'none';
                    }
                };
                updateBadge('unavNotifBadge', newUnread);
                updateBadge('unavMobileNotifBadge', newUnread);
                updateBadge('unavMNotifBadge', newUnread);
                updateBadge('notifHistoryBadge', newUnread);
            }
        } catch (e) {
            console.error('개별 읽음 처리 오류:', e);
        }
    };

    window.deleteNotificationItem = async function(id) {
        if (!confirm('이 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = notifHistoryListItems.filter(i => i.id !== id);
                renderCategoryChips();
                renderFilteredNotificationList();
            } else {
                alert('삭제 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            alert('삭제 중 오류: ' + e.message);
        }
    };

    window.clearAllNotificationHistory = async function() {
        if (!confirm('수신된 모든 알림 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`${NOTIF_BASE_URL}/api/notification/history/clear/all`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                notifHistoryListItems = [];
                renderCategoryChips();
                renderFilteredNotificationList();
            } else {
                alert('전체 삭제 실패: ' + (data.message || '오류'));
            }
        } catch (e) {
            alert('전체 삭제 중 오류: ' + e.message);
        }
    };

    window.toggleNotifCardMenu = function(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const targetMenu = document.getElementById(`notifDropdown-${id}`);
        const isAlreadyOpen = targetMenu && targetMenu.classList.contains('show');
        window.closeAllNotifMenus();
        if (targetMenu && !isAlreadyOpen) {
            targetMenu.classList.add('show');
        }
    };

    window.closeAllNotifMenus = function() {
        document.querySelectorAll('.notif-dropdown-menu.show').forEach(el => el.classList.remove('show'));
    };

    window.handleCardDelete = function(id, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.closeAllNotifMenus();
        window.deleteNotificationItem(id);
    };

    window.handleCardMute = async function(catKey, catLabel, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.closeAllNotifMenus();

        const label = catLabel || '해당';
        if (!confirm(`'${label}' 관련 알림을 끄시겠습니까?\n('알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.)`)) {
            return;
        }

        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        const settings = window.portalNotifSettings || {};

        if (catKey === 'breaking') {
            settings.breaking_news_enabled = 0;
            setCheck('notifBreakingNewsEnabled', false);
        } else if (catKey === 'calendar') {
            settings.hospital_push_enabled = 0;
            setCheck('notifHospitalPushEnabled', false);
        } else if (catKey === 'weather') {
            settings.weather_morning_enabled = 0;
            setCheck('notifWeatherMorningEnabled', false);
        } else if (catKey === 'finance') {
            settings.asset_open_enabled = 0;
            settings.asset_close_enabled = 0;
            settings.asset_report_enabled = 0;
            setCheck('notifAssetOpenEnabled', false);
            setCheck('notifAssetCloseEnabled', false);
            setCheck('notifAssetReportEnabled', false);
        } else if (catKey === 'health') {
            settings.bp_reminder_enabled = 0;
            setCheck('notifBpReminderEnabled', false);
        } else if (catKey === 'system') {
            settings.system_alert_enabled = 0;
            setCheck('notifSystemAlertEnabled', false);
        }

        try {
            await fetch(`${NOTIF_BASE_URL}/api/notification/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            alert(`🔕 '${label}' 알림을 껐습니다.\n'알림 맞춤 설정' 탭에서 언제든지 다시 켤 수 있습니다.`);
        } catch (err) {
            console.error('[알림 음소거 저장 실패]:', err);
            alert('설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    window.fetchUnreadNotificationBadge = function() {
        const apiUrl = `${NOTIF_BASE_URL}/api/notification/history?limit=1`;
        fetch(apiUrl, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data && typeof data.unreadCount === 'number') {
                    const cnt = data.unreadCount;
                    const text = cnt > 99 ? '99+' : String(cnt);
                    const badges = document.querySelectorAll('#unavNotifBadge, #unavMobileNotifBadge, #unavMNotifBadge, .unav-notif-badge');
                    badges.forEach(b => {
                        b.textContent = text;
                        b.style.display = cnt > 0 ? 'inline-block' : 'none';
                    });
                }
            })
            .catch(() => {});
    };
})();
