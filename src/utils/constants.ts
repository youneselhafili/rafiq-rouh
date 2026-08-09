// ─── API URLs ────────────────────────────────────────────────
export const MP3QURAN_API = 'https://www.mp3quran.net/api/v3/reciters?language=ar';
export const ALADHAN_API_BASE = 'https://api.aladhan.com/v1';

// ─── Live Stream URLs (Haramain) ─────────────────────────────
export const LIVE_MAKKAH_URL = 'http://m.live.net.sa:1935/live/quran/playlist.m3u8';
export const LIVE_MADINA_URL = 'http://m.live.net.sa:1935/live/sunnah/playlist.m3u8';

// ─── Embed Colors ────────────────────────────────────────────
export const COLORS = {
    PRIMARY: 0x1b6b4a,      // Deep Islamic Green
    QURAN: 0x2d8659,        // Quran Green
    ADHAN: 0xd4a843,        // Golden
    ADHKAR: 0x4CAF50,       // Green
    WARNING: 0xf59e0b,      // Amber
    ERROR: 0xef4444,        // Red
    SUCCESS: 0x10b981,      // Emerald
} as const;

// ─── Prayer Names (Arabic) ───────────────────────────────────
export const PRAYER_NAMES: Record<string, string> = {
    Fajr: 'الفجر',
    Sunrise: 'الشروق',
    Dhuhr: 'الظهر',
    Asr: 'العصر',
    Maghrib: 'المغرب',
    Isha: 'العشاء',
};

// ─── Prayer Keys to notify (exclude Sunrise) ────────────────
export const PRAYER_KEYS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

// ─── Bot Info ────────────────────────────────────────────────
export const BOT_NAME = 'رفيق الروح';
export const BOT_FOOTER = '© Copyright Younes Elhafili 2026-2027 | رفيق الروح — رفيقك في طاعة الله';

export const COUNTRY_FLAGS: Record<string, string> = {
    'Saudi Arabia': '🇸🇦', 'Egypt': '🇪🇬', 'Algeria': '🇩🇿', 'Morocco': '🇲🇦',
    'Tunisia': '🇹🇳', 'Libya': '🇱🇾', 'Iraq': '🇮🇶', 'Syria': '🇸🇾',
    'Jordan': '🇯🇴', 'Lebanon': '🇱🇧', 'Palestine': '🇵🇸', 'Kuwait': '🇰🇼',
    'UAE': '🇦🇪', 'Qatar': '🇶🇦', 'Bahrain': '🇧🇭', 'Oman': '🇴🇲',
    'Yemen': '🇾🇪', 'Sudan': '🇸🇩', 'Somalia': '🇸🇴', 'Turkey': '🇹🇷',
    'Iran': '🇮🇷', 'Pakistan': '🇵🇰', 'Bangladesh': '🇧🇩', 'Indonesia': '🇮🇩',
    'Malaysia': '🇲🇾', 'UK': '🇬🇧', 'France': '🇫🇷', 'Germany': '🇩🇪',
    'USA': '🇺🇸', 'Canada': '🇨🇦'
};

// ─── Canvas Settings ─────────────────────────────────────────
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 630;
export const ADHAN_TEMPLATE_PATH = './assets/adhan_template.png';
