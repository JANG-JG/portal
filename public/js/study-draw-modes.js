/**
 * ==============================================================================
 * 확장 그림 스튜디오 특수 모드 모듈 (study-draw-modes.js)
 * ------------------------------------------------------------------------------
 * 1. 자유 스케치북 5종 배경지 (하얀/모눈/줄공책/밤하늘/4컷 만화)
 * 2. 단계별 따라 그리기 4단계 SVG 가이드 (고양이·공룡·로켓·자동차)
 * 3. 숫자·한글·연산 색칠하기 (아이 수학 레벨 맞춤형 Color by Number)
 * 4. AI 맞춤 SVG 화이트리스트 클라 방어 파서 (sanitize-untrusted-html 준수)
 * ==============================================================================
 */
(function () {
    'use strict';

    const CBN_COLORS = [
        { hex: '#ef4444', name: '빨강', hangul: '가' },
        { hex: '#f97316', name: '주황', hangul: '나' },
        { hex: '#facc15', name: '노랑', hangul: '다' },
        { hex: '#22c55e', name: '초록', hangul: '라' },
        { hex: '#3b82f6', name: '파랑', hangul: '마' }
    ];

    /**
     * 외부/AI SVG 문자열을 화이트리스트 요소·속성만 남겨 안전하게 DOM SVG 노드로 변환한다.
     */
    function sanitizeAndImportSvg(svgText) {
        let raw = String(svgText || '').trim();
        if (raw && !/<svg\b[^>]*\bxmlns\s*=/i.test(raw)) {
            raw = raw.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
        const root = parsed && parsed.documentElement;
        if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;

        const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'text']);
        const ALLOWED_ATTRS = new Set([
            'xmlns', 'viewbox', 'class', 'role', 'aria-label', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
            'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2',
            'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
            'stroke-dasharray', 'opacity', 'transform', 'data-color-part', 'data-cbn-slot',
            'text-anchor', 'dominant-baseline', 'font-size', 'font-weight'
        ]);

        const scrubNode = (node) => {
            const children = Array.from(node.children || []);
            for (const ch of children) {
                const tag = ch.nodeName.toLowerCase();
                if (!ALLOWED_TAGS.has(tag)) {
                    ch.remove();
                    continue;
                }
                for (const attr of Array.from(ch.attributes || [])) {
                    const name = attr.name.toLowerCase();
                    if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
                        ch.removeAttribute(attr.name);
                    }
                }
                scrubNode(ch);
            }
        };
        scrubNode(root);
        for (const attr of Array.from(root.attributes || [])) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
                root.removeAttribute(attr.name);
            }
        }
        root.classList.add('coloring-svg');
        return document.importNode(root, true);
    }

    function buildFreePaperSvg(paperKind = 'blank') {
        if (paperKind === 'grid') {
            const lines = [];
            for (let x = 20; x < 320; x += 20) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="220" stroke="#cbd5e1" stroke-width="0.9"/>`);
            for (let y = 20; y < 220; y += 20) lines.push(`<line x1="0" y1="${y}" x2="320" y2="${y}" stroke="#cbd5e1" stroke-width="0.9"/>`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="모눈종이 도화지"><rect x="0" y="0" width="320" height="220" fill="#ffffff"/>${lines.join('')}</svg>`;
        }
        if (paperKind === 'lined') {
            const rows = [];
            for (let y = 32; y < 210; y += 28) rows.push(`<line x1="16" y1="${y}" x2="304" y2="${y}" stroke="#93c5fd" stroke-width="1.2" stroke-dasharray="4 3"/>`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="줄공책 도화지"><rect x="0" y="0" width="320" height="220" fill="#fffbeb"/>${rows.join('')}</svg>`;
        }
        if (paperKind === 'night') {
            return `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="밤하늘 도화지">
                    <rect x="0" y="0" width="320" height="220" fill="#0f172a"/>
                    <circle cx="42" cy="34" r="2.2" fill="#fde047" opacity="0.85"/>
                    <circle cx="96" cy="24" r="1.6" fill="#fef08a" opacity="0.75"/>
                    <circle cx="182" cy="38" r="2" fill="#bae6fd" opacity="0.8"/>
                    <circle cx="240" cy="22" r="1.8" fill="#fde047" opacity="0.85"/>
                    <circle cx="276" cy="54" r="2.4" fill="#fef08a" opacity="0.8"/>
                    <circle cx="66" cy="182" r="1.8" fill="#bae6fd" opacity="0.65"/>
                    <circle cx="268" cy="188" r="2" fill="#fde047" opacity="0.7"/>
                    <path d="M276 26 A14 14 0 1 0 292 44 A11 11 0 1 1 276 26 Z" fill="#fef08a" opacity="0.85"/>
                </svg>
            `;
        }
        if (paperKind === 'comic4') {
            return `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="4컷 만화 도화지">
                    <rect x="0" y="0" width="320" height="220" fill="#ffffff"/>
                    <rect x="14" y="14" width="140" height="90" rx="10" fill="none" stroke="#334155" stroke-width="2.6"/>
                    <rect x="166" y="14" width="140" height="90" rx="10" fill="none" stroke="#334155" stroke-width="2.6"/>
                    <rect x="14" y="116" width="140" height="90" rx="10" fill="none" stroke="#334155" stroke-width="2.6"/>
                    <rect x="166" y="116" width="140" height="90" rx="10" fill="none" stroke="#334155" stroke-width="2.6"/>
                </svg>
            `;
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="하얀 도화지"><rect x="0" y="0" width="320" height="220" fill="#ffffff"/></svg>`;
    }

    const GUIDE_TEMPLATES = {
        cat: [
            { desc: '1단계: 큰 동그라미로 고양이 얼굴을 그려요!', shapes: '<ellipse cx="160" cy="100" rx="64" ry="52" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '2단계: 양쪽에 뾰족한 세모 귀를 두 개 달아요!', shapes: '<polygon points="96,74 82,22 136,52" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><polygon points="224,74 238,22 184,52" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '3단계: 눈, 세모 코, 웃는 입과 수염을 그려요!', shapes: '<circle cx="136" cy="92" r="5" fill="#475569"/><circle cx="184" cy="92" r="5" fill="#475569"/><polygon points="154,104 166,104 160,112" fill="#475569"/><path d="M144 120 Q160 132 176 120 M80 100 H112 M80 112 H112 M208 100 H240 M208 112 H240" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/>' },
            { desc: '4단계: 통통한 몸통과 하트까지 그리면 완성!', shapes: '<path d="M110 148 C96 178 108 202 160 202 C212 202 224 178 210 148" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><path d="M160 190 C148 178 140 168 148 160 C154 154 158 160 160 164 C162 160 166 154 172 160 C180 168 172 178 160 190 Z" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/>' }
        ],
        rocket: [
            { desc: '1단계: 기다란 네모로 로켓 몸통을 그려요!', shapes: '<rect x="124" y="78" width="72" height="80" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '2단계: 위에 뾰족한 지붕과 창문을 그려요!', shapes: '<path d="M160 18 C186 44 196 74 196 78 H124 C124 74 134 44 160 18 Z" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><circle cx="160" cy="112" r="20" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '3단계: 양옆 날개 두 개를 시원하게 붙어요!', shapes: '<polygon points="124,118 82,166 124,154" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><polygon points="196,118 238,166 196,154" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '4단계: 아래 불꽃과 반짝 별을 그리면 발사 준비 끝!', shapes: '<polygon points="136,158 160,204 184,158" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><polygon points="58,52 66,68 84,70 70,82 74,98 58,90 42,98 46,82 32,70 50,68" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/>' }
        ],
        dino: [
            { desc: '1단계: 동그란 공룡 머리와 목을 그려요!', shapes: '<path d="M98 118 L104 68 Q112 36 144 36 Q172 38 172 68 Q170 86 150 96 L146 122" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '2단계: 볼록한 등과 꼬리를 크게 이어 그려요!', shapes: '<path d="M146 122 Q196 112 228 148 L266 168 Q228 182 192 174 H90 Q58 172 58 142 Q64 120 98 118" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '3단계: 튼튼한 다리 두 개와 귀여운 눈을 그려요!', shapes: '<rect x="92" y="174" width="28" height="24" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><rect x="174" y="174" width="28" height="24" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><circle cx="144" cy="58" r="4.5" fill="#475569"/>' },
            { desc: '4단계: 등에 뾰족 뿔과 옆에 공룡 알을 그려 완성!', shapes: '<polygon points="164,96 186,86 178,112" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/><polygon points="184,110 208,104 198,126" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/><ellipse cx="268" cy="144" rx="22" ry="28" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' }
        ],
        car: [
            { desc: '1단계: 자동차 아래 둥근 몸체를 먼저 그려요!', shapes: '<rect x="42" y="96" width="236" height="62" rx="22" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '2단계: 위에 자동차 지붕을 사다리꼴로 올려요!', shapes: '<path d="M84 96 L114 48 H206 L236 96 Z" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' },
            { desc: '3단계: 앞·뒤 네모 창문 두 개를 그려요!', shapes: '<rect x="104" y="60" width="48" height="32" rx="6" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/><rect x="166" y="60" width="48" height="32" rx="6" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="6 4"/>' },
            { desc: '4단계: 큰 바퀴 두 개와 반짝 휠을 그려 완성!', shapes: '<circle cx="98" cy="162" r="28" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/><circle cx="222" cy="162" r="28" fill="none" stroke="#475569" stroke-width="3.5" stroke-dasharray="7 5"/>' }
        ]
    };

    function mountStepGuide({ wrap, guideId = 'cat', speakFn }) {
        const steps = GUIDE_TEMPLATES[guideId] || GUIDE_TEMPLATES.cat;
        let currentStep = 1;

        const bar = document.createElement('div');
        bar.className = 'guide-step-bar no-print';
        const label = document.createElement('span');
        label.className = 'guide-step-label';
        const controls = document.createElement('div');
        controls.className = 'guide-step-controls';

        const prevBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-outline', textContent: '◀ 이전 단계' });
        const nextBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'study-btn study-btn-primary', textContent: '다음 단계 ▶' });
        prevBtn.style.minBlockSize = '40px';
        nextBtn.style.minBlockSize = '40px';
        controls.append(prevBtn, nextBtn);
        bar.append(label, controls);

        const renderGuideSvg = () => {
            const old = wrap.querySelector('.coloring-svg');
            if (old) old.remove();
            const layers = steps.slice(0, currentStep).map((s, idx) => {
                const op = idx === currentStep - 1 ? 0.92 : 0.42;
                return `<g opacity="${op}">${s.shapes}</g>`;
            }).join('');
            const svg = sanitizeAndImportSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="단계별 따라 그리기"><rect x="0" y="0" width="320" height="220" fill="#ffffff"/>${layers}</svg>`);
            if (svg) wrap.prepend(svg);
            label.textContent = steps[currentStep - 1].desc;
            prevBtn.disabled = currentStep <= 1;
            nextBtn.disabled = currentStep >= steps.length;
        };

        prevBtn.addEventListener('click', () => {
            if (currentStep > 1) { currentStep -= 1; renderGuideSvg(); }
        });
        nextBtn.addEventListener('click', () => {
            if (currentStep < steps.length) {
                currentStep += 1;
                renderGuideSvg();
                if (typeof speakFn === 'function') speakFn(steps[currentStep - 1].desc, 'ko-KR');
            }
        });
        renderGuideSvg();
        return { bar, refreshSvg: renderGuideSvg };
    }

    function buildMathExpressionsForLevel(level) {
        if (level <= 1) {
            return [
                { key: 0, target: 2, expr: '1+1' },
                { key: 1, target: 3, expr: '2+1' },
                { key: 2, target: 4, expr: '2+2' },
                { key: 3, target: 5, expr: '3+2' },
                { key: 4, target: 1, expr: '2-1' }
            ];
        }
        if (level === 2) {
            return [
                { key: 0, target: 5, expr: '3+2' },
                { key: 1, target: 7, expr: '4+3' },
                { key: 2, target: 8, expr: '5+3' },
                { key: 3, target: 4, expr: '7-3' },
                { key: 4, target: 9, expr: '5+4' }
            ];
        }
        return [
            { key: 0, target: 12, expr: '7+5' },
            { key: 1, target: 15, expr: '9+6' },
            { key: 2, target: 9, expr: '14-5' },
            { key: 3, target: 18, expr: '9+9' },
            { key: 4, target: 6, expr: '13-7' }
        ];
    }

    function mountColorByCode({ wrap, cbnType = 'number', mathLevel = 1, onSelectHex, speakFn, banner }) {
        const mathPairs = buildMathExpressionsForLevel(mathLevel);
        const legend = CBN_COLORS.map((c, idx) => {
            let codeLabel = String(idx + 1);
            let regionLabel = String(idx + 1);
            if (cbnType === 'hangul') {
                codeLabel = c.hangul;
                regionLabel = c.hangul;
            } else if (cbnType === 'math') {
                codeLabel = String(mathPairs[idx].target);
                regionLabel = mathPairs[idx].expr;
            }
            return { ...c, slotIdx: idx, codeLabel, regionLabel };
        });

        // 5개 슬롯을 7개 영역으로 매핑한 우주·별 도안
        const svgMarkup = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="색깔 약속 따라 색칠하기">
                <rect x="0" y="0" width="320" height="220" fill="#ffffff"/>
                <path data-color-part="0" data-cbn-slot="0" d="M160 18 C186 44 196 74 196 78 H124 C124 74 134 44 160 18 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                <rect data-color-part="1" data-cbn-slot="2" x="124" y="78" width="72" height="76" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                <circle data-color-part="2" data-cbn-slot="4" cx="160" cy="116" r="20" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                <polygon data-color-part="3" data-cbn-slot="0" points="124,118 82,166 124,154" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                <polygon data-color-part="4" data-cbn-slot="0" points="196,118 238,166 196,154" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                <polygon data-color-part="5" data-cbn-slot="1" points="136,154 160,204 184,154" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                <circle data-color-part="6" data-cbn-slot="3" cx="56" cy="54" r="26" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                <circle data-color-part="7" data-cbn-slot="4" cx="266" cy="56" r="24" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                <text x="160" y="57" text-anchor="middle" font-size="13" font-weight="900" fill="#334155">${legend[0].regionLabel}</text>
                <text x="160" y="89" text-anchor="middle" font-size="11" font-weight="900" fill="#334155">${legend[2].regionLabel}</text>
                <text x="160" y="120" text-anchor="middle" font-size="13" font-weight="900" fill="#334155">${legend[4].regionLabel}</text>
                <text x="111" y="152" text-anchor="middle" font-size="11" font-weight="900" fill="#334155">${legend[0].regionLabel}</text>
                <text x="209" y="152" text-anchor="middle" font-size="11" font-weight="900" fill="#334155">${legend[0].regionLabel}</text>
                <text x="160" y="177" text-anchor="middle" font-size="12" font-weight="900" fill="#334155">${legend[1].regionLabel}</text>
                <text x="56" y="59" text-anchor="middle" font-size="14" font-weight="900" fill="#334155">${legend[3].regionLabel}</text>
                <text x="266" y="61" text-anchor="middle" font-size="14" font-weight="900" fill="#334155">${legend[4].regionLabel}</text>
            </svg>
        `;

        const svgEl = sanitizeAndImportSvg(svgMarkup);
        wrap.querySelector('.coloring-svg')?.remove();
        if (svgEl) wrap.prepend(svgEl);

        const legendBar = document.createElement('div');
        legendBar.className = 'cbn-legend-bar no-print';
        legendBar.setAttribute('role', 'group');
        legendBar.setAttribute('aria-label', '색깔 약속 표');

        const chips = legend.map((item) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'cbn-legend-chip';
            chip.dataset.cbnHex = item.hex;
            chip.innerHTML = `<span class="cbn-swatch-dot" style="background:${item.hex}"></span><span>${item.codeLabel} = ${item.name}</span>`;
            chip.addEventListener('click', () => {
                chips.forEach((c) => c.classList.toggle('active', c === chip));
                if (typeof onSelectHex === 'function') onSelectHex(item.hex);
            });
            legendBar.appendChild(chip);
            return chip;
        });

        const validateTap = (partEl, activeHex) => {
            const slotIdx = Number(partEl?.dataset?.cbnSlot);
            const expected = legend[slotIdx];
            if (!expected) return true;
            if (activeHex === '#ffffff') return true;
            if (activeHex.toLowerCase() === expected.hex.toLowerCase()) {
                if (banner) {
                    banner.style.color = '#047857';
                    banner.textContent = `딩동댕! ${expected.regionLabel} = ${expected.name}(${expected.codeLabel}) 맞았어요! 🌟`;
                }
                if (window.StudyFx) window.StudyFx.correct();
                return true;
            }
            if (banner) {
                banner.style.color = '#b45309';
                banner.textContent = `힌트! ${expected.regionLabel}은(는) '${expected.codeLabel}'이니까 ${expected.name} 색연필을 골라 보세요! 💡`;
            }
            if (typeof speakFn === 'function') speakFn(`${expected.name} 색연필을 골라 보세요`, 'ko-KR');
            if (window.StudyFx) window.StudyFx.wrong();
            return false;
        };

        return {
            svgEl,
            legendBar,
            validateTap,
            syncActiveHex: (hex) => chips.forEach((c) => c.classList.toggle('active', c.dataset.cbnHex.toLowerCase() === String(hex).toLowerCase()))
        };
    }

    function mountStudioSvg({ wrap, canvas, blk, studioKind, buildOutlineOverlay, selectColor, palette, speakFn, banner }) {
        let cbnCtrl = null;
        let guideCtrl = null;
        let baseSvg = null;
        let outlineSvg = null;

        if (studioKind === 'free') {
            wrap.dataset.paper = blk.paperKind || 'blank';
            const paperSvg = sanitizeAndImportSvg(buildFreePaperSvg(blk.paperKind));
            if (paperSvg) wrap.appendChild(paperSvg);
            baseSvg = wrap.querySelector('.coloring-svg');
            wrap.appendChild(canvas);
        } else if (studioKind === 'guide') {
            wrap.appendChild(canvas);
            guideCtrl = mountStepGuide({ wrap, guideId: blk.guideId, speakFn });
            baseSvg = wrap.querySelector('.coloring-svg');
        } else if (studioKind === 'cbn') {
            cbnCtrl = mountColorByCode({
                wrap,
                cbnType: blk.cbnType,
                mathLevel: blk.mathLevel || 1,
                onSelectHex: (hex) => {
                    const matchSw = Array.from(palette.querySelectorAll('.color-swatch')).find((s) => s.dataset.hex === hex);
                    selectColor(hex, matchSw || null);
                },
                speakFn,
                banner
            });
            baseSvg = cbnCtrl.svgEl;
            wrap.appendChild(canvas);
            outlineSvg = typeof buildOutlineOverlay === 'function' ? buildOutlineOverlay(baseSvg) : null;
            if (outlineSvg) wrap.appendChild(outlineSvg);
        } else if (studioKind === 'ai_custom' && blk.customSvg) {
            const aiSvg = sanitizeAndImportSvg(blk.customSvg);
            if (aiSvg) wrap.appendChild(aiSvg);
            baseSvg = wrap.querySelector('.coloring-svg');
            wrap.appendChild(canvas);
            outlineSvg = typeof buildOutlineOverlay === 'function' ? buildOutlineOverlay(baseSvg) : null;
            if (outlineSvg) wrap.appendChild(outlineSvg);
        } else {
            wrap.innerHTML = window.StudyIllustrations
                ? window.StudyIllustrations.getColoringSvg(blk.templateId || 'dino')
                : '<p>색칠 도안을 불러오지 못했어요.</p>';
            baseSvg = wrap.querySelector('.coloring-svg');
            wrap.appendChild(canvas);
            outlineSvg = typeof buildOutlineOverlay === 'function' ? buildOutlineOverlay(baseSvg) : null;
            if (outlineSvg) wrap.appendChild(outlineSvg);
        }
        return { baseSvg, outlineSvg, cbnCtrl, guideCtrl };
    }

    /**
     * 그리기 창을 화면 80%+로 최대화하도록 상단 슬림 바 + 플로팅 드로어 + 좌측 색상 레일을 조립한다.
     */
    function assembleStudioLayout(opts) {
        if (!opts || !opts.container || !opts.stage) return;
        if (window.StudyDrawChrome && typeof window.StudyDrawChrome.assemble === 'function') {
            window.StudyDrawChrome.assemble(opts);
            return;
        }
        const { container, dockNodes = [], stage, banner, hintHost, isPokemonSheet, artworkBar } = opts;
        container.classList.add('coloring-studio-root');

        const toolsDock = document.createElement('div');
        toolsDock.className = 'coloring-tools-dock no-print';
        toolsDock.setAttribute('role', 'region');
        toolsDock.setAttribute('aria-label', '그림 그리기 도구 모음');
        dockNodes.filter(Boolean).forEach((n) => toolsDock.appendChild(n));

        const bottomBar = document.createElement('div');
        bottomBar.className = 'coloring-bottom-bar no-print';
        if (banner) bottomBar.appendChild(banner);
        if (isPokemonSheet && hintHost) bottomBar.appendChild(hintHost);
        if (artworkBar && artworkBar.children.length > 0) bottomBar.appendChild(artworkBar);

        container.append(toolsDock, stage, bottomBar);
    }

    window.StudyDrawModes = {
        sanitizeAndImportSvg,
        buildFreePaperSvg,
        mountStepGuide,
        mountColorByCode,
        mountStudioSvg,
        assembleStudioLayout
    };
})();
