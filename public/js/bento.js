/**
 * 🍱 JG Clean Bento Grid Dashboard Interactive Controller (bento.js)
 * - Fetches live data from /api/summary, /api/memos, etc.
 * - Updates Bento Cards with real-time health, asset, news, schedule, and server stats
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
            bindBloodCard(data.blood, data.medication);
            bindAssetCard(data.asset);
            bindNewsFeed(data.news);
            bindScheduleCard(data.hospital, data.medication);
        } catch (err) {
            console.warn('[Bento] 요약 데이터 로드 실패:', err);
        }
    }

    // 2. 날씨 & 환영 배지 바인딩
    function bindWelcomeWeather(w) {
        if (!w) return;
        const iconEl = document.getElementById('bentoWeatherIcon');
        const cityEl = document.getElementById('bentoWeatherCity');
        const tempEl = document.getElementById('bentoWeatherTemp');
        const descEl = document.getElementById('bentoWeatherDesc');

        if (iconEl && w.icon) iconEl.textContent = w.icon;
        if (cityEl && w.city) cityEl.textContent = w.city;
        if (tempEl && w.temp) tempEl.textContent = `${w.temp}°`;
        if (descEl && w.desc) descEl.textContent = w.desc;
    }

    // 3. 혈압 & 건강 카드 바인딩
    function bindBloodCard(b, med) {
        const sysEl = document.getElementById('bentoBloodSys');
        const diaEl = document.getElementById('bentoBloodDia');
        const pulseEl = document.getElementById('bentoBloodPulse');
        const badgeEl = document.getElementById('bentoBloodBadge');
        const timeEl = document.getElementById('bentoBloodTime');

        if (b && b.systolic && b.diastolic) {
            if (sysEl) sysEl.textContent = b.systolic;
            if (diaEl) diaEl.textContent = b.diastolic;
            if (pulseEl) pulseEl.textContent = b.pulse || '-';

            if (timeEl && b.measured_at) {
                const parts = b.measured_at.split(' ');
                timeEl.textContent = parts[0] ? `${parts[0].slice(5)} 측정` : b.measured_at;
            }

            if (badgeEl && b.grade) {
                badgeEl.textContent = b.grade.label || b.grade.name || '정상 혈압';
                badgeEl.className = 'bento-badge';
                if (b.grade.key === 'high' || b.grade.key === 'high2' || b.grade.key === 'crisis') {
                    badgeEl.classList.add('bento-badge-rose');
                } else if (b.grade.key === 'pre' || b.grade.key === 'elevated') {
                    badgeEl.classList.add('bento-badge-amber');
                } else {
                    badgeEl.classList.add('bento-badge-emerald');
                }
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
                // 천단위 콤마 포맷
                const val = typeof a.total_net_assets === 'number' 
                    ? a.total_net_assets.toLocaleString('ko-KR')
                    : (a.formatted_total || '-');
                numEl.textContent = val;
            }

            if (rateEl && a.previous_month_change_rate !== undefined && a.previous_month_change_rate !== null) {
                const rate = Number(a.previous_month_change_rate);
                const isPlus = rate >= 0;
                rateEl.textContent = `${isPlus ? '+' : ''}${rate.toFixed(1)}% 전월대비`;
                rateEl.className = `bento-asset-rate font-mono ${isPlus ? 'rate-up' : 'rate-down'}`;
            }

            if (dateEl && a.last_snapshot_date) {
                dateEl.textContent = `${a.last_snapshot_date} 기준`;
            }
        }
    }

    // 5. 실시간 뉴스 피드 바인딩
    function bindNewsFeed(n) {
        const listEl = document.getElementById('bentoNewsList');
        if (!listEl || !n) return;

        const articles = n.recommendedArticles || [];
        if (articles.length === 0) {
            listEl.innerHTML = '<div style="font-size:0.8rem; color:#94a3b8; padding:0.5rem 0;">최신 뉴스를 불러오는 중입니다...</div>';
            return;
        }

        listEl.innerHTML = articles.slice(0, 3).map(a => {
            const timeStr = formatRelativeTime(a.published_at);
            return `
                <a href="${a.link || 'https://news.j-jg.cc'}" target="_blank" rel="noopener noreferrer" class="bento-news-item">
                    <div class="bento-news-content">
                        <div class="bento-news-title">${escapeHtml(a.title || '')}</div>
                        <div class="bento-news-meta">
                            <span class="bento-news-media">${escapeHtml(a.source || a.media || '주요 언론')}</span>
                            <span>•</span>
                            <span class="bento-news-time font-mono">${timeStr}</span>
                        </div>
                    </div>
                    <span style="color:#94a3b8; font-size:0.8rem; font-weight:700;">↗</span>
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
                ddayBadge.className = 'bento-badge';
                if (h.dday.includes('Day') || h.dday.includes('D-0') || h.dday.includes('D-1')) {
                    ddayBadge.classList.add('bento-badge-rose');
                } else if (h.dday.startsWith('D-') && parseInt(h.dday.replace('D-', ''), 10) <= 7) {
                    ddayBadge.classList.add('bento-badge-amber');
                } else {
                    ddayBadge.classList.add('bento-badge-sky');
                }
            }

            if (nextDateEl && h.next_visit_date) {
                nextDateEl.textContent = `진료: ${h.next_visit_date}`;
            }

            if (remainDaysEl && h.remaining_days !== undefined) {
                remainDaysEl.textContent = `남은 약: ${h.remaining_days}일분`;
            }
        }

        if (med && medStatusEl) {
            medStatusEl.textContent = med.is_today_taken ? '오늘 복약 완료 🟢' : '복약 대기 중 ⏰';
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
                memoTextEl.textContent = rawContent || '작성된 메모 내용이 없습니다.';
                if (memoDateEl && latest.updated_at) {
                    memoDateEl.textContent = latest.updated_at.slice(0, 10);
                }
            } else {
                memoTextEl.textContent = '새로운 아이디어나 메모를 기록해 보세요.';
            }
        } catch (e) {
            memoTextEl.textContent = '메모장 바로가기를 클릭하여 작성할 수 있습니다.';
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
                if (data.memory && ramEl) ramEl.textContent = `${data.memory.usagePercent || data.memory.percent || 47}%`;
            }
        } catch (e) {
            // 조용히 기본 안전값 유지
        }
    }

    // 헬퍼: 상대 시간 포맷
    function formatRelativeTime(dateStr) {
        if (!dateStr) return '최신';
        try {
            const date = new Date(dateStr.replace(' ', 'T'));
            const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
            if (diffSec < 60) return '방금 전';
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
            if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
            return `${Math.floor(diffSec / 86400)}일 전`;
        } catch (e) {
            return '최신';
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
