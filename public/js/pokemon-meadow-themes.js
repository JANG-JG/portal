/**
 * ==============================================================================
 * 우리 가족 포켓몬 광장 다중 배경 테마 빌더 (pokemon-meadow-themes.js)
 * ------------------------------------------------------------------------------
 * - 초원('meadow') 외 4가지 가족 광장 배경(햇살 분수 공원·푸른 해변·별빛 캠프·벚꽃 마을)
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */
(function () {
    'use strict';

    const THEME_CATALOG = [
        { id: 'park', emoji: '⛲', label: '분수 공원' },
        { id: 'beach', emoji: '🏖️', label: '푸른 해변' },
        { id: 'starry', emoji: '🌌', label: '별빛 캠프' },
        { id: 'sakura', emoji: '🌸', label: '벚꽃 마을' },
        { id: 'meadow', emoji: '🌿', label: '초록 들판' }
    ];

    function buildBackdrop(themeId) {
        const theme = String(themeId || 'meadow').trim();
        if (theme === 'park') {
            return `<div class="pokemon-meadow__sky pokemon-meadow__sky--park" aria-hidden="true">
                <div class="pokemon-meadow__sun"></div>
                <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--1" viewBox="0 0 80 30"><path d="M16 25 H65 C72 25 76 20 75 15 C74 10 68 8 63 10 C60 4 51 2 44 6 C38 2 27 4 24 11 C17 10 10 14 10 19 C10 23 13 25 16 25 Z" fill="#ffffff" fill-opacity="0.92"/></svg>
            </div>
            <svg class="pokemon-meadow__hills" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 58 Q140 34 300 54 T600 46 L600 110 L0 110 Z" fill="#a7f3d0" fill-opacity="0.65"/>
                <rect x="0" y="72" width="600" height="38" fill="#fef3c7" fill-opacity="0.92"/>
                <path d="M0 74 H600 M0 90 H600" stroke="#fcd34d" stroke-width="1.4" stroke-dasharray="14 8" opacity="0.65"/>
                <circle cx="88" cy="48" r="18" fill="#4ade80" opacity="0.88"/><rect x="85" y="60" width="6" height="16" fill="#92400e"/>
                <circle cx="515" cy="46" r="20" fill="#34d399" opacity="0.85"/><rect x="512" y="60" width="6" height="16" fill="#92400e"/>
                <ellipse cx="300" cy="83" rx="52" ry="12" fill="#93c5fd" stroke="#60a5fa" stroke-width="2"/>
                <path d="M294 78 Q284 56 270 66 M306 78 Q316 56 330 66 M300 78 L300 52" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" fill="none"/>
                <rect x="160" y="66" width="38" height="7" rx="2" fill="#b45309"/><rect x="166" y="73" width="4" height="7" fill="#78350f"/><rect x="188" y="73" width="4" height="7" fill="#78350f"/>
            </svg>`;
        }
        if (theme === 'beach') {
            return `<div class="pokemon-meadow__sky pokemon-meadow__sky--beach" aria-hidden="true">
                <div class="pokemon-meadow__sun"></div>
                <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--1" viewBox="0 0 80 30"><path d="M16 25 H65 C72 25 76 20 75 15 C74 10 68 8 63 10 C60 4 51 2 44 6 C38 2 27 4 24 11 C17 10 10 14 10 19 C10 23 13 25 16 25 Z" fill="#ffffff" fill-opacity="0.92"/></svg>
            </div>
            <svg class="pokemon-meadow__hills" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="42" width="600" height="34" fill="#38bdf8" fill-opacity="0.72"/>
                <path d="M0 54 Q75 48 150 54 T300 54 T450 54 T600 54" stroke="#ffffff" stroke-width="2.2" fill="none" opacity="0.75"/>
                <path d="M0 70 Q180 62 360 72 T600 68 L600 110 L0 110 Z" fill="#fde68a"/>
                <path d="M52 72 Q58 44 68 30" stroke="#92400e" stroke-width="5" stroke-linecap="round" fill="none"/>
                <path d="M68 30 Q44 20 34 32 M68 30 Q62 12 80 20 M68 30 Q92 22 98 34 M68 30 Q84 36 88 46" stroke="#16a34a" stroke-width="4" stroke-linecap="round" fill="none"/>
                <circle cx="486" cy="88" r="10" fill="#fb7185"/><path d="M477 88 A10 10 0 0 1 495 88" fill="#facc15"/>
                <text x="155" y="96" font-size="14">⭐</text><text x="390" y="94" font-size="13">🐚</text>
            </svg>`;
        }
        if (theme === 'starry') {
            return `<div class="pokemon-meadow__sky pokemon-meadow__sky--starry" aria-hidden="true">
                <div class="plaza-moon" aria-hidden="true"></div>
            </div>
            <svg class="pokemon-meadow__hills" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
                <circle cx="65" cy="20" r="1.8" fill="#fef08a"/><circle cx="148" cy="14" r="1.5" fill="#ffffff"/>
                <circle cx="240" cy="24" r="2.1" fill="#fde047"/><circle cx="350" cy="16" r="1.6" fill="#ffffff"/>
                <circle cx="460" cy="22" r="2" fill="#fef08a"/><circle cx="535" cy="12" r="1.5" fill="#ffffff"/>
                <path d="M0 54 Q150 28 310 52 T600 44 L600 110 L0 110 Z" fill="#1e293b" fill-opacity="0.88"/>
                <path d="M0 72 Q210 62 410 74 T600 68 L600 110 L0 110 Z" fill="#0f766e" fill-opacity="0.75"/>
                <polygon points="94,76 122,40 150,76" fill="#f59e0b"/><polygon points="118,76 122,58 128,76" fill="#78350f"/>
                <circle cx="300" cy="84" r="12" fill="#fb923c" opacity="0.32"/>
                <path d="M294 86 Q300 66 306 86 Z" fill="#f97316"/><path d="M297 86 Q300 73 303 86 Z" fill="#fde047"/>
                <polygon points="480,72 496,38 512,72" fill="#115e59"/><polygon points="518,74 534,42 550,74" fill="#134e4a"/>
            </svg>`;
        }
        if (theme === 'sakura') {
            return `<div class="pokemon-meadow__sky pokemon-meadow__sky--sakura" aria-hidden="true">
                <div class="pokemon-meadow__sun"></div>
                <svg class="pokemon-meadow__cloud pokemon-meadow__cloud--1" viewBox="0 0 80 30"><path d="M16 25 H65 C72 25 76 20 75 15 C74 10 68 8 63 10 C60 4 51 2 44 6 C38 2 27 4 24 11 C17 10 10 14 10 19 C10 23 13 25 16 25 Z" fill="#ffffff" fill-opacity="0.92"/></svg>
            </div>
            <svg class="pokemon-meadow__hills" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 56 Q160 32 330 56 T600 46 L600 110 L0 110 Z" fill="#fbcfe8" fill-opacity="0.62"/>
                <rect x="0" y="76" width="600" height="34" fill="#fed7aa" fill-opacity="0.88"/>
                <path d="M0 84 H600 M0 96 H600" stroke="#fdba74" stroke-width="1.3" opacity="0.65"/>
                <circle cx="74" cy="42" r="24" fill="#f9a8d4" opacity="0.9"/><circle cx="96" cy="48" r="18" fill="#f472b6" opacity="0.82"/><rect x="78" y="56" width="7" height="22" fill="#78350f"/>
                <circle cx="520" cy="40" r="26" fill="#f9a8d4" opacity="0.9"/><circle cx="496" cy="48" r="18" fill="#f472b6" opacity="0.8"/><rect x="514" y="56" width="7" height="22" fill="#78350f"/>
                <circle cx="210" cy="34" r="3" fill="#f472b6"/><circle cx="340" cy="42" r="2.8" fill="#fbcfe8"/><circle cx="415" cy="28" r="3" fill="#f472b6"/>
            </svg>`;
        }
        return null;
    }

    window.PokemonMeadowThemes = { THEME_CATALOG, buildBackdrop };
})();
