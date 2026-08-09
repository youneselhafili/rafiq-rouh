import axios from 'axios';
import * as cron from 'node-cron';
import moment from 'moment-timezone';
import { AttachmentBuilder, Client, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ALADHAN_API_BASE, BOT_FOOTER, COLORS, PRAYER_KEYS, PRAYER_NAMES } from '../utils/constants';
import { generateAdhanImage, generateAdhanWarningImage, generatePrayerCard } from './canvasService';
import { fetchYabiladiPrayerTimes } from './yabiladiService';
import { getAllManagedAdhanGuilds, ManagedAdhanZone } from './adhanZoneService';
import {
    auditAdhanAudienceRoles, getAdhanAudioConfig, playScheduledAdhan, resolveAdhanAudience,
    waitForScheduledAdhanCompletion,
} from './adhanAudioService';
import { sendAuditLog } from './auditLogService';
import { logger } from '../utils/logger';
import { handleJumuahPrayerBoundary, recoverJumuahVoiceWindow } from './jumuahService';
import hadiths from '../data/hadiths.json';
import cities from '../data/cities.json';

export interface PrayerTimings {
    Fajr: string;
    Sunrise: string;
    Dhuhr: string;
    Asr: string;
    Maghrib: string;
    Isha: string;
    [key: string]: string;
}

interface AladhanResponse {
    data: {
        timings: PrayerTimings;
        date: { hijri: { day: string; month: { ar: string }; year: string } };
    };
}

interface CityMeta {
    name: string;
    nameEn: string;
    country: string;
    countryAr: string;
    timezone: string;
    method: number;
    yabiladiId?: number;
    yabiladiSlug?: string;
}

export interface ZonePrayerSchedule {
    timings: PrayerTimings;
    hijriDate: string;
    city: CityMeta;
    source: 'yabiladi' | 'aladhan';
    fallbackUsed: boolean;
}

export interface NextPrayer {
    prayer: string;
    arabicName: string;
    time: string;
    at: string;
    minutes: number;
}

const scheduledTimeouts: NodeJS.Timeout[] = [];
const sentAdhanEvents = new Set<string>();
const cachedSchedules = new Map<string, { schedule: ZonePrayerSchedule; fetchedAt: number; localDate: string }>();
let scannerRunning = false;
let audienceAuditTimer: NodeJS.Timeout | null = null;
const ADHAN_VERSES = [
    { text: '\u0625\u0650\u0646\u0651\u064e \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u064e \u0643\u064e\u0627\u0646\u064e\u062a\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u0644\u0652\u0645\u064f\u0624\u0652\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u0643\u0650\u062a\u064e\u0627\u0628\u064b\u0627 \u0645\u064e\u0648\u0652\u0642\u064f\u0648\u062a\u064b\u0627', surah: '\u0627\u0644\u0646\u0633\u0627\u0621' },
    { text: '\u0648\u064e\u0623\u064e\u0642\u0650\u0645\u0650 \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u064e \u0625\u0650\u0646\u0651\u064e \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u064e \u062a\u064e\u0646\u0652\u0647\u064e\u0649 \u0639\u064e\u0646\u0650 \u0627\u0644\u0652\u0641\u064e\u062d\u0652\u0634\u064e\u0627\u0621\u0650 \u0648\u064e\u0627\u0644\u0652\u0645\u064f\u0646\u0643\u064e\u0631\u0650', surah: '\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a' },
    { text: '\u0648\u064e\u0627\u0633\u0652\u062a\u064e\u0639\u0650\u064a\u0646\u064f\u0648\u0627 \u0628\u0650\u0627\u0644\u0635\u0651\u064e\u0628\u0652\u0631\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u0650', surah: '\u0627\u0644\u0628\u0642\u0631\u0629' },
    { text: '\u062d\u064e\u0627\u0641\u0650\u0638\u064f\u0648\u0627 \u0639\u064e\u0644\u064e\u0649 \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u064e\u0627\u062a\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u0650 \u0627\u0644\u0652\u0648\u064f\u0633\u0652\u0637\u064e\u0649', surah: '\u0627\u0644\u0628\u0642\u0631\u0629' },
    { text: '\u0631\u064e\u0628\u0651\u0650 \u0627\u062c\u0652\u0639\u064e\u0644\u0652\u0646\u0650\u064a \u0645\u064f\u0642\u0650\u064a\u0645\u064e \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u0650 \u0648\u064e\u0645\u0650\u0646\u0652 \u0630\u064f\u0631\u0651\u0650\u064a\u0651\u064e\u062a\u0650\u064a', surah: '\u0625\u0628\u0631\u0627\u0647\u064a\u0645' },
];

