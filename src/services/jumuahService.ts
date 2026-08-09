import * as cron from 'node-cron';
import moment from 'moment-timezone';
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client,
} from 'discord.js';
import { generateJumuahKahfImage } from './canvasService';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { getAllJumuahV2Guilds, getJumuahV2Config, JumuahV2Config } from './jumuahConfigServiceV2';
import { getAdhkarV2Config } from './adhkarConfigServiceV2';
import { getAllReciters, getReciterById } from '../quran/quranRegistry';
import { getPrimaryAdhanZone, ManagedAdhanZone } from './adhanZoneService';
import type { ZonePrayerSchedule } from './adhanService';
import {
    isFridayKahfLoopActive, startFridayKahfLoop, stopFridayKahfLoop,
} from './quranRadioServiceV2';
import { sendAuditLog } from './auditLogService';
import { logger } from '../utils/logger';
import { getRolesConfig } from './rolesConfigService';
import { getSubscribedUsers, getUserDMConfig } from './dmSubscriptionService';
import { dmText } from './dmLocalizationService';

const JUMUAH_QUOTES = [
    'اللهم في يوم الجمعة ارحم من ضَمّه التراب، واشفِ من أنهكه الوجع، وأغِث من أثقله الهم، واهدِ من غرته الدنيا.',
    'يوم الجمعة لحظات مباركة؛ أكثروا من الصلاة على النبي ﷺ، واقرؤوا سورة الكهف بقلب حاضر.',
    'اللهم في يوم الجمعة اجعلنا ممن عفوت عنهم، ورضيت عنهم، وغفرت لهم، وكتبت لهم الجنة.',
    'اغتنموا يوم الجمعة بالدعاء والذكر والصلاة على النبي ﷺ وقراءة سورة الكهف.',
    'اللهم صل وسلم وبارك على نبينا محمد ﷺ.',
];

interface JumuahRuntime {
    reciterPool: string[];
    quotePool: number[];
    sentDates: string[];
    totalSent: number;
    lastSentAt?: string;
    lastReciterId?: string;
    lastError?: string;
}

export interface JumuahStats {
    totalSent: number;
    lastSentAt?: string;
    lastReciterName?: string;
    lastError?: string;
}

export interface JumuahPreview {
    image: any;
    quote: string;
    reciterId: string;
    reciterName: string;
}

const RUNTIME_MODULE = 'jumuahRuntimeV2';
const CATCH_UP_MINUTES = 6 * 60;
const runningGuilds = new Set<string>();
let scheduler: ReturnType<typeof cron.schedule> | undefined;

function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function availableReciterIds(): string[] {
    return getAllReciters()
        .filter(reciter => reciter.surahs[17]?.url)
        .map(reciter => reciter.id);
}

async function loadRuntime(guildId: string): Promise<JumuahRuntime> {
    return await getAdvancedConfig<JumuahRuntime>(guildId, RUNTIME_MODULE) || {
        reciterPool: [],
        quotePool: [],
        sentDates: [],
        totalSent: 0,
    };
}

async function saveRuntime(guildId: string, runtime: JumuahRuntime): Promise<void> {
    runtime.sentDates = runtime.sentDates.slice(-60);
    await setAdvancedConfig(guildId, RUNTIME_MODULE, runtime);
}

function peekReciter(runtime: JumuahRuntime): string | undefined {
    const available = new Set(availableReciterIds());
    const existing = runtime.reciterPool.find(id => available.has(id));
    if (existing) return existing;
    return shuffle([...available])[0];
}

function takeReciter(runtime: JumuahRuntime): string | undefined {
    const available = new Set(availableReciterIds());
    runtime.reciterPool = runtime.reciterPool.filter(id => available.has(id));
    if (!runtime.reciterPool.length) {
        runtime.reciterPool = shuffle([...available]);
        if (runtime.reciterPool.length > 1 && runtime.reciterPool[0] === runtime.lastReciterId) {
            [runtime.reciterPool[0], runtime.reciterPool[1]] = [runtime.reciterPool[1], runtime.reciterPool[0]];
        }
    }
    return runtime.reciterPool.shift();
}

function takeQuote(runtime: JumuahRuntime): string {
    runtime.quotePool = runtime.quotePool.filter(index => index >= 0 && index < JUMUAH_QUOTES.length);
    if (!runtime.quotePool.length) runtime.quotePool = shuffle(JUMUAH_QUOTES.map((_, index) => index));
    return JUMUAH_QUOTES[runtime.quotePool.shift()!];
}

export function scheduledOccurrence(config: JumuahV2Config, now = moment()): { date: string; target: moment.Moment } | null {
    if (!moment.tz.zone(config.timezone) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.time)) return null;
    const local = now.clone().tz(config.timezone);
    const [hour, minute] = config.time.split(':').map(Number);
    let target = local.clone().hour(hour).minute(minute).second(0).millisecond(0);
    if (local.isoWeekday() === 6 && local.diff(target.clone().subtract(1, 'day'), 'minutes') <= CATCH_UP_MINUTES) {
        target = target.subtract(1, 'day');
    } else if (local.isoWeekday() !== 5) {
        return null;
    }
    const elapsed = local.diff(target, 'minutes');
    if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) return null;
    return { date: target.format('YYYY-MM-DD'), target };
}

