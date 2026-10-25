/**
 * ==============================================================================
 * 관리자 페이지 가족 구성원 및 권한(RBAC) 관리 전용 스크립트 (admin-family.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 친근하고 일상 친화적인 한국어 인터페이스 준수
 * [규칙 3] 파일당 500줄 이하 모듈화 준수 (약 200줄)
 * [규칙 6] 가로 360px 모바일 화면 반응형 및 터치 최적화
 * ==============================================================================
 */

let cachedFamilyMembers = [];

document.addEventListener('DOMContentLoaded', () => {
    // 보안 탭 활성화 시 또는 초기 로드 시 가족 목록 로드
    loadFamilyMembers();
});

/**
 * 1. 가족 구성원 목록 로드 및 렌더링
 */
async function loadFamilyMembers() {
    const tableBody = document.getElementById('familyMembersTableBody');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/admin/family/members');
        const data = await res.json();

        if (data.success && Array.isArray(data.members)) {
            cachedFamilyMembers = data.members;
            renderFamilyMembersTable(data.members);
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">${data.message || '가족 목록을 불러오지 못했습니다.'}</td></tr>`;
        }
    } catch (err) {
        console.error('가족 목록 조회 실패:', err);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#ef4444;">서버와 통신할 수 없습니다.</td></tr>`;
    }
}

function renderFamilyMembersTable(members) {
    const tableBody = document.getElementById('familyMembersTableBody');
    if (!tableBody) return;

    if (members.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; padding:2rem; color:#64748b;">
                    아직 등록된 가족 구성원이 없습니다.<br>
                    우측 상단의 <strong>[+ 새 가족 추가]</strong> 버튼을 눌러 부모님과 가족을 등록해 보세요!
                </td>
            </tr>
        `;
        return;
    }

    const serviceLabels = {
        'all': '전체 서비스 (관리자)',
        'album': '📸 가족 앨범',
        'news': '📰 뉴스·날씨·증시',
        'blood': '🩸 혈압 관리',
        'asset': '💰 자산 관리'
    };

    tableBody.innerHTML = members.map(m => {
        const isAdmin = m.role === 'admin';
        const isSelf = isAdmin && (m.id === 1 || m.username === 'admin');

        // 허용 서비스 배지 생성
        const serviceBadges = (m.allowedServices || []).map(s => {
            const label = serviceLabels[s] || s;
            const bg = (s === 'all' || s === 'asset') ? '#f3e8ff; color:#7c3aed;' : (s === 'album' ? '#fdf2f8; color:#db2777;' : '#f0fdf4; color:#16a34a;');
            return `<span style="display:inline-block; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:9999px; background:${bg}; margin:2px;">${label}</span>`;
        }).join(' ');

        // PIN 상태 표시
        let pinStatusHtml = '';
        if (isAdmin) {
            pinStatusHtml = '<span style="color:#059669; font-weight:700; font-size:0.8rem;">마스터 비밀번호</span>';
        } else if (m.isLocked) {
            pinStatusHtml = `
                <div style="display:inline-flex; align-items:center; gap:4px;">
                    <span style="color:#dc2626; font-weight:800; font-size:0.8rem;">🔒 5회 오류 잠금</span>
                    <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" style="padding:1px 6px; font-size:0.7rem;" onclick="unlockFamilyMember('${m.username}')">해제</button>
                </div>
            `;
        } else if (m.pinResetRequired) {
            pinStatusHtml = '<span style="color:#d97706; font-weight:700; font-size:0.8rem;">초기 PIN 변경 대기</span>';
        } else {
            pinStatusHtml = '<span style="color:#059669; font-weight:700; font-size:0.8rem;">정상 (본인 PIN)</span>';
        }

        // 액션 버튼
        const inviteBtn = (!isAdmin && m.inviteUrl) ? `
            <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" title="카카오톡 초대 링크 복사" onclick="copyFamilyInviteUrl('${m.inviteUrl}', '${escapeHtml(m.nickname)}')">
                🔗 초대 링크
            </button>
        ` : '';

        const resetPinBtn = !isAdmin ? `
            <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" title="임시 PIN 재설정" onclick="openResetPinModal('${m.username}', '${escapeHtml(m.nickname)}')">
                🔑 PIN 재설정
            </button>
        ` : '';

        const editBtn = `
            <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="openEditFamilyModal('${m.username}')">
                ✏️ 수정
            </button>
        `;

        const deleteBtn = !isSelf ? `
            <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" onclick="deleteFamilyMember('${m.username}', '${escapeHtml(m.nickname)}')">
                🗑️ 삭제
            </button>
        ` : '';

        const roleBadge = isAdmin 
            ? '<span class="badge" style="background:#2563eb; color:#fff; font-size:0.72rem;">관리자</span>' 
            : '<span class="badge" style="background:#e0e7ff; color:#3730a3; font-size:0.72rem;">가족</span>';

        return `
            <tr>
                <td style="font-weight:700; font-size:0.92rem; color:#0f172a;">
                    ${escapeHtml(m.nickname)} ${roleBadge}
                </td>
                <td style="font-family:monospace; color:#475569; font-size:0.85rem;">
                    ${escapeHtml(m.username)}
                </td>
                <td>
                    <div style="display:flex; flex-wrap:wrap; gap:2px;">
                        ${serviceBadges}
                    </div>
                </td>
                <td>
                    ${pinStatusHtml}
                </td>
                <td style="font-size:0.78rem; color:#64748b;">
                    ${m.lastLoginAt ? m.lastLoginAt.split(' ')[0] : '접속 이력 없음'}
                </td>
                <td>
                    <div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">
                        ${inviteBtn}
                        ${resetPinBtn}
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * 2. 카톡 1초 자동 입장 링크 복사
 */
function copyFamilyInviteUrl(url, nickname) {
    if (!url) return;
    const shareText = `[JG 가족 포털 & 사진첩]\n${nickname}님 전용 초대 링크입니다. 아래 링크를 터치하시면 비밀번호 입력 없이 즉시 입장하실 수 있습니다:\n${url}`;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText)
            .then(() => showToast(`🌷 [${nickname}]님의 카톡 초대 링크가 복사되었습니다! 카톡에 붙여넣기 하세요.`))
            .catch(() => copyViaFallback(shareText, nickname));
    } else {
        copyViaFallback(shareText, nickname);
    }
}

