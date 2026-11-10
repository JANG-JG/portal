/**
 * 🤖 관리자 뉴스 AI 요약·속보 관제 & 포털 AI 비서 감사 로그 컨트롤러 (admin-ai-news-audit.js)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

(function () {
    'use strict';

    function safeEsc(str) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(String(str ?? ''));
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const TOOL_KO_LABELS = {
        get_weather: '날씨',
        get_market_indicators: '증시·환율',
        get_news_top: '주요 뉴스',
        get_family_wiki: '가족 위키',
        get_family_photos: '가족 사진첩',
        get_family_calendar: '가족 일정',
        get_personal_calendar: '개인 일정',
        get_personal_memos: '메모장',
        get_blood_records: '혈압·복약',
        get_asset_summary: '금융 자산',
        get_system_status: '서버 상태',
        memo_to_wiki: '메모→위키'
    };

    function formatToolLabels(rawTools) {
        if (!rawTools) return '<span style="color:#94a3b8;">일반 대화</span>';
        return String(rawTools)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(t => `<span style="display:inline-block; background:#f1f5f9; color:#334155; border-radius:4px; padding:1px 6px; font-size:0.72rem; margin:1px;">${safeEsc(TOOL_KO_LABELS[t] || t)}</span>`)
            .join(' ');
    }

    /**
     * 1. 뉴스룸 AI 3줄 요약 추론 통계 · 속보 클러스터링 · 텔레그램 이력 로드
     */
    async function loadNewsAiGovernance() {
        try {
            const res = await fetch('/api/admin/news/ai-governance');
            const data = await res.json();
            if (!data.success) return;

            const st = data.summaryStats || {};
            const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setTxt('newsStatOllamaCount', `${(st.ollamaCount || 0).toLocaleString()}건`);
            setTxt('newsStatOllamaAvg', st.avgOllamaMs ? `평균 ${(st.avgOllamaMs / 1000).toFixed(1)}초` : '기록 대기');
            setTxt('newsStatGeminiCount', `${(st.geminiCount || 0).toLocaleString()}건`);
            setTxt('newsStatGeminiAvg', st.avgGeminiMs ? `평균 ${(st.avgGeminiMs / 1000).toFixed(1)}초` : '기록 대기');
            setTxt('newsStatTextrankCount', `${(st.textrankCount || 0).toLocaleString()}건`);

            const q = st.geminiQuota || { count: 0, limit: 2000, date: '-' };
            setTxt('newsStatGeminiQuota', `${(q.count || 0).toLocaleString()} / ${(q.limit || 2000).toLocaleString()}회`);
            setTxt('newsStatGeminiQuotaDate', q.date && q.date !== '-' ? `기준일: ${q.date}` : '오늘 호출 없음');

            // 텔레그램 발송 이력
            const fmtKst = typeof window.formatAdminKst === 'function'
                ? window.formatAdminKst
                : (v, m) => String(v || '-').replace('T', ' ').slice(m === 'short' ? 5 : 0, m === 'short' ? 19 : 16);
            const tgBody = document.getElementById('newsTelegramHistoryBody');
            if (tgBody) {
                const tgRows = Array.isArray(data.telegramHistory) ? data.telegramHistory : [];
                tgBody.innerHTML = tgRows.length === 0
                    ? '<tr><td colspan="4" style="text-align:center; padding:1rem; color:#94a3b8;">텔레그램 브리핑 발송 기록이 아직 없습니다.</td></tr>'
                    : tgRows.map(r => {
                        const ok = Number(r.telegram_sent) === 1;
                        const statusLabel = r.status === 'TELEGRAM_TEST' ? '수동 점검' : (r.status === 'TELEGRAM_FAIL' ? '점검 실패' : '정기·수동 브리핑');
                        return `
                            <tr>
                                <td style="font-size:0.78rem; color:#64748b; white-space:nowrap;">${safeEsc(fmtKst(r.run_at, 'minute'))}</td>
                                <td style="font-size:0.8rem; font-weight:600;">${safeEsc(statusLabel)}</td>
                                <td>${ok ? '<span class="badge badge-success">발송 성공 ✅</span>' : '<span class="badge badge-danger" style="background:#fee2e2; color:#b91c1c;">실패</span>'}</td>
                                <td style="font-size:0.8rem; color:#334155; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeEsc(r.details)}">${safeEsc(r.details || '-')}</td>
                            </tr>
                        `;
                    }).join('');
            }

            // 속보 및 클러스터링 현황
            const brk = data.breaking || {};
            const brkBadge = document.getElementById('newsActiveBreakingBadge');
            if (brkBadge) {
                brkBadge.textContent = `현재 화면 속보 ${(brk.activeCount || 0)}건 · 당일 이슈 묶음 ${(brk.multiClusterCount || 0)}개`;
            }

            const clusterBody = document.getElementById('newsTopClustersBody');
            if (clusterBody) {
                const clusters = Array.isArray(brk.topClusters) ? brk.topClusters : [];
                clusterBody.innerHTML = clusters.length === 0
                    ? '<tr><td colspan="4" style="text-align:center; padding:1rem; color:#94a3b8;">당일 묶인 중복 이슈 기사가 없습니다.</td></tr>'
                    : clusters.map(c => `
                        <tr>
                            <td><span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.73rem; font-weight:700; white-space:nowrap;">${safeEsc(c.category)}</span></td>
                            <td style="max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.82rem;" title="${safeEsc(c.leadTitle)}">
                                <strong>[${safeEsc(c.leadMedia || '언론사')}]</strong> ${safeEsc(c.leadTitle)}
                            </td>
                            <td style="font-weight:700; color:#2563eb; white-space:nowrap;">${c.articleCount}건</td>
                            <td style="font-size:0.78rem; font-weight:700; color:#059669; white-space:nowrap;">${c.leadScore}점</td>
                        </tr>
                    `).join('');
            }

            const pushBody = document.getElementById('newsBreakingPushBody');
            if (pushBody) {
                const pushes = Array.isArray(brk.pushLogs) ? brk.pushLogs : [];
                pushBody.innerHTML = pushes.length === 0
                    ? '<tr><td colspan="2" style="text-align:center; padding:1rem; color:#94a3b8;">최근 48시간 내 발송된 속보 웹 푸시가 없습니다.</td></tr>'
                    : pushes.map(p => `
                        <tr>
                            <td style="font-size:0.76rem; color:#64748b; white-space:nowrap;">${safeEsc(fmtKst(p.pushed_at, 'minute'))}</td>
                            <td style="font-size:0.82rem; color:#1e293b; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeEsc(p.title)}">${safeEsc(p.title)}</td>
                        </tr>
                    `).join('');
            }

            // AI 3줄 요약 상세 로그
            const logsBody = document.getElementById('newsAiSummaryLogsBody');
            if (logsBody) {
                const logs = Array.isArray(data.summaryLogs) ? data.summaryLogs : [];
                logsBody.innerHTML = logs.length === 0
                    ? '<tr><td colspan="5" style="text-align:center; padding:1.2rem; color:#94a3b8;">신규 기사 요약 실행 시 추론 엔진 기록이 이곳에 쌓입니다.</td></tr>'
                    : logs.map(l => {
                        let engineBadge = '<span style="background:#f1f5f9; color:#475569; padding:2px 7px; border-radius:999px; font-size:0.73rem; font-weight:700;">TextRank</span>';
                        if (l.engine === 'ollama') {
                            engineBadge = '<span style="background:#dcfce7; color:#166534; padding:2px 7px; border-radius:999px; font-size:0.73rem; font-weight:700;">로컬 Ollama</span>';
                        } else if (l.engine === 'gemini') {
                            engineBadge = '<span style="background:#dbeafe; color:#1e40af; padding:2px 7px; border-radius:999px; font-size:0.73rem; font-weight:700;">Gemini 폴백</span>';
                        }
                        const secText = l.duration_ms ? `${(l.duration_ms / 1000).toFixed(2)}초` : '0.01초';
                        return `
                            <tr>
                                <td style="font-size:0.77rem; color:#64748b; white-space:nowrap;">${safeEsc(fmtKst(l.created_at, 'short'))}</td>
                                <td>${engineBadge}</td>
                                <td style="font-size:0.78rem; font-weight:600; color:#334155; white-space:nowrap;">${safeEsc(l.model || '-')}</td>
                                <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.83rem;" title="${safeEsc(l.article_title)}">${safeEsc(l.article_title || '-')}</td>
                                <td style="font-size:0.78rem; color:#475569; white-space:nowrap;">${secText}</td>
                            </tr>
                        `;
                    }).join('');
            }
        } catch (err) {
            console.error('[admin-ai-news-audit] 뉴스 AI 관제 조회 실패:', err);
        }
    }

    /**
     * 2. 뉴스 브리핑 텔레그램 연결 단독 테스트 발송
     */
    async function testNewsTelegramBriefing() {
        try {
            const res = await fetch('/api/admin/news/test-telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (typeof window.showToast === 'function') {
                window.showToast(data.message || (data.success ? '테스트 발송 성공' : '발송 실패'), data.success ? 'success' : 'error');
            } else {
                alert(data.message || (data.success ? '테스트 발송 성공' : '발송 실패'));
            }
            loadNewsAiGovernance();
        } catch (err) {
            alert('뉴스 텔레그램 테스트 요청 중 오류가 발생했습니다: ' + err.message);
        }
    }

    /**
     * 3. 포털 AI 비서 비식별 대화·라우팅 감사 로그 조회
     */
    async function loadAdminAiAuditLogs() {
        try {
            const res = await fetch('/api/admin/ai/audit-logs?limit=60');
            const data = await res.json();
            if (!data.success) return;

            const st = data.stats || {};
            const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setTxt('aiAuditTotalCount', `${(st.totalCount || 0).toLocaleString()}건 (오늘 ${(st.todayCount || 0)}건)`);
            setTxt('aiAuditChatCount', `${(st.chatCount || 0).toLocaleString()}건`);
            setTxt('aiAuditBalancedCount', `${(st.balancedCount || 0).toLocaleString()}건`);
            setTxt('aiAuditReasoningCount', `${(st.reasoningCount || 0).toLocaleString()}건`);
            setTxt('aiAuditAvgDuration', st.avgDurationMs ? `${(st.avgDurationMs / 1000).toFixed(1)}초` : '-');

            const tbody = document.getElementById('adminAiAuditTableBody');
            if (!tbody) return;
            const rows = Array.isArray(data.logs) ? data.logs : [];
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.25rem; color:#94a3b8;">기록된 AI 질문 감사 로그가 아직 없습니다.</td></tr>';
                return;
            }

            const modeBadgeMap = {
                chat: '<span style="background:#dcfce7; color:#166534; padding:2px 7px; border-radius:999px; font-size:0.72rem; font-weight:700;">⚡ 빠른 1B</span>',
                balanced: '<span style="background:#dbeafe; color:#1e40af; padding:2px 7px; border-radius:999px; font-size:0.72rem; font-weight:700;">⚖️ 균형 4B</span>',
                reasoning: '<span style="background:#ede9fe; color:#5b21b6; padding:2px 7px; border-radius:999px; font-size:0.72rem; font-weight:700;">🧠 깊은 생각</span>',
                policy: '<span style="background:#fee2e2; color:#991b1b; padding:2px 7px; border-radius:999px; font-size:0.72rem; font-weight:700;">🛡️ 권한 보호</span>'
            };

            const fmtAudit = typeof window.formatAdminKst === 'function'
                ? (v) => window.formatAdminKst(v, 'short')
                : (v) => String(v || '-').replace('T', ' ').slice(5, 19);
            tbody.innerHTML = rows.map(r => {
                const modeBadge = modeBadgeMap[r.routed_mode] || `<span class="badge">${safeEsc(r.routed_mode)}</span>`;
                const durText = r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}초` : '-';
                const stBadge = r.status === 'SUCCESS'
                    ? '<span class="badge badge-success">정상</span>'
                    : (r.status === 'BLOCKED'
                        ? '<span style="background:#fef3c7; color:#92400e; padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:700;">권한 차단</span>'
                        : '<span style="background:#fee2e2; color:#b91c1c; padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:700;">오류</span>');
                return `
                    <tr>
                        <td style="font-size:0.77rem; color:#64748b; white-space:nowrap;">${safeEsc(fmtAudit(r.created_at))}</td>
                        <td style="font-size:0.8rem; font-weight:600; white-space:nowrap;">${safeEsc(r.actor_label || '가족')}</td>
                        <td style="white-space:nowrap;">${modeBadge} <span style="font-size:0.75rem; color:#475569; margin-left:3px;">${safeEsc(r.model || '')}</span></td>
                        <td>${formatToolLabels(r.tools_used)}</td>
                        <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.82rem; color:#1e293b;" title="${safeEsc(r.masked_preview)}">
                            ${safeEsc(r.masked_preview || '-')} <span style="color:#94a3b8; font-size:0.73rem;">(${r.prompt_chars || 0}자)</span>
                        </td>
                        <td style="font-size:0.78rem; color:#475569; white-space:nowrap;">${durText}</td>
                        <td style="white-space:nowrap;">${stBadge}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('[admin-ai-news-audit] AI 감사 로그 로드 실패:', err);
        }
    }

    window.loadNewsAiGovernance = loadNewsAiGovernance;
    window.testNewsTelegramBriefing = testNewsTelegramBriefing;
    window.loadAdminAiAuditLogs = loadAdminAiAuditLogs;
})();
