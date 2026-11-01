const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cryptoService = require('./crypto.service');

const CONFIG_PATH = path.join(__dirname, '../config/kindergarten.json');
const PYTHON_PATH = path.join(__dirname, '../venv/bin/python3');
const CRAWLER_PATH = path.join(__dirname, '../scripts/kindergarten_crawler.py');

// 싱글톤 상태 객체
const state = {
    isRunning: false,
    process: null,
    pid: null,
    startedAt: null,
    logs: [],
    maxLogs: 200,
    lastResult: null
};

// 설정 로드
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            const defaultConfig = {
                HDD_BASE_PATH: '/mnt/hdd',
                ROOT_URL: 'https://www.bonbu.kr/',
                USER_ID_ENC: '',
                USER_PW_ENC: '',
                TARGET_BOARDS: {
                    '소망반_16번게시판': 'https://www.bonbu.kr/main/sub.html?boardID=www16',
                    '열매반_17번게시판': 'https://www.bonbu.kr/main/sub.html?boardID=www17'
                },
                LAST_RUN: null
            };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf8');
            return defaultConfig;
        }
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('[유치원서비스] 설정 파일 로드 실패:', err);
        return {
            HDD_BASE_PATH: '/mnt/hdd',
            ROOT_URL: 'https://www.bonbu.kr/',
            USER_ID_ENC: '',
            USER_PW_ENC: '',
            TARGET_BOARDS: {},
            LAST_RUN: null
        };
    }
}

// 설정 저장
function updateConfig(newConfig) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('[유치원서비스] 설정 파일 저장 실패:', err);
        return false;
    }
}

// 공개용 설정 (비밀번호 마스킹)
function getPublicConfig() {
    const cfg = loadConfig();
    let maskedId = '';
    let hasPw = false;

    if (cfg.USER_ID_ENC) {
        try {
            const plainId = cryptoService.decryptMemoText(cfg.USER_ID_ENC, 'system');
            if (plainId && plainId.length > 2) {
                maskedId = plainId.slice(0, 2) + '*'.repeat(plainId.length - 2);
            } else if (plainId) {
                maskedId = plainId[0] + '*';
            }
        } catch (e) {
            maskedId = '설정됨';
        }
    }

    if (cfg.USER_PW_ENC) {
        hasPw = true;
    }

    return {
        hddBasePath: cfg.HDD_BASE_PATH || '/mnt/hdd',
        rootUrl: cfg.ROOT_URL || 'https://www.bonbu.kr/',
        userIdMasked: maskedId,
        hasUserId: Boolean(cfg.USER_ID_ENC),
        hasUserPw: hasPw,
        targetBoards: cfg.TARGET_BOARDS || {},
        lastRun: cfg.LAST_RUN || null
    };
}

// 사용자 설정 저장 (아이디/비번 암호화)
function saveCredentialsAndSettings({ userId, userPw, targetBoards, hddBasePath }) {
    const cfg = loadConfig();

    if (userId !== undefined && userId.trim() !== '') {
        cfg.USER_ID_ENC = cryptoService.encryptMemoText(userId.trim(), 'system');
    }
    if (userPw !== undefined && userPw.trim() !== '') {
        cfg.USER_PW_ENC = cryptoService.encryptMemoText(userPw.trim(), 'system');
    }
    if (targetBoards && typeof targetBoards === 'object') {
        cfg.TARGET_BOARDS = targetBoards;
    }
    if (hddBasePath && typeof hddBasePath === 'string' && hddBasePath.trim()) {
        cfg.HDD_BASE_PATH = hddBasePath.trim();
    }

    const ok = updateConfig(cfg);
    return { success: ok, config: getPublicConfig() };
}

// 복호화된 크레덴셜 로드
function getDecryptedCredentials() {
    const cfg = loadConfig();
    let id = '';
    let pw = '';

    if (cfg.USER_ID_ENC) {
        id = cryptoService.decryptMemoText(cfg.USER_ID_ENC, 'system');
    }
    if (cfg.USER_PW_ENC) {
        pw = cryptoService.decryptMemoText(cfg.USER_PW_ENC, 'system');
    }
    return { id, pw, cfg };
}

// 로그 추가
function appendLog(line) {
    const cleanLine = line.trim();
    if (!cleanLine) return;
    const entry = {
        time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
        text: cleanLine
    };
    state.logs.push(entry);
    if (state.logs.length > state.maxLogs) {
        state.logs.shift();
    }
}

