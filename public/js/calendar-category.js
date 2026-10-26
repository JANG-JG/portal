/**
 * 📅 JG 포털 스마트 캘린더 - 범례(카테고리) 관리 모듈
 * calendar-category.js
 */

let categories = [];
let selectedCategoryColor = '#6366f1';

// 1. 범례(카테고리) 목록 가져오기
async function fetchCategories() {
    try {
        const res = await fetch('/api/calendar/categories');
        const data = await res.json();
        if (data.success && Array.isArray(data.categories)) {
            categories = data.categories;
        } else {
            categories = [
                { id: 1, name: '업무', color: '#6366f1' },
                { id: 2, name: '개인', color: '#10b981' },
                { id: 3, name: '중요', color: '#f43f5e' },
                { id: 4, name: '모임', color: '#f59e0b' },
                { id: 5, name: '기타', color: '#0ea5e9' }
            ];
        }
    } catch (e) {
        console.error('범례 로드 실패:', e);
    }
    renderCategorySelect();
    renderCustomLegendsBottom();
    renderModalCategories();
}

// 일정 등록 폼의 범례 드롭다운 렌더링
function renderCategorySelect() {
    const select = document.getElementById('inputEventCategorySelect');
    if (!select) return;
    select.innerHTML = categories.map((cat, idx) => `
        <option value="${cat.name}" data-color="${cat.color}" ${idx === 0 ? 'selected' : ''}>
            ● ${cat.name}
        </option>
    `).join('');
    // 기본 선택 색상 반영
    if (categories.length > 0) {
        select.style.borderLeft = `5px solid ${categories[0].color}`;
    }
}

function onCategorySelectChange() {
    const select = document.getElementById('inputEventCategorySelect');
    if (!select) return;
    const selectedOpt = select.options[select.selectedIndex];
    if (selectedOpt) {
        const color = selectedOpt.getAttribute('data-color') || '#6366f1';
        select.style.borderLeft = `5px solid ${color}`;
        if (selectedOpt.value === '가족') {
            const famCheck = document.getElementById('inputEventIsFamily');
            if (famCheck) famCheck.checked = true;
        }
    }
}

// 캘린더 하단 커스텀 범례 렌더링
function renderCustomLegendsBottom() {
    const container = document.getElementById('customLegendsContainer');
    if (!container) return;
    const escape = (typeof escapeHtml === 'function') ? escapeHtml : (str => str || '');
    container.innerHTML = categories.map(cat => `
        <span style="display: flex; align-items: center; gap: 0.25rem;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${cat.color};"></span>
            ${escape(cat.name)}
        </span>
    `).join('');
}

// 모달 내 범례 리스트 렌더링
function renderModalCategories() {
    const list = document.getElementById('modalCategoryList');
    if (!list) return;

    if (categories.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #94a3b8; font-size: 0.8rem; padding: 1rem;">등록된 범례가 없습니다. 위에서 새 범례를 추가해보세요.</div>`;
        return;
    }

    const escape = (typeof escapeHtml === 'function') ? escapeHtml : (str => str || '');
    list.innerHTML = categories.map(cat => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="color-dot" style="background: ${cat.color};"></span>
                <span style="font-size: 0.82rem; font-weight: 700; color: #1e293b;">${escape(cat.name)}</span>
                <span style="font-size: 0.7rem; color: #94a3b8; font-family: monospace;">${cat.color}</span>
            </div>
            <button type="button" onclick="deleteCategory(${cat.id}, '${escape(cat.name)}')" style="background: none; border: none; color: #ef4444; font-size: 0.8rem; cursor: pointer; padding: 2px 6px;" title="삭제">
                ✕
            </button>
        </div>
    `).join('');
}

// 모달 열기/닫기
function openCategoryModal() {
    const modal = document.getElementById('categoryModal');
    if (modal) modal.classList.add('active');
    renderModalCategories();
}

function closeCategoryModal() {
    const modal = document.getElementById('categoryModal');
    if (modal) modal.classList.remove('active');
}

function handleModalOverlayClick(e) {
    if (e.target && e.target.id === 'categoryModal') {
        closeCategoryModal();
    }
}

// 모달 색상 선택기
function selectCategoryColor(color, el) {
    selectedCategoryColor = color;
    document.querySelectorAll('.color-preset-circle').forEach(c => c.classList.remove('selected'));
    if (el) el.classList.add('selected');
    const customInput = document.getElementById('newCategoryCustomColor');
    if (customInput) customInput.value = color;
}

function onCustomColorPickerChange(val) {
    selectedCategoryColor = val;
    document.querySelectorAll('.color-preset-circle').forEach(c => c.classList.remove('selected'));
}

// 새 범례 저장
async function submitNewCategory() {
    const nameInput = document.getElementById('newCategoryName');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
        alert('범례 이름을 입력해주세요.');
        nameInput.focus();
        return;
    }

    try {
        const res = await fetch('/api/calendar/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color: selectedCategoryColor })
        });
        const data = await res.json();
        if (data.success) {
            nameInput.value = '';
            await fetchCategories();
        } else {
            alert('범례 추가 실패: ' + (data.message || '오류 발생'));
        }
    } catch (e) {
        alert('통신 오류: ' + e.message);
    }
}

// 범례 삭제
async function deleteCategory(id, name) {
    if (!confirm(`'${name}' 범례를 삭제할까요?`)) return;
    try {
        const res = await fetch(`/api/calendar/categories/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            await fetchCategories();
        } else {
            alert('삭제 실패: ' + (data.message || '오류 발생'));
        }
    } catch (e) {
        alert('삭제 통신 오류: ' + e.message);
    }
}
