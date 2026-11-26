/**
 * ==============================================================================
 * 5분 탐험 수준 테스트 (계단식 Lv.1~5 적응형 레벨 산정 엔진)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 유아 친화적 한국어 인터페이스
 * - 한글·수학·영어 영역별 Lv.3에서 시작해 3문항씩 정답/오답에 따라 Lv.1~5로 분기
 * ==============================================================================
 */

const {
    normalizeChildId,
    setChildLevel,
    dbGet,
    dbRun
} = require('./studyDb.service');
const { KOREAN_BANK, ENGLISH_BANK } = require('./fallbackBank.data');
const { buildDeterministicMathBlocks } = require('./worksheetValidator.service');
const {
    TESTABLE_SUBJECTS,
    DEFAULT_TEST_SUBJECTS,
    SCIENCE_TEST_BANK,
    HISTORY_TEST_BANK,
    LOGIC_TEST_BANK
} = require('./adaptiveLevelBank.data');

const LEGACY_SUBJECT_ORDER = ['korean', 'math', 'english'];

function normalizeTestSubjects(rawSubjects) {
    if (!Array.isArray(rawSubjects) || !rawSubjects.length) {
        return [...DEFAULT_TEST_SUBJECTS];
    }
    const allowed = new Set(TESTABLE_SUBJECTS);
    const picked = [];
    rawSubjects.forEach((s) => {
        const key = String(s || '').trim().toLowerCase();
        if (allowed.has(key) && !picked.includes(key)) picked.push(key);
    });
    return picked.length ? picked : [...DEFAULT_TEST_SUBJECTS];
}

function buildExplorerQuestion(subject, level, stepIndex) {
    const lv = Math.min(5, Math.max(1, Number(level) || 3));
    if (subject === 'math') {
        const blocks = buildDeterministicMathBlocks(lv, '탐험', []);
        const picked = stepIndex % 2 === 0 ? blocks[0] : blocks[1];
        return {
            subject: 'math',
            level: lv,
            stepIndex,
            prompt: picked.prompt,
            ttsText: picked.ttsText || picked.prompt,
            ttsLang: 'ko-KR',
            visual: picked.emoji ? Array(Math.min(picked.count || 3, 12)).fill(picked.emoji).join(' ') : (picked.equationText || ''),
            equationText: picked.equationText || '',
            choices: picked.choices,
            answer: picked.answer
        };
    }

    if (subject === 'science' || subject === 'history' || subject === 'logic') {
        const poolMap = { science: SCIENCE_TEST_BANK, history: HISTORY_TEST_BANK, logic: LOGIC_TEST_BANK };
        const bank = poolMap[subject][lv] || poolMap[subject][3];
        const item = bank[stepIndex % bank.length] || bank[0];
        return {
            subject,
            level: lv,
            stepIndex,
            prompt: item.prompt,
            ttsText: item.prompt,
            ttsLang: 'ko-KR',
            visual: item.emoji || '✨',
            equationText: '',
            choices: item.choices || [item.answer],
            answer: item.answer
        };
    }

    const bank = subject === 'english' ? ENGLISH_BANK[lv] : KOREAN_BANK[lv];
    const item = bank[stepIndex % bank.length] || bank[0];
    return {
        subject,
        level: lv,
        stepIndex,
        prompt: subject === 'english'
            ? `${item.emoji} 이 그림에 맞는 영어 글자를 눌러 볼까요?`
            : `${item.emoji} 그림을 보고 알맞은 글자를 찾아 눌러 볼까요?`,
        ttsText: item.word,
        ttsLang: subject === 'english' ? 'en-US' : 'ko-KR',
        visual: item.emoji,
        equationText: item.meaning || '',
        choices: item.choices || [item.word],
        answer: item.word
    };
}

async function startLevelTest(childId, subjects) {
    const cid = normalizeChildId(childId);
    const selectedSubjects = normalizeTestSubjects(subjects);
    const state = {
        subjects: selectedSubjects,
        subjectIdx: 0,
        stepInSubject: 0, // 0, 1, 2 (각 과목 3문항)
        currentLevel: 3,  // Lv.3에서 시작
        results: {},
        history: []
    };
    const firstQ = buildExplorerQuestion(selectedSubjects[0], 3, 0);
    state.activeQuestion = firstQ;

    const res = await dbRun(
        `INSERT INTO study_level_tests (child_id, status, state_json) VALUES (?, 'in_progress', ?)`,
        [cid, JSON.stringify(state)]
    );

    return {
        testId: res.lastID,
        childId: cid,
        subjects: selectedSubjects,
        status: 'in_progress',
        progress: { current: 1, total: selectedSubjects.length * 3 },
        question: sanitizeQuestionForClient(firstQ)
    };
}