function getCityMeta(cityNameEn: string): CityMeta | undefined {
    return (cities as CityMeta[]).find(city => city.nameEn === cityNameEn);
}

function cleanTime(value: string): string {
    return value.replace(/\s*\(.*\)/, '').trim();
}

export async function fetchPrayerTimes(city: string, country: string, method?: number): Promise<{ timings: PrayerTimings; hijriDate: string } | null> {
    try {
        const response = await axios.get<AladhanResponse>(`${ALADHAN_API_BASE}/timingsByCity`, {
            params: { city, country, method: method ?? 2 }, timeout: 15_000,
        });
        const hijri = response.data.data.date.hijri;
        return { timings: response.data.data.timings, hijriDate: `${hijri.day} ${hijri.month.ar} ${hijri.year} هـ` };
    } catch (error) {
        logger.error(`Failed to fetch prayer times for ${city}, ${country}:`, error);
        return null;
    }
}

export async function fetchZonePrayerSchedule(zone: ManagedAdhanZone): Promise<ZonePrayerSchedule | null> {
    const meta = getCityMeta(zone.city);
    if (!meta) return null;
    let fallbackUsed = false;
    if (meta.yabiladiId && meta.yabiladiSlug) {
        const timings = await fetchYabiladiPrayerTimes(meta.yabiladiId, meta.yabiladiSlug);
        if (timings) return { timings: { ...timings, Sunrise: '' } as PrayerTimings, hijriDate: `المغرب - ${meta.name}`, city: meta, source: 'yabiladi', fallbackUsed: false };
        fallbackUsed = true;
    }
    const result = await fetchPrayerTimes(meta.nameEn, meta.country, meta.method);
    return result ? { ...result, city: meta, source: 'aladhan', fallbackUsed } : null;
}

export async function getNextPrayerForZone(zone: ManagedAdhanZone): Promise<NextPrayer | null> {
    const schedule = await fetchZonePrayerSchedule(zone);
    if (!schedule) return null;
    const now = moment().tz(zone.timezone);
    for (const prayer of PRAYER_KEYS) {
        const time = cleanTime(schedule.timings[prayer] || '');
        if (!time) continue;
        const [hour, minute] = time.split(':').map(Number);
        const at = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
        if (at.isAfter(now)) {
            return {
                prayer, arabicName: PRAYER_NAMES[prayer] || prayer, time,
                at: at.toISOString(), minutes: Math.ceil(at.diff(now, 'milliseconds') / 60_000),
            };
        }
    }
    return null;
}

function msUntil(time: string, timezone: string): number {
    const [hour, minute] = cleanTime(time).split(':').map(Number);
    const now = moment().tz(timezone);
    return now.clone().hour(hour).minute(minute).second(0).millisecond(0).diff(now, 'milliseconds');
}

function zoneCacheKey(guildId: string, zone: ManagedAdhanZone): string {
    return `${guildId}:${zone.country}:${zone.city}:${zone.channelId}`;
}

function prayerMoment(time: string, timezone: string): moment.Moment | null {
    const clean = cleanTime(time);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean)) return null;
    const [hour, minute] = clean.split(':').map(Number);
    return moment().tz(timezone).hour(hour).minute(minute).second(0).millisecond(0);
}

function adhanEventKey(guildId: string, zone: ManagedAdhanZone, date: string, prayer: string, kind: 'warning' | 'adhan' | 'prayer_card'): string {
    return `${date}:${guildId}:${zone.country}:${zone.city}:${prayer}:${kind}`;
}

async function getCachedZoneSchedule(guildId: string, zone: ManagedAdhanZone): Promise<ZonePrayerSchedule | null> {
    const cacheKey = zoneCacheKey(guildId, zone);
    const localDate = moment().tz(zone.timezone).format('YYYY-MM-DD');
    const cached = cachedSchedules.get(cacheKey);
    if (cached && cached.localDate === localDate && Date.now() - cached.fetchedAt < 6 * 60 * 60 * 1000) return cached.schedule;
    const schedule = await fetchZonePrayerSchedule(zone);
    if (schedule) cachedSchedules.set(cacheKey, { schedule, fetchedAt: Date.now(), localDate });
    return schedule;
}

