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
    awardStamp,
    getWorksheetById,
    updateWorksheetContent,
    verifyParentLockPin
} = require('../services/study/studyDb.service');
const { generateAndSaveWorksheet } = require('../services/study/geminiWorksheet.service');
const { regenerateSingleBlock } = require('../services/study/worksheetValidator.service');
const { startLevelTest, submitLevelTestAnswer } = require('../services/study/adaptiveLevel.service');
const { synthesizeStudySpeech } = require('../services/study/studyTts.service');
const {
    consumePregeneratedWorksheet,
    scheduleReplenish,
    warmWorksheetTts
} = require('../services/study/studyPreGen.service');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function sendStudyHtml(res, relPath) {
    try {
        const fullPath = path.join(PUBLIC_DIR, relPath);
        let html = fs.readFileSync(fullPath, 'utf8');
        const v = STATIC_ASSET_VERSION || Date.now();
        html = html.replace(/(href|src)="(\/(?:css|js)\/[^"?#]+)(\?v=[^"]*)?"/g, `$1="$2?v=${v}"`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.send(html);
    } catch (err) {
        console.error(`학습실 HTML 렌더링 오류 (${relPath}):`, err);
        res.status(500).send('학습실 화면을 불러오는 중 오류가 발생했습니다.');
    }
}

// ------------------------------------------------------------------------------
// 1. 전용 학습실 HTML 뷰 (/study, /study/test, /study/sheet/:id)
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

// ------------------------------------------------------------------------------
// 2. 학습실 대시보드 & 레벨/도장 API (/api/study/*)
// ------------------------------------------------------------------------------
router.get('/api/study/dashboard', authenticateToken, async (req, res) => {
    try {
        const requestedChild = req.query.childId ? String(req.query.childId).trim() : '';
        const state = await getChildDashboardState(requestedChild, req.user);
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
        const cid = normalizeChildId(req.body?.childId);
        const stampKey = `paper:${req.user.username}:${cid}`;
        if (!checkStudyActionLimit(stampKey, 5, 10 * 60 * 1000)) {
            return res.status(429).json({
                success: false,
                message: '종이 학습지 도장은 잠시 후 다시 찍을 수 있어요!'
            });
        }

        const { note } = req.body || {};
        const result = await awardStamp({
            childId: cid,
            sourceType: 'paper',
            note: note || '종이 학습지 스스로 완료! 📄'
        });
        res.json({
            success: true,
            message: result.reachedTen
                ? '와! 칭찬 도장 10칸을 모두 모았어요! 🎉'
                : '종이 학습지 완료 칭찬 도장을 찍었어요! 🌟',
            ...result
        });
    } catch (err) {
        console.error('종이 학습지 도장 적립 오류:', err);
        res.status(500).json({ success: false, message: '도장 적립 중 오류가 발생했습니다.' });
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

        const { childId, subject, theme, includePlayBlock, coloringMode } = req.body || {};
        const opts = {
            childId: normalizeChildId(childId),
            subject: normalizeSubject(subject),
            theme: theme || '동물 친구',
            createdBy: req.user.username || 'web',
            includePlayBlock: includePlayBlock !== false,
            coloringMode: coloringMode || 'auto_3'
        };

        let sheet = await consumePregeneratedWorksheet(opts);
        if (!sheet) {
            sheet = await generateAndSaveWorksheet(opts);
            setImmediate(() => {
                warmWorksheetTts(sheet.content).catch(() => {});
                scheduleReplenish(opts.childId, opts.subject);
            });
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
        const result = await awardStamp({
            childId: sheet.child_id,
            sourceType: 'online',
            sheetId: sheet.id,
            note: `${sheet.title} 완료 🌟`
        });
        scheduleReplenish(sheet.child_id, sheet.subject);
        res.json({
            success: true,
            message: result.reachedTen
                ? '축하해요! 도장판 10칸을 모두 채웠어요! 🎉'
                : (result.alreadyAwarded ? '이미 도장을 받은 학습지예요! 정말 잘했어요!' : '학습 완료! 칭찬 도장을 쾅! 찍었어요 🌟'),
            ...result
        });
    } catch (err) {
        console.error('학습지 완료 처리 오류:', err);
        res.status(500).json({ success: false, message: '완료 처리 중 오류가 발생했습니다.' });
    }
});

// ------------------------------------------------------------------------------
// 4. 5분 탐험 수준 테스트 & 서버 폴백 음성(TTS) API
// ------------------------------------------------------------------------------
router.post('/api/study/test/start', authenticateToken, async (req, res) => {
    try {
        const childId = normalizeChildId(req.body?.childId || 'first');
        const session = await startLevelTest(childId);
        res.json({ success: true, ...session });
    } catch (err) {
        console.error('수준 테스트 시작 오류:', err);
        res.status(500).json({ success: false, message: '수준 테스트를 시작하지 못했습니다.' });
    }
});

router.post('/api/study/test/:testId/answer', authenticateToken, async (req, res) => {
    try {
        const { choice } = req.body || {};
        const outcome = await submitLevelTestAnswer(req.params.testId, choice);
        res.json({ success: true, ...outcome });
    } catch (err) {
        console.error('수준 테스트 채점 오류:', err);
        res.status(500).json({ success: false, message: err.message || '채점 처리 중 오류가 발생했습니다.' });
    }
});

router.get('/api/study/tts', authenticateToken, async (req, res) => {
    try {
        const text = String(req.query.text || '').trim();
        const lang = String(req.query.lang || 'ko-KR').trim();
        const out = await synthesizeStudySpeech(text, lang);
        if (!out.ok) {
            return res.status(out.status || 503).json({
                success: false,
                message: '음성 합성에 일시적인 문제가 있습니다.'
            });
        }

        const buf = out.buffer;
        const total = buf.length;
        res.setHeader('Content-Type', out.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=86400');

        const rangeHeader = req.headers.range;
        if (rangeHeader && rangeHeader.startsWith('bytes=')) {
            const [sStr, eStr] = rangeHeader.replace('bytes=', '').split('-');
            const start = Math.max(0, parseInt(sStr, 10) || 0);
            const end = eStr ? Math.min(total - 1, parseInt(eStr, 10)) : total - 1;
            if (start >= total || start > end) {
                return res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
            }
            const chunk = buf.subarray(start, end + 1);
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', chunk.length);
            return res.send(chunk);
        }

        res.setHeader('Content-Length', total);
        return res.send(buf);
    } catch (err) {
        console.error('학습실 TTS 스트리밍 오류:', err);
        return res.status(500).json({ success: false, message: '음성 생성 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
