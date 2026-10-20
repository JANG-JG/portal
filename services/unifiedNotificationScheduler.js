const fs = require('fs');
const path = require('path');
const https = require('https');
const cron = require('node-cron');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { exec } = require('child_process');

// 🌐 Node.js 18+ IPv6 바인딩 지연/타임아웃(ETIMEDOUT / ENETUNREACH) 방지 전용 IPv4 HTTPS 에이전트
const ipv4HttpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    timeout: 8000
});

// ==============================================================================
// 🌟 JG 통합 포털 단일 알림 스케줄러 (Unified Notification Scheduler)
// 모든 서비스(날씨, 증시, 복약, 혈압, 병원, 서버경보)의 스케줄링을 단일 중앙 관리
// ==============================================================================

// 구글 대한민국 공휴일 캘린더 ID
const HOLIDAY_CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';

// 인메모리 캐시 상태
let cachedHolidays = [];
const sentHistoryCache = new Set(); // 키: userId:type:YYYY-MM-DD_HH:mm
let lastWeatherSentDate = '';
let lastAssetSentDate = '';
let lastBpSentDate = '';
const pm2DownAlertState = {};
let lastDiskAlertDate = '';

// 서버 전용 텔레그램 알림 발송 헬퍼 함수 (IPv4 강제 적용 및 반환값 제공)
async function sendServerTelegram(text) {
    const token = process.env.SERVER_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.SERVER_TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.warn('[UnifiedScheduler] 텔레그램 설정 누락: SERVER_TELEGRAM_BOT_TOKEN 또는 SERVER_TELEGRAM_CHAT_ID 미설정');
        return { success: false, error: 'SERVER_TELEGRAM_BOT_TOKEN 또는 SERVER_TELEGRAM_CHAT_ID 환경변수가 설정되지 않았습니다.' };
    }

    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown'
        }, {
            httpsAgent: ipv4HttpsAgent,
            timeout: 8000
        });

        if (res.data && res.data.ok) {
            console.log('✅ [UnifiedScheduler] 텔레그램 서버 경보 발송 성공:', res.data.result?.message_id);
            return { success: true, messageId: res.data.result?.message_id };
        } else {
            console.error('[UnifiedScheduler] 텔레그램 응답 오류:', res.data);
            return { success: false, error: res.data?.description || '응답 오류' };
        }
    } catch (tgErr) {
        const errMsg = tgErr.response?.data?.description || tgErr.message;
        console.error('[UnifiedScheduler] 텔레그램 서버 경보 발송 실패:', errMsg);
        return { success: false, error: errMsg };
    }
}

// 이메일 발송기 (Gmail SMTP)
const mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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

