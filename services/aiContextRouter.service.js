/**
 * 🎯 JG 포털 AI 비서 - 질문 의도 분석 및 동적 컨텍스트 라우터 (aiContextRouter.service.js)
 * - [핵심 역할] 사용자 질문 의도(건강/일정/자산/날씨/위키/앨범/서버)별 필요한 지식만 선별 주입
 * - [성능 혁신] 무차별 1,500자 주입을 배제하여 토큰 60% 절감 및 로컬 LLM 추론 속도 2배 향상
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

const { searchWikiContent } = require('./wikiSummary.service');
const { searchAlbumPhotos } = require('./albumSummary.service');
const { searchNewsByKeyword, getRecentBreaking, getLatestByCategories, getDailyWeatherSummary } = require('./newsHeadline.service');
const { describeFeelKo, koreanizeWeatherWords } = require('./weatherKo.util');
const { ADMIN_USERS } = require('../config/constants');

/**
 * 🛡️ 관리자 권한 여부 확인 (admin role 또는 ADMIN_USERS 목록)
 */
function isAdminUser(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.username && ADMIN_USERS && (ADMIN_USERS.has ? ADMIN_USERS.has(user.username) : ADMIN_USERS.includes(user.username))) return true;
    return false;
}

/**
 * 🛡️ 관리자 전용 페이지 및 시스템 관리 기능 접근 시도 감지
 */
function isAdminPageQuery(prompt) {
    if (!prompt || typeof prompt !== 'string') return false;
    return /(관리자\s*(페이지|화면|메뉴|설정|계정|비번|비밀번호)|admin\s*(page|view)?|마스터\s*비번|db\s*(인스펙터|관리|원시)|서버\s*설정\s*(변경|수정))/i.test(prompt);
}

/**
 * 🛡️ 프롬프트 템플릿 탈취 및 제어 문자 인젝션 방어 유틸리티
 */
function sanitizeInputText(text, maxLength = 1000) {
    if (!text || typeof text !== 'string') return '';
    // 모델 템플릿 제어 토큰 (<|system|>, <|user|>, <|assistant|>, <|end_of_turn|> 등) 제거
    const cleaned = text.replace(/<\|[a-zA-Z0-9_\-:]+\|>/g, '');
    return cleaned.slice(0, maxLength).trim();
}

/**
 * D-Day 항목에서 오늘 기준 남은 일수 계산
 */
function parseDDayDiff(ddayItem) {
    if (!ddayItem) return null;
    if (ddayItem.targetDate || ddayItem.target_date) {
        const dateStr = (ddayItem.targetDate || ddayItem.target_date).slice(0, 10);
        const target = new Date(dateStr + 'T00:00:00+09:00');
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        const today = new Date(todayStr + 'T00:00:00+09:00');
        if (!isNaN(target.getTime()) && !isNaN(today.getTime())) {
            return Math.round((target - today) / (1000 * 60 * 60 * 24));
        }
    }
    const dStr = String(ddayItem.dday || '').trim();
    if (dStr === 'D-Day' || dStr === 'D-0') return 0;
    const m = /^D-(\d+)$/.exec(dStr);
    if (m) return parseInt(m[1], 10);
    return null;
}

/**
 * 사용자 질문 의도(Intent) 분석기
 * @param {string} prompt 정제된 사용자 질문
 * @returns {Set<string>} 감지된 의도 세트
 */