async function runAdhanEvent(
    client: Client,
    guildId: string,
    zone: ManagedAdhanZone,
    schedule: ZonePrayerSchedule,
    prayer: string,
    kind: 'warning' | 'adhan' | 'prayer_card',
    date: string,
): Promise<void> {
    const key = adhanEventKey(guildId, zone, date, prayer, kind);
    if (sentAdhanEvents.has(key)) return;
    sentAdhanEvents.add(key);
    try {
        if (kind === 'warning') await sendWarning(client, guildId, zone, schedule, prayer);
        else if (kind === 'prayer_card') await sendPrayerCard(client, guildId, zone, schedule);
        else await executePrayer(client, guildId, zone, schedule, prayer);
    } catch (error) {
        sentAdhanEvents.delete(key);
        throw error;
    }
}


function errorSummary(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function missingTextPermissions(channel: any, client: Client, mention: string): string[] {
    const me = channel.guild?.members.me || (client.user ? channel.guild?.members.cache.get(client.user.id) : null);
    const permissions = me && typeof channel.permissionsFor === 'function' ? channel.permissionsFor(me) : null;
    if (!permissions) return [];
    const checks: Array<[bigint, string]> = [
        [PermissionFlagsBits.ViewChannel, 'View Channel'],
        [PermissionFlagsBits.SendMessages, 'Send Messages'],
        [PermissionFlagsBits.AttachFiles, 'Attach Files'],
    ];
    if (mention === '@everyone') checks.push([PermissionFlagsBits.MentionEveryone, 'Mention @everyone']);
    return checks.filter(([flag]) => !permissions.has(flag)).map(([, label]) => label);
}

function buildTextFallbackEmbed(headline: string, payload: Record<string, any>, reason: string): EmbedBuilder {
    const embed = payload.embeds?.[0];
    const title = typeof embed?.data?.title === 'string' ? embed.data.title : headline;
    const description = typeof embed?.data?.description === 'string' ? embed.data.description : headline;
    return new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: `${BOT_FOOTER} • تم إرسال بطاقة نصية لأن الصورة تعذرت` })
        .setTimestamp();
}

function fallbackPlainText(headline: string, payload: Record<string, any>): string {
    const embed = payload.embeds?.[0];
    const title = typeof embed?.data?.title === 'string' ? embed.data.title : undefined;
    const description = typeof embed?.data?.description === 'string' ? embed.data.description : undefined;
    return [headline, title, description].filter(Boolean).join('\n').slice(0, 1900);
}

function splitMentions(mention: string): string[] {
    if (!mention.trim()) return [''];
    if (mention === '@everyone') return [mention];
    const chunks: string[] = [];
    let current = '';
    for (const token of mention.split(/\s+/)) {
        if (`${current} ${token}`.trim().length > 1750) {
            chunks.push(current.trim());
            current = token;
        } else current = `${current} ${token}`.trim();
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [''];
}


async function sendAudiencePayload(client: Client, guildId: string, channelId: string, headline: string, payload: Record<string, any>, zoneCity?: string) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
        await sendAuditLog(client, guildId, { level: 'error', system: 'Adhan', action: 'Text channel unavailable', details: `<#${channelId}>` });
        return;
    }
    
    let audience;
    try {
        const { getRolesConfig } = await import('./rolesConfigService');
        const rolesConfig = await getRolesConfig(guildId);
        
        const originalAudience = await resolveAdhanAudience(client, guildId);
        audience = {
            ...originalAudience,
            mention: rolesConfig.adhanRoleId ? `<@&${rolesConfig.adhanRoleId}>` : originalAudience.mention
        };
    } catch {
        audience = await resolveAdhanAudience(client, guildId);
    }
    
    const chunks = splitMentions(audience.mention);
    const allowedMentions = audience.mention === '@everyone'
        ? { parse: ['everyone'] as const }
        : { parse: ['roles', 'users'] as const, users: audience.userIds };
        
    const imagePayload = {
        files: payload.files || [],
    };
    const firstMention = chunks[0].trim();

    try {
        await channel.send({
            content: firstMention || undefined,
            ...imagePayload,
            allowedMentions,
        });
        for (const chunk of chunks.slice(1)) await channel.send({ content: chunk, allowedMentions });
        // Personal adhan DMs are handled by personalDmSchedulerService so each user
        // receives one clean image-based DM according to their own city settings.
    } catch (error) {
        const missing = missingTextPermissions(channel, client, audience.mention);
        const reason = errorSummary(error);
        logger.error(`[Adhan] Failed to send image notification in ${channelId}: ${reason}`, error);

        try {
            await channel.send({ embeds: [buildTextFallbackEmbed(headline, payload, reason)], allowedMentions: { parse: [] } });
            await sendAuditLog(client, guildId, {
                level: 'warning',
                system: 'Adhan',
                action: 'Text fallback sent instead of image',
                details: `تعذر إرسال صورة إشعار الأذان في <#${channelId}>، فتم إرسال بطاقة نصية صفراء بدل الصورة. السبب: ${reason}${missing.length ? `\nالصلاحيات الناقصة المحتملة: ${missing.join(', ')}` : ''}`,
            });
        } catch (fallbackError) {
            const fallbackReason = errorSummary(fallbackError);
            logger.error(`[Adhan] Failed to send text fallback notification in ${channelId}: ${fallbackReason}`, fallbackError);
            try {
                await channel.send({ content: fallbackPlainText(headline, payload), allowedMentions: { parse: [] } });
                await sendAuditLog(client, guildId, {
                    level: 'warning',
                    system: 'Adhan',
                    action: 'Plain text fallback sent',
                    details: `تعذر إرسال الصورة والبطاقة النصية في <#${channelId}>، فتم إرسال نص بسيط. سبب الصورة: ${reason}. سبب البطاقة: ${fallbackReason}${missing.length ? `\nالصلاحيات الناقصة المحتملة: ${missing.join(', ')}` : ''}`,
                });
            } catch (plainError) {
                const plainReason = errorSummary(plainError);
                logger.error(`[Adhan] Failed to send any notification in ${channelId}: ${plainReason}`, plainError);
                await sendAuditLog(client, guildId, {
                    level: 'error',
                    system: 'Adhan',
                    action: 'Notification failed',
                    details: `تعذر إرسال إشعار الأذان في <#${channelId}>. سبب الصورة: ${reason}. سبب البطاقة/النص: ${plainReason}${missing.length ? `\nالصلاحيات الناقصة المحتملة: ${missing.join(', ')}` : ''}`,
                });
            }
        }
    }
    return audience;
}

