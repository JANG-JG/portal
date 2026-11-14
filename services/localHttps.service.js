/**
 * ==============================================================================
 * 내부 Wi-Fi(LAN) 전용 고속 HTTPS 서버 & 로컬 루트 CA 인증서 관리 서비스
 * ------------------------------------------------------------------------------
 * - Cloudflare 터널 왕복 지연을 우회해 같은 Wi-Fi 망에서 즉시 접속 가능
 * - 비루트(PRoot-Distro) 환경 호환 고포트(기본 3443) + iOS/Android 825일 규격 준수
 * - 외부 커스텀 인증서(LOCAL_HTTPS_CERT_PATH/KEY_PATH) 존재 시 우선 사용
 * ==============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const state = {
    enabled: process.env.LOCAL_HTTPS_ENABLED !== 'false',
    active: false,
    port: parseInt(process.env.LOCAL_HTTPS_PORT, 10) || 3443,
    lanIp: '',
    certPath: '',
    caCertPath: '',
    hasCustomCert: false,
    expiresAt: '',
    lastError: ''
};

let httpsServerInstance = null;

function getLanIPv4() {
    const envHost = String(process.env.LOCAL_HTTPS_HOST || '').trim();
    if (envHost) return envHost;

    const ifaces = os.networkInterfaces();
    const candidates = [];
    for (const [name, addrs] of Object.entries(ifaces || {})) {
        if (!Array.isArray(addrs)) continue;
        for (const info of addrs) {
            if (!info || info.internal || info.family !== 'IPv4') continue;
            candidates.push({ name, address: info.address });
        }
    }
    const preferred = candidates.find((c) => c.address.startsWith('192.168.'))
        || candidates.find((c) => c.address.startsWith('10.'))
        || candidates[0];
    return preferred ? preferred.address : '192.168.50.111';
}

function getCertDir() {
    return process.env.LOCAL_HTTPS_CERT_DIR || path.join(os.homedir(), '.jg-certs');
}

function isCertValidForIp(certPath, lanIp) {
    if (!fs.existsSync(certPath)) return false;
    try {
        // 30일(2592000초) 이내 만료 여부 점검
        execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-checkend', '2592000'], { stdio: 'ignore' });
        const text = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-text'], { encoding: 'utf8' });
        return text.includes(`IP Address:${lanIp}`);
    } catch (_) {
        return false;
    }
}

function readCertExpiry(certPath) {
    try {
        const out = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-enddate'], { encoding: 'utf8' });
        const m = out.match(/notAfter=(.+)/);
        return m ? m[1].trim() : '';
    } catch (_) {
        return '';
    }
}

function ensureLocalCertificates(lanIp) {
    const customCert = String(process.env.LOCAL_HTTPS_CERT_PATH || '').trim();
    const customKey = String(process.env.LOCAL_HTTPS_KEY_PATH || '').trim();
    const certDir = getCertDir();

    if (customCert && customKey && fs.existsSync(customCert) && fs.existsSync(customKey)) {
        return {
            certPath: customCert,
            keyPath: customKey,
            caCertPath: '',
            hasCustomCert: true
        };
    }

    const dirCustomCert = path.join(certDir, 'fullchain.pem');
    const dirCustomKey = path.join(certDir, 'privkey.pem');
    if (fs.existsSync(dirCustomCert) && fs.existsSync(dirCustomKey)) {
        return {
            certPath: dirCustomCert,
            keyPath: dirCustomKey,
            caCertPath: '',
            hasCustomCert: true
        };
    }

    fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });

    const caKeyPath = path.join(certDir, 'ca-key.pem');
    const caCertPath = path.join(certDir, 'ca-cert.pem');
    const caExtPath = path.join(certDir, 'ca-ext.cnf');

    if (!fs.existsSync(caKeyPath) || !fs.existsSync(caCertPath)) {
        fs.writeFileSync(caExtPath, [
            '[v3_ca]',
            'subjectKeyIdentifier=hash',
            'authorityKeyIdentifier=keyid:always,issuer',
            'basicConstraints=critical,CA:TRUE',
            'keyUsage=critical,digitalSignature,cRLSign,keyCertSign'
        ].join('\n'), { mode: 0o600 });

        execFileSync('openssl', ['genrsa', '-out', caKeyPath, '2048'], { stdio: 'ignore' });
        fs.chmodSync(caKeyPath, 0o600);
        execFileSync('openssl', [
            'req', '-x509', '-new', '-nodes',
            '-key', caKeyPath,
            '-sha256', '-days', '3650',
            '-subj', '/CN=JG Family Local Root CA/O=JG Family/C=KR',
            '-extensions', 'v3_ca',
            '-config', caExtPath,
            '-out', caCertPath
        ], { stdio: 'ignore' });
    }

    const lanKeyPath = path.join(certDir, 'lan-key.pem');
    const lanCsrPath = path.join(certDir, 'lan.csr');
    const lanCertPath = path.join(certDir, 'lan-cert.pem');
    const lanExtPath = path.join(certDir, 'lan-ext.cnf');

    if (!fs.existsSync(lanKeyPath) || !isCertValidForIp(lanCertPath, lanIp)) {
        fs.writeFileSync(lanExtPath, [
            '[v3_req]',
            'basicConstraints=CA:FALSE',
            'keyUsage=critical,digitalSignature,keyEncipherment',
            'extendedKeyUsage=serverAuth',
            'subjectAltName=@alt_names',
            '',
            '[alt_names]',
            `IP.1=${lanIp}`,
            'IP.2=127.0.0.1',
            'DNS.1=localhost',
            'DNS.2=jg-server.local',
            'DNS.3=lan.j-jg.cc'
        ].join('\n'), { mode: 0o600 });

        execFileSync('openssl', ['genrsa', '-out', lanKeyPath, '2048'], { stdio: 'ignore' });
        fs.chmodSync(lanKeyPath, 0o600);
        execFileSync('openssl', [
            'req', '-new',
            '-key', lanKeyPath,
            '-subj', `/CN=${lanIp}/O=JG Family LAN/C=KR`,
            '-out', lanCsrPath
        ], { stdio: 'ignore' });
        execFileSync('openssl', [
            'x509', '-req',
            '-in', lanCsrPath,
            '-CA', caCertPath,
            '-CAkey', caKeyPath,
            '-CAcreateserial',
            '-out', lanCertPath,
            '-days', '825',
            '-sha256',
            '-extfile', lanExtPath,
            '-extensions', 'v3_req'
        ], { stdio: 'ignore' });
    }

    return {
        certPath: lanCertPath,
        keyPath: lanKeyPath,
        caCertPath,
        hasCustomCert: false
    };
}

function startLocalHttpsServer(app) {
    state.lanIp = getLanIPv4();
    if (!state.enabled) {
        console.log('ℹ️ [LAN HTTPS] LOCAL_HTTPS_ENABLED=false 로 비활성화되어 있습니다.');
        return null;
    }

    try {
        const certs = ensureLocalCertificates(state.lanIp);
        const tlsOptions = {
            key: fs.readFileSync(certs.keyPath),
            cert: fs.readFileSync(certs.certPath)
        };
        state.certPath = certs.certPath;
        state.caCertPath = certs.caCertPath;
        state.hasCustomCert = certs.hasCustomCert;
        state.expiresAt = readCertExpiry(certs.certPath);

        httpsServerInstance = https.createServer(tlsOptions, app);
        httpsServerInstance.on('error', (err) => {
            state.active = false;
            state.lastError = err.message;
            console.error(`⚠️ [LAN HTTPS] 리스너 오류 (Port ${state.port}):`, err.message);
        });
        httpsServerInstance.listen(state.port, '0.0.0.0', () => {
            state.active = true;
            state.lastError = '';
            console.log(`🔒 내부 Wi-Fi 고속 HTTPS 서버 구동 완료 (https://${state.lanIp}:${state.port}/study)`);
        });
        return httpsServerInstance;
    } catch (err) {
        state.active = false;
        state.lastError = err.message;
        console.error('⚠️ [LAN HTTPS] 초기화 실패 (기본 HTTP 서버는 정상 유지됨):', err.message);
        return null;
    }
}

function getCaCertPath() {
    if (state.caCertPath && fs.existsSync(state.caCertPath)) return state.caCertPath;
    const fallbackPath = path.join(getCertDir(), 'ca-cert.pem');
    return fs.existsSync(fallbackPath) ? fallbackPath : '';
}

function getLocalHttpsStatus() {
    const lanIp = state.lanIp || getLanIPv4();
    const origin = `https://${lanIp}:${state.port}`;
    return {
        enabled: state.enabled,
        active: state.active,
        port: state.port,
        lanIp,
        origin,
        studyUrl: `${origin}/study`,
        portalUrl: `${origin}/`,
        caCertAvailable: Boolean(getCaCertPath()),
        caDownloadPath: '/api/lan-ca.crt',
        hasCustomCert: state.hasCustomCert,
        expiresAt: state.expiresAt,
        lastError: state.lastError
    };
}

module.exports = {
    getLanIPv4,
    startLocalHttpsServer,
    getCaCertPath,
    getLocalHttpsStatus
};
