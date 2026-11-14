/**
 * ==============================================================================
 * 유아 학습지 테마·캐릭터 SVG 일러스트 & 색칠 도안 라이브러리 (study-illustrations.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 | 순수 벡터 SVG (고해상도 태블릿 + A4 인쇄 선화 겸용)
 * ==============================================================================
 */

(function () {
    'use strict';

    function resolveThemeCategory(theme = '', title = '') {
        const text = `${theme || ''} ${title || ''}`.toLowerCase();
        if (/공주|티니|핑|요정|왕관|하트|마법|벨|엘사/.test(text)) return 'princess';
        if (/로봇|변신|메카|블록|장난감/.test(text)) return 'robot';
        if (/공룡|티라노|브라키|트리케라/.test(text)) return 'dino';
        if (/우주|로켓|별|달|행성|태양/.test(text)) return 'space';
        if (/바다|고래|상어|물고기|인어|문어/.test(text)) return 'ocean';
        if (/탈것|차|자동차|소방|경찰|기차|버스/.test(text)) return 'vehicle';
        if (/과일|사과|딸기|수박|바나나|포도/.test(text)) return 'fruit';
        return 'animal';
    }

    function getThemeBannerSvg(theme = '', title = '') {
        const cat = resolveThemeCategory(theme, title);
        const scenes = {
            dino: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="공룡 친구 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#ecfdf5" stroke="#6ee7b7" stroke-width="2.5"/>
                    <path d="M22 62 Q22 36 42 36 L44 22 Q46 12 58 14 Q68 16 66 28 L64 42 Q80 42 86 58 L92 62 L22 62 Z" fill="#34d399" stroke="#065f46" stroke-width="2.5" stroke-linejoin="round"/>
                    <circle cx="57" cy="22" r="2.6" fill="#065f46"/>
                    <path d="M52 28 Q57 32 61 28" fill="none" stroke="#065f46" stroke-width="2" stroke-linecap="round"/>
                    <ellipse cx="88" cy="56" rx="9" ry="11" fill="#fef3c7" stroke="#b45309" stroke-width="2"/>
                    <path d="M81 55 L85 52 L89 56 L94 53" fill="none" stroke="#f59e0b" stroke-width="2"/>
                    <circle cx="24" cy="20" r="5" fill="#fde047"/>
                </svg>`,
            space: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="우주 모험 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#eff6ff" stroke="#93c5fd" stroke-width="2.5"/>
                    <circle cx="84" cy="26" r="11" fill="#fde047" stroke="#ca8a04" stroke-width="2"/>
                    <ellipse cx="84" cy="26" rx="18" ry="5" fill="none" stroke="#fb923c" stroke-width="2.5" transform="rotate(-18 84 26)"/>
                    <path d="M44 16 C56 26 56 46 52 56 L36 56 C32 46 32 26 44 16 Z" fill="#ffffff" stroke="#1e3a8a" stroke-width="2.5"/>
                    <path d="M44 16 C49 21 51 26 52 30 L36 30 C37 26 39 21 44 16 Z" fill="#ef4444" stroke="#1e3a8a" stroke-width="2"/>
                    <circle cx="44" cy="40" r="5.5" fill="#60a5fa" stroke="#1e3a8a" stroke-width="2"/>
                    <path d="M38 56 L44 68 L50 56 Z" fill="#fb923c"/>
                    <circle cx="22" cy="22" r="2.8" fill="#facc15"/>
                    <circle cx="24" cy="54" r="2.2" fill="#facc15"/>
                </svg>`,
            ocean: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="바다 친구 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#ecfeff" stroke="#67e8f9" stroke-width="2.5"/>
                    <path d="M24 46 C24 30 42 24 62 28 C74 30 82 40 86 44 L96 34 L94 48 L98 58 L84 52 C74 58 34 60 24 46 Z" fill="#38bdf8" stroke="#0c4a6e" stroke-width="2.5" stroke-linejoin="round"/>
                    <circle cx="40" cy="40" r="2.8" fill="#0c4a6e"/>
                    <path d="M36 48 Q42 52 48 48" fill="none" stroke="#0c4a6e" stroke-width="2" stroke-linecap="round"/>
                    <path d="M52 24 Q48 14 42 16 M54 24 Q58 14 64 16" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round"/>
                    <path d="M12 64 Q26 58 40 64 T68 64 T98 64" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round"/>
                </svg>`,
            vehicle: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="탈것 여행 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#fff7ed" stroke="#fdba74" stroke-width="2.5"/>
                    <path d="M20 42 L30 26 H70 L82 42 H92 C95 42 96 46 96 50 V56 H16 V46 C16 44 18 42 20 42 Z" fill="#ef4444" stroke="#7f1d1d" stroke-width="2.5" stroke-linejoin="round"/>
                    <rect x="34" y="30" width="14" height="11" rx="2" fill="#bae6fd" stroke="#7f1d1d" stroke-width="1.8"/>
                    <rect x="52" y="30" width="16" height="11" rx="2" fill="#bae6fd" stroke="#7f1d1d" stroke-width="1.8"/>
                    <circle cx="34" cy="57" r="8" fill="#334155" stroke="#0f172a" stroke-width="2"/>
                    <circle cx="34" cy="57" r="3" fill="#e2e8f0"/>
                    <circle cx="76" cy="57" r="8" fill="#334155" stroke="#0f172a" stroke-width="2"/>
                    <circle cx="76" cy="57" r="3" fill="#e2e8f0"/>
                    <rect x="48" y="20" width="10" height="6" rx="2" fill="#facc15" stroke="#b45309" stroke-width="1.5"/>
                </svg>`,
            princess: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="공주 하트 왕관 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#fdf2f8" stroke="#f9a8d4" stroke-width="2.5"/>
                    <path d="M24 58 L20 26 L42 42 L56 18 L70 42 L92 26 L88 58 Z" fill="#fde047" stroke="#be185d" stroke-width="2.5" stroke-linejoin="round"/>
                    <path d="M56 50 C50 44 45 38 49 34 C52 31 55 34 56 36 C57 34 60 31 63 34 C67 38 62 44 56 50 Z" fill="#ec4899" stroke="#9d174d" stroke-width="1.8"/>
                    <circle cx="20" cy="23" r="3.5" fill="#f472b6"/>
                    <circle cx="56" cy="15" r="4" fill="#f472b6"/>
                    <circle cx="92" cy="23" r="3.5" fill="#f472b6"/>
                </svg>`,
            robot: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="로봇 친구 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#eef2ff" stroke="#a5b4fc" stroke-width="2.5"/>
                    <line x1="56" y1="12" x2="56" y2="22" stroke="#312e81" stroke-width="2.5"/>
                    <circle cx="56" cy="11" r="4" fill="#f43f5e"/>
                    <rect x="36" y="22" width="40" height="26" rx="8" fill="#60a5fa" stroke="#1e3a8a" stroke-width="2.5"/>
                    <circle cx="47" cy="34" r="4" fill="#fef08a" stroke="#1e3a8a" stroke-width="1.8"/>
                    <circle cx="65" cy="34" r="4" fill="#fef08a" stroke="#1e3a8a" stroke-width="1.8"/>
                    <path d="M48 42 H64" stroke="#1e3a8a" stroke-width="2.4" stroke-linecap="round"/>
                    <rect x="32" y="51" width="48" height="20" rx="6" fill="#93c5fd" stroke="#1e3a8a" stroke-width="2.5"/>
                    <circle cx="56" cy="61" r="4.5" fill="#34d399" stroke="#1e3a8a" stroke-width="1.8"/>
                </svg>`,
            fruit: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="달콤 과일 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#fef2f2" stroke="#fca5a5" stroke-width="2.5"/>
                    <path d="M56 26 C40 20 26 32 30 50 C33 62 46 66 56 60 C66 66 79 62 82 50 C86 32 72 20 56 26 Z" fill="#ef4444" stroke="#7f1d1d" stroke-width="2.5"/>
                    <path d="M56 26 Q58 14 66 14" fill="none" stroke="#78350f" stroke-width="2.5" stroke-linecap="round"/>
                    <ellipse cx="66" cy="20" rx="9" ry="4.5" fill="#22c55e" stroke="#14532d" stroke-width="1.8" transform="rotate(-20 66 20)"/>
                    <circle cx="46" cy="43" r="2.6" fill="#450a0a"/>
                    <circle cx="66" cy="43" r="2.6" fill="#450a0a"/>
                    <path d="M51 50 Q56 54 61 50" fill="none" stroke="#450a0a" stroke-width="2" stroke-linecap="round"/>
                </svg>`,
            animal: `
                <svg viewBox="0 0 112 80" width="96" height="68" role="img" aria-label="귀여운 동물 친구 일러스트">
                    <rect x="2" y="2" width="108" height="76" rx="18" fill="#fffbeb" stroke="#fcd34d" stroke-width="2.5"/>
                    <ellipse cx="36" cy="28" rx="10" ry="15" fill="#fdba74" stroke="#7c2d12" stroke-width="2.5" transform="rotate(-14 36 28)"/>
                    <ellipse cx="76" cy="28" rx="10" ry="15" fill="#fdba74" stroke="#7c2d12" stroke-width="2.5" transform="rotate(14 76 28)"/>
                    <circle cx="56" cy="44" r="22" fill="#fed7aa" stroke="#7c2d12" stroke-width="2.5"/>
                    <circle cx="48" cy="41" r="2.8" fill="#431407"/>
                    <circle cx="64" cy="41" r="2.8" fill="#431407"/>
                    <ellipse cx="56" cy="48" rx="4.5" ry="3.2" fill="#7c2d12"/>
                    <path d="M50 54 Q56 59 62 54" fill="none" stroke="#7c2d12" stroke-width="2.2" stroke-linecap="round"/>
                </svg>`
        };
        return scenes[cat] || scenes.animal;
    }

    function getShapeRewardSvg(shapeId, fillColor = '#fde047') {
        const shapes = {
            star: `<polygon points="160,20 192,82 262,92 210,138 224,204 160,172 96,204 110,138 58,92 128,82" fill="${fillColor}" stroke="#ca8a04" stroke-width="4" stroke-linejoin="round"/>
                   <circle cx="142" cy="112" r="5" fill="#713f12"/><circle cx="178" cy="112" r="5" fill="#713f12"/>
                   <path d="M148 128 Q160 138 172 128" fill="none" stroke="#713f12" stroke-width="4" stroke-linecap="round"/>`,
            heart: `<path d="M160 66 L210 28 L266 58 L262 122 L160 200 L58 122 L54 58 L110 28 Z" fill="${fillColor}" stroke="#be185d" stroke-width="4" stroke-linejoin="round"/>
                   <circle cx="136" cy="96" r="5" fill="#831843"/><circle cx="184" cy="96" r="5" fill="#831843"/>
                   <path d="M146 116 Q160 128 174 116" fill="none" stroke="#831843" stroke-width="4" stroke-linecap="round"/>`,
            house: `<polygon points="160,24 262,100 238,100 238,196 82,196 82,100 58,100" fill="${fillColor}" stroke="#9a3412" stroke-width="4" stroke-linejoin="round"/>
                   <rect x="136" y="138" width="48" height="58" rx="6" fill="#fef3c7" stroke="#9a3412" stroke-width="3"/>
                   <circle cx="160" cy="78" r="14" fill="#bae6fd" stroke="#9a3412" stroke-width="3"/>`,
            rocket: `<polygon points="160,18 208,78 208,158 248,194 184,176 136,176 72,194 112,158 112,78" fill="${fillColor}" stroke="#1e3a8a" stroke-width="4" stroke-linejoin="round"/>
                   <circle cx="160" cy="108" r="22" fill="#e0f2fe" stroke="#1e3a8a" stroke-width="3.5"/>
                   <polygon points="140,178 160,212 180,178" fill="#fb923c" stroke="#c2410c" stroke-width="2.5"/>`,
            crown: `<polygon points="64,182 52,66 114,116 160,42 206,116 268,66 256,182" fill="${fillColor}" stroke="#b45309" stroke-width="4" stroke-linejoin="round"/>
                   <circle cx="160" cy="138" r="14" fill="#f43f5e" stroke="#9f1239" stroke-width="3"/>
                   <circle cx="106" cy="146" r="10" fill="#38bdf8" stroke="#0369a1" stroke-width="3"/>
                   <circle cx="214" cy="146" r="10" fill="#38bdf8" stroke="#0369a1" stroke-width="3"/>`,
            fish: `<polygon points="66,112 120,46 196,46 242,106 278,68 278,156 242,118 196,178 120,178" fill="${fillColor}" stroke="#0e7490" stroke-width="4" stroke-linejoin="round"/>
                   <circle cx="114" cy="104" r="7" fill="#0f172a"/><circle cx="112" cy="102" r="2.2" fill="#ffffff"/>
                   <path d="M96 128 Q112 138 126 126" fill="none" stroke="#0e7490" stroke-width="3.5" stroke-linecap="round"/>`
        };
        return shapes[shapeId] || shapes.star;
    }

    function getColoringSvg(templateId = 'dino') {
        const templates = {
            dino: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="아기 공룡 색칠 도안">
                    <path data-color-part="0" d="M56 172 Q40 162 48 140 Q62 122 86 130 L96 86 Q102 42 138 38 Q166 36 172 64 Q174 84 156 96 L152 120 Q204 114 232 146 L264 166 Q236 184 204 176 L204 198 H174 V178 H122 V198 H92 V176 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <path data-color-part="1" d="M120 124 Q142 118 158 134 Q162 162 134 172 Q112 162 120 124 Z" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <polygon data-color-part="2" points="164,96 186,86 178,112" fill="#ffffff" stroke="#1e293b" stroke-width="3.5" stroke-linejoin="round"/>
                    <polygon data-color-part="3" points="184,110 208,104 198,126" fill="#ffffff" stroke="#1e293b" stroke-width="3.5" stroke-linejoin="round"/>
                    <ellipse data-color-part="4" cx="268" cy="144" rx="24" ry="30" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <circle cx="144" cy="58" r="4.5" fill="#1e293b"/>
                    <path d="M132 74 Q144 82 156 72" fill="none" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/>
                </svg>`,
            rocket: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="우주 로켓 색칠 도안">
                    <path data-color-part="0" d="M160 18 C186 44 196 74 196 78 H124 C124 74 134 44 160 18 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <path data-color-part="1" d="M124 78 H196 V154 H124 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <circle data-color-part="2" cx="160" cy="112" r="22" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <polygon data-color-part="3" points="124,118 82,166 124,154" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <polygon data-color-part="4" points="196,118 238,166 196,154" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <polygon data-color-part="5" points="136,154 160,204 184,154" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <polygon data-color-part="6" points="58,52 66,68 84,70 70,82 74,98 58,90 42,98 46,82 32,70 50,68" fill="#ffffff" stroke="#1e293b" stroke-width="3.5" stroke-linejoin="round"/>
                </svg>`,
            princess_crown: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="반짝 왕관 색칠 도안">
                    <polygon data-color-part="0" points="60,168 46,64 110,108 160,36 210,108 274,64 260,168" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <rect data-color-part="1" x="60" y="168" width="200" height="24" rx="10" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <path data-color-part="2" d="M160 144 C142 128 128 112 140 98 C150 88 158 98 160 104 C162 98 170 88 180 98 C192 112 178 128 160 144 Z" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle data-color-part="3" cx="98" cy="134" r="14" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle data-color-part="4" cx="222" cy="134" r="14" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle data-color-part="5" cx="160" cy="24" r="10" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                </svg>`,
            car: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="꼬마 자동차 색칠 도안">
                    <path data-color-part="0" d="M84 96 L114 48 H206 L236 96 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <rect data-color-part="1" x="42" y="96" width="236" height="62" rx="22" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <rect data-color-part="2" x="104" y="60" width="48" height="32" rx="6" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <rect data-color-part="3" x="166" y="60" width="48" height="32" rx="6" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle data-color-part="4" cx="98" cy="162" r="28" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <circle data-color-part="5" cx="222" cy="162" r="28" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <circle cx="98" cy="162" r="11" fill="#ffffff" stroke="#1e293b" stroke-width="3"/>
                    <circle cx="222" cy="162" r="11" fill="#ffffff" stroke="#1e293b" stroke-width="3"/>
                </svg>`,
            whale: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="아기 고래 색칠 도안">
                    <path data-color-part="0" d="M46 134 C46 82 96 64 158 70 C206 74 226 108 242 122 L276 86 L268 128 L286 156 L236 144 C210 168 62 176 46 134 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <path data-color-part="1" d="M68 148 Q128 134 196 148 Q144 170 68 148 Z" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle data-color-part="2" cx="256" cy="44" r="20" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <path data-color-part="3" d="M132 68 Q122 36 102 44 Q112 24 134 46 Q148 22 162 42 Q144 48 136 68 Z" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle cx="96" cy="112" r="5" fill="#1e293b"/>
                    <path d="M84 128 Q98 138 112 128" fill="none" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/>
                </svg>`,
            robot: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="멋진 로봇 색칠 도안">
                    <line x1="160" y1="22" x2="160" y2="44" stroke="#1e293b" stroke-width="4"/>
                    <circle data-color-part="0" cx="160" cy="20" r="10" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <rect data-color-part="1" x="104" y="44" width="112" height="66" rx="18" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <circle data-color-part="2" cx="136" cy="72" r="11" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle data-color-part="3" cx="184" cy="72" r="11" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <rect data-color-part="4" x="92" y="116" width="136" height="74" rx="16" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <polygon data-color-part="5" points="160,130 168,146 186,148 172,160 176,176 160,168 144,176 148,160 134,148 152,146" fill="#ffffff" stroke="#1e293b" stroke-width="3.2"/>
                    <rect data-color-part="6" x="56" y="122" width="30" height="54" rx="12" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <rect data-color-part="7" x="234" y="122" width="30" height="54" rx="12" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                </svg>`,
            cat: `
                <svg viewBox="0 0 320 220" class="coloring-svg" role="img" aria-label="야옹 고양이 색칠 도안">
                    <polygon data-color-part="0" points="92,76 80,24 134,54" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <polygon data-color-part="1" points="228,76 240,24 186,54" fill="#ffffff" stroke="#1e293b" stroke-width="4" stroke-linejoin="round"/>
                    <ellipse data-color-part="2" cx="160" cy="100" rx="68" ry="54" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <path data-color-part="3" d="M108 150 C96 176 106 202 160 202 C214 202 224 176 212 150 Z" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
                    <path data-color-part="4" d="M160 190 C148 178 138 168 146 160 C152 154 158 160 160 164 C162 160 168 154 174 160 C182 168 172 178 160 190 Z" fill="#ffffff" stroke="#1e293b" stroke-width="3.5"/>
                    <circle cx="136" cy="92" r="5" fill="#1e293b"/><circle cx="184" cy="92" r="5" fill="#1e293b"/>
                    <polygon points="154,104 166,104 160,112" fill="#1e293b"/>
                    <path d="M144 120 Q160 130 176 120" fill="none" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/>
                </svg>`
        };
        return templates[templateId] || templates.dino;
    }

    window.StudyIllustrations = {
        resolveThemeCategory,
        getThemeBannerSvg,
        getShapeRewardSvg,
        getColoringSvg
    };
})();
