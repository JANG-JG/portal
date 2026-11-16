/**
 * ==============================================================================
 * 「빨간패드공부」 갤럭시 탭 전용 앱(PWA) 관리자 제어 모듈 (admin-study-tablet.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    let latestTabletUrls = {
        extLoginUrl: 'https://j-jg.cc/study/login',
        lanLoginUrl: '',
        studyPath: '/study'
    };

    function toast(msg, isError = false) {
        if (typeof studyToast === 'function') return studyToast(msg, isError);
        if (typeof showToast === 'function') return showToast(msg, isError ? 'error' : 'success');
    }

    function syncTabletBadge(cfg) {
        const badgeEl = document.getElementById('studyTabletStateBadge');
        if (!badgeEl || !cfg) return;
        const wakeText = cfg.wakeLockDefault ? '💡 화면 유지' : '🌙 화면 절전';
        const penText = cfg.penOnlyDefault ? '🖊️ S펜 전용' : '🖐️ 손·펜 자동';
        const shareText = cfg.kidAlbumShareEnabled ? '🖼️ 앨범 공유 켜짐' : '🔒 앨범 공유 꺼짐';
        badgeEl.textContent = `${wakeText} · ${penText} · ${shareText}`;
    }

    function escArtwork(str) {
        if (typeof escStudyAdmin === 'function') return escStudyAdmin(str);
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function loadAdminStudyArtworks() {
        const grid = document.getElementById('adminStudyArtworksGrid');
        if (!grid) return;
        try {
            const res = await fetch('/api/admin/study/artworks?limit=12', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '조회 실패');
            const rows = data.artworks || [];
            if (!rows.length) {
                grid.innerHTML = '<div style="padding:0.9rem; color:#64748b; font-size:0.84rem;">아직 아이들이 저장·자랑한 그림 작품이 없습니다.</div>';
                return;
            }
            grid.innerHTML = rows.map((art) => {
                const statusBadge = art.albumStatus === 'shared'
                    ? '<span style="color:#047857; font-weight:800;">✅ 가족앨범 등록됨</span>'
                    : (art.albumStatus === 'album_failed'
                        ? '<span style="color:#d97706; font-weight:800;">⚠️ 학습실만 저장됨</span>'
                        : '<span style="color:#475569; font-weight:700;">💾 학습실 보관</span>');
                const shareBtnHtml = art.albumStatus !== 'shared'
                    ? `<button type="button" class="btn-admin btn-admin-primary btn-admin-sm" style="flex:1;" onclick="shareAdminStudyArtwork(${art.id})">🖼️ 가족앨범 등록</button>`
                    : '';
                return `
                    <div style="border:1px solid #e2e8f0; border-radius:0.75rem; background:#fff; padding:0.65rem; display:flex; flex-direction:column; gap:0.45rem;">
                        <a href="${escArtwork(art.adminImageUrl)}" target="_blank" rel="noopener" style="display:block; aspect-ratio:4/3; border-radius:0.5rem; overflow:hidden; background:#f8fafc; border:1px solid #f1f5f9;">
                            <img src="${escArtwork(art.adminImageUrl)}" alt="${escArtwork(art.title)}" style="width:100%; height:100%; object-fit:cover;">
                        </a>
                        <div style="font-size:0.84rem; font-weight:800; color:#0f172a;">${escArtwork(art.childLabel)} · ${escArtwork(art.title)}</div>
                        <div style="font-size:0.75rem; display:flex; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                            ${statusBadge}
                            <span style="color:#94a3b8;">${escArtwork(String(art.createdAt || '').slice(0, 16))}</span>
                        </div>
                        <div style="display:flex; gap:6px; margin-top:auto;">
                            ${shareBtnHtml}
                            <button type="button" class="btn-admin btn-admin-outline btn-admin-sm" style="color:#dc2626;" onclick="deleteAdminStudyArtwork(${art.id})">🗑️ 삭제</button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (_) {
            grid.innerHTML = '<div style="padding:0.9rem; color:#dc2626; font-size:0.84rem;">그림 작품 목록을 불러오지 못했습니다.</div>';
        }
    }

    async function shareAdminStudyArtwork(id) {
        try {
            const res = await fetch(`/api/admin/study/artworks/${id}/share`, {
                method: 'POST',
                credentials: 'same-origin'
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '등록 실패');
            toast(data.message || '가족앨범에 등록했습니다.');
            await loadAdminStudyArtworks();
        } catch (err) {
            toast(err.message || '가족앨범 등록에 실패했습니다.', true);
        }
    }

    async function deleteAdminStudyArtwork(id) {
        try {
            const res = await fetch(`/api/admin/study/artworks/${id}`, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '삭제 실패');
            toast(data.message || '삭제했습니다.');
            await loadAdminStudyArtworks();
        } catch (err) {
            toast(err.message || '삭제에 실패했습니다.', true);
        }
    }

    async function loadStudyTabletConfigPanel() {
        const panel = document.getElementById('studyTabletPwaPanel');
        if (!panel) return;
        try {
            const res = await fetch('/api/admin/study/tablet-config', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) return;

            const cfg = data.config || {
                wakeLockDefault: true,
                penOnlyDefault: false,
                soundFxDefault: true,
                hangulGuideEnabled: true,
                kidAlbumShareEnabled: true
            };
            latestTabletUrls = data.urls || latestTabletUrls;

            const wakeChk = document.getElementById('chkTabletWakeLockDefault');
            const penChk = document.getElementById('chkTabletPenOnlyDefault');
            const sfxChk = document.getElementById('chkTabletSoundFxDefault');
            const hangulChk = document.getElementById('chkTabletHangulGuideEnabled');
            const albumChk = document.getElementById('chkTabletKidAlbumShareEnabled');
            const pokeColorChk = document.getElementById('chkTabletPokemonColoringEnabled');
            if (wakeChk) wakeChk.checked = Boolean(cfg.wakeLockDefault);
            if (penChk) penChk.checked = Boolean(cfg.penOnlyDefault);
            if (sfxChk) sfxChk.checked = cfg.soundFxDefault !== false;
            if (hangulChk) hangulChk.checked = cfg.hangulGuideEnabled !== false;
            if (albumChk) albumChk.checked = cfg.kidAlbumShareEnabled !== false;
            if (pokeColorChk) pokeColorChk.checked = cfg.pokemonColoringEnabled !== false;

            const extEl = document.getElementById('studyTabletExtLoginText');
            const lanEl = document.getElementById('studyTabletLanLoginText');
            const lanBtn = document.getElementById('btnCopyStudyPwaLanUrl');
            if (extEl) extEl.textContent = latestTabletUrls.extLoginUrl || 'https://j-jg.cc/study/login';
            if (lanEl) lanEl.textContent = latestTabletUrls.lanLoginUrl || '내부 HTTPS 주소 확인 중';
            if (lanBtn) lanBtn.disabled = !latestTabletUrls.lanLoginUrl;

            syncTabletBadge(cfg);
            await loadAdminStudyArtworks();
        } catch (_) { /* ignore transient error */ }
    }

    async function saveStudyTabletConfig() {
        const wakeChk = document.getElementById('chkTabletWakeLockDefault');
        const penChk = document.getElementById('chkTabletPenOnlyDefault');
        const sfxChk = document.getElementById('chkTabletSoundFxDefault');
        const hangulChk = document.getElementById('chkTabletHangulGuideEnabled');
        const albumChk = document.getElementById('chkTabletKidAlbumShareEnabled');
        const pokeColorChk = document.getElementById('chkTabletPokemonColoringEnabled');
        const saveBtn = document.getElementById('btnSaveStudyTabletConfig');
        if (!wakeChk || !penChk) return;

        if (saveBtn) saveBtn.disabled = true;
        try {
            const res = await fetch('/api/admin/study/tablet-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    wakeLockDefault: wakeChk.checked,
                    penOnlyDefault: penChk.checked,
                    soundFxDefault: sfxChk ? sfxChk.checked : true,
                    hangulGuideEnabled: hangulChk ? hangulChk.checked : true,
                    kidAlbumShareEnabled: albumChk ? albumChk.checked : true,
                    pokemonColoringEnabled: pokeColorChk ? pokeColorChk.checked : true
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '저장에 실패했습니다.');
            syncTabletBadge(data.config);
            toast(data.message || '태블릿 앱 설정이 저장되었습니다.');
        } catch (err) {
            toast(err.message || '태블릿 앱 설정 저장에 실패했습니다.', true);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function copyStudyTabletUrl(kind) {
        const url = kind === 'lan' ? latestTabletUrls.lanLoginUrl : latestTabletUrls.extLoginUrl;
        if (!url) {
            toast('복사할 태블릿 전용 주소가 아직 준비되지 않았습니다.', true);
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            toast(kind === 'lan'
                ? '내부 빠른 HTTPS 로그인 주소(/study/login)를 복사했습니다.'
                : '외부 태블릿 로그인 주소(/study/login)를 복사했습니다.');
        } catch (_) {
            toast(`주소: ${url}`);
        }
    }

    if (typeof window.loadAdminStudyOverview === 'function') {
        const origLoad = window.loadAdminStudyOverview;
        window.loadAdminStudyOverview = async function () {
            const result = await origLoad.apply(this, arguments);
            await loadStudyTabletConfigPanel();
            return result;
        };
    }

    window.loadStudyTabletConfigPanel = loadStudyTabletConfigPanel;
    window.saveStudyTabletConfig = saveStudyTabletConfig;
    window.copyStudyTabletUrl = copyStudyTabletUrl;
    window.loadAdminStudyArtworks = loadAdminStudyArtworks;
    window.shareAdminStudyArtwork = shareAdminStudyArtwork;
    window.deleteAdminStudyArtwork = deleteAdminStudyArtwork;
})();
