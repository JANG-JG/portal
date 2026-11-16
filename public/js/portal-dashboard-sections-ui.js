/**
 * 📂 JG 포털 대시보드 섹션 편집 UI 및 모달 (portal-dashboard-sections-ui.js)
 * - Home Assistant Sections View 스타일 섹션 추가 · 이름/아이콘 수정 · 순서 변경 · 삭제 UI
 * - 네이티브 <dialog>.showModal() 기반 경량 모달 (외부 의존성 없음)
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    const PRESET_ICONS = ['🌅', '🏡', '📊', '🧩', '⚡', '❤️', '📅', '📸', '📰', '🖥️', '👶', '💰'];

    function escapeAttr(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureSectionDialog() {
        let dialog = document.getElementById('jgSectionDialog');
        if (dialog) return dialog;

        dialog = document.createElement('dialog');
        dialog.id = 'jgSectionDialog';
        dialog.className = 'jg-section-dialog';
        dialog.setAttribute('aria-labelledby', 'jgSectionDialogTitle');

        dialog.innerHTML = `
            <form method="dialog" id="jgSectionDialogForm" style="display:flex; flex-direction:column; gap:0.75rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <h3 id="jgSectionDialogTitle" style="margin:0; font-size:1rem; font-weight:800;">섹션 설정</h3>
                    <button type="button" id="jgSectionDialogCloseBtn" class="jg-overlay-chip" aria-label="닫기">✕</button>
                </div>

                <div>
                    <div style="font-size:0.78rem; font-weight:700; color:var(--hm-text-muted, #64748b); margin-bottom:6px;">아이콘 선택</div>
                    <div class="jg-section-icon-grid" id="jgSectionIconGrid">
                        ${PRESET_ICONS.map(ic => `<button type="button" class="jg-icon-pick-btn" data-icon="${ic}">${ic}</button>`).join('')}
                    </div>
                </div>

                <label style="display:flex; flex-direction:column; gap:5px; font-size:0.8rem; font-weight:700;">
                    <span>섹션 제목</span>
                    <input type="text" id="jgSectionTitleInput" maxlength="48" required
                        placeholder="예: 오늘의 가족 루틴"
                        style="width:100%; min-block-size:40px; padding:0.45rem 0.7rem; border-radius:10px; border:1px solid var(--hm-border, #cbd5e1); background:var(--hm-bg-body, #f8fafc); color:inherit; font-size:0.9rem; box-sizing:border-box;">
                </label>

                <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">
                    <button type="button" id="jgSectionDialogCancelBtn" class="jg-chip-btn jg-chip-slate">취소</button>
                    <button type="submit" id="jgSectionDialogSaveBtn" class="jg-chip-btn jg-chip-sky">저장</button>
                </div>
            </form>
        `;

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.close('cancel');
        });

        dialog.querySelector('#jgSectionDialogCloseBtn').addEventListener('click', () => dialog.close('cancel'));
        dialog.querySelector('#jgSectionDialogCancelBtn').addEventListener('click', () => dialog.close('cancel'));

        dialog.querySelector('#jgSectionIconGrid').addEventListener('click', (e) => {
            const btn = e.target.closest('.jg-icon-pick-btn');
            if (!btn) return;
            dialog.querySelectorAll('.jg-icon-pick-btn').forEach(b => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            dialog.dataset.selectedIcon = btn.dataset.icon;
        });

        document.body.appendChild(dialog);
        return dialog;
    }

    function openSectionEditDialog(mode, existingSection, onSubmit) {
        const dialog = ensureSectionDialog();
        const titleEl = dialog.querySelector('#jgSectionDialogTitle');
        const inputEl = dialog.querySelector('#jgSectionTitleInput');
        const formEl = dialog.querySelector('#jgSectionDialogForm');

        const initialIcon = (existingSection && existingSection.icon) || '📁';
        const initialTitle = (existingSection && existingSection.title) || '';

        if (titleEl) {
            titleEl.textContent = mode === 'edit' ? '✏️ 섹션 이름·아이콘 수정' : '➕ 새 대시보드 섹션 추가';
        }
        if (inputEl) inputEl.value = initialTitle;

        dialog.dataset.selectedIcon = initialIcon;
        dialog.querySelectorAll('.jg-icon-pick-btn').forEach(b => {
            b.classList.toggle('is-selected', b.dataset.icon === initialIcon);
        });

        const handleSubmit = (e) => {
            e.preventDefault();
            const title = (inputEl ? inputEl.value : '').trim();
            if (!title) {
                if (inputEl) inputEl.focus();
                return;
            }
            const icon = dialog.dataset.selectedIcon || '📁';
            dialog.close('submit');
            if (typeof onSubmit === 'function') {
                onSubmit({ icon, title });
            }
        };

        formEl.onsubmit = handleSubmit;

        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
        setTimeout(() => {
            if (inputEl) {
                inputEl.focus();
                inputEl.select();
            }
        }, 30);
    }

    function injectSectionEditControls(sections) {
        if (!Array.isArray(sections)) return;
        const canDelete = sections.length > 1;

        sections.forEach((sec, idx) => {
            const sectionNode = document.querySelector(`#portalSectionsStack > .bento-section[data-section-id="${CSS.escape(sec.id)}"]`);
            if (!sectionNode) return;
            const controlsEl = sectionNode.querySelector('.bento-section-controls');
            if (!controlsEl) return;

            const safeId = escapeAttr(sec.id);
            const safeTitle = escapeAttr(sec.title);
            const isFirst = idx === 0;
            const isLast = idx === sections.length - 1;

            controlsEl.innerHTML = `
                <button type="button" class="jg-overlay-chip" ${isFirst ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''}
                    onclick="event.preventDefault(); event.stopPropagation(); moveDashboardSectionOrder('${safeId}', 'up')"
                    title="섹션 위로 이동" aria-label="${safeTitle} 섹션 위로 이동">▲</button>
                <button type="button" class="jg-overlay-chip" ${isLast ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''}
                    onclick="event.preventDefault(); event.stopPropagation(); moveDashboardSectionOrder('${safeId}', 'down')"
                    title="섹션 아래로 이동" aria-label="${safeTitle} 섹션 아래로 이동">▼</button>
                <button type="button" class="jg-overlay-chip"
                    onclick="event.preventDefault(); event.stopPropagation(); openEditDashboardSection('${safeId}')"
                    title="섹션 이름/아이콘 수정" aria-label="${safeTitle} 섹션 수정">✏️</button>
                ${canDelete ? `<button type="button" class="jg-overlay-chip is-danger"
                    onclick="event.preventDefault(); event.stopPropagation(); deleteDashboardSection('${safeId}')"
                    title="섹션 삭제 (카드는 인접 섹션으로 이동)" aria-label="${safeTitle} 섹션 삭제">✕</button>` : ''}
            `;
        });
    }

    function cleanupSectionEditUI() {
        document.querySelectorAll('.bento-section-controls').forEach(el => {
            el.innerHTML = '';
        });
        const dialog = document.getElementById('jgSectionDialog');
        if (dialog && dialog.open) {
            dialog.close('cancel');
        }
    }

    let sectionEditorCtx = null;

    function bindDashboardSectionEditor(ctx) {
        sectionEditorCtx = ctx || null;
    }

    window.openAddDashboardSection = function() {
        if (!sectionEditorCtx) return;
        openSectionEditDialog('add', { icon: '🧩', title: '' }, ({ icon, title }) => {
            const sections = sectionEditorCtx.getSections();
            const newId = `sec-${Date.now().toString(36)}`;
            sections.push({ id: newId, title, icon, order: (sections.length + 1) * 10 });
            sectionEditorCtx.commit({ animate: true });
            sectionEditorCtx.announce(`${title} 섹션이 추가되었습니다.`);
            setTimeout(() => {
                const secEl = document.querySelector(`.bento-section[data-section-id="${CSS.escape(newId)}"]`);
                if (secEl) secEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 60);
        });
    };

    window.openEditDashboardSection = function(sectionId) {
        if (!sectionEditorCtx) return;
        const sec = sectionEditorCtx.getSections().find(s => s.id === sectionId);
        if (!sec) return;
        openSectionEditDialog('edit', sec, ({ icon, title }) => {
            sec.icon = icon;
            sec.title = title;
            sectionEditorCtx.commit({ animate: true });
            sectionEditorCtx.announce(`섹션이 ${title}으로 수정되었습니다.`);
        });
    };

    window.moveDashboardSectionOrder = function(sectionId, direction) {
        if (!sectionEditorCtx) return;
        const sections = sectionEditorCtx.getSections();
        const idx = sections.findIndex(s => s.id === sectionId);
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx === -1 || targetIdx < 0 || targetIdx >= sections.length) return;
        const temp = sections[idx];
        sections[idx] = sections[targetIdx];
        sections[targetIdx] = temp;
        sectionEditorCtx.commit({ animate: true });
        sectionEditorCtx.announce(`${temp.title} 섹션 순서가 변경되었습니다.`);
    };

    window.deleteDashboardSection = function(sectionId) {
        if (!sectionEditorCtx) return;
        const sections = sectionEditorCtx.getSections();
        if (sections.length <= 1) return;
        const idx = sections.findIndex(s => s.id === sectionId);
        if (idx === -1) return;
        const targetSec = sections[idx];
        if (!confirm(`"${targetSec.title}" 섹션을 삭제할까요? 섹션 안의 카드는 인접 섹션으로 안전하게 이동합니다.`)) return;
        const fallback = sections[idx === 0 ? 1 : idx - 1];
        sectionEditorCtx.getWidgets().forEach(w => {
            if (w.sectionId === sectionId) w.sectionId = fallback.id;
        });
        sections.splice(idx, 1);
        sectionEditorCtx.commit({ animate: true });
        sectionEditorCtx.announce(`${targetSec.title} 섹션이 삭제되었습니다.`);
    };

    window.openSectionEditDialog = openSectionEditDialog;
    window.injectSectionEditControls = injectSectionEditControls;
    window.cleanupSectionEditUI = cleanupSectionEditUI;
    window.bindDashboardSectionEditor = bindDashboardSectionEditor;
})();
