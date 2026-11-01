/**
 * ==============================================================================
 * 관리자 페이지 가족 위키 & 루틴 제어 모듈 (admin-wiki.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적인 한국어 인터페이스 준수
 * [규칙 3] 파일당 500줄 이하 모듈화 준수 (약 350줄)
 * [규칙 6] 가로 360px 모바일 화면 반응형 및 터치 최적화
 * ==============================================================================
 */

let cachedWikiRoutines = [];
let cachedWikiDdays = [];
let cachedWikiPages = [];
let removeQrPending = false;

// ------------------------------------------------------------------------------
// 1. 위키 현황 & 요약 로드 (subpane-wiki-overview)
// ------------------------------------------------------------------------------
async function loadWikiAdminOverview() {
    try {
        const [sumRes, cardsRes, guidesRes, pagesRes] = await Promise.all([
            fetch('/api/wiki/dashboard-summary').then(r => r.json()).catch(() => ({})),
            fetch('/api/wiki/quick-cards/list').then(r => r.json()).catch(() => ({})),
            fetch('/api/wiki/pinned-guides/list').then(r => r.json()).catch(() => ({})),
            fetch('/api/wiki/pages/list').then(r => r.json()).catch(() => ({}))
        ]);

        // 1) 통계 카드 렌더링
        const pagesCnt = (pagesRes && pagesRes.items) ? pagesRes.items.length : '-';
        const ddaysCnt = (sumRes && sumRes.dday) ? sumRes.dday.length : 0;
        const routineStats = (sumRes && sumRes.routine_stats) ? sumRes.routine_stats : { total: 0, completed: 0, percent: 100 };

        const elPages = document.getElementById('wikiStatPages');
        if (elPages) elPages.textContent = pagesCnt !== '-' ? `${pagesCnt}개` : '-';

        const elDdays = document.getElementById('wikiStatDdays');
        if (elDdays) elDdays.textContent = `${ddaysCnt}건`;

        const elRoutinePct = document.getElementById('wikiStatRoutinePercent');
        if (elRoutinePct) {
            elRoutinePct.textContent = `${routineStats.percent}% (${routineStats.completed}/${routineStats.total})`;
        }

        const elWifi = document.getElementById('wikiStatWifi');
        if (elWifi) {
            fetch('/api/wiki/wifi')
                .then(r => r.json())
                .then(wData => {
                    if (wData.success && wData.wifi_ssid_5g) {
                        elWifi.textContent = `📶 ${wData.wifi_ssid_5g}`;
                        elWifi.style.color = '#059669';
                    } else {
                        elWifi.textContent = '설정 필요';
                    }
                })
                .catch(() => { if (elWifi) elWifi.textContent = '연결 대기'; });
        }

        // 2) 생활 퀵카드 렌더링
        const cardsContainer = document.getElementById('wikiQuickCardsContainer');
        if (cardsContainer) {
            const cards = (cardsRes && cardsRes.items) ? cardsRes.items : [];
            if (cards.length === 0) {
                cardsContainer.innerHTML = '<div style="text-align:center; padding:1.5rem; color:#94a3b8; grid-column:1/-1;">등록된 퀵카드가 없습니다.</div>';
            } else {
                cardsContainer.innerHTML = cards.map(c => `
                    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.85rem 1rem; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                            <div style="display:flex; align-items:center; gap:0.4rem; font-weight:700; color:#1e293b; font-size:0.9rem;">
                                <span>${c.icon || '📌'}</span>
                                <span>${escapeHtml(c.title)}</span>
                            </div>
                            <span style="font-size:0.72rem; font-weight:700; padding:2px 6px; border-radius:9999px; background:#f1f5f9; color:#475569;">
                                ${escapeHtml(c.badge_text || '')}
                            </span>
                        </div>
                        <div style="font-size:0.78rem; color:#64748b; line-height:1.45;">
                            ${c.line1_label ? `<div><strong>${escapeHtml(c.line1_label)}</strong> ${escapeHtml(c.line1_val || '-')}</div>` : ''}
                            ${c.line2_label ? `<div><strong>${escapeHtml(c.line2_label)}</strong> ${escapeHtml(c.line2_val || '-')}</div>` : ''}
                        </div>
                    </div>
                `).join('');
            }
        }

        // 3) 자주 찾는 필독 생활가이드 렌더링
        const guidesContainer = document.getElementById('wikiPinnedGuidesContainer');
        if (guidesContainer) {
            const guides = (guidesRes && guidesRes.items) ? guidesRes.items : [];
            if (guides.length === 0) {
                guidesContainer.innerHTML = '<div style="text-align:center; padding:1.5rem; color:#94a3b8; grid-column:1/-1;">등록된 필독 가이드가 없습니다.</div>';
            } else {
                guidesContainer.innerHTML = guides.map(g => `
                    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.85rem 1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                            <div style="font-weight:700; font-size:0.88rem; color:#1e293b;">
                                <span>${g.icon || '⭐'}</span> ${escapeHtml(g.title)}
                            </div>
                            <span style="font-size:0.7rem; font-weight:700; padding:1px 6px; border-radius:9999px; background:#fef3c7; color:#d97706;">
                                ${escapeHtml(g.badge_text || '생활가이드')}
                            </span>
                        </div>
                        <div style="font-size:0.78rem; color:#64748b; margin-bottom:0.4rem;">${escapeHtml(g.summary || '')}</div>
                        ${g.link_url ? `
                            <a href="${escapeHtml(g.link_url)}" target="_blank" rel="noopener" style="font-size:0.75rem; color:#2563eb; text-decoration:none; font-weight:600;">
                                바로가기 ›
                            </a>
                        ` : ''}
                    </div>
                `).join('');
            }
        }
    } catch (err) {
        console.error('[위키 요약 로드 실패]', err);
    }
}