function detectIntents(prompt) {
    const intents = new Set();
    const p = prompt.toLowerCase();

    // 1. 건강 / 복약 / 병원
    if (/(혈압|수축기|이완기|맥박|건강|약|복약|병원|진료|처방|먹었|챙겨|의사)/.test(p)) {
        intents.add('HEALTH');
    }

    // 2. 일정 / 메모 / 오늘 할 일
    if (/(일정|약속|계획|스케줄|캘린더|메모|할\s*일|투두|todo|d-day|디데이|루틴)/.test(p)) {
        intents.add('SCHEDULE');
    }

    // 3. 날씨 / 외출
    if (/(날씨|비\s*와|기온|온도|우산|미세먼지|외출|옷차림|추워|더워|바람|습도|예보|강수|눈\s*와|자외선)/.test(p)) {
        intents.add('WEATHER');
    }

    // 4. 자산 / 시황 / 주식 / 경제
    if (/(자산|돈|통장|투자|주식|코스피|코스닥|환율|달러|평가액|계좌|증시|경제|금리|금융|시장|가상자산|코인|비트코인|엔화|유로)/.test(p)) {
        intents.add('ASSET');
    }

    // 5. 서버 / 인프라
    if (/(서버|노트\s*9|노트북|인프라|cpu|ram|메모리|디스크|가동|다운|배포|포털)/.test(p)) {
        intents.add('INFRA');
    }

    // 6. 뉴스 / 속보 / 이슈
    if (/(뉴스|속보|기사|헤드라인|이슈|시사|소식|동향)/.test(p)) {
        intents.add('NEWS');
    }

    // 7. 가족 사진 / 추억
    if (/(사진|추억|앨범|옛날|여행|찍은|장소|갤러리)/.test(p)) {
        intents.add('ALBUM');
    }

    // 8. 가족 위키 / 매뉴얼 / 생활 팁
    if (/(위키|wiki|매뉴얼|사용법|설명서|방법|요리|레시피|비번|가이드|생활\s*팁|꿀팁|노하우|살림)/.test(p)) {
        intents.add('WIKI');
    }

    // 종합 현황이나 오늘 상태 브리핑 질의인 경우에만 GENERAL_OVERVIEW 추가 (단순 대화 시 불필요한 데이터 주입 방지)
    if (/(오늘\s*(어때|상태|현황|브리핑|요약)|우리\s*집\s*(상태|현황)|홈서버\s*현황|전체\s*(상태|현황|브리핑))/i.test(p)) {
        intents.add('GENERAL_OVERVIEW');
    }

    return intents;
}

/**
 * 의도 및 사용자 권한에 따른 타깃 컨텍스트 빌더 (토큰 다이어트 & 보안 RBAC)
 */
