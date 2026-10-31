/**
 * ==============================================================================
 * ⏳ JG 포털: 가족 위키 D-Day 임박 알림 스케줄러 (wikiDday.scheduler.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 준수 (약 100줄)
 * [규칙 2] 100% 한국어 인터페이스 및 일상 친화적 용어 준수
 * [기능]
 *  1. 보조서버 위키(HP 15)의 미완료 D-Day 목록 중 임박 일정(D-7, D-3, D-1, 당일 등) 감지
 *  2. 매일 오전 08:30 KST 정기 브리핑 시간 또는 설정 시각에 포털 중앙 푸시 발송
 *  3. 중복 발송 방지(sentHistoryCache) 멱등성 보장
 *  4. 네트워크 순단 시 무장애(3초 타임아웃, 예외 격리) 보장
 * ==============================================================================
 */

const http = require('http');
const { WIKI_HOST, WIKI_PORT } = require('../../config/constants');

// HTTP Keep-Alive Agent (반복 연결 오버헤드 최소화)
const ddayKeepAliveAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 10,
    maxFreeSockets: 5,
    timeout: 3000
});

// 보조서버 위키에서 임박 D-Day 목록 비동기 조회 (3초 타임아웃)
function fetchImminentDdaysFromWiki(daysLimit = 7) {
    return new Promise((resolve) => {
        const reqPath = `/api/wiki/dday/imminent?days=${daysLimit}`;
        const options = {
            hostname: WIKI_HOST,
            port: WIKI_PORT,
            path: reqPath,
            method: 'GET',
            agent: ddayKeepAliveAgent,
            timeout: 3000
        };

        const req = http.request(options, (res) => {
            let rawData = '';
            res.on('data', chunk => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(rawData);
                    if (parsed && parsed.success && Array.isArray(parsed.items)) {
                        resolve(parsed.items);
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    resolve([]);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve([]);
        });

        req.on('error', () => {
            // 보조서버 오프라인 시 에러를 조용히 삼키고 빈 배열 반환 (무장애 원칙)
            resolve([]);
        });

        req.end();
    });
}

/**
 * ⏳ 임박 D-Day 조건 검사 및 포털 푸시/알림센터 디스패치
 * @param {string} userId - 수신 대상 사용자 ID
 * @param {string} kstDateStr - YYYY-MM-DD
 * @param {string} kstTimeStr - HH:mm
 * @param {function} sendBroadcastPush - 포털 중앙 푸시 함수
 * @param {Set} sentHistoryCache - 당일 중복 발송 방지 캐시 Set
 * @param {boolean} forceRun - 강제 실행 여부 (테스트/초기화 시)
 */
async function checkAndDispatchWikiDday(userId, kstDateStr, kstTimeStr, sendBroadcastPush, sentHistoryCache, forceRun = false) {
    // 1. 발송 시각 검사: 기본 매일 오전 08:30 (KST)에 1회 발송
    const TARGET_DISPATCH_TIME = '08:30';
    if (!forceRun && kstTimeStr !== TARGET_DISPATCH_TIME) {
        return;
    }

    try {
        const imminentItems = await fetchImminentDdaysFromWiki(7);
        if (!imminentItems || imminentItems.length === 0) return;

        for (const item of imminentItems) {
            const info = item.dday_info || {};
            const daysDiff = typeof info.days_diff === 'number' ? info.days_diff : 999;

            // 알림 발송 조건: D-7, D-3, D-1, 당일(0), 기한 초과(D+1, D+2, D+3)
            let stageKey = '';
            let alertPhrase = '';

            if (daysDiff === 0) {
                stageKey = 'd0';
                alertPhrase = '오늘 예정된 일정입니다! 잊지 말고 챙겨주세요.';
            } else if (daysDiff === 1) {
                stageKey = 'd1';
                alertPhrase = '내일 예정된 일정입니다. 미리 확인해 주세요.';
            } else if (daysDiff === 3) {
                stageKey = 'd3';
                alertPhrase = '예정일까지 3일 남았습니다. 미리 준비해 주세요.';
            } else if (daysDiff === 7) {
                stageKey = 'd7';
                alertPhrase = '예정일까지 1주일 남았습니다.';
            } else if (daysDiff < 0 && daysDiff >= -3) {
                const overdueDays = Math.abs(daysDiff);
                stageKey = `overdue_${overdueDays}`;
                alertPhrase = `예정일이 ${overdueDays}일 지났습니다. 점검을 완료해 주세요!`;
            } else {
                // 발송 기준일 외의 날짜(예: D-5, D-4 등)는 스킵하여 알림 피로도 차단
                continue;
            }

            // 2. 중복 발송 방지 키 (유저 + 항목ID + 시점단계 + 오늘날짜)
            const cacheKey = `${userId}:wiki_dday:${item.id}:${stageKey}:${kstDateStr}`;
            if (sentHistoryCache && sentHistoryCache.has(cacheKey)) {
                continue;
            }
            if (sentHistoryCache) {
                sentHistoryCache.add(cacheKey);
            }

            // 3. 알림 타이틀 및 본문 작성
            const ddayBadge = info.text || (daysDiff === 0 ? 'D-Day' : (daysDiff > 0 ? `D-${daysDiff}` : `D+${Math.abs(daysDiff)}`));
            const pushTitle = `⏳ [D-Day] ${item.title} (${ddayBadge})`;
            const memoText = (item.memo && item.memo.trim()) ? `\n메모: ${item.memo.trim()}` : '';
            const pushBody = `[${item.category}] ${item.title}\n${alertPhrase}${memoText}`;

            // 4. 통합 푸시 및 알림 내역 저장 (type='calendar'로 분류되어 알림센터 '일정' 탭에 자동 배치)
            sendBroadcastPush({
                title: pushTitle,
                body: pushBody,
                url: 'https://j-jg.cc/wiki',
                type: 'calendar',
                tag: `jg-wiki-dday-${item.id}`,
                userId: userId
            });

            console.log(`[WikiDdayScheduler] ⏳ D-Day 푸시 발송 완료 [${stageKey}]: ${item.title} (대상: ${userId})`);
        }
    } catch (err) {
        console.error('[WikiDdayScheduler] D-Day 알림 처리 중 오류:', err.message);
    }
}

module.exports = {
    checkAndDispatchWikiDday,
    fetchImminentDdaysFromWiki
};
