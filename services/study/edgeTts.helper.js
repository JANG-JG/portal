/**
 * ==============================================================================
 * Microsoft Edge ReadAloud 신경망 음성 합성(Neural TTS) 헬퍼 (edgeTts.helper.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 · 외부 바이너리 없이 순수 Node.js WebSocket으로 동작
 * - 한국어 기본: ko-KR-SunHiNeural (따뜻하고 친근한 유아 선생님 톤)
 * - 영어 기본:   en-US-AnaNeural   (귀엽고 또렷한 유아 친화 영어 음성)
 * ==============================================================================
 */

const crypto = require('crypto');
const { WebSocket } = require('undici');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_VERSION}`;
const WIN_EPOCH_SEC = 11644473600;
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CHROME_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const UA_HEADER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

const TTS_VOICE_PRESETS = {
    ko: {
        sunhi: { id: 'sunhi', voice: 'ko-KR-SunHiNeural', label: '선희 (따뜻한 선생님 톤 · 추천)', rate: '-5%', pitch: '+2Hz' },
        injoon: { id: 'injoon', voice: 'ko-KR-InJoonNeural', label: '인준 (다정한 삼촌 톤)', rate: '-4%', pitch: '+0Hz' },
        hyunsu: { id: 'hyunsu', voice: 'ko-KR-HyunsuMultilingualNeural', label: '현수 (차분한 다국어 톤)', rate: '-4%', pitch: '+0Hz' }
    },
    en: {
        ana: { id: 'ana', voice: 'en-US-AnaNeural', label: 'Ana (귀엽고 또렷한 어린이 톤 · 추천)', rate: '-6%', pitch: '+0Hz' },
        emma: { id: 'emma', voice: 'en-US-EmmaMultilingualNeural', label: 'Emma (밝고 명확한 원어민)', rate: '-5%', pitch: '+0Hz' },
        ava: { id: 'ava', voice: 'en-US-AvaMultilingualNeural', label: 'Ava (다정하고 부드러운 톤)', rate: '-5%', pitch: '+0Hz' }
    }
};

const SHA256_INIT = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
const SHA256_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
const SHA256_SCHED = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
const SHA256_K = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
];
const SHA256_ADJ = 0xC9DC06A7;
const SHA256_BK = [...SHA256_K.slice(0, 14), SHA256_ADJ, ...SHA256_K.slice(15)];
const CS64_COEFF = [
    [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
    [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
    [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
    [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167]
];

const rotr = (v, n) => ((v >>> n) | (v << (32 - n))) >>> 0;
const rol16 = (v) => ((v << 16) | (v >>> 16)) >>> 0;
const s0 = (v) => (rotr(v, 7) ^ rotr(v, 18) ^ (v >>> 3)) >>> 0;
const s1 = (v) => (rotr(v, 17) ^ rotr(v, 19) ^ (v >>> 10)) >>> 0;

function expandSched(w, start = 16) {
    for (let i = start; i < 64; i++) {
        w[i] = (s1(w[i - 2]) + w[i - 7] + s0(w[i - 15]) + w[i - 16]) >>> 0;
    }
}

function shaRounds(state, w, first = 0) {
    let [a, b, c, d, e, f, g, h] = state;
    const k = first === 14 ? SHA256_BK : SHA256_K;
    for (let i = first; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + (g ^ (e & (f ^ g))) + k[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    return [a, b, c, d, e, f, g, h];
}

function sha256Init(d7) {
    const w = new Array(64).fill(0);
    w[14] = (d7[0] << 16) | (d7[1] << 8) | d7[2];
    w[15] = ((d7[3] << 24) | (d7[4] << 16) | (d7[5] << 8) | d7[6]) >>> 0;
    for (let i = 16; i < 30; i++) {
        let val = SHA256_SCHED[i - 16];
        val = (val + (i === 16 ? (s1(w[i - 2]) ^ 0x000B92C0) : s1(w[i - 2]))) >>> 0;
        val = (val + w[i - 7]) >>> 0;
        if (i - 15 >= 14) {
            val = (val + (i === 29 ? (s0(w[i - 15]) ^ 0x059C0B80) : s0(w[i - 15]))) >>> 0;
        }
        w[i] = val;
    }
    w[30] = (s1(w[28]) + w[23] + s0(w[15]) + w[14] + SHA256_ADJ - SHA256_K[14]) >>> 0;
    expandSched(w, 31);
    const wrk = shaRounds(SHA256_STATE, w, 14);
    return SHA256_INIT.map((x, idx) => (x + wrk[idx]) >>> 0);
}

function customSha256(buf) {
    const len = 57 + buf.length;
    const zeroCount = ((55 - len) % 64 + 64) % 64;
    const pad = Buffer.alloc(buf.length - 7 + 1 + zeroCount + 8);
    buf.copy(pad, 0, 7);
    pad[buf.length - 7] = 0x80;
    pad.writeBigUInt64BE(BigInt(len) * 8n, pad.length - 8);
    let st = sha256Init(buf.subarray(0, 7));
    for (let off = 0; off < pad.length; off += 64) {
        const w = new Array(64);
        for (let i = 0; i < 16; i++) w[i] = pad.readUInt32BE(off + i * 4);
        expandSched(w, 16);
        const wrk = shaRounds(st, w, 0);
        st = st.map((x, idx) => (x + wrk[idx]) >>> 0);
    }
    const out = Buffer.alloc(32);
    st.forEach((v, idx) => out.writeUInt32BE(v, idx * 4));
    return out;
}

function cs64Digest(buf, digest) {
    const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
    const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
    const f0 = Math.imul(keyA, 0x82893933) >>> 0;
    const f1 = Math.imul(keyB, 0x82893933) >>> 0;
    const factors = [f0, f1];
    const terms = CS64_COEFF.map(([c], i) => Math.imul(c, factors[i % 2]) >>> 0);
    const offsets = CS64_COEFF.map(([, o]) => o >>> 0);
    const prefixed = Buffer.concat([Buffer.from([0]), buf]);
    const padLen = ((-prefixed.length % 4) + 4) % 4;
    const padded = Buffer.concat([prefixed, Buffer.alloc(padLen)]);
    const words = [];
    for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i));
    if (words.length % 2 === 1) words.push(0);
    words.forEach((word, i) => {
        let term = Math.imul(word, i % 2 === 0 ? keyA : keyB) >>> 0;
        let off = Math.imul(rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB) >>> 0;
        if (i === 0) {
            term = (term + Math.imul(0xF2F90B1A, f0)) >>> 0;
            off = (off + 0x0B1A0000) >>> 0;
        }
        terms.push(term);
        offsets.push(off);
    });

    let swapAcc = 0;
    let swapLast = 0;
    let state = 0;
    let acc = 0;
    for (let i = 0; i < terms.length; i += 2) {
        const x = terms[i];
        const y = terms[i + 1];
        let t = rol16((offsets[i] + x) >>> 0);
        let q = Math.imul(t, 0x76F50F34) >>> 0;
        swapAcc = (swapAcc + Math.imul(rol16(q), 0xC3EFEA97) + q) >>> 0;
        t = rol16((offsets[i + 1] + y) >>> 0);
        q = Math.imul(t, 0x1881CE3C) >>> 0;
        swapLast = (Math.imul(rol16(q), 0x35BD1EC9) + q) >>> 0;
        swapAcc = (swapAcc + swapLast) >>> 0;

        state = (Math.imul(state, keyA) + x) >>> 0;
        state = Math.imul(rol16(state), 0xCF98B111) >>> 0;
        state = Math.imul(rol16(state), 0x87085B9F) >>> 0;
        state = Math.imul(rol16(state), 0x12CEB96D) >>> 0;
        state = Math.imul(rol16(state), 0x257E1D83) >>> 0;
        acc = (acc + state) >>> 0;
        t = (Math.imul(state, keyB) + y) >>> 0;
        t = Math.imul(rol16(t), 0xA27416F5) >>> 0;
        t = Math.imul(rol16(t), 0xD38396FF) >>> 0;
        state = Math.imul(rol16(Math.imul(rol16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0;
        acc = (acc + state) >>> 0;
    }

    const out = Buffer.alloc(8);
    out.writeUInt32LE((swapLast ^ state) >>> 0, 0);
    out.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
    return out;
}

function generateSecMsGecV2() {
    let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH_SEC;
    ticks -= ticks % 300;
    const raw = String(BigInt(ticks) * 10000000n) + TRUSTED_CLIENT_TOKEN;
    const buf = Buffer.from(raw, 'ascii');
    const digest = customSha256(buf);
    const cs64 = cs64Digest(buf, digest);
    return `${cs64.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}