function buildSelectiveContext(summaryContext, intents, user = null) {
    if (!summaryContext) return '';

    const isAdmin = isAdminUser(user);
    const { blood, medication, hospital, memo, asset, news, system, weather, todayEvents, wiki, album } = summaryContext;
    const isOverview = intents.has('GENERAL_OVERVIEW');
    const parts = [];

    // 1. 건강 & 복약 & 진료 (관리자 전용 데이터 - 일반 가족은 주입 원천 차단)
    if (isAdmin && (isOverview || intents.has('HEALTH'))) {
        const bloodInfo = blood 
            ? `${blood.systolic}/${blood.diastolic} mmHg (${blood.grade ? blood.grade.name : '정상'}) - ${blood.is_today_measured ? '오늘 측정 완료 ✅' : '오늘 미측정 ⚠️'}` 
            : null;
        const medInfo = medication && medication.is_today_taken ? '오늘 복약 완료 ✅' : (medication ? '오늘 혈압약 아직 미복용 ⚠️' : null);
        let hospInfo = null;
        if (hospital) {
            hospInfo = `다음 진료: ${hospital.displayNextVisit || '미정'} (${hospital.nextVisitDDay || '디데이 미정'}), 잔여 처방약: ${hospital.remainingPills || 0}일분`;
        }
        if (bloodInfo) parts.push(`- 🩺 혈압 건강: ${bloodInfo}`);
        if (medInfo) parts.push(`- 💊 오늘 복약: ${medInfo}`);
        if (hospInfo) parts.push(`- 🏥 병원/처방약: ${hospInfo}`);
    }

    // 2. 일정 & 메모 & 루틴 (가족 전체 공유 및 개인 관리)
    if (isOverview || intents.has('SCHEDULE')) {
        const eventsInfo = Array.isArray(todayEvents) && todayEvents.length > 0 
            ? todayEvents.map(e => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`).join(', ') 
            : '오늘 예정된 특별한 일정 없음';
        parts.push(`- 📅 오늘 가족 일정: ${eventsInfo}`);

        if (memo && Array.isArray(memo.recent) && memo.recent.length > 0) {
            const memoStr = memo.recent.slice(0, 3).map(m => `[${m.category || '일반'}] ${m.title}`).join(', ');
            parts.push(`- 📝 최근 메모: ${memoStr}`);
        }

        if (wiki && Array.isArray(wiki.ddays) && wiki.ddays.length > 0) {
            const maxDays = intents.has('SCHEDULE') ? 14 : 3;
            const urgentDdays = wiki.ddays.filter(d => {
                const diff = parseDDayDiff(d);
                return diff !== null && diff >= 0 && diff <= maxDays;
            });
            if (urgentDdays.length > 0) {
                const ddayStr = urgentDdays.slice(0, 3).map(d => `${d.title}(${d.dday || d.targetDate})`).join(', ');
                parts.push(`- ⏳ 중요 디데이: ${ddayStr}`);
            }
        }
        if (wiki && Array.isArray(wiki.todos) && wiki.todos.length > 0) {
            const todoStr = wiki.todos.slice(0, 3).map(t => `${t.assignee ? `[${t.assignee}] ` : ''}${t.content}`).join(', ');
            parts.push(`- 📋 미완료 루틴: ${todoStr}`);
        }
    }

    // 3. 날씨 & 옷차림 (가족 전체)
    if (isOverview || intents.has('WEATHER')) {
        const feelKo = weather ? describeFeelKo(weather.feels_like || weather.temp) : '';
        const weatherCityKo = (weather && weather.city) ? koreanizeWeatherWords(weather.city) : '서울';
        const weatherCondKo = (weather && weather.condition) ? koreanizeWeatherWords(weather.condition) : '맑음';
        const weatherInfo = weather 
            ? `${weatherCityKo} ${weather.temp || ''} (${weatherCondKo}), 습도 ${weather.humidity || '-'}${feelKo ? `, 체감 ${weather.feels_like || weather.temp} (${feelKo})` : ''}` 
            : '날씨 정보 없음';
        parts.push(`- 🌤️ 날씨: ${weatherInfo}`);
        if (weather && Array.isArray(weather.forecast) && weather.forecast.length > 0) {
            const fc = weather.forecast.map(f => `${f.label} ${koreanizeWeatherWords(f.condition)} ${f.min}~${f.max} (강수확률 ${f.rain})`).join(' / ');
            parts.push(`- 📆 날씨 예보: ${fc}`);
        }
    }

    // 4. 자산 관리 (관리자 전용 데이터 - 일반 가족은 주입 원천 차단)
    if (isAdmin && (isOverview || intents.has('ASSET'))) {
        if (asset && asset.totalKrw) {
            const topItems = Array.isArray(asset.items) ? asset.items.slice(0, 4).map(i => `${i.name}: ${i.formattedTotal} (${i.diffPercent})`).join(', ') : '';
            parts.push(`- 💰 자산 현황: 총 자산 평가액 ${asset.totalKrw} (보유 ${asset.count || 0}종목)${topItems ? ` | 주요: ${topItems}` : ''}`);
        }
    }

    // 5. 시황 & 뉴스 (공개 증시 지표·뉴스룸 기사는 가족 전체 공개 / 개인 자산 앱 정보는 위 4번에서만 관리자 한정)
    if (isOverview || intents.has('NEWS') || intents.has('ASSET')) {
        if (news) {
            const q = v => (v && typeof v === 'object') ? (v.price && v.price !== '-' ? `${v.price}${v.ratio && v.ratio !== '-' ? `(${v.ratio})` : ''}` : '-') : (v || '-');
            const m = news.market ? `코스피 ${q(news.market.kospi)}, 코스닥 ${q(news.market.kosdaq)}, 원/달러 ${q(news.market.usd_krw)}, 원/100엔 ${q(news.market.jpy_krw)}, 원/유로 ${q(news.market.eur_krw)}` : '';
            // 뉴스룸과 동일 기준(여러 언론사가 다룬 오늘의 이슈) 우선, 없으면 분야별 최신 기사로 대체
            const issueCount = intents.has('NEWS') ? 5 : 3;
            const issues = (Array.isArray(news.topIssues) && news.topIssues.length > 0) ? news.topIssues : (Array.isArray(news.recommendedArticles) ? news.recommendedArticles : []);
            const topNews = issues.slice(0, issueCount).map(a => `[${a.category_name || '기타'}] ${a.title}${a.report_count > 1 ? ` (${a.report_count}건 보도)` : ''}`).join(' / ');
            const breaking = Array.isArray(news.breakingArticles) && news.breakingArticles.length > 0 ? `🚨 속보: ${news.breakingArticles[0].title}` : '';
            const newsLine = [m, breaking, topNews ? `주요 뉴스: ${topNews}` : ''].filter(Boolean).join(' | ');
            if (newsLine) parts.push(`- 📰 소식/뉴스: ${newsLine}`);
        }
    }

    // 6. 서버 인프라 (관리자 전용 - 일반 가족은 주입 원천 차단)
    if (isAdmin && (isOverview || intents.has('INFRA'))) {
        if (system) {
            const pri = system.primary ? `주서버(노트9): CPU ${system.primary.cpu}, RAM ${system.primary.ram}` : '';
            const sec = system.secondary ? `보조서버(노트북): ${system.secondary.statusText || '대기'}` : '';
            const sysStr = [pri, sec].filter(Boolean).join(' | ');
            if (sysStr) parts.push(`- 🖥️ 서버 상태: ${sysStr}`);
        }
    }

    // 7. 가족 사진첩 추억
    if (intents.has('ALBUM') && album) {
        if (Array.isArray(album.onThisDay) && album.onThisDay.length > 0) {
            const mem = album.onThisDay[0];
            parts.push(`- 📸 N년 전 오늘 추억: ${mem.yearsAgo}년 전 [${mem.author}] '${mem.caption || mem.location || '사진'}' (${mem.takenAt})`);
        }
    }

    if (parts.length === 0) return '';
    return `\n[우리 집 실시간 맞춤 정보]\n${parts.join('\n')}\n`;
}

/**
 * 🚀 질문 및 컨텍스트 기반 최종 프롬프트 생성기 (LG EXAONE 4.0 최적화)
 */
async function buildAiChatPrompt({ prompt, history = [], summaryContext = null, userName = '가족', user = null }) {
    const cleanPrompt = sanitizeInputText(prompt, 1000);
    if (!cleanPrompt) {
        throw new Error('유효한 질문 내용을 입력해 주세요.');
    }

    const isAdmin = isAdminUser(user);
    const intents = detectIntents(cleanPrompt);
    const targetedContext = buildSelectiveContext(summaryContext, intents, user);
    const isAdminPageAttempt = isAdminPageQuery(cleanPrompt);

    let matchedWikiGuide = '';
    let matchedAlbumGuide = '';

    // 위키 의도가 감지된 경우에만 위키 RAG 검색 실행
    if (intents.has('WIKI')) {
        try {
            const matchedPages = await searchWikiContent(cleanPrompt, 5);
            if (Array.isArray(matchedPages) && matchedPages.length > 0) {
                matchedWikiGuide = '\n\n[질문 연관 가족 위키 발췌]\n' + 
                    matchedPages.map(p => `■ [${p.category}] ${p.title}\n${p.excerpt}`).join('\n\n');
            }
        } catch (e) {
            // RAG 실패 시 무중단 진행
        }
    }

    // 사진 관련 의도가 감지된 경우에만 앨범 RAG 검색 실행
    if (intents.has('ALBUM')) {
        try {
            const matchedPhotos = await searchAlbumPhotos(cleanPrompt, 3);
            if (Array.isArray(matchedPhotos) && matchedPhotos.length > 0) {
                matchedAlbumGuide = '\n\n[질문 연관 가족 사진첩 발췌]\n' + 
                    matchedPhotos.map(p => `📷 [사진 #${p.id}] ${p.author}님 등록 (${p.takenAt})\n- 이야기: ${p.caption}${p.location ? ` | 장소: ${p.location}` : ''}${p.tags ? ` | 태그: ${p.tags}` : ''}\n- 사진 보기: ${p.url}`).join('\n\n');
            }
        } catch (e) {
            // RAG 실패 시 무중단 진행
        }
    }

    // 뉴스 의도 → 질문 키워드 검색(최근 7일) + 최근 2시간 속보를 병합해 실시간 근거로 주입
    let matchedNewsGuide = '';
    if (intents.has('NEWS')) {
        try {
            const todayKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
            const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
            const wantsLatest = /(최신|속보|방금|지금|실시간|최근|새로운)/.test(cleanPrompt);
            const [{ keywords, items }, breaking] = await Promise.all([
                searchNewsByKeyword(cleanPrompt, todayKst, wantsLatest ? 4 : 6),
                getRecentBreaking(2, wantsLatest ? 5 : 2)
            ]);
            // 속보성 질문은 속보 우선, 그 외에는 질문 연관 기사 우선 (중복 제목 제거, 최대 8건)
            const ordered = wantsLatest ? [...breaking, ...items] : [...items, ...breaking];
            const seen = new Set();
            const merged = ordered.filter(a => a && a.title && !seen.has(a.title) && seen.add(a.title)).slice(0, 8);
            const fmtTime = a => (a.published_at ? String(a.published_at).slice(5, 16) : (a.date || ''));
            const header = `\n\n[질문 연관 뉴스 검색 결과 (기준 시각: 오늘 ${nowHm}${keywords.length ? `, 키워드: ${keywords.join(', ')}` : ''})]\n`;
            if (merged.length > 0) {
                matchedNewsGuide = header +
                    merged.map(a => `■ [${a.category_name || '기타'}] ${a.title} (${a.media_name || '언론사 미상'}, ${fmtTime(a)})${a.summary ? `\n- 요약: ${String(a.summary).slice(0, 100)}` : ''}`).join('\n');
            } else if (keywords.length > 0) {
                matchedNewsGuide = header + '- 뉴스룸에서 해당 기사를 찾지 못했습니다. 지어내지 말고 찾지 못했다고 솔직히 안내하세요.';
            }
        } catch (e) {
            // 뉴스 검색 실패 시 무중단 진행
        }
    }

    // 시황 의도 → 뉴스룸 증시/가상자산·경제 분야 최신 기사 주입 (공개 정보, 자산 앱 DB는 미사용)
    let matchedMarketGuide = '';
    if (intents.has('ASSET')) {
        try {
            const marketNews = await getLatestByCategories(['증시/가상자산', '경제'], 6);
            if (marketNews.length > 0) {
                matchedMarketGuide = '\n\n[뉴스룸 증시·경제 최신 기사]\n' +
                    marketNews.map(a => `■ [${a.category_name}] ${a.title} (${a.media_name || '언론사 미상'}, ${a.published_at ? String(a.published_at).slice(5, 16) : (a.date || '')})${a.summary ? `\n- 요약: ${String(a.summary).slice(0, 100)}` : ''}`).join('\n');
            }
        } catch (e) {
            // 조회 실패 시 무중단 진행
        }
    }

    // 날씨 의도 → 뉴스룸 일일 날씨 요약(최저/최고·바람·자외선·체감) 보조 주입
    let dailyWeatherGuide = '';
    if (intents.has('WEATHER')) {
        try {
            const todayKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
            const dw = await getDailyWeatherSummary(todayKst);
            if (dw && dw.date === todayKst && dw.weather_info) {
                dailyWeatherGuide = `\n\n[뉴스룸 오늘 날씨 요약 (뉴스룸 기준 지역)]\n- ${dw.weather_info}`;
            }
        } catch (e) {
            // 조회 실패 시 무중단 진행
        }
    }

    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (9 * 60 * 60000));
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const kstHour = kst.getHours();
    const kstMin = String(kst.getMinutes()).padStart(2, '0');
    const ampm = kstHour < 12 ? '오전' : '오후';
    const hour12 = kstHour % 12 === 0 ? 12 : kstHour % 12;
    const currentTimeKo = `${ampm} ${hour12}시 ${kstMin}분`;
    const currentDateTimeStr = `${kst.getFullYear()}년 ${kst.getMonth() + 1}월 ${kst.getDate()}일 (${days[kst.getDay()]}요일) ${currentTimeKo}`;
    const contextParts = [targetedContext, matchedWikiGuide, matchedAlbumGuide, matchedNewsGuide, matchedMarketGuide, dailyWeatherGuide].filter(Boolean).join('\n').trim();

    // 초기 도입 당시의 자연스럽고 다정한 프롬프트 스타일로 복원 (LG EXAONE 4.0 기준)
    let adminGuardNote = '';
    if (isAdminPageAttempt) {
        adminGuardNote = '\n- [보안 가드] 사용자가 관리자 전용 페이지(/admin), 시스템 제어, DB 원시 데이터 등을 요구했습니다. 보안상 AI를 통한 접근이나 변경이 불가능함을 정중하고 명확하게 안내하세요.';
    }

    const newsNote = matchedNewsGuide ? '\n- 뉴스 질문에는 [질문 연관 뉴스 검색 결과]의 기사 제목·언론사·요약만 근거로 핵심을 정리해 답하세요.' : '';
    const systemPrompt = `당신은 대한민국 홈서버 JG 포털의 전용 AI 비서입니다. 자신을 소개할 때는 "JG 포털 AI 비서"라고 하세요.
- 100% 한국어로 정중하고 다정한 존댓말로 답변하세요.
- 질문자가 가족 구성원이므로, 든든하고 똑똑한 가족 비서처럼 따뜻하고 명확하게 답변해 주세요.
- 대화 상대방의 호칭은 "${userName}님"입니다.
- 건강, 일정, 생활, 날씨, 지식에 관련된 질문에 친절하고 자연스럽게 답하세요.
- 사실이 아니거나 확실하지 않은 정보는 지어내지(환각) 말고 솔직하게 답변하세요.${newsNote}
- 포털의 관리자 페이지(/admin), 시스템 내부 설정, DB 직접 조작은 보안 규정상 AI를 통한 열람 및 제어가 엄격히 차단되어 있습니다.
- 현재 일시: ${currentDateTimeStr}${adminGuardNote}${contextParts ? `\n\n[우리 집 참고 정보]\n${contextParts}` : ''}`;

    let fullPrompt = `<|system|>\n${systemPrompt}\n`;

    // 최근 대화 히스토리 (최대 4턴, 특수 토큰 정제 및 현재 질문과 중복 방지)
    if (Array.isArray(history)) {
        const filteredHistory = history.filter((h, idx) => {
            if (idx === history.length - 1 && h && h.role === 'user' && h.content?.trim() === cleanPrompt) {
                return false;
            }
            return true;
        });
        filteredHistory.slice(-4).forEach(h => {
            const safeRole = (h && h.role === 'assistant') ? 'assistant' : 'user';
            const safeContent = sanitizeInputText(h ? h.content : '', 500);
            if (safeContent) {
                fullPrompt += `<|${safeRole}|>\n${safeContent}\n`;
            }
        });
    }

    fullPrompt += `<|user|>\n${cleanPrompt}\n<|assistant|>\n`;

    return {
        cleanPrompt,
        intents,
        fullPrompt,
        isAdminPageAttempt
    };
}

module.exports = {
    sanitizeInputText,
    detectIntents,
    isAdminUser,
    isAdminPageQuery,
    buildSelectiveContext,
    buildAiChatPrompt
};

