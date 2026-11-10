/**
 * ==============================================================================
 * JG Portal 통합 관리자 센터 - 서비스별 전용 런타임 로그 콘솔 모듈
 * admin-service-logs.js
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적인 한국어 인터페이스 준수
 * [규칙 3] 파일당 500줄 이하 모듈화 준수
 * [규칙 6] 가로 360px 모바일 뷰포트 반응형 지원
 * ==============================================================================
 */

const SERVICE_LOG_TARGETS = {
    blood: {
        proc: 'blood-pressure-app',
        label: '혈압·건강 관리',
        hostLabel: '메인 서버 · Port 3000'
    },
    asset: {
        proc: 'asset',
        label: '자산 관리',
        hostLabel: '메인 서버 · Port 3003'
    },
    album: {
        proc: 'family-album',
        label: '가족 사진첩',
        hostLabel: '메인 서버 · Port 3005'
    },
    wiki: {
        proc: 'family-wiki',
        label: '가족 위키',
        hostLabel: '보조 서버 · Port 5060'
    }
};

// 서비스별 런타임 로그 상태 저장소
const serviceLogState = {
    blood: { raw: '', level: 'all', order: 'bottom', loaded: false },
    asset: { raw: '', level: 'all', order: 'bottom', loaded: false },
    album: { raw: '', level: 'all', order: 'bottom', loaded: false },
    wiki:  { raw: '', level: 'all', order: 'bottom', loaded: false }
};

function scrollServiceLogsToBottom(serviceKey) {
    const state = serviceLogState[serviceKey];
    const consoleEl = document.getElementById(`svcLogConsole-${serviceKey}`);
    if (!consoleEl || !state) return;
    if (state.order === 'bottom') {
        requestAnimationFrame(() => {
            consoleEl.scrollTop = consoleEl.scrollHeight;
            setTimeout(() => {
                consoleEl.scrollTop = consoleEl.scrollHeight;
            }, 50);
        });
    }
}

function setServiceLogFilter(serviceKey, level) {
    const state = serviceLogState[serviceKey];
    if (!state) return;
    state.level = level;

    const levels = ['all', 'error', 'warn'];
    levels.forEach(lv => {
        const btn = document.getElementById(`svcLogFilter-${serviceKey}-${lv}`);
        if (!btn) return;
        const isActive = (lv === level);
        if (isActive) {
            btn.style.background = lv === 'error' ? '#ef4444' : (lv === 'warn' ? '#d97706' : '#2563eb');
            btn.style.color = '#ffffff';
        } else {
            btn.style.background = 'transparent';
            btn.style.color = lv === 'error' ? '#ef4444' : (lv === 'warn' ? '#d97706' : '#64748b');
        }
    });

    filterServiceLogs(serviceKey);
}

function toggleServiceLogOrder(serviceKey) {
    const state = serviceLogState[serviceKey];
    if (!state) return;
    state.order = state.order === 'bottom' ? 'top' : 'bottom';
    const btn = document.getElementById(`svcLogOrderBtn-${serviceKey}`);
    if (btn) {
        btn.textContent = state.order === 'bottom' ? '⬇️ 터미널순' : '⬆️ 최신순';
    }
    filterServiceLogs(serviceKey);
}

function filterServiceLogs(serviceKey) {
    const state = serviceLogState[serviceKey];
    const consoleEl = document.getElementById(`svcLogConsole-${serviceKey}`);
    const searchEl = document.getElementById(`svcLogSearch-${serviceKey}`);
    if (!consoleEl || !state) return;

    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';
    if (!state.raw) {
        consoleEl.textContent = '현재 기록된 로그가 없습니다.';
        return;
    }

    const lines = state.raw.split('\n');
    const filtered = lines.filter(line => {
        const lower = line.toLowerCase();
        if (state.level === 'error') {
            const isError = lower.includes('error') || lower.includes('err') ||
                            lower.includes('failed') || lower.includes('fail') ||
                            lower.includes('exception') || lower.includes('traceback') ||
                            line.includes('🚨') || line.includes('❌') ||
                            line.includes('오류') || line.includes('실패');
            if (!isError) return false;
        } else if (state.level === 'warn') {
            const isWarn = lower.includes('warn') || lower.includes('warning') ||
                           lower.includes('caution') || line.includes('⚠️') ||
                           line.includes('주의') || line.includes('경고');
            if (!isWarn) return false;
        }
        if (keyword && !lower.includes(keyword)) return false;
        return true;
    });

    const ordered = state.order === 'top' ? [...filtered].reverse() : filtered;

    if (ordered.length === 0) {
        const lvLabel = state.level === 'error' ? '에러' : (state.level === 'warn' ? '경고' : '전체');
        consoleEl.textContent = `[조건에 일치하는 로그가 없습니다 — 필터: ${lvLabel}${keyword ? `, 검색어: '${keyword}'` : ''}]`;
    } else {
        consoleEl.textContent = ordered.join('\n');
        if (state.order === 'bottom') {
            scrollServiceLogsToBottom(serviceKey);
        } else {
            consoleEl.scrollTop = 0;
        }
    }
}

