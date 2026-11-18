/**
 * ==============================================================================
 * 어린이 적응형 학습실 페이지 & API 라우터 (study.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적 한국어 인터페이스
 * [규칙 3] 500줄 이하 모듈화 준수
 * - 인증된 가족·관리자·어린이(kid) 모두 이용 가능
 * - 레벨 수동 조절은 부모 잠금(PIN 또는 1.5초 길게 누르기) 검증 필수
 * ==============================================================================
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { STATIC_ASSET_VERSION } = require('../config/constants');
const {
    normalizeChildId,
    normalizeSubject,
    getChildDashboardState,
    setChildLevel,
    adjustChildLevel,
    markWorksheetCompletedOnly,
    deleteStampById,
    removeLastStamp,
    setStampBoardCount,
    resetCurrentStampBoard,
    updateStampEntry,
    getWorksheetById,
    updateWorksheetContent,
    verifyParentLockPin,
    getSystemConfig
} = require('../services/study/studyDb.service');
const { generateAndSaveWorksheet } = require('../services/study/geminiWorksheet.service');
const { regenerateSingleBlock } = require('../services/study/worksheetValidator.service');
const {
    consumePregeneratedWorksheet,
    scheduleReplenish,
    warmWorksheetTts
} = require('../services/study/studyPreGen.service');
const { findAndAssignCrossChildWorksheet } = require('../services/study/studySheetShare.service');
const { gradeAndSubmitWorksheet } = require('../services/study/studyWrongNote.service');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function sendStudyHtml(res, relPath) {
    try {
        const fullPath = path.join(PUBLIC_DIR, relPath);
        let html = fs.readFileSync(fullPath, 'utf8');
        const v = STATIC_ASSET_VERSION || Date.now();
        html = html.replace(/(href|src)="(\/(?:css|js|vendor)\/[^"?#]+)(\?v=[^"]*)?"/g, `$1="$2?v=${v}"`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.send(html);
    } catch (err) {
        console.error(`학습실 HTML 렌더링 오류 (${relPath}):`, err);
        res.status(500).send('학습실 화면을 불러오는 중 오류가 발생했습니다.');
    }
}

// ------------------------------------------------------------------------------
// 1. 전용 학습실 HTML 뷰 (/study, /study/test, /study/sheet/:id, /study/review)
// ------------------------------------------------------------------------------
router.get(['/study', '/study/', '/study/index.html'], authenticateToken, (req, res) => {
    sendStudyHtml(res, 'study/index.html');
});

router.get('/study/test', authenticateToken, (req, res) => {
    sendStudyHtml(res, 'study/test.html');
});

router.get('/study/sheet/:id', authenticateToken, (req, res) => {
    sendStudyHtml(res, 'study/sheet.html');
});

router.get('/study/review', authenticateToken, (req, res) => {
    sendStudyHtml(res, 'study/review.html');
});

router.get('/study/parents', authenticateToken, (req, res) => {
    sendStudyHtml(res, 'study/parents.html');
});

// ------------------------------------------------------------------------------
// 2. 학습실 대시보드 & 레벨/도장 API (/api/study/*)
// ------------------------------------------------------------------------------
router.get('/api/study/dashboard', authenticateToken, async (req, res) => {
    try {
        const requestedChild = req.query.childId ? String(req.query.childId).trim() : '';
        const state = await getChildDashboardState(requestedChild, req.user);
        if (state?.pokemon?.enabled && state?.childId) {
            const { getActiveVisitingGuestsForMeadow } = require('../services/study/studyPokemonSocial.service');
            state.pokemon.visitingGuests = await getActiveVisitingGuestsForMeadow(state.childId).catch(() => []);
        }
        if (state?.childId) {
            const { getDailyMissionsState } = require('../services/study/studyMissions.service');
            state.missions = await getDailyMissionsState(state.childId).catch(() => null);
        }
        res.json({
            success: true,
            viewer: {
                username: req.user.username,
                nickname: req.user.nickname || req.user.username,
                role: req.user.role || 'family'
            },
            ...state
        });
    } catch (err) {
        console.error('학습실 대시보드 조회 오류:', err);
        res.status(500).json({ success: false, message: '학습실 정보를 불러오지 못했습니다.' });
    }
});

router.get('/api/study/tablet-config', authenticateToken, async (req, res) => {
    try {
        const wakeRaw = await getSystemConfig('study_tablet_wake_lock_default', '1');
        const penRaw = await getSystemConfig('study_tablet_pen_only_default', '0');
        const sfxRaw = await getSystemConfig('study_tablet_sound_fx_default', '1');
        const hangulRaw = await getSystemConfig('study_hangul_guide_enabled', '1');
        const albumShareRaw = await getSystemConfig('study_kid_album_share_enabled', '1');
        const pokeColorRaw = await getSystemConfig('study_pokemon_coloring_enabled', '1');
        res.json({
            success: true,
            config: {
                wakeLockDefault: wakeRaw !== '0',
                penOnlyDefault: penRaw === '1',
                soundFxDefault: sfxRaw !== '0',
                hangulGuideEnabled: hangulRaw !== '0',
                kidAlbumShareEnabled: albumShareRaw !== '0',
                pokemonColoringEnabled: pokeColorRaw !== '0'
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: '태블릿 설정을 불러오지 못했습니다.' });
    }
});

const studyRateMap = new Map();
function checkStudyActionLimit(key, maxCount, windowMs) {
    const now = Date.now();
    const list = (studyRateMap.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= maxCount) return false;
    list.push(now);
    studyRateMap.set(key, list);
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [k, list] of studyRateMap.entries()) {
        const valid = list.filter((t) => now - t < 15 * 60 * 1000);
        if (valid.length === 0) studyRateMap.delete(k);
        else studyRateMap.set(k, valid);
    }
}, 10 * 60 * 1000).unref();

async function verifyStudyParentGate(req) {
    const { parentPin, longPressVerified } = req.body || {};
    const check = await verifyParentLockPin(parentPin);
    if (check.configured) {
        if (!parentPin || !check.valid) {
            return {
                ok: false,
                status: 403,
                requirePin: true,
                configured: true,
                message: '부모님 잠금 PIN 번호가 올바르지 않습니다.'
            };
        }
        return { ok: true, configured: true };
    }
    if (longPressVerified !== true) {
        return {
            ok: false,
            status: 403,
            requireUnlock: true,
            configured: false,
            message: '어른 확인(부모 잠금 해제)을 먼저 진행해 주세요.'
        };
    }
    return { ok: true, configured: false };
}

router.post('/api/study/parent/verify', authenticateToken, async (req, res) => {
    try {
        const pinKey = `pin:${req.user.username}`;
        if (!checkStudyActionLimit(pinKey, 12, 5 * 60 * 1000)) {
            return res.status(429).json({
                success: false,
                message: '잠금 해제 시도가 너무 많습니다. 5분 후 다시 시도해 주세요.'
            });
        }
        const { parentPin } = req.body || {};
        const check = await verifyParentLockPin(parentPin);
        if (check.configured && (!parentPin || !check.valid)) {
            return res.status(403).json({
                success: false,
                requirePin: true,
                message: '부모님 잠금 PIN 번호가 올바르지 않습니다.'
            });
        }
        return res.json({ success: true, configured: check.configured, valid: true });
    } catch (err) {
        console.error('부모 잠금 PIN 검증 오류:', err);
        return res.status(500).json({ success: false, message: '잠금 확인 중 오류가 발생했습니다.' });
    }
});

router.post('/api/study/levels/adjust', authenticateToken, async (req, res) => {
    try {
        const { childId, subject, delta, level, parentPin, longPressVerified } = req.body || {};
        const check = await verifyParentLockPin(parentPin);

        if (check.configured) {
            if (!parentPin || !check.valid) {
                return res.status(403).json({
                    success: false,
                    requirePin: true,
                    message: '부모님 잠금 PIN 번호가 올바르지 않습니다.'
                });
            }
        } else if (longPressVerified !== true && req.user.role === 'kid') {
            return res.status(403).json({
                success: false,
                message: '어른 확인(버튼 꾹 누르기)이 필요합니다.'
            });
        }

        const rateKey = `lvl:${req.user.username}`;
        if (req.user.role === 'kid' && !check.configured && !checkStudyActionLimit(rateKey, 5, 60 * 1000)) {
            return res.status(429).json({
                success: false,
                message: '잠시 후 다시 조절해 주세요.'
            });
        }

        const cid = normalizeChildId(childId);
        const subj = normalizeSubject(subject);
        const nextLevel = (level !== undefined && level !== null)
            ? await setChildLevel(cid, subj, level)
            : await adjustChildLevel(cid, subj, delta || 0);

        scheduleReplenish(cid, subj);
        res.json({ success: true, childId: cid, subject: subj, level: nextLevel });
    } catch (err) {
        console.error('학습 레벨 조정 오류:', err);
        res.status(500).json({ success: false, message: '레벨 조정에 실패했습니다.' });
    }
});

router.post('/api/study/stamps/paper', authenticateToken, async (req, res) => {
    try {
        const gate = await verifyStudyParentGate(req);
        if (!gate.ok) {
            return res.status(gate.status).json({
                success: false,
                requirePin: Boolean(gate.requirePin),
                requireUnlock: Boolean(gate.requireUnlock),
                message: gate.message
            });
        }

        const cid = normalizeChildId(req.body?.childId);
        const { note } = req.body || {};
        const result = await awardStamp({
            childId: cid,
            sourceType: 'paper',
            note: note || '',
            byParent: true
        });
        res.json({
            success: true,
            message: result.reachedTen
                ? '와! 칭찬 도장 10칸을 모두 모았어요! 🎉'
                : '부모님 확인으로 종이 학습지 도장을 부여했어요! 🌟',
            ...result
        });
    } catch (err) {
        console.error('종이 학습지 도장 부여 오류:', err);
        res.status(500).json({ success: false, message: '도장 부여 중 오류가 발생했습니다.' });
    }
});

router.post('/api/study/stamps/manage', authenticateToken, async (req, res) => {
    try {
        const gate = await verifyStudyParentGate(req);
        if (!gate.ok) {
            return res.status(gate.status).json({
                success: false,
                requirePin: Boolean(gate.requirePin),
                requireUnlock: Boolean(gate.requireUnlock),
                message: gate.message
            });
        }

        const { childId, action, stampId, targetCount, sourceType, note } = req.body || {};
        const cid = normalizeChildId(childId);

        if (action === 'add_paper' || action === 'add_online') {
            const out = await awardStamp({
                childId: cid,
                sourceType: action === 'add_paper' ? 'paper' : 'online',
                note: note || '',
                byParent: true
            });
            return res.json({
                success: true,
                message: out.reachedTen ? '와! 칭찬 도장 10칸을 모두 모았어요! 🎉' : '칭찬 도장을 1개 추가했어요! 🌟',
                ...out
            });
        }
        if (action === 'undo_last') {
            const out = await removeLastStamp(cid);
            return res.json({
                success: true,
                message: out.deletedStamp ? '마지막 도장 1개를 뺐어요.' : '뺄 수 있는 도장이 아직 없어요.',
                ...out
            });
        }
        if (action === 'delete_one') {
            const out = await deleteStampById(cid, stampId);
            return res.json({ success: true, message: '선택한 도장을 삭제했어요.', ...out });
        }
        if (action === 'update_note') {
            const out = await updateStampEntry(cid, stampId, { sourceType, note });
            return res.json({ success: true, message: '도장 메모를 수정했어요.', ...out });
        }
        if (action === 'set_count') {
            const out = await setStampBoardCount(cid, targetCount, { sourceType, note });
            return res.json({ success: true, message: `도장판을 ${out.currentCount}/10칸으로 수정했어요.`, ...out });
        }
        if (action === 'reset_board') {
            const out = await resetCurrentStampBoard(cid);
            return res.json({ success: true, message: '이번 도장판을 깨끗하게 비웠어요.', ...out });
        }

        return res.status(400).json({ success: false, message: '알 수 없는 도장판 작업입니다.' });
    } catch (err) {
        console.error('도장판 수정 오류:', err);
        return res.status(400).json({ success: false, message: err.message || '도장판 수정 중 오류가 발생했습니다.' });
    }
});

// ------------------------------------------------------------------------------
// 3. 맞춤형 학습지 생성·조회·부분교체·완료 API
// ------------------------------------------------------------------------------
router.post('/api/study/sheets/generate', authenticateToken, async (req, res) => {
    try {
        const genKey = `gen:${req.user.username}`;
        if (!checkStudyActionLimit(genKey, 6, 60 * 1000)) {
            return res.status(429).json({
                success: false,
                message: '학습지 생성 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.'
            });
        }

        const { childId, subject, theme, includePlayBlock, coloringMode, customPrompt } = req.body || {};
        const opts = {
            childId: normalizeChildId(childId),
            subject: normalizeSubject(subject),
            theme: theme || '동물 친구',
            createdBy: req.user.username || 'web',
            includePlayBlock: includePlayBlock !== false,
            coloringMode: coloringMode || 'auto_3',
            customPrompt: typeof customPrompt === 'string' ? customPrompt.trim().slice(0, 48) : ''
        };

        let sheet = await findAndAssignCrossChildWorksheet(opts);
        if (sheet) {
            setImmediate(() => {
                warmWorksheetTts(sheet.content).catch(() => {});
            });
        } else {
            sheet = await consumePregeneratedWorksheet(opts);
            if (!sheet) {
                sheet = await generateAndSaveWorksheet(opts);
                setImmediate(() => {
                    warmWorksheetTts(sheet.content).catch(() => {});
                    if (opts.subject !== 'coloring') scheduleReplenish(opts.childId, opts.subject);
                });
            }
        }
        res.json({ success: true, sheet });
    } catch (err) {
        console.error('학습지 생성 오류:', err);
        res.status(500).json({ success: false, message: '학습지를 만드는 중 문제가 생겼어요.' });
    }
});

router.get('/api/study/sheets/:id', authenticateToken, async (req, res) => {
    try {
        const sheet = await getWorksheetById(req.params.id);
        if (!sheet) {
            return res.status(404).json({ success: false, message: '해당 학습지를 찾을 수 없습니다.' });
        }
        res.json({ success: true, sheet });
    } catch (err) {
        console.error('학습지 단건 조회 오류:', err);
        res.status(500).json({ success: false, message: '학습지를 불러오지 못했습니다.' });
    }
});

router.post('/api/study/sheets/:id/regenerate-block', authenticateToken, async (req, res) => {
    try {
        const sheet = await getWorksheetById(req.params.id);
        if (!sheet || !sheet.content) {
            return res.status(404).json({ success: false, message: '학습지를 찾을 수 없습니다.' });
        }
        const blockIndex = Number(req.body?.blockIndex);
        if (!Number.isInteger(blockIndex) || blockIndex < 0) {
            return res.status(400).json({ success: false, message: '교체할 문제 번호가 올바르지 않습니다.' });
        }
        const updatedContent = regenerateSingleBlock(sheet.content, blockIndex, {
            subject: sheet.subject,
            level: sheet.level,
            theme: sheet.theme
        });
        await updateWorksheetContent(sheet.id, updatedContent);
        const swappedBlk = updatedContent?.blocks?.[blockIndex];
        if (swappedBlk) {
            setImmediate(() => { warmWorksheetTts({ blocks: [swappedBlk] }).catch(() => {}); });
        }
        res.json({ success: true, content: updatedContent });
    } catch (err) {
        console.error('학습지 문제 부분 교체 오류:', err);
        res.status(500).json({ success: false, message: '문제를 바꾸는 중 오류가 발생했습니다.' });
    }
});

router.post('/api/study/sheets/:id/complete', authenticateToken, async (req, res) => {
    try {
        const sheet = await getWorksheetById(req.params.id);
        if (!sheet) {
            return res.status(404).json({ success: false, message: '학습지를 찾을 수 없습니다.' });
        }
        if (sheet.subject === 'coloring') {
            const done = await markWorksheetCompletedOnly(sheet.id);
            const { markMissionProgressForSheet } = require('../services/study/studyMissions.service');
            const missionProgress = await markMissionProgressForSheet(sheet).catch(() => null);
            const { recordWorksheetCompletionPoints } = require('../services/study/studyPlazaRewards.service');
            const earnedPoints = await recordWorksheetCompletionPoints(sheet, { stampAwarded: false }, missionProgress).catch(() => null);
            return res.json({
                success: true, noStampForColoring: true, stampAwarded: false, alreadyAwarded: false,
                reachedTen: false, alreadyCompleted: done.alreadyCompleted, missionProgress, earnedPoints,
                message: '알록달록 멋진 색칠놀이 완성! 🎨 (색칠놀이는 별·도장 없이 자유롭게 즐겨요)'
            });
        }
        const result = await gradeAndSubmitWorksheet({
            sheet,
            blockResults: req.body?.blockResults
        });
        let earnedSnacks = [];
        let missionProgress = null;
        if (result.stampAwarded) {
            if (!result.alreadyAwarded) {
                const { grantStudySnacks } = require('../services/study/studyPokemonSocial.service');
                earnedSnacks = await grantStudySnacks(sheet.child_id, 2).catch(() => []);
            }
            const { markMissionProgressForSheet } = require('../services/study/studyMissions.service');
            missionProgress = await markMissionProgressForSheet(sheet).catch(() => null);
            scheduleReplenish(sheet.child_id, sheet.subject);
            setImmediate(() => {
                const { notifyWorksheetCompletedToParents } = require('../services/study/studyTelegramNotify.service');
                notifyWorksheetCompletedToParents({
                    childId: sheet.child_id,
                    sheetTitle: sheet.title,
                    subject: sheet.subject,
                    level: sheet.level,
                    earnedCount: result.board?.earnedCount || 0,
                    alreadyAwarded: result.alreadyAwarded
                }).catch(() => {});
            });
        }
        const { recordWorksheetCompletionPoints } = require('../services/study/studyPlazaRewards.service');
        const earnedPoints = await recordWorksheetCompletionPoints(sheet, result, missionProgress).catch(() => null);
        res.json({ success: true, earnedSnacks, missionProgress, earnedPoints, ...result });
    } catch (err) {
        const status = err.statusCode || 500;
        console.error('학습지 완료 처리 오류:', err);
        res.status(status).json({ success: false, message: err.message || '완료 처리 중 오류가 발생했습니다.' });
    }
});

router.use(require('./studyArtwork.routes'));
router.use(require('./studyPokemon.routes'));
router.use(require('./studyPokemonSocial.routes'));
router.use(require('./studyMedia.routes'));
router.use(require('./studyReview.routes'));
router.use(require('./studyMissions.routes'));
router.use(require('./studyPlazaRewards.routes'));

module.exports = router;
