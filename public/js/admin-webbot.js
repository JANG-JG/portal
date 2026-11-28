/**
 * 🤖 JG 관리자 센터 - 한국형 표적 웹봇(WebBot) 관제 · 시드 관리 · 수집 이력 모듈 (admin-webbot.js)
 * - 실시간 스토리지 KPI · 즉시 수집 실행 · 만료 문서 정리 · 시드 CRUD · 색인 문서 및 이벤트 로그 조회
 */
(function () {
    'use strict';

    let latestWebBotEnabled = true;

    const SEED_PRESETS = [
        { label: '대한민국 정책브리핑 (생활·정책 RSS)', url: 'https://www.korea.kr/rss/policy.xml', category: '생활·정책', plan: 'rss:240' },
        { label: '전자신문 IT·과학 속보 (RSS)', url: 'https://rss.etnews.com/Section901.xml', category: 'IT·과학', plan: 'rss:240' },
        { label: 'SBS 뉴스 주요속보 (RSS)', url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER', category: '종합뉴스', plan: 'rss:180' },
        { label: '매일경제 주요 헤드라인 (RSS)', url: 'https://www.mk.co.kr/rss/30000001/', category: '경제·금융', plan: 'rss:240' }
    ];

    function safeHttpUrl(raw) {
        try {
            const u = new URL(String(raw || '').trim());
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
        } catch (_) {
            return null;
        }
    }

    function formatKoTime(ts) {
        if (!ts) return '수집 전';
        try {
            return new Date(Number(ts)).toLocaleString('ko-KR', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (_) {
            return '-';
        }
    }

    function setLiveStatus(msg, isError = false) {
        const box = document.getElementById('adminWebBotStatusLive');
        if (!box) return;
        box.textContent = msg || '';
        box.style.background = isError ? '#fef2f2' : '#eff6ff';
        box.style.borderColor = isError ? '#fecaca' : '#bfdbfe';
        box.style.color = isError ? '#b91c1c' : '#1e40af';
    }

    function refreshAll() {
        if (typeof window.loadAdminSearchStatus === 'function') window.loadAdminSearchStatus();
    }

    function renderWebBotSnapshot(wb) {
        const stats = wb.stats || {};
        latestWebBotEnabled = wb.enabled !== false;

        const badge = document.getElementById('adminWebBotStateBadge');
        if (badge) {
            if (wb.isSeedCrawlRunning) {
                badge.textContent = '⏳ 지금 시드 수집 중...';
                badge.style.cssText = 'background:#dbeafe;color:#1d4ed8;padding:5px 10px;border-radius:999px;font-weight:700;';
            } else if (latestWebBotEnabled) {
                badge.textContent = '🟢 자동 수집 작동 중';
                badge.style.cssText = 'background:#dcfce7;color:#15803d;padding:5px 10px;border-radius:999px;font-weight:700;';
            } else {
                badge.textContent = '⏸️ 웹봇 일시중지됨';
                badge.style.cssText = 'background:#fef3c7;color:#b45309;padding:5px 10px;border-radius:999px;font-weight:700;';
            }
        }

        const toggleBtn = document.getElementById('btnWebBotToggleEngine');
        if (toggleBtn) toggleBtn.textContent = latestWebBotEnabled ? '⏸️ 웹봇 일시중지' : '▶️ 웹봇 다시 켜기';

        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setTxt('wbKpiDocs', `${(stats.indexedDocsCount || 0).toLocaleString()} / ${(stats.maxDocsLimit || 3000).toLocaleString()}건`);
        setTxt('wbKpiFtsMode', stats.ftsEnabled ? 'SQLite FTS5 초고속 역색인 활성' : '일반 키워드 검색 폴백');
        setTxt('wbKpiClips', `${(stats.savedClipsCount || 0).toLocaleString()}건`);
        setTxt('wbKpiMeta', `${(stats.metaCachedCount || 0).toLocaleString()} / ${(stats.maxMetaLimit || 5000).toLocaleString()}건`);
        setTxt('wbKpiSize', `예상 텍스트 저장량 약 ${(stats.estimatedSizeKb || 1).toLocaleString()} KB`);
        setTxt('wbKpiQueue', `활성 시드 ${stats.activeSeeds || 0}/${stats.totalSeeds || 0}개 · 대기 ${wb.queueDepth || 0}건`);
        setTxt('wbKpiWorkers', `동시 작업 ${wb.activeWorkers || 0} / 2 · robots 캐시 ${wb.robotsCachedHosts || 0}곳`);

        renderSeedsTable(wb.seeds || []);
        renderRecentDocsTable(wb.recentDocs || []);
        renderCrawlLogs(wb.recentLogs || []);
    }

    function renderSeedsTable(seeds) {
        const tbody = document.getElementById('adminWebBotSeedsBody');
        if (!tbody) return;
        tbody.replaceChildren();

        if (!seeds.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.style.cssText = 'text-align:center;padding:1rem;color:#64748b;';
            td.textContent = '등록된 관심 시드가 없습니다. 위 입력창에서 RSS 주소를 추가해 주세요.';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        seeds.forEach((seed) => {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            const titleLine = document.createElement('div');
            titleLine.textContent = `${seed.enabled ? '🟢' : '⚪'} [${seed.category || '정보'}] ${seed.label}`;
            const urlLink = document.createElement('a');
            const safe = safeHttpUrl(seed.url);
            urlLink.href = safe || '#';
            if (safe) {
                urlLink.target = '_blank';
                urlLink.rel = 'noopener noreferrer';
            }
            urlLink.className = 'jg-url-code';
            urlLink.style.cssText = 'display:block;font-size:0.75rem;font-weight:500;color:#2563eb;margin-top:2px;';
            urlLink.textContent = seed.url;
            th.append(titleLine, urlLink);

            const tdPlan = document.createElement('td');
            const hrs = Math.round(((seed.interval_min || 240) / 60) * 10) / 10;
            tdPlan.textContent = `${String(seed.seed_type || 'rss').toUpperCase()} · ${hrs}시간 주기 (누적 ${seed.items_collected || 0}건)`;

            const tdStatus = document.createElement('td');
            const stText = seed.last_status || '대기 중';
            tdStatus.textContent = `${stText} · ${formatKoTime(seed.last_crawled_at)}`;
            if (stText.includes('실패')) tdStatus.style.color = '#dc2626';

            const tdAct = document.createElement('td');
            const actWrap = document.createElement('div');
            actWrap.className = 'jg-row-actions';

            const mkBtn = (txt, aria, onClick, danger = false) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn-admin btn-admin-outline btn-admin-sm';
                if (danger) b.style.color = '#dc2626';
                b.textContent = txt;
                if (aria) b.ariaLabel = aria;
                b.addEventListener('click', onClick);
                return b;
            };

            const runBtn = mkBtn('⚡ 수집', `${seed.label} 지금 수집`, () => triggerWebBotCrawl(seed.id, runBtn));
            const togBtn = mkBtn(seed.enabled ? '일시정지' : '켜기', `${seed.label} 활성 전환`, async () => {
                await fetch(`/api/admin/search/webbot/seeds/${encodeURIComponent(seed.id)}/toggle`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ enabled: !seed.enabled })
                });
                refreshAll();
            });
            const editBtn = mkBtn('수정', `${seed.label} 수정`, () => populateSeedFormForEdit(seed));
            const delBtn = mkBtn('삭제', `${seed.label} 시드 삭제`, async () => {
                if (!confirm(`'${seed.label}' 시드를 삭제할까요? (기존 색인 문서는 유지됩니다)`)) return;
                await fetch(`/api/admin/search/webbot/seeds/${encodeURIComponent(seed.id)}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                refreshAll();
            }, true);

            actWrap.append(runBtn, togBtn, editBtn, delBtn);
            tdAct.appendChild(actWrap);
            tr.append(th, tdPlan, tdStatus, tdAct);
            tbody.appendChild(tr);
        });
    }

    function renderRecentDocsTable(docs) {
        const tbody = document.getElementById('adminWebBotDocsBody');
        if (!tbody) return;
        tbody.replaceChildren();

        if (!docs.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.style.cssText = 'text-align:center;padding:1rem;color:#64748b;';
            td.textContent = '아직 수집된 문서가 없습니다. 위 [⚡ 지금 즉시 수집 실행] 버튼을 눌러보세요.';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        docs.forEach((doc) => {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            const a = document.createElement('a');
            const safe = safeHttpUrl(doc.url);
            a.href = safe || '#';
            if (safe) {
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
            }
            a.style.cssText = 'color:#0f172a;text-decoration:none;font-weight:700;';
            a.textContent = doc.title || doc.url;
            th.appendChild(a);
            if (doc.snippet) {
                const sub = document.createElement('div');
                sub.style.cssText = 'font-size:0.75rem;font-weight:400;color:#64748b;margin-top:3px;';
                sub.textContent = String(doc.snippet).slice(0, 90);
                th.appendChild(sub);
            }

            const tdSrc = document.createElement('td');
            tdSrc.textContent = `${doc.site_name || '외부 문서'} · ${doc.og_image ? '🖼️ 썸네일 있음' : '텍스트'}`;

            const tdTime = document.createElement('td');
            tdTime.textContent = formatKoTime(doc.crawled_at);

            const tdAct = document.createElement('td');
            const actWrap = document.createElement('div');
            actWrap.className = 'jg-row-actions';
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-admin btn-admin-outline btn-admin-sm';
            delBtn.style.color = '#dc2626';
            delBtn.textContent = '삭제';
            delBtn.ariaLabel = `${doc.title || '문서'} 색인에서 삭제`;
            delBtn.addEventListener('click', async () => {
                await fetch(`/api/admin/search/webbot/documents/${encodeURIComponent(doc.id)}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                refreshAll();
            });
            actWrap.appendChild(delBtn);
            tdAct.appendChild(actWrap);

            tr.append(th, tdSrc, tdTime, tdAct);
            tbody.appendChild(tr);
        });
    }

    function renderCrawlLogs(logs) {
        const ul = document.getElementById('adminWebBotLogsList');
        if (!ul) return;
        ul.replaceChildren();
        if (!logs.length) {
            const li = document.createElement('li');
            li.textContent = '최근 수집 이벤트가 아직 없습니다. (30분 주기로 자동 순회합니다)';
            ul.appendChild(li);
            return;
        }
        logs.forEach((log) => {
            const li = document.createElement('li');
            li.textContent = `${log.status === 'error' ? '❌' : '✅'} [${formatKoTime(log.time)}] ${log.seedLabel} — ${log.message}`;
            ul.appendChild(li);
        });
    }

    async function triggerWebBotCrawl(seedId = null, triggerBtn = null) {
        const btn = triggerBtn || document.getElementById('btnWebBotRunNow');
        const prevText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ 수집 중...';
        }
        setLiveStatus('한국형 웹봇이 등록된 시드의 최신 글과 썸네일을 수집하고 있습니다...');
        try {
            const res = await fetch('/api/admin/search/webbot/crawl-now', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(seedId ? { seedId } : {})
            });
            const data = await res.json();
            setLiveStatus(data.message || '웹봇 수집 요청을 처리했습니다.', !data.success);
            refreshAll();
        } catch (_) {
            setLiveStatus('웹봇 수집 요청 중 통신 오류가 발생했습니다.', true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = prevText;
            }
        }
    }

    function populateSeedFormForEdit(seed) {
        const idEl = document.getElementById('adminSeedEditId');
        const labelEl = document.getElementById('adminSeedLabel');
        const urlEl = document.getElementById('adminSeedUrl');
        const catEl = document.getElementById('adminSeedCategory');
        const submitBtn = document.getElementById('adminSeedSubmitBtn');
        if (idEl) idEl.value = String(seed.id);
        if (labelEl) {
            labelEl.value = seed.label || '';
            labelEl.focus();
        }
        if (urlEl) urlEl.value = seed.url || '';
        if (catEl) catEl.value = seed.category || '정보';
        if (submitBtn) submitBtn.textContent = '💾 시드 수정 내용 저장하기';
    }

    function bindSeedFormAndActions() {
        const presetBar = document.getElementById('adminSeedPresetBar');
        if (presetBar) {
            presetBar.replaceChildren();
            SEED_PRESETS.forEach((p) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'jg-seed-preset-btn';
                b.textContent = `+ ${p.label.replace(/\s*\(RSS\)/, '')}`;
                b.addEventListener('click', () => {
                    document.getElementById('adminSeedEditId').value = '';
                    document.getElementById('adminSeedLabel').value = p.label;
                    document.getElementById('adminSeedUrl').value = p.url;
                    document.getElementById('adminSeedCategory').value = p.category;
                    document.getElementById('adminSeedType').value = p.plan;
                    document.getElementById('adminSeedSubmitBtn').textContent = '➕ 관심 시드 등록하기';
                });
                presetBar.appendChild(b);
            });
        }

        document.getElementById('btnWebBotRunNow')?.addEventListener('click', function () {
            triggerWebBotCrawl(null, this);
        });

        document.getElementById('btnWebBotToggleEngine')?.addEventListener('click', async () => {
            await fetch('/api/admin/search/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ engineId: 'webBot', enabled: !latestWebBotEnabled })
            });
            refreshAll();
        });

        document.getElementById('btnWebBotPurgeExpired')?.addEventListener('click', async () => {
            const res = await fetch('/api/admin/search/webbot/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ mode: 'expired' })
            });
            const data = await res.json();
            setLiveStatus(data.message || '정리를 완료했습니다.', !data.success);
            refreshAll();
        });

        document.getElementById('btnWebBotPurgeAll')?.addEventListener('click', async () => {
            if (!confirm('자동 수집된 웹봇 문서를 모두 비울까요?\n(가족 구성원이 직접 저장한 개인 보관함 클립은 삭제되지 않습니다)')) return;
            const res = await fetch('/api/admin/search/webbot/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ mode: 'all' })
            });
            const data = await res.json();
            setLiveStatus(data.message || '자동 수집 문서를 비웠습니다.', !data.success);
            refreshAll();
        });

        const form = document.getElementById('adminWebBotSeedForm');
        const labelEl = document.getElementById('adminSeedLabel');
        const urlEl = document.getElementById('adminSeedUrl');
        const errBox = document.getElementById('adminSeedFormError');
        const submitBtn = document.getElementById('adminSeedSubmitBtn');
        if (!form || !labelEl || !urlEl) return;

        const validateField = (el) => {
            el.setCustomValidity('');
            if (el === labelEl && !el.value.trim()) {
                el.setCustomValidity('시드 이름을 입력해 주세요.');
            } else if (el === urlEl) {
                const v = el.value.trim();
                if (!v || !safeHttpUrl(v)) {
                    el.setCustomValidity('http:// 또는 https://로 시작하는 공개 웹 주소를 입력해 주세요.');
                }
            }
            const invalid = !el.checkValidity();
            el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
            return !invalid;
        };

        [labelEl, urlEl].forEach((el) => {
            let touched = false;
            el.addEventListener('input', () => {
                touched = true;
                el.setCustomValidity('');
                el.removeAttribute('aria-invalid');
                if (errBox) errBox.textContent = '';
            });
            el.addEventListener('blur', () => {
                if (touched && !validateField(el) && errBox) errBox.textContent = el.validationMessage;
            });
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const okLabel = validateField(labelEl);
            const okUrl = validateField(urlEl);
            if (!okLabel || !okUrl) {
                const firstBad = !okLabel ? labelEl : urlEl;
                if (errBox) errBox.textContent = firstBad.validationMessage;
                firstBad.focus();
                return;
            }
            const [seedType, intervalStr] = (document.getElementById('adminSeedType')?.value || 'rss:240').split(':');
            const editId = document.getElementById('adminSeedEditId')?.value || null;
            if (submitBtn) submitBtn.disabled = true;
            try {
                const res = await fetch('/api/admin/search/webbot/seeds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        id: editId,
                        label: labelEl.value.trim(),
                        url: urlEl.value.trim(),
                        category: document.getElementById('adminSeedCategory')?.value.trim() || '정보',
                        seedType: seedType || 'rss',
                        intervalMin: parseInt(intervalStr, 10) || 240,
                        enabled: true
                    })
                });
                const data = await res.json();
                if (!data.success) {
                    urlEl.setAttribute('aria-invalid', 'true');
                    if (errBox) errBox.textContent = data.message || '시드 등록에 실패했습니다.';
                    urlEl.focus();
                    return;
                }
                form.reset();
                document.getElementById('adminSeedEditId').value = '';
                if (submitBtn) submitBtn.textContent = '➕ 관심 시드 등록하기';
                if (errBox) errBox.textContent = '';
                setLiveStatus('관심 시드가 저장되었습니다. [⚡ 지금 즉시 수집 실행]으로 바로 색인할 수 있습니다.');
                refreshAll();
            } catch (_) {
                if (errBox) errBox.textContent = '시드 저장 중 서버 통신 오류가 발생했습니다.';
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    window.renderAdminWebBotSnapshot = renderWebBotSnapshot;
    window.setAdminWebBotLiveStatus = setLiveStatus;

    document.addEventListener('DOMContentLoaded', bindSeedFormAndActions);
})();
