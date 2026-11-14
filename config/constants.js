require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 3004;
const STATIC_ASSET_VERSION = process.env.STATIC_ASSET_VERSION || '20261114_165809';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('🚨 [보안 오류] JWT_SECRET 환경변수가 누락되었습니다. .env 설정을 확인하세요.');
    process.exit(1);
}
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.j-jg.cc';

// 서브 프로젝트 기본 경로 자동 탐색 (환경 변수 -> 상위 폴더 상대경로 -> 홈 workspace)
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../..');
const HOME_WORKSPACE = path.join(os.homedir(), 'workspace');
const BLOOD_DIR = process.env.BLOOD_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'blood-pressure-app')) ? path.join(WORKSPACE_ROOT, 'blood-pressure-app') : path.join(HOME_WORKSPACE, 'blood-pressure-app'));
const ASSET_DIR = process.env.ASSET_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'asset')) ? path.join(WORKSPACE_ROOT, 'asset') : path.join(HOME_WORKSPACE, 'asset'));
const NEWS_DIR = process.env.NEWS_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'news-dashboard')) ? path.join(WORKSPACE_ROOT, 'news-dashboard') : path.join(HOME_WORKSPACE, 'news-dashboard'));
const ALBUM_DIR = process.env.ALBUM_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'family-album')) ? path.join(WORKSPACE_ROOT, 'family-album') : path.join(HOME_WORKSPACE, 'family-album'));
const WIKI_DIR = process.env.WIKI_DIR || (fs.existsSync(path.join(WORKSPACE_ROOT, 'family-wiki')) ? path.join(WORKSPACE_ROOT, 'family-wiki') : path.join(HOME_WORKSPACE, 'family-wiki'));
const PORTAL_DIR = path.resolve(__dirname, '..');

const BLOOD_DB_PATH = process.env.DB_PATH || path.join(BLOOD_DIR, 'health.db');
const ASSET_DB_PATH = process.env.ASSET_DB_PATH || path.join(ASSET_DIR, 'asset.db');
const NEWS_DB_PATH = process.env.NEWS_DB_PATH || path.join(NEWS_DIR, 'briefing.db');
const ALBUM_DB_PATH = process.env.ALBUM_DB_PATH || path.join(ALBUM_DIR, 'album.db');
const WIKI_DB_PATH = process.env.WIKI_DB_PATH || path.join(WIKI_DIR, 'wiki.db');
const PORTAL_DB_PATH = process.env.PORTAL_DB_PATH || path.join(PORTAL_DIR, 'portal.db');


const ADMIN_USERS = new Set([
    'admin',
    process.env.ADMIN_USER,
    ...(process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',').map(s => s.trim()) : [])
].filter(Boolean));
ADMIN_USERS.includes = (u) => ADMIN_USERS.has(u);

const ALLOWED_ORIGINS = [
    'https://j-jg.cc',
    'https://blood.j-jg.cc',
    'https://asset.j-jg.cc',
    'https://news.j-jg.cc',
    'https://album.j-jg.cc',
    'http://localhost:3000',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:3005',
    'http://localhost:5050'
];

function isOriginAllowed(origin) {
    if (!origin) return false;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    try {
        const u = new URL(origin);
        const h = u.hostname;
        if (h === 'j-jg.cc' || h.endsWith('.j-jg.cc')) return true;
        if (u.protocol === 'http:' || u.protocol === 'https:') {
            if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return true;
            if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

const SECONDARY_HOST = process.env.SECONDARY_HOST || '192.168.50.75';
const WIKI_HOST = process.env.WIKI_HOST || SECONDARY_HOST;
const WIKI_PORT = parseInt(process.env.WIKI_PORT, 10) || 5060;
const WIKI_BASE_URL = process.env.WIKI_BASE_URL || `http://${WIKI_HOST}:${WIKI_PORT}`;

module.exports = {
    PORT,
    STATIC_ASSET_VERSION,
    JWT_SECRET,
    COOKIE_DOMAIN,
    WORKSPACE_ROOT,
    BLOOD_DIR,
    ASSET_DIR,
    NEWS_DIR,
    ALBUM_DIR,
    WIKI_DIR,
    PORTAL_DIR,
    BLOOD_DB_PATH,
    ASSET_DB_PATH,
    NEWS_DB_PATH,
    ALBUM_DB_PATH,
    WIKI_DB_PATH,
    PORTAL_DB_PATH,
    SECONDARY_HOST,
    WIKI_HOST,
    WIKI_PORT,
    WIKI_BASE_URL,
    ADMIN_USERS,
    ALLOWED_ORIGINS,
    isOriginAllowed
};