export function nextJumuahRun(config: JumuahV2Config, now = moment()): moment.Moment {
    const local = now.clone().tz(config.timezone);
    const [hour, minute] = config.time.split(':').map(Number);
    let next = local.clone().isoWeekday(5).hour(hour).minute(minute).second(0).millisecond(0);
    if (!next.isAfter(local)) next = next.add(1, 'week');
    return next;
}

async function resolveAdhkarChannel(client: Client, guildId: string, fallbackChannelId: string) {
    const adhkar = await getAdhkarV2Config(guildId);
    const channelId = adhkar?.generalChannelId || fallbackChannelId;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return { channel, channelId };
}

export async function buildJumuahPreview(guildId: string): Promise<JumuahPreview> {
    const runtime = await loadRuntime(guildId);
    const reciters = availableReciterIds();
    if (!reciters.length) throw new Error('\u0644\u0627 \u064a\u0648\u062c\u062f \u0642\u0627\u0631\u0626 \u0645\u062a\u0627\u062d \u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641.');
    const quoteIndex = runtime.quotePool.find(index => index >= 0 && index < JUMUAH_QUOTES.length);
    const quote = JUMUAH_QUOTES[quoteIndex ?? 0];
    const allRecitersLabel = `\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621 \u2022 ${reciters.length} \u062a\u0644\u0627\u0648\u0627\u062a`;
    return {
        image: await generateJumuahKahfImage(quote, allRecitersLabel),
        quote,
        reciterId: 'all',
        reciterName: allRecitersLabel,
    };
}

export async function getJumuahStats(guildId: string): Promise<JumuahStats> {
    const runtime = await loadRuntime(guildId);
    return {
        totalSent: runtime.totalSent || 0,
        lastSentAt: runtime.lastSentAt,
        lastReciterName: runtime.lastReciterId ? getReciterById(runtime.lastReciterId)?.name : undefined,
        lastError: runtime.lastError,
    };
}

async function executeJumuah(client: Client, guildId: string, config: JumuahV2Config, date: string): Promise<void> {
    if (runningGuilds.has(guildId)) return;
    runningGuilds.add(guildId);
    try {
        const runtime = await loadRuntime(guildId);
        if (runtime.sentDates.includes(date)) return;
        const reciterIds = availableReciterIds();
        if (!reciterIds.length) throw new Error('No reciter with Surat Al-Kahf is available.');
        const quote = takeQuote(runtime);
        const allRecitersLabel = `\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621 \u2022 ${reciterIds.length} \u062a\u0644\u0627\u0648\u0627\u062a`;
        const image = await generateJumuahKahfImage(quote, allRecitersLabel);
        const { channel, channelId } = await resolveAdhkarChannel(client, guildId, config.channelId);
        if (!channel?.isTextBased() || !('send' in channel)) throw new Error(`Adhkar text channel ${channelId} is unavailable.`);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('\u0642\u0631\u0627\u0621\u0629 \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641')
                .setEmoji('\u{1F4D6}')
                .setURL('https://quran.com/18'),
        );
        const rolesConfig = await getRolesConfig(guildId);
        const content = rolesConfig.jumuahRoleId ? `<@&${rolesConfig.jumuahRoleId}>\n` : '@everyone\n';

        const msgContent = `${content}\u{1F31F} **\u062c\u0645\u0639\u0629 \u0645\u0628\u0627\u0631\u0643\u0629**\n` +
            `\u{1F3A7} \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u0641\u064a \u0627\u0644\u0642\u0646\u0627\u0629 \u0627\u0644\u0635\u0648\u062a\u064a\u0629 \u0628\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621\u060c \u0641\u064a Loop \u0645\u0646 \u0628\u0639\u062f \u0627\u0644\u0641\u062c\u0631 \u062d\u062a\u0649 \u0623\u0630\u0627\u0646 \u0627\u0644\u0638\u0647\u0631.`;
        const file = new AttachmentBuilder(image, { name: 'surat-al-kahf-friday.png' });

        await channel.send({
            content: msgContent,
            files: [file],
            components: [row],
            allowedMentions: { parse: rolesConfig.jumuahRoleId ? ['roles'] : ['everyone'] },
        });

        const dmUsers = await getSubscribedUsers('jumuah');
        for (const userId of dmUsers) {
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) continue;
            const config = await getUserDMConfig(userId);
            await user.send({ content: `${dmText('jumuah_dm', config.language)}:\n${msgContent}`, files: [file], components: [row] }).catch(() => {});
        }

        runtime.sentDates.push(date);
        runtime.totalSent = (runtime.totalSent || 0) + 1;
        runtime.lastSentAt = new Date().toISOString();
        runtime.lastReciterId = undefined;
        runtime.lastError = undefined;
        await saveRuntime(guildId, runtime);

        await sendAuditLog(client, guildId, {
            level: 'success',
            system: 'Jumuah',
            action: 'Friday Surat Al-Kahf card sent',
            details: `<#${channelId}> \u2014 ${reciterIds.length} reciters \u2014 voice window: ${config.playKahfVoice ? 'Fajr to Dhuhr enabled' : 'disabled'}.`,
        });
        logger.success(`[Jumuah] Sent Surat Al-Kahf card for ${guildId}; ${reciterIds.length} reciters available.`);
    } catch (error) {
        const runtime = await loadRuntime(guildId);
        runtime.lastError = error instanceof Error ? error.message : String(error);
        await saveRuntime(guildId, runtime);
        await sendAuditLog(client, guildId, {
            level: 'error',
            system: 'Jumuah',
            action: 'Friday system failed',
            details: runtime.lastError,
        }).catch(() => {});
        logger.error(`[Jumuah] Friday execution failed for ${guildId}:`, error);
    } finally {
        runningGuilds.delete(guildId);
    }
}

