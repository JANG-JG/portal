/**
 * ==============================================================================
 * 📜 가족 위키 수정 이력·복원 및 AI 추론 감사 모듈 (admin-wiki-governance.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 | [규칙 3] 500줄 이하 모듈화 & XSS 방어
 * [규칙 6] 가로 360px 모바일 뷰포트 무넘침 보장
 * ==============================================================================
 */

let currentWikiGovSlugFilter = '';

const WIKI_AI_ACTION_LABELS = {
    draft: '✍️ 문서 초안 작성',
    summarize: '📝 3줄 핵심 요약',
    prescription_scan: '💊 약봉투·처방 스캔',
    lifestyle_scan: '📸 생활 사진 스캔',
    memo_wiki: '📒 메모→위키 정돈',
    publish_wiki_merge: '🔀 기존 문서 스마트 병합',
    publish_wiki_create: '🆕 새 위키 문서 발행',
    wiki_draft: '✍️ 포털 초안 작성',
    wiki_summarize: '📝 포털 본문 요약',
    extract_routine: '📅 루틴·할 일 추출',
    chat_wiki_tool: '💬 비서 위키 조회·수정'
};

function ensureWikiGovernanceShell() {
    const mount = document.getElementById('wikiGovernanceMount');
    if (!mount || mount.dataset.initialized === '1') return mount;
    mount.dataset.initialized = '1';

    mount.innerHTML = `
        <div class="admin-card" style="padding:1.25rem; margin-bottom:1rem; box-sizing:border-box; max-width:100%;">
            <div class="admin-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem; margin-bottom:0.85rem;">
                <div style="min-width:0;">
                    <h3 style="margin:0;">📜 위키 문서 수정 이력 및 원클릭 복원</h3>
                    <p id="wikiGovSubStatus" style="font-size:0.78rem; color:#64748b; margin:0.25rem 0 0;">문서별 버전 스냅샷 열람, 변경 내용 비교 및 이전 버전 즉시 되돌리기</p>
                </div>
                <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; max-width:100%;">
                    <input type="search" id="wikiGovSlugInput" placeholder="🔍 슬러그 필터 (예: home-appliance)"
                        onkeydown="if(event.key==='Enter'){if(event.isComposing||event.keyCode===229)return;applyWikiGovSlugFilter();}"
                        style="padding:0.38rem 0.65rem; font-size:0.8rem; border:1px solid #cbd5e1; border-radius:0.45rem; width:190px; max-width:100%; min-width:0; box-sizing:border-box; background:#f8fafc;">
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="applyWikiGovSlugFilter()">필터</button>
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" onclick="resetWikiGovSlugFilter()">🔄 전체 새로고침</button>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:0.65rem; margin-bottom:1rem;">
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">누적 버전 스냅샷</div>
                    <div id="wikiRevStatTotal" style="font-size:1.15rem; font-weight:800; color:#0f172a; margin-top:0.2rem;">-</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">이력 보유 문서</div>
                    <div id="wikiRevStatPages" style="font-size:1.15rem; font-weight:800; color:#2563eb; margin-top:0.2rem;">-</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">오늘 수정 횟수</div>
                    <div id="wikiRevStatToday" style="font-size:1.15rem; font-weight:800; color:#059669; margin-top:0.2rem;">-</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">버전 복원 횟수</div>
                    <div id="wikiRevStatReverts" style="font-size:1.15rem; font-weight:800; color:#d97706; margin-top:0.2rem;">-</div>
                </div>
            </div>

            <div id="wikiRevDetailDrawer" style="display:none; background:#0f172a; color:#f8fafc; border-radius:0.75rem; padding:1rem; margin-bottom:1rem; box-sizing:border-box; max-width:100%;"></div>

            <div style="overflow-x:auto; max-width:100%; border:1px solid #e2e8f0; border-radius:0.65rem;">
                <table class="admin-table" style="min-width:620px; width:100%; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th>수정 시각</th>
                            <th>문서 제목 / 슬러그</th>
                            <th>버전</th>
                            <th>변경 요약 · 작성자</th>
                            <th>분량</th>
                            <th>관리</th>
                        </tr>
                    </thead>
                    <tbody id="wikiRevHistoryTableBody">
                        <tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">수정 이력을 불러오는 중입니다...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="admin-card" style="padding:1.25rem; box-sizing:border-box; max-width:100%;">
            <div class="admin-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem; margin-bottom:0.85rem;">
                <div style="min-width:0;">
                    <h3 style="margin:0;">🤖 가족 위키 AI 추론 및 사진 스캔 이력</h3>
                    <p id="wikiAiModelSummary" style="font-size:0.78rem; color:#64748b; margin:0.25rem 0 0;">로컬 Ollama(초안·요약·스마트병합) 및 Gemini 비전(약봉투·생활사진) 실행 기록</p>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:0.65rem; margin-bottom:1rem;">
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">최근 7일 AI 실행</div>
                    <div id="wikiAiStatTotal" style="font-size:1.15rem; font-weight:800; color:#0f172a; margin-top:0.2rem;">-</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">로컬 Ollama 처리</div>
                    <div id="wikiAiStatOllama" style="font-size:1.15rem; font-weight:800; color:#059669; margin-top:0.2rem;">-</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">사진 스캔 (오늘 쿼터)</div>
                    <div id="wikiAiStatQuota" style="font-size:1.05rem; font-weight:800; color:#7c3aed; margin-top:0.2rem;">-</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.65rem; padding:0.75rem;">
                    <div style="font-size:0.74rem; color:#64748b;">실패·한도 차단</div>
                    <div id="wikiAiStatErrors" style="font-size:1.15rem; font-weight:800; color:#dc2626; margin-top:0.2rem;">-</div>
                </div>
            </div>

            <div style="overflow-x:auto; max-width:100%; border:1px solid #e2e8f0; border-radius:0.65rem;">
                <table class="admin-table" style="min-width:620px; width:100%; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th>실행 시각</th>
                            <th>구분 · 작업 종류</th>
                            <th>엔진 / 모델</th>
                            <th>대상 문서 · 주제 (마스킹)</th>
                            <th>소요 시간</th>
                            <th>상태</th>
                        </tr>
                    </thead>
                    <tbody id="wikiAiLogsTableBody">
                        <tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">AI 실행 기록을 불러오는 중입니다...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    return mount;
}

function applyWikiGovSlugFilter() {
    const input = document.getElementById('wikiGovSlugInput');
    currentWikiGovSlugFilter = input ? input.value.trim() : '';
    loadWikiGovernance();
}

function resetWikiGovSlugFilter() {
    currentWikiGovSlugFilter = '';
    const input = document.getElementById('wikiGovSlugInput');
    if (input) input.value = '';
    loadWikiGovernance();
}

async function loadWikiGovernance() {
    ensureWikiGovernanceShell();
    const revTbody = document.getElementById('wikiRevHistoryTableBody');
    const aiTbody = document.getElementById('wikiAiLogsTableBody');

    try {
        const qs = currentWikiGovSlugFilter ? `?slug=${encodeURIComponent(currentWikiGovSlugFilter)}` : '';
        const res = await fetch(`/api/admin/wiki/governance${qs}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || '조회 실패');

        const subStatus = document.getElementById('wikiGovSubStatus');
        if (subStatus) {
            subStatus.textContent = data.secondaryOnline
                ? '🟢 보조서버(family-wiki) 실시간 연동 정상 · 버전 비교 및 원클릭 복원 가능'
                : `⚠️ 보조서버 연결 확인 필요 (${data.secondaryWarning || '오프라인'}) · 포털 AI 로그만 표시 중`;
            subStatus.style.color = data.secondaryOnline ? '#059669' : '#d97706';
        }

        const rStats = data.revisionStats || {};
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setTxt('wikiRevStatTotal', `${rStats.total_revisions || 0}건`);
        setTxt('wikiRevStatPages', `${rStats.edited_pages_count || 0}개`);
        setTxt('wikiRevStatToday', `${rStats.today_edits || 0}건`);
        setTxt('wikiRevStatReverts', `${rStats.revert_count || 0}회`);

        const cfg = data.configuredModels || {};
        const modelInfo = document.getElementById('wikiAiModelSummary');
        if (modelInfo) {
            modelInfo.textContent = `위키 초안: ${cfg.draftModel || '-'} · 3줄 요약: ${cfg.summaryModel || '-'} · 포털 병합/변환: ${cfg.portalModel || '-'}`;
        }

        const aStats = data.aiStats || {};
        const quota = data.quota || {};
        setTxt('wikiAiStatTotal', `${aStats.total7d || 0}건`);
        setTxt('wikiAiStatOllama', `${aStats.ollamaCount || 0}건`);
        const quotaTxt = quota.daily_limit ? `${quota.used_today || 0} / ${quota.daily_limit}회` : `${aStats.geminiCount || 0}건`;
        setTxt('wikiAiStatQuota', quotaTxt);
        setTxt('wikiAiStatErrors', `${aStats.errorCount || 0}건`);

        renderWikiRevisionRows(revTbody, data.revisions || []);
        renderWikiAiLogRows(aiTbody, data.aiLogs || []);
    } catch (err) {
        if (revTbody) revTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#dc2626;">조회 실패: ${escapeHtml(err.message)}</td></tr>`;
        if (aiTbody) aiTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#dc2626;">조회 실패: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderWikiRevisionRows(tbody, revisions) {
    if (!tbody) return;
    if (!revisions.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">기록된 문서 수정 이력이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = revisions.map(r => {
        const isLatest = Number(r.version) === Number(r.latest_version);
        const verBadge = isLatest
            ? `<span style="background:#dcfce7; color:#166534; padding:2px 7px; border-radius:9999px; font-size:0.72rem; font-weight:700;">v${Number(r.version)} · 현재</span>`
            : `<span style="background:#f1f5f9; color:#334155; padding:2px 7px; border-radius:9999px; font-size:0.72rem; font-weight:700;">v${Number(r.version)}</span>`;

        const safeSlugJs = String(r.slug || '').replace(/[^a-zA-Z0-9_\-가-힣]/g, '');
        const revertBtn = isLatest
            ? ''
            : `<button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" style="padding:0.25rem 0.5rem; font-size:0.74rem;" onclick="revertWikiRevisionFromAdmin('${safeSlugJs}', ${Number(r.version)})">⏪ 복원</button>`;

        return `
            <tr>
                <td style="font-size:0.76rem; color:#64748b; white-space:nowrap;">${escapeHtml(typeof formatAdminKst === 'function' ? formatAdminKst(r.created_at) : (r.created_at || '-'))}</td>
                <td>
                    <div style="font-weight:700; color:#1e293b; font-size:0.84rem;">${escapeHtml(r.title || '-')}</div>
                    <div style="font-size:0.72rem; color:#64748b;">[${escapeHtml(r.category || '생활')}] <code>${escapeHtml(r.slug || '')}</code></div>
                </td>
                <td style="white-space:nowrap;">${verBadge}</td>
                <td>
                    <div style="font-size:0.8rem; color:#334155;">${escapeHtml(r.change_summary || '문서 수정')}</div>
                    <div style="font-size:0.72rem; color:#94a3b8;">작성: ${escapeHtml(r.author || '가족')}</div>
                </td>
                <td style="font-size:0.76rem; color:#475569; white-space:nowrap;">${Number(r.content_length || 0).toLocaleString()}자</td>
                <td style="white-space:nowrap;">
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                        <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="padding:0.25rem 0.5rem; font-size:0.74rem;" onclick="inspectWikiRevisionDetail('${safeSlugJs}', ${Number(r.version)}, ${isLatest})">🔍 비교·열람</button>
                        ${revertBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderWikiAiLogRows(tbody, logs) {
    if (!tbody) return;
    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#94a3b8;">아직 기록된 위키 AI 실행 이력이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(item => {
        const label = WIKI_AI_ACTION_LABELS[item.action_type] || escapeHtml(item.action_type || 'AI 작업');
        const srcBadge = item.source === '가족위키'
            ? '<span style="background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">가족위키</span>'
            : '<span style="background:#ede9fe; color:#6d28d9; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">포털 AI</span>';
        const ok = item.status === 'SUCCESS';
        const statusBadge = ok
            ? '<span style="color:#059669; font-weight:700; font-size:0.76rem;">✅ 정상</span>'
            : `<span style="color:#dc2626; font-weight:700; font-size:0.76rem;" title="${escapeHtml(item.error_msg || '')}">⚠️ ${escapeHtml(item.status || '오류')}</span>`;
        const sec = item.duration_ms ? `${(Number(item.duration_ms) / 1000).toFixed(1)}초` : '-';

        return `
            <tr>
                <td style="font-size:0.76rem; color:#64748b; white-space:nowrap;">${escapeHtml(typeof formatAdminKst === 'function' ? formatAdminKst(item.created_at) : (item.created_at || '-'))}</td>
                <td style="font-size:0.8rem; font-weight:600; color:#1e293b; white-space:nowrap;">${srcBadge} ${label}</td>
                <td style="font-size:0.76rem; color:#475569;"><code>${escapeHtml(item.model || item.engine || '-')}</code></td>
                <td style="font-size:0.8rem; color:#334155; max-width:240px; word-break:break-word;">${escapeHtml(item.target_title || '-')}</td>
                <td style="font-size:0.76rem; color:#475569; white-space:nowrap;">${sec}</td>
                <td style="white-space:nowrap;">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

async function inspectWikiRevisionDetail(slug, version, isLatest) {
    const drawer = document.getElementById('wikiRevDetailDrawer');
    if (!drawer) return;
    drawer.style.display = 'block';
    drawer.innerHTML = '<div style="font-size:0.82rem; color:#94a3b8;">버전 상세 본문과 변경점을 불러오는 중입니다...</div>';

    try {
        const res = await fetch(`/api/admin/wiki/revision-detail?slug=${encodeURIComponent(slug)}&version=${Number(version)}`);
        const data = await res.json();
        if (!data.success || !data.revision) throw new Error(data.message || '상세 조회 실패');

        const rev = data.revision;
        const diff = data.diff;
        const diffLinesHtml = (diff && Array.isArray(diff.lines))
            ? diff.lines.slice(0, 120).map(l => {
                const bg = l.type === 'added' ? 'rgba(16,185,129,0.18)' : (l.type === 'removed' ? 'rgba(239,68,68,0.2)' : 'transparent');
                const color = l.type === 'added' ? '#6ee7b7' : (l.type === 'removed' ? '#fca5a5' : '#cbd5e1');
                const prefix = l.type === 'added' ? '+ ' : (l.type === 'removed' ? '- ' : '  ');
                return `<div style="background:${bg}; color:${color}; padding:1px 6px; font-family:monospace; font-size:0.76rem; white-space:pre-wrap; word-break:break-all;">${prefix}${escapeHtml(l.text || '')}</div>`;
            }).join('')
            : `<pre style="margin:0; font-size:0.78rem; color:#e2e8f0; white-space:pre-wrap; word-break:break-word;">${escapeHtml(rev.content_md || '')}</pre>`;

        const safeSlugJs = String(slug || '').replace(/[^a-zA-Z0-9_\-가-힣]/g, '');
        const restoreBtn = isLatest
            ? '<span style="font-size:0.76rem; color:#34d399; font-weight:700;">현재 적용 중인 최신 버전입니다</span>'
            : `<button type="button" class="btn-admin btn-admin-primary btn-admin-sm" onclick="revertWikiRevisionFromAdmin('${safeSlugJs}', ${Number(version)})">⏪ 이 버전(v${Number(version)})으로 즉시 복원</button>`;

        drawer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem; margin-bottom:0.7rem;">
                <div style="min-width:0;">
                    <div style="font-weight:800; font-size:0.95rem; color:#f8fafc;">📄 ${escapeHtml(rev.title)} <span style="color:#38bdf8;">(v${Number(rev.version)})</span></div>
                    <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.2rem;">
                        수정일시: ${escapeHtml(rev.created_at)} · 작성자: ${escapeHtml(rev.author || '가족')} · 요약: ${escapeHtml(rev.change_summary || '-')}
                        ${diff ? ` · <span style="color:#6ee7b7;">+${diff.added_count || 0}줄</span> / <span style="color:#fca5a5;">-${diff.removed_count || 0}줄</span>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                    ${restoreBtn}
                    <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="background:#1e293b; color:#e2e8f0; border-color:#475569;" onclick="document.getElementById('wikiRevDetailDrawer').style.display='none'">닫기 ✕</button>
                </div>
            </div>
            <div style="max-height:280px; overflow-y:auto; background:#020617; border:1px solid #334155; border-radius:0.5rem; padding:0.65rem;">
                ${diffLinesHtml}
            </div>
        `;
    } catch (err) {
        drawer.innerHTML = `<div style="color:#fca5a5; font-size:0.82rem;">열람 실패: ${escapeHtml(err.message)}</div>`;
    }
}

async function revertWikiRevisionFromAdmin(slug, version) {
    if (!slug || !version) return;
    if (!confirm(`정말 '${slug}' 문서를 이전 버전(v${version}) 상태로 되돌리시겠습니까?\n(현재 본문도 사라지지 않고 새 버전 이력으로 안전하게 보존됩니다.)`)) {
        return;
    }

    try {
        const res = await fetch('/api/admin/wiki/revert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, version: Number(version) })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || '복원 실패');

        if (typeof showAdminToast === 'function') {
            showAdminToast(data.message || `버전 v${version} 복원이 완료되었습니다.`, 'success');
        } else {
            alert(data.message || '복원이 완료되었습니다.');
        }
        const drawer = document.getElementById('wikiRevDetailDrawer');
        if (drawer) drawer.style.display = 'none';
        loadWikiGovernance();
    } catch (err) {
        alert('문서 복원 중 오류가 발생했습니다: ' + err.message);
    }
}

window.loadWikiGovernance = loadWikiGovernance;
window.applyWikiGovSlugFilter = applyWikiGovSlugFilter;
window.resetWikiGovSlugFilter = resetWikiGovSlugFilter;
window.inspectWikiRevisionDetail = inspectWikiRevisionDetail;
window.revertWikiRevisionFromAdmin = revertWikiRevisionFromAdmin;
