/**
 * ==============================================================================
 * 유아 학습실 서버 음성 합성(TTS) 폴백 & 디스크 캐시 서비스 (studyTts.service.js)
 * ------------------------------------------------------------------------------
 * [규칙 3] 500줄 이하 모듈화 | 외부 API 실패 시에도 안정적인 이중 음성 엔진 제공
 * - 1순위: 디스크 영구 캐시 (portal/data/tts-cache) 즉시 서빙 (지연 0ms)
 * - 2순위: Google Translate TTS MP3 (IPv4 HTTPS)
 * - 3순위: Gemini 2.5 Flash TTS (24kHz PCM -> 44B WAV 헤더 조립)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { resolveGeminiApiKey } = require('./geminiWorksheet.service');

const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'tts-cache');
const ipv4Agent = new https.Agent({ family: 4 });
const inflightRequests = new Map();

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function normalizeTtsInput(rawText, rawLang = 'ko-KR') {
    const cleanText = String(rawText || '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    const langStr = String(rawLang || 'ko-KR').toLowerCase();
    const isEn = langStr.startsWith('en');
    return {
        text: cleanText,
        lang: isEn ? 'en-US' : 'ko-KR',
        shortLang: isEn ? 'en' : 'ko'
    };
}

function getCachePaths(text, lang) {
    const hash = crypto.createHash('sha1').update(`${lang}:${text}`).digest('hex');
    return {
        hash,
        mp3: path.join(CACHE_DIR, `${hash}.mp3`),
        wav: path.join(CACHE_DIR, `${hash}.wav`)
    };
}

function httpsGetBuffer(urlStr, headers = {}, timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);
        const req = https.get(
            {
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                agent: ipv4Agent,
                timeout: timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Galaxy Tab) AppleWebKit/537.36',
                    ...headers
                }
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode || 500,
                    contentType: String(res.headers['content-type'] || ''),
                    buffer: Buffer.concat(chunks)
                }));
            }
        );
        req.on('timeout', () => req.destroy(new Error('TTS_GET_TIMEOUT')));
        req.on('error', reject);
    });
}

function httpsPostJson(urlStr, headers, bodyObj, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(bodyObj);
        const parsed = new URL(urlStr);
        const req = https.request(
            {
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                method: 'POST',
                agent: ipv4Agent,
                timeout: timeoutMs,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...headers
                }
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode || 500,
                    body: Buffer.concat(chunks).toString('utf8')
                }));
            }
        );
        req.on('timeout', () => req.destroy(new Error('TTS_POST_TIMEOUT')));
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function wrapPcmAsWav(pcmBuf, sampleRate = 24000, channels = 1, bitDepth = 16) {
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuf.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuf.length, 40);
    return Buffer.concat([header, pcmBuf]);
}

async function fetchGoogleTranslateTts(text, shortLang) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(shortLang)}&client=tw-ob&q=${encodeURIComponent(text)}`;
    const res = await httpsGetBuffer(url, {
        Accept: 'audio/mpeg, audio/*;q=0.9',
        Referer: 'https://translate.google.com/'
    });
    if (res.status === 200 && res.buffer.length > 400 && !res.contentType.includes('text/html')) {
        return { buffer: res.buffer, mimeType: 'audio/mpeg', ext: 'mp3' };
    }
    return null;
}

async function fetchGeminiTts(text, lang) {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return null;

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
    const voiceName = lang.startsWith('en') ? 'Puck' : 'Kore';
    const payload = {
        contents: [{
            parts: [{
                text: lang.startsWith('en')
                    ? `Speak clearly and warmly for a young child: ${text}`
                    : `어린아이에게 들려주듯 따뜻하고 또렷하게 천천히 읽어 주세요: ${text}`
            }]
        }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName }
                }
            }
        }
    };

    const res = await httpsPostJson(url, { 'x-goog-api-key': apiKey }, payload, 9000);
    if (res.status !== 200) return null;

    const parsed = JSON.parse(res.body);
    const part = parsed?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) return null;

    const rawBytes = Buffer.from(part.inlineData.data, 'base64');
    const mime = String(part.inlineData.mimeType || '').toLowerCase();
    if (mime.includes('wav') || mime.includes('mp3') || mime.includes('mpeg')) {
        return { buffer: rawBytes, mimeType: mime.includes('mp3') || mime.includes('mpeg') ? 'audio/mpeg' : 'audio/wav', ext: mime.includes('mp3') ? 'mp3' : 'wav' };
    }
    const rateMatch = mime.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    return { buffer: wrapPcmAsWav(rawBytes, sampleRate), mimeType: 'audio/wav', ext: 'wav' };
}

async function synthesizeStudySpeech(rawText, rawLang = 'ko-KR') {
    const { text, lang, shortLang } = normalizeTtsInput(rawText, rawLang);
    if (!text) {
        return { ok: false, status: 400, reason: 'empty_text' };
    }

    ensureCacheDir();
    const paths = getCachePaths(text, lang);

    if (fs.existsSync(paths.mp3)) {
        return { ok: true, buffer: fs.readFileSync(paths.mp3), mimeType: 'audio/mpeg', cached: true };
    }
    if (fs.existsSync(paths.wav)) {
        return { ok: true, buffer: fs.readFileSync(paths.wav), mimeType: 'audio/wav', cached: true };
    }

    if (inflightRequests.has(paths.hash)) {
        return inflightRequests.get(paths.hash);
    }

    const work = (async () => {
        try {
            let audio = null;
            try {
                audio = await fetchGoogleTranslateTts(text, shortLang);
            } catch (e) {}

            if (!audio) {
                try {
                    audio = await fetchGeminiTts(text, lang);
                } catch (e) {}
            }

            if (!audio || !audio.buffer || audio.buffer.length < 200) {
                return { ok: false, status: 503, reason: 'tts_unavailable' };
            }

            const outPath = audio.ext === 'wav' ? paths.wav : paths.mp3;
            try {
                fs.writeFileSync(outPath, audio.buffer);
            } catch (e) {}

            return { ok: true, buffer: audio.buffer, mimeType: audio.mimeType, cached: false };
        } finally {
            inflightRequests.delete(paths.hash);
        }
    })();

    inflightRequests.set(paths.hash, work);
    return work;
}

function hasCachedTts(rawText, rawLang = 'ko-KR') {
    const { text, lang } = normalizeTtsInput(rawText, rawLang);
    if (!text) return false;
    const paths = getCachePaths(text, lang);
    return fs.existsSync(paths.mp3) || fs.existsSync(paths.wav);
}

function getTtsCacheStats() {
    try {
        ensureCacheDir();
        const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3') || f.endsWith('.wav'));
        let totalBytes = 0;
        for (const f of files) {
            try { totalBytes += fs.statSync(path.join(CACHE_DIR, f)).size; } catch (e) {}
        }
        return { fileCount: files.length, totalBytes };
    } catch (e) {
        return { fileCount: 0, totalBytes: 0 };
    }
}

module.exports = {
    normalizeTtsInput,
    synthesizeStudySpeech,
    hasCachedTts,
    getTtsCacheStats
};
