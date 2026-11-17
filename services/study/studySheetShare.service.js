/**
 * ==============================================================================
 * 아이들 간 동일 난이도 학습지 교차 출제 & 스키마 확장 서비스 (studySheetShare.service.js)
 * ------------------------------------------------------------------------------
 * - 저장된 학습지 중 다른 아이에게 먼저 생성·저장된 동일 난이도(subject+level+theme)
 *   문제를 아직 받지 않은 아이에게 교차 출제하여 AI 쿼터를 절약하고 즉시 발급
 * - 보기(choices / shuffledRights) 순서는 아이마다 새로 섞어 암기 방지
 * - [규칙 2] 100% 한국어 | [규칙 3] 500줄 이하 모듈화
 * ==============================================================================
 */

const {
    dbGet,
    dbAll,
    dbRun,
    normalizeChildId,
    normalizeSubject,
    getChildLevels,
    getProfiles,
    getSystemConfig,
    setSystemConfig
} = require('./studyDb.service');

const CROSS_SHARE_KEY = 'study_cross_share_enabled';
const SHAREABLE_SUBJECTS = new Set(['korean', 'math', 'english']);
const PLAY_TYPES = new Set(['dot_to_dot', 'maze', 'color']);

let schemaReadyPromise = null;

function ensureSheetExtensions() {
    if (schemaReadyPromise) return schemaReadyPromise;
    schemaReadyPromise = (async () => {
        await dbRun('ALTER TABLE study_sheets ADD COLUMN origin_sheet_id INTEGER').catch(() => {});
        await dbRun("ALTER TABLE study_sheets ADD COLUMN shared_from_child_id TEXT DEFAULT ''").catch(() => {});
        await dbRun("ALTER TABLE study_sheets ADD COLUMN last_result_json TEXT DEFAULT ''").catch(() => {});
        await dbRun('CREATE INDEX IF NOT EXISTS idx_study_sheets_origin ON study_sheets (origin_sheet_id, child_id)').catch(() => {});
        await dbRun('CREATE INDEX IF NOT EXISTS idx_study_sheets_share_lookup ON study_sheets (subject, level, theme, origin_sheet_id)').catch(() => {});
    })().catch((err) => {
        schemaReadyPromise = null;
        throw err;
    });
    return schemaReadyPromise;
}

async function isCrossShareEnabled() {
    const val = await getSystemConfig(CROSS_SHARE_KEY, '1');
    return String(val) !== '0';
}

async function setCrossShareEnabled(enabled) {
    await setSystemConfig(CROSS_SHARE_KEY, enabled ? '1' : '0');
    return Boolean(enabled);
}

function shuffleClone(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function cloneAndShuffleWorksheetContent(content) {
    if (!content || !Array.isArray(content.blocks)) return null;
    const cloned = JSON.parse(JSON.stringify(content));
    cloned.blocks = cloned.blocks.map((blk) => {
        const next = { ...blk };
        if (Array.isArray(next.choices) && next.choices.length > 1) {
            next.choices = shuffleClone(next.choices);
        }
        if (next.type === 'match' && Array.isArray(next.pairs) && next.pairs.length > 1) {
            next.shuffledRights = shuffleClone(next.pairs.map((p) => p.right));
        }
        return next;
    });
    return cloned;
}

function hasPlayBlockInContent(content) {
    const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
    return blocks.some((b) => PLAY_TYPES.has(b?.type));
}

async function findAndAssignCrossChildWorksheet({
    childId,
    subject,
    theme = '동물 친구',
    includePlayBlock = true,
    createdBy = 'web'
}) {
    if (!(await isCrossShareEnabled())) return null;
    const cid = normalizeChildId(childId);
    const subj = normalizeSubject(subject);
    if (!SHAREABLE_SUBJECTS.has(subj)) return null;

    await ensureSheetExtensions();

    const levels = await getChildLevels(cid);
    const targetLevel = levels[subj] || 1;
    const cleanTheme = String(theme || '동물 친구').trim().slice(0, 24) || '동물 친구';
    const wantPlay = includePlayBlock !== false;

    const candidates = await dbAll(
        `SELECT id, child_id, subject, level, theme, title, source, content_json
         FROM study_sheets candidate
         WHERE candidate.origin_sheet_id IS NULL
           AND candidate.child_id != ?
           AND candidate.subject = ?
           AND candidate.level = ?
           AND candidate.theme = ?
           AND candidate.source != 'coloring_studio'
           AND candidate.source NOT LIKE 'review%'
           AND NOT EXISTS (
               SELECT 1 FROM study_sheets mine
               WHERE mine.child_id = ?
                 AND COALESCE(mine.origin_sheet_id, mine.id) = candidate.id
           )
         ORDER BY CASE WHEN candidate.source LIKE 'gemini%' THEN 0 ELSE 1 END, candidate.id DESC
         LIMIT 20`,
        [cid, subj, targetLevel, cleanTheme, cid]
    );

    if (!candidates.length) return null;

    let picked = null;
    let parsedContent = null;
    for (const row of candidates) {
        let parsed = null;
        try { parsed = JSON.parse(row.content_json); } catch (_) { parsed = null; }
        if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length < 4) continue;
        if (hasPlayBlockInContent(parsed) !== wantPlay) continue;
        picked = row;
        parsedContent = parsed;
        break;
    }

    if (!picked || !parsedContent) return null;

    const shuffledContent = cloneAndShuffleWorksheetContent(parsedContent);
    if (!shuffledContent) return null;

    const profiles = await getProfiles().catch(() => []);
    const fromProfile = profiles.find((p) => p.id === picked.child_id);
    const sharedFromName = fromProfile?.display_name || (picked.child_id === 'first' ? '첫째' : (picked.child_id === 'second' ? '둘째' : picked.child_id));

    const res = await dbRun(
        `INSERT INTO study_sheets
            (child_id, subject, level, theme, title, source, content_json, created_by, origin_sheet_id, shared_from_child_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            cid,
            subj,
            targetLevel,
            cleanTheme,
            picked.title,
            picked.source,
            JSON.stringify(shuffledContent),
            createdBy,
            picked.id,
            picked.child_id
        ]
    );

    return {
        id: res.lastID,
        childId: cid,
        child_id: cid,
        subject: subj,
        level: targetLevel,
        theme: cleanTheme,
        title: picked.title,
        source: picked.source,
        origin_sheet_id: picked.id,
        shared_from_child_id: picked.child_id,
        sharedFromName,
        content: shuffledContent,
        crossShared: true
    };
}

module.exports = {
    ensureSheetExtensions,
    isCrossShareEnabled,
    setCrossShareEnabled,
    findAndAssignCrossChildWorksheet
};
