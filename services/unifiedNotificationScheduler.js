const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const { exec } = require('child_process');
const { portalDb } = require('./db');
const { ipv4HttpsAgent, sendServerTelegram } = require('./telegramAlert.service');
const { checkAndDispatchHospitalVisit } = require('./scheduler/hospitalVisit.scheduler');
const { checkAndDispatchCalendarEvents } = require('./scheduler/calendarEvent.scheduler');
const { checkAndDispatchWikiDday } = require('./scheduler/wikiDday.scheduler');
const { checkPm2Health, checkDiskHealth } = require('./scheduler/systemHealth.scheduler');

// ==============================================================================
// 🌟 JG 통합 포털 단일 알림 스케줄러 (Unified Notification Scheduler)
// 모든 서비스(날씨, 증시, 복약, 혈압, 병원, 서버경보)의 스케줄링을 단일 중앙 관리
// ==============================================================================

// 구글 대한민국 공휴일 캘린더 ID
const HOLIDAY_CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';

// 인메모리 캐시 상태
let cachedHolidays = [];
const sentHistoryCache = new Set(); // 키: userId:type:YYYY-MM-DD_HH:mm

// Google Calendar API로 올해 한국 공휴일 가져오기
async function fetchGoogleHolidays() {
    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!apiKey) {
        console.log('[UnifiedScheduler] ⚠️ GOOGLE_CALENDAR_API_KEY 미설정 -> 주말(토/일) 기준으로만 공휴일 판별');
        return;
    }

    const currentYear = new Date().getFullYear();
    const timeMin = `${currentYear}-01-01T00:00:00Z`;
    const timeMax = `${currentYear}-12-31T23:59:59Z`;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(HOLIDAY_CALENDAR_ID)}/events`;

    try {
        const response = await axios.get(url, {
            params: {
                key: apiKey,
                timeMin,
                timeMax,
                singleEvents: true
            },
            httpsAgent: ipv4HttpsAgent,
            timeout: 8000
        });

        if (response.data && response.data.items) {
            cachedHolidays = response.data.items
                .map(item => item.start ? (item.start.date || item.start.dateTime?.substring(0, 10)) : null)
                .filter(Boolean);
            console.log(`[UnifiedScheduler] ${currentYear}년 공휴일 ${cachedHolidays.length}개 동기화 완료`);
        }
    } catch (err) {
        console.error('[UnifiedScheduler] 구글 공휴일 동기화 실패 (주말 검사로 동작):', err.response?.data?.error?.message || err.message);
    }
}

// 오늘이 주말(토/일)이거나 구글 공휴일인지 검사
function isWeekendOrHoliday(dateObj) {
    const dayOfWeek = dateObj.getDay(); // 0: 일요일, 6: 토요일
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    return cachedHolidays.includes(dateStr);
}

/**
 * 단일 통합 알림 스케줄러 초기화
 * @param {object} db - SQLite 데이터베이스 인스턴스 (health.db)
 * @param {function} sendBroadcastPush - 포털 중앙 푸시 발송 함수
 * @param {function} getLiveWeatherData - 실시간 날씨 데이터 조회 함수
 * @param {function} getLiveMarketData - 실시간 증시/환율 데이터 조회 함수
 */
function initUnifiedNotificationScheduler(db, sendBroadcastPush, getLiveWeatherData, getLiveMarketData) {
    console.log('⏰ [UnifiedScheduler] 단일 통합 알림 스케줄러 기동 시작...');

    // 1. 공휴일 초기 로드
    fetchGoogleHolidays();

    // 2. 매일 자정(00:00 KST) 일괄 유지보수 스케줄
    cron.schedule('0 0 * * *', () => {
        fetchGoogleHolidays();
        sentHistoryCache.clear();
        console.log('[UnifiedScheduler] 자정 스케줄: 공휴일 갱신 및 중복발송 캐시 초기화 완료');

        // 30일 경과 알림 내역 자동 정리
        db.run("DELETE FROM notification_history WHERE datetime(created_at) < datetime('now', '-30 days', 'localtime')", function(cleanErr) {
            if (!cleanErr && this && this.changes > 0) {
                console.log(`[UnifiedScheduler] 30일 경과 알림 내역 ${this.changes}건 자동 정리 완료`);
            }
        });
    }, {
        timezone: 'Asia/Seoul',
        missedExecutionTolerance: 300000
    });

    // 2-1. 매일 새벽 04:00 (KST) 데이터베이스 핫 백업 및 보조 서버 전송 스케줄러
    cron.schedule('0 4 * * *', () => {
        console.log('⏰ [UnifiedScheduler] 매일 새벽 04:00 정기 백업 스크립트 실행 시작...');
        const homeScript = path.join(require('os').homedir(), 'scripts', 'backup-to-secondary.sh');
        const backupScript = fs.existsSync(homeScript)
            ? homeScript
            : path.resolve(__dirname, '../../scripts/backup-to-secondary.sh');
        exec(`bash ${backupScript}`, (err, stdout, stderr) => {
            if (err) {
                console.error('[UnifiedScheduler] ❌ 정기 백업 실행 오류:', err.message);
                return;
            }
            console.log('[UnifiedScheduler] ✅ 정기 백업 스크립트 실행 성공:\n', stdout);
        });
    }, {
        timezone: 'Asia/Seoul',
        missedExecutionTolerance: 300000
    });

    // 3. 매 1분 감시 루프 (모바일 PRoot 환경 지연 무누락 2중 안전 보장)
    let lastExecutedMinuteStr = '';

    function executeMinuteRoutine() {
        const now = new Date();
        const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        const parts = kstFormatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '';
        const kstDateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
        const kstTimeStr = `${getPart('hour')}:${getPart('minute')}`;
        const minuteKey = `${kstDateStr} ${kstTimeStr}`;

        // 동일한 분(minute)에는 중복 실행되지 않도록 멱등성 보장
        if (lastExecutedMinuteStr === minuteKey) return;
        lastExecutedMinuteStr = minuteKey;

        const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const dayOfWeek = kstNow.getDay();
        const currentTargetDateTime = `${kstDateStr} ${kstTimeStr}:00`;
        const isHoliday = isWeekendOrHoliday(kstNow);

        // ======================================================================
        // [A] 유저별 설정 기반 알림 (날씨, 증시, 복약, 혈압, 병원)
        // ======================================================================
        db.all("SELECT * FROM notification_settings WHERE enabled = 1", [], (err, userList) => {
            if (err || !userList || userList.length === 0) return;

            userList.forEach(async (u) => {
                const userId = u.user_id;

                // ------------------------------------------------------------------
                // 1. 🌤️ 아침 기상 특보 & 우산 알림
                // ------------------------------------------------------------------
                const targetWeatherTime = (u.weather_morning_time || '07:00').trim();
                if (u.weather_morning_enabled !== 0 && kstTimeStr === targetWeatherTime) {
                    const cacheKey = `${userId}:weather:${kstDateStr}_${targetWeatherTime}`;
                    if (!sentHistoryCache.has(cacheKey)) {
                        sentHistoryCache.add(cacheKey);
                        try {
                            const weather = await getLiveWeatherData();
                            let umbrellaTip = '오늘도 쾌청하고 상쾌한 하루 보내세요! ☀️';
                            const cond = weather.condition || '';
                            if (cond.includes('비') || cond.includes('소나기') || cond.includes('뇌우') || cond.includes('눈')) {
                                umbrellaTip = '오늘 강수 소식이 있으니 출근길 우산을 꼭 챙기세요! ☔';
                            } else if (cond.includes('흐림') || cond.includes('구름')) {
                                umbrellaTip = '하늘이 다소 흐리니 따뜻하게 챙겨 입으세요! ⛅';
                            }

                            sendBroadcastPush({
                                title: '🌤️ 아침 날씨',
                                body: `현재 ${weather.city || '계룡'} ${weather.temp} (${weather.condition}). ${umbrellaTip}`,
                                url: 'https://news.j-jg.cc/weather',
                                type: 'weather',
                                tag: 'jg-weather',
                                userId
                            });
                        } catch (wErr) {
                            console.error('[UnifiedScheduler] 아침 날씨 알림 생성 실패:', wErr.message);
                        }
                    }
                }

                // ------------------------------------------------------------------
                // 2. 💰 평일 국내 증시 개장(09:00) & 마감(15:30) 및 환율 리포트 (휴장일 제외)
                // ------------------------------------------------------------------
                const isAssetEnabled = u.asset_report_enabled !== 0;
                const isAssetOpenEnabled = isAssetEnabled && (u.asset_open_enabled !== 0);
                const isAssetCloseEnabled = isAssetEnabled && (u.asset_close_enabled !== 0);

                // [2-1] 개장 브리핑 (평일 09:00 KST)
                if (isAssetOpenEnabled && dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday && kstTimeStr === '09:00') {
                    const cacheKey = `${userId}:asset_open:${kstDateStr}`;
                    if (!sentHistoryCache.has(cacheKey)) {
                        sentHistoryCache.add(cacheKey);
                        try {
                            const market = await getLiveMarketData();
                            const kospi = market.kospi ? `코스피 ${market.kospi.price}(${market.kospi.ratio})` : '';
                            const usdkrw = market.usdkrw ? `환율 ${market.usdkrw.price}원` : '';
                            const marketSummary = [kospi, usdkrw].filter(Boolean).join(' | ');

                            sendBroadcastPush({
                                title: '💰 국내 증시 개장',
                                body: marketSummary ? `${marketSummary}. 오늘의 국내 증시가 개장했습니다. 시장 동향을 확인하세요.` : '오늘의 국내 증시가 개장했습니다. 실시간 시장 지표를 확인하세요.',
                                url: 'https://news.j-jg.cc/economy',
                                type: 'economy',
                                tag: 'jg-asset-open',
                                userId
                            });
                        } catch (mErr) {
                            console.error('[UnifiedScheduler] 개장 증시 알림 생성 실패:', mErr.message);
                        }
                    }
                }

                // [2-2] 마감 브리핑 (평일 15:30 KST)
                if (isAssetCloseEnabled && dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday && kstTimeStr === '15:30') {
                    const cacheKey = `${userId}:asset_close:${kstDateStr}`;
                    if (!sentHistoryCache.has(cacheKey)) {
                        sentHistoryCache.add(cacheKey);
                        try {
                            const market = await getLiveMarketData();
                            const kospi = market.kospi ? `코스피 ${market.kospi.price}(${market.kospi.ratio})` : '';
                            const usdkrw = market.usdkrw ? `환율 ${market.usdkrw.price}원` : '';
                            const marketSummary = [kospi, usdkrw].filter(Boolean).join(' | ');

                            sendBroadcastPush({
                                title: '💰 국내 증시 마감',
                                body: marketSummary ? `${marketSummary}. 오늘의 시장 마감 브리핑을 확인하세요.` : '오늘의 국내 증시가 마감되었습니다. 실시간 증시 환율을 확인하세요.',
                                url: 'https://news.j-jg.cc/economy',
                                type: 'economy',
                                tag: 'jg-asset-close',
                                userId
                            });
                        } catch (mErr) {
                            console.error('[UnifiedScheduler] 마감 증시 알림 생성 실패:', mErr.message);
                        }
                    }
                }

                // ------------------------------------------------------------------
                // 3. 💊 정기 복약 시간 알림 (공휴일/주말 맞춤 시간표)
                // ------------------------------------------------------------------
                let medTimes = [];
                let bpTimes = [];
                try {
                    medTimes = JSON.parse(isHoliday ? (u.weekend_med_times || '[]') : (u.weekday_med_times || '[]'));
                    bpTimes = JSON.parse(isHoliday ? (u.weekend_bp_times || '[]') : (u.weekday_bp_times || '[]'));
                } catch (pErr) {
                    console.error(`[UnifiedScheduler] 유저(${userId}) 시간표 JSON 파싱 실패:`, pErr.message);
                }

                if (medTimes.includes(kstTimeStr)) {
                    const cacheKey = `${userId}:medication:${kstDateStr}_${kstTimeStr}`;
                    if (!sentHistoryCache.has(cacheKey)) {
                        sentHistoryCache.add(cacheKey);
                        sendBroadcastPush({
                            title: '💊 약 복용 알림',
                            body: `설정하신 ${kstTimeStr} 약 복용 시간입니다. 잊지 말고 복용해 주세요!`,
                            url: 'https://blood.j-jg.cc/dashboard.html',
                            type: 'medication',
                            tag: 'jg-medication',
                            userId
                        });
                    }
                }

                // ------------------------------------------------------------------
                // 4. 🩸 정기 혈압 측정 시간 알림
                // ------------------------------------------------------------------
                if (bpTimes.includes(kstTimeStr)) {
                    const cacheKey = `${userId}:blood_pressure:${kstDateStr}_${kstTimeStr}`;
                    if (!sentHistoryCache.has(cacheKey)) {
                        sentHistoryCache.add(cacheKey);
                        sendBroadcastPush({
                            title: '🩸 혈압 측정 알림',
                            body: `설정하신 ${kstTimeStr} 혈압 측정 시간입니다. 편안한 상태에서 측정해 주세요!`,
                            url: 'https://blood.j-jg.cc/dashboard.html',
                            type: 'blood_pressure',
                            tag: 'jg-blood-pressure',
                            userId
                        });
                    }
                }

                // ------------------------------------------------------------------
                // 5. 🎯 당일 혈압 미측정 저녁 리마인드 (오늘 기록 0건일 때 설정 시각)
                // ------------------------------------------------------------------
                const targetBpTime = (u.bp_reminder_time || '21:00').trim();
                if (u.bp_reminder_enabled !== 0 && kstTimeStr === targetBpTime) {
                    const cacheKey = `${userId}:bp_evening_remind:${kstDateStr}_${targetBpTime}`;
                    if (!sentHistoryCache.has(cacheKey)) {
                        sentHistoryCache.add(cacheKey);
                        db.get(
                            "SELECT COUNT(*) as count FROM records WHERE substr(measured_at, 1, 10) = ?",
                            [kstDateStr],
                            (rErr, row) => {
                                if (rErr) return;
                                if (!row || row.count === 0) {
                                    sendBroadcastPush({
                                        title: '🩸 혈압 리마인드',
                                        body: '오늘 아직 혈압 측정 기록이 없습니다. 취침 전 편안한 상태에서 혈압을 측정해 주세요!',
                                        url: 'https://blood.j-jg.cc/dashboard.html',
                                        type: 'blood_pressure',
                                        tag: 'jg-evening-bp-remind',
                                        userId
                                    });
                                }
                            }
                        );
                    }
                }

                // ------------------------------------------------------------------
                // 6. 🏥 병원 진료 예약 오픈 알림 (실시간 약 잔여량 기준 11:00 오픈 시)
                // ------------------------------------------------------------------
                if (u.hospital_push_enabled !== 0) {
                    checkAndDispatchHospitalVisit(db, userId, currentTargetDateTime, sendBroadcastPush);
                }

                // ------------------------------------------------------------------
                // 7. 📅 캘린더 개인 일정 알림 (종일 및 시간 지정 일정 / 사전 및 다회 발송)
                // ------------------------------------------------------------------
                checkAndDispatchCalendarEvents(portalDb || db, userId, kstDateStr, kstTimeStr, currentTargetDateTime, sendBroadcastPush, sentHistoryCache);

                // ------------------------------------------------------------------
                // 8. ⏳ 위키 생활 D-Day 및 소모품 교체 주기 임박 알림 (D-7, D-3, D-1, 당일)
                // ------------------------------------------------------------------
                checkAndDispatchWikiDday(userId, kstDateStr, kstTimeStr, sendBroadcastPush, sentHistoryCache);
            });
        });

        // ======================================================================
        // [B] 🖥️ PM2 프로세스 다운/복구 헬스체크 및 텔레그램 자동 경보 & 1회 자동 복구
        // ======================================================================
        checkPm2Health(currentTargetDateTime, sendBroadcastPush);

        // ======================================================================
        // [C] 💾 디스크 용량(UFS) 헬스체크 (5분마다 1회 실행, 90% 초과 시 텔레그램 경보)
        // ======================================================================
        checkDiskHealth(kstDateStr, kstTimeStr, currentTargetDateTime);
    }

    // [트리거 1] node-cron 1분 스케줄러 (지연 허용 오차 120초 지정)
    cron.schedule('* * * * *', () => {
        executeMinuteRoutine();
    }, {
        timezone: 'Asia/Seoul',
        missedExecutionTolerance: 120000
    });

    // [트리거 2] 모바일 PRoot 절전/타이머 지연 완벽 방어용 10초 주기 무누락 보강 워처
    setInterval(() => {
        executeMinuteRoutine();
    }, 10000);

    // 기동 즉시 현재 분(minute) 1회 즉시 실행
    executeMinuteRoutine();

    console.log('✅ [UnifiedScheduler] 단일 통합 알림 스케줄러 등록 완료!');
}

module.exports = {
    initUnifiedNotificationScheduler,
    sendServerTelegram
};
