/**
 * 🍱 JG 포털 Clean Light Bento Grid 실시간 인터랙션 컨트롤러 (bento.js)
 * - 100% 한국어 인터페이스 지원
 * - /api/summary 실제 데이터 필드와 1:1 완벽 바인딩
 * - 뉴스 썸네일 이미지, 보유 종목 리스트, 메모 리스트, 복약/진료 D-Day 연동
 */
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        loadBentoDashboardData();
        loadServerOverview();
    });

    // 1. 메인 요약 데이터 (/api/summary) 비동기 로드
    async function loadBentoDashboardData() {
        try {
            const res = await fetch('/api/summary', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.success) return;

            if (data.weather) bindWelcomeWeather(data.weather);
            if (data.blood) bindBloodCard(data.blood);
            if (data.asset) bindAssetCard(data.asset);
            if (data.news) bindNewsFeed(data.news);
            if (data.hospital || data.medication) bindScheduleCard(data.hospital, data.medication);
            if (data.memo) bindMemoCard(data.memo);
        } catch (err) {
            console.warn('[Bento] 요약 데이터 로드 실패:', err);
        }
    }

    // 2. 날씨 바인딩
    function bindWelcomeWeather(w) {
        if (!w) return;
        const iconEl = document.getElementById('bentoWeatherIcon');
        const cityEl = document.getElementById('bentoWeatherCity');
        const tempEl = document.getElementById('bentoWeatherTemp');
        const descEl = document.getElementById('bentoWeatherDesc');

        if (iconEl && w.icon) iconEl.textContent = w.icon;
        if (cityEl && w.city) cityEl.textContent = w.city;
        if (tempEl && w.temp) tempEl.textContent = `${w.temp}°C`;
        if (descEl && w.desc) descEl.textContent = w.desc;
    }

    // 3. 혈압 & 건강 관리 바인딩
    function bindBloodCard(b) {
        const sysEl = document.getElementById('bentoBloodSys');
        const diaEl = document.getElementById('bentoBloodDia');
        const pulseEl = document.getElementById('bentoBloodPulse');
        const badgeEl = document.getElementById('bentoBloodBadge');
        const timeEl = document.getElementById('bentoBloodTime');

        if (b && b.systolic && b.diastolic) {
            if (sysEl) sysEl.innerHTML = `${b.systolic} <span class="bento-stat-unit">mmHg</span>`;
            if (diaEl) diaEl.innerHTML = `${b.diastolic} <span class="bento-stat-unit">mmHg</span>`;
            if (pulseEl) pulseEl.innerHTML = `${b.pulse || 68} <span class="bento-stat-unit">bpm</span>`;

            if (timeEl && b.measured_at) {
                const parts = b.measured_at.split(' ');
                timeEl.textContent = parts[0] ? `최근 측정: ${parts[0].slice(5)} ${parts[1] ? parts[1].slice(0, 5) : ''}` : b.measured_at;
            }

            if (badgeEl && b.grade) {
                badgeEl.textContent = b.grade.name || b.grade.label || '정상 범위';
                badgeEl.className = 'bento-chip-badge';
                if (b.grade.key === 'high' || b.grade.key === 'high2' || b.grade.key === 'crisis') {
                    badgeEl.classList.add('badge-rose');
                } else if (b.grade.key === 'pre' || b.grade.key === 'caution') {
                    badgeEl.classList.add('badge-amber');
                } else {
                    badgeEl.classList.add('badge-emerald');
                }
            }
        }
    }

    // 4. 자산 카드 바인딩 (평가 총액 + 종목 리스트)
    function bindAssetCard(a) {
        const numEl = document.getElementById('bentoAssetNumber');
        const diffEl = document.getElementById('bentoAssetDiff');
        const listEl = document.getElementById('bentoAssetItemsList');

        if (a) {
            if (numEl && a.totalKrw) {
                numEl.textContent = a.totalKrw;
            }

            const items = a.items || [];
            if (items.length > 0) {
                // 대표 첫 종목 변동률 반영
                if (diffEl && items[0].diffPercent) {
                    diffEl.textContent = `${items[0].diffPercent} (오늘)`;
                    diffEl.style.color = items[0].direction === 'up' ? 'var(--accent-rose)' : 'var(--text-secondary)';
                }

                // 상위 2~3개 종목 리스트 렌더링
                if (listEl) {
                    listEl.innerHTML = items.slice(0, 3).map(item => `
                        <div class="bento-asset-item">
                            <span style="color:var(--text-secondary); font-weight:600;">${escapeHtml(item.name || item.symbol)}</span>
                            <span class="font-mono" style="font-weight:700; color:var(--text-primary);">
                                ${item.formattedTotal}
                                <span style="font-size:0.75rem; color:${item.direction === 'up' ? 'var(--accent-rose)' : 'var(--text-muted)'}; margin-left:4px;">
                                    ${item.diffPercent}
                                </span>
                            </span>
                        </div>
                    `).join('');
                }
            }
        }
    }

    // 5. 실시간 뉴스 피드 바인딩 (썸네일 이미지 포함)
    function bindNewsFeed(n) {
        const listEl = document.getElementById('bentoNewsList');
        if (!listEl || !n) return;

        const articles = n.recommendedArticles || [];
        if (articles.length === 0) {
            listEl.innerHTML = '<div style="font-size:0.8rem; color:#94a3b8; padding:0.5rem 0;">수집된 최신 뉴스가 없습니다.</div>';
            return;
        }

        listEl.innerHTML = articles.slice(0, 3).map(a => {
            const timeAgo = formatNewsTimeAgo(a.published_at);
            const cat = a.category_name || '속보';
            const media = a.media_name || '주요 언론';
            
            // 썸네일 이미지 처리
            const thumbHtml = a.image_url 
                ? `<img src="${a.image_url}" alt="썸네일" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'width:100%; height:100%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-size:10px; color:#94a3b8;\\'>NEWS</div>';">`
                : `<div style="width:100%; height:100%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-size:10px; color:#94a3b8;">NEWS</div>`;

            return `
                <a href="${a.link || 'https://news.j-jg.cc'}" target="_blank" rel="noopener noreferrer" class="bento-news-entry">
                    <div class="bento-news-thumb">
                        ${thumbHtml}
                    </div>
                    <div class="bento-news-body">
                        <div class="bento-news-title" title="${escapeHtml(a.title || '')}">${escapeHtml(a.title || '')}</div>
                        <div class="bento-news-meta-row">
                            <span class="bento-news-cat">${escapeHtml(cat)}</span>
                            <span>•</span>
                            <span class="font-mono">${escapeHtml(media)}</span>
                            <span>•</span>
                            <span class="font-mono">${timeAgo}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('');
    }

    // 6. 캘린더 & D-Day 일정 바인딩
    function bindScheduleCard(h, med) {
        const nextDateEl = document.getElementById('bentoHospitalNextDate');
        const remainDaysEl = document.getElementById('bentoHospitalRemain');
        const ddayHeaderBadge = document.getElementById('bentoHospitalDDay');
        const ddayPill = document.getElementById('bentoHospitalDDayPill');
        const medText = document.getElementById('bentoMedStatusText');
        const medBadge = document.getElementById('bentoMedBadge');

        if (h) {
            const ddayStr = h.nextVisitDDay || 'D-12';
            if (ddayHeaderBadge) ddayHeaderBadge.textContent = ddayStr;
            if (ddayPill) ddayPill.textContent = ddayStr;

            if (nextDateEl) {
                const hospName = h.hospitalName ? `${h.hospitalName} ` : '';
                nextDateEl.textContent = `${hospName}정기진료 (${h.displayNextVisit || h.nextVisitDate || '예정'})`;
            }

            if (remainDaysEl && h.remainingPills !== undefined) {
                remainDaysEl.textContent = `남은 약: ${h.remainingPills}일분`;
            }
        }

        if (med) {
            if (med.is_today_taken) {
                if (medText) medText.textContent = '오늘 복약 완료 ✓';
                if (medBadge) {
                    medBadge.textContent = '완료 ✓';
                    medBadge.className = 'bento-chip-badge badge-emerald';
                }
            } else {
                if (medText) medText.textContent = '복약 대기 중 (19:00 예정)';
                if (medBadge) {
                    medBadge.textContent = '대기 중';
                    medBadge.className = 'bento-chip-badge badge-gray';
                }
            }
        }
    }

    // 7. 메모 카드 바인딩
    function bindMemoCard(memoData) {
        const listEl = document.getElementById('bentoMemoList');
        const countEl = document.getElementById('bentoMemoCount');
        if (!listEl || !memoData) return;

        if (countEl && memoData.totalCount !== undefined) {
            countEl.textContent = `총 ${memoData.totalCount}개 기록`;
        }

        const recent = memoData.recent || [];
        if (recent.length === 0) {
            listEl.innerHTML = '<div style="font-size:0.8rem; color:#94a3b8; padding:0.4rem 0;">등록된 메모가 없습니다.</div>';
            return;
        }

        listEl.innerHTML = recent.slice(0, 2).map(m => {
            const dateStr = m.updated_at ? m.updated_at.slice(0, 10) : '';
            return `
                <div class="bento-memo-item">
                    <span class="bento-memo-item-title">${escapeHtml(m.title || '새 메모')}</span>
                    <span class="font-mono text-muted" style="font-size:0.72rem;">${dateStr}</span>
                </div>
            `;
        }).join('');
    }

    // 8. 서버 관제 요약 바인딩
    async function loadServerOverview() {
        const cpuEl = document.getElementById('bentoServerCpu');
        const ramEl = document.getElementById('bentoServerRam');
        try {
            const res = await fetch('/api/admin/system/status', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.cpu !== undefined && cpuEl) cpuEl.textContent = `${data.cpu}%`;
                if (data.memory && ramEl) ramEl.textContent = `${data.memory.usagePercent || data.memory.percent || 47.1}%`;
            }
        } catch (e) {
            // 기본값 유지
        }
    }

    // 상대 시간 계산 헬퍼
    function formatNewsTimeAgo(dateStr) {
        if (!dateStr) return '최신';
        try {
            const s = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
            const published = new Date(s);
            if (isNaN(published.getTime())) return '방금 전';
            const diffSec = Math.floor((Date.now() - published.getTime()) / 1000);
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