// ------------------------------------------------------------------------------
// 2. 요일별 생활 루틴 & 할 일 관리 (subpane-wiki-routines)
// ------------------------------------------------------------------------------
async function loadWikiAdminRoutines() {
    const tableBody = document.getElementById('wikiRoutinesTableBody');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/wiki/todo/list');
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
            cachedWikiRoutines = data.items;
            renderWikiRoutinesTable();
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">${data.message || '루틴 목록을 불러오지 못했습니다.'}</td></tr>`;
        }
    } catch (err) {
        console.error('[위키 루틴 로드 실패]', err);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">서버와 통신할 수 없습니다.</td></tr>`;
    }
}

function renderWikiRoutinesTable() {
    const tableBody = document.getElementById('wikiRoutinesTableBody');
    if (!tableBody) return;

    const filterAssignee = (document.getElementById('wikiRoutineFilterAssignee')?.value || '').trim();
    let list = cachedWikiRoutines;
    if (filterAssignee) {
        list = list.filter(item => (item.assignee || '전체') === filterAssignee);
    }

    if (list.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; padding:2rem; color:#64748b;">
                    등록된 루틴 또는 할 일이 없습니다. 아래 폼에서 새로운 루틴을 등록해 보세요!
                </td>
            </tr>
        `;
        return;
    }

    const weekdayNames = ['월', '화', '수', '목', '금', '토', '일'];

    tableBody.innerHTML = list.map(item => {
        const isRoutine = Boolean(item.is_routine);
        const isDone = Boolean(item.is_completed);

        const typeBadge = isRoutine
            ? `<span style="font-size:0.72rem; font-weight:700; padding:2px 6px; border-radius:9999px; background:#eff6ff; color:#2563eb;">루틴</span>`
            : `<span style="font-size:0.72rem; font-weight:700; padding:2px 6px; border-radius:9999px; background:#f1f5f9; color:#64748b;">할일</span>`;

        const assignee = item.assignee || '전체';
        let assigneeBg = '#f1f5f9';
        let assigneeColor = '#475569';
        if (assignee === '아빠') { assigneeBg = '#eff6ff'; assigneeColor = '#2563eb'; }
        else if (assignee === '엄마') { assigneeBg = '#fdf2f8'; assigneeColor = '#db2777'; }
        else if (assignee === '아이') { assigneeBg = '#fffbeb'; assigneeColor = '#d97706'; }

        const assigneeBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:9999px; background:${assigneeBg}; color:${assigneeColor};">${escapeHtml(assignee)}</span>`;

        let daysText = '-';
        if (isRoutine) {
            const rawDays = String(item.routine_days || '').trim();
            if (!rawDays) {
                daysText = '<span style="font-size:0.75rem; font-weight:700; color:#059669;">매일</span>';
            } else {
                const daysList = rawDays.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                daysText = daysList.map(d => `<span style="font-size:0.72rem; padding:1px 4px; border-radius:4px; background:#e2e8f0; margin-right:2px;">${weekdayNames[d] || d}</span>`).join('');
            }
        }

        const statusHtml = isDone
            ? `<span style="color:#059669; font-weight:700; font-size:0.8rem;">✅ 완료</span>`
            : `<span style="color:#d97706; font-weight:700; font-size:0.8rem;">⏳ 진행중</span>`;

        return `
            <tr>
                <td>${typeBadge}</td>
                <td>${assigneeBadge}</td>
                <td>${daysText}</td>
                <td style="font-size:0.88rem; font-weight:600; color:${isDone ? '#94a3b8; text-decoration:line-through;' : '#1e293b;'}">
                    ${escapeHtml(item.content)}
                </td>
                <td style="text-align:center;">${statusHtml}</td>
                <td style="text-align:center;">
                    <div style="display:flex; gap:4px; justify-content:center;">
                        <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleWikiTodo(${item.id})">
                            ${isDone ? '취소' : '완료'}
                        </button>
                        <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="deleteWikiTodo(${item.id}, '${escapeHtml(item.content)}')">
                            삭제
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function toggleWikiTodo(todoId) {
    try {
        const res = await fetch(`/api/wiki/todo/toggle/${todoId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(data.is_completed ? '✅ 루틴 완료 처리되었습니다!' : '루틴 미완료로 변경되었습니다.');
            await loadWikiAdminRoutines();
        } else {
            alert(data.message || '상태 변경 실패');
        }
    } catch (e) {
        alert('서버 오류가 발생했습니다.');
    }
}

