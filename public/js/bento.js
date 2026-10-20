/**
 * 🍱 JG Clean Bento Grid Dashboard Interactive Controller (bento.js)
 * - Benchmark: Linear, Raycast (Minimal Monochrome Engineering)
 * - High density, tabular numerals, zero emojis, clean 1px data tables
 */
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        loadBentoDashboardData();
        loadRecentMemoData();
        loadServerOverview();
    });

    // 1. 메인 요약 데이터 (/api/summary) 비동기 로드
    async function loadBentoDashboardData() {
        try {
            const res = await fetch('/api/summary');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success) return;

            bindWelcomeWeather(data.weather);
            bindBloodCard(data.blood);
            bindAssetCard(data.asset);
            bindNewsFeed(data.news);
            bindScheduleCard(data.hospital, data.medication);
        } catch (err) {
            console.warn('[Bento] 요약 데이터 로드 실패:', err);
        }
    }

    // 2. 날씨 바인딩
    function bindWelcomeWeather(w) {
        if (!w) return;
        const cityEl = document.getElementById('bentoWeatherCity');
        const tempEl = document.getElementById('bentoWeatherTemp');
        const descEl = document.getElementById('bentoWeatherDesc');

        if (cityEl && w.city) cityEl.textContent = w.city;
        if (tempEl && w.temp) tempEl.textContent = `${w.temp}°C`;
        if (descEl && w.desc) descEl.textContent = w.desc;
    }

    // 3. 혈압 & 생체 지표 바인딩
    function bindBloodCard(b) {
        const sysEl = document.getElementById('bentoBloodSys');
        const diaEl = document.getElementById('bentoBloodDia');
        const pulseEl = document.getElementById('bentoBloodPulse');
        const badgeEl = document.getElementById('bentoBloodBadge');
        const badgeTextEl = document.getElementById('bentoBloodBadgeText');
        const timeEl = document.getElementById('bentoBloodTime');

        if (b && b.systolic && b.diastolic) {
            if (sysEl) sysEl.textContent = b.systolic;
            if (diaEl) diaEl.textContent = b.diastolic;
            if (pulseEl) pulseEl.textContent = b.pulse || '72';

            if (timeEl && b.measured_at) {
                const parts = b.measured_at.split(' ');
                timeEl.textContent = parts[0] ? `${parts[0].slice(5)} ${parts[1] ? parts[1].slice(0, 5) : ''}` : b.measured_at;
            }

            if (badgeEl && b.grade) {
                const gradeKey = b.grade.key || 'normal';
                badgeEl.className = 'bento-tag';

                let label = 'NORMAL';
                if (gradeKey === 'high' || gradeKey === 'high2' || gradeKey === 'crisis') {
                    badgeEl.classList.add('tag-rose');
                    label = 'ELEVATED / HIGH';
                } else if (gradeKey === 'pre' || gradeKey === 'caution') {
                    badgeEl.classList.add('tag-amber');
                    label = 'PRE-HYPERTENSION';
                } else {
                    badgeEl.classList.add('tag-emerald');
                    label = 'NORMAL';
                }

                if (badgeTextEl) badgeTextEl.textContent = label;
            }
        }
    }

    // 4. 자산 카드 바인딩
    function bindAssetCard(a) {
        const numEl = document.getElementById('bentoAssetNumber');
        const rateEl = document.getElementById('bentoAssetRate');
        const dateEl = document.getElementById('bentoAssetDate');

        if (a) {
            if (numEl) {
                const val = typeof a.total_net_assets === 'number' 
                    ? a.total_net_assets.toLocaleString('ko-KR')
                    : (a.formatted_total || '0');
                numEl.textContent = val;
            }

            if (rateEl && a.previous_month_change_rate !== undefined && a.previous_month_change_rate !== null) {
                const rate = Number(a.previous_month_change_rate);
                const isPlus = rate >= 0;
                rateEl.textContent = `${isPlus ? '+' : ''}${rate.toFixed(1)}% MoM`;
                rateEl.className = isPlus ? 'asset-diff-up font-mono' : 'asset-diff-down font-mono';
            }

            if (dateEl && a.last_snapshot_date) {
                dateEl.textContent = `Snapshot: ${a.last_snapshot_date}`;
            }
        }
    }

    // 5. 실시간 뉴스 피드 바인딩 (Linear Table Row Style)
    function bindNewsFeed(n) {
        const listEl = document.getElementById('bentoNewsList');
        if (!listEl || !n) return;

        const articles = n.recommendedArticles || [];
        if (articles.length === 0) {
            listEl.innerHTML = '<div style="font-size:0.75rem; color:#71717a; padding:0.75rem;">No dispatch feeds available.</div>';
            return;
        }

        listEl.innerHTML = articles.slice(0, 4).map(a => {
            const timeStr = formatRelativeTime(a.published_at);
            const source = (a.source || a.media || 'PRESS').toUpperCase();
            return `
                <a href="${a.link || 'https://news.j-jg.cc'}" target="_blank" rel="noopener noreferrer" class="bento-table-row">
                    <div class="bento-row-main">
                        <span class="bento-source-tag">${escapeHtml(source)}</span>
                        <span class="bento-row-title">${escapeHtml(a.title || '')}</span>
                    </div>
                    <span class="bento-row-time">${timeStr}</span>
                </a>
            `;
        }).join('');
    }

    // 6. 캘린더 & D-Day 일정 바인딩
    function bindScheduleCard(h, med) {
        const ddayBadge = document.getElementById('bentoHospitalDDay');
        const nextDateEl = document.getElementById('bentoHospitalNextDate');
        const remainDaysEl = document.getElementById('bentoHospitalRemain');
        const medStatusEl = document.getElementById('bentoMedicationStatus');

        if (h) {
            if (ddayBadge && h.dday) {
                ddayBadge.textContent = h.dday;
                ddayBadge.className = 'bento-tag';
                if (h.dday.includes('Day') || h.dday.includes('D-0') || h.dday.includes('D-1')) {
                    ddayBadge.classList.add('tag-rose');
                } else if (h.dday.startsWith('D-') && parseInt(h.dday.replace('D-', ''), 10) <= 7) {
                    ddayBadge.classList.add('tag-amber');
                } else {
                    ddayBadge.classList.add('tag-emerald');
                }
            }

            if (nextDateEl && h.next_visit_date) {
                nextDateEl.textContent = `정기 진료: ${h.next_visit_date}`;
            }

            if (remainDaysEl && h.remaining_days !== undefined) {
                remainDaysEl.textContent = `잔여 처방약: ${h.remaining_days}일분`;
            }
        }

        if (med && medStatusEl) {
            medStatusEl.textContent = med.is_today_taken ? 'COMPLETED' : 'PENDING SCHEDULE';
            medStatusEl.style.color = med.is_today_taken ? 'var(--status-emerald)' : 'var(--text-muted)';
        }
    }

    // 7. 최근 메모 바인딩
    async function loadRecentMemoData() {
        const memoTextEl = document.getElementById('bentoMemoPreview');
        const memoDateEl = document.getElementById('bentoMemoDate');
        if (!memoTextEl) return;

        try {
            const res = await fetch('/api/memos');
            if (!res.ok) return;
            const data = await res.json();
            const list = data.memos || data.data || (Array.isArray(data) ? data : []);
            if (list.length > 0) {
                const latest = list[0];
                const rawContent = (latest.content || latest.title || '').replace(/<[^>]*>?/gm, '').trim();
                memoTextEl.textContent = rawContent || 'No memo content recorded.';
                if (memoDateEl && latest.updated_at) {
                    memoDateEl.textContent = latest.updated_at.slice(0, 10);
                }
            } else {
                memoTextEl.textContent = 'Ready for scratchpad inputs...';
            }
        } catch (e) {
            memoTextEl.textContent = 'Scratchpad available at /memo';
        }
    }

    // 8. 서버 관제 요약 바인딩
    async function loadServerOverview() {
        const cpuEl = document.getElementById('bentoServerCpu');
        const ramEl = document.getElementById('bentoServerRam');
        try {
            const res = await fetch('/api/admin/system/status');
            if (res.ok) {
                const data = await res.json();
                if (data.cpu !== undefined && cpuEl) cpuEl.textContent = `${data.cpu}%`;
                if (data.memory && ramEl) ramEl.textContent = `${data.memory.usagePercent || data.memory.percent || 46.8}%`;
            }
        } catch (e) {
            // 기본값 유지
        }
    }

    // 헬퍼: 상대 시간 포맷
    function formatRelativeTime(dateStr) {
        if (!dateStr) return 'now';
        try {
            const date = new Date(dateStr.replace(' ', 'T'));
            const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
            if (diffSec < 60) return 'now';
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
            if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
            return `${Math.floor(diffSec / 86400)}d ago`;
        } catch (e) {
            return 'recent';
        }
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