async function sendWarning(client: Client, guildId: string, zone: ManagedAdhanZone, schedule: ZonePrayerSchedule, prayer: string) {
    if ((await getAdhanAudioConfig(guildId)).mode === 'stopped') return;
    const prayerName = PRAYER_NAMES[prayer] || prayer;
    const time = cleanTime(schedule.timings[prayer]);
    const image = await generateAdhanWarningImage(schedule.city.name, schedule.city.countryAr, prayerName, time);
    const file = new AttachmentBuilder(image, { name: 'adhan_warning.png' });
    const embed = new EmbedBuilder().setColor(COLORS.WARNING).setTitle('\u23F0 \u0628\u0642\u064a\u062a 5 \u062f\u0642\u0627\u0626\u0642 \u0639\u0644\u0649 \u0627\u0644\u0623\u0630\u0627\u0646')
        .setDescription(`\uD83D\uDD4C **${prayerName}**\n\uD83D\uDCCD ${schedule.city.name} - ${schedule.city.countryAr}\n\uD83D\uDD50 \`${time}\``)
        .setImage('attachment://adhan_warning.png').setFooter({ text: BOT_FOOTER }).setTimestamp();
    await sendAudiencePayload(client, guildId, zone.channelId, `\uD83D\uDCCB \u0645\u0648\u0627\u0642\u064a\u062a \u0627\u0644\u0635\u0644\u0627\u0629 \u0641\u064a ${schedule.city.name}.`, { embeds: [embed], files: [file] }, schedule.city.nameEn);
    await sendAuditLog(client, guildId, { level: 'info', system: 'Adhan', action: '5-minute warning sent', details: `${schedule.city.name} - ${prayerName}` });
}

async function sendAdhanNotification(client: Client, guildId: string, zone: ManagedAdhanZone, schedule: ZonePrayerSchedule, prayer: string) {
    const prayerName = PRAYER_NAMES[prayer] || prayer;
    const time = cleanTime(schedule.timings[prayer]);
    const verse = ADHAN_VERSES[Math.floor(Math.random() * ADHAN_VERSES.length)];
    const hadith = hadiths[Math.floor(Math.random() * hadiths.length)];
    const image = await generateAdhanImage(schedule.city.name, schedule.city.countryAr, prayer, time, verse.text, verse.surah);
    const file = new AttachmentBuilder(image, { name: 'adhan.png' });
    const embed = new EmbedBuilder().setColor(COLORS.ADHAN).setTitle(`\uD83D\uDD4C \u0623\u0630\u0627\u0646 ${prayerName} - ${schedule.city.name}`)
        .setDescription(`\uD83D\uDCCD **${schedule.city.name}** - ${schedule.city.countryAr}\n\uD83D\uDD50 **\u0627\u0644\u0648\u0642\u062a:** \`${time}\`\n\n${hadith}`)
        .setImage('attachment://adhan.png').setFooter({ text: BOT_FOOTER }).setTimestamp();
    return sendAudiencePayload(client, guildId, zone.channelId, `\uD83D\uDD14 \u062d\u0627\u0646 \u0648\u0642\u062a \u0635\u0644\u0627\u0629 ${prayerName} \u0641\u064a ${schedule.city.name}.`, { embeds: [embed], files: [file] }, schedule.city.nameEn);
}

