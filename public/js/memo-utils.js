// 🛡️ XSS 방어 살균 함수 (Allowlist 기반 DOMParser 살균기)
function sanitizeMemoHtml(dirty) {
    if (!dirty) return '';
    const allowedTags = new Set(['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'blockquote', 'code', 'pre']);
    const allowedAttrs = new Set(['href', 'target', 'rel', 'class', 'data-list', 'style']);
    if (window.DOMPurify) {
        return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: Array.from(allowedTags), ALLOWED_ATTR: Array.from(allowedAttrs) });
    }
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(dirty, 'text/html');
        const allElements = Array.from(doc.body.querySelectorAll('*'));
        for (const el of allElements) {
            const tag = el.tagName.toLowerCase();
            if (!allowedTags.has(tag)) {
                el.remove();
                continue;
            }
            for (let i = el.attributes.length - 1; i >= 0; i--) {
                const attr = el.attributes[i];
                const name = attr.name.toLowerCase();
                const val = attr.value || '';
                if (!allowedAttrs.has(name)) {
                    el.removeAttribute(attr.name);
                } else if (name === 'href') {
                    if (!/^(https?:\/\/|mailto:|\/)/i.test(val.trim()) || val.trim().startsWith('//')) {
                        el.removeAttribute(attr.name);
                    }
                } else if (name === 'style') {
                    if (/expression|url\s*\(|javascript:/i.test(val)) {
                        el.removeAttribute(attr.name);
                    }
                }
            }
        }
        return doc.body.innerHTML;
    } catch (e) { return escapeHtml(dirty).replace(/\n/g, '<br>'); }
}

const CATEGORY_MAP = {
    'idea': { label: '💡 아이디어', bg: '#fef3c7', color: '#b45309', defaultColor: '#fef3c7' },
    'todo': { label: '✅ 할 일', bg: '#dbeafe', color: '#1d4ed8', defaultColor: '#e0f2fe' },
    'memo': { label: '📝 일반', bg: '#f1f5f9', color: '#334155', defaultColor: '#e0f2fe' },
    'important': { label: '⭐ 중요', bg: '#fee2e2', color: '#b91c1c', defaultColor: '#fee2e2' },
    'scrap': { label: '📰 뉴스스크랩', bg: '#dcfce7', color: '#047857', defaultColor: '#dcfce7' },
    'news': { label: '📰 뉴스스크랩', bg: '#dcfce7', color: '#047857', defaultColor: '#dcfce7' }
};

// 가독성 중심 페이퍼 화이트 & 컬러 액센트 매핑
const COLOR_THEME_MAP = {
    '#fef3c7': { accent: '#f59e0b', border: '#fcd34d', surface: '#fffef7' },
    '#e0f2fe': { accent: '#2563eb', border: '#93c5fd', surface: '#ffffff' },
    '#dcfce7': { accent: '#10b981', border: '#86efac', surface: '#fafffd' },
    '#f3e8ff': { accent: '#8b5cf6', border: '#c4b5fd', surface: '#fdfcff' },
    '#fee2e2': { accent: '#f43f5e', border: '#fda4af', surface: '#fffafb' }
};

// Quill 경량 툴바 구성
const quillToolbarOptions = [
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'check' }, { 'list': 'bullet' }, { 'list': 'ordered' }],
    ['link', 'clean']
];

// 유틸 함수
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

function formatMemoDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr.replace(' ', 'T'));
        if (isNaN(d.getTime())) return dateStr;
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        if (isToday) return `오늘 ${h}:${min}`;
        return `${m}월 ${day}일 ${h}:${min}`;
    } catch (e) { return dateStr; }
}