// 크롤러 실행
function startCrawler() {
    if (state.isRunning) {
        return { success: false, message: '이미 사진 수집이 실행 중입니다.' };
    }

    const { id, pw, cfg } = getDecryptedCredentials();

    if (!id || !pw) {
        return { success: false, message: '유치원 로그인 아이디와 비밀번호를 먼저 설정해주세요.' };
    }

    if (!fs.existsSync(PYTHON_PATH)) {
        return { success: false, message: `파이썬 실행 환경을 찾을 수 없습니다: ${PYTHON_PATH}` };
    }

    if (!fs.existsSync(CRAWLER_PATH)) {
        return { success: false, message: `크롤러 스크립트를 찾을 수 없습니다: ${CRAWLER_PATH}` };
    }

    state.isRunning = true;
    state.startedAt = new Date().toISOString();
    state.logs = [];
    appendLog('[시스템] 유치원 사진 자동 수집 프로세스를 시작합니다.');

    const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        BONBU_USER_ID: id,
        BONBU_USER_PW: pw,
        BONBU_HDD_BASE_PATH: cfg.HDD_BASE_PATH || '/mnt/hdd',
        BONBU_ROOT_URL: cfg.ROOT_URL || 'https://www.bonbu.kr/',
        BONBU_TARGET_BOARDS: JSON.stringify(cfg.TARGET_BOARDS || {})
    };

    try {
        const child = spawn(PYTHON_PATH, [CRAWLER_PATH], { env });
        state.process = child;
        state.pid = child.pid;

        let jsonBuffer = '';
        let isJsonSection = false;

        child.stdout.on('data', (data) => {
            const text = data.toString('utf8');
            const lines = text.split('\n');

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                if (line === '--- JSON_RESULT_START ---') {
                    isJsonSection = true;
                    jsonBuffer = '';
                    continue;
                }
                if (line === '--- JSON_RESULT_END ---') {
                    isJsonSection = false;
                    try {
                        state.lastResult = JSON.parse(jsonBuffer);
                        // config 에도 마지막 실행 기록 저장
                        cfg.LAST_RUN = state.lastResult;
                        updateConfig(cfg);
                    } catch (e) {
                        console.error('[유치원서비스] JSON 파싱 오류:', e);
                    }
                    continue;
                }

                if (isJsonSection) {
                    jsonBuffer += line;
                } else {
                    appendLog(line);
                }
            }
        });

        child.stderr.on('data', (data) => {
            const text = data.toString('utf8');
            appendLog(`[오류/경고] ${text}`);
        });

        child.on('close', (code) => {
            state.isRunning = false;
            state.process = null;
            state.pid = null;
            const endMsg = code === 0 ? '정상 완결되었습니다.' : `종료 코드(${code})로 마감되었습니다.`;
            appendLog(`[시스템] 수집 프로세스가 ${endMsg}`);
        });

        child.on('error', (err) => {
            state.isRunning = false;
            state.process = null;
            state.pid = null;
            appendLog(`[시스템 오류] 프로세스 실행 실패: ${err.message}`);
        });

        return { success: true, message: '수집 프로세스가 백그라운드에서 시작되었습니다.' };
    } catch (err) {
        state.isRunning = false;
        return { success: false, message: `프로세스 기동 중 예외: ${err.message}` };
    }
}

// 현재 상태 및 최근 로그 반환
function getStatus() {
    const cfg = loadConfig();
    return {
        isRunning: state.isRunning,
        pid: state.pid,
        startedAt: state.startedAt,
        logs: state.logs,
        lastResult: state.lastResult || cfg.LAST_RUN || null
    };
}

// 누적 로그 파일 읽기
function getCumulativeHistoryLog() {
    const cfg = loadConfig();
    const basePath = cfg.HDD_BASE_PATH || '/mnt/hdd';
    const logPath = path.join(basePath, '유치원_사진_다운로드', 'collection_history.log');

    try {
        if (!fs.existsSync(logPath)) {
            return { exists: false, content: '아직 기록된 누적 로그가 없습니다.' };
        }
        const fullContent = fs.readFileSync(logPath, 'utf8');
        const lines = fullContent.split('\n');
        // 최근 60줄 반환
        const recent = lines.slice(-60).join('\n');
        return { exists: true, content: recent };
    } catch (err) {
        return { exists: false, content: `로그 파일 읽기 실패: ${err.message}` };
    }
}

module.exports = {
    loadConfig,
    getPublicConfig,
    saveCredentialsAndSettings,
    startCrawler,
    getStatus,
    getCumulativeHistoryLog
};
