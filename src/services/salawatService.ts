import * as cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import moment from 'moment-timezone';
import { AttachmentBuilder, Client, EmbedBuilder } from 'discord.js';
import { generateSalawatImage } from './canvasService';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import {
    getAllSalawatV2Guilds, getSalawatV2Config, SalawatV2Config, saveSalawatV2Config,
} from './salawatConfigServiceV2';
import { sendAuditLog } from './auditLogService';
import { logger } from '../utils/logger';

interface SalawatRuntime {
    pool: number[];
    sentCount: number;
    lastSentAt?: string;
}

export interface SalawatStats {
    formulaCount: number;
    sentCount: number;
    lastSentAt?: string;
    nextRunAt?: string;
}

const RUNTIME_MODULE = 'salawatRuntimeV2';
const SALAWAT_FILE = path.join(process.cwd(), 'data', 'raw', 'salawat.txt');
const activeTimers = new Map<string, NodeJS.Timeout>();
const activeCrons = new Map<string, cron.ScheduledTask[]>();
const activeDmSends = new Set<string>();

export function loadSalawatTexts(): string[] {
    try {
        return fs.readFileSync(SALAWAT_FILE, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    } catch {
        return ['اللهم صل وسلم على نبينا محمد'];
    }
}

function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const pick = Math.floor(Math.random() * (index + 1));
        [result[index], result[pick]] = [result[pick], result[index]];
    }
    return result;
}

async function runtimeFor(guildId: string): Promise<SalawatRuntime> {
    return await getAdvancedConfig<SalawatRuntime>(guildId, RUNTIME_MODULE) || { pool: [], sentCount: 0 };
}

async function chooseText(guildId: string, consume: boolean): Promise<string> {
    const texts = loadSalawatTexts();
    if (!consume) return texts[Math.floor(Math.random() * texts.length)];
    const runtime = await runtimeFor(guildId);
    runtime.pool = runtime.pool.filter(index => index >= 0 && index < texts.length);
    if (!runtime.pool.length) runtime.pool = shuffle(texts.map((_, index) => index));
    const selected = runtime.pool.shift()!;
    await setAdvancedConfig(guildId, RUNTIME_MODULE, runtime);
    return texts[selected];
}

export async function buildSalawatPreview(guildId: string): Promise<{ text: string; image: any }> {
    const text = await chooseText(guildId, false);
    return { text, image: await generateSalawatImage(text) };
}

import { getRolesConfig } from './rolesConfigService';


export async function sendSalawatReminder(client: Client, guildId: string, channelId: string): Promise<boolean> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return false;
    const text = await chooseText(guildId, true);
    const image = await generateSalawatImage(text);
    
    let content = '';
    const rolesConfig = await getRolesConfig(guildId);
    if (rolesConfig.salawatRoleId) {
        content = `<@&${rolesConfig.salawatRoleId}>`;
    }

    try {
        const embed = new EmbedBuilder().setColor(0x2e8b57).setTitle('ﷺ الصلاة على النبي').setDescription('صلّوا وسلّموا على الحبيب المصطفى ﷺ').setImage('attachment://salawat.png').setTimestamp();
        const file = new AttachmentBuilder(image, { name: 'salawat.png' });
        await channel.send({
            content,
            embeds: [embed],
            files: [file],
            allowedMentions: { parse: ['roles'] },
        });
        // Personal Salawat DMs are scheduled from each user's DM settings.
        const runtime = await runtimeFor(guildId);
        runtime.sentCount = (runtime.sentCount || 0) + 1;
        runtime.lastSentAt = new Date().toISOString();
        await setAdvancedConfig(guildId, RUNTIME_MODULE, runtime);
        await sendAuditLog(client, guildId, { level: 'info', system: 'Salawat', action: 'Salawat reminder sent', details: `<#${channelId}> — الصيغة ${runtime.sentCount}` });
        return true;
    } catch (error) {
        logger.error(`[Salawat] Failed to send in ${channelId}:`, error);
        await sendAuditLog(client, guildId, { level: 'error', system: 'Salawat', action: 'Salawat reminder failed', details: `<#${channelId}>` });
        return false;
    }
}

function stopGuild(guildId: string) {
    const timer = activeTimers.get(guildId);
    if (timer) clearTimeout(timer);
    activeTimers.delete(guildId);
    for (const job of activeCrons.get(guildId) || []) job.stop();
    activeCrons.delete(guildId);
}

