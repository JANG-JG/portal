/**
 * ==============================================================================
 * 텔레그램 봇 ↔ 가족 위키 · 장보기 · 할일 연동 서비스 (telegramWiki.service.js)
 * ------------------------------------------------------------------------------
 * - /위키 [검색어] : 가족 위키 시맨틱 검색 및 바로가기 링크 발송
 * - /위키등록 [제목] | [내용] : 가족 위키 신규 문서 즉시 등록
 * - /장보기 [품목1, 품목2 | 완료 ID | 삭제 ID] : family_todos [장보기] 연동
 * - /할일 [내용 | 완료 ID | 삭제 ID] : 가족 할일·루틴 조회 및 등록/완료 토글
 * - /완료 [ID] : 할일·장보기 항목 완료 토글 단축 명령
 * - [무장애] 보조 서버(family-wiki:5060) HTTP API 우선, 실패 시 로컬 wikiDb 자동 폴백
 * ==============================================================================
 */

const http = require('http');
const { WIKI_BASE_URL, JWT_SECRET } = require('../../config/constants');
const { wikiDb } = require('../db');
const { searchWikiContent, createWikiPage, getWikiSummary } = require('../wikiSummary.service');

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getBaseUrl() {
    return (process.env.PORTAL_PUBLIC_URL || 'https://j-jg.cc').replace(/\/+$/, '');
}

function wAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!wikiDb) return reject(new Error('위키 DB 미연결'));
        wikiDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function wGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!wikiDb) return reject(new Error('위키 DB 미연결'));
        wikiDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function wRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!wikiDb) return reject(new Error('위키 DB 미연결'));
        wikiDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function wikiApiRequest(method, apiPath, bodyObj = null, timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
        let urlObj;
        try {
            urlObj = new URL(apiPath, WIKI_BASE_URL);
        } catch (err) {
            return reject(err);
        }
        const payload = bodyObj ? JSON.stringify(bodyObj) : '';
        const headers = {
            ...(JWT_SECRET ? { 'X-Internal-Secret': JWT_SECRET } : {})
        };
        if (bodyObj) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = http.request(urlObj, { method, timeout: timeoutMs, headers }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (res.statusCode >= 200 && res.statusCode < 300 && parsed.success !== false) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed.message || `위키 API 오류 (${res.statusCode})`));
                    }
                } catch (_) {
                    reject(new Error('위키 API JSON 파싱 실패'));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('위키 API 요청 시간 초과'));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function listFamilyTodos() {
    try {
        const res = await wikiApiRequest('GET', '/api/wiki/todo/list');
        if (res && Array.isArray(res.items)) {
            return { items: res.items, routineStats: res.routine_stats || null };
        }
    } catch (_) {}

    const rows = await wAll(
        `SELECT id, content, is_routine, is_completed, routine_days, assignee, created_at
         FROM family_todos
         ORDER BY is_routine DESC, is_completed ASC, id DESC`
    );
    return { items: rows, routineStats: null };
}

async function addFamilyTodo(content, { isRoutine = 0, routineDays = '', assignee = '전체' } = {}) {
    const clean = String(content || '').trim();
    if (!clean) throw new Error('등록할 내용을 입력해 주세요.');
    try {
        const res = await wikiApiRequest('POST', '/api/wiki/todo/add', {
            content: clean,
            is_routine: isRoutine ? 1 : 0,
            routine_days: routineDays,
            assignee
        });
        if (res && res.success) return { id: res.id, content: clean };
    } catch (_) {}

    const res = await wRun(
        `INSERT INTO family_todos (content, is_routine, is_completed, routine_days, assignee, created_at)
         VALUES (?, ?, 0, ?, ?, datetime('now', 'localtime'))`,
        [clean, isRoutine ? 1 : 0, routineDays, assignee]
    );
    return { id: res.lastID, content: clean };
}