// 병원 진료 예약 오픈일 계산 (약 소진 3일 전 일자의 전주 금요일 11시)
function calculateReservationOpenDate(nextVisitDateStr) {
    const nextVisit = new Date(nextVisitDateStr);
    const dayOfWeek = nextVisit.getDay();
    const sunday = new Date(nextVisit);
    sunday.setDate(nextVisit.getDate() - dayOfWeek);

    const openFriday = new Date(sunday);
    openFriday.setDate(sunday.getDate() - 2);

    const year = openFriday.getFullYear();
    const month = String(openFriday.getMonth() + 1).padStart(2, '0');
    const day = String(openFriday.getDate()).padStart(2, '0');

    return `${year}-${month}-${day} 11:00:00`;
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
    });

    // 2-1. 매일 새벽 04:00 (KST) 데이터베이스 핫 백업 및 보조 서버 전송 스케줄러
    cron.schedule('0 4 * * *', () => {
        console.log('⏰ [UnifiedScheduler] 매일 새벽 04:00 정기 백업 스크립트 실행 시작...');
        const backupScript = fs.existsSync('/home/upt0731/scripts/backup-to-secondary.sh')
            ? '/home/upt0731/scripts/backup-to-secondary.sh'
            : path.resolve(__dirname, '../../scripts/backup-to-secondary.sh');
        exec(`bash ${backupScript}`, (err, stdout, stderr) => {
            if (err) {
                console.error('[UnifiedScheduler] ❌ 정기 백업 실행 오류:', err.message);
                return;
            }
            console.log('[UnifiedScheduler] ✅ 정기 백업 스크립트 실행 성공:\n', stdout);
        });
    }, {
        timezone: 'Asia/Seoul'
    });

    // 3. 매 1분 감시 루프
    cron.schedule('* * * * *', () => {
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
                checkAndDispatchCalendarEvents(db, userId, kstDateStr, kstTimeStr, currentTargetDateTime, sendBroadcastPush);
            });
        });

        // ======================================================================
        // [B] 🖥️ PM2 프로세스 다운/복구 헬스체크 및 텔레그램 자동 경보 & 1회 자동 복구
        // ======================================================================
        exec('pm2 jlist', (err, stdout) => {
            if (err || !stdout) return;
            try {
                const procList = JSON.parse(stdout);
                const monitoredApps = ['portal', 'blood-pressure-app', 'asset', 'news-dashboard', 'news-scheduler', 'cloudflared'];

                monitoredApps.forEach(appName => {
                    const proc = procList.find(p => p.name === appName);
                    if (proc) {
                        const status = proc.pm2_env.status;
                        const isOnline = status === 'online';

                        // 1. 장애 감지 (최초 다운 시 1회 발송 및 자동 재기동 시도)
                        if (!isOnline && !pm2DownAlertState[appName]) {
                            pm2DownAlertState[appName] = true;
                            console.warn(`🚨 [PM2 ALERT] ${appName} 프로세스 비정상 상태 감지 (${status})`);

                            // [텔레그램 경보 발송 (새로 생성한 서버 알림봇)]
                            const alertMsg = `🚨 *[JG Server 프로세스 장애 경보]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: \`${status}\` (비정상 다운 감지)\n• *감지 시각*: ${currentTargetDateTime}\n\n⚙️ *자동 복구(pm2 restart)를 1회 시도합니다...*`;
                            sendServerTelegram(alertMsg);

                            // [웹 푸시 발송 (관리자 전용)]
                            sendBroadcastPush({
                                title: '🚨 서버 경보',
                                body: `${appName} 장애 발생 (${status}). 자동 복구를 시도합니다.`,
                                url: 'https://j-jg.cc/admin#tab-overview',
                                type: 'system',
                                tag: `jg-pm2-${appName}`,
                                adminOnly: true
                            });

                            // [1회 자동 복구 시도: pm2 restart]
                            exec(`pm2 restart ${appName}`, (restartErr) => {
                                if (restartErr) {
                                    console.error(`[PM2 AUTO-RESTART] ${appName} 재기동 오류:`, restartErr.message);
                                }
                                // 재기동 후 4초 뒤 상태 재점검
                                setTimeout(() => {
                                    exec('pm2 jlist', (chkErr, chkStdout) => {
                                        if (chkErr || !chkStdout) return;
                                        try {
                                            const updatedProcs = JSON.parse(chkStdout);
                                            const target = updatedProcs.find(p => p.name === appName);
                                            if (target && target.pm2_env.status === 'online') {
                                                pm2DownAlertState[appName] = false;
                                                const recoveryMsg = `✅ *[JG Server 자동 복구 성공]*\n\n• *프로세스*: \`${appName}\`\n• *현재 상태*: \`online\`\n• *복구 완료*: 정상 가동 중입니다.`;
                                                sendServerTelegram(recoveryMsg);
                                                sendBroadcastPush({
                                                    title: '✅ 서버 복구 성공',
                                                    body: `${appName} 프로세스가 자동 재기동되어 정상 복구되었습니다.`,
                                                    url: 'https://j-jg.cc/admin#tab-overview',
                                                    type: 'system',
                                                    tag: `jg-pm2-${appName}`,
                                                    adminOnly: true
                                                });
                                            } else {
                                                const failMsg = `❌ *[JG Server 자동 복구 실패]*\n\n• *프로세스*: \`${appName}\`\n• *현재 상태*: \`${target ? target.pm2_env.status : 'unknown'}\`\n• *경고*: 재기동 후에도 online 상태가 아닙니다. 관리자의 수동 확인이 필요합니다!`;
                                                sendServerTelegram(failMsg);
                                            }
                                        } catch (parseChkErr) {}
                                    });
                                }, 4000);
                            });
                        }
                        // 2. 수동 복구 또는 다음 주기에서 정상 복구 확인된 경우
                        else if (isOnline && pm2DownAlertState[appName]) {
                            pm2DownAlertState[appName] = false;
                            console.log(`✅ [PM2 RECOVERY] ${appName} 프로세스 정상 복구 확인`);

                            sendServerTelegram(`✅ *[JG Server 프로세스 정상 복구]*\n\n• *프로세스*: \`${appName}\`\n• *상태*: \`online\`\n• *복구 시각*: ${currentTargetDateTime}`);
                            sendBroadcastPush({
                                title: '✅ 서버 복구',
                                body: `${appName} 프로세스가 다시 온라인(online) 상태로 정상 복구되었습니다.`,
                                url: 'https://j-jg.cc/admin#tab-overview',
                                type: 'system',
                                tag: `jg-pm2-${appName}`,
                                adminOnly: true
                            });
                        }
                    }
                });
            } catch (parseErr) {}
        });

        // ======================================================================
        // [C] 💾 디스크 용량(UFS) 헬스체크 (5분마다 1회 실행, 90% 초과 시 텔레그램 경보)
        // ======================================================================
        if (kstTimeStr.endsWith('0') || kstTimeStr.endsWith('5')) {
            exec("df -k / | awk 'NR==2 {print $2, $3, $4, $5}'", (dfErr, dfStdout) => {
                if (dfErr || !dfStdout) return;
                try {
                    const [totalBlocks, usedBlocks, availBlocks, usePercentStr] = dfStdout.trim().split(/\s+/);
                    const usePercent = parseInt(usePercentStr.replace('%', ''), 10);
                    if (!isNaN(usePercent) && usePercent >= 90) {
                        // 일 1회 제한 (하루 1번만 발송하여 도배 방지)
                        if (lastDiskAlertDate !== kstDateStr) {
                            lastDiskAlertDate = kstDateStr;
                            const totalGB = (parseInt(totalBlocks, 10) / 1024 / 1024).toFixed(1);
                            const availGB = (parseInt(availBlocks, 10) / 1024 / 1024).toFixed(1);

                            const diskAlertMsg = `⚠️ *[JG Server 디스크 용량 경보]*\n\n• *루트 저장소(/)*: *${usePercent}%* 사용 중!\n• *잔여 용량*: ${availGB} GB / 전체: ${totalGB} GB\n• *감지 시각*: ${currentTargetDateTime}\n\n_디스크 풀(100%) 발생 시 DB 락 및 서버 크래시가 발생할 수 있습니다. 불필요한 로그와 캐시 정리를 권장합니다._`;
                            sendServerTelegram(diskAlertMsg);
                            console.warn(`⚠️ [DISK ALERT] 루트 디스크 사용량 ${usePercent}% 초과 경보 발송`);
                        }
                    }
                } catch (dfParseErr) {}
            });
        }
    });

    console.log('✅ [UnifiedScheduler] 단일 통합 알림 스케줄러 등록 완료!');
}

