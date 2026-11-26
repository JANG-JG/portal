/**
 * ==============================================================================
 * 일상 학습 숙달도 기반 승급 제안 판정 서비스 (studyPromotion.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * - 현재 레벨에서 최소 3회 이상 완료 + 최근 3회 평균 정답률 85% 이상일 때 승급 제안
 * ==============================================================================
 */

const {
    normalizeChildId,
    normalizeSubject,
    VALID_SUBJECTS,
    getChildLevels,
    setChildLevel,
    dbAll
} = require('./studyDb.service');

const PROMOTION_MIN_SHEETS = 3;
const PROMOTION_MIN_ACCURACY = 0.85;
const MAX_STUDY_LEVEL = 5;

function parseSheetAccuracy(row) {
    try {
        const parsed = JSON.parse(row.last_result_json || '{}');
        const total = Number(parsed.totalScored || 0);
        const correct = Number(parsed.correctCount || 0);
        if (total > 0) {
            return { scored: true, ratio: Math.min(1, Math.max(0, correct / total)) };
        }
    } catch (_) {
        /* ignore malformed json */
    }
    return { scored: false, ratio: 1 };
}

async function evaluateLevelPromotion(childId, subject) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    if (!VALID_SUBJECTS.has(subj) || subj === 'coloring') {
        return { eligible: false, reason: 'unsupported_subject' };
    }

    const levels = await getChildLevels(cid);
    const currentLevel = Number(levels[subj] || 1);
    if (currentLevel >= MAX_STUDY_LEVEL) {
        return { eligible: false, currentLevel, reason: 'max_level' };
    }

    const rows = await dbAll(
        `SELECT id, level, last_result_json, completed_at
         FROM study_sheets
         WHERE child_id = ? AND subject = ? AND level = ? AND completed_at IS NOT NULL
         ORDER BY completed_at DESC, id DESC
         LIMIT 5`,
        [cid, subj, currentLevel]
    );

    if (!rows || rows.length < PROMOTION_MIN_SHEETS) {
        return {
            eligible: false,
            currentLevel,
            completedAtLevel: rows ? rows.length : 0,
            requiredSheets: PROMOTION_MIN_SHEETS,
            reason: 'insufficient_sheets'
        };
    }

    const recent = rows.slice(0, PROMOTION_MIN_SHEETS);
    const accuracies = recent.map(parseSheetAccuracy);
    const avgRatio = accuracies.reduce((sum, item) => sum + item.ratio, 0) / recent.length;
    const avgAccuracyPct = Math.round(avgRatio * 100);

    if (avgRatio < PROMOTION_MIN_ACCURACY) {
        return {
            eligible: false,
            currentLevel,
            nextLevel: currentLevel + 1,
            recentCount: recent.length,
            avgAccuracyPct,
            reason: 'accuracy_below_threshold'
        };
    }

    return {
        eligible: true,
        subject: subj,
        currentLevel,
        nextLevel: currentLevel + 1,
        recentCount: recent.length,
        avgAccuracyPct
    };
}

async function acceptLevelPromotion(childId, subject) {
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    const check = await evaluateLevelPromotion(cid, subj);

    if (!check.eligible) {
        return {
            promoted: false,
            ...check,
            message: '아직 다음 레벨 승급 조건이 충족되지 않았어요.'
        };
    }

    const newLevel = await setChildLevel(cid, subj, check.nextLevel);
    return {
        promoted: true,
        childId: cid,
        subject: subj,
        previousLevel: check.currentLevel,
        newLevel,
        avgAccuracyPct: check.avgAccuracyPct,
        message: `축하해요! Lv.${newLevel}로 한 단계 올라갔어요! 🎉`
    };
}

module.exports = {
    PROMOTION_MIN_SHEETS,
    PROMOTION_MIN_ACCURACY,
    evaluateLevelPromotion,
    acceptLevelPromotion
};
