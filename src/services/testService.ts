import {
    EmbedBuilder,
    AttachmentBuilder,
} from 'discord.js';
import { COLORS } from '../utils/constants';
import { getAllAdhkarCategories, getReciters } from './contentService';
import { generateAdhanImage, generateSalawatImage, generateAdhkarImage, generateJumuahKahfImage, generatePrayerCard, generateQuranLiveImage } from './canvasService';
import { fetchPrayerTimes } from './adhanService';
import { getAllReciters } from '../quran/quranRegistry';
import hadiths from '../data/hadiths.json';

// ─── Result Type ─────────────────────────────────────────────

export interface TestResult {
    embeds?: EmbedBuilder[];
    files?: AttachmentBuilder[];
    content?: string;
}

// ─── Inline data (mirrors non-exported module constants) ──────

const ADHAN_VERSES = [
    { text: 'إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا', surah: 'النساء' },
    { text: 'وَأَقِمِ الصَّلَاةَ إِنَّ الصَّلَاةَ تَنْهَى عَنِ الْفَحْشَاءِ وَالْمُنْكَرِ', surah: 'العنكبوت' },
    { text: 'وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ', surah: 'البقرة' },
    { text: 'حَافِظُوا عَلَى الصَّلَوَاتِ وَالصَّلَاةِ الْوُسْطَى', surah: 'البقرة' },
    { text: 'قَدْ أَفْلَحَ الْمُؤْمِنُونَ • الَّذِينَ هُمْ فِي صَلَاتِهِمْ خَاشِعُونَ', surah: 'المؤمنون' },
    { text: 'رَبِّ اجْعَلْنِي مُقِيمَ الصَّلَاةِ وَمِنْ ذُرِّيَّتِي', surah: 'إبراهيم' },
];

const SALAWAT_TEXTS = [
    'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ',
    'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلَى إِبْرَاهِيمَ وَعَلَى آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ',
    'اللَّهُمَّ بَارِكْ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ كَمَا بَارَكْتَ عَلَى إِبْرَاهِيمَ وَعَلَى آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ',
];

const JUMUAH_QUOTES = [
    'اللهم في يوم الجمعة ارحم من ضَمّه التراب، واشفِ من أنهكه الوجع، وأغِث من أثقله الهم، واهدِ من غرته الدنيا.',
    'يوم الجمعة، لحَظات بيضاء ودقائق رائعة، ارتشفوا من سلسبيلها ورتلوا الكهف بقلب خاشع.',
    'اللهم في يوم الجمعة اجعلنا ممن عفوت عنهم، ورضيت عنهم وغفرت لهم وحرّمت عليهم النار وكتبت لهم الجنّة.',
    'من سنن يوم الجمعة: قراءة سورة الكهف، كثرة الصلاة على النبي ﷺ، السواك، الغسل، وتحري ساعة الإجابة.',
    'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ ﷺ.',
];

// ─── Helpers ─────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Adhkar ──────────────────────────────────────────────────

export async function getRandomAdhkarPreview(): Promise<TestResult> {
    const categories = getAllAdhkarCategories();
    if (categories.length === 0) {
        return { embeds: [errorEmbed('☪️', 'لا توجد أذكار متاحة.')] };
    }

    const category = pickRandom(categories);
    const items = category.items;
    if (items.length === 0) {
        return { embeds: [errorEmbed('☪️', `التصنيف "${category.name}" لا يحتوي على عناصر.`)] };
    }

    const item = pickRandom(items);
    const isTasbih = item.type === 'tasbih';

    const embed = new EmbedBuilder()
        .setColor(COLORS.ADHKAR)
        .setTitle(`☪️ الأذكار — ${category.emoji} ${category.name}`)
        .setDescription(
            `**النص:**\n${item.text}\n\n` +
            `**التكرار:** ${item.count}`
        )
        .setFooter({ text: `✔️ تم تحميل المحتوى بنجاح • ${categories.length} تصنيف` })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateAdhkarImage(item.text, isTasbih);
        files.push(new AttachmentBuilder(buffer, { name: 'test_adhkar.png' }));
    } catch {
        // Image generation is optional for this test
    }

    return { embeds: [embed], files };
}

// ─── Duas ────────────────────────────────────────────────────