async function deleteWikiTodo(todoId, content) {
    if (!confirm(`[${content}] 항목을 삭제하시겠습니까?`)) return;
    try {
        const res = await fetch(`/api/wiki/todo/delete/${todoId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('🗑️ 루틴이 삭제되었습니다.');
            await loadWikiAdminRoutines();
        } else {
            alert(data.message || '삭제 실패');
        }
    } catch (e) {
        alert('삭제 중 서버 오류가 발생했습니다.');
    }
}

function toggleRoutineDaysInputs(isChecked) {
    const group = document.getElementById('routineDaysCheckboxGroup');
    if (group) {
        group.style.opacity = isChecked ? '1' : '0.4';
        group.querySelectorAll('input').forEach(chk => { chk.disabled = !isChecked; });
    }
}

async function submitAddWikiRoutine(e) {
    e.preventDefault();
    const content = (document.getElementById('inputRoutineContent')?.value || '').trim();
    const assignee = document.getElementById('selectRoutineAssignee')?.value || '전체';
    const isRoutine = document.getElementById('chkIsRoutine')?.checked ? 1 : 0;

    let routineDays = '';
    if (isRoutine) {
        const checkedDays = Array.from(document.querySelectorAll('.chk-weekday:checked')).map(el => el.value);
        routineDays = checkedDays.join(',');
    }

    if (!content) {
        alert('내용을 입력해 주세요.');
        return;
    }

    try {
        const res = await fetch('/api/wiki/todo/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, assignee, is_routine: isRoutine, routine_days: routineDays })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ 새로운 루틴이 등록되었습니다!');
            document.getElementById('inputRoutineContent').value = '';
            document.querySelectorAll('.chk-weekday').forEach(chk => { chk.checked = false; });
            await loadWikiAdminRoutines();
        } else {
            alert(data.message || '등록 실패');
        }
    } catch (err) {
        alert('등록 중 서버 오류가 발생했습니다.');
    }
}

// ------------------------------------------------------------------------------
// 3. D-Day & 소모품 주기 관리 (subpane-wiki-ddays)
// ------------------------------------------------------------------------------
async function loadWikiAdminDdays() {
    const tableBody = document.getElementById('wikiDdaysTableBody');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/wiki/dday/list');
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
            cachedWikiDdays = data.items;
            renderWikiDdaysTable();
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">${data.message || 'D-Day 일정을 불러오지 못했습니다.'}</td></tr>`;
        }
    } catch (err) {
        console.error('[위키 D-Day 로드 실패]', err);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">서버와 통신할 수 없습니다.</td></tr>`;
    }
}