async function toggleFamilyTodo(todoId) {
    const id = Number(todoId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('올바른 항목 번호를 입력해 주세요.');

    try {
        const res = await wikiApiRequest('POST', `/api/wiki/todo/toggle/${id}`, {});
        if (res && res.success) {
            return { id, isCompleted: res.is_completed === 1 };
        }
    } catch (err) {
        if (err.message && err.message.includes('찾을 수 없습니다')) return null;
    }

    const row = await wGet('SELECT id, is_completed, content FROM family_todos WHERE id = ?', [id]);
    if (!row) return null;
    const nextState = row.is_completed === 1 ? 0 : 1;
    await wRun('UPDATE family_todos SET is_completed = ? WHERE id = ?', [nextState, id]);
    return { id, isCompleted: nextState === 1, content: row.content };
}

async function deleteFamilyTodo(todoId) {
    const id = Number(todoId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('올바른 항목 번호를 입력해 주세요.');

    try {
        const res = await wikiApiRequest('POST', `/api/wiki/todo/delete/${id}`, {});
        if (res && res.success) return true;
    } catch (_) {}

    const res = await wRun('DELETE FROM family_todos WHERE id = ?', [id]);
    return res.changes > 0;
}

function parseTodoSubCommand(argText) {
    const text = String(argText || '').trim();
    if (!text || /^(조회|목록|보기|리스트)$/i.test(text)) {
        return { action: 'list' };
    }
    const toggleMatch = text.match(/^(?:완료|체크|토글|done)\s*#?(\d+)$/i) || text.match(/^#(\d+)$/);
    if (toggleMatch) {
        return { action: 'toggle', id: Number(toggleMatch[1]) };
    }
    const delMatch = text.match(/^(?:삭제|지우기|제거|del)\s*#?(\d+)$/i);
    if (delMatch) {
        return { action: 'delete', id: Number(delMatch[1]) };
    }
    return { action: 'add', text };
}

async function handleWikiCreateCommand(argText) {
    let raw = String(argText || '').trim();
    if (!raw) {
        return [
            '📘 <b>가족 위키 문서 등록 안내</b>',
            '• 형식: <code>/위키등록 제목 | 본문 내용</code>',
            '• 카테고리 지정: <code>/위키등록 [가전] 세탁기 통세척 | 매달 1일 진행</code>'
        ].join('\n');
    }

    let category = '생활';
    const catMatch = raw.match(/^\[([^\]]{1,15})\]\s*(.+)$/s);
    if (catMatch) {
        category = catMatch[1].trim() || '생활';
        raw = catMatch[2].trim();
    }

    let title = '';
    let contentMd = '';
    const pipeIdx = raw.indexOf('|');
    if (pipeIdx !== -1) {
        title = raw.slice(0, pipeIdx).trim();
        contentMd = raw.slice(pipeIdx + 1).trim();
    } else {
        title = raw.length > 24 ? `${raw.slice(0, 24)}...` : raw;
        contentMd = raw;
    }

    if (!title || !contentMd) {
        return '⚠️ 제목과 본문을 모두 입력해 주세요.\n예: <code>/위키등록 분리수거 안내 | 매주 목요일 저녁 배출</code>';
    }

    const created = await createWikiPage({
        category,
        title,
        content_md: `# ${title}\n\n${contentMd}\n\n> ✈️ 텔레그램 봇으로 등록됨`
    });
    const baseUrl = getBaseUrl();
    const viewUrl = `${baseUrl}${created.view_url || `/wiki/${created.slug}`}`;

    return [
        '✅ <b>가족 위키 문서 등록 완료!</b>',
        `• 분류: <b>${escapeHtml(created.category || category)}</b>`,
        `• 제목: ${escapeHtml(created.title || title)}`,
        `👉 <a href="${viewUrl}">위키에서 바로 보기</a>`
    ].join('\n');
}

async function handleWikiCommand(argText) {
    const raw = String(argText || '').trim();
    const baseUrl = getBaseUrl();

    if (!raw) {
        const summary = await getWikiSummary();
        const pages = summary && Array.isArray(summary.pages) ? summary.pages : [];
        const lines = ['📖 <b>가족 위키 최근 문서</b>'];
        if (pages.length === 0) {
            lines.push('  • 등록된 위키 문서가 아직 없어요.');
        } else {
            pages.slice(0, 5).forEach((p) => {
                const url = `${baseUrl}/wiki/${p.slug}`;
                lines.push(`  • [${escapeHtml(p.category || '생활')}] <a href="${url}">${escapeHtml(p.title)}</a>`);
            });
        }
        lines.push('', '💡 검색: <code>/위키 검색어</code> | 등록: <code>/위키등록 제목 | 내용</code>');
        return lines.join('\n');
    }

    const createSub = raw.match(/^(?:등록|저장|추가|작성)\s+([\s\S]+)$/);
    if (createSub) {
        return handleWikiCreateCommand(createSub[1]);
    }

    const results = await searchWikiContent(raw, 3);
    if (!results || results.length === 0) {
        return [
            `🔍 <b>'${escapeHtml(raw)}'</b>에 해당하는 위키 문서를 찾지 못했어요.`,
            `💡 새로 등록하려면: <code>/위키등록 ${escapeHtml(raw)} | 내용</code>`
        ].join('\n');
    }

    const lines = [`📖 <b>가족 위키 검색 결과</b> (${escapeHtml(raw)})`];
    results.forEach((p, idx) => {
        const url = `${baseUrl}/wiki/${p.slug}`;
        const rawSnippet = String(p.excerpt || '').replace(/[#*`\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
        const snippet = rawSnippet.length > 85 ? `${rawSnippet.slice(0, 85)}...` : rawSnippet;
        lines.push('');
        lines.push(`${idx + 1}. <b>[${escapeHtml(p.category || '생활')}] ${escapeHtml(p.title)}</b>`);
        if (snippet) lines.push(`   ${escapeHtml(snippet)}`);
        lines.push(`   👉 <a href="${url}">문서 열기</a>`);
    });
    return lines.join('\n');
}

async function handleDoneCommand(argText) {
    const idStr = String(argText || '').trim().replace(/^#/, '');
    const todoId = Number(idStr);
    if (!Number.isInteger(todoId) || todoId <= 0) {
        return '✅ 완료 처리할 번호를 입력해 주세요.\n예: <code>/완료 12</code>';
    }
    const result = await toggleFamilyTodo(todoId);
    if (!result) {
        return `⚠️ 번호 <b>#${todoId}</b> 항목을 위키 할일·장보기에서 찾지 못했어요.`;
    }
    const statusLabel = result.isCompleted ? '✅ 완료' : '⬜ 미완료로 되돌림';
    const titlePart = result.content ? `\n• 내용: ${escapeHtml(result.content)}` : '';
    return `<b>${statusLabel}</b> 처리했어요! (번호: <b>#${todoId}</b>)${titlePart}`;
}

async function handleShoppingCommand(argText) {
    const parsed = parseTodoSubCommand(argText);
    const baseUrl = getBaseUrl();

    if (parsed.action === 'toggle') return handleDoneCommand(String(parsed.id));
    if (parsed.action === 'delete') {
        const ok = await deleteFamilyTodo(parsed.id);
        return ok
            ? `🗑️ 장보기·할일 <b>#${parsed.id}</b>를 삭제했어요.`
            : `⚠️ 번호 <b>#${parsed.id}</b> 항목을 찾지 못했어요.`;
    }

    if (parsed.action === 'list') {
        const { items } = await listFamilyTodos();
        const shopItems = items.filter((it) => String(it.content || '').startsWith('[장보기]'));
        const pending = shopItems.filter((it) => it.is_completed !== 1);
        const done = shopItems.filter((it) => it.is_completed === 1).slice(0, 3);

        const lines = ['🛒 <b>우리 집 장보기 목록</b>'];
        if (pending.length === 0) {
            lines.push('  • 지금 사야 할 장보기 품목이 없어요!');
        } else {
            pending.slice(0, 12).forEach((it) => {
                const label = String(it.content || '').replace(/^\[장보기\]\s*/, '');
                lines.push(`  ⬜ <b>#${it.id}</b> ${escapeHtml(label)}`);
            });
        }
        if (done.length > 0) {
            lines.push('', '<b>최근 완료</b>');
            done.forEach((it) => {
                const label = String(it.content || '').replace(/^\[장보기\]\s*/, '');
                lines.push(`  ✅ #${it.id} ${escapeHtml(label)}`);
            });
        }
        lines.push(
            '',
            '💡 추가: <code>/장보기 우유, 계란</code> | 완료: <code>/완료 번호</code>',
            `👉 <a href="${baseUrl}/wiki">가족 위키에서 보기</a>`
        );
        return lines.join('\n');
    }

    const rawItems = parsed.text
        .split(/[,\n]+/)
        .map((s) => s.trim().replace(/^\[장보기\]\s*/, ''))
        .filter(Boolean)
        .slice(0, 10);

    if (rawItems.length === 0) {
        return '🛒 장볼 품목을 입력해 주세요.\n예: <code>/장보기 우유, 계란, 두부</code>';
    }

    const added = [];
    for (const item of rawItems) {
        const saved = await addFamilyTodo(`[장보기] ${item}`, { isRoutine: 0, assignee: '전체' });
        added.push(`• <b>#${saved.id}</b> ${escapeHtml(item)}`);
    }

    return [
        `🛒 <b>장보기 목록에 ${added.length}건 추가했어요!</b>`,
        ...added,
        `👉 <a href="${baseUrl}/wiki">가족 위키 보드 열기</a>`
    ].join('\n');
}

async function handleTodoCommand(argText) {
    const parsed = parseTodoSubCommand(argText);
    const baseUrl = getBaseUrl();

    if (parsed.action === 'toggle') return handleDoneCommand(String(parsed.id));
    if (parsed.action === 'delete') {
        const ok = await deleteFamilyTodo(parsed.id);
        return ok
            ? `🗑️ 할일 <b>#${parsed.id}</b>를 삭제했어요.`
            : `⚠️ 번호 <b>#${parsed.id}</b> 항목을 찾지 못했어요.`;
    }

    if (parsed.action === 'list') {
        const { items, routineStats } = await listFamilyTodos();
        const activeItems = items.filter((it) => (it.is_active_today !== false || it.is_routine !== 1));
        const routines = activeItems.filter((it) => it.is_routine === 1).slice(0, 8);
        const todos = activeItems.filter((it) => it.is_routine !== 1 && !String(it.content || '').startsWith('[장보기]')).slice(0, 10);

        const lines = ['✅ <b>가족 위키 할일 & 오늘 루틴</b>'];
        if (routineStats && routineStats.total > 0) {
            lines.push(`• 오늘 루틴 달성률: <b>${routineStats.completed}/${routineStats.total} (${routineStats.percent}%)</b>`);
        }

        if (routines.length > 0) {
            lines.push('', '<b>🔁 오늘의 루틴</b>');
            routines.forEach((r) => {
                const icon = r.is_completed === 1 ? '✅' : '⬜';
                lines.push(`  ${icon} <b>#${r.id}</b> ${escapeHtml(r.content)}`);
            });
        }

        lines.push('', '<b>📝 일반 할일</b>');
        if (todos.length === 0) {
            lines.push('  • 등록된 일반 할일이 없어요.');
        } else {
            todos.forEach((t) => {
                const icon = t.is_completed === 1 ? '✅' : '⬜';
                lines.push(`  ${icon} <b>#${t.id}</b> ${escapeHtml(t.content)}`);
            });
        }

        lines.push(
            '',
            '💡 등록: <code>/할일 에어컨 필터 청소</code> | 완료: <code>/완료 번호</code>',
            `👉 <a href="${baseUrl}/wiki">가족 위키 보드 열기</a>`
        );
        return lines.join('\n');
    }

    const saved = await addFamilyTodo(parsed.text, { isRoutine: 0, assignee: '전체' });
    return [
        `✅ <b>가족 할일 등록 완료!</b> (번호: <b>#${saved.id}</b>)`,
        `• 내용: ${escapeHtml(saved.content)}`,
        `👉 <a href="${baseUrl}/wiki">가족 위키에서 확인하기</a>`
    ].join('\n');
}

module.exports = {
    handleWikiCommand,
    handleWikiCreateCommand,
    handleShoppingCommand,
    handleTodoCommand,
    handleDoneCommand,
    deleteFamilyTodo,
    parseTodoSubCommand
};
