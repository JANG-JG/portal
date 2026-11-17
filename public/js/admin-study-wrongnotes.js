/**
 * ==============================================================================
 * 관리자 학습실 아이별 오답 노트 · 복습 모니터링 모듈 (admin-study-wrongnotes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    const SUBJ_NAMES = { korean: '한글', math: '수학', english: '영어' };

    function esc(str) {
        if (typeof escStudyAdmin === 'function') return escStudyAdmin(str);
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function toast(msg, isError = false) {
        if (typeof studyToast === 'function') return studyToast(msg, isError);
        if (typeof showToast === 'function') return showToast(msg, isError ? 'error' : 'success');
    }

    async function loadAdminStudyWrongNotes() {
        const sumGrid = document.getElementById('studyWrongNotesSummaryGrid');
        const tbody = document.getElementById('adminStudyWrongNotesBody');
        if (!tbody) return;

        try {
            const res = await fetch('/api/admin/study/wrong-notes?limit=30', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '조회 실패');

            if (sumGrid) {
                const summary = data.summaryByChild || [];
                sumGrid.innerHTML = summary.map((c) => `
                    <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:0.65rem; padding:0.45rem 0.75rem; font-size:0.8rem; font-weight:700; color:#9a3412;">
                        ${esc(c.avatarEmoji)} <strong>${esc(c.displayName)}</strong>:
                        복습 대기 <span style="color:#dc2626;">${Number(c.pendingCount || 0)}</span>개 ·
                        완료 <span style="color:#059669;">${Number(c.resolvedCount || 0)}</span>개
                    </div>
                `).join('') || '<span style="font-size:0.82rem; color:#64748b;">등록된 아이 프로필이 없습니다.</span>';
            }

            const recent = data.recent || [];
            if (!recent.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1rem; color:#64748b;">아직 저장된 오답 복습 기록이 없습니다.</td></tr>';
                return;
            }

            tbody.innerHTML = recent.map((n) => {
                const statusHtml = n.status === 'resolved'
                    ? '<span style="color:#059669; font-weight:800;">✅ 복습 완료</span>'
                    : '<span style="color:#dc2626; font-weight:800;">📝 복습 대기</span>';
                const childTxt = `${esc(n.child_emoji || '🧒')} ${esc(n.child_name || n.child_id)}`;
                const subjTxt = `${esc(SUBJ_NAMES[n.subject] || n.subject)} Lv.${esc(n.level)}`;
                const promptShort = String(n.prompt_text || '').slice(0, 48);
                return `
                    <tr>
                        <td>${childTxt}</td>
                        <td>${subjTxt}</td>
                        <td title="${esc(n.prompt_text || '')}">${esc(promptShort)}${String(n.prompt_text || '').length > 48 ? '…' : ''}</td>
                        <td>${Number(n.wrong_count || 1)}회</td>
                        <td>${statusHtml}</td>
                        <td style="font-size:0.76rem; color:#64748b;">${esc(String(n.last_wrong_at || '').slice(0, 16))}</td>
                        <td><button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="color:#dc2626;" onclick="deleteAdminStudyWrongNote(${Number(n.id)})">삭제</button></td>
                    </tr>
                `;
            }).join('');
        } catch (_) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1rem; color:#dc2626;">오답 현황을 불러오지 못했습니다.</td></tr>';
        }
    }

    async function deleteAdminStudyWrongNote(id) {
        try {
            const res = await fetch(`/api/admin/study/wrong-notes/${Number(id)}`, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '삭제 실패');
            toast(data.message || '오답 기록을 삭제했습니다.');
            await loadAdminStudyWrongNotes();
        } catch (err) {
            toast(err.message || '오답 기록 삭제에 실패했습니다.', true);
        }
    }

    if (typeof window.loadAdminStudyOverview === 'function') {
        const origLoad = window.loadAdminStudyOverview;
        window.loadAdminStudyOverview = async function () {
            const result = await origLoad.apply(this, arguments);
            await loadAdminStudyWrongNotes();
            return result;
        };
    }

    window.loadAdminStudyWrongNotes = loadAdminStudyWrongNotes;
    window.deleteAdminStudyWrongNote = deleteAdminStudyWrongNote;
})();
