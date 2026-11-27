/**
 * 🔍 JG 관리자 센터 - 통합 검색 외부 API 관제 스크립트 (admin-search.js)
 */
(function () {
    'use strict';

    async function loadAdminSearchStatus() {
        const tbody = document.getElementById('adminSearchEnginesBody');
        const meta = document.getElementById('adminSearchCacheMeta');
        if (!tbody) return;

        try {
            const res = await fetch('/api/admin/search/status', { credentials: 'include' });
            const data = await res.json();
            if (!data.success) return;

            if (meta) {
                meta.textContent = `기준일: ${data.date} · 메모리 캐시: ${data.cacheSize || 0}건`;
            }

            tbody.replaceChildren();
            (data.engines || []).forEach((eng) => {
                const tr = document.createElement('tr');

                const tdName = document.createElement('td');
                const strong = document.createElement('strong');
                strong.textContent = eng.name;
                tdName.appendChild(strong);

                const tdKey = document.createElement('td');
                const keyBadge = document.createElement('span');
                keyBadge.className = 'badge';
                keyBadge.style.cssText = eng.configured
                    ? 'background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:6px;font-weight:700;'
                    : 'background:#fef3c7;color:#b45309;padding:3px 8px;border-radius:6px;font-weight:700;';
                keyBadge.textContent = eng.configured ? '키 연결됨' : '미설정 (.env 필요)';
                tdKey.appendChild(keyBadge);

                const tdUsage = document.createElement('td');
                const limitText = eng.dailyLimit ? ` / ${eng.dailyLimit.toLocaleString()}건` : ' (무제한)';
                tdUsage.textContent = `${(eng.todayCalls || 0).toLocaleString()}건${limitText}${eng.todayErrors ? ` (오류 ${eng.todayErrors})` : ''}`;

                const tdToggle = document.createElement('td');
                tdToggle.style.textAlign = 'center';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = eng.enabled ? 'btn-admin btn-admin-primary btn-admin-sm' : 'btn-admin btn-admin-outline btn-admin-sm';
                btn.textContent = eng.enabled ? 'ON (사용 중)' : 'OFF (중지)';
                btn.addEventListener('click', async () => {
                    await fetch('/api/admin/search/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ engineId: eng.id, enabled: !eng.enabled })
                    });
                    loadAdminSearchStatus();
                });
                tdToggle.appendChild(btn);

                tr.append(tdName, tdKey, tdUsage, tdToggle);
                tbody.appendChild(tr);
            });
        } catch (_) {}
    }

    window.loadAdminSearchStatus = loadAdminSearchStatus;

    window.clearAdminSearchCache = async function () {
        try {
            const res = await fetch('/api/admin/search/clear-cache', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                loadAdminSearchStatus();
                alert(data.message || '캐시를 비웠습니다.');
            }
        } catch (_) {}
    };

    document.addEventListener('DOMContentLoaded', () => {
        loadAdminSearchStatus();
    });
})();
