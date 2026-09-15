import * as cron from 'node-cron';
import moment from 'moment-timezone';
import { AttachmentBuilder, Client, EmbedBuilder } from 'discord.js';
import cities from '../data/cities.json';
import { fetchPrayerTimes } from './adhanService';
import { addDMSentEvent, getAllDMUserConfigs, updateUserDMConfig, UserDMConfig } from './dmSubscriptionService';
import { dmText } from './dmLocalizationService';
import { logger } from '../utils/logger';
import { BOT_FOOTER, COLORS } from '../utils/constants';
import { generateAdhanImage, generateAdhanWarningImage, generatePrayerCard, generateSalawatImage } from './canvasService';
import { tryBuildAttachment } from './canvasFallback';
import { loadSalawatTexts } from './salawatService';
import { getAdhkarByKey, getAllAdhkarCategoryNames } from './contentService';

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
const PRAYER_AR: Record<string, string> = {
    Fajr: '\u0627\u0644\u0641\u062c\u0631',
    Dhuhr: '\u0627\u0644\u0638\u0647\u0631',
    Asr: '\u0627\u0644\u0639\u0635\u0631',
    Maghrib: '\u0627\u0644\u0645\u063a\u0631\u0628',
    Isha: '\u0627\u0644\u0639\u0634\u0627\u0621',
};
const DM_ADHAN_VERSES = [
    { text: 'إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا', surah: 'النساء: 103' },
    { text: 'وَأَقِمِ الصَّلَاةَ إِنَّ الصَّلَاةَ تَنْهَى عَنِ الْفَحْشَاءِ وَالْمُنكَرِ', surah: 'العنكبوت: 45' },
    { text: 'حَافِظُوا عَلَى الصَّلَوَاتِ وَالصَّلَاةِ الْوُسْطَى', surah: 'البقرة: 238' },
];
const DAILY_QURAN_VERSES = [
    { text: 'وَقُل رَّبِّ زِدْنِي عِلْمًا', source: 'طه: 114' },
    { text: 'فَاذْكُرُونِي أَذْكُرْكُمْ وَاشْكُرُوا لِي وَلَا تَكْفُرُونِ', source: 'البقرة: 152' },
    { text: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا', source: 'الشرح: 6' },
];

type PersonalAdhanEvent = 'warning' | 'adhan' | 'prayer_card';

async function buildPersonalAdhanPayload(
    eventKey: PersonalAdhanEvent,
    config: UserDMConfig,
    meta: any,
    prayer: string,
    time: string,
    timings: Record<string, string>,
) {
    const title = eventKey === 'warning'
        ? dmText('adhan_warning', config.language)
        : eventKey === 'prayer_card'
            ? dmText('prayer_card', config.language)
            : dmText('adhan_now', config.language);
    const prayerName = PRAYER_AR[prayer] || prayer;
    const cityLine = `${meta.name} — ${meta.countryAr}`;

    if (eventKey === 'warning') {
        const file = await tryBuildAttachment(() => generateAdhanWarningImage(meta.name, meta.countryAr, prayerName, time), 'personal_adhan_warning.png');
        const embed = new EmbedBuilder()
            .setColor(COLORS.WARNING)
            .setTitle(title)
            .setDescription(`${prayerName} • ${cityLine} • ${time}`)
            .setFooter({ text: BOT_FOOTER })
            .setTimestamp();
        if (file) embed.setImage('attachment://personal_adhan_warning.png');
        return { embeds: [embed], ...(file ? { files: [file] } : {}) };
    }

    if (eventKey === 'prayer_card') {
        const file = await tryBuildAttachment(() => generatePrayerCard(
            meta.name,
            cleanTime(timings.Fajr || '-'),
            cleanTime(timings.Dhuhr || '-'),
            cleanTime(timings.Asr || '-'),
            cleanTime(timings.Maghrib || '-'),
            cleanTime(timings.Isha || '-'),
        ), 'personal_prayer_times.png');
        const embed = new EmbedBuilder()
            .setColor(COLORS.PRIMARY)
            .setTitle(title)
            .setDescription(`${cityLine}\n\nالفجر ${cleanTime(timings.Fajr || '-')} • الظهر ${cleanTime(timings.Dhuhr || '-')} • العصر ${cleanTime(timings.Asr || '-')} • المغرب ${cleanTime(timings.Maghrib || '-')} • العشاء ${cleanTime(timings.Isha || '-')}`)
            .setFooter({ text: BOT_FOOTER })
            .setTimestamp();
        if (file) embed.setImage('attachment://personal_prayer_times.png');
        return { embeds: [embed], ...(file ? { files: [file] } : {}) };
    }

    const verse = DM_ADHAN_VERSES[Math.floor(Math.random() * DM_ADHAN_VERSES.length)];
    const file = await tryBuildAttachment(() => generateAdhanImage(meta.name, meta.countryAr, prayer, time, verse.text, verse.surah), 'personal_adhan.png');
    const embed = new EmbedBuilder()
        .setColor(COLORS.ADHAN)
        .setTitle(title)
        .setDescription(`${prayerName} • ${cityLine} • ${time}\n\n${verse.text}\n(${verse.surah})`)
        .setFooter({ text: BOT_FOOTER })
        .setTimestamp();
    if (file) embed.setImage('attachment://personal_adhan.png');
    return { embeds: [embed], ...(file ? { files: [file] } : {}) };
}

let scheduler: cron.ScheduledTask | undefined;
const running = new Set<string>();

function cleanTime(value: string): string {
    return value.replace(/\s*\(.*\)/, '').trim();
}

function cityMeta(cityNameEn?: string) {
    if (!cityNameEn) return null;
    return cities.find(city => city.nameEn === cityNameEn) || null;
}

function alreadySent(config: UserDMConfig, key: string): boolean {
    return Boolean(config.runtime?.sentEvents?.includes(key));
}

async function sendPersonalAdhkarCategory(client: Client, userId: string, config: UserDMConfig, categoryKey: string, eventKey: string) {
    const categories = config.adhkarConfig.categories as Record<string, boolean>;
    if (!config.enabled || categories[categoryKey] !== true || alreadySent(config, eventKey)) return;
    const category = getAllAdhkarCategoryNames().find(item => item.key === categoryKey);
    const items = getAdhkarByKey(categoryKey);
    const item = items.length ? items[Math.floor(Math.random() * items.length)] : undefined;
    if (!category || !item || running.has(`${userId}:${eventKey}`)) return;
    running.add(`${userId}:${eventKey}`);
    try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return;
        const embed = new EmbedBuilder()
            .setColor(COLORS.PRIMARY)
            .setTitle(`${category.emoji || '📿'} ${category.name}`)
            .setDescription(`${item.text}${item.count ? `\n\nالتكرار: ${item.count}` : ''}${item.source ? `\nالمصدر: ${item.source}` : ''}`)
            .setFooter({ text: BOT_FOOTER })
            .setTimestamp();
        await user.send({ embeds: [embed] });
        await addDMSentEvent(userId, eventKey);
        config.runtime = { ...config.runtime, sentEvents: [...(config.runtime?.sentEvents || []), eventKey].slice(-500) };
    } catch (error) {
        logger.warn(`[DM Scheduler] Failed to send personal adhkar to ${userId}: ${String(error)}`);
    } finally {
        running.delete(`${userId}:${eventKey}`);
    }
}