function renderWikiDdaysTable() {
    const tableBody = document.getElementById('wikiDdaysTableBody');
    if (!tableBody) return;

    if (cachedWikiDdays.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; padding:2rem; color:#64748b;">
                    등록된 D-Day 일정이 없습니다. 아래 폼에서 새로운 일정을 등록해 보세요!
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = cachedWikiDdays.map(item => {
        const info = item.dday_info || {};
        const isCompleted = Boolean(item.is_completed);
        const cycle = item.cycle_days || 0;

        let badgeStyle = 'background:#f1f5f9; color:#475569;';
        if (info.is_imminent) badgeStyle = 'background:#fef3c7; color:#d97706; font-weight:800;';
        if (info.is_overdue) badgeStyle = 'background:#fee2e2; color:#dc2626; font-weight:800;';
        if (isCompleted) badgeStyle = 'background:#dcfce7; color:#15803d;';

        const ddayBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:9999px; ${badgeStyle}">${escapeHtml(info.text || '-')}</span>`;

        return `
            <tr>
                <td><span style="font-size:0.75rem; font-weight:700; padding:2px 6px; border-radius:4px; background:#f8fafc; border:1px solid #cbd5e1;">${escapeHtml(item.category || '기타')}</span></td>
                <td>
                    <div style="font-weight:700; color:#1e293b; font-size:0.9rem;">${escapeHtml(item.title)}</div>
                    ${item.memo ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;">${escapeHtml(item.memo)}</div>` : ''}
                </td>
                <td style="font-size:0.82rem; color:#475569; font-family:monospace;">${escapeHtml(item.target_date || '-')}</td>
                <td style="text-align:center;">${ddayBadge}</td>
                <td style="text-align:center; font-size:0.8rem; color:#64748b;">${cycle > 0 ? `${cycle}일 주기` : '1회성'}</td>
                <td style="text-align:center;">
                    <div style="display:flex; gap:4px; justify-content:center;">
                        <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="completeWikiDday(${item.id})">
                            ${cycle > 0 ? '🔄 교체/갱신' : (isCompleted ? '취소' : '완료')}
                        </button>
                        <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="deleteWikiDday(${item.id}, '${escapeHtml(item.title)}')">
                            삭제
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function completeWikiDday(ddayId) {
    try {
        const res = await fetch(`/api/wiki/dday/complete/${ddayId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message || '처리되었습니다.');
            await loadWikiAdminDdays();
        } else {
            alert(data.message || '처리 실패');
        }
    } catch (e) {
        alert('서버 오류가 발생했습니다.');
    }
}

async function deleteWikiDday(ddayId, title) {
    if (!confirm(`[${title}] 일정을 삭제하시겠습니까?`)) return;
    try {
        const res = await fetch(`/api/wiki/dday/delete/${ddayId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('🗑️ 일정이 삭제되었습니다.');
            await loadWikiAdminDdays();
        } else {
            alert(data.message || '삭제 실패');
        }
    } catch (e) {
        alert('삭제 중 오류가 발생했습니다.');
    }
}

async function submitAddWikiDday(e) {
    e.preventDefault();
    const category = document.getElementById('inputDdayCategory')?.value || '기타';
    const title = (document.getElementById('inputDdayTitle')?.value || '').trim();
    const target_date = document.getElementById('inputDdayTargetDate')?.value || '';
    const cycle_days = parseInt(document.getElementById('inputDdayCycleDays')?.value || 0, 10);
    const memo = (document.getElementById('inputDdayMemo')?.value || '').trim();

    if (!title || !target_date) {
        alert('일정명과 목표 날짜를 입력해 주세요.');
        return;
    }

    try {
        const res = await fetch('/api/wiki/dday/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, title, target_date, cycle_days, memo })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ D-Day 일정이 등록되었습니다!');
            document.getElementById('inputDdayTitle').value = '';
            document.getElementById('inputDdayMemo').value = '';
            await loadWikiAdminDdays();
        } else {
            alert(data.message || '등록 실패');
        }
    } catch (e) {
        alert('등록 중 서버 오류가 발생했습니다.');
    }
}

// ------------------------------------------------------------------------------
// 4. Wi-Fi & 비상 의료 설정 관리 (subpane-wiki-configs)
// ------------------------------------------------------------------------------
async function loadWikiAdminConfigs() {
    removeQrPending = false;
    try {
        const [wifiRes, medRes] = await Promise.all([
            fetch('/api/wiki/wifi').then(r => r.json()).catch(() => ({})),
            fetch('/api/wiki/medical').then(r => r.json()).catch(() => ({}))
        ]);

        if (wifiRes && wifiRes.success) {
            if (document.getElementById('cfgWifiSsid5g')) document.getElementById('cfgWifiSsid5g').value = wifiRes.wifi_ssid_5g || '';
            if (document.getElementById('cfgWifiSsid2g')) document.getElementById('cfgWifiSsid2g').value = wifiRes.wifi_ssid_2g || '';
            if (document.getElementById('cfgWifiPw')) document.getElementById('cfgWifiPw').value = wifiRes.wifi_pw || '';

            const preview = document.getElementById('cfgWifiQrPreview');
            if (preview) {
                if (wifiRes.wifi_qr_img) {
                    preview.innerHTML = `<img src="${wifiRes.wifi_qr_img}" style="width:100%; height:100%; object-fit:contain;" alt="QR">`;
                } else {
                    preview.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8; text-align:center;">미등록</span>';
                }
            }
        }

        if (medRes && medRes.success && medRes.data) {
            const d = medRes.data;
            if (document.getElementById('cfgMedPediatricName')) document.getElementById('cfgMedPediatricName').value = d.pediatric?.name || '';
            if (document.getElementById('cfgMedPediatricPhone')) document.getElementById('cfgMedPediatricPhone').value = d.pediatric?.phone || '';
            if (document.getElementById('cfgMedPediatricDesc')) document.getElementById('cfgMedPediatricDesc').value = d.pediatric?.desc || '';
            if (document.getElementById('cfgMedEmergencyName')) document.getElementById('cfgMedEmergencyName').value = d.emergency?.name || '';
            if (document.getElementById('cfgMedEmergencyPhone')) document.getElementById('cfgMedEmergencyPhone').value = d.emergency?.phone || '';
            if (document.getElementById('cfgMedEmergencyDesc')) document.getElementById('cfgMedEmergencyDesc').value = d.emergency?.desc || '';
            if (document.getElementById('cfgMedCabinetLoc')) document.getElementById('cfgMedCabinetLoc').value = d.cabinet_loc || '';
        }
    } catch (err) {
        console.error('[위키 설정 로드 실패]', err);
    }
}

function removeWifiQrImage() {
    removeQrPending = true;
    const preview = document.getElementById('cfgWifiQrPreview');
    if (preview) preview.innerHTML = '<span style="font-size:0.75rem; color:#dc2626;">삭제 대기</span>';
    showToast('저장 시 QR 이미지가 삭제됩니다.');
}

async function submitSaveWikiWifi(e) {
    e.preventDefault();
    const ssid5g = document.getElementById('cfgWifiSsid5g')?.value.trim();
    const ssid2g = document.getElementById('cfgWifiSsid2g')?.value.trim();
    const pw = document.getElementById('cfgWifiPw')?.value.trim();
    const fileInput = document.getElementById('cfgWifiQrFile');

    const formData = new FormData();
    formData.append('wifi_ssid_5g', ssid5g);
    formData.append('wifi_ssid_2g', ssid2g);
    formData.append('wifi_pw', pw);
    if (removeQrPending) formData.append('remove_qr_img', '1');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        formData.append('qr_image', fileInput.files[0]);
    }

    try {
        const res = await fetch('/api/wiki/wifi/update', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Wi-Fi 설정이 성공적으로 저장되었습니다!');
            removeQrPending = false;
            if (fileInput) fileInput.value = '';
            await loadWikiAdminConfigs();
        } else {
            alert(data.message || '저장 실패');
        }
    } catch (err) {
        alert('저장 중 서버 오류가 발생했습니다.');
    }
}

async function submitSaveWikiMedical(e) {
    e.preventDefault();
    const payload = {
        medical_pediatric_name: document.getElementById('cfgMedPediatricName')?.value.trim() || '',
        medical_pediatric_phone: document.getElementById('cfgMedPediatricPhone')?.value.trim() || '',
        medical_pediatric_desc: document.getElementById('cfgMedPediatricDesc')?.value.trim() || '',
        medical_emergency_name: document.getElementById('cfgMedEmergencyName')?.value.trim() || '',
        medical_emergency_phone: document.getElementById('cfgMedEmergencyPhone')?.value.trim() || '',
        medical_emergency_desc: document.getElementById('cfgMedEmergencyDesc')?.value.trim() || '',
        medical_cabinet_loc: document.getElementById('cfgMedCabinetLoc')?.value.trim() || ''
    };

    try {
        const res = await fetch('/api/wiki/medical/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ 비상 의료 정보가 안전하게 저장되었습니다!');
            await loadWikiAdminConfigs();
        } else {
            alert(data.message || '저장 실패');
        }
    } catch (err) {
        alert('저장 중 서버 오류가 발생했습니다.');
    }
}

// ------------------------------------------------------------------------------
// 5. 위키 문서 보관함 & 관리 (subpane-wiki-pages)
// ------------------------------------------------------------------------------
async function loadWikiAdminPages() {
    const tableBody = document.getElementById('wikiPagesTableBody');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/wiki/pages/list');
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
            cachedWikiPages = data.items;
            renderWikiPagesTable();
        } else {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#ef4444;">${data.message || '위키 문서를 불러오지 못했습니다.'}</td></tr>`;
        }
    } catch (err) {
        console.error('[위키 문서 로드 실패]', err);
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#ef4444;">서버와 통신할 수 없습니다.</td></tr>`;
    }
}

