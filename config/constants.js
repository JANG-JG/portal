require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 3004;
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

const BLOOD_DB_PATH = process.env.DB_PATH || path.join(BLOOD_DIR, 'health.db');
const ASSET_DB_PATH = process.env.ASSET_DB_PATH || path.join(ASSET_DIR, 'asset.db');
const NEWS_DB_PATH = process.env.NEWS_DB_PATH || path.join(NEWS_DIR, 'briefing.db');
const ALBUM_DB_PATH = process.env.ALBUM_DB_PATH || path.join(ALBUM_DIR, 'album.db');

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
        return u.hostname === 'j-jg.cc' || u.hostname.endsWith('.j-jg.cc');
    } catch (e) {
        return false;
    }
}

module.exports = {
    PORT,
    JWT_SECRET,
    COOKIE_DOMAIN,
    WORKSPACE_ROOT,
    BLOOD_DIR,
    ASSET_DIR,
    NEWS_DIR,
    BLOOD_DB_PATH,
    ASSET_DB_PATH,
    NEWS_DB_PATH,
    ADMIN_USERS,
    ALLOWED_ORIGINS,
    isOriginAllowed
};
