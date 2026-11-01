/**
 * ⚡ JG 관리자 센터 서비스 모듈 원클릭 프리셋 스크립트 (admin-modules-presets.js)
 * - 신규 서비스 모듈 등록 시 대표 유형(웹앱, 외부링크, 내장도구, 관리자도구) 선택으로 원클릭 자동 완성
 * - 영문 ID 입력 시 진입 URL, SSO 도메인, DB 경로 실시간 동기화
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 | [규칙 6] 360px 반응형
 */
(function() {
    'use strict';

    let currentPreset = 'webapp';
    const manualFlags = {
        entryUrl: false,
        baseUrl: false,
        dbPath: false
    };

    const PRESETS = {
        webapp: {
            name: '독립 웹앱',
            icon: '🚀',
            category: '라이프',
            desc: '독립 웹앱: 포트 기반으로 가동되며 서브도메인(SSO)과 DB 백업을 지원합니다.',
            adminOnly: false,
            familyDefault: true,
            nav: true,
            quick: true,
            widget: true,
            adminTab: true,
            genEntryUrl: (id) => id ? `/go/${id}` : '/go/',
            genBaseUrl: (id) => id ? `https://${id}.j-jg.cc` : 'https://',
            genDbPath: (id) => id ? `${id}/${id}.db` : '',
            defaultIcon: '📦'
        },
        external: {
            name: '외부 웹링크',
            icon: '🌐',
            category: '정보',
            desc: '외부 웹링크: 새 탭 또는 관리자 임베드(iframe)로 열리는 외부 사이트입니다.',
            adminOnly: false,
            familyDefault: true,
            nav: true,
            quick: true,
            widget: false,
            adminTab: true,
            genEntryUrl: () => 'https://',
            genBaseUrl: () => '',
            genDbPath: () => '',
            defaultIcon: '🔗'
        },
        subpage: {
            name: '포털 내장 도구',
            icon: '📄',
            category: '라이프',
            desc: '포털 내장 도구: 별도 서버 없이 포털 자체에서 호스팅되는 간편 도구 페이지입니다.',
            adminOnly: false,
            familyDefault: true,
            nav: true,
            quick: true,
            widget: false,
            adminTab: false,
            genEntryUrl: (id) => id ? `/${id}` : '/',
            genBaseUrl: () => '',
            genDbPath: () => 'portal/portal.db',
            defaultIcon: '💡'
        },
        admintool: {
            name: '관리자 전용 도구',
            icon: '🔒',
            category: '시스템',
            desc: '관리자 전용 도구: 가족에게는 노출되지 않고 관리자 센터에서만 제어되는 인프라 도구입니다.',
            adminOnly: true,
            familyDefault: false,
            nav: false,
            quick: false,
            widget: false,
            adminTab: true,
            genEntryUrl: (id) => id ? `/go/${id}` : '/go/',
            genBaseUrl: () => '',
            genDbPath: () => '',
            defaultIcon: '🛠️'
        },
        custom: {
            name: '직접 입력',
            icon: '✏️',
            desc: '직접 입력: 모든 설정값을 자유롭게 직접 구성합니다.',
            adminOnly: false,
            familyDefault: true,
            nav: true,
            quick: true,
            widget: true,
            adminTab: true,
            genEntryUrl: () => '',
            genBaseUrl: () => '',
            genDbPath: () => '',
            defaultIcon: '📦'
        }
    };

    /**
     * 프리셋 선택 처리
     */
    window.selectModulePreset = function(presetKey) {
        if (!PRESETS[presetKey]) return;
        currentPreset = presetKey;
        const p = PRESETS[presetKey];

        // 1. 프리셋 칩 스타일 갱신
        const container = document.getElementById('modulePresetChips');
        if (container) {
            container.querySelectorAll('.preset-chip').forEach(btn => {
                const match = btn.getAttribute('data-preset') === presetKey;
                btn.classList.toggle('active', match);
            });
        }

        // 2. 설명 안내문 갱신
        const descEl = document.getElementById('presetCurrentDesc');
        if (descEl) {
            descEl.textContent = p.desc;
        }

        // 3. 폼 옵션 적용
        const catSelect = document.getElementById('inputModCategory');
        if (catSelect && p.category) catSelect.value = p.category;

        const iconInput = document.getElementById('inputModIcon');
        if (iconInput && (!iconInput.value || iconInput.value === '📦')) {
            iconInput.value = p.defaultIcon;
        }

        // 체크박스 옵션
        const chkAdminOnly = document.getElementById('chkModAdminOnly');
        const chkFamily = document.getElementById('chkModFamilyDefault');
        const chkNav = document.getElementById('chkModNav');
        const chkQuick = document.getElementById('chkModQuick');
        const chkWidget = document.getElementById('chkModWidget');
        const chkAdminTab = document.getElementById('chkModAdminTab');

        if (chkAdminOnly) chkAdminOnly.checked = p.adminOnly;
        if (chkFamily) chkFamily.checked = p.familyDefault;
        if (chkNav) chkNav.checked = p.nav;
        if (chkQuick) chkQuick.checked = p.quick;
        if (chkWidget) chkWidget.checked = p.widget;
        if (chkAdminTab) chkAdminTab.checked = p.adminTab;

        // 4. URL 및 DB 경로 자동 계산 (수동 수정되지 않은 필드만)
        const idInput = document.getElementById('inputModId');
        const idVal = (idInput?.value || '').trim();

        const entryInput = document.getElementById('inputModEntryUrl');
        const baseInput = document.getElementById('inputModBaseUrl');
        const dbInput = document.getElementById('inputModDbPath');

        if (entryInput && (!manualFlags.entryUrl || !entryInput.value)) {
            entryInput.value = p.genEntryUrl(idVal);
        }
        if (baseInput && (!manualFlags.baseUrl || !baseInput.value)) {
            baseInput.value = p.genBaseUrl(idVal);
        }
        if (dbInput && (!manualFlags.dbPath || !dbInput.value)) {
            dbInput.value = p.genDbPath(idVal);
        }
    };

    /**
     * 영문 ID 입력 시 실시간 연동 리스너
     */
    function setupIdInputListener() {
        const idInput = document.getElementById('inputModId');
        if (!idInput || idInput.__presetListenerAttached) return;
        idInput.__presetListenerAttached = true;

        idInput.addEventListener('input', function() {
            // 영문 소문자, 숫자, 하이픈 정제
            let cleanVal = this.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
            if (this.value !== cleanVal) {
                this.value = cleanVal;
            }

            const isEdit = document.getElementById('inputModIsEdit')?.value === 'true';
            if (isEdit) return; // 수정 모드 시 건너뜀

            const p = PRESETS[currentPreset];
            if (!p || currentPreset === 'custom') return;

            const entryInput = document.getElementById('inputModEntryUrl');
            const baseInput = document.getElementById('inputModBaseUrl');
            const dbInput = document.getElementById('inputModDbPath');

            if (entryInput && !manualFlags.entryUrl) {
                entryInput.value = p.genEntryUrl(cleanVal);
            }
            if (baseInput && !manualFlags.baseUrl) {
                baseInput.value = p.genBaseUrl(cleanVal);
            }
            if (dbInput && !manualFlags.dbPath) {
                dbInput.value = p.genDbPath(cleanVal);
            }
        });

        // 사용자가 직접 입력한 필드는 자동 덮어쓰기 방지
        const entryInput = document.getElementById('inputModEntryUrl');
        const baseInput = document.getElementById('inputModBaseUrl');
        const dbInput = document.getElementById('inputModDbPath');

        entryInput?.addEventListener('input', () => { manualFlags.entryUrl = true; });
        baseInput?.addEventListener('input', () => { manualFlags.baseUrl = true; });
        dbInput?.addEventListener('input', () => { manualFlags.dbPath = true; });
    }

    /**
     * 모달 열림 시 프리셋 초기화 및 모드 설정
     */
    window.setupModulePresetsForModal = function(isEdit) {
        setupIdInputListener();
        const area = document.getElementById('modulePresetSelectorArea');

        if (isEdit) {
            if (area) area.style.display = 'none';
        } else {
            if (area) area.style.display = 'block';
            manualFlags.entryUrl = false;
            manualFlags.baseUrl = false;
            manualFlags.dbPath = false;
            selectModulePreset('webapp');
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        setupIdInputListener();
    });
})();
