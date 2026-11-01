/**
 * 🎨 JG 포털 오픈소스 위젯 스튜디오 모달 (portal-widget-studio.js)
 * - 화면 편집 모드에서 원클릭으로 오픈소스 및 커스텀 위젯을 대시보드에 즉시 추가
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 모바일 완벽 대응
 */
(function() {
    'use strict';

    let builtinPresets = [];

    /**
     * 위젯 추가 모달 열기
     */
    window.openWidgetStudioModal = async function() {
        let modal = document.getElementById('widgetStudioModal');
        if (!modal) {
            modal = createStudioModalElement();
            document.body.appendChild(modal);
        }

        // 프리셋 불러오기
        await loadBuiltinPresets();
        renderPresetSelector();

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    /**
     * 위젯 추가 모달 닫기
     */
    window.closeWidgetStudioModal = function() {
        const modal = document.getElementById('widgetStudioModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    };

    /**
     * 모달 DOM 생성
     */
    function createStudioModalElement() {
        const wrap = document.createElement('div');
        wrap.id = 'widgetStudioModal';
        wrap.style.cssText = 'position:fixed; inset:0; z-index:99999; background:rgba(15,23,42,0.65); backdrop-filter:blur(4px); display:none; align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;';

        wrap.innerHTML = `
            <div style="background:#ffffff; border-radius:16px; width:100%; max-width:540px; max-height:90vh; overflow-y:auto; box-shadow:0 20px 40px -10px rgba(0,0,0,0.3); border:1px solid #e2e8f0; display:flex; flex-direction:column;">
                
                <!-- 모달 헤더 -->
                <div style="padding:1.15rem 1.25rem; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:1.35rem;">🧩</span>
                        <div>
                            <div style="font-weight:700; font-size:1.05rem; color:#0f172a;">새 위젯 / 오픈소스 추가</div>
                            <div style="font-size:0.75rem; color:#64748b;">대시보드에 띄울 위젯을 선택하거나 직접 만드세요</div>
                        </div>
                    </div>
                    <button type="button" onclick="closeWidgetStudioModal()" style="background:transparent; border:none; font-size:1.2rem; color:#94a3b8; cursor:pointer; padding:4px 8px;">✕</button>
                </div>

                <!-- 탭 전환 바 -->
                <div style="display:flex; border-bottom:1px solid #f1f5f9; background:#f8fafc; padding:0 1.25rem;">
                    <button type="button" id="tabBtnStudioPresets" onclick="switchStudioTab('presets')" style="padding:0.75rem 1rem; border:none; background:transparent; font-size:0.85rem; font-weight:700; color:#2563eb; border-bottom:2px solid #2563eb; cursor:pointer;">
                        📦 오픈소스 프리셋
                    </button>
                    <button type="button" id="tabBtnStudioCustom" onclick="switchStudioTab('custom')" style="padding:0.75rem 1rem; border:none; background:transparent; font-size:0.85rem; font-weight:600; color:#64748b; border-bottom:2px solid transparent; cursor:pointer;">
                        ✏️ 직접 만들기
                    </button>
                </div>

                <!-- 탭 1: 오픈소스 프리셋 -->
                <div id="paneStudioPresets" style="padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem;">
                    <div id="presetCardsContainer" style="display:flex; flex-direction:column; gap:0.6rem;">
                        <div style="text-align:center; padding:1.5rem; color:#64748b; font-size:0.85rem;">프리셋을 불러오는 중...</div>
                    </div>
                </div>

                <!-- 탭 2: 직접 만들기 폼 -->
                <form id="paneStudioCustom" onsubmit="handleSaveCustomWidget(event)" style="padding:1.25rem; display:none; flex-direction:column; gap:0.85rem;">
                    <div>
                        <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">위젯 제목</label>
                        <input type="text" id="studioWidgetTitle" required placeholder="예: 서버 상태 모니터링" style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.75rem; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.65rem;">
                        <div>
                            <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">아이콘 이모지</label>
                            <input type="text" id="studioWidgetIcon" value="📦" style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.75rem; font-size:0.85rem; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">위젯 너비</label>
                            <select id="studioWidgetColSpan" style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.5rem; font-size:0.85rem; box-sizing:border-box;">
                                <option value="1">▫️ 1열 (반폭 50%)</option>
                                <option value="2">↔️ 2열 (전폭 100%)</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">위젯 유형</label>
                        <select id="studioWidgetType" onchange="handleStudioTypeChange()" style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.5rem; font-size:0.85rem; box-sizing:border-box;">
                            <option value="embed">🌐 웹 임베드 (iFrame 미니창)</option>
                            <option value="metric">⚡ REST API 실시간 수치</option>
                        </select>
                    </div>
                    <div id="fieldStudioEmbedUrl">
                        <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">임베드할 웹 URL</label>
                        <input type="url" id="studioEmbedUrl" placeholder="https://example.com" style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.75rem; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div id="fieldStudioEndpoint" style="display:none;">
                        <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">REST API 엔드포인트 URL</label>
                        <input type="text" id="studioEndpoint" placeholder="/api/... 또는 https://..." style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.75rem; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:4px;">간단 설명</label>
                        <input type="text" id="studioWidgetDesc" placeholder="위젯 설명 (선택)" style="width:100%; height:38px; border:1px solid #cbd5e1; border-radius:8px; padding:0 0.75rem; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div style="margin-top:0.5rem; display:flex; justify-content:flex-end; gap:8px;">
                        <button type="button" onclick="closeWidgetStudioModal()" style="height:38px; padding:0 1rem; border:1px solid #cbd5e1; background:#ffffff; border-radius:8px; font-size:0.82rem; cursor:pointer;">취소</button>
                        <button type="submit" style="height:38px; padding:0 1.25rem; border:none; background:#2563eb; color:#ffffff; font-weight:700; border-radius:8px; font-size:0.82rem; cursor:pointer;">대시보드에 추가</button>
                    </div>
                </form>

            </div>
        `;
        return wrap;
    }

    /**
     * 탭 전환
     */
    window.switchStudioTab = function(tab) {
        const panePresets = document.getElementById('paneStudioPresets');
        const paneCustom = document.getElementById('paneStudioCustom');
        const btnPresets = document.getElementById('tabBtnStudioPresets');
        const btnCustom = document.getElementById('tabBtnStudioCustom');

        if (tab === 'custom') {
            panePresets.style.display = 'none';
            paneCustom.style.display = 'flex';
            btnPresets.style.color = '#64748b';
            btnPresets.style.borderBottomColor = 'transparent';
            btnCustom.style.color = '#2563eb';
            btnCustom.style.borderBottomColor = '#2563eb';
        } else {
            panePresets.style.display = 'flex';
            paneCustom.style.display = 'none';
            btnPresets.style.color = '#2563eb';
            btnPresets.style.borderBottomColor = '#2563eb';
            btnCustom.style.color = '#64748b';
            btnCustom.style.borderBottomColor = 'transparent';
        }
    };

    /**
     * 타입 변경에 따른 입력 필드 토글
     */
    window.handleStudioTypeChange = function() {
        const type = document.getElementById('studioWidgetType').value;
        const fieldEmbed = document.getElementById('fieldStudioEmbedUrl');
        const fieldEndpoint = document.getElementById('fieldStudioEndpoint');

        if (type === 'embed') {
            fieldEmbed.style.display = 'block';
            fieldEndpoint.style.display = 'none';
        } else {
            fieldEmbed.style.display = 'none';
            fieldEndpoint.style.display = 'block';
        }
    };

    /**
     * 프리셋 로드
     */
    async function loadBuiltinPresets() {
        try {
            const res = await fetch('/api/modules/custom-widgets/presets');
            const data = await res.json();
            if (data.success && Array.isArray(data.presets)) {
                builtinPresets = data.presets;
            }
        } catch (e) {
            builtinPresets = [];
        }
    }

    /**
     * 프리셋 렌더링
     */
    function renderPresetSelector() {
        const container = document.getElementById('presetCardsContainer');
        if (!container) return;

        if (builtinPresets.length === 0) {
            container.innerHTML = '<div style="color:#64748b; font-size:0.85rem; text-align:center;">사용 가능한 프리셋이 없습니다.</div>';
            return;
        }

        container.innerHTML = builtinPresets.map((p, idx) => `
            <div style="border:1px solid #e2e8f0; border-radius:12px; padding:0.85rem 1rem; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#f8fafc; transition:all 0.2s;">
                <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
                    <span style="font-size:1.5rem; flex-shrink:0;">${p.icon || '📦'}</span>
                    <div style="min-width:0;">
                        <div style="font-weight:700; font-size:0.9rem; color:#0f172a;">${p.title}</div>
                        <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">${p.desc}</div>
                    </div>
                </div>
                <button type="button" onclick="applyPresetToDashboard(${idx})" style="padding:0 0.85rem; height:34px; background:#2563eb; color:#ffffff; border:none; border-radius:8px; font-size:0.78rem; font-weight:700; cursor:pointer; flex-shrink:0;">
                    + 추가하기
                </button>
            </div>
        `).join('');
    }

    /**
     * 프리셋을 대시보드에 즉시 추가
     */
    window.applyPresetToDashboard = async function(idx) {
        const p = builtinPresets[idx];
        if (!p) return;

        try {
            const res = await fetch('/api/modules/custom-widgets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: p.title,
                    icon: p.icon,
                    desc: p.desc,
                    type: p.type,
                    colSpan: p.colSpan || 1,
                    embedUrl: p.embedUrl || '',
                    endpoint: p.endpoint || '',
                    renderType: p.renderType || 'custom',
                    enabled: true
                })
            });
            const data = await res.json();
            if (data.success) {
                closeWidgetStudioModal();
                if (typeof showToast === 'function') {
                    showToast(`[${p.title}] 위젯이 대시보드에 추가되었습니다! 🎉`, 'success');
                }
                // 메인 그리드 새로고침
                if (typeof window.reloadDynamicWidgets === 'function') {
                    await window.reloadDynamicWidgets();
                }
                // 화면 편집 모드 유지 중이면 다시 오버레이 바인딩
                if (typeof window.toggleDashboardEditMode === 'function') {
                    window.toggleDashboardEditMode(true);
                }
            } else {
                alert(data.message || '위젯 추가 실패');
            }
        } catch (e) {
            alert('서버와 통신할 수 없습니다.');
        }
    };

    /**
     * 직접 만든 커스텀 위젯 저장
     */
    window.handleSaveCustomWidget = async function(e) {
        e.preventDefault();
        const title = document.getElementById('studioWidgetTitle').value;
        const icon = document.getElementById('studioWidgetIcon').value;
        const colSpan = Number(document.getElementById('studioWidgetColSpan').value) || 1;
        const type = document.getElementById('studioWidgetType').value;
        const embedUrl = document.getElementById('studioEmbedUrl').value;
        const endpoint = document.getElementById('studioEndpoint').value;
        const desc = document.getElementById('studioWidgetDesc').value;

        try {
            const res = await fetch('/api/modules/custom-widgets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    icon,
                    colSpan,
                    type,
                    embedUrl,
                    endpoint,
                    desc,
                    enabled: true
                })
            });
            const data = await res.json();
            if (data.success) {
                closeWidgetStudioModal();
                if (typeof showToast === 'function') {
                    showToast(`[${title}] 위젯이 추가되었습니다!`, 'success');
                }
                if (typeof window.reloadDynamicWidgets === 'function') {
                    await window.reloadDynamicWidgets();
                }
                if (typeof window.toggleDashboardEditMode === 'function') {
                    window.toggleDashboardEditMode(true);
                }
            } else {
                alert(data.message || '저장 실패');
            }
        } catch (err) {
            alert('저장 중 오류가 발생했습니다.');
        }
    };

})();