async function sendPrayerCard(client: Client, guildId: string, zone: ManagedAdhanZone, schedule: ZonePrayerSchedule) {
    if ((await getAdhanAudioConfig(guildId)).mode === 'stopped') return;
    const timings = schedule.timings;
    const image = await generatePrayerCard(schedule.city.name, cleanTime(timings.Fajr), cleanTime(timings.Dhuhr), cleanTime(timings.Asr), cleanTime(timings.Maghrib), cleanTime(timings.Isha));
    const file = new AttachmentBuilder(image, { name: 'prayer_times.png' });
    const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(`\uD83D\uDCCB \u0645\u0648\u0627\u0642\u064a\u062a \u0627\u0644\u0635\u0644\u0627\u0629 - ${schedule.city.name}`)
        .setDescription(`\uD83D\uDCCD ${schedule.city.name} - ${schedule.city.countryAr}\n\uD83D\uDCC5 ${schedule.hijriDate}`)
        .setImage('attachment://prayer_times.png').setFooter({ text: BOT_FOOTER }).setTimestamp();
    await sendAudiencePayload(client, guildId, zone.channelId, `\uD83D\uDCCB \u0645\u0648\u0627\u0642\u064a\u062a \u0627\u0644\u0635\u0644\u0627\u0629 \u0641\u064a ${schedule.city.name}.`, { embeds: [embed], files: [file] }, schedule.city.nameEn);
}


async function executePrayer(client: Client, guildId: string, zone: ManagedAdhanZone, schedule: ZonePrayerSchedule, prayer: string) {
    if (prayer === 'Dhuhr') {
        await handleJumuahPrayerBoundary(client, guildId, zone, prayer, 'before');
    }
    const config = await getAdhanAudioConfig(guildId);
    if (config.mode === 'stopped') {
        if (prayer === 'Fajr') await handleJumuahPrayerBoundary(client, guildId, zone, prayer, 'after');
        return;
    }
    const audience = await sendAdhanNotification(client, guildId, zone, schedule, prayer);
    let audio = { played: false, reason: 'notification_only' } as { played: boolean; reason?: string; file?: string };
    if (config.mode === 'voice_notification' && audience?.voiceChannel) {
        audio = await playScheduledAdhan(client, guildId, audience.voiceChannel, prayer);
    } else if (config.mode === 'voice_notification') audio.reason = 'no_eligible_voice_channel';
    if (prayer === 'Fajr') {
        // A nearby zone may have claimed the single voice adhan first; never cut it off with Al-Kahf.
        await waitForScheduledAdhanCompletion(guildId);
        await handleJumuahPrayerBoundary(client, guildId, zone, prayer, 'after');
    }
    await sendAuditLog(client, guildId, {
        level: audio.reason === 'missing_permissions' || audio.reason === 'audio_missing' ? 'error' : 'info',
        system: 'Adhan', action: 'Prayer event completed',
        details: `${schedule.city.name} \u2014 ${PRAYER_NAMES[prayer] || prayer} \u2014 \u0627\u0644\u0635\u0648\u062a: ${audio.played ? audio.file : audio.reason}`,
    });
}

