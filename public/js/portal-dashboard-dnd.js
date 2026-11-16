/**
 * 🖱️ JG 포털 다중 섹션 Bento Grid 드래그 앤 드롭 엔진 (portal-dashboard-dnd.js)
 * - 전용 그립 핸들(.jg-drag-handle) 기반 포인터 드래그 (마우스 + 모바일 터치 공용)
 * - Home Assistant Sections View + SortableJS 방식 섹션 간 자유 이동 (접힌 섹션 자동 펼침 & 빈 섹션 드롭)
 * - [규칙 3] 500줄 이하 모듈화 | [규칙 6] 스크롤/터치 충돌 차단
 */
(function() {
    'use strict';

    let state = null;
    let scrollRafId = null;

    function clearDropIndicators() {
        document.querySelectorAll('.bento-card-editing[data-drop-pos]').forEach(el => {
            el.removeAttribute('data-drop-pos');
            el.removeAttribute('data-drop-axis');
        });
        document.querySelectorAll('.bento-section[data-section-drop]').forEach(el => {
            el.removeAttribute('data-section-drop');
        });
    }

    function getDropSections() {
        const stack = document.getElementById('portalSectionsStack');
        if (stack) {
            return Array.from(stack.querySelectorAll(':scope > .bento-section'))
                .filter(sec => window.getComputedStyle(sec).display !== 'none');
        }
        return [];
    }

    function getAllEditableSiblings() {
        const sections = getDropSections();
        if (sections.length > 0) {
            const list = [];
            sections.forEach(sec => {
                const grid = sec.querySelector('.bento-section-grid');
                if (!grid) return;
                Array.from(grid.children).forEach(el => {
                    if (
                        el !== state.sourceEl &&
                        el.classList.contains('bento-card-editing') &&
                        window.getComputedStyle(el).display !== 'none'
                    ) {
                        list.push({ el, sectionId: sec.dataset.sectionId });
                    }
                });
            });
            return list;
        }

        const fallbackGrid = document.getElementById('portalHomarrGrid');
        if (!fallbackGrid) return [];
        return Array.from(fallbackGrid.children)
            .filter(el =>
                el !== state.sourceEl &&
                el.classList.contains('bento-card-editing') &&
                window.getComputedStyle(el).display !== 'none'
            )
            .map(el => ({ el, sectionId: el.dataset.sectionId || null }));
    }

    function checkHoveredSection(clientX, clientY) {
        const sections = getDropSections();
        for (const sec of sections) {
            const rect = sec.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                const details = sec.querySelector(':scope > .bento-section-details');
                if (details && !details.open) {
                    details.open = true;
                }
                return sec;
            }
        }
        return null;
    }

    function findDropCandidate(clientX, clientY) {
        if (!state) return null;

        const hoveredSec = checkHoveredSection(clientX, clientY);
        const hoveredSecId = hoveredSec ? hoveredSec.dataset.sectionId : null;
        if (hoveredSec) {
            const grid = hoveredSec.querySelector('.bento-section-grid');
            const hasOtherCards = grid && Array.from(grid.children).some(child =>
                child !== state.sourceEl &&
                child.classList.contains('bento-card-editing') &&
                window.getComputedStyle(child).display !== 'none'
            );
            if (!hasOtherCards && hoveredSecId) {
                return { el: null, sectionEl: hoveredSec, sectionId: hoveredSecId, pos: 'inside', axis: 'block' };
            }
        }

        const siblings = getAllEditableSiblings();
        if (siblings.length === 0) return null;

        let chosen = null;
        let minDist = Infinity;

        for (const item of siblings) {
            const rect = item.el.getBoundingClientRect();
            const insideX = clientX >= rect.left && clientX <= rect.right;
            const insideY = clientY >= rect.top && clientY <= rect.bottom;

            if (insideX && insideY) {
                chosen = { ...item, rect };
                break;
            }

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.abs(clientX - cx) * 0.65 + Math.abs(clientY - cy);
            if (dist < minDist) {
                minDist = dist;
                chosen = { ...item, rect };
            }
        }

        if (!chosen) return null;
        const { el, rect, sectionId } = chosen;
        const spanMode = el.dataset.spanMode || (el.dataset.colSpan === '2' ? 'full' : 'half');
        const isInlineDesktop = spanMode !== 'full' && window.innerWidth > 900;
        const axis = isInlineDesktop ? 'inline' : 'block';
        const pos = isInlineDesktop
            ? (clientX < rect.left + rect.width / 2 ? 'before' : 'after')
            : (clientY < rect.top + rect.height / 2 ? 'before' : 'after');

        return { el, sectionEl: null, sectionId: sectionId || hoveredSecId, pos, axis };
    }

    function updateDraggedPosition() {
        if (!state) return;
        const dx = state.lastX - state.startX;
        const dy = (state.lastY - state.startY) + (window.scrollY - state.startScrollY);
        state.sourceEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.015)`;

        const candidate = findDropCandidate(state.lastX, state.lastY);
        clearDropIndicators();

        if (candidate && candidate.el && candidate.el.dataset.widgetId) {
            state.dropTargetEl = candidate.el;
            state.dropSectionId = candidate.sectionId || null;
            state.dropPos = candidate.pos;
            candidate.el.setAttribute('data-drop-pos', candidate.pos);
            candidate.el.setAttribute('data-drop-axis', candidate.axis || 'block');
        } else if (candidate && candidate.sectionEl && candidate.sectionId) {
            state.dropTargetEl = null;
            state.dropSectionId = candidate.sectionId;
            state.dropPos = 'inside';
            candidate.sectionEl.setAttribute('data-section-drop', 'active');
        } else {
            state.dropTargetEl = null;
            state.dropSectionId = null;
            state.dropPos = null;
        }
    }

    function runAutoScrollLoop() {
        if (!state) {
            scrollRafId = null;
            return;
        }
        const edgeTop = 96;
        const edgeBottom = window.innerHeight - 84;
        let delta = 0;

        if (state.lastY < edgeTop) {
            delta = -Math.min(18, Math.ceil((edgeTop - state.lastY) / 5));
        } else if (state.lastY > edgeBottom) {
            delta = Math.min(18, Math.ceil((state.lastY - edgeBottom) / 5));
        }

        if (delta !== 0) {
            window.scrollBy(0, delta);
            updateDraggedPosition();
        }
        scrollRafId = window.requestAnimationFrame(runAutoScrollLoop);
    }

    function cleanupDrag(commit) {
        if (!state) return;
        if (scrollRafId !== null) {
            window.cancelAnimationFrame(scrollRafId);
            scrollRafId = null;
        }

        const {
            handle, pointerId, sourceEl, sourceId, dropTargetEl, dropSectionId, dropPos
        } = state;
        state = null;

        document.documentElement.classList.remove('bento-dnd-dragging');
        clearDropIndicators();

        if (sourceEl) {
            sourceEl.classList.remove('is-dnd-source');
            sourceEl.style.transform = '';
        }

        if (handle && typeof handle.hasPointerCapture === 'function' && handle.hasPointerCapture(pointerId)) {
            try { handle.releasePointerCapture(pointerId); } catch (e) {}
        }

        if (commit && sourceId && typeof window.reorderDashboardWidgetTo === 'function') {
            if (dropTargetEl && dropTargetEl.dataset.widgetId) {
                window.reorderDashboardWidgetTo(sourceId, dropTargetEl.dataset.widgetId, dropPos || 'before', dropSectionId);
            } else if (dropSectionId) {
                window.reorderDashboardWidgetTo(sourceId, null, 'inside', dropSectionId);
            }
        }
    }

    document.addEventListener('pointerdown', (e) => {
        if (state) return;
        if (!document.documentElement.classList.contains('bento-editing-active')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const handle = e.target.closest('.jg-drag-handle');
        if (!handle) return;

        const sourceEl = handle.closest('.bento-card-editing');
        const sourceId = handle.getAttribute('data-widget-id') || (sourceEl && sourceEl.dataset.widgetId);
        if (!sourceEl || !sourceId) return;

        e.preventDefault();
        e.stopPropagation();

        state = {
            pointerId: e.pointerId,
            handle,
            sourceEl,
            sourceId,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            startScrollY: window.scrollY,
            dropTargetEl: null,
            dropSectionId: null,
            dropPos: null
        };

        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        document.documentElement.classList.add('bento-dnd-dragging');
        sourceEl.classList.add('is-dnd-source');

        if (scrollRafId === null) {
            scrollRafId = window.requestAnimationFrame(runAutoScrollLoop);
        }
    });

    document.addEventListener('pointermove', (e) => {
        if (!state || e.pointerId !== state.pointerId) return;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        updateDraggedPosition();
    });

    document.addEventListener('pointerup', (e) => {
        if (!state || e.pointerId !== state.pointerId) return;
        cleanupDrag(true);
    });

    document.addEventListener('pointercancel', (e) => {
        if (!state || e.pointerId !== state.pointerId) return;
        cleanupDrag(false);
    });

    document.addEventListener('lostpointercapture', (e) => {
        if (!state || e.pointerId !== state.pointerId) return;
        cleanupDrag(false);
    });

    document.addEventListener('keydown', (e) => {
        if (state && e.key === 'Escape') {
            e.preventDefault();
            cleanupDrag(false);
        }
    });
})();