export async function getRandomDuaPreview(): Promise<TestResult> {
    const categories = getAllAdhkarCategories();
    const allDuas = categories.flatMap(c =>
        c.items.filter(i => i.type === 'dua').map(i => ({ ...i, categoryName: c.name, categoryEmoji: c.emoji }))
    );

    if (allDuas.length === 0) {
        return { embeds: [errorEmbed('🤲', 'لا توجد أدعية متاحة في قاعدة البيانات.')] };
    }

    const dua = pickRandom(allDuas);
    const embed = new EmbedBuilder()
        .setColor(COLORS.ADHKAR)
        .setTitle(`🤲 الأدعية — ${dua.categoryEmoji} ${dua.categoryName}`)
        .setDescription(
            `**النص:**\n${dua.text}\n\n` +
            `**التكرار:** ${dua.count}`
        )
        .setFooter({ text: `✔️ تم التحميل • ${allDuas.length} دعاء متاح` })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateAdhkarImage(dua.text, false, 'الأدعية');
        files.push(new AttachmentBuilder(buffer, { name: 'test_dua.png' }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

// ─── فضاء القرآن ─────────────────────────────────────────────

const QURAN_SPACE_KEYS = ['فضائل السور', 'دعاء ختم القرآن', 'الأدعية القرآنية'];

export async function getRandomQuranSpacePreview(): Promise<TestResult> {
    const categories = getAllAdhkarCategories();
    const quranCategories = categories.filter(c => QURAN_SPACE_KEYS.includes(c.key));
    const allItems = quranCategories.flatMap(c =>
        c.items.map(i => ({ ...i, categoryName: c.name, categoryEmoji: c.emoji }))
    );

    if (allItems.length === 0) {
        return { embeds: [errorEmbed('📖', 'لا توجد عناصر في فضاء القرآن.')] };
    }

    const item = pickRandom(allItems);
    const embed = new EmbedBuilder()
        .setColor(COLORS.QURAN || '#1B5E20')
        .setTitle(`📖 فضاء القرآن — ${item.categoryEmoji} ${item.categoryName}`)
        .setDescription(
            `**النص:**\n${item.text}\n\n` +
            `**التكرار:** ${item.count}`
        )
        .setFooter({ text: `✔️ تم التحميل • ${allItems.length} عنصر متاح` })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateAdhkarImage(item.text, item.text.length < 50, 'فضاء القرآن');
        files.push(new AttachmentBuilder(buffer, { name: 'test_quran_space.png' }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

// ─── Individual Quran Space Category Previews ─────────────────

async function getQuranSpaceCategoryPreview(targetKey: string): Promise<TestResult> {
    const categories = getAllAdhkarCategories();
    const category = categories.find(c => c.key === targetKey);

    if (!category || category.items.length === 0) {
        return { embeds: [errorEmbed('📖', `لا توجد عناصر في "${targetKey}".`)] };
    }

    const item = pickRandom(category.items);
    const embed = new EmbedBuilder()
        .setColor(COLORS.QURAN || '#1B5E20')
        .setTitle(`📖 ${category.emoji} ${category.name}`)
        .setDescription(
            `**النص:**\n${item.text}\n\n` +
            `**التكرار:** ${item.count}`
        )
        .setFooter({ text: `✔️ تم التحميل • ${category.items.length} عنصر في هذا التصنيف` })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateAdhkarImage(item.text, item.text.length < 50, category.name);
        files.push(new AttachmentBuilder(buffer, { name: `test_${targetKey}.png` }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

export async function getQuranDuasPreview(): Promise<TestResult> {
    return getQuranSpaceCategoryPreview('الأدعية القرآنية');
}

export async function getKhatmQuranPreview(): Promise<TestResult> {
    return getQuranSpaceCategoryPreview('دعاء ختم القرآن');
}

export async function getFadailSuwarPreview(): Promise<TestResult> {
    return getQuranSpaceCategoryPreview('فضائل السور');
}


// ─── Adhan ───────────────────────────────────────────────────

export async function getRandomAdhanPreview(): Promise<TestResult> {
    const hadith = pickRandom(hadiths);
    const verse = pickRandom(ADHAN_VERSES);

    const embed = new EmbedBuilder()
        .setColor(COLORS.ADHAN)
        .setTitle('🕌 اختبار الأذان')
        .setDescription(
            `**الحديث:**\n${hadith}\n\n` +
            `**الآية المستخدمة:**\n﴿${verse.text}﴾ — سورة ${verse.surah}`
        )
        .addFields(
            { name: '📊 مصدر الحديث', value: hadith.includes('—') ? hadith.split('—').pop()!.trim() : 'غير محدد', inline: true },
            { name: '🕐 وقت الاختبار', value: 'الفجر — 04:30', inline: true },
            { name: '📍 المدينة', value: 'مكة المكرمة — السعودية', inline: true },
        )
        .setFooter({ text: '✔️ تم تحميل المحتوى • تم إنشاء صورة الأذان' })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateAdhanImage('مكة المكرمة', 'السعودية', 'Fajr', '04:30', verse.text, `سورة ${verse.surah}`);
        files.push(new AttachmentBuilder(buffer, { name: 'test_adhan.png' }));
    } catch {
        // Fallback: just text result
    }

    return { embeds: [embed], files };
}

// ─── Salawat ─────────────────────────────────────────────────

export async function getRandomSalawatPreview(): Promise<TestResult> {
    const salawat = pickRandom(SALAWAT_TEXTS);

    const embed = new EmbedBuilder()
        .setColor(COLORS.QURAN)
        .setTitle('📿 اختبار الصلاة على النبي')
        .setDescription(`**نص الصلاة:**\n${salawat}`)
        .addFields(
            { name: '📊 المصدر', value: 'الصيغ الواردة في السنة النبوية', inline: true },
            { name: '📋 العدد الكلي', value: `${SALAWAT_TEXTS.length} صيغ`, inline: true },
        )
        .setFooter({ text: '✔️ تم تحميل المحتوى • تم إنشاء الصورة' })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateSalawatImage(salawat);
        files.push(new AttachmentBuilder(buffer, { name: 'test_salawat.png' }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

// ─── Jumuah ──────────────────────────────────────────────────

export async function getRandomJumuahPreview(): Promise<TestResult> {
    const quote = pickRandom(JUMUAH_QUOTES);
    const reciters = getAllReciters().filter(reciter => reciter.surahs[17]?.url);
    const allRecitersLabel = `\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621 \u2022 ${reciters.length} \u062a\u0644\u0627\u0648\u0627\u062a`;

    const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle('\u{1F31F} \u0627\u062e\u062a\u0628\u0627\u0631 \u0627\u0644\u062c\u0645\u0639\u0629 \u0648\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641')
        .setDescription(
            `**\u0627\u0644\u0627\u0642\u062a\u0628\u0627\u0633:**\n${quote}\n\n` +
            `**\u0627\u0644\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0635\u0648\u062a\u064a:** ${reciters.length} \u0642\u0631\u0627\u0621 \u0643\u0627\u0645\u0644\u064a\u0646 \u0641\u064a Loop\n` +
            '**\u0627\u0644\u0628\u062f\u0627\u064a\u0629:** \u0628\u0639\u062f \u0623\u0630\u0627\u0646 \u0627\u0644\u0641\u062c\u0631\n' +
            '**\u0627\u0644\u0646\u0647\u0627\u064a\u0629:** \u0642\u0628\u0644 \u0623\u0630\u0627\u0646 \u0627\u0644\u0638\u0647\u0631 \u0645\u0639 \u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0627\u0644\u0625\u0630\u0627\u0639\u0629'
        )
        .setFooter({ text: '\u2714\uFE0F \u062a\u0645 \u0641\u062d\u0635 \u0631\u0648\u0627\u0628\u0637 \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u0644\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621' })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateJumuahKahfImage(quote, allRecitersLabel);
        files.push(new AttachmentBuilder(buffer, { name: 'test_jumuah_kahf.png' }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

// ---------------- Prayer Times ────────────────────────────────────────────

export async function getPrayerTimesPreview(): Promise<TestResult> {
    const testCity = 'Mecca';
    const testCountry = 'Saudi Arabia';

    const result = await fetchPrayerTimes(testCity, testCountry);
    if (!result) {
        return { embeds: [errorEmbed('🕐', `فشل في جلب أوقات الصلاة لـ ${testCity}, ${testCountry}.`)] };
    }

    const { timings, hijriDate } = result;

    const fajr = (timings.Fajr || '').replace(/\s*\(.*\)/, '').trim();
    const dhuhr = (timings.Dhuhr || '').replace(/\s*\(.*\)/, '').trim();
    const asr = (timings.Asr || '').replace(/\s*\(.*\)/, '').trim();
    const maghrib = (timings.Maghrib || '').replace(/\s*\(.*\)/, '').trim();
    const isha = (timings.Isha || '').replace(/\s*\(.*\)/, '').trim();

    const embed = new EmbedBuilder()
        .setColor(COLORS.ADHAN)
        .setTitle('🕐 اختبار أوقات الصلاة')
        .setDescription(
            `📍 **المدينة:** ${testCity} — ${testCountry}\n` +
            `📅 **التاريخ الهجري:** ${hijriDate}\n\n` +
            `🕌 **الفجر:** \`${fajr}\`\n` +
            `☀️ **الظهر:** \`${dhuhr}\`\n` +
            `🌤️ **العصر:** \`${asr}\`\n` +
            `🌅 **المغرب:** \`${maghrib}\`\n` +
            `🌙 **العشاء:** \`${isha}\``
        )
        .setFooter({ text: `✔️ تم الاتصال بـ Aladhan API • ${testCity}` })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generatePrayerCard(testCity, fajr, dhuhr, asr, maghrib, isha);
        files.push(new AttachmentBuilder(buffer, { name: 'test_prayers.png' }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

// ─── Quran ──────────────────────────────────────────────────

export async function getRandomQuranPreview(): Promise<TestResult> {
    const reciters = getReciters();
    if (reciters.length === 0) {
        return { embeds: [errorEmbed('📖', 'لا يوجد قرّاء متاحون في قاعدة البيانات.')] };
    }

    const reciter = pickRandom(reciters);
    const moshaf = reciter.moshaf[0];

    const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle('📖 اختبار القرآن')
        .setDescription(
            `**القارئ:** ${reciter.name}\n` +
            `**الحرف:** ${reciter.letter}\n` +
            `**المصحف:** ${moshaf?.name || 'غير محدد'}\n` +
            `**عدد السور:** ${moshaf?.surah_total || 'غير محدد'}\n` +
            `**المعرف:** \`${reciter.id}\``
        )
        .setFooter({ text: `✔️ تم التحميل • ${reciters.length} قارئ متاح` })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    try {
        const buffer = await generateQuranLiveImage(reciter.name, false);
        files.push(new AttachmentBuilder(buffer, { name: 'test_quran.png' }));
    } catch {
        // Fallback: text only
    }

    return { embeds: [embed], files };
}

// ─── Wudu Reminder ──────────────────────────────────────────

const WUDU_HADITHS = [
    'قال رسول الله ﷺ: «مَن توضَّأ فأحسَن الوضوءَ ثمَّ أتى المسجدَ فهو زائرُ اللهِ وحقٌّ على المزُورِ أن يُكرِمَ الزَّائرَ» — رواه الطبراني',
    'قال رسول الله ﷺ: «ألَا أدُلُّكم على ما يمحو اللهُ بهِ الخطايا ويرفعُ بهِ الدَّرجاتِ؟ إسباغُ الوضوءِ على المكارِهِ وكثرةُ الخُطا إلى المساجدِ وانتظارُ الصَّلاةِ بعد الصَّلاةِ فذلِكم الرِّباطُ» — رواه مسلم',
];

export async function getWuduReminderPreview(): Promise<TestResult> {
    const hadith = pickRandom(WUDU_HADITHS);

    const embed = new EmbedBuilder()
        .setColor(COLORS.ADHKAR)
        .setTitle('💧 اختبار تذكير الوضوء')
        .setDescription(`**الحديث:**\n${hadith}`)
        .addFields(
            { name: '🕐 التوقيت', value: 'بعد الأذان بـ 5 دقائق', inline: true },
            { name: '📋 عدد الأحاديث', value: `${WUDU_HADITHS.length} أحاديث`, inline: true },
        )
        .setFooter({ text: '✔️ تم تحميل المحتوى • تذكير الوضوء بعد الصلاة' })
        .setTimestamp();

    return { embeds: [embed] };
}

// ─── Error Embed ────────────────────────────────────────────

function errorEmbed(emoji: string, message: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle(`${emoji} فشل الاختبار`)
        .setDescription(`❌ ${message}`)
        .setFooter({ text: 'يرجى التحقق من تحميل المحتوى (npm run build)' })
        .setTimestamp();
}
