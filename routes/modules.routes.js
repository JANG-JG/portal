const express = require('express');
const router = express.Router();
const { db } = require('../services/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    getAllModules,
    getUserModules,
    getNavModules,
    getQuickStripItems,
    getModuleById,
    toggleModuleEnabled,
    createOrUpdateModule,
    deleteModule,
    CORE_MODULE_IDS
} = require('../services/moduleRegistry.service');
const { getModuleMetrics, getAllModulesKpiSummary } = require('../services/moduleMetrics.service');

/**
 * DB에서 사용자의 최신 allowed_services 및 role을 가져오는 헬퍼
 * @param {object} reqUser - JWT 토큰에서 디코딩된 req.user
 * @returns {Promise<object>} 최신 권한이 반영된 user 객체
 */
function fetchFreshUserData(reqUser) {
    return new Promise((resolve) => {
        if (!reqUser || !reqUser.username) {
            return resolve(reqUser);
        }
        db.get('SELECT username, role, nickname, allowed_services FROM users WHERE username = ?', [reqUser.username], (err, row) => {
            if (err || !row) {
                return resolve(reqUser);
            }
            resolve({
                ...reqUser,
                role: row.role || reqUser.role,
                nickname: row.nickname || reqUser.nickname,
                allowed_services: row.allowed_services
            });
        });
    });
}

// 1. 현재 사용자에게 허용된 모듈 전체 메타데이터 조회
router.get('/', authenticateToken, async (req, res) => {
    try {
        const freshUser = await fetchFreshUserData(req.user);
        const modules = getUserModules(freshUser);
        res.json({
            success: true,
            count: modules.length,
            modules
        });
    } catch (err) {
        console.error('[API /api/modules] 오류:', err);
        res.status(500).json({ success: false, message: '모듈 목록 조회 실패' });
    }
});

// 2. 상단 내비게이션 바 전용 메뉴 데이터 조회
router.get('/nav', authenticateToken, async (req, res) => {
    try {
        const freshUser = await fetchFreshUserData(req.user);
        const navModules = getNavModules(freshUser);
        res.json({
            success: true,
            navModules
        });
    } catch (err) {
        console.error('[API /api/modules/nav] 오류:', err);
        res.status(500).json({ success: false, message: '내비게이션 모듈 조회 실패' });
    }
});

// 3. 원터치 빠른 실행(Quick Strip) 전용 데이터 조회
router.get('/quick-strip', authenticateToken, async (req, res) => {
    try {
        const freshUser = await fetchFreshUserData(req.user);
        const quickItems = getQuickStripItems(freshUser);
        res.json({
            success: true,
            quickItems
        });
    } catch (err) {
        console.error('[API /api/modules/quick-strip] 오류:', err);
        res.status(500).json({ success: false, message: '빠른 실행 목록 조회 실패' });
    }
});

// 4. 단일 모듈 상세 조회
router.get('/detail/:id', authenticateToken, (req, res) => {
    const mod = getModuleById(req.params.id);
    if (!mod || mod.enabled === false) {
        return res.status(404).json({ success: false, message: '해당 모듈을 찾을 수 없습니다.' });
    }
    res.json({ success: true, module: mod });
});

// 5. 관리자 전용 전체 모듈 목록 조회 (비활성 모듈 및 관리자 설정 포함)
router.get('/admin/all', authenticateToken, requireAdmin, (req, res) => {
    try {
        const all = getAllModules(true);
        res.json({
            success: true,
            count: all.length,
            modules: all,
            coreModuleIds: Array.from(CORE_MODULE_IDS)
        });
    } catch (err) {
        console.error('[API /api/modules/admin/all] 오류:', err);
        res.status(500).json({ success: false, message: '관리자 모듈 목록 조회 실패' });
    }
});

// 6. 관리자: 모듈 On/Off 활성화 토글
router.patch('/admin/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
    try {
        const updated = toggleModuleEnabled(req.params.id);
        res.json({
            success: true,
            message: `모듈 [${updated.name}] 상태가 [${updated.enabled ? '활성화' : '비활성화'}] 되었습니다.`,
            module: updated
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '상태 변경 실패' });
    }
});

// 7. 관리자: 신규 서비스 모듈 등록
router.post('/admin', authenticateToken, requireAdmin, (req, res) => {
    try {
        const created = createOrUpdateModule(req.body, true);
        res.json({
            success: true,
            message: `신규 서비스 [${created.name}] 모듈이 성공적으로 등록되었습니다.`,
            module: created
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '모듈 등록 실패' });
    }
});

// 8. 관리자: 기존 모듈 설정 수정
router.put('/admin/:id', authenticateToken, requireAdmin, (req, res) => {
    try {
        const payload = { ...req.body, id: req.params.id };
        const updated = createOrUpdateModule(payload, false);
        res.json({
            success: true,
            message: `서비스 [${updated.name}] 모듈 정보가 성공적으로 수정되었습니다.`,
            module: updated
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '모듈 수정 실패' });
    }
});

// 9. 관리자: 모듈 삭제 (코어 모듈 보호)
router.delete('/admin/:id', authenticateToken, requireAdmin, (req, res) => {
    try {
        deleteModule(req.params.id);
        res.json({
            success: true,
            message: `모듈 [${req.params.id}]이(가) 안전하게 삭제되었습니다.`
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message || '모듈 삭제 실패' });
    }
});

// 10. 관리자/사용자: 특정 모듈 표준 KPI 메트릭 조회
router.get('/:id/metrics', authenticateToken, async (req, res) => {
    try {
        const metrics = await getModuleMetrics(req.params.id);
        res.json(metrics);
    } catch (err) {
        res.status(404).json({ success: false, message: err.message || '메트릭 조회 실패' });
    }
});

// 11. 관리자: 전체 모듈 KPI 종합 요약 조회
router.get('/admin/kpis', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const summary = await getAllModulesKpiSummary();
        res.json(summary);
    } catch (err) {
        res.status(500).json({ success: false, message: 'KPI 집계 실패' });
    }
});

module.exports = router;