function sanitizeQuestionForClient(q) {
    return {
        subject: q.subject,
        level: q.level,
        stepIndex: q.stepIndex,
        prompt: q.prompt,
        ttsText: q.ttsText,
        ttsLang: q.ttsLang,
        visual: q.visual,
        equationText: q.equationText,
        choices: q.choices
    };
}

async function submitLevelTestAnswer(testId, selectedChoice) {
    const row = await dbGet('SELECT * FROM study_level_tests WHERE id = ?', [Number(testId)]);
    if (!row) throw new Error('수준 테스트 세션을 찾을 수 없습니다.');
    if (row.status === 'completed') {
        return {
            testId: row.id,
            status: 'completed',
            result: JSON.parse(row.result_json || '{}')
        };
    }

    const state = JSON.parse(row.state_json);
    const subjectOrder = Array.isArray(state.subjects) && state.subjects.length ? state.subjects : LEGACY_SUBJECT_ORDER;
    const totalQuestions = subjectOrder.length * 3;
    const activeQ = state.activeQuestion;
    const isCorrect = String(selectedChoice || '').trim().toUpperCase() === String(activeQ.answer || '').trim().toUpperCase();

    state.history.push({
        subject: activeQ.subject,
        level: activeQ.level,
        isCorrect,
        selectedChoice,
        answer: activeQ.answer
    });

    // 계단식 분기 로직 (Lv.3 시작 -> 정답 시 +1, 오답 시 -1)
    let nextLevel = isCorrect ? Math.min(5, activeQ.level + 1) : Math.max(1, activeQ.level - 1);
    const nextStep = state.stepInSubject + 1;

    if (nextStep < 3) {
        state.stepInSubject = nextStep;
        state.currentLevel = nextLevel;
        state.activeQuestion = buildExplorerQuestion(subjectOrder[state.subjectIdx], nextLevel, nextStep);

        await dbRun(
            'UPDATE study_level_tests SET state_json = ? WHERE id = ?',
            [JSON.stringify(state), row.id]
        );

        return {
            testId: row.id,
            status: 'in_progress',
            lastCorrect: isCorrect,
            correctAnswer: activeQ.answer,
            progress: {
                current: state.subjectIdx * 3 + state.stepInSubject + 1,
                total: totalQuestions
            },
            question: sanitizeQuestionForClient(state.activeQuestion)
        };
    }

    // 현재 영역 3문항 완료 -> 최종 레벨 확정 및 DB 반영
    const finalSubject = subjectOrder[state.subjectIdx];
    const finalizedLv = isCorrect ? nextLevel : Math.max(1, activeQ.level - 1);
    state.results[finalSubject] = finalizedLv;
    await setChildLevel(row.child_id, finalSubject, finalizedLv);

    const nextSubjectIdx = state.subjectIdx + 1;
    if (nextSubjectIdx < subjectOrder.length) {
        state.subjectIdx = nextSubjectIdx;
        state.stepInSubject = 0;
        state.currentLevel = 3;
        state.activeQuestion = buildExplorerQuestion(subjectOrder[nextSubjectIdx], 3, 0);

        await dbRun(
            'UPDATE study_level_tests SET state_json = ? WHERE id = ?',
            [JSON.stringify(state), row.id]
        );

        return {
            testId: row.id,
            status: 'in_progress',
            lastCorrect: isCorrect,
            correctAnswer: activeQ.answer,
            subjectCompleted: { subject: finalSubject, level: finalizedLv },
            progress: {
                current: nextSubjectIdx * 3 + 1,
                total: totalQuestions
            },
            question: sanitizeQuestionForClient(state.activeQuestion)
        };
    }

    // 선택한 모든 영역 완료!
    const resultPayload = {
        childId: row.child_id,
        subjects: subjectOrder,
        levels: state.results,
        correctCount: state.history.filter((h) => h.isCorrect).length,
        totalCount: state.history.length
    };

    await dbRun(
        `UPDATE study_level_tests
         SET status = 'completed', state_json = ?, result_json = ?, completed_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [JSON.stringify(state), JSON.stringify(resultPayload), row.id]
    );

    return {
        testId: row.id,
        status: 'completed',
        lastCorrect: isCorrect,
        correctAnswer: activeQ.answer,
        result: resultPayload
    };
}

module.exports = {
    startLevelTest,
    submitLevelTestAnswer
};