function nextFixedSalawat(now: moment.Moment, fixedTimes: string[]): moment.Moment | null {
    const candidates = fixedTimes.flatMap(time => {
        const [hour, minute] = time.split(':').map(Number);
        return [0, 1].map(offset => now.clone().add(offset, 'day').hour(hour).minute(minute).second(0).millisecond(0));
    }).filter(value => value.isAfter(now)).sort((a, b) => a.valueOf() - b.valueOf());
    return candidates[0] || null;
}

async function sendPersonalSalawat(client: Client, userId: string, config: UserDMConfig) {
    const salawat = config.salawatConfig;
    if (!config.enabled || !salawat.enabled) return;
    const timezone = salawat.timezone || config.timezone || 'Africa/Casablanca';
    const now = moment().tz(timezone);
    let due = false;
    let nextRunAt: string | undefined;

    if (salawat.scheduleMode === 'fixed' && salawat.fixedTimes.length) {
        for (const time of salawat.fixedTimes) {
            const [hour, minute] = time.split(':').map(Number);
            const target = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
            const diff = now.diff(target, 'minutes');
            if (diff >= 0 && diff <= 1) due = true;
        }
        nextRunAt = nextFixedSalawat(now, salawat.fixedTimes)?.toISOString();
    } else {
        const target = salawat.nextRunAt ? moment(salawat.nextRunAt) : moment().subtract(1, 'minute');
        due = moment().isSameOrAfter(target);
        nextRunAt = moment().add(salawat.intervalHours || 4, 'hours').toISOString();
    }

    if (!due) return;
    const eventKey = `${now.format('YYYY-MM-DDTHH:mm')}:personal_salawat`;
    if (alreadySent(config, eventKey) || running.has(`${userId}:${eventKey}`)) return;
    running.add(`${userId}:${eventKey}`);
    try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return;
        const texts = loadSalawatTexts();
        const text = texts[Math.floor(Math.random() * texts.length)] || 'اللهم صل وسلم على نبينا محمد';
        const file = await tryBuildAttachment(() => generateSalawatImage(text), 'personal_salawat.png');
        const embed = new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setTitle(dmText('salawat_dm', config.language))
            .setDescription(file ? 'صلّوا وسلّموا على الحبيب المصطفى ﷺ' : `${text}\n\nصلّوا وسلّموا على الحبيب المصطفى ﷺ`)
            .setFooter({ text: BOT_FOOTER })
            .setTimestamp();
        if (file) embed.setImage('attachment://personal_salawat.png');
        const payload: Record<string, any> = { embeds: [embed] };
        if (file) payload.files = [file];
        await user.send(payload);
        await addDMSentEvent(userId, eventKey);
        await updateUserDMConfig(userId, { salawatConfig: { ...salawat, nextRunAt } });
        config.runtime = { ...config.runtime, sentEvents: [...(config.runtime?.sentEvents || []), eventKey].slice(-500) };
        config.salawatConfig.nextRunAt = nextRunAt;
    } catch (error) {
        logger.warn(`[DM Scheduler] Failed to send personal salawat to ${userId}: ${String(error)}`);
    } finally {
        running.delete(`${userId}:${eventKey}`);
    }
}
async function sendPersonalAdhan(client: Client, userId: string, config: UserDMConfig) {
    if (!config.enabled || !config.city) return;
    const meta = cityMeta(config.city);
    if (!meta) return;

    const timezone = config.timezone || meta.timezone || 'Africa/Casablanca';
    const schedule = await fetchPrayerTimes(meta.queryName || meta.nameEn, meta.country, meta.method);
    if (!schedule) return;

    const now = moment().tz(timezone);
    const date = now.format('YYYY-MM-DD');

    for (const prayer of PRAYERS) {
        const time = cleanTime(schedule.timings[prayer] || '');
        if (!time) continue;
        const [hour, minute] = time.split(':').map(Number);
        const target = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
        const diff = target.diff(now, 'minutes');

        const events: Array<{ key: 'warning' | 'adhan' | 'prayer_card'; due: boolean }> = [
            { key: 'warning', due: diff <= 5 && diff >= 4 },
            { key: 'adhan', due: diff <= 0 && diff >= -1 },
            { key: 'prayer_card', due: diff <= -15 && diff >= -16 },
        ];

        for (const event of events) {
            if (!config.adhanConfig.enabled || !config.adhanConfig.prayers[prayer] || !config.adhanConfig.events[event.key] || !event.due) continue;
            const eventKey = `${date}:personal_adhan:${config.city}:${prayer}:${event.key}`;
            if (alreadySent(config, eventKey) || running.has(`${userId}:${eventKey}`)) continue;

            running.add(`${userId}:${eventKey}`);
            try {
                const user = await client.users.fetch(userId).catch(() => null);
                if (!user) continue;
                const payload = await buildPersonalAdhanPayload(event.key, config, meta, prayer, time, schedule.timings);
                await user.send(payload);
                await addDMSentEvent(userId, eventKey);
                config.runtime = { ...config.runtime, sentEvents: [...(config.runtime?.sentEvents || []), eventKey].slice(-500) };
                const linkedCategory = event.key === 'adhan' ? 'أذكار الآذان' : event.key === 'prayer_card' ? 'أذكار بعد الصلاة' : null;
                if (linkedCategory) await sendPersonalAdhkarCategory(client, userId, config, linkedCategory, `${eventKey}:adhkar`);
            } catch (error) {
                logger.warn(`[DM Scheduler] Failed to send personal adhan to ${userId}: ${String(error)}`);
            } finally {
                running.delete(`${userId}:${eventKey}`);
            }
        }

        // These event-based adhkar are independent choices. They do not require
        // the user to enable the adhan message itself, only the adhkar category.
        if (prayer === 'Fajr') {
            const wakeupDiff = now.diff(target.clone().subtract(30, 'minutes'), 'minutes');
            if (wakeupDiff >= 0 && wakeupDiff <= 1) {
                await sendPersonalAdhkarCategory(client, userId, config, 'أذكار الاستيقاظ', `${date}:personal_wakeup:${config.city}`);
            }
        }
        const wuduDiff = now.diff(target.clone().add(5, 'minutes'), 'minutes');
        if (wuduDiff >= 0 && wuduDiff <= 1) {
            await sendPersonalAdhkarCategory(client, userId, config, 'أذكار الوضوء', `${date}:personal_wudu:${config.city}:${prayer}`);
        }
    }
}

