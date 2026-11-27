/**
 * ==============================================================================
 * 보조 서버(HP 노트북: 192.168.50.75) 원격 DB 동기화 서비스 (remoteDbSync.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 2] 100% 일상 친화적인 한국어 인터페이스 준수
 * [규칙 3] 파일당 500줄 이하 모듈화 준수 (약 150줄)
 * [규칙 8] 보안 원격 접속 옵션 준수 (BatchMode=yes, ConnectTimeout=3)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { WORKSPACE_ROOT } = require('../config/constants');

const SECONDARY_HOST = process.env.SECONDARY_HOST || '192.168.50.75';
const SECONDARY_PORT = String(process.env.SECONDARY_PORT || '22').replace(/[^0-9]/g, '') || '22';
const SECONDARY_USER = String(process.env.SECONDARY_USER || os.userInfo().username).replace(/[^a-zA-Z0-9._-]/g, '');
const SECONDARY_SSH_ARGS = ['-p', SECONDARY_PORT, '-o', 'ConnectTimeout=3', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
const SECONDARY_SSH_RSH = `ssh -p ${SECONDARY_PORT} -o ConnectTimeout=3 -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;

function execFileAsync(cmd, args, timeout = 8000) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                return reject(err);
            }
            resolve({ stdout, stderr });
        });
    });
}

// 동기화 상태 인메모리 캐시
const syncCache = {
    wiki: {
        lastSyncedAt: 0,
        syncing: false,
        lastError: null,
        remoteHost: SECONDARY_HOST,
        serverName: 'HP 보조 서버 (192.168.50.75)'
    }
};

/**
 * 모듈이 보조 서버 원격 DB인지 판별
 */
function isRemoteDb(moduleConfig) {
    if (!moduleConfig) return false;
    return Boolean(
        moduleConfig.isRemote ||
        moduleConfig.remoteServer === 'secondary' ||
        moduleConfig.id === 'wiki'
    );
}

/**
 * 보조 서버 원격 DB를 로컬로 동기화 (Pull - SQLite 온라인 스냅샷으로 WAL 무결성 보장)
 * @param {string} dbKey - 모듈 키 (예: 'wiki')
 * @param {boolean} force - 강제 동기화 여부
 */
async function pullRemoteDb(dbKey = 'wiki', force = false) {
    const meta = syncCache[dbKey] || {
        lastSyncedAt: 0,
        syncing: false,
        lastError: null,
        remoteHost: SECONDARY_HOST,
        serverName: 'HP 보조 서버 (192.168.50.75)'
    };
    syncCache[dbKey] = meta;

    const now = Date.now();
    // 30초 이내 동기화 완료 건은 캐시 반환 (강제가 아닐 때)
    if (!force && (now - meta.lastSyncedAt < 30000) && !meta.lastError) {
        return { success: true, cached: true, lastSyncedAt: meta.lastSyncedAt };
    }

    if (meta.syncing) {
        return { success: true, message: '동기화가 이미 진행 중입니다.', syncing: true };
    }

    meta.syncing = true;
    const localDir = path.resolve(WORKSPACE_ROOT, 'family-wiki');
    const localPath = path.resolve(localDir, 'wiki.db');
    const localTmpPath = path.resolve(localDir, '.wiki.sync.tmp.db');
    const remotePath = `/home/${SECONDARY_USER}/family-wiki/wiki.db`;
    const remoteSnapPath = `/home/${SECONDARY_USER}/family-wiki/.wiki.sync.tmp.db`;
    const sshTarget = `${SECONDARY_USER}@${SECONDARY_HOST}`;

    try {
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        // 1. 보조 서버에서 WAL 반영 온라인 백업 스냅샷 생성
        await execFileAsync('ssh', [
            ...SECONDARY_SSH_ARGS,
            sshTarget,
            `umask 077 && sqlite3 '${remotePath}' ".backup '${remoteSnapPath}'" && chmod 600 '${remoteSnapPath}'`
        ], 8000);

        // 2. 생성된 스냅샷을 안전하게 rsync 전송 후 원자적 교체
        const { stdout } = await execFileAsync('rsync', [
            '-avz', '--chmod=Fu=rw,Fgo=', '-e', SECONDARY_SSH_RSH,
            `${sshTarget}:${remoteSnapPath}`, localTmpPath
        ], 8000);

        try { fs.chmodSync(localTmpPath, 0o600); } catch (e) {}
        fs.renameSync(localTmpPath, localPath);
        try { fs.chmodSync(localPath, 0o600); } catch (e) {}

        // 원격 임시 스냅샷 정리
        execFileAsync('ssh', [...SECONDARY_SSH_ARGS, sshTarget, `rm -f '${remoteSnapPath}'`], 4000).catch(() => {});

        meta.syncing = false;
        meta.lastSyncedAt = Date.now();
        meta.lastError = null;

        let fileSize = 0;
        try { fileSize = fs.statSync(localPath).size; } catch (e) {}

        return {
            success: true,
            message: '보조 서버 DB가 최신 상태로 동기화되었습니다.',
            lastSyncedAt: meta.lastSyncedAt,
            fileSize,
            stdout: String(stdout || '').trim()
        };
    } catch (err) {
        meta.syncing = false;
        console.warn(`⚠️ [보조 서버 DB 동기화 경고]: ${err.message}`);
        meta.lastError = '동기화 연결 실패';
        try { if (fs.existsSync(localTmpPath)) fs.unlinkSync(localTmpPath); } catch (e) {}
        execFileAsync('ssh', [...SECONDARY_SSH_ARGS, sshTarget, `rm -f '${remoteSnapPath}'`], 4000).catch(() => {});

        const fileExists = fs.existsSync(localPath);
        return {
            success: fileExists,
            cachedFallback: fileExists,
            error: '보조 서버에 연결할 수 없어 기존 로컬 데이터를 유지합니다.',
            lastSyncedAt: meta.lastSyncedAt
        };
    }
}