async function fetchServiceLogs(serviceKey, silent = false) {
    const target = SERVICE_LOG_TARGETS[serviceKey];
    const state = serviceLogState[serviceKey];
    const consoleEl = document.getElementById(`svcLogConsole-${serviceKey}`);
    const linesEl = document.getElementById(`svcLogLines-${serviceKey}`);
    const updatedEl = document.getElementById(`svcLogUpdatedAt-${serviceKey}`);
    const titleCmdEl = document.getElementById(`svcLogTitleCmd-${serviceKey}`);
    if (!target || !state || !consoleEl) return;

    const lines = linesEl ? (parseInt(linesEl.value, 10) || 80) : 80;
    if (titleCmdEl) {
        titleCmdEl.textContent = `pm2 logs ${target.proc} --lines ${lines}`;
    }

    if (!silent && !state.loaded) {
        consoleEl.textContent = `[${target.label}] 실시간 로그를 불러오는 중입니다...`;
    }

    try {
        const res = await fetch(`/api/admin/pm2/logs?process=${encodeURIComponent(target.proc)}&lines=${lines}`);
        const data = await res.json();
        if (data.success) {
            state.raw = (typeof stripAnsi === 'function' ? stripAnsi(data.logs) : data.logs) || '현재 기록된 로그가 없습니다.';
            state.loaded = true;
            filterServiceLogs(serviceKey);
            if (updatedEl) {
                const nowStr = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
                updatedEl.textContent = `최근 갱신 ${nowStr}`;
            }
        } else {
            consoleEl.textContent = '로그 조회 실패: ' + (data.logs || data.message || '알 수 없는 오류');
        }
    } catch (err) {
        consoleEl.textContent = '로그 서버 통신 오류: ' + err.message;
    }
}

function copyServiceLogs(serviceKey) {
    const target = SERVICE_LOG_TARGETS[serviceKey];
    const consoleEl = document.getElementById(`svcLogConsole-${serviceKey}`);
    if (!target || !consoleEl) return;
    if (typeof copyText === 'function') {
        copyText(consoleEl.textContent || '', `📋 [${target.label}] 로그가 클립보드에 복사되었습니다.`);
    }
}

async function clearServiceLogs(serviceKey) {
    const target = SERVICE_LOG_TARGETS[serviceKey];
    if (!target) return;
    if (!confirm(`[${target.label}] 누적된 런타임 로그를 깨끗이 비우시겠습니까?`)) return;

    try {
        if (typeof showToast === 'function') showToast(`[${target.label}] 로그 비우는 중...`);
        const res = await fetch('/api/admin/pm2/flush', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processName: target.proc })
        });
        const data = await res.json();
        if (data.success) {
            if (typeof showToast === 'function') showToast(data.message || '로그를 비웠습니다.');
            fetchServiceLogs(serviceKey);
        } else {
            if (typeof showToast === 'function') showToast(data.message || '로그 비우기 실패', true);
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('로그 비우기 통신 실패: ' + err.message, true);
    }
}

async function restartServiceFromLogs(serviceKey) {
    const target = SERVICE_LOG_TARGETS[serviceKey];
    if (!target) return;
    if (!confirm(`[${target.label}] 서버 프로세스(${target.proc})를 즉시 재기동하시겠습니까?`)) return;

    try {
        if (typeof showToast === 'function') showToast(`🔄 [${target.label}] 프로세스 재기동 중...`);
        const res = await fetch('/api/admin/pm2/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processName: target.proc })
        });
        const data = await res.json();
        if (data.success) {
            if (typeof showToast === 'function') showToast('✅ ' + (data.message || '재기동 완료'));
            setTimeout(() => fetchServiceLogs(serviceKey), 1500);
        } else {
            if (typeof showToast === 'function') showToast('❌ ' + (data.message || '재기동 실패'), true);
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('재기동 요청 실패: ' + err.message, true);
    }
}

// 전역 window 바인딩
Object.assign(window, {
    fetchServiceLogs,
    filterServiceLogs,
    setServiceLogFilter,
    toggleServiceLogOrder,
    copyServiceLogs,
    clearServiceLogs,
    restartServiceFromLogs,
    scrollServiceLogsToBottom
});