/** Sends only categories explicitly enabled by this user and only at their
 * catalog-defined time. Categories without a schedule are never guessed. */
async function sendPersonalScheduledAdhkar(client: Client, userId: string, config: UserDMConfig) {
    if (!config.enabled) return;
    const timezone = config.timezone || 'Africa/Casablanca';
    const now = moment().tz(timezone);
    const minute = now.format('HH:mm');
    const date = now.format('YYYY-MM-DD');
    const categories = config.adhkarConfig.categories as Record<string, boolean>;

    for (const category of getAllAdhkarCategoryNames()) {
        if (categories[category.key] !== true || !category.defaultTime || category.defaultTime !== minute) continue;
        await sendPersonalAdhkarCategory(client, userId, config, category.key, `${date}:personal_adhkar:${category.key}:${minute}`);
    }
}

async function sendPersonalReminder(client: Client, userId: string, config: UserDMConfig, eventKey: string, title: string, description: string) {
    if (alreadySent(config, eventKey) || running.has(`${userId}:${eventKey}`)) return;
    running.add(`${userId}:${eventKey}`);
    try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return;
        await user.send({ embeds: [new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(title).setDescription(description).setFooter({ text: BOT_FOOTER }).setTimestamp()] });
        await addDMSentEvent(userId, eventKey);
        config.runtime = { ...config.runtime, sentEvents: [...(config.runtime?.sentEvents || []), eventKey].slice(-500) };
    } catch (error) {
        logger.warn(`[DM Scheduler] Failed to send personal reminder to ${userId}: ${String(error)}`);
    } finally {
        running.delete(`${userId}:${eventKey}`);
    }
}

