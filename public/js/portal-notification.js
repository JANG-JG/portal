/**
 * 🔔 JG 포털 알림 센터 스크립트 (portal-notification.js)
 * - 중앙 네비게이션(unified-nav.js)의 알림 모듈과 연동하여 동작합니다.
 * - 모듈화 표준(500줄 이하)을 준수하며 중복 코드를 제거하고 unified-nav의 표준 구현체로 위임합니다.
 */

// 모달 열기/닫기
function openNotificationModal() {
    if (typeof window.openNotificationModal === 'function') {
        window.openNotificationModal();
    } else {
        const modal = document.getElementById('notificationModal');
        if (modal) modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeNotificationModal() {
    if (typeof window.closeNotificationModal === 'function') {
        window.closeNotificationModal();
    } else {
        const modal = document.getElementById('notificationModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// 탭 전환
function switchNotifMainTab(tab) {
    if (typeof window.switchNotifMainTab === 'function') {
        window.switchNotifMainTab(tab);
    }
}

function switchNotifSubTab(type) {
    if (typeof window.switchNotifSubTab === 'function') {
        window.switchNotifSubTab(type);
    }
}

// 브라우저 웹 푸시 권한 및 등록
function updateBrowserPermissionUI() {
    if (typeof window.updateBrowserPermissionUI === 'function') {
        window.updateBrowserPermissionUI();
    }
}

function requestBrowserNotificationPermission() {
    if (typeof window.requestBrowserNotificationPermission === 'function') {
        window.requestBrowserNotificationPermission();
    }
}

function registerWebPushSubscription() {
    if (typeof window.registerWebPushSubscription === 'function') {
        return window.registerWebPushSubscription();
    }
}

// 알림 설정 조회 및 저장
function fetchNotificationSettings() {
    if (typeof window.fetchNotificationSettings === 'function') {
        window.fetchNotificationSettings();
    }
}

function saveNotificationSettings() {
    if (typeof window.saveNotificationSettings === 'function') {
        window.saveNotificationSettings();
    }
}

function sendTestNotification() {
    if (typeof window.sendTestNotification === 'function') {
        window.sendTestNotification();
    }
}

// 알림 시간표 조작
function addNotifTime(dayType, category) {
    if (typeof window.addNotifTime === 'function') {
        window.addNotifTime(dayType, category);
    }
}

function removeNotifTime(key, index) {
    if (typeof window.removeNotifTime === 'function') {
        window.removeNotifTime(key, index);
    }
}

function toggleAssetSubOptions(checked) {
    if (typeof window.toggleAssetSubOptions === 'function') {
        window.toggleAssetSubOptions(checked);
    }
}

function handleAssetSubOptionChange() {
    if (typeof window.handleAssetSubOptionChange === 'function') {
        window.handleAssetSubOptionChange();
    }
}

// 알림 내역 및 카테고리 필터링 조작
function selectNotificationCategory(catKey) {
    if (typeof window.selectNotificationCategory === 'function') {
        window.selectNotificationCategory(catKey);
    }
}

function fetchNotificationHistory(isAppend) {
    if (typeof window.fetchNotificationHistory === 'function') {
        window.fetchNotificationHistory(isAppend);
    }
}

function refreshNotificationHistory() {
    if (typeof window.refreshNotificationHistory === 'function') {
        window.refreshNotificationHistory();
    }
}

function loadMoreNotificationHistory() {
    if (typeof window.loadMoreNotificationHistory === 'function') {
        window.loadMoreNotificationHistory();
    }
}

function markAllNotificationsAsRead() {
    if (typeof window.markAllNotificationsAsRead === 'function') {
        window.markAllNotificationsAsRead();
    }
}

function openAndReadNotification(id, url) {
    if (typeof window.openAndReadNotification === 'function') {
        window.openAndReadNotification(id, url);
    }
}

function markSingleAsRead(id) {
    if (typeof window.markSingleAsRead === 'function') {
        window.markSingleAsRead(id);
    }
}

function deleteNotificationItem(id) {
    if (typeof window.deleteNotificationItem === 'function') {
        window.deleteNotificationItem(id);
    }
}

function clearAllNotificationHistory() {
    if (typeof window.clearAllNotificationHistory === 'function') {
        window.clearAllNotificationHistory();
    }
}
