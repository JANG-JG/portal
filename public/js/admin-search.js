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

            renderNaverSubApis(data.naverSubApis || []);
        } catch (_) {}
    }

    function renderNaverSubApis(subApis) {
        const wrap = document.getElementById('adminNaverSubApisWrap');
        if (!wrap) return;
        wrap.replaceChildren();

        subApis.forEach((sub) => {
            const isBlocked = Boolean(sub.enabled && sub.authBlocked);
            const chip = document.createElement('div');
            const bg = !sub.enabled ? '#f8fafc' : (isBlocked ? '#fffbeb' : '#eff6ff');
            const border = !sub.enabled ? '#cbd5e1' : (isBlocked ? '#f59e0b' : '#3b82f6');
            const color = !sub.enabled ? '#64748b' : (isBlocked ? '#b45309' : '#1d4ed8');
            chip.style.cssText = `display:inline-flex;align-items:center;gap:0.35rem;padding:4px 8px;border-radius:8px;border:1px solid ${border};font-size:0.82rem;background:${bg};`;

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.style.cssText = `border:none;background:transparent;cursor:pointer;font-weight:700;padding:0;color:${color};`;
            const statusIcon = !sub.enabled ? '⬜' : (isBlocked ? '⚠️' : '✅');
            const blockSuffix = isBlocked ? ' · NCP 신청필요' : '';
            toggleBtn.textContent = `${statusIcon} ${sub.label} (${sub.code}${blockSuffix})`;
            toggleBtn.title = isBlocked ? '네이버 클라우드(NCP) 콘솔에서 해당 검색 API 이용신청이 필요합니다.' : '클릭하여 ON/OFF 전환';
            toggleBtn.addEventListener('click', async () => {
                await fetch('/api/admin/search/naver-subapi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ code: sub.code, enabled: !sub.enabled })
                });
                loadAdminSearchStatus();
            });
            chip.appendChild(toggleBtn);

            if (sub.custom) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.title = '삭제';
                delBtn.style.cssText = 'border:none;background:transparent;cursor:pointer;color:#ef4444;font-weight:700;padding:0 2px;';
                delBtn.textContent = '×';
                delBtn.addEventListener('click', async () => {
                    await fetch(`/api/admin/search/naver-subapi/${encodeURIComponent(sub.code)}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    loadAdminSearchStatus();
                });
                chip.appendChild(delBtn);
            }

            wrap.appendChild(chip);
        });
    }

    window.addAdminNaverSubApi = async function () {
        const preset = document.getElementById('adminNaverSubApiPreset');
        const codeEl = document.getElementById('adminNaverSubApiCode');
        const labelEl = document.getElementById('adminNaverSubApiLabel');
        if (!preset) return;

        let code = '';
        let label = '';
        if (preset.value === 'custom:직접입력') {
            code = (codeEl?.value || '').trim().toLowerCase();
            label = (labelEl?.value || '').trim();
        } else {
            const parts = preset.value.split(':');
            code = parts[0];
            label = parts[1] || code;
        }

        if (!code) {
            alert('추가할 네이버 검색 API 코드를 입력해 주세요. (예: book, shop, kin)');
            return;
        }

        try {
            const res = await fetch('/api/admin/search/naver-subapi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code, label: label || code, enabled: true })
            });
            const data = await res.json();
            if (!data.success) {
                alert(data.message || '세부 API 추가에 실패했습니다.');
                return;
            }
            if (codeEl) codeEl.value = '';
            if (labelEl) labelEl.value = '';
            loadAdminSearchStatus();
        } catch (_) {}
    };

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
        const preset = document.getElementById('adminNaverSubApiPreset');
        const codeEl = document.getElementById('adminNaverSubApiCode');
        const labelEl = document.getElementById('adminNaverSubApiLabel');
        if (preset && codeEl && labelEl) {
            preset.addEventListener('change', () => {
                const isCustom = preset.value === 'custom:직접입력';
                codeEl.style.display = isCustom ? '' : 'none';
                labelEl.style.display = isCustom ? '' : 'none';
            });
        }
        loadAdminSearchStatus();
    });
})();