function sameAdhanZone(left: ManagedAdhanZone, right: ManagedAdhanZone): boolean {
    return left.city === right.city && left.country === right.country;
}

function prayerMoment(local: moment.Moment, value: string): moment.Moment | null {
    const clean = value.replace(/\s*\(.*\)/, '').trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean)) return null;
    const [hour, minute] = clean.split(':').map(Number);
    return local.clone().hour(hour).minute(minute).second(0).millisecond(0);
}

async function fridayVoiceContext(guildId: string, zone: ManagedAdhanZone) {
    const config = await getJumuahV2Config(guildId);
    const primary = await getPrimaryAdhanZone(guildId);
    if (!config || config.deleted || !primary || !sameAdhanZone(primary, zone)) return null;
    const timezone = moment.tz.zone(primary.timezone) ? primary.timezone : config.timezone;
    const local = moment().tz(timezone);
    return { config, local };
}

export async function handleJumuahPrayerBoundary(
    client: Client,
    guildId: string,
    zone: ManagedAdhanZone,
    prayer: string,
    phase: 'before' | 'after',
): Promise<void> {
    if (prayer !== 'Fajr' && prayer !== 'Dhuhr') return;
    const context = await fridayVoiceContext(guildId, zone);
    if (!context) return;
    const { config, local } = context;

    if (prayer === 'Dhuhr' && phase === 'before') {
        if (isFridayKahfLoopActive(guildId)) {
            await stopFridayKahfLoop(client, guildId, 'dhuhr_adhan');
        }
        return;
    }
    if (prayer !== 'Fajr' || phase !== 'after') return;
    if (!config.enabled || !config.playKahfVoice || local.isoWeekday() !== 5) return;

    const dateKey = local.format('YYYY-MM-DD');
    const started = await startFridayKahfLoop(client, guildId, dateKey);
    if (!started) {
        await sendAuditLog(client, guildId, {
            level: 'error', system: 'Jumuah', action: 'Friday Al-Kahf loop could not start',
            details: 'Fajr boundary reached, but the configured Quran voice channel or Al-Kahf audio was unavailable.',
        });
    }
}

export async function recoverJumuahVoiceWindow(
    client: Client,
    guildId: string,
    zone: ManagedAdhanZone,
    schedule: ZonePrayerSchedule,
): Promise<void> {
    const context = await fridayVoiceContext(guildId, zone);
    if (!context) return;
    const { config, local } = context;
    if (local.isoWeekday() !== 5) return;

    const fajr = prayerMoment(local, schedule.timings.Fajr || '');
    const dhuhr = prayerMoment(local, schedule.timings.Dhuhr || '');
    if (!fajr || !dhuhr) return;

    if (local.isSameOrAfter(fajr) && local.isBefore(dhuhr)) {
        if (config.enabled && config.playKahfVoice) {
            await startFridayKahfLoop(client, guildId, local.format('YYYY-MM-DD'));
        }
    } else if (local.isSameOrAfter(dhuhr) && isFridayKahfLoopActive(guildId)) {
        await stopFridayKahfLoop(client, guildId, 'startup_after_dhuhr');
    }
}
export async function scanJumuahSchedules(client: Client): Promise<void> {
    for (const { guildId, config } of await getAllJumuahV2Guilds()) {
        if (!config.enabled || config.deleted) continue;
        const occurrence = scheduledOccurrence(config);
        if (!occurrence) continue;
        await executeJumuah(client, guildId, config, occurrence.date);
    }
}

export async function sendJumuahBlessings(client: Client): Promise<void> {
    await scanJumuahSchedules(client);
}

export function initJumuahCron(client: Client): void {
    scheduler?.stop();
    scheduler = cron.schedule('* * * * *', () => {
        void scanJumuahSchedules(client).catch(error => logger.error('[Jumuah] Scheduler scan failed:', error));
    });
    const startupTimer = setTimeout(() => {
        void scanJumuahSchedules(client).catch(error => logger.error('[Jumuah] Startup recovery failed:', error));
    }, 10_000);
    startupTimer.unref();
    logger.success('🌟 Jumuah scheduler initialized (timezone-safe, duplicate-safe, 6h recovery).');
}

export async function refreshJumuahGuild(guildId: string): Promise<JumuahV2Config | null> {
    return getJumuahV2Config(guildId);
}


