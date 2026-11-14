/**
 * ==============================================================================
 * 아이 학습실 AI 사전 생성 & TTS 워밍 관리자 제어 모듈 (admin-study-pregen.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화 | [규칙 11] 관리자 통합 제어
 * ==============================================================================
 */

(function () {
    'use strict';

    let latestPreGenEnabled = true;

    function esc(v) {
        if (typeof escStudyAdmin === 'function') return escStudyAdmin(v);
        return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function toast(msg, isError = false) {
        if (typeof studyToast === 'function') return studyToast(msg, isError);
        if (typeof showToast === 'function') return showToast(msg, isError ? 'error' : 'success');
    }

    function formatBytes(bytes) {
        const num = Number(bytes || 0);
        if (num < 1024) return `${num}B`;
        if (num < 1048576) return `${(num / 1024).toFixed(1)}KB`;
        return `${(num / 1048576).toFixed(1)}MB`;
    }

    function renderStudyPreGenPanel(pregen) {
        const badgeEl = document.getElementById('studyPreGenStateBadge');
        const toggleBtn = document.getElementById('btnStudyPreGenToggle');
        const warmupBtn = document.getElementById('btnStudyPreGenWarmup');
        const summaryEl = document.getElementById('studyPreGenSummaryText');
        const gridEl = document.getElementById('studyPreGenSlotGrid');
        if (!badgeEl || !pregen) return;

        latestPreGenEnabled = Boolean(pregen.enabled);
        const ttsFiles = pregen.ttsCache?.fileCount || 0;
        const ttsBytes = formatBytes(pregen.ttsCache?.totalBytes || 0);

        if (pregen.running) {
            badgeEl.textContent = '⏳ 준비 중';
            badgeEl.style.color = '#d97706';
        } else if (pregen.enabled) {
            badgeEl.textContent = `✅ 켜짐 (${pregen.totalQueued || 0}장 대기)`;
            badgeEl.style.color = '#059669';
        } else {
            badgeEl.textContent = '⏸️ 일시 중지';
            badgeEl.style.color = '#64748b';
        }

        if (toggleBtn) {
            toggleBtn.textContent = pregen.enabled ? '⏸️ 사전 생성 끄기' : '▶️ 사전 생성 켜기';
        }
        if (warmupBtn) {
            warmupBtn.disabled = !pregen.enabled || Boolean(pregen.running);
            warmupBtn.textContent = pregen.running ? '⏳ 빈 슬롯 채우는 중...' : '🚀 지금 빈 슬롯 미리 채우기';
        }
        if (summaryEl) {
            const lastText = pregen.lastSummary
                ? `최근 실행(${pregen.lastRunAt || '-'}): ${pregen.lastSummary}`
                : '매일 오전 6:20 자동 점검 · 기본 테마(동물 친구) 1장씩 대기';
            summaryEl.textContent = `${lastText} | 🔊 음성 캐시 ${ttsFiles}개 (${ttsBytes})`;
        }

        if (gridEl) {
            const children = Array.isArray(pregen.byChild) ? pregen.byChild : [];
            const subjects = [['korean', '한글'], ['math', '수학'], ['english', '영어']];
            gridEl.innerHTML = children.map((c) => {
                const pills = subjects.map(([k, label]) => {
                    const slot = c.slots?.[k] || {};
                    const ready = (slot.count || 0) > 0;
                    const bg = ready ? '#dcfce7' : '#f1f5f9';
                    const fg = ready ? '#166534' : '#64748b';
                    const lvl = slot.level ? ` Lv.${slot.level}` : '';
                    return `<span style="background:${bg}; color:${fg}; padding:2px 8px; border-radius:999px; font-size:0.74rem; font-weight:700;">${esc(label)}${esc(lvl)} ${ready ? '준비됨' : '비어있음'}</span>`;
                }).join(' ');
                return `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:0.55rem; padding:0.55rem 0.7rem; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0.4rem;">
                    <span style="font-size:0.82rem; font-weight:700; color:#0f172a;">${esc(c.avatarEmoji || '🌟')} ${esc(c.displayName)}</span>
                    <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">${pills}</div>
                </div>`;
            }).join('');
        }
    }

    async function refreshAdminStudyPreGen() {
        try {
            const res = await fetch('/api/admin/study/pregen', { credentials: 'same-origin' });
            const data = await res.json();
            if (data.success && data.pregen) renderStudyPreGenPanel(data.pregen);
        } catch (e) {}
    }

    async function toggleAdminStudyPreGen() {
        try {
            const res = await fetch('/api/admin/study/pregen/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ enabled: !latestPreGenEnabled })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '변경 실패');
            toast(data.message || '설정이 변경되었습니다.');
            if (data.pregen) renderStudyPreGenPanel(data.pregen);
            if (!latestPreGenEnabled) return;
            setTimeout(refreshAdminStudyPreGen, 3500);
        } catch (err) {
            toast(err.message || '사전 생성 설정 변경 실패', true);
        }
    }

    async function triggerAdminStudyWarmup() {
        try {
            const res = await fetch('/api/admin/study/pregen/warmup', {
                method: 'POST',
                credentials: 'same-origin'
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '실행 실패');
            toast(data.message || '백그라운드 사전 생성을 시작했습니다.');
            if (data.pregen) renderStudyPreGenPanel(data.pregen);
            setTimeout(refreshAdminStudyPreGen, 3500);
            setTimeout(refreshAdminStudyPreGen, 8500);
        } catch (err) {
            toast(err.message || '사전 생성 실행 실패', true);
        }
    }

    Object.assign(window, {
        renderStudyPreGenPanel,
        refreshAdminStudyPreGen,
        toggleAdminStudyPreGen,
        triggerAdminStudyWarmup
    });
})();
