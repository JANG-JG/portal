/**
 * ==============================================================================
 * 알림 비서 텔레그램 양방향 제어 & 포털 대시보드 위젯 관리자 모듈
 * (admin-study-interactive.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 On/Off 제어
 * ==============================================================================
 */
(function () {
    'use strict';

    function notify(msg, isError = false) {
        if (typeof studyToast === 'function') return studyToast(msg, isError);
        if (typeof showToast === 'function') return showToast(msg, isError ? 'error' : 'success');
        if (isError) console.error(msg);
    }

    function applyInteractiveConfig(cfg) {
        if (!cfg) return;
        const map = [
            ['studyInteractiveAiChk', 'telegramAiEnabled'],
            ['studyInteractiveBloodChk', 'telegramBloodAlertEnabled'],
            ['studyInteractiveStudyChk', 'telegramStudyNotifyEnabled'],
            ['studyInteractiveWidgetChk', 'portalStudyBuddyWidgetEnabled']
        ];
        map.forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el && typeof cfg[key] === 'boolean') el.checked = cfg[key];
        });

        const badge = document.getElementById('studyInteractiveStateBadge');
        if (badge) {
            const aiText = cfg.telegramAiEnabled ? '🤖 AI 켜짐' : '🤖 AI 꺼짐';
            const bloodText = cfg.telegramBloodAlertEnabled ? '💊 약 알림 켜짐' : '💊 약 알림 꺼짐';
            const studyText = cfg.telegramStudyNotifyEnabled ? '🎒 학습 알림 켜짐' : '🎒 학습 알림 꺼짐';
            const widgetText = cfg.portalStudyBuddyWidgetEnabled ? '✨ 포털 위젯 켜짐' : '✨ 포털 위젯 꺼짐';
            badge.textContent = `${aiText} · ${bloodText} · ${studyText} · ${widgetText}`;
        }
    }

    async function loadStudyInteractiveConfig() {
        const panel = document.getElementById('studyInteractiveConfigPanel');
        if (!panel) return;
        try {
            const res = await fetch('/api/admin/study/interactive-config', { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok || !data.success) return;
            applyInteractiveConfig(data.config);
        } catch (err) {
            console.warn('[AdminStudyInteractive] 설정 로드 실패:', err.message);
        }
    }

    async function saveStudyInteractiveConfig(event) {
        if (event) event.preventDefault();
        const saveBtn = document.getElementById('studyInteractiveSaveBtn');
        const payload = {
            telegramAiEnabled: Boolean(document.getElementById('studyInteractiveAiChk')?.checked),
            telegramBloodAlertEnabled: Boolean(document.getElementById('studyInteractiveBloodChk')?.checked),
            telegramStudyNotifyEnabled: Boolean(document.getElementById('studyInteractiveStudyChk')?.checked),
            portalStudyBuddyWidgetEnabled: Boolean(document.getElementById('studyInteractiveWidgetChk')?.checked)
        };
        if (saveBtn) saveBtn.disabled = true;
        try {
            const res = await fetch('/api/admin/study/interactive-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '저장에 실패했습니다.');
            applyInteractiveConfig(data.config);
            notify(data.message || '양방향 텔레그램·대시보드 설정이 저장되었습니다.');
        } catch (err) {
            notify(err.message || '설정 저장 중 오류가 발생했습니다.', true);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    if (typeof window.loadAdminStudyOverview === 'function') {
        const origLoad = window.loadAdminStudyOverview;
        window.loadAdminStudyOverview = async function () {
            const result = await origLoad.apply(this, arguments);
            await loadStudyInteractiveConfig();
            return result;
        };
    }

    window.loadStudyInteractiveConfig = loadStudyInteractiveConfig;
    window.saveStudyInteractiveConfig = saveStudyInteractiveConfig;
})();
