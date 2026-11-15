/**
 * ==============================================================================
 * 어린이 학습실 도장판 수정 & 종이 학습지 스티커 관리자 모듈 (admin-study-stamps.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    const stampCache = new Map();

    function esc(str) {
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

    function renderMiniSlots(childId, board) {
        const stamps = Array.isArray(board?.stamps) ? board.stamps : [];
        const items = [];
        for (let i = 0; i < 10; i++) {
            const st = stamps[i];
            if (st) {
                stampCache.set(String(st.id), st);
                const icon = st.source_type === 'paper' ? '📄' : '🌟';
                items.push(`
                    <button type="button" data-stamp-action="edit-slot" data-child-id="${esc(childId)}" data-stamp-id="${esc(st.id)}"
                        title="${esc(st.note || '')} (클릭해 수정·삭제)"
                        style="aspect-ratio:1/1; min-height:38px; border-radius:0.55rem; border:1.5px solid #f59e0b; background:#fef3c7; color:#92400e; font-size:0.95rem; font-weight:800; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:2px;">
                        <span>${icon}</span>
                        <span style="font-size:0.65rem; line-height:1;">${i + 1}</span>
                    </button>
                `);
            } else {
                items.push(`
                    <div style="aspect-ratio:1/1; min-height:38px; border-radius:0.55rem; border:1.5px dashed #cbd5e1; background:#ffffff; color:#94a3b8; font-size:0.75rem; font-weight:700; display:flex; align-items:center; justify-content:center;">
                        ${i + 1}
                    </div>
                `);
            }
        }
        return `<div style="display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:0.35rem; margin:0.6rem 0;">${items.join('')}</div>`;
    }

    function renderPokemonSummary(pokemon) {
        const bar = document.getElementById('adminPokemonStatusBar');
        if (!bar) return;
        if (!pokemon) {
            bar.innerHTML = '<span style="font-size:0.82rem; color:#64748b;">포켓몬 알 부화 정보를 불러오지 못했습니다.</span>';
            return;
        }
        const enabled = pokemon.enabled !== false;
        const nextVal = enabled ? 'false' : 'true';
        bar.innerHTML = `
            <div style="min-width:0; flex:1 1 220px;">
                <strong style="font-size:0.84rem; color:${enabled ? '#0369a1' : '#475569'};">
                    🥚 포켓몬 알 부화 · 도감 ${enabled ? '사용 중 (ON)' : '일시 중지 (OFF)'}
                </strong>
                <div style="font-size:0.75rem; color:#64748b; margin-top:0.15rem;">
                    도장 10칸 완성 시 알이 부화해 도감(총 ${esc(pokemon.totalCatalogCount || 40)}종)에 등록됩니다.
                </div>
            </div>
            <button type="button" class="btn-admin ${enabled ? 'btn-admin-outline' : 'btn-admin-primary'} btn-admin-sm"
                data-stamp-action="pokemon-toggle" data-next-enabled="${nextVal}" style="min-height:36px;">
                ${enabled ? '⏸️ 기능 끄기' : '▶️ 기능 켜기'}
            </button>
        `;
    }

    function renderBoards(children, pokemon) {
        const grid = document.getElementById('adminStampBoardsGrid');
        if (!grid) return;
        if (!Array.isArray(children) || !children.length) {
            grid.innerHTML = '<div style="color:#64748b;">등록된 아이 프로필이 없습니다.</div>';
            return;
        }
        const pokeMap = new Map((pokemon?.children || []).map((p) => [p.childId, p]));
        const totalDex = Number(pokemon?.totalCatalogCount || 40);

        grid.innerHTML = children.map((c) => {
            const b = c.stampBoard || { cycleNo: 1, earnedCount: 0, totalEarned: 0, stamps: [] };
            const pk = pokeMap.get(c.id);
            const pkHtml = pk
                ? `<div style="margin:0.45rem 0 0; padding:0.45rem 0.6rem; border-radius:0.5rem; background:#ffffff; border:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; gap:0.45rem; flex-wrap:wrap; font-size:0.76rem;">
                    <div style="min-width:0; color:#334155;">
                        <strong>${esc(pk.targetTypeEmoji || '🥚')} ${pk.hatched ? `부화 완료(${esc(pk.targetNameKo)})` : `부화 대기(${esc(pk.targetNameKo)} · ${esc(pk.steps)}/10)`}</strong>
                        <span style="color:#64748b; margin-left:0.35rem;">도감 ${esc(pk.collectedCount)}/${esc(totalDex)} · 단짝: ${esc(pk.partnerNameKo || '없음')}</span>
                    </div>
                    ${pk.hatched ? '' : `<button type="button" class="btn-admin btn-admin-outline btn-admin-sm" data-stamp-action="pokemon-reroll" data-child-id="${esc(c.id)}" style="font-size:0.72rem; padding:0.2rem 0.45rem;">🎲 알 다시 뽑기</button>`}
                </div>`
                : '';
            return `
            <div data-child-card="${esc(c.id)}" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.8rem; padding:0.9rem; box-sizing:border-box; min-width:0; max-width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                    <strong style="font-size:0.98rem; color:#0f172a;">${esc(c.avatarEmoji || '🌟')} ${esc(c.displayName || c.id)}</strong>
                    <span style="font-size:0.78rem; font-weight:800; color:#b45309; background:#fef3c7; padding:0.2rem 0.55rem; border-radius:999px;">
                        ${esc(b.earnedCount)} / 10칸 · ${esc(b.cycleNo)}판째 (누적 ${esc(b.totalEarned)}개)
                    </span>
                </div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:0.25rem;">🎁 목표: ${esc(c.targetReward || '칭찬 선물')}</div>
                ${pkHtml}
                ${renderMiniSlots(c.id, b)}
                <input type="text" data-note-for="${esc(c.id)}" maxlength="50" placeholder="종이학습지 메모 예: 구몬 한글 1권 (선택)"
                    style="width:100%; box-sizing:border-box; padding:0.45rem 0.6rem; border:1px solid #cbd5e1; border-radius:0.45rem; font-size:0.84rem; margin-bottom:0.45rem;">
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:0.4rem; margin-bottom:0.45rem;">
                    <button type="button" class="btn-admin btn-admin-primary btn-admin-sm" data-stamp-action="grant-paper" data-child-id="${esc(c.id)}" style="min-height:38px;">
                        📄 종이학습지 +1
                    </button>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" data-stamp-action="grant-online" data-child-id="${esc(c.id)}" style="min-height:38px;">
                        🌟 일반 도장 +1
                    </button>
                </div>
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.4rem;">
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" data-stamp-action="undo-last" data-child-id="${esc(c.id)}" ${b.earnedCount === 0 ? 'disabled' : ''} style="min-height:36px;">
                        ↩️ -1 빼기
                    </button>
                    <input type="number" min="0" max="10" value="${esc(b.earnedCount)}" data-count-for="${esc(c.id)}" aria-label="${esc(c.displayName)} 도장 칸 수"
                        style="width:58px; box-sizing:border-box; padding:0.35rem 0.45rem; border:1px solid #cbd5e1; border-radius:0.45rem; text-align:center; font-weight:700;">
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" data-stamp-action="set-count" data-child-id="${esc(c.id)}" style="min-height:36px;">
                        칸 맞추기
                    </button>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" data-stamp-action="reset-board" data-child-id="${esc(c.id)}" ${b.earnedCount === 0 ? 'disabled' : ''} style="color:#dc2626; min-height:36px;">
                        🔄 비우기
                    </button>
                </div>
            </div>`;
        }).join('');
    }

    function renderStampLogs(logs) {
        const tbody = document.getElementById('adminStudyStampLogsBody');
        if (!tbody) return;
        if (!Array.isArray(logs) || !logs.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1rem; color:#64748b;">적립된 도장 기록이 아직 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = logs.map((row) => {
            stampCache.set(String(row.id), row);
            const typeLabel = row.source_type === 'paper' ? '📄 종이학습지' : '🌟 일반·태블릿';
            const childLabel = `${row.child_emoji || '🧒'} ${row.child_name || row.child_id}`;
            return `
            <tr>
                <td>${esc(childLabel)}</td>
                <td>${esc(typeLabel)}</td>
                <td>${esc(row.cycle_no)}판째</td>
                <td style="max-width:220px; word-break:break-word;">${esc(row.note || '-')}</td>
                <td style="font-size:0.78rem; color:#64748b;">${esc(row.earned_at || '')}</td>
                <td>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="color:#dc2626;"
                        data-stamp-action="delete-log" data-child-id="${esc(row.child_id)}" data-stamp-id="${esc(row.id)}">삭제</button>
                </td>
            </tr>`;
        }).join('');
    }

    async function loadAdminStudyStampsPanel() {
        const panel = document.getElementById('studyStampManagerPanel');
        if (!panel) return;
        try {
            const res = await fetch('/api/admin/study/stamps', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) return;
            stampCache.clear();
            renderPokemonSummary(data.pokemon || null);
            renderBoards(data.children || [], data.pokemon || null);
            renderStampLogs(data.recentStamps || []);
        } catch (_) { /* ignore transient error */ }
    }

    async function postStampAction(url, method, body) {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || '처리에 실패했습니다.');
        }
        toast(data.message || '반영되었습니다.');
        await loadAdminStudyStampsPanel();
    }

    async function handlePanelClick(e) {
        const btn = e.target.closest('[data-stamp-action]');
        if (!btn) return;
        const action = btn.dataset.stampAction;
        const childId = btn.dataset.childId;
        const stampId = btn.dataset.stampId;

        try {
            if (action === 'pokemon-toggle') {
                btn.disabled = true;
                const enabled = btn.dataset.nextEnabled === 'true';
                await postStampAction('/api/admin/study/stamps/pokemon/toggle', 'POST', { enabled });
                return;
            }
            if (action === 'pokemon-reroll') {
                if (!confirm('현재 부화 대기 중인 알의 포켓몬 후보를 새로 뽑으시겠습니까? (아이 도장 개수는 그대로 유지됩니다)')) return;
                btn.disabled = true;
                await postStampAction('/api/admin/study/stamps/pokemon/reroll', 'POST', { childId });
                return;
            }
            if (action === 'grant-paper' || action === 'grant-online') {
                const noteInput = document.querySelector(`[data-note-for="${CSS.escape(childId)}"]`);
                const note = noteInput ? noteInput.value.trim() : '';
                btn.disabled = true;
                await postStampAction('/api/admin/study/stamps/grant', 'POST', {
                    childId,
                    sourceType: action === 'grant-paper' ? 'paper' : 'online',
                    note
                });
                if (noteInput) noteInput.value = '';
                return;
            }
            if (action === 'undo-last') {
                btn.disabled = true;
                await postStampAction('/api/admin/study/stamps/undo-last', 'POST', { childId });
                return;
            }
            if (action === 'set-count') {
                const cntInput = document.querySelector(`[data-count-for="${CSS.escape(childId)}"]`);
                const targetCount = Number(cntInput?.value);
                await postStampAction('/api/admin/study/stamps/set-count', 'POST', { childId, targetCount });
                return;
            }
            if (action === 'reset-board') {
                if (!confirm('현재 진행 중인 도장판의 도장을 모두 비우시겠습니까?')) return;
                await postStampAction('/api/admin/study/stamps/reset', 'POST', { childId });
                return;
            }
            if (action === 'delete-log') {
                if (!confirm('이 도장 기록을 삭제하시겠습니까?')) return;
                await postStampAction(`/api/admin/study/stamps/${encodeURIComponent(stampId)}?childId=${encodeURIComponent(childId)}`, 'DELETE');
                return;
            }
            if (action === 'edit-slot') {
                const cached = stampCache.get(String(stampId));
                const currNote = cached?.note || '';
                const next = prompt('메모를 수정하려면 새 내용을 입력하세요.\n(이 도장 1개를 삭제하려면 "삭제"라고 입력하거나 취소를 누른 뒤 아래 이력에서 삭제하세요)', currNote);
                if (next === null) return;
                if (next.trim() === '삭제') {
                    await postStampAction(`/api/admin/study/stamps/${encodeURIComponent(stampId)}?childId=${encodeURIComponent(childId)}`, 'DELETE');
                } else {
                    await postStampAction(`/api/admin/study/stamps/${encodeURIComponent(stampId)}`, 'PATCH', {
                        childId,
                        note: next.trim()
                    });
                }
            }
        } catch (err) {
            toast(err.message || '도장판 수정 중 오류가 발생했습니다.', true);
        } finally {
            btn.disabled = false;
        }
    }

    document.addEventListener('click', (e) => {
        const panel = document.getElementById('studyStampManagerPanel');
        if (!panel || !panel.contains(e.target)) return;
        handlePanelClick(e);
    });

    if (typeof window.loadAdminStudyOverview === 'function') {
        const prevLoad = window.loadAdminStudyOverview;
        window.loadAdminStudyOverview = async function () {
            const res = await prevLoad.apply(this, arguments);
            await loadAdminStudyStampsPanel();
            return res;
        };
    }

    window.loadAdminStudyStampsPanel = loadAdminStudyStampsPanel;
})();
