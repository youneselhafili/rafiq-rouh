import { getAllRadios, getAllReciters } from '../quran/quranRegistry';

export interface BotCatalogStats {
    reciters: number;
    favoriteReciters: number;
    libraryReciters: number;
    radios: number;
    recitations: number;
}

export function getBotCatalogStats(): BotCatalogStats {
    const reciters = getAllReciters();
    return {
        reciters: reciters.length,
        favoriteReciters: reciters.filter(reciter => reciter.category === 'favorite').length,
        libraryReciters: reciters.filter(reciter => reciter.category === 'library').length,
        radios: getAllRadios().length,
        recitations: reciters.reduce((total, reciter) => total + reciter.surahs.length, 0),
    };
}

export function buildApplicationDescription(): string {
    const stats = getBotCatalogStats();
    return [
        'رفيق الروح 🕌 بوت إسلامي مجاني متكامل',
        `📖 قرآن 24/24 مع ${stats.reciters} قارئاً و${stats.radios} إذاعات`,
        `🎧 ${stats.recitations.toLocaleString('en-US')} تلاوة صوتية`,
        '🕋 الأذان ومواقيت الصلاة متعددة المدن',
        '📿 الأذكار والصلاة على النبي ﷺ',
        '🌙 الجمعة وسورة الكهف والختمات اليومية',
        '✉️ تنبيهات شخصية في الرسائل الخاصة',
        '⚙️ لوحات إعداد سهلة للمشرفين • /how_to_use',
        '💚 المطوّر: يونس الحافلي',
    ].join('\n');
}

export function buildCatalogSummary(): string {
    const stats = getBotCatalogStats();
    return `**${stats.reciters} قارئاً** (${stats.favoriteReciters} مفضلين + ${stats.libraryReciters} في المكتبة) • **${stats.radios} إذاعات** • **${stats.recitations.toLocaleString('en-US')} تلاوة**`;
}