async function scheduleZone(client: Client, guildId: string, zone: ManagedAdhanZone) {
    const schedule = await getCachedZoneSchedule(guildId, zone);
    if (!schedule) {
        await sendAuditLog(client, guildId, { level: 'error', system: 'Adhan', action: 'Prayer API failed', details: `${zone.city}, ${zone.country}` });
        return;
    }
    await recoverJumuahVoiceWindow(client, guildId, zone, schedule).catch(error => {
        logger.error(`[Jumuah] Friday voice recovery failed for ${guildId}:`, error);
    });
    for (const prayer of PRAYER_KEYS) {
        const target = prayerMoment(schedule.timings[prayer] || '', zone.timezone);
        if (!target) continue;
        const delay = target.diff(moment().tz(zone.timezone), 'milliseconds');
        if (delay <= 0) continue;
        const date = target.format('YYYY-MM-DD');
        if (delay > 5 * 60 * 1000) {
            scheduledTimeouts.push(setTimeout(() => runAdhanEvent(client, guildId, zone, schedule, prayer, 'warning', date).catch(() => {}), delay - 5 * 60 * 1000));
        }
        scheduledTimeouts.push(setTimeout(() => runAdhanEvent(client, guildId, zone, schedule, prayer, 'adhan', date).catch(error => logger.error('[Adhan] Prayer event failed:', error)), delay));
        scheduledTimeouts.push(setTimeout(() => runAdhanEvent(client, guildId, zone, schedule, prayer, 'prayer_card', date).catch(() => {}), delay + 15 * 60 * 1000));
    }
}


async function scanDueAdhanEvents(client: Client): Promise<void> {
    if (scannerRunning) return;
    scannerRunning = true;
    try {
        const guilds = await getAllManagedAdhanGuilds();
        for (const guild of guilds) {
            for (const zone of guild.zones) {
                const schedule = await getCachedZoneSchedule(guild.guildId, zone);
                if (!schedule) continue;
                const now = moment().tz(zone.timezone);
                const date = now.format('YYYY-MM-DD');
                for (const prayer of PRAYER_KEYS) {
                    const target = prayerMoment(schedule.timings[prayer] || '', zone.timezone);
                    if (!target) continue;
                    const minutesToPrayer = target.diff(now, 'minutes');
                    const minutesAfterPrayerCard = now.diff(target.clone().add(15, 'minutes'), 'minutes');

                    if (minutesToPrayer <= 5 && minutesToPrayer >= 3) {
                        await runAdhanEvent(client, guild.guildId, zone, schedule, prayer, 'warning', date).catch(error => logger.warn(`[Adhan] Warning scan failed: ${String(error)}`));
                    }
                    if (minutesToPrayer <= 0 && minutesToPrayer >= -2) {
                        await runAdhanEvent(client, guild.guildId, zone, schedule, prayer, 'adhan', date).catch(error => logger.warn(`[Adhan] Prayer scan failed: ${String(error)}`));
                    }
                    if (minutesAfterPrayerCard >= 0 && minutesAfterPrayerCard <= 2) {
                        await runAdhanEvent(client, guild.guildId, zone, schedule, prayer, 'prayer_card', date).catch(error => logger.warn(`[Adhan] Prayer card scan failed: ${String(error)}`));
                    }
                }
            }
        }
    } finally {
        scannerRunning = false;
    }
}
function clearScheduledTimeouts() {
    for (const timeout of scheduledTimeouts) clearTimeout(timeout);
    scheduledTimeouts.length = 0;
}

async function refreshAllSchedules(client: Client) {
    clearScheduledTimeouts();
    const guilds = await getAllManagedAdhanGuilds();
    for (const guild of guilds) for (const zone of guild.zones) await scheduleZone(client, guild.guildId, zone);
    logger.success(`Refreshed prayer schedules for ${guilds.length} guilds.`);
}

export function initAdhanCrons(client: Client): void {
    refreshAllSchedules(client).catch(error => logger.error('[Adhan] Initial schedule failed:', error));
    cron.schedule('1 0 * * *', () => refreshAllSchedules(client).catch(error => logger.error('[Adhan] Daily refresh failed:', error)));
    cron.schedule('* * * * *', () => scanDueAdhanEvents(client).catch(error => logger.error('[Adhan] Recovery scan failed:', error)));
    setTimeout(() => scanDueAdhanEvents(client).catch(error => logger.error('[Adhan] Startup recovery scan failed:', error)), 20_000).unref();
    if (!audienceAuditTimer) audienceAuditTimer = setInterval(() => auditAdhanAudienceRoles(client).catch(() => {}), 60 * 60 * 1000);
    logger.success('Adhan cron system initialized.');
}

export async function scheduleNewCity(client: Client, channelId: string, cityNameEn: string, country: string, timezone: string): Promise<void> {
    await scheduleZone(client, client.guilds.cache.find(guild => guild.channels.cache.has(channelId))?.id || '', {
        channelId, city: cityNameEn, country, timezone, enabled: true, createdAt: new Date().toISOString(),
    });
}

export async function scheduleAdhanForGuild(_guildId: string, client: Client): Promise<void> {
    await refreshAllSchedules(client);
}


















