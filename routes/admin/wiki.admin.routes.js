/**
 * ==============================================================================
 * 📚 관리자 가족 위키 수정 이력·복원 및 AI 추론 감사 라우터 (wiki.admin.routes.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화 및 개인정보 마스킹
 * [기능]
 *  1. 보조서버(family-wiki) 위키 수정 이력(Revision) 조회, 버전 간 변경점(Diff), 원클릭 복원
 *  2. 가족위키 자체 AI(초안·요약·약봉투·생활사진) + 포털 위키 AI(메모변환·스마트병합·루틴추출) 통합 집계
 * ==============================================================================
 */

const express = require('express');
const http = require('http');
const router = express.Router();
const { db } = require('../../services/db');
const { WIKI_HOST, WIKI_PORT, JWT_SECRET } = require('../../config/constants');
const { CHAT_MODEL } = require('../../services/aiModelRouter.service');

function wikiInternalRequest(method, targetPath, payload = null) {
    return new Promise((resolve, reject) => {
        const headers = { 'Accept': 'application/json' };
        if (JWT_SECRET) headers['X-Internal-Secret'] = JWT_SECRET;

        let bodyBuf = null;
        if (payload && ['POST', 'PUT', 'PATCH'].includes(method)) {
            bodyBuf = Buffer.from(JSON.stringify(payload), 'utf-8');
            headers['Content-Type'] = 'application/json; charset=UTF-8';
            headers['Content-Length'] = bodyBuf.byteLength;
        }

        const req = http.request({
            hostname: WIKI_HOST,
            port: WIKI_PORT,
            path: targetPath,
            method,
            headers,
            timeout: 8000
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw || '{}');
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    reject(new Error('보조서버 응답 파싱 실패'));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('보조서버 응답 시간 초과'));
        });
        req.on('error', reject);

        if (bodyBuf) req.write(bodyBuf);
        req.end();
    });
}

function queryPortalWikiAiLogs(limit = 30) {
    return new Promise((resolve) => {
        const whereSql = `(request_type IN ('memo_wiki', 'extract_routine', 'wiki_summarize', 'wiki_draft', 'publish_wiki_merge', 'publish_wiki_create') OR tools_used LIKE '%wiki%')`;
        db.get(
            `SELECT
                COUNT(*) AS total_7d,
                SUM(CASE WHEN status != 'SUCCESS' THEN 1 ELSE 0 END) AS error_count,
                ROUND(AVG(CASE WHEN duration_ms > 0 THEN duration_ms END), 0) AS avg_duration_ms
             FROM ai_audit_logs
             WHERE ${whereSql} AND created_at >= datetime('now', 'localtime', '-7 days')`,
            [],
            (sErr, sRow) => {
                db.all(
                    `SELECT id, request_type, model, tools_used, prompt_preview, duration_ms, status, created_at
                     FROM ai_audit_logs
                     WHERE ${whereSql}
                     ORDER BY id DESC
                     LIMIT ?`,
                    [limit],
                    (lErr, rows) => {
                        resolve({
                            stats: (!sErr && sRow) ? sRow : { total_7d: 0, error_count: 0, avg_duration_ms: 0 },
                            logs: (!lErr && Array.isArray(rows)) ? rows : []
                        });
                    }
                );
            }
        );
    });
}