function renderWikiPagesTable() {
    const tableBody = document.getElementById('wikiPagesTableBody');
    if (!tableBody) return;

    if (cachedWikiPages.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; padding:2rem; color:#64748b;">
                    등록된 위키 문서가 없습니다. 우측 상단의 <strong>[✍️ 새 문서 작성 ↗]</strong>을 눌러 문서를 작성해 보세요!
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = cachedWikiPages.map(page => `
        <tr>
            <td>
                <span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:9999px; background:#f1f5f9; color:#475569;">
                    ${escapeHtml(page.category || '생활')}
                </span>
            </td>
            <td>
                <div style="font-weight:700; color:#1e293b; font-size:0.92rem;">
                    ${escapeHtml(page.title)}
                </div>
            </td>
            <td style="font-size:0.8rem; font-family:monospace; color:#2563eb;">
                /wiki/${escapeHtml(page.slug)}
            </td>
            <td style="font-size:0.8rem; color:#64748b;">
                ${escapeHtml(page.updated_at || '-')}
            </td>
            <td style="text-align:center;">
                <div style="display:flex; gap:4px; justify-content:center;">
                    <a href="/wiki/${encodeURIComponent(page.slug)}" target="_blank" rel="noopener" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:2px 8px; font-size:0.75rem; text-decoration:none;">
                        열기 ↗
                    </a>
                    <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="deleteWikiPage('${escapeHtml(page.slug)}', '${escapeHtml(page.title)}')">
                        삭제
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteWikiPage(slug, title) {
    if (!confirm(`[${title}] 위키 문서를 정말로 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) return;
    try {
        const res = await fetch(`/wiki/delete/${encodeURIComponent(slug)}`, { method: 'POST' });
        showToast('🗑️ 위키 문서가 삭제되었습니다.');
        await loadWikiAdminPages();
    } catch (e) {
        alert('삭제 중 서버 오류가 발생했습니다.');
    }
}

// 전역 window 바인딩
window.loadWikiAdminOverview = loadWikiAdminOverview;
window.loadWikiAdminRoutines = loadWikiAdminRoutines;
window.renderWikiRoutinesTable = renderWikiRoutinesTable;
window.toggleWikiTodo = toggleWikiTodo;
window.deleteWikiTodo = deleteWikiTodo;
window.toggleRoutineDaysInputs = toggleRoutineDaysInputs;
window.submitAddWikiRoutine = submitAddWikiRoutine;
window.loadWikiAdminDdays = loadWikiAdminDdays;
window.renderWikiDdaysTable = renderWikiDdaysTable;
window.completeWikiDday = completeWikiDday;
window.deleteWikiDday = deleteWikiDday;
window.submitAddWikiDday = submitAddWikiDday;
window.loadWikiAdminConfigs = loadWikiAdminConfigs;
window.removeWifiQrImage = removeWifiQrImage;
window.submitSaveWikiWifi = submitSaveWikiWifi;
window.submitSaveWikiMedical = submitSaveWikiMedical;
window.loadWikiAdminPages = loadWikiAdminPages;
window.deleteWikiPage = deleteWikiPage;
