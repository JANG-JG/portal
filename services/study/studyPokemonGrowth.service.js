/**
 * ==============================================================================
 * 어린이 학습실 포켓몬 성장·컨디션·시너지·스킬 서비스 (studyPokemonGrowth.service.js)
 * ------------------------------------------------------------------------------
 * - 부드러운 컨디션(오늘 완료=기분 최고 / 1일=하품·배고픔 / 2일+=낮잠)
 * - 과목 ↔ 포켓몬 타입 시너지(XP 1.5배) & 부족 과목 추천(XP 2배, 중복 2.5배)
 * - 학습 완료 시 XP 지급, 레벨업(50 XP/Lv), 레벨별 초원 기술 해금
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const { portalDb } = require('../db');

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        portalDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

const TYPE_TO_SUBJECTS = {
    electric: ['math', 'coding', 'logic'],
    steel: ['math', 'coding', 'logic'],
    rock: ['math', 'logic'],
    psychic: ['korean', 'reading', 'english', 'hangul'],
    fairy: ['korean', 'reading', 'english', 'hangul'],
    ghost: ['korean', 'reading', 'english'],
    grass: ['science', 'nature', 'hanja'],
    water: ['science', 'nature', 'hanja'],
    bug: ['science', 'nature'],
    ice: ['science', 'nature'],
    fire: ['social', 'history', 'creative', 'art'],
    fighting: ['social', 'history', 'creative'],
    dragon: ['social', 'history', 'creative'],
    normal: ['creative', 'art', 'hangul'],
    flying: ['creative', 'social']
};

const CORE_SUBJECT_POOL = ['korean', 'math', 'english', 'science', 'social', 'reading', 'hanja'];

const SKILL_BY_TYPE = {
    electric: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'thundershock', name: '전기쇼크', emoji: '⚡', effect: 'electric', minLevel: 3 },
        { id: 'thunderbolt', name: '10만볼트', emoji: '🌩️', effect: 'electric_max', minLevel: 6 }
    ],
    fire: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'ember', name: '불꽃세례', emoji: '🔥', effect: 'fire', minLevel: 3 },
        { id: 'flamethrower', name: '화염방사', emoji: '🌋', effect: 'fire_max', minLevel: 6 }
    ],
    water: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'watergun', name: '물대포', emoji: '💧', effect: 'water', minLevel: 3 },
        { id: 'hydropump', name: '하이드로펌프', emoji: '🌊', effect: 'water_max', minLevel: 6 }
    ],
    grass: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'vinewhip', name: '덩굴채찍', emoji: '🌿', effect: 'grass', minLevel: 3 },
        { id: 'solarbeam', name: '솔라빔', emoji: '☀️', effect: 'grass_max', minLevel: 6 }
    ],
    psychic: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'confusion', name: '염동력', emoji: '🔮', effect: 'psychic', minLevel: 3 },
        { id: 'psychic', name: '사이코키네시스', emoji: '🌌', effect: 'psychic_max', minLevel: 6 }
    ],
    fairy: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'fairywind', name: '요정의바람', emoji: '✨', effect: 'fairy', minLevel: 3 },
        { id: 'dazzling', name: '매지컬샤인', emoji: '🌈', effect: 'fairy_max', minLevel: 6 }
    ],
    fighting: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'aurasphere', name: '파동탄', emoji: '🥊', effect: 'impact', minLevel: 3 },
        { id: 'closecombat', name: '인파이트', emoji: '💥', effect: 'fire_max', minLevel: 6 }
    ],
    ghost: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'shadowsneak', name: '야습', emoji: '👻', effect: 'psychic', minLevel: 3 },
        { id: 'shadowball', name: '섀도볼', emoji: '🌑', effect: 'psychic_max', minLevel: 6 }
    ],
    normal: [
        { id: 'tackle', name: '몸통박치기', emoji: '💫', effect: 'impact', minLevel: 1 },
        { id: 'swift', name: '스피드스타', emoji: '⭐', effect: 'fairy', minLevel: 3 },
        { id: 'hyperbeam', name: '파괴광선', emoji: '🌟', effect: 'fairy_max', minLevel: 6 }
    ]
};

function getKstDateParts(offsetDays = 0) {
    const now = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
    return now.toISOString().slice(0, 10);
}

function getUnlockedSkills(typeKey = 'normal', level = 1) {
    const list = SKILL_BY_TYPE[typeKey] || SKILL_BY_TYPE.normal;
    const lv = Math.max(1, Number(level || 1));
    return list.map((s) => ({
        ...s,
        unlocked: lv >= s.minLevel
    }));
}

async function getPokemonCondition(childId) {
    const cid = String(childId || 'first').trim() || 'first';
    const row = await dbGet(
        `SELECT date(completed_at) AS last_date
         FROM study_sheets
         WHERE child_id = ? AND status = 'completed' AND completed_at IS NOT NULL
         ORDER BY completed_at DESC LIMIT 1`,
        [cid]
    );
    const today = getKstDateParts(0);
    const yesterday = getKstDateParts(-1);
    const lastDate = row?.last_date || '';

    if (lastDate >= today) {
        return {
            statusKey: 'happy',
            label: '기분 최고! 🌟',
            moodEmoji: '🌟',
            bubble: '오늘도 최고야! 신나게 같이 놀자!',
            daysSinceStudy: 0
        };
    }
    if (lastDate === yesterday) {
        return {
            statusKey: 'hungry',
            label: '하품 · 배고파요 🥱',
            moodEmoji: '🥱',
            bubble: '꼬르륵~ 오늘 문제 1장만 같이 풀자!',
            daysSinceStudy: 1
        };
    }
    return {
        statusKey: 'sleepy',
        label: '이불 덮고 낮잠 😴',
        moodEmoji: '😴',
        bubble: '쿨쿨... 문제 1장 풀면 눈이 번쩍 떠질 거야!',
        daysSinceStudy: lastDate ? 2 : 99
    };
}

async function getSubjectSynergyOverview(childId, partnerTypeKey = 'normal') {
    const cid = String(childId || 'first').trim() || 'first';
    const sinceDate = getKstDateParts(-6);
    const rows = await dbAll(
        `SELECT subject, COUNT(*) AS cnt
         FROM study_sheets
         WHERE child_id = ? AND status = 'completed' AND date(completed_at) >= ?
         GROUP BY subject`,
        [cid, sinceDate]
    );
    const countMap = {};
    for (const r of rows) {
        countMap[String(r.subject || '').toLowerCase()] = Number(r.cnt || 0);
    }

    const sortedSubjects = [...CORE_SUBJECT_POOL].sort((a, b) => (countMap[a] || 0) - (countMap[b] || 0));
    const minCount = countMap[sortedSubjects[0]] || 0;
    const underplayedSet = new Set(
        sortedSubjects.filter((sub, idx) => idx < 2 && (countMap[sub] || 0) <= minCount + 1)
    );
    const synergySubjects = new Set(TYPE_TO_SUBJECTS[partnerTypeKey] || TYPE_TO_SUBJECTS.normal);

    const bySubject = {};
    const allSubjects = new Set([...CORE_SUBJECT_POOL, ...synergySubjects, ...Object.keys(countMap)]);
    for (const sub of allSubjects) {
        const isSynergy = synergySubjects.has(sub);
        const isUnderplayed = underplayedSet.has(sub);
        let xpMultiplier = 1;
        let badgeText = '';
        if (isSynergy && isUnderplayed) {
            xpMultiplier = 2.5;
            badgeText = '🌟 단짝+응원 XP 2.5배';
        } else if (isUnderplayed) {
            xpMultiplier = 2.0;
            badgeText = '🐾 응원 과목 XP 2배';
        } else if (isSynergy) {
            xpMultiplier = 1.5;
            badgeText = '⚡ 타입 시너지 XP 1.5배';
        }
        bySubject[sub] = { isSynergy, isUnderplayed, xpMultiplier, badgeText };
    }

    return {
        partnerTypeKey,
        underplayedSubjects: [...underplayedSet],
        synergySubjects: [...synergySubjects],
        bySubject
    };
}

async function grantStudyPokemonXp(childId, pokemonId, partnerTypeKey, subjectKey, score = 0) {
    const cid = String(childId || 'first').trim() || 'first';
    const pid = Number(pokemonId || 0);
    if (!pid) return null;

    const overview = await getSubjectSynergyOverview(cid, partnerTypeKey || 'normal');
    const subInfo = overview.bySubject[String(subjectKey || '').toLowerCase()] || { xpMultiplier: 1, badgeText: '' };
    const baseXp = Number(score || 0) >= 100 ? 25 : 20;
    const gainedXp = Math.round(baseXp * Number(subInfo.xpMultiplier || 1));

    const existing = await dbGet(
        'SELECT exp, level FROM study_pokemon_affection WHERE child_id = ? AND pokemon_id = ?',
        [cid, pid]
    );
    const prevExp = Number(existing?.exp || 0);
    const prevLevel = Number(existing?.level || 1);
    const newExp = prevExp + gainedXp;
    const newLevel = Math.max(1, Math.floor(newExp / 50) + 1);

    await dbRun(
        `INSERT INTO study_pokemon_affection (child_id, pokemon_id, exp, level, updated_at)
         VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(child_id, pokemon_id) DO UPDATE SET
            exp = ?,
            level = ?,
            updated_at = datetime('now', 'localtime')`,
        [cid, pid, newExp, newLevel, newExp, newLevel]
    );

    const skills = getUnlockedSkills(partnerTypeKey || 'normal', newLevel);
    const newlyUnlockedSkills = newLevel > prevLevel
        ? skills.filter((s) => s.minLevel > prevLevel && s.minLevel <= newLevel)
        : [];

    return {
        pokemonId: pid,
        gainedXp,
        xpMultiplier: subInfo.xpMultiplier,
        bonusLabel: subInfo.badgeText,
        exp: newExp,
        prevLevel,
        level: newLevel,
        leveledUp: newLevel > prevLevel,
        skills,
        newlyUnlockedSkills
    };
}

module.exports = {
    getPokemonCondition,
    getSubjectSynergyOverview,
    getUnlockedSkills,
    grantStudyPokemonXp
};
