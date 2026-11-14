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
        const wakeText = cfg.wakeLockDefault ? '💡 화면 유지 기본 켜짐' : '🌙 화면 유지 기본 꺼짐';
        const penText = cfg.penOnlyDefault ? '🖊️ S펜 전용 기본' : '🖐️ 손·펜 자동';
        badgeEl.textContent = `${wakeText} · ${penText}`;
    }

    async function loadStudyTabletConfigPanel() {
        const panel = document.getElementById('studyTabletPwaPanel');
        if (!panel) return;
        try {
            const res = await fetch('/api/admin/study/tablet-config', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) return;

            const cfg = data.config || { wakeLockDefault: true, penOnlyDefault: false };
            latestTabletUrls = data.urls || latestTabletUrls;

            const wakeChk = document.getElementById('chkTabletWakeLockDefault');
            const penChk = document.getElementById('chkTabletPenOnlyDefault');
            if (wakeChk) wakeChk.checked = Boolean(cfg.wakeLockDefault);
            if (penChk) penChk.checked = Boolean(cfg.penOnlyDefault);

            const extEl = document.getElementById('studyTabletExtLoginText');
            const lanEl = document.getElementById('studyTabletLanLoginText');
            const lanBtn = document.getElementById('btnCopyStudyPwaLanUrl');
            if (extEl) extEl.textContent = latestTabletUrls.extLoginUrl || 'https://j-jg.cc/study/login';
            if (lanEl) lanEl.textContent = latestTabletUrls.lanLoginUrl || '내부 HTTPS 주소 확인 중';
            if (lanBtn) lanBtn.disabled = !latestTabletUrls.lanLoginUrl;

            syncTabletBadge(cfg);
        } catch (_) { /* ignore transient error */ }
    }

    async function saveStudyTabletConfig() {
        const wakeChk = document.getElementById('chkTabletWakeLockDefault');
        const penChk = document.getElementById('chkTabletPenOnlyDefault');
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
                    penOnlyDefault: penChk.checked
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
})();