function copyViaFallback(text, nickname) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(`🌷 [${nickname}]님의 카톡 초대 링크가 복사되었습니다!`);
    } catch (e) {
        prompt('아래 링크를 복사하여 카카오톡으로 보내주세요:', text);
    }
}

/**
 * 3. 가족 추가 모달
 */
function openAddFamilyModal() {
    const modal = document.getElementById('addFamilyModal');
    const form = document.getElementById('addFamilyForm');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('inputAddInitialPin').value = '123456';
    modal.style.display = 'flex';
    modal.classList.add('active');
}

function closeAddFamilyModal() {
    const modal = document.getElementById('addFamilyModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

async function submitAddFamily(e) {
    e.preventDefault();
    const nickname = document.getElementById('inputAddNickname').value.trim();
    const username = document.getElementById('inputAddUsername').value.trim();
    const initialPin = document.getElementById('inputAddInitialPin').value.trim();
    const phone = document.getElementById('inputAddPhone').value.trim();

    const allowedServices = [];
    if (document.getElementById('chkAddServiceAlbum').checked) allowedServices.push('album');
    if (document.getElementById('chkAddServiceNews').checked) allowedServices.push('news');
    if (document.getElementById('chkAddServiceAsset').checked) allowedServices.push('asset');
    if (document.getElementById('chkAddServiceBlood').checked) allowedServices.push('blood');

    if (!nickname) {
        alert('가족 호칭을 입력해 주세요.');
        return;
    }
    if (!/^\d{6}$/.test(initialPin)) {
        alert('초기 PIN은 숫자 6자리로 입력해 주세요.');
        return;
    }

    try {
        const res = await fetch('/api/admin/family/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname, username, initialPin, phone, allowedServices })
        });
        const data = await res.json();

        if (data.success) {
            closeAddFamilyModal();
            showToast(data.message || '가족 구성원이 등록되었습니다.');
            await loadFamilyMembers();
        } else {
            alert(data.message || '가족 등록에 실패했습니다.');
        }
    } catch (err) {
        alert('가족 등록 중 서버 오류가 발생했습니다.');
    }
}

/**
 * 4. 가족 정보 수정 모달
 */
function openEditFamilyModal(username) {
    const member = cachedFamilyMembers.find(m => m.username === username);
    if (!member) return;

    document.getElementById('editFamilyTargetUsername').value = member.username;
    document.getElementById('inputEditNickname').value = member.nickname;

    const services = member.allowedServices || ['album', 'news'];
    const isAll = services.includes('all');
    document.getElementById('chkEditServiceAlbum').checked = isAll || services.includes('album');
    document.getElementById('chkEditServiceNews').checked = isAll || services.includes('news');
    document.getElementById('chkEditServiceAsset').checked = isAll || services.includes('asset');
    document.getElementById('chkEditServiceBlood').checked = isAll || services.includes('blood');

    const modal = document.getElementById('editFamilyModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
}

function closeEditFamilyModal() {
    const modal = document.getElementById('editFamilyModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

async function submitEditFamily(e) {
    e.preventDefault();
    const username = document.getElementById('editFamilyTargetUsername').value;
    const nickname = document.getElementById('inputEditNickname').value.trim();

    const allowedServices = [];
    if (document.getElementById('chkEditServiceAlbum').checked) allowedServices.push('album');
    if (document.getElementById('chkEditServiceNews').checked) allowedServices.push('news');
    if (document.getElementById('chkEditServiceAsset').checked) allowedServices.push('asset');
    if (document.getElementById('chkEditServiceBlood').checked) allowedServices.push('blood');

    try {
        const res = await fetch(`/api/admin/family/members/${username}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname, allowedServices })
        });
        const data = await res.json();
        if (data.success) {
            closeEditFamilyModal();
            showToast('가족 정보가 성공적으로 수정되었습니다.');
            await loadFamilyMembers();
        } else {
            alert(data.message || '수정에 실패했습니다.');
        }
    } catch (err) {
        alert('가족 정보 수정 중 오류가 발생했습니다.');
    }
}

/**
 * 5. 임시 PIN 재설정 모달
 */
function openResetPinModal(username, nickname) {
    document.getElementById('resetPinTargetUsername').value = username;
    document.getElementById('resetPinTargetNameDisplay').textContent = nickname;
    document.getElementById('inputResetNewPin').value = '123456';

    const modal = document.getElementById('resetPinModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
}

function closeResetPinModal() {
    const modal = document.getElementById('resetPinModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

async function submitResetPin(e) {
    e.preventDefault();
    const username = document.getElementById('resetPinTargetUsername').value;
    const newPin = document.getElementById('inputResetNewPin').value.trim();

    if (!/^\d{6}$/.test(newPin)) {
        alert('새 임시 PIN은 숫자 6자리로 입력해 주세요.');
        return;
    }

    try {
        const res = await fetch(`/api/admin/family/members/${username}/reset-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPin })
        });
        const data = await res.json();
        if (data.success) {
            closeResetPinModal();
            showToast(data.message || 'PIN이 재설정되었습니다.');
            await loadFamilyMembers();
        } else {
            alert(data.message || 'PIN 재설정에 실패했습니다.');
        }
    } catch (err) {
        alert('PIN 재설정 중 오류가 발생했습니다.');
    }
}

/**
 * 6. 오류 잠금 해제
 */
async function unlockFamilyMember(username) {
    if (!confirm(`[${username}] 계정의 로그인 제한(잠금)을 즉시 해제할까요?`)) return;

    try {
        const res = await fetch(`/api/admin/family/members/${username}/unlock`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('잠금이 해제되었습니다.');
            await loadFamilyMembers();
        } else {
            alert(data.message || '잠금 해제 실패');
        }
    } catch (err) {
        alert('잠금 해제 처리 중 오류가 발생했습니다.');
    }
}

/**
 * 7. 가족 구성원 삭제
 */
async function deleteFamilyMember(username, nickname) {
    if (!confirm(`정말로 가족 '${nickname}' (${username}) 계정을 삭제하시겠습니까?\n삭제 후에는 해당 계정으로 로그인할 수 없습니다.`)) return;

    try {
        const res = await fetch(`/api/admin/family/members/${username}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('가족 계정이 삭제되었습니다.');
            await loadFamilyMembers();
        } else {
            alert(data.message || '삭제에 실패했습니다.');
        }
    } catch (err) {
        alert('삭제 처리 중 오류가 발생했습니다.');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.loadFamilyMembers = loadFamilyMembers;
window.copyFamilyInviteUrl = copyFamilyInviteUrl;
window.openAddFamilyModal = openAddFamilyModal;
window.closeAddFamilyModal = closeAddFamilyModal;
window.submitAddFamily = submitAddFamily;
window.openEditFamilyModal = openEditFamilyModal;
window.closeEditFamilyModal = closeEditFamilyModal;
window.submitEditFamily = submitEditFamily;
window.openResetPinModal = openResetPinModal;
window.closeResetPinModal = closeResetPinModal;
window.submitResetPin = submitResetPin;
window.unlockFamilyMember = unlockFamilyMember;
window.deleteFamilyMember = deleteFamilyMember;