function escapeXml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function resolveVoicePreset(lang = 'ko-KR', presetId = '') {
    const isEn = String(lang || '').toLowerCase().startsWith('en');
    const group = isEn ? TTS_VOICE_PRESETS.en : TTS_VOICE_PRESETS.ko;
    const fallbackId = isEn ? 'ana' : 'sunhi';
    return group[presetId] || group[fallbackId];
}

function synthesizeEdgeNeuralTts({ text, lang = 'ko-KR', voicePreset = '', timeoutMs = 7000 } = {}) {
    const preset = resolveVoicePreset(lang, voicePreset);
    const xmlLang = String(lang || '').toLowerCase().startsWith('en') ? 'en-US' : 'ko-KR';
    const connId = crypto.randomUUID().replace(/-/g, '');
    const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
    const gec = generateSecMsGecV2();
    const wsUrl = `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connId}`;

    return new Promise((resolve) => {
        const chunks = [];
        let settled = false;
        let ws = null;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { if (ws && ws.readyState < 2) ws.close(); } catch (e) {}
            resolve(result);
        };

        const timer = setTimeout(() => finish(null), timeoutMs);

        try {
            ws = new WebSocket(wsUrl, {
                headers: {
                    Pragma: 'no-cache',
                    'Cache-Control': 'no-cache',
                    Origin: CHROME_ORIGIN,
                    'User-Agent': UA_HEADER,
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    'Accept-Language': 'en-US,en;q=0.9',
                    Cookie: `muid=${muid};`
                }
            });
        } catch (e) {
            return finish(null);
        }

        ws.addEventListener('open', () => {
            const reqId = crypto.randomUUID().replace(/-/g, '');
            const dt = new Date().toString();
            const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlLang}"><voice name="${preset.voice}"><prosody rate="${preset.rate}" pitch="${preset.pitch}">${escapeXml(text)}</prosody></voice></speak>`;
            ws.send(
                `X-Timestamp:${dt}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
                `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
            );
            ws.send(
                `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dt}Z\r\nPath:ssml\r\n\r\n${ssml}`
            );
        });

        ws.addEventListener('message', async (ev) => {
            if (typeof ev.data === 'string') {
                if (ev.data.includes('Path:turn.end')) {
                    const buffer = Buffer.concat(chunks);
                    finish(buffer.length > 250
                        ? { buffer, mimeType: 'audio/mpeg', ext: 'mp3', voice: preset.voice, engine: 'edge-neural' }
                        : null);
                }
                return;
            }
            try {
                const raw = ev.data instanceof Buffer ? ev.data : Buffer.from(await ev.data.arrayBuffer());
                const idx = raw.indexOf(Buffer.from('Path:audio\r\n'));
                if (idx >= 0) chunks.push(raw.subarray(idx + 12));
            } catch (e) {}
        });

        ws.addEventListener('error', () => finish(null));
        ws.addEventListener('close', () => {
            if (!settled) {
                const buffer = Buffer.concat(chunks);
                finish(buffer.length > 250
                    ? { buffer, mimeType: 'audio/mpeg', ext: 'mp3', voice: preset.voice, engine: 'edge-neural' }
                    : null);
            }
        });
    });
}

module.exports = {
    TTS_VOICE_PRESETS,
    resolveVoicePreset,
    synthesizeEdgeNeuralTts
};
