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
