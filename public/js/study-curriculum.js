/**
 * ==============================================================================
 * 내 실력 자람 나무(공교육 진도표) & 우리말 낱말 사전 위젯 (study-curriculum.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아·부모 친화적 한국어 | [규칙 3] 500줄 이하
 * [규칙 6] 360px 뷰포트 안전 | addEventListener 표준 바인딩
 * ==============================================================================
 */
(function () {
    'use strict';

    let activeChildId = 'first';
    let lastCurriculumData = null;

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function stateLabel(st) {
        if (st === 'completed') return '✅ 배웠어요';
        if (st === 'active') return '🌟 지금 배우는 중';
        return '🔒 다음 목표';
    }

    async function launchUnitPractice(subject, theme, btn, toastFn) {
        if (btn) {
            btn.disabled = true;
            btn.textContent = '✨ 학습지 만드는 중...';
        }
        try {
            const res = await fetch('/api/study/sheets/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    childId: activeChildId,
                    subject,
                    theme: theme || '동물 친구',
                    includePlayBlock: true
                })
            });
            const data = await res.json();
            if (data.success && data.sheet?.id) {
                window.location.href = `/study/sheet/${data.sheet.id}`;
                return;
            }
            toastFn?.(data.message || '학습지를 만들지 못했어요.');
        } catch (_) {
            toastFn?.('서버 연결을 확인해 주세요.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📝 이 단원 바로 연습하기';
            }
        }
    }

    function renderDictResult(box, entry, errorMsg = '') {
        if (!box) return;
        if (errorMsg) {
            box.hidden = false;
            box.innerHTML = `<p style="margin:0; font-size:0.84rem; color:#b45309; font-weight:700;">${esc(errorMsg)}</p>`;
            return;
        }
        if (!entry) {
            box.hidden = true;
            return;
        }
        const syllHtml = (entry.syllables || []).map((ch) => `<span class="curriculum-syllable-pill">${esc(ch)}</span>`).join('');
        box.hidden = false;
        box.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <div>
                    <strong style="font-size:1.05rem; color:#0f172a;">${esc(entry.word)}</strong>
                    <span style="margin-left:6px; font-size:0.75rem; font-weight:700; color:#2563eb;">[${esc(entry.pos)}] · ${esc(entry.providerLabel)}</span>
                </div>
                <button type="button" class="study-btn study-btn-outline" data-speak-word="${esc(entry.word)}" style="min-height:36px; padding:4px 10px; font-size:0.8rem;">🔊 읽어주기</button>
            </div>
            <div class="curriculum-syllables" aria-label="글자 나누기">${syllHtml}</div>
            <p style="margin:4px 0 0; font-size:0.86rem; color:#1e293b; line-height:1.45;">${esc(entry.definition)}</p>
            ${entry.example ? `<p style="margin:5px 0 0; font-size:0.8rem; color:#475569;">예문: &ldquo;${esc(entry.example)}&rdquo;</p>` : ''}
        `;
        const speakBtn = box.querySelector('[data-speak-word]');
        speakBtn?.addEventListener('click', () => {
            if (window.StudyTTS?.speak) window.StudyTTS.speak(`${entry.word}. ${entry.definition}`);
            else if ('speechSynthesis' in window) {
                const u = new SpeechSynthesisUtterance(entry.word);
                u.lang = 'ko-KR';
                window.speechSynthesis.speak(u);
            }
        });
    }

    async function lookupWord(word, mount, toastFn) {
        const clean = String(word || '').trim();
        if (!clean) return;
        const resultBox = mount.querySelector('#curriculumDictResult');
        const submitBtn = mount.querySelector('#btnLookupDictWord');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '🔍 찾는 중...';
        }
        try {
            const res = await fetch(`/api/study/dictionary/word?childId=${encodeURIComponent(activeChildId)}&q=${encodeURIComponent(clean)}`, {
                credentials: 'include'
            });
            const data = await res.json();
            if (!data.success || !data.entry) {
                renderDictResult(resultBox, null, data.message || '낱말을 찾지 못했어요.');
                return;
            }
            renderDictResult(resultBox, data.entry, '');
        } catch (_) {
            toastFn?.('낱말 사전을 불러오는 중 오류가 생겼어요.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '🔍 낱말 뜻 찾아보기';
            }
        }
    }

    function renderMarkup(mount, payload, toastFn) {
        if (!payload || payload.enabled === false) {
            mount.hidden = true;
            return;
        }
        const curr = payload.curriculum;
        if (!curr || !Array.isArray(curr.subjects)) {
            mount.hidden = true;
            return;
        }
        mount.hidden = false;

        const accordionHtml = curr.subjects.map((subj, idx) => {
            const unitRows = subj.units.map((u) => `
                <li class="curriculum-unit-item curriculum-unit-item--${u.state}">
                    <div class="curriculum-unit-head">
                        <span class="curriculum-unit-title">${esc(u.title)}</span>
                        <span class="curriculum-unit-badge">${stateLabel(u.state)}</span>
                    </div>
                    <p class="curriculum-unit-goal">${esc(u.goal)}</p>
                    <button type="button" class="study-btn ${u.state === 'active' ? 'study-btn-primary' : 'study-btn-outline'}"
                        data-curr-practice="1"
                        data-curr-subj="${esc(subj.id)}"
                        data-curr-theme="${esc(u.recommendedTheme)}"
                        style="width:100%; min-height:40px; font-size:0.84rem;">
                        📝 이 단원 바로 연습하기 (${esc(u.recommendedTheme)})
                    </button>
                </li>
            `).join('');

            return `
                <details class="curriculum-subj-details" name="curriculum-subj-tree" ${idx === 0 ? 'open' : ''}>
                    <summary class="curriculum-subj-summary">
                        <span>${esc(subj.emoji)} ${esc(subj.label)} (현재 Lv.${subj.currentLevel})</span>
                        <span class="curriculum-subj-meta">완료 ${subj.completedSheets}장</span>
                    </summary>
                    <ul class="curriculum-unit-list">${unitRows}</ul>
                </details>
            `;
        }).join('');

        const recWords = Array.isArray(payload.recommendedWords) ? payload.recommendedWords : [];
        const dictChipsHtml = recWords.map((w) => `
            <button type="button" class="curriculum-dict-chip" data-dict-chip="${esc(w.word)}">${esc(w.word)}</button>
        `).join('');

        const dictSectionHtml = payload.dictEnabled !== false ? `
            <search class="curriculum-dict-box" aria-label="우리말 낱말 사전 검색">
                <strong style="font-size:0.9rem; color:#1e3a8a; display:block;">📖 우리말 낱말 뜻 알아보기</strong>
                <form class="curriculum-dict-form" id="curriculumDictForm">
                    <label for="dictSearchInput" class="visually-hidden">찾고 싶은 한글 낱말 입력</label>
                    <input type="search" id="dictSearchInput" class="study-input" maxlength="12" placeholder="궁금한 낱말 입력 (예: 사과, 무지개)">
                    <button type="submit" id="btnLookupDictWord" class="study-btn study-btn-secondary" style="width:100%; min-height:42px;">🔍 낱말 뜻 찾아보기</button>
                </form>
                ${dictChipsHtml ? `<div class="curriculum-dict-chips" aria-label="추천 낱말">${dictChipsHtml}</div>` : ''}
                <div id="curriculumDictResult" class="curriculum-dict-result" hidden></div>
            </search>
        ` : '';

        mount.innerHTML = `
            <div class="study-card-head">
                <h2 class="study-card-title">🌱 내 실력 자람 나무</h2>
                <span class="level-badge">기초학력 ${curr.completedUnits}/${curr.totalUnits}단계</span>
            </div>
            <div class="curriculum-progress-wrap">
                <label for="curriculumTreeProgress" class="curriculum-progress-label">
                    <span>초등 기초학력 준비도</span>
                    <span>${curr.overallPercent}%</span>
                </label>
                <progress id="curriculumTreeProgress" class="curriculum-progress-bar" max="100" value="${curr.overallPercent}"></progress>
                <span style="font-size:0.74rem; color:#15803d; font-weight:700;">${esc(curr.standardName)}</span>
            </div>
            <section class="curriculum-accordion" aria-label="과목별 진도표">
                ${accordionHtml}
            </section>
            ${dictSectionHtml}
        `;

        mount.querySelectorAll('[data-curr-practice]').forEach((btn) => {
            btn.addEventListener('click', () => {
                launchUnitPractice(btn.dataset.currSubj, btn.dataset.currTheme, btn, toastFn);
            });
        });

        const dictForm = mount.querySelector('#curriculumDictForm');
        dictForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            const val = mount.querySelector('#dictSearchInput')?.value || '';
            lookupWord(val, mount, toastFn);
        });

        mount.querySelectorAll('[data-dict-chip]').forEach((chip) => {
            chip.addEventListener('click', () => {
                const input = mount.querySelector('#dictSearchInput');
                if (input) input.value = chip.dataset.dictChip || '';
                lookupWord(chip.dataset.dictChip, mount, toastFn);
            });
        });
    }

    async function render(childId, dashboardData, toastFn) {
        const mount = document.getElementById('curriculumTreeMount');
        if (!mount) return;
        activeChildId = childId || activeChildId || 'first';
        try {
            const res = await fetch(`/api/study/curriculum?childId=${encodeURIComponent(activeChildId)}`, {
                credentials: 'include'
            });
            const data = await res.json();
            if (!data.success) {
                mount.hidden = true;
                return;
            }
            lastCurriculumData = data;
            renderMarkup(mount, data, toastFn);
        } catch (_) {
            if (lastCurriculumData) renderMarkup(mount, lastCurriculumData, toastFn);
        }
    }

    window.StudyCurriculum = { render };
})();
