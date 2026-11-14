/**
 * ==============================================================================
 * 아이 학습실 · 암호화 텔레그램 · 아이 계정 관리 모듈 (admin-study.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 & XSS 방어
 * [규칙 8] API 키/텔레그램 ID 평문 미노출 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

function escStudyAdmin(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(str ?? ''));
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function studyToast(msg, isError = false) {
    if (typeof showToast === 'function') {
        showToast(msg, isError ? 'error' : 'success');
    } else {
        alert(msg);
    }
}

const STUDY_SUBJECT_NAMES = { korean: '한글', math: '수학', english: '영어' };
const STUDY_SOURCE_NAMES = {
    gemini: 'Gemini AI',
    fallback_bank: '안전 문제은행',
    retry_fallback: '안전 문제은행'
};

async function loadAdminStudyOverview() {
    try {
        const res = await fetch('/api/admin/study/overview', { credentials: 'same-origin' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '조회 실패');

        renderStudyStatusCards(data);
        renderStudyConfigForm(data.config || {});
        renderStudyChildrenCards(data.children || []);
        renderStudyRecentSheets(data.recentSheets || []);
        renderStudyTelegramUsers(data.telegramUsers || []);
        renderStudyTelegramLogs(data.telegramLogs || []);
        renderStudyKidAccounts(data.kidAccounts || []);
    } catch (err) {
        studyToast(err.message || '학습실 현황을 불러오지 못했습니다.', true);
    }
}

function renderStudyStatusCards(data) {
    const quota = data.quota || { usedCount: 0, dailyLimit: 30 };
    const cfg = data.config || {};

    const quotaEl = document.getElementById('studyAdminQuotaStat');
    if (quotaEl) quotaEl.textContent = `${quota.usedCount} / ${quota.dailyLimit}장`;

    const geminiEl = document.getElementById('studyAdminGeminiStat');
    if (geminiEl) {
        geminiEl.textContent = cfg.hasGeminiKey ? '✅ 연결됨' : '⚠️ 키 미설정(폴백)';
        geminiEl.style.color = cfg.hasGeminiKey ? '#059669' : '#d97706';
    }

    const tgEl = document.getElementById('studyAdminTelegramStat');
    if (tgEl) {
        tgEl.textContent = cfg.hasTelegramToken ? '✅ 봇 활성화 가능' : '⚠️ 토큰 미설정';
        tgEl.style.color = cfg.hasTelegramToken ? '#059669' : '#d97706';
    }

    const pinEl = document.getElementById('studyAdminParentPinStat');
    if (pinEl) {
        pinEl.textContent = cfg.hasParentPin ? '🔒 PIN 잠금 사용 중' : '👆 길게 누르기 모드';
        pinEl.style.color = '#2563eb';
    }
}

function renderStudyConfigForm(cfg) {
    const limitInput = document.getElementById('studyDailyLimitInput');
    const modelInput = document.getElementById('studyGeminiModelInput');
    const pinInput = document.getElementById('studyParentPinInput');
    const clearChk = document.getElementById('studyClearParentPinChk');
    if (limitInput) limitInput.value = cfg.dailyLimit || 30;
    if (modelInput) modelInput.value = cfg.geminiModel || 'gemini-2.5-flash';
    if (pinInput) pinInput.value = '';
    if (clearChk) clearChk.checked = false;
}

function renderStudyChildrenCards(children) {
    const grid = document.getElementById('adminStudyChildrenGrid');
    if (!grid) return;
    if (!children.length) {
        grid.innerHTML = '<div style="color:#64748b;">등록된 아이 프로필이 없습니다.</div>';
        return;
    }

    grid.innerHTML = children.map((c) => {
        const levels = c.levels || {};
        const badges = ['korean', 'math', 'english'].map((subj) => {
            const lv = levels[subj]?.level || 1;
            return `<span style="display:inline-block; background:#eff6ff; color:#1d4ed8; padding:0.2rem 0.5rem; border-radius:999px; font-size:0.75rem; font-weight:700;">${STUDY_SUBJECT_NAMES[subj]} Lv.${lv}</span>`;
        }).join(' ');
        const stamps = c.stampBoard?.stampsCount ?? 0;

        return `
        <form onsubmit="saveAdminStudyProfile(event, '${escStudyAdmin(c.id)}')" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.8rem; padding:0.9rem; box-sizing:border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.55rem;">
                <strong style="font-size:0.98rem; color:#0f172a;">${escStudyAdmin(c.avatarEmoji || '🌟')} ${escStudyAdmin(c.displayName)} (${escStudyAdmin(c.birthYear)}년생)</strong>
                <span style="font-size:0.78rem; font-weight:700; color:#b45309; background:#fef3c7; padding:0.2rem 0.55rem; border-radius:999px;">도장 ${stamps}/10</span>
            </div>
            <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-bottom:0.65rem;">${badges}</div>
            <div style="display:grid; grid-template-columns:72px 1fr; gap:0.5rem; margin-bottom:0.5rem;">
                <input name="avatarEmoji" type="text" maxlength="8" value="${escStudyAdmin(c.avatarEmoji || '🌟')}" aria-label="이모지" style="width:100%; box-sizing:border-box; padding:0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; text-align:center;">
                <input name="displayName" type="text" maxlength="20" value="${escStudyAdmin(c.displayName)}" aria-label="표시 이름" placeholder="표시 이름" style="width:100%; box-sizing:border-box; padding:0.45rem 0.6rem; border:1px solid #cbd5e1; border-radius:0.45rem;">
            </div>
            <input name="targetReward" type="text" maxlength="60" value="${escStudyAdmin(c.targetReward || '')}" aria-label="목표 보상" placeholder="10칸 도장 달성 목표 보상" style="width:100%; box-sizing:border-box; padding:0.45rem 0.6rem; border:1px solid #cbd5e1; border-radius:0.45rem; margin-bottom:0.55rem;">
            <button type="submit" class="btn-admin btn-admin-outline" style="width:100%; min-height:38px;">프로필 저장</button>
        </form>`;
    }).join('');
}

function renderStudyRecentSheets(sheets) {
    const tbody = document.getElementById('adminStudyRecentSheetsBody');
    if (!tbody) return;
    if (!sheets.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.2rem; color:#64748b;">생성된 학습지가 아직 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = sheets.map((s) => `
        <tr>
            <td>#${escStudyAdmin(s.id)}</td>
            <td>${s.child_id === 'first' ? '🦖 첫째' : '🐰 둘째'}</td>
            <td>${escStudyAdmin(STUDY_SUBJECT_NAMES[s.subject] || s.subject)} Lv.${escStudyAdmin(s.level)}</td>
            <td>${escStudyAdmin(s.theme)}</td>
            <td>${escStudyAdmin(STUDY_SOURCE_NAMES[s.source] || s.source)}</td>
            <td>${s.completed_at ? '✅ 완료' : '📝 진행 중'}</td>
            <td style="font-size:0.78rem; color:#64748b;">${escStudyAdmin(s.created_at || '')}</td>
            <td><a href="/study/sheet/${escStudyAdmin(s.id)}" target="_blank" rel="noopener" class="btn-admin btn-admin-outline btn-admin-sm">열기</a></td>
        </tr>
    `).join('');
}

function renderStudyTelegramUsers(users) {
    const tbody = document.getElementById('adminStudyTelegramUsersBody');
    if (!tbody) return;
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.2rem; color:#64748b;">DB에 암호화 등록된 텔레그램 ID가 없습니다. 위 폼에서 추가해 주세요.</td></tr>';
        return;
    }

    tbody.innerHTML = users.map((u) => `
        <tr>
            <td><strong>${escStudyAdmin(u.label)}</strong></td>
            <td><code>${escStudyAdmin(u.maskedId)}</code></td>
            <td>${escStudyAdmin(u.portalUsername || '-')}</td>
            <td>${escStudyAdmin(u.role || 'parent')}</td>
            <td>${u.enabled ? '🟢 허용' : '⏸️ 중지'}</td>
            <td style="font-size:0.78rem; color:#64748b;">${escStudyAdmin(u.lastUsedAt || '-')}</td>
            <td style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="toggleAdminTelegramUser(${Number(u.id)}, ${u.enabled ? 'false' : 'true'})">
                    ${u.enabled ? '일시 중지' : '다시 허용'}
                </button>
                <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="color:#dc2626;" onclick="deleteAdminTelegramUser(${Number(u.id)})">삭제</button>
            </td>
        </tr>
    `).join('');
}

function renderStudyTelegramLogs(logs) {
    const tbody = document.getElementById('adminStudyTelegramLogsBody');
    if (!tbody) return;
    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.2rem; color:#64748b;">실행된 텔레그램 명령 기록이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map((l) => `
        <tr>
            <td style="font-size:0.78rem; color:#64748b;">${escStudyAdmin(l.created_at || '')}</td>
            <td><strong>${escStudyAdmin(l.command)}</strong></td>
            <td>${escStudyAdmin(l.user_label || '미등록')}</td>
            <td>${escStudyAdmin(l.summary || '')}</td>
            <td>${l.status === 'blocked' ? '🚫 차단' : (l.status === 'error' ? '❌ 오류' : '✅ 성공')}</td>
        </tr>
    `).join('');
}

function renderStudyKidAccounts(accounts) {
    const tbody = document.getElementById('adminStudyKidAccountsBody');
    if (!tbody) return;
    if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.2rem; color:#64748b;">발급된 아이 전용 계정이 없습니다. 위 버튼으로 1분 만에 만들 수 있어요.</td></tr>';
        return;
    }

    tbody.innerHTML = accounts.map((a) => `
        <tr>
            <td>${escStudyAdmin(a.emoji || '🎒')} <strong>${escStudyAdmin(a.nickname || a.username)}</strong></td>
            <td><code>${escStudyAdmin(a.username)}</code></td>
            <td>${a.pinResetRequired ? '초기 PIN 변경 대기' : '✅ PIN 설정 완료'}</td>
            <td style="font-size:0.78rem; color:#64748b;">${escStudyAdmin(a.lastLoginAt || '접속 이력 없음')}</td>
            <td>
                ${a.inviteUrl
                    ? `<button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="copyStudyInviteUrl('${escStudyAdmin(a.inviteUrl)}')">🔗 초대 링크 복사</button>`
                    : '<span style="color:#64748b; font-size:0.78rem;">기기 등록 완료</span>'}
            </td>
        </tr>
    `).join('');
}

async function saveAdminStudyConfig(event) {
    event.preventDefault();
    const dailyLimit = Number(document.getElementById('studyDailyLimitInput')?.value || 30);
    const geminiModel = String(document.getElementById('studyGeminiModelInput')?.value || '').trim();
    const parentPin = String(document.getElementById('studyParentPinInput')?.value || '').trim();
    const clearParentPin = Boolean(document.getElementById('studyClearParentPinChk')?.checked);

    try {
        const res = await fetch('/api/admin/study/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ dailyLimit, geminiModel, parentPin, clearParentPin })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '저장 실패');
        studyToast(data.message || '설정이 저장되었습니다.');
        await loadAdminStudyOverview();
    } catch (err) {
        studyToast(err.message || '설정 저장에 실패했습니다.', true);
    }
}

async function saveAdminStudyProfile(event, childId) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
        avatarEmoji: form.avatarEmoji?.value || '',
        displayName: form.displayName?.value || '',
        targetReward: form.targetReward?.value || ''
    };
    try {
        const res = await fetch(`/api/admin/study/profile/${encodeURIComponent(childId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '프로필 저장 실패');
        studyToast(data.message || '프로필이 저장되었습니다.');
        await loadAdminStudyOverview();
    } catch (err) {
        studyToast(err.message || '프로필 저장 중 오류가 발생했습니다.', true);
    }
}

async function addAdminTelegramUser(event) {
    event.preventDefault();
    const telegramId = String(document.getElementById('tgUserIdInput')?.value || '').trim();
    const label = String(document.getElementById('tgUserLabelInput')?.value || '').trim();
    const portalUsername = String(document.getElementById('tgPortalUsernameInput')?.value || '').trim();

    try {
        const res = await fetch('/api/admin/study/telegram/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ telegramId, label, portalUsername, role: 'parent' })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '등록 실패');
        studyToast(data.message || '텔레그램 ID가 암호화 등록되었습니다.');
        document.getElementById('studyTelegramAddForm')?.reset();
        await loadAdminStudyOverview();
    } catch (err) {
        studyToast(err.message || '텔레그램 사용자 등록 실패', true);
    }
}

async function toggleAdminTelegramUser(id, enabled) {
    try {
        const res = await fetch(`/api/admin/study/telegram/users/${encodeURIComponent(id)}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '상태 변경 실패');
        studyToast(data.message || '상태가 변경되었습니다.');
        await loadAdminStudyOverview();
    } catch (err) {
        studyToast(err.message || '상태 변경 실패', true);
    }
}

async function deleteAdminTelegramUser(id) {
    if (!confirm('이 텔레그램 허용 사용자를 목록에서 삭제할까요?')) return;
    try {
        const res = await fetch(`/api/admin/study/telegram/users/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '삭제 실패');
        studyToast(data.message || '삭제되었습니다.');
        await loadAdminStudyOverview();
    } catch (err) {
        studyToast(err.message || '삭제 실패', true);
    }
}

async function createAdminKidAccount(event) {
    event.preventDefault();
    const username = String(document.getElementById('kidUsernameInput')?.value || '').trim();
    const nickname = String(document.getElementById('kidNicknameInput')?.value || '').trim();
    const initialPin = String(document.getElementById('kidPinInput')?.value || '').trim();
    const emoji = String(document.getElementById('kidEmojiInput')?.value || '🎒').trim();

    try {
        const res = await fetch('/api/admin/study/kid-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ username, nickname, initialPin, emoji })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '계정 발급 실패');

        const resultBox = document.getElementById('adminStudyInviteResult');
        if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.innerHTML = `
                <div style="font-weight:700; margin-bottom:0.35rem;">🎉 ${escStudyAdmin(data.message)}</div>
                <div style="word-break:break-all; margin-bottom:0.5rem;">태블릿 초대 링크: <code>${escStudyAdmin(data.inviteUrl)}</code></div>
                <button type="button" class="btn-admin btn-admin-primary btn-admin-sm" onclick="copyStudyInviteUrl('${escStudyAdmin(data.inviteUrl)}')">📋 초대 링크 복사</button>
            `;
        }
        studyToast('아이 전용 태블릿 계정이 발급되었습니다!');
        const pinInput = document.getElementById('kidPinInput');
        if (pinInput) pinInput.value = '';
        await loadAdminStudyOverview();
    } catch (err) {
        studyToast(err.message || '계정 발급에 실패했습니다.', true);
    }
}

async function copyStudyInviteUrl(url) {
    try {
        await navigator.clipboard.writeText(url);
        studyToast('태블릿 초대 링크가 클립보드에 복사되었습니다.');
    } catch (e) {
        prompt('아래 초대 링크를 복사해서 태블릿으로 열어 주세요:', url);
    }
}

window.loadAdminStudyOverview = loadAdminStudyOverview;
window.saveAdminStudyConfig = saveAdminStudyConfig;
window.saveAdminStudyProfile = saveAdminStudyProfile;
window.addAdminTelegramUser = addAdminTelegramUser;
window.toggleAdminTelegramUser = toggleAdminTelegramUser;
window.deleteAdminTelegramUser = deleteAdminTelegramUser;
window.createAdminKidAccount = createAdminKidAccount;
window.copyStudyInviteUrl = copyStudyInviteUrl;
