// ==============================================================================
// 📸💾 JG 관리자 가족 사진첩 & 통합 백업 센터 제어 엔진 (admin-album-backup.js)
// - 가족 사진첩 통계, 최근 업로드 사진 검수/삭제, 구성원 활동 현황
// - 통합 백업 센터 상태 조회, 원클릭 전체 백업 즉시 실행, 실시간 로그 뷰어
// ==============================================================================

// ------------------------------------------------------------------------------
// 1. 📸 우리 가족 사진첩 관리
// ------------------------------------------------------------------------------

/**
 * 1-1. 사진첩 통계 및 스토리지 용량 조회
 */
async function loadAlbumAdminStats() {
    try {
        const res = await fetch('/api/admin/album/stats');
        const data = await res.json();
        if (data && data.success && data.stats) {
            const s = data.stats;
            const elPhotos = document.getElementById('albumStatPhotos');
            const elComments = document.getElementById('albumStatComments');
            const elReactions = document.getElementById('albumStatReactions');
            const elStorage = document.getElementById('albumStatStorage');

            if (elPhotos) elPhotos.textContent = `${s.total_photos.toLocaleString()}장`;
            if (elComments) elComments.textContent = `${s.total_comments.toLocaleString()}개`;
            if (elReactions) elReactions.textContent = `${s.total_reactions.toLocaleString()}개`;
            if (elStorage) elStorage.textContent = `${s.storage_mb} MB`;
        }
    } catch (e) {
        console.error('사진첩 통계 조회 실패:', e);
    }
}
window.loadAlbumAdminStats = loadAlbumAdminStats;

/**
 * 1-2. 최근 업로드 사진 목록 조회 및 카드 렌더링
 */