// 병원 진료 예약 오픈 알림 조건 검사 및 발송
function checkAndDispatchHospitalVisit(db, userId, currentTargetDateTime, sendBroadcastPush) {
    const summaryQuery = `
        SELECT MIN(visit_date) as first_visit, SUM(prescription_days) as total_prescribed
        FROM hospital_visits
        WHERE user_id = ?
    `;

    db.get(summaryQuery, [userId], (sumErr, visitSummary) => {
        if (sumErr || !visitSummary || !visitSummary.first_visit) return;

        const medQuery = `
            SELECT COUNT(DISTINCT substr(measured_at, 1, 10)) as total_taken 
            FROM records 
            WHERE substr(measured_at, 1, 10) >= ? 
              AND medication_time IS NOT NULL 
              AND length(medication_time) > 5
        `;

        db.get(medQuery, [visitSummary.first_visit], (medErr, medResult) => {
            const totalTaken = medResult ? medResult.total_taken : 0;
            const totalPrescribed = visitSummary.total_prescribed || 0;
            const remainingPills = Math.max(0, totalPrescribed - totalTaken);

            const now = new Date();
            const predictedVisit = new Date(now);
            predictedVisit.setDate(now.getDate() + remainingPills - 3);
            const predictedVisitStr = predictedVisit.toISOString().split('T')[0];

            const dynamicOpenDate = calculateReservationOpenDate(predictedVisitStr);

            if (dynamicOpenDate <= currentTargetDateTime) {
                db.get(
                    `SELECT * FROM hospital_visits WHERE user_id = ? AND send_notification = 1 AND notified = 0 ORDER BY visit_date DESC LIMIT 1`,
                    [userId],
                    (rowErr, row) => {
                        if (!row) return;

                        // 중복 발송 방지를 위해 먼저 알림 완료 처리
                        db.run(`UPDATE hospital_visits SET notified = 1 WHERE id = ?`, [row.id]);

                        const hospitalNameDisplay = row.hospital_name ? `[${row.hospital_name}] ` : '';
                        const targetEmail = row.notification_email || process.env.EMAIL_USER;

                        // 1. Gmail SMTP 이메일 발송
                        if (process.env.EMAIL_USER && process.env.EMAIL_PASS && targetEmail) {
                            const mailOptions = {
                                from: process.env.EMAIL_USER,
                                to: targetEmail,
                                subject: `[알림] 🏥 ${hospitalNameDisplay}진료 예약 오픈 안내`,
                                html: `
                                    <h3>🏥 병원 진료 예약 안내</h3>
                                    <p>현재 약 잔여량 기준, <strong>예약 오픈 시각(오전 11시)</strong>이 되었습니다.</p>
                                    <ul>
                                        <li><strong>진료 병원:</strong> ${row.hospital_name || '미지정'} ${row.department ? '(' + row.department + ')' : ''}</li>
                                        <li><strong>최근 진료일:</strong> ${row.visit_date}</li>
                                        <li><strong>현재 남은 약:</strong> ${remainingPills}일분</li>
                                        <li><strong>예측 방문일:</strong> ${predictedVisitStr}</li>
                                        <li><strong>메모:</strong> ${row.memo || '없음'}</li>
                                    </ul>
                                    <p><a href="https://blood.j-jg.cc/hospital.html" target="_blank" style="display:inline-block; padding:10px 18px; background:#4f46e5; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:bold;">🏥 병원 진료 일정 관리 바로가기</a></p>
                                `
                            };
                            mailTransporter.sendMail(mailOptions, (error) => {
                                if (error) console.error('[UnifiedScheduler] 예약 알림 메일 발송 실패:', error.message);
                                else console.log(`[UnifiedScheduler] ✉️ 예약 알림 메일 발송 완료: ${targetEmail}`);
                            });
                        }

                        // 2. 통합 웹 푸시 발송
                        sendBroadcastPush({
                            title: `🏥 ${hospitalNameDisplay}진료 예약 오픈 알림`,
                            body: `오전 11시 예약 오픈 시간입니다! 남은 약: ${remainingPills}일분 (예상 진료일: ${predictedVisitStr})`,
                            url: 'https://blood.j-jg.cc/hospital.html',
                            type: 'hospital',
                            tag: 'jg-hospital',
                            userId
                        });
                    }
                );
            }
        });
    });
}

