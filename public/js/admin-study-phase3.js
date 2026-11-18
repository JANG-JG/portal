/**
 * ==============================================================================
 * 관리자 학습실 Phase 3(오늘의 3종 미션 · 신규 영역 · 오답 섞기) 관제 모듈
 * (admin-study-phase3.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    function esc(str) {
        if (typeof escStudyAdmin === 'function') return escStudyAdmin(str);
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(msg, isError = false) {
        if (typeof studyToast === 'function') return studyToast(msg, isError);
        if (typeof showToast === 'function') return showToast(msg, isError ? 'error' : 'success');
    }

    function renderPhase3Overview(data) {
        const cfg = data.config || {};
        const elMissions = document.getElementById('chkAdminDailyMissions');
        const elSubjects = document.getElementById('chkAdminPhase3Subjects');
        const elWrongMix = document.getElementById('chkAdminWrongReviewMix');
        if (elMissions) elMissions.checked = cfg.dailyMissionsEnabled !== false;
        if (elSubjects) elSubjects.checked = cfg.phase3SubjectsEnabled !== false;
        if (elWrongMix) elWrongMix.checked = cfg.wrongReviewMixEnabled !== false;

        const grid = document.getElementById('adminPhase3ChildrenGrid');
        if (grid) {
            const children = data.perChild || [];
            grid.innerHTML = children.map((c) => {
                const slotsHtml = (c.missions || []).map((m) => `
                    <span style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; font-size:0.75rem; font-weight:700; background:${m.status === 'completed' ? '#dcfce7' : '#f1f5f9'}; color:${m.status === 'completed' ? '#166534' : '#475569'};">
                        ${m.status === 'completed' ? '✅' : '⏳'} ${esc(m.title)}
                    </span>
                `).join(' ');
                return `
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.75rem; padding:0.75rem; min-width:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                            <strong>${esc(c.avatarEmoji)} ${esc(c.displayName)}</strong>
                            <span style="font-size:0.78rem; font-weight:800; color:${c.bonusClaimed ? '#059669' : '#d97706'};">
                                오늘 ${Number(c.completedCount || 0)}/${Number(c.totalCount || 3)} 완료 ${c.bonusClaimed ? '· 🚀 보너스 지급!' : ''}
                            </span>
                        </div>
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">${slotsHtml}</div>
                    </div>
                `;
            }).join('') || '<p style="margin:0; font-size:0.82rem; color:#64748b;">등록된 아이 프로필이 없습니다.</p>';
        }
    }

    async function loadAdminStudyPhase3() {
        const grid = document.getElementById('adminPhase3ChildrenGrid');
        if (!grid) return;
        try {
            const res = await fetch('/api/admin/study/phase3', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '조회 실패');
            renderPhase3Overview(data);
        } catch (_) {
            grid.innerHTML = '<p style="margin:0; font-size:0.82rem; color:#dc2626;">오늘의 미션 현황을 불러오지 못했습니다.</p>';
        }
    }

    async function saveAdminPhase3Config() {
        const body = {
            dailyMissionsEnabled: Boolean(document.getElementById('chkAdminDailyMissions')?.checked),
            phase3SubjectsEnabled: Boolean(document.getElementById('chkAdminPhase3Subjects')?.checked),
            wrongReviewMixEnabled: Boolean(document.getElementById('chkAdminWrongReviewMix')?.checked)
        };
        try {
            const res = await fetch('/api/admin/study/phase3/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '저장 실패');
            renderPhase3Overview(data);
            toast(data.message || '설정이 저장되었습니다.');
        } catch (err) {
            toast(err.message || '설정 저장에 실패했습니다.', true);
        }
    }

    window.loadAdminStudyPhase3 = loadAdminStudyPhase3;
    window.saveAdminPhase3Config = saveAdminPhase3Config;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (document.getElementById('adminPhase3ChildrenGrid')) loadAdminStudyPhase3();
        }, 450);
    });
})();