// 1. 가족 위키 수정 이력 + AI 추론 이력 통합 조회
router.get('/governance', async (req, res) => {
    const slugFilter = (req.query.slug || '').trim();
    const revQuery = slugFilter
        ? `/api/wiki/revisions/recent?limit=40&slug=${encodeURIComponent(slugFilter)}`
        : '/api/wiki/revisions/recent?limit=40';

    const [wikiRevRes, wikiAiRes, portalAi] = await Promise.all([
        wikiInternalRequest('GET', revQuery).catch(err => ({ error: err.message, data: null })),
        wikiInternalRequest('GET', '/api/wiki/ai/logs?limit=40').catch(err => ({ error: err.message, data: null })),
        queryPortalWikiAiLogs(30)
    ]);

    const secondaryOnline = Boolean(wikiRevRes.data && wikiRevRes.data.success !== false);
    const revData = wikiRevRes.data || {};
    const wAiData = wikiAiRes.data || {};

    const directLogs = (wAiData.logs || []).map(r => ({
        uid: `wiki-${r.id}`,
        source: '가족위키',
        action_type: r.action_type || 'draft',
        engine: r.engine || 'ollama',
        model: r.model || '-',
        target_title: r.target_title || '-',
        duration_ms: Number(r.duration_ms || 0),
        status: r.status || 'SUCCESS',
        error_msg: r.error_msg || '',
        created_at: r.created_at || ''
    }));

    const portalLogs = (portalAi.logs || []).map(r => {
        const actionType = r.request_type === 'chat' ? 'chat_wiki_tool' : (r.request_type || 'memo_wiki');
        return {
            uid: `portal-${r.id}`,
            source: '포털 AI',
            action_type: actionType,
            engine: 'ollama',
            model: r.model || CHAT_MODEL || '-',
            target_title: r.prompt_preview || '-',
            duration_ms: Number(r.duration_ms || 0),
            status: r.status || 'SUCCESS',
            error_msg: '',
            created_at: r.created_at || ''
        };
    });

    const mergedAiLogs = [...directLogs, ...portalLogs]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 50);

    const wStats = wAiData.stats || {};
    const pStats = portalAi.stats || {};

    res.json({
        success: true,
        secondaryOnline,
        secondaryWarning: secondaryOnline ? '' : (wikiRevRes.error || wikiAiRes.error || '보조서버 연결 대기 중'),
        configuredModels: {
            draftModel: wAiData.configured_models?.draft_model || 'gemma3:4b',
            summaryModel: wAiData.configured_models?.summary_model || 'gemma3:1b',
            portalModel: CHAT_MODEL || '-'
        },
        quota: wAiData.quota || {},
        revisionStats: revData.stats || { total_revisions: 0, edited_pages_count: 0, today_edits: 0, revert_count: 0 },
        revisions: revData.revisions || [],
        aiStats: {
            total7d: Number(wStats.total_7d || 0) + Number(pStats.total_7d || 0),
            ollamaCount: Number(wStats.ollama_count || 0) + Number(pStats.total_7d || 0),
            geminiCount: Number(wStats.gemini_count || 0),
            errorCount: Number(wStats.error_count || 0) + Number(pStats.error_count || 0)
        },
        aiLogs: mergedAiLogs
    });
});

// 2. 특정 리비전 본문 + 이전 버전 대비 Diff 상세 조회
router.get('/revision-detail', async (req, res) => {
    const slug = (req.query.slug || '').trim();
    const version = parseInt(req.query.version, 10);
    if (!slug || !version) {
        return res.status(400).json({ success: false, message: '문서 슬러그와 버전 번호가 필요합니다.' });
    }

    try {
        const v1 = Math.max(0, version - 1);
        const [detailRes, diffRes] = await Promise.all([
            wikiInternalRequest('GET', `/api/wiki/pages/revisions/${encodeURIComponent(slug)}/${version}`),
            wikiInternalRequest('GET', `/api/wiki/pages/diff/${encodeURIComponent(slug)}?v1=${v1}&v2=${version}`)
        ]);
        if (!detailRes.data || !detailRes.data.success) {
            return res.status(404).json({ success: false, message: detailRes.data?.message || '해당 버전을 찾을 수 없습니다.' });
        }
        res.json({
            success: true,
            revision: detailRes.data.revision,
            diff: diffRes.data?.diff || null,
            v1
        });
    } catch (err) {
        res.status(502).json({ success: false, message: '보조서버 위키 이력 조회 실패: ' + err.message });
    }
});

// 3. 특정 과거 버전으로 원클릭 복원 (관리자 감사 기록 포함)
router.post('/revert', async (req, res) => {
    const slug = (req.body?.slug || '').trim();
    const version = parseInt(req.body?.version, 10);
    if (!slug || !version) {
        return res.status(400).json({ success: false, message: '복원할 문서 슬러그와 버전 번호가 필요합니다.' });
    }

    try {
        const revRes = await wikiInternalRequest('POST', '/api/wiki/pages/revert', {
            slug,
            version,
            author: '관리자'
        });
        res.status(revRes.statusCode || 200).json(revRes.data);
    } catch (err) {
        res.status(502).json({ success: false, message: '보조서버 문서 복원 요청 실패: ' + err.message });
    }
});

module.exports = router;