async function sendPersonalQuranAndJumuah(client: Client, userId: string, config: UserDMConfig) {
    if (!config.enabled) return;
    const now = moment().tz(config.timezone || 'Africa/Casablanca');
    const date = now.format('YYYY-MM-DD');
    const minute = now.format('HH:mm');
    const quran = config.quranConfig;
    if (quran.enabled && minute === quran.reminderTime) {
        if (quran.dailyAyah) {
            const verse = DAILY_QURAN_VERSES[now.dayOfYear() % DAILY_QURAN_VERSES.length];
            await sendPersonalReminder(client, userId, config, `${date}:personal_quran_ayah`, 'آية اليوم', `${verse.text}\n\n﴿ ${verse.source} ﴾`);
        }
        if (quran.readingReminder) await sendPersonalReminder(client, userId, config, `${date}:personal_quran_reading`, 'تذكير بالورد القرآني', 'خصص دقائق من يومك لتلاوة القرآن الكريم ومراجعة وردك.');
        if (quran.kahf && now.isoWeekday() === 5) await sendPersonalReminder(client, userId, config, `${date}:personal_quran_kahf`, 'تذكير سورة الكهف', 'من سنن يوم الجمعة قراءة سورة الكهف والإكثار من الصلاة على النبي ﷺ.');
    }
    const jumuah = config.jumuahConfig;
    if (jumuah.enabled && now.isoWeekday() === 5 && minute === jumuah.reminderTime) {
        await sendPersonalReminder(client, userId, config, `${date}:personal_jumuah`, dmText('jumuah_dm', config.language), 'جمعة مباركة. أكثر من الصلاة على النبي ﷺ، واقرأ سورة الكهف، وتحَرَّ ساعة الإجابة.');
    }
}

export async function scanPersonalDMSchedules(client: Client): Promise<void> {
    const configs = await getAllDMUserConfigs();
    for (const { userId, config } of configs) {
        await sendPersonalAdhan(client, userId, config).catch(error => {
            logger.warn(`[DM Scheduler] User ${userId} scan failed: ${String(error)}`);
        });
        await sendPersonalSalawat(client, userId, config).catch(error => {
            logger.warn(`[DM Scheduler] User ${userId} salawat scan failed: ${String(error)}`);
        });
        await sendPersonalScheduledAdhkar(client, userId, config).catch(error => {
            logger.warn(`[DM Scheduler] User ${userId} adhkar scan failed: ${String(error)}`);
        });
        await sendPersonalQuranAndJumuah(client, userId, config).catch(error => {
            logger.warn(`[DM Scheduler] User ${userId} Quran/Jumuah scan failed: ${String(error)}`);
        });
    }
}

export function initPersonalDMScheduler(client: Client): void {
    scheduler?.stop();
    scheduler = cron.schedule('* * * * *', () => {
        void scanPersonalDMSchedules(client).catch(error => logger.error('[DM Scheduler] Scan failed:', error));
    });
    setTimeout(() => {
        void scanPersonalDMSchedules(client).catch(error => logger.error('[DM Scheduler] Startup scan failed:', error));
    }, 15_000).unref();
    logger.success('Personal DM scheduler initialized.');
}