async function loadAlbumAdminPhotos() {
    const container = document.getElementById('albumPhotosContainer');
    if (!container) return;

    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:2.5rem 0; color:#94a3b8;">사진 목록을 불러오는 중...</div>';

    try {
        const res = await fetch('/api/admin/album/photos?limit=24');
        const data = await res.json();

        if (!data || !data.success || !Array.isArray(data.photos) || data.photos.length === 0) {
            container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:3rem 0; color:#94a3b8;">등록된 사진이 없습니다.</div>';
            return;
        }

        container.innerHTML = data.photos.map(p => {
            const author = p.author_name || '가족';
            const emoji = p.avatar_emoji || '😊';
            const dateStr = p.created_at ? p.created_at.slice(0, 16) : '-';
            const thumbUrl = `https://album.j-jg.cc/uploads/thumbnails/${p.thumbnail_filename}`;
            const origUrl = `https://album.j-jg.cc/uploads/originals/${p.storage_filename}`;
            const caption = p.caption ? escapeHtml(p.caption) : '설명 없음';
            const sizeKb = p.file_size ? (p.file_size / 1024).toFixed(0) + ' KB' : '-';

            return `
                <div class="admin-photo-card" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:0.75rem; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column;">
                    <div style="position:relative; width:100%; aspect-ratio:4/3; background:#f1f5f9; overflow:hidden;">
                        <img src="${thumbUrl}" alt="${caption}" loading="lazy" style="width:100%; height:100%; object-fit:cover;" onerror="this.onerror=null; this.src='https://placehold.co/400x300/e2e8f0/64748b?text=Photo';">
                        <div style="position:absolute; top:6px; right:6px; background:rgba(15,23,42,0.65); color:#ffffff; font-size:0.72rem; padding:2px 6px; border-radius:4px; font-family:monospace;">
                            #${p.id}
                        </div>
                    </div>
                    <div style="padding:0.75rem; display:flex; flex-direction:column; flex:1; justify-content:space-between;">
                        <div>
                            <div style="display:flex; align-items:center; gap:0.35rem; margin-bottom:0.35rem;">
                                <span style="font-size:0.95rem;">${emoji}</span>
                                <strong style="font-size:0.85rem; color:#1e293b;">${author}</strong>
                                <span style="font-size:0.72rem; color:#94a3b8; margin-left:auto;">${dateStr}</span>
                            </div>
                            <p style="font-size:0.82rem; color:#475569; margin:0 0 0.5rem 0; line-height:1.35; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">
                                ${caption}
                            </p>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid #f1f5f9; padding-top:0.5rem; margin-top:0.35rem;">
                            <span style="font-size:0.75rem; color:#64748b;">
                                💬 ${p.comment_count || 0} · ❤️ ${p.reaction_count || 0} · ${sizeKb}
                            </span>
                            <div style="display:flex; gap:0.25rem;">
                                <a href="${origUrl}" target="_blank" rel="noopener" class="btn-admin btn-admin-outline btn-admin-xs" style="padding:2px 6px; text-decoration:none;" title="원본 보기">
                                    🔍
                                </a>
                                <button type="button" class="btn-admin btn-admin-danger btn-admin-xs" style="padding:2px 6px;" onclick="deleteAlbumPhoto(${p.id})" title="사진 삭제">
                                    🗑️ 삭제
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('사진 목록 로드 실패:', e);
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:2rem 0; color:#ef4444;">사진 목록을 불러오지 못했습니다.</div>';
    }
}
window.loadAlbumAdminPhotos = loadAlbumAdminPhotos;

/**
 * 1-3. 관리자 권한 사진 삭제
 */
async function deleteAlbumPhoto(photoId) {
    if (!confirm(`사진 #${photoId}을(를) 정말 삭제하시겠습니까?\n등록된 댓글과 하트 반응도 함께 영구 삭제됩니다.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/admin/album/photos/${photoId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data && data.success) {
            showToast(data.message || '사진이 성공적으로 삭제되었습니다.');
            loadAlbumAdminPhotos();
            loadAlbumAdminStats();
        } else {
            showToast(data.message || '사진 삭제에 실패했습니다.', true);
        }
    } catch (e) {
        showToast('사진 삭제 중 오류가 발생했습니다.', true);
    }
}
window.deleteAlbumPhoto = deleteAlbumPhoto;

/**
 * 1-4. 사진첩 구성원 활동 현황 로드
 */
async function loadAlbumAdminMembers() {
    const tbody = document.getElementById('albumMembersTableBody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/admin/album/members');
        const data = await res.json();

        if (!data || !data.success || !Array.isArray(data.members) || data.members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem 0; color:#94a3b8;">등록된 구성원이 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = data.members.map(m => {
            const roleBadge = m.role === 'admin' 
                ? '<span class="admin-badge admin-badge-danger">관리자</span>' 
                : '<span class="admin-badge admin-badge-info">가족</span>';
            const statusBadge = m.is_active 
                ? '<span class="admin-badge admin-badge-success">활동 중</span>' 
                : '<span class="admin-badge admin-badge-neutral">비활성</span>';

            return `
                <tr>
                    <td><strong>${m.avatar_emoji || '😊'} ${escapeHtml(m.nickname)}</strong></td>
                    <td class="font-mono text-muted">${escapeHtml(m.user_id)}</td>
                    <td>${roleBadge}</td>
                    <td>${m.photo_count || 0}장</td>
                    <td>${m.comment_count || 0}개</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error('구성원 목록 로드 실패:', e);
    }
}
window.loadAlbumAdminMembers = loadAlbumAdminMembers;

/**
 * 1-4. 🤖 AI 사진 분석 이력 및 로그 목록 조회
 */
let cachedAiLogs = [];

async function loadAlbumAiLogs() {
    const tbody = document.getElementById('albumAiLogsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:2rem 0; color:#94a3b8;">AI 분석 로그를 불러오는 중...</td></tr>';

    try {
        const res = await fetch('/api/admin/album/ai-logs?limit=50');
        const data = await res.json();

        if (data && data.success) {
            const s = data.stats || {};
            const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setT('albumAiStatTotal', `${s.totalCount || 0}건`);
            setT('albumAiStatSuccessRate', `${s.successRate || 100}%`);
            setT('albumAiStatAvgDuration', s.avgDurationMs ? `${(s.avgDurationMs / 1000).toFixed(1)}초` : '0초');
            if (data.logs && data.logs[0] && data.logs[0].models_used) setT('albumAiStatEngine', data.logs[0].models_used);

            cachedAiLogs = data.logs || [];

            if (cachedAiLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:2.5rem 0; color:#94a3b8;">기록된 AI 분석 로그가 없습니다.</td></tr>';
                return;
            }

            tbody.innerHTML = cachedAiLogs.map((log) => {
                const isSuccess = log.status === 'completed';
                const statusBadge = isSuccess
                    ? '<span class="admin-badge admin-badge-success" style="padding:2px 8px; font-size:0.75rem;">성공</span>'
                    : '<span class="admin-badge admin-badge-danger" style="padding:2px 8px; font-size:0.75rem;">실패</span>';

                const typeLabel = log.task_type === 'existing_photo' ? '등록 사진' : '신규 업로드';
                const photoLabel = log.photo_id ? `#${log.photo_id}번 게시물` : (log.original_name || '미등록');
                const durationSec = log.duration_ms ? (log.duration_ms / 1000).toFixed(1) + '초' : '-';
                const models = log.models_used || '-';
                const dateStr = log.created_at ? log.created_at.slice(0, 16) : '-';
                const summaryText = log.caption_result ? escapeHtml(log.caption_result) : (log.error_message ? `<span style="color:#ef4444;">${escapeHtml(log.error_message)}</span>` : '-');

                return `
                    <tr>
                        <td style="font-family:monospace; font-size:0.8rem; color:#64748b;">${escapeHtml(log.task_id ? log.task_id.slice(-8) : String(log.id))}</td>
                        <td style="font-weight:600; font-size:0.85rem;">${photoLabel}</td>
                        <td><span style="font-size:0.75rem; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${typeLabel}</span></td>
                        <td style="font-size:0.78rem; color:#475569;">${escapeHtml(models)}</td>
                        <td style="font-size:0.82rem;">${log.total_photos || 1}장</td>
                        <td style="font-size:0.82rem; font-weight:600; color:#3b82f6;">${durationSec}</td>
                        <td>${statusBadge}</td>
                        <td style="font-size:0.82rem; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(log.caption_result || '')}">
                            ${summaryText}
                        </td>
                        <td style="font-size:0.75rem; color:#94a3b8;">${dateStr}</td>
                        <td>
                            <button type="button" class="btn-admin btn-admin-outline btn-admin-xs" style="padding:2px 8px;" onclick="openAdminAiLogDetail(${log.id})">
                                🔍 보기
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (e) {
        console.error('AI 로그 조회 실패:', e);
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:2rem 0; color:#ef4444;">로그를 불러오지 못했습니다.</td></tr>';
    }
}
window.loadAlbumAiLogs = loadAlbumAiLogs;

/**
 * AI 로그 상세 모달 열기
 */
function openAdminAiLogDetail(logId) {
    const log = cachedAiLogs.find((l) => l.id === logId);
    if (!log) return;

    const modal = document.getElementById('adminAiLogDetailModal');
    const content = document.getElementById('adminAiLogDetailContent');
    if (!modal || !content) return;

    let details = null;
    try {
        if (log.details_json) {
            details = typeof log.details_json === 'object' ? log.details_json : JSON.parse(log.details_json);
        }
    } catch (e) {}

    const photoCards = (details && Array.isArray(details.photoDetails) && details.photoDetails.length > 0)
        ? details.photoDetails.map((pd, i) => `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.5rem; padding:0.75rem; display:flex; flex-direction:column; gap:0.35rem;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.78rem; font-weight:700; color:#4338ca; background:#e0e7ff; padding:2px 6px; border-radius:4px;">사진 ${pd.photoIndex || (i + 1)}</span>
                </div>
                <div style="font-size:0.83rem; font-weight:600; color:#1e293b;">👁️ 시각 관찰: ${escapeHtml(pd.koreanDesc || pd.englishDesc || '-')}</div>
                <div style="font-size:0.78rem; color:#475569; background:#ffffff; padding:0.4rem 0.6rem; border-radius:4px; border-left:3px solid #6366f1;">
                    💡 <strong>추론 근거:</strong> ${escapeHtml(pd.reasoning || '-')}
                </div>
                ${pd.englishDesc ? `<div style="font-size:0.72rem; color:#94a3b8; font-family:monospace; margin-top:2px;">원문: ${escapeHtml(pd.englishDesc)}</div>` : ''}
            </div>
        `).join('')
        : '<div style="color:#94a3b8; font-size:0.82rem; text-align:center; padding:1rem 0;">세부 사진별 추론 기록이 없습니다.</div>';

    const overallReasoning = details ? (details.overallReasoning || '-') : '-';

    content.innerHTML = `
        <div style="background:#f1f5f9; padding:0.75rem 1rem; border-radius:0.5rem; font-size:0.82rem; display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
            <div><strong>작업 ID:</strong> <span style="font-family:monospace;">${escapeHtml(log.task_id || String(log.id))}</span></div>
            <div><strong>분석 일시:</strong> ${escapeHtml(log.created_at || '-')}</div>
            <div><strong>사용 모델:</strong> ${escapeHtml(log.models_used || '-')}</div>
            <div><strong>소요 시간:</strong> ${log.duration_ms ? (log.duration_ms / 1000).toFixed(1) + '초' : '-'}</div>
            <div><strong>작업 유형:</strong> ${log.task_type === 'existing_photo' ? '등록 사진' : '신규 업로드'}</div>
            <div><strong>분석 장수:</strong> ${log.total_photos || 1}장</div>
        </div>

        <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:0.5rem; padding:0.75rem 1rem;">
            <div style="font-weight:700; color:#3730a3; font-size:0.85rem; margin-bottom:0.25rem;">📝 생성된 가족 한 줄 이야기 (캡션)</div>
            <div style="font-size:0.9rem; color:#1e1b4b; font-weight:600; line-height:1.4;">${escapeHtml(log.caption_result || '-')}</div>
            ${log.tags_result ? `<div style="font-size:0.8rem; color:#4338ca; margin-top:0.35rem; font-weight:600;">${escapeHtml(log.tags_result)}</div>` : ''}
        </div>

        <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:0.5rem; padding:0.75rem 1rem;">
            <div style="font-weight:700; color:#6b21a8; font-size:0.85rem; margin-bottom:0.25rem;">🧠 전체 종합 추론 요약</div>
            <div style="font-size:0.82rem; color:#3b0764; line-height:1.45;">${escapeHtml(overallReasoning)}</div>
        </div>

        <div>
            <div style="font-weight:700; color:#1e293b; font-size:0.88rem; margin-bottom:0.5rem;">📸 사진별 상세 분석 & 추론 내역</div>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                ${photoCards}
            </div>
        </div>
    `;

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
}
window.openAdminAiLogDetail = openAdminAiLogDetail;

function closeAdminAiLogDetailModal() {
    const modal = document.getElementById('adminAiLogDetailModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.add('hidden');
}
window.closeAdminAiLogDetailModal = closeAdminAiLogDetailModal;

// ------------------------------------------------------------------------------
// 2. 💾 통합 백업 센터 제어
// ------------------------------------------------------------------------------

/**
 * 2-1. 정기 백업 상태 및 아카이브 목록 조회
 */
async function loadBackupAdminStatus() {
    try {
        const res = await fetch('/api/admin/backup/status');
        const data = await res.json();

        if (data && data.success) {
            const s = data.status || {};
            const sec = data.secondary_server || {};

            const elLastDate = document.getElementById('backupStatLastDate');
            const elArchiveSize = document.getElementById('backupStatArchiveSize');
            const elSecStatus = document.getElementById('backupStatSecondaryStatus');
            const elIntegrity = document.getElementById('backupStatIntegrity');

            if (elLastDate) {
                if (s.last_backup_date && s.last_backup_date !== '기록 없음' && !s.last_backup_date.includes('대기')) {
                    const cleanDate = s.last_backup_date.replace('T', ' ');
                    const parts = cleanDate.split(' ');
                    if (parts.length === 2) {
                        elLastDate.innerHTML = `<span style="font-size:0.86rem; display:block; font-weight:700; line-height:1.2;">${parts[0]}</span><span style="font-size:0.75rem; color:#64748b; font-weight:600; display:block; margin-top:2px;">${parts[1]}</span>`;
                    } else {
                        elLastDate.textContent = cleanDate;
                    }
                } else {
                    elLastDate.textContent = '기록 없음';
                }
            }
            if (elArchiveSize) {
                elArchiveSize.textContent = s.archive_size || '-';
            }
            if (elSecStatus) {
                if (sec.online) {
                    elSecStatus.innerHTML = '<span class="admin-badge admin-badge-success" title="HP 15-g008au (500GB HDD 백업 스토리지)">정상 연결 (HP)</span>';
                } else {
                    elSecStatus.innerHTML = '<span class="admin-badge admin-badge-warning">연결 대기</span>';
                }
            }
            if (elIntegrity) {
                if (s.integrity_verified !== false) {
                    elIntegrity.innerHTML = '<span class="admin-badge admin-badge-success">✅ 5대 DB 정상</span>';
                } else {
                    elIntegrity.innerHTML = '<span class="admin-badge admin-badge-danger">⚠️ 무결성 주의</span>';
                }
            }

            const elSsd = document.getElementById('backupStatExternalSsd');
            if (elSsd) {
                const ext = sec.external_ssd || s.external_ssd;
                if (sec.online && ext && ext.mounted) {
                    elSsd.innerHTML = `<span class="admin-badge admin-badge-success" title="${ext.mountPath} (${ext.used}/${ext.total})">정상 보관 (SSD)</span>`;
                } else if (sec.online) {
                    elSsd.innerHTML = '<span class="admin-badge admin-badge-success" title="HP 보조 서버 외장 SSD 연결됨">정상 연동 (HP)</span>';
                } else {
                    elSsd.innerHTML = '<span class="admin-badge admin-badge-warning" title="/media/external_ssd (새벽 04:00 자동 동기화)">새벽 동기화</span>';
                }
            }

            // 아카이브 목록 테이블 렌더링
            const tbody = document.getElementById('backupArchivesTableBody');
            if (tbody) {
                if (Array.isArray(data.archives) && data.archives.length > 0) {
                    tbody.innerHTML = data.archives.map(a => {
                        const dateStr = a.created_at ? new Date(a.created_at).toLocaleString('ko-KR') : '-';
                        return `
                            <tr>
                                <td class="font-mono" style="font-weight:600; color:#1e293b;">${escapeHtml(a.filename)}</td>
                                <td class="font-mono text-muted">${a.size_mb}</td>
                                <td class="text-muted" style="font-size:0.82rem;">${dateStr}</td>
                                <td style="text-align:right;">
                                    <a href="/api/admin/backup/download/${encodeURIComponent(a.filename)}" class="btn-admin btn-admin-outline btn-admin-xs" style="text-decoration:none;" download>
                                        ⬇️ 다운로드
                                    </a>
                                </td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem 0; color:#94a3b8;">저장된 백업 파일이 없습니다.</td></tr>';
                }
            }

            // 실행 중 상태일 때 버튼 피드백
            const btnRun = document.getElementById('btnTriggerManualBackup');
            if (btnRun) {
                if (data.is_running) {
                    btnRun.disabled = true;
                    btnRun.textContent = '⏳ 백업 작업 실행 중...';
                } else {
                    btnRun.disabled = false;
                    btnRun.textContent = '⚡ 지금 전체 백업 실행';
                }
            }
        }
    } catch (e) {
        console.error('백업 상태 조회 실패:', e);
    }
}
window.loadBackupAdminStatus = loadBackupAdminStatus;