// 📅 개인 일정 푸시 알림 조건 검사 및 발송 (종일/시간지정, 사전/정시, 다회 알림)
function checkAndDispatchCalendarEvents(db, userId, kstDateStr, kstTimeStr, currentTargetDateTime, sendBroadcastPush) {
    // 오늘 및 내일 일정 검색 (사전 알림 1일 전 대응을 위해 +1일까지 조회)
    const query = `
        SELECT id, title, event_date, event_time, memo, is_all_day, notify_timing, notify_repeat, notify_sent_count
        FROM calendar_events
        WHERE (user_id = ? OR user_id = 'admin')
          AND is_completed = 0
          AND notify_timing != 'none'
          AND event_date >= date(?, '-1 day')
          AND event_date <= date(?, '+1 day')
    `;

    db.all(query, [userId, kstDateStr, kstDateStr], (err, rows) => {
        if (err || !rows || rows.length === 0) return;

        rows.forEach(ev => {
            const isAllDay = !!ev.is_all_day;
            const timing = ev.notify_timing || 'exact'; // 'exact', '10m', '30m', '1h', '1d'
            const maxRepeat = ev.notify_repeat || 1;
            const sentCount = ev.notify_sent_count || 0;

            if (sentCount >= maxRepeat) return;

            // 🌟 사용자 요청 포맷: 
            // 일정 제목
            // 일정 메모
            // 일정 시점 - 일정 시간
            function buildCalPushBody(pointLabel, timeLabel) {
                const memoText = (ev.memo && ev.memo.trim()) ? `${ev.memo.trim()}\n` : '';
                return `${memoText}${pointLabel} - ${timeLabel}`;
            }

            // 1. 종일 일정 처리 (기본 오전 09:00 발송)
            if (isAllDay) {
                if (kstTimeStr !== '09:00') return;

                // 1일 전 알림
                if (timing === '1d') {
                    // 내일 일정인 경우 (1일 전 오전 9시 알림)
                    const tomorrow = new Date(Date.now() + 86400000 + 32400000).toISOString().slice(0, 10);
                    if (ev.event_date === tomorrow && sentCount === 0) {
                        dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('1일 전', '종일'), 1);
                        return;
                    }
                    // 당일 오전 9시 알림 (2회 발송 설정 시)
                    if (ev.event_date === kstDateStr && maxRepeat >= 2 && sentCount < 2) {
                        dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('오늘', '종일'), 2);
                        return;
                    }
                } else {
                    // 당일 알림 (timing === 'exact' 등)
                    if (ev.event_date === kstDateStr && sentCount === 0) {
                        dispatchCalPush(db, ev, userId, ev.title, buildCalPushBody('오늘', '종일'), 1);
                        return;
                    }
                }
                return;
            }

            // 2. 시간 지정 일정 처리
            if (!ev.event_time || ev.event_time.length < 4) return;
            const eventDateTimeStr = `${ev.event_date} ${ev.event_time}`;

            // 밀리초 기준 시각 계산 (오프셋)
            let offsetMinutes = 0;
            if (timing === '10m') offsetMinutes = 10;
            else if (timing === '30m') offsetMinutes = 30;
            else if (timing === '1h') offsetMinutes = 60;
            else if (timing === '1d') offsetMinutes = 1440;

            try {
                // KST 기준 Date 객체 생성
                const [ey, em, ed] = ev.event_date.split('-').map(Number);
                const [eh, emn] = ev.event_time.split(':').map(Number);
                const eventMs = new Date(ey, em - 1, ed, eh, emn, 0).getTime();

                const [cy, cm, cd] = kstDateStr.split('-').map(Number);
                const [ch, cmn] = kstTimeStr.split(':').map(Number);
                const currentMs = new Date(cy, cm - 1, cd, ch, cmn, 0).getTime();

                const diffMinutes = Math.round((eventMs - currentMs) / 60000);

                // A. 1회차 사전 알림 (timing이 'exact'가 아닐 때 offsetMinutes 시점에 발송)
                if (offsetMinutes > 0 && diffMinutes === offsetMinutes && sentCount === 0) {
                    const label = timing === '10m' ? '10분 전' : (timing === '30m' ? '30분 전' : (timing === '1h' ? '1시간 전' : '1일 전'));
                    dispatchCalPush(
                        db,
                        ev,
                        userId,
                        ev.title,
                        buildCalPushBody(label, ev.event_time),
                        1
                    );
                    return;
                }

                // B. 정시 알림 (사전 알림 후 2회차 발송이거나, 애초에 timing이 'exact'인 경우)
                if (diffMinutes === 0) {
                    if (timing === 'exact' && sentCount === 0) {
                        dispatchCalPush(
                            db,
                            ev,
                            userId,
                            ev.title,
                            buildCalPushBody('시작', ev.event_time),
                            1
                        );
                    } else if (maxRepeat >= 2 && sentCount === 1) {
                        dispatchCalPush(
                            db,
                            ev,
                            userId,
                            ev.title,
                            buildCalPushBody('시작', ev.event_time),
                            2
                        );
                    }
                }
            } catch (calcErr) {
                console.error('[UnifiedScheduler] 캘린더 시간 연산 오류:', calcErr.message);
            }
        });
    });

    function dispatchCalPush(dbInstance, ev, targetUser, title, body, stageNum) {
        const cacheKey = `${targetUser}:cal_push:${ev.id}:${stageNum}:${kstDateStr}_${kstTimeStr}`;
        if (sentHistoryCache.has(cacheKey)) return;
        sentHistoryCache.add(cacheKey);

        sendBroadcastPush({
            title,
            body,
            url: 'https://j-jg.cc/calendar',
            type: 'calendar',
            tag: `jg-cal-${ev.id}`,
            userId: targetUser
        });

        dbInstance.run(
            `UPDATE calendar_events SET notify_sent_count = notify_sent_count + 1, last_notified_at = datetime('now', 'localtime') WHERE id = ?`,
            [ev.id],
            (uErr) => {
                if (uErr) console.error('[UnifiedScheduler] 일정 알림 상태 갱신 실패:', uErr.message);
            }
        );
        console.log(`[UnifiedScheduler] 📅 캘린더 푸시 발송 완료 [${stageNum}회차]: ${ev.title}`);
    }
}

module.exports = { initUnifiedNotificationScheduler, sendServerTelegram };