async function updateNextRun(guildId: string, config: SalawatV2Config, next: moment.Moment) {
    config.nextRunAt = next.toISOString();
    await saveSalawatV2Config(guildId, config);
}

async function scheduleInterval(client: Client, guildId: string, config: SalawatV2Config) {
    const now = moment();
    let next = config.nextRunAt ? moment(config.nextRunAt) : moment(config.anchorAt).add(config.intervalHours, 'hours');
    if (next.isSameOrBefore(now)) {
        await sendSalawatReminder(client, guildId, config.channelId);
        next = moment().add(config.intervalHours, 'hours');
        await updateNextRun(guildId, config, next);
    }
    const timer = setTimeout(async () => {
        const latest = await getSalawatV2Config(guildId);
        if (!latest?.enabled || latest.scheduleMode !== 'interval') return;
        await sendSalawatReminder(client, guildId, latest.channelId);
        latest.nextRunAt = moment().add(latest.intervalHours, 'hours').toISOString();
        await saveSalawatV2Config(guildId, latest);
        await scheduleInterval(client, guildId, latest);
    }, Math.max(1000, next.diff(moment(), 'milliseconds')));
    activeTimers.set(guildId, timer);
}

function fixedMoment(time: string, timezone: string, dayOffset = 0) {
    const [hour, minute] = time.split(':').map(Number);
    return moment().tz(timezone).add(dayOffset, 'days').hour(hour).minute(minute).second(0).millisecond(0);
}

function nextFixedRun(config: SalawatV2Config): moment.Moment {
    const now = moment().tz(config.timezone);
    const candidates = config.fixedTimes.flatMap(time => [fixedMoment(time, config.timezone, 0), fixedMoment(time, config.timezone, 1)])
        .filter(value => value.isAfter(now)).sort((a, b) => a.valueOf() - b.valueOf());
    return candidates[0] || now.clone().add(1, 'day');
}

async function scheduleFixed(client: Client, guildId: string, config: SalawatV2Config) {
    const runtime = await runtimeFor(guildId);
    const now = moment().tz(config.timezone);
    const anchor = moment(config.anchorAt);
    const candidates = config.fixedTimes.flatMap(time => [fixedMoment(time, config.timezone, -1), fixedMoment(time, config.timezone, 0)])
        .filter(value => value.isSameOrBefore(now) && value.isSameOrAfter(anchor)).sort((a, b) => b.valueOf() - a.valueOf());
    const latestMissed = candidates[0];
    if (latestMissed && (!runtime.lastSentAt || moment(runtime.lastSentAt).isBefore(latestMissed))) {
        await sendSalawatReminder(client, guildId, config.channelId);
    }
    const jobs = config.fixedTimes.map(time => {
        const [hour, minute] = time.split(':').map(Number);
        return cron.schedule(`${minute} ${hour} * * *`, async () => {
            const latest = await getSalawatV2Config(guildId);
            if (!latest?.enabled || latest.scheduleMode !== 'fixed') return;
            await sendSalawatReminder(client, guildId, latest.channelId);
            latest.nextRunAt = nextFixedRun(latest).toISOString();
            await saveSalawatV2Config(guildId, latest);
        }, { timezone: config.timezone });
    });
    activeCrons.set(guildId, jobs);
    await updateNextRun(guildId, config, nextFixedRun(config));
}

export async function rescheduleSalawatGuild(client: Client, guildId: string): Promise<void> {
    stopGuild(guildId);
    const config = await getSalawatV2Config(guildId);
    if (!config?.enabled) return;
    if (config.scheduleMode === 'fixed' && config.fixedTimes.length) await scheduleFixed(client, guildId, config);
    else await scheduleInterval(client, guildId, config);
}

export async function getSalawatStats(guildId: string): Promise<SalawatStats> {
    const runtime = await runtimeFor(guildId);
    const config = await getSalawatV2Config(guildId);
    return { formulaCount: loadSalawatTexts().length, sentCount: runtime.sentCount || 0, lastSentAt: runtime.lastSentAt, nextRunAt: config?.nextRunAt };
}

export function scheduleSalawatCron(client: Client, guildId: string, ..._legacy: any[]): void {
    rescheduleSalawatGuild(client, guildId).catch(error => logger.error('[Salawat] Reschedule failed:', error));
}

export async function initSalawatCrons(client: Client): Promise<void> {
    const guilds = await getAllSalawatV2Guilds();
    for (const entry of guilds) await rescheduleSalawatGuild(client, entry.guildId);
    logger.success(`📿 Initialized ${guilds.length} advanced Salawat systems.`);
}