/**
 * 2-2. 지금 전체 백업 즉시 실행 (수동 트리거)
 */
async function triggerManualBackup() {
    if (!confirm('지금 즉시 전체 4대 데이터베이스 및 시스템 로그 백업을 실행하시겠습니까?\n작업은 백그라운드에서 안전하게 진행됩니다.')) {
        return;
    }

    const btn = document.getElementById('btnTriggerManualBackup');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 백업 시작 요청 중...';
    }

    try {
        const res = await fetch('/api/admin/backup/run', { method: 'POST' });
        const data = await res.json();
        if (data && data.success) {
            showToast('🚀 백업 작업이 시작되었습니다. 잠시 후 완료됩니다.');
            setTimeout(() => {
                loadBackupAdminStatus();
                loadBackupAdminLogs();
            }, 3000);
        } else {
            showToast(data.message || '백업 실행 요청 실패', true);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '⚡ 지금 전체 백업 실행';
            }
        }
    } catch (e) {
        showToast('백업 요청 중 오류가 발생했습니다.', true);
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⚡ 지금 전체 백업 실행';
        }
    }
}
window.triggerManualBackup = triggerManualBackup;

/**
 * 2-3. 실시간 백업 로그 콘솔 텍스트 로드
 */
async function loadBackupAdminLogs() {
    const pre = document.getElementById('adminBackupLogConsole');
    if (!pre) return;

    try {
        const res = await fetch('/api/admin/backup/logs');
        const data = await res.json();
        if (data && data.success) {
            pre.textContent = data.logs || '기록된 로그가 없습니다.';
            pre.scrollTop = pre.scrollHeight;
        } else {
            pre.textContent = '로그를 불러오지 못했습니다.';
        }
    } catch (e) {
        pre.textContent = '로그 로드 중 네트워크 오류가 발생했습니다.';
    }
}
window.loadBackupAdminLogs = loadBackupAdminLogs;

// HTML 특수문자 안전 이스케이프 헬퍼
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
