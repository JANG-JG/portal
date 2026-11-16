/**
 * 🖱️ JG 포털 통합 Bento Grid 드래그 앤 드롭 엔진 (portal-dashboard-dnd.js)
 * - 전용 그립 핸들(.jg-drag-handle) 기반 포인터 드래그 (마우스 + 모바일 터치 공용)
 * - 드래그 중 형제 카드 DOM 이동/지터 없이 드롭 인디케이터 표시, 드롭 시 View Transition 원자적 재배치
 * - [규칙 3] 500줄 이하 모듈화 | [규칙 6] 스크롤/터치 충돌 차단
 */
(function() {
    'use strict';

    let state = null;
    let scrollRafId = null;

    function clearDropIndicators() {
        document.querySelectorAll('.bento-card-editing[data-drop-pos]').forEach(el => {
            el.removeAttribute('data-drop-pos');
        });
    }

    function findDropCandidate(clientX, clientY) {
        if (!state || !state.grid) return null;
        const siblings = Array.from(state.grid.children).filter(el =>
            el !== state.sourceEl &&
            el.classList.contains('bento-card-editing') &&
            window.getComputedStyle(el).display !== 'none'
        );
        if (siblings.length === 0) return null;

        let chosen = null;
        let minDist = Infinity;

        for (const el of siblings) {
            const rect = el.getBoundingClientRect();
            const insideX = clientX >= rect.left && clientX <= rect.right;
            const insideY = clientY >= rect.top && clientY <= rect.bottom;

            if (insideX && insideY) {
                chosen = { el, rect };
                break;
            }

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.abs(clientX - cx) * 0.65 + Math.abs(clientY - cy);
            if (dist < minDist) {
                minDist = dist;
                chosen = { el, rect };
            }
        }

        if (!chosen) return null;
        const { el, rect } = chosen;
        const isHalfDesktop = el.dataset.colSpan === '1' && window.innerWidth > 900;
        const pos = isHalfDesktop
            ? (clientX < rect.left + rect.width / 2 ? 'before' : 'after')
            : (clientY < rect.top + rect.height / 2 ? 'before' : 'after');

        return { el, pos };
    }

    function updateDraggedPosition() {
        if (!state) return;
        const dx = state.lastX - state.startX;
        const dy = (state.lastY - state.startY) + (window.scrollY - state.startScrollY);
        state.sourceEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.015)`;

        const candidate = findDropCandidate(state.lastX, state.lastY);
        clearDropIndicators();
        if (candidate && candidate.el.dataset.widgetId) {
            state.dropTargetEl = candidate.el;
            state.dropPos = candidate.pos;
            candidate.el.setAttribute('data-drop-pos', candidate.pos);
        } else {
            state.dropTargetEl = null;
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
            handle, pointerId, sourceEl, sourceId, dropTargetEl, dropPos
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

        if (commit && sourceId && dropTargetEl && dropTargetEl.dataset.widgetId) {
            const targetId = dropTargetEl.dataset.widgetId;
            if (typeof window.reorderDashboardWidgetTo === 'function') {
                window.reorderDashboardWidgetTo(sourceId, targetId, dropPos || 'before');
            }
        }
    }

    document.addEventListener('pointerdown', (e) => {
        if (state) return;
        if (!document.documentElement.classList.contains('bento-editing-active')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const handle = e.target.closest('.jg-drag-handle');
        if (!handle) return;

        const grid = document.getElementById('portalHomarrGrid');
        const sourceEl = handle.closest('.bento-card-editing');
        const sourceId = handle.getAttribute('data-widget-id') || (sourceEl && sourceEl.dataset.widgetId);
        if (!grid || !sourceEl || !sourceId || sourceEl.parentElement !== grid) return;

        e.preventDefault();
        e.stopPropagation();

        state = {
            pointerId: e.pointerId,
            handle,
            grid,
            sourceEl,
            sourceId,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            startScrollY: window.scrollY,
            dropTargetEl: null,
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