/**
 * 로컬 변경 사항을 보조 서버 원격 DB로 역동기화 (Push - SQLite 온라인 복원)
 * @param {string} dbKey - 모듈 키 (예: 'wiki')
 */
async function pushRemoteDb(dbKey = 'wiki') {
    const meta = syncCache[dbKey] || {};
    const localPath = path.resolve(WORKSPACE_ROOT, 'family-wiki/wiki.db');
    const remotePath = `/home/${SECONDARY_USER}/family-wiki/wiki.db`;
    const remotePushTmp = `/home/${SECONDARY_USER}/family-wiki/.wiki.push.tmp.db`;
    const sshTarget = `${SECONDARY_USER}@${SECONDARY_HOST}`;

    if (!fs.existsSync(localPath)) {
        return { success: false, message: '로컬 DB 파일이 존재하지 않습니다.' };
    }

    try {
        const { stdout } = await execFileAsync('rsync', [
            '-avz', '--chmod=Fu=rw,Fgo=', '-e', SECONDARY_SSH_RSH,
            localPath, `${sshTarget}:${remotePushTmp}`
        ], 8000);

        await execFileAsync('ssh', [
            ...SECONDARY_SSH_ARGS,
            sshTarget,
            `umask 077 && sqlite3 '${remotePath}' ".restore '${remotePushTmp}'" && chmod 600 '${remotePath}'* && rm -f '${remotePushTmp}'`
        ], 8000);

        if (meta) meta.lastSyncedAt = Date.now();
        return { success: true, message: '보조 서버 DB로 안전하게 반영되었습니다.', stdout: String(stdout || '').trim() };
    } catch (err) {
        console.error(`🚨 [보조 서버 DB 푸시 오류]: ${err.message}`);
        execFileAsync('ssh', [...SECONDARY_SSH_ARGS, sshTarget, `rm -f '${remotePushTmp}'`], 4000).catch(() => {});
        return { success: false, message: '보조 서버 DB 반영에 실패했습니다.' };
    }
}

/**
 * 특정 DB의 동기화 상태 반환
 */
function getSyncStatus(dbKey = 'wiki') {
    return syncCache[dbKey] || {
        lastSyncedAt: 0,
        syncing: false,
        lastError: null,
        remoteHost: SECONDARY_HOST,
        serverName: 'HP 보조 서버 (192.168.50.75)'
    };
}

module.exports = {
    SECONDARY_HOST,
    isRemoteDb,
    pullRemoteDb,
    pushRemoteDb,
    getSyncStatus
};
