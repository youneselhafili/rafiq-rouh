import * as cron from 'node-cron';
import moment from 'moment-timezone';
import { AttachmentBuilder, Client, EmbedBuilder } from 'discord.js';
import { AdhkarItem } from '../types';
import { BOT_FOOTER, COLORS, PRAYER_KEYS, PRAYER_NAMES } from '../utils/constants';
import { getAdhkarByKey, getAdhkarCategory, getAllAdhkarCategoryNames } from './contentService';
import { generateAdaptiveAdhkarImages, generateNamesGridImage } from './adhkarImageService';
import { AdhkarV2Config, getAdhkarV2Config, getAllAdhkarV2Guilds } from './adhkarConfigServiceV2';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { getManagedAdhanZones, ManagedAdhanZone } from './adhanZoneService';
import { fetchZonePrayerSchedule } from './adhanService';
import { sendAuditLog } from './auditLogService';
import { logger } from '../utils/logger';

interface GapPlan { at: string; category: string }
interface AdhkarRuntime {
    pools: Record<string, string[]>;
    namesPool: string[];
    categoryPool: string[];
    sentEvents: string[];
    gapPlans: Record<string, GapPlan>;
}

export interface AdhkarPreviewResult {
    type: string;
    title: string;
    buffers: any[];
    itemCount: number;
}

const RUNTIME_MODULE = 'adhkarRuntimeV2';
const activeCronJobs = new Map<string, cron.ScheduledTask[]>();
const activeTimers = new Map<string, NodeJS.Timeout[]>();
const pendingEvents = new Set<string>();
const CORE_TYPES: Record<string, string> = { 'أذكار الصباح': '06:00', 'أذكار المساء': '18:00' };
const PRAYER_ADHKAR = 'أذكار الآذان';
const WUDU_ADHKAR = 'أذكار الوضوء';
const FRIDAY_ADHKAR = 'أذكار يوم الجمعة';
const WAKEUP_ADHKAR = 'أذكار الاستيقاظ';
const SLEEP_ADHKAR = 'أذكار النوم';
const SPECIAL_TYPES = new Set([...Object.keys(CORE_TYPES), PRAYER_ADHKAR, WUDU_ADHKAR, FRIDAY_ADHKAR, WAKEUP_ADHKAR, SLEEP_ADHKAR]);

const ALLAH_NAMES_CATEGORY = 'أسماء الله الحسنى';

function emptyRuntime(): AdhkarRuntime {
    return { pools: {}, namesPool: [], categoryPool: [], sentEvents: [], gapPlans: {} };
}

async function runtimeFor(guildId: string): Promise<AdhkarRuntime> {
    const runtime = { ...emptyRuntime(), ...(await getAdvancedConfig<AdhkarRuntime>(guildId, RUNTIME_MODULE) || {}) };
    const validCategories = new Set(getAllAdhkarCategoryNames().map(category => category.key));
    runtime.categoryPool = runtime.categoryPool.filter(category => validCategories.has(category));
    runtime.pools = Object.fromEntries(Object.entries(runtime.pools).filter(([category]) => validCategories.has(category)));
    runtime.gapPlans = Object.fromEntries(Object.entries(runtime.gapPlans).filter(([, plan]) => validCategories.has(plan.category)));
    return runtime;
}

async function saveRuntime(guildId: string, runtime: AdhkarRuntime) {
    runtime.sentEvents = runtime.sentEvents.slice(-1000);
    const oldest = moment().subtract(3, 'days');
    runtime.gapPlans = Object.fromEntries(Object.entries(runtime.gapPlans).filter(([, plan]) => moment(plan.at).isAfter(oldest)));
    await setAdvancedConfig(guildId, RUNTIME_MODULE, runtime);
}

function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const pick = Math.floor(Math.random() * (index + 1));
        [result[index], result[pick]] = [result[pick], result[index]];
    }
    return result;
}

function normalized(text: string): string {
    return text.normalize('NFD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

export function getAdhkar(type: string): AdhkarItem[] {
    const category = getAdhkarCategory(type);
    const items = getAdhkarByKey(type);
    const key = normalized(type);
    const name = normalized(category?.name || type);
    return items.filter((item, index) => {
        const value = normalized(item.text);
        if (!value || item.text.trim().length < 2) return false;
        if (value === key || value === name) return false;
        if (index === 0 && (value.startsWith('قائمة الاذكار المتوفرة') || value === name)) return false;
        return true;
    });
}

export function getAdhkarTypeName(type: string): string {
    return getAdhkarCategory(type)?.name || type;
}

export function getAdhkarEmoji(type: string): string {
    return getAdhkarCategory(type)?.emoji || '📿';
}

function categoryEnabled(config: AdhkarV2Config, type: string): boolean {
    return config.enabled && config.categories[type] === 'enabled';
}

async function drawItem(guildId: string, type: string, consume = true): Promise<{ item?: AdhkarItem; names?: string[]; namesPage?: number; namesTotalPages?: number }> {
    if (type === ALLAH_NAMES_CATEGORY) {
        // The 99 names come from data/raw/أدعية و أذكار/أسماء الله الحسنى.txt.
        // Keeping them in TXT makes the raw database the single source of truth.
        const allNames = getAdhkar(ALLAH_NAMES_CATEGORY).map(item => item.text.trim()).filter(Boolean);
        if (!allNames.length) return {};
        const runtime = await runtimeFor(guildId);
        runtime.namesPool = runtime.namesPool.filter(name => allNames.includes(name));
        if (runtime.namesPool.length < 9) runtime.namesPool = shuffle(allNames);
        const names = consume ? runtime.namesPool.splice(0, 9) : runtime.namesPool.slice(0, 9);
        const totalPages = Math.ceil(allNames.length / 9);
        const page = Math.max(1, Math.ceil((allNames.length - runtime.namesPool.length) / 9));
        if (consume) await saveRuntime(guildId, runtime);
        return { names, namesPage: page, namesTotalPages: totalPages };
    }
    const items = getAdhkar(type);
    if (!items.length) return {};
    if (!consume) return { item: items[Math.floor(Math.random() * items.length)] };
    const runtime = await runtimeFor(guildId);
    const validIds = new Set(items.map(item => item.id));
    runtime.pools[type] = (runtime.pools[type] || []).filter(id => validIds.has(id));
    if (!runtime.pools[type].length) runtime.pools[type] = shuffle(items.map(item => item.id));
    const id = runtime.pools[type].shift()!;
    await saveRuntime(guildId, runtime);
    return { item: items.find(item => item.id === id) || items[0] };
}

export function describeAdhkarItem(item: AdhkarItem, type: string): string {
    const details: string[] = [];
    const [itemTitle] = item.text.split(/\n\s*\n/, 1);
    if (item.text.includes('\n\n') && itemTitle.trim()) details.push(`🏷️ **النوع:** ${itemTitle.trim()}`);

    const metadata = (item.source || '').split(/\s*•\s*/).map(value => value.trim()).filter(Boolean);
    const explicitSource = metadata.find(value => /^المصدر\s*:/.test(value));
    const virtues = metadata.filter(value => /^الفضل\s*:/.test(value));

    if (explicitSource) {
        details.push(`📚 **${explicitSource}**`);
    } else {
        const bracketReferences = [...item.text.matchAll(/\[([^\]]+)\]/gu)].map(match => match[1].trim());
        const hadithNames = /البخاري|مسلم|أبو داود|الترمذي|النسائي|ابن ماجه|أحمد|الألباني|متفق عليه/u;
        const quranReference = bracketReferences.find(reference =>
            !hadithNames.test(reference) && /(?:سورة|الآية|[\p{Script=Arabic}]+\s*[-:]\s*\d)/u.test(reference),
        );
        const hadithReference = bracketReferences.find(reference => hadithNames.test(reference))
            || item.text.match(/(?:رواه|أخرجه|متفق عليه)\s+[^.\n]{1,180}/u)?.[0];

        if (quranReference) details.push(`📖 **المصدر:** القرآن الكريم — ${quranReference}`);
        else if (hadithReference) details.push(`📜 **المصدر:** ${hadithReference}`);
        else details.push(`📚 **المصدر:** قسم ${getAdhkarTypeName(type)}`);
    }

    for (const virtue of virtues) details.push(`✨ **${virtue}**`);
    return details.join('\n').slice(0, 1500);
}

import { getRolesConfig } from './rolesConfigService';
import { getSubscribedUsers, getUserDMConfig } from './dmSubscriptionService';
import { dmText } from './dmLocalizationService';

// Map adhkar type string to the granular DM subscription key
function typeToSubscriptionKey(type: string): string {
    if (type === 'أذكار الصباح') return 'adhkar_sabah';
    if (type === 'أذكار المساء') return 'adhkar_masa';
    if (type === 'أذكار الآذان') return 'adhkar_adhan';
    if (type === 'أذكار الوضوء') return 'adhkar_wudu';
    if (type === 'أذكار النوم') return 'adhkar_nawm';
    if (type === 'أذكار الاستيقاظ') return 'adhkar_istiyqaz';
    if (type === 'أذكار يوم الجمعة') return 'adhkar_jumuah';
    return type;
}

function compactCombinedDescription(description: string): string {
    const groups = new Map<string, { marker: string; label: string; values: string[] }>();
    const order: Array<{ kind: 'metadata'; key: string } | { kind: 'text'; value: string }> = [];
    const plainLines = new Set<string>();

    for (const line of description.split(/\n+/).map(value => value.trim()).filter(Boolean)) {
        const match = line.match(/^((?:\p{Extended_Pictographic}\uFE0F?\s*)?)\*\*([^*]+?):\*\*\s*(.+)$/u);
        if (!match) {
            if (!plainLines.has(line)) {
                plainLines.add(line);
                order.push({ kind: 'text', value: line });
            }
            continue;
        }

        const [, marker, rawLabel, value] = match;
        const label = rawLabel.trim();
        const key = label;
        let group = groups.get(key);
        if (!group) {
            group = { marker, label, values: [] };
            groups.set(key, group);
            order.push({ kind: 'metadata', key });
        }
        if (!group.values.includes(value)) group.values.push(value);
    }

    return order.map(entry => {
        if (entry.kind === 'text') return entry.value;
        const group = groups.get(entry.key)!;
        return `${group.marker}**${group.label}:** ${group.values.join(' • ')}`;
    }).join('\n');
}

async function sendFiles(channel: any, type: string, buffers: any[], description: string, guildId: string, client: Client, fallbackText = '') {
    const displayDescription = buffers.length > 1 ? compactCombinedDescription(description) : description;
    const embed = new EmbedBuilder().setColor(COLORS.ADHKAR).setTitle(`${getAdhkarEmoji(type)} ${getAdhkarTypeName(type)}`)
        .setDescription(displayDescription).setFooter({ text: BOT_FOOTER }).setTimestamp();
    const attachments = buffers.map((buffer, index) => new AttachmentBuilder(buffer, { name: `adhkar_${Date.now()}_${index + 1}.png` }));
    
    let content = '';
    const rolesConfig = await getRolesConfig(guildId);
    if (rolesConfig.adhkarRoleId) {
        content = `<@&${rolesConfig.adhkarRoleId}>`;
    }

    if (attachments.length) {
        await channel.send({ content, embeds: [embed], files: attachments.slice(0, 10), allowedMentions: { parse: ['roles'] } });
        for (let index = 10; index < attachments.length; index += 10) await channel.send({ files: attachments.slice(index, index + 10) });

        // Send DMs to specifically subscribed users for this adhkar type
        const subKey = typeToSubscriptionKey(type);
        const dmUsers = await getSubscribedUsers(subKey);
        for (const userId of dmUsers) {
            client.users.fetch(userId).then(user => {
                user.send({ content: `📲 **${getAdhkarTypeName(type)}**`, embeds: [embed], files: attachments.slice(0, 10) }).catch(() => {});
            }).catch(() => {});
        }
    } else {
        // Canvas failed: send a text message with the same content instead.
        if (fallbackText) embed.setDescription(`${displayDescription}\n\n${fallbackText}`);
        await channel.send({ content, embeds: [embed], allowedMentions: { parse: ['roles'] } });

        const subKey = typeToSubscriptionKey(type);
        const dmUsers = await getSubscribedUsers(subKey);
        for (const userId of dmUsers) {
            client.users.fetch(userId).then(user => {
                user.send({ content: `📲 **${getAdhkarTypeName(type)}**\n${description}\n\n${fallbackText}` }).catch(() => {});
            }).catch(() => {});
        }
    }
}

export async function sendRandomAdhkar(client: Client, guildId: string, channelId: string, type: string): Promise<boolean> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return false;

    // أذكار الوضوء: send ALL items together (only 2 items: before & after wudu)
    if (type === WUDU_ADHKAR) {
        const allItems = getAdhkar(type);
        if (!allItems.length) return false;
        const allBuffers: any[] = [];
        const descriptions: string[] = [];
        let fallbackText = '';
        for (const item of allItems) {
            try {
                allBuffers.push(...generateAdaptiveAdhkarImages(item.text, getAdhkarTypeName(type), item.source || undefined, item.count));
            } catch (error) {
                logger.warn(`[Adhkar] Image generation failed for wudu item; using text fallback: ${error instanceof Error ? error.message : String(error)}`);
                fallbackText += `${item.text}\n\n`;
            }
            descriptions.push(describeAdhkarItem(item, type));
        }
        try {
            await sendFiles(channel, type, allBuffers, descriptions.join('\n\n'), guildId, client, fallbackText);
            await sendAuditLog(client, guildId, { level: 'info', system: 'Adhkar', action: 'Wudu adhkar sent', details: `${getAdhkarTypeName(type)} — <#${channelId}> — ${allBuffers.length} image(s) — ${allItems.length} items${fallbackText ? ' — text fallback (canvas failed)' : ''}` });
            return true;
        } catch (error) {
            logger.error(`[Adhkar] Failed to send ${type}:`, error);
            await sendAuditLog(client, guildId, { level: 'error', system: 'Adhkar', action: 'Dhikr send failed', details: `${type} — <#${channelId}>` });
            return false;
        }
    }

    const picked = await drawItem(guildId, type, true);
    let buffers: any[] = [];
    let description = '';
    let fallbackText = '';
    if (picked.names?.length) {
        try {
            buffers = [generateNamesGridImage(picked.names, picked.namesPage || 1, picked.namesTotalPages || 1)];
        } catch (error) {
            logger.warn(`[Adhkar] Image generation failed for names; using text fallback: ${error instanceof Error ? error.message : String(error)}`);
            fallbackText = picked.names.join('\n');
        }
        description = `🤍 **المحتوى:** أسماء الله الحسنى\n📚 **المصدر:** قاعدة أسماء الله الحسنى\n🔢 **المجموعة:** ${picked.namesPage || 1}/${picked.namesTotalPages || 1}`;
    } else if (picked.item) {
        try {
            buffers = generateAdaptiveAdhkarImages(picked.item.text, getAdhkarTypeName(type), picked.item.source || undefined, picked.item.count);
        } catch (error) {
            logger.warn(`[Adhkar] Image generation failed for ${type}; using text fallback: ${error instanceof Error ? error.message : String(error)}`);
            fallbackText = picked.item.text;
        }
        description = describeAdhkarItem(picked.item, type);
    } else return false;
    try {
        await sendFiles(channel, type, buffers, description, guildId, client, fallbackText);
        await sendAuditLog(client, guildId, { level: 'info', system: 'Adhkar', action: type === FRIDAY_ADHKAR ? 'Weekly Friday dhikr sent' : 'Random dhikr sent', details: `${getAdhkarTypeName(type)} — <#${channelId}> — ${buffers.length} image(s)${fallbackText ? ' — text fallback (canvas failed)' : ''}` });
        return true;
    } catch (error) {
        logger.error(`[Adhkar] Failed to send ${type}:`, error);
        await sendAuditLog(client, guildId, { level: 'error', system: 'Adhkar', action: 'Dhikr send failed', details: `${type} — <#${channelId}>` });
        return false;
    }
}

export async function buildAdhkarPreview(guildId: string, type: string): Promise<AdhkarPreviewResult | null> {
    // أذكار الوضوء: preview ALL items together
    if (type === WUDU_ADHKAR) {
        const allItems = getAdhkar(type);
        if (!allItems.length) return null;
        const allBuffers: any[] = [];
        for (const item of allItems) {
            allBuffers.push(...generateAdaptiveAdhkarImages(item.text, getAdhkarTypeName(type), item.source || undefined, item.count));
        }
        return { type, title: getAdhkarTypeName(type), buffers: allBuffers, itemCount: allItems.length };
    }
    const picked = await drawItem(guildId, type, false);
    if (picked.names?.length) return { type, title: getAdhkarTypeName(type), buffers: [generateNamesGridImage(picked.names, picked.namesPage || 1, picked.namesTotalPages || 1)], itemCount: 9 };
    if (!picked.item) return null;
    return {
        type, title: getAdhkarTypeName(type),
        buffers: generateAdaptiveAdhkarImages(picked.item.text, getAdhkarTypeName(type), picked.item.source || undefined, picked.item.count),
        itemCount: 1,
    };
}

async function primaryZone(config: AdhkarV2Config, guildId: string): Promise<ManagedAdhanZone | null> {
    return (await getManagedAdhanZones(guildId)).find(zone => zone.country === config.primaryZoneCountry && zone.city === config.primaryZoneCity && zone.enabled) || null;
}

async function markAndSend(client: Client, guildId: string, config: AdhkarV2Config, eventKey: string, channelId: string, type: string) {
    if (!categoryEnabled(config, type)) return;
    const lockKey = `${guildId}:${eventKey}`;
    if (pendingEvents.has(lockKey)) return;
    pendingEvents.add(lockKey);
    try {
        const runtime = await runtimeFor(guildId);
        if (runtime.sentEvents.includes(eventKey)) return;
        const sent = await sendRandomAdhkar(client, guildId, channelId, type);
        if (sent) {
            const latest = await runtimeFor(guildId);
            if (!latest.sentEvents.includes(eventKey)) latest.sentEvents.push(eventKey);
            await saveRuntime(guildId, latest);
        }
    } finally {
        pendingEvents.delete(lockKey);
    }
}

export async function sendPrayerLinkedAdhkar(client: Client, guildId: string, zone: ManagedAdhanZone, prayer: string, kind: 'adhan' | 'wudu' | 'wakeup' | 'sleep') {
    const config = await getAdhkarV2Config(guildId);
    if (!config || !config.enabled || zone.country !== config.primaryZoneCountry || zone.city !== config.primaryZoneCity) return;
    
    let type = PRAYER_ADHKAR;
    if (kind === 'wudu') type = WUDU_ADHKAR;
    else if (kind === 'wakeup') type = WAKEUP_ADHKAR;
    else if (kind === 'sleep') type = SLEEP_ADHKAR;

    const date = moment().tz(zone.timezone).format('YYYY-MM-DD');
    // Prayer and wudu adhkar belong beside the adhan notification. Wake-up and
    // sleep adhkar use prayer times only as their schedule and belong in the
    // configured general adhkar channel with the other daily adhkar.
    const channelId = kind === 'wakeup' || kind === 'sleep'
        ? config.generalChannelId
        : zone.channelId;
    await markAndSend(client, guildId, config, `${date}:prayer:${prayer}:${kind}`, channelId, type);
}

async function runCore(client: Client, guildId: string, type: string) {
    const config = await getAdhkarV2Config(guildId);
    if (!config) return;
    const zone = await primaryZone(config, guildId);
    if (!zone) return;
    const local = moment().tz(zone.timezone);
    const date = local.format('YYYY-MM-DD');
    await markAndSend(client, guildId, config, `${date}:core:${type}`, config.generalChannelId, type);
    if (type === 'أذكار الصباح' && local.isoWeekday() === 5) {
        await markAndSend(
            client,
            guildId,
            config,
            `${date}:core:${FRIDAY_ADHKAR}`,
            config.generalChannelId,
            FRIDAY_ADHKAR,
        );
    }
}

function addTimer(guildId: string, timer: NodeJS.Timeout) {
    const timers = activeTimers.get(guildId) || [];
    timers.push(timer);
    activeTimers.set(guildId, timers);
}

async function nextBalancedCategory(guildId: string, enabled: string[]): Promise<string | null> {
    if (!enabled.length) return null;
    const runtime = await runtimeFor(guildId);
    runtime.categoryPool = runtime.categoryPool.filter(type => enabled.includes(type));
    if (!runtime.categoryPool.length) runtime.categoryPool = shuffle(enabled);
    const selected = runtime.categoryPool.shift() || null;
    await saveRuntime(guildId, runtime);
    return selected;
}

async function scheduleDaytimeGaps(client: Client, guildId: string, config: AdhkarV2Config, zone: ManagedAdhanZone) {
    const schedule = await fetchZonePrayerSchedule(zone);
    if (!schedule) return;
    const enabledOther = Object.entries(config.categories).filter(([type, status]) => status === 'enabled' && !SPECIAL_TYPES.has(type)).map(([type]) => type);
    if (!enabledOther.length) return;
    const now = moment().tz(zone.timezone);
    const date = now.format('YYYY-MM-DD');
    const pairs = [['Fajr', 'Dhuhr'], ['Dhuhr', 'Asr'], ['Asr', 'Maghrib'], ['Maghrib', 'Isha']] as const;
    for (const [startPrayer, endPrayer] of pairs) {
        const [startHour, startMinute] = schedule.timings[startPrayer].replace(/\s*\(.*\)/, '').split(':').map(Number);
        const [endHour, endMinute] = schedule.timings[endPrayer].replace(/\s*\(.*\)/, '').split(':').map(Number);
        const start = now.clone().hour(startHour).minute(startMinute).second(0).millisecond(0);
        const end = now.clone().hour(endHour).minute(endMinute).second(0).millisecond(0);
        if (!end.isAfter(now)) continue;
        const eventKey = `${date}:gap:${startPrayer}-${endPrayer}`;
        let runtime = await runtimeFor(guildId);
        if (runtime.sentEvents.includes(eventKey)) continue;
        let plan = runtime.gapPlans[eventKey];
        if (!plan || !enabledOther.includes(plan.category)) {
            const category = await nextBalancedCategory(guildId, enabledOther);
            if (!category) continue;
            const fraction = 0.25 + Math.random() * 0.5;
            plan = { at: start.clone().add(end.diff(start, 'milliseconds') * fraction, 'milliseconds').toISOString(), category };
            runtime = await runtimeFor(guildId);
            runtime.gapPlans[eventKey] = plan;
            await saveRuntime(guildId, runtime);
        }
        const at = moment(plan.at).tz(zone.timezone);
        const execute = () => markAndSend(client, guildId, config, eventKey, config.generalChannelId, plan.category).catch(() => {});
        if (now.isSameOrAfter(at) && now.isBefore(end)) await execute();
        else if (at.isAfter(now) && at.isBefore(end)) addTimer(guildId, setTimeout(execute, at.diff(now, 'milliseconds')));
    }
}

async function schedulePrayerLinkedTimers(client: Client, guildId: string, zone: ManagedAdhanZone) {
    const schedule = await fetchZonePrayerSchedule(zone);
    if (!schedule) return;
    const now = moment().tz(zone.timezone);
    for (const prayer of PRAYER_KEYS) {
        const [hour, minute] = schedule.timings[prayer].replace(/\s*\(.*\)/, '').split(':').map(Number);
        const target = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
        if (target.isAfter(now)) {
            addTimer(guildId, setTimeout(() => sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'adhan').catch(() => {}), target.diff(now, 'milliseconds')));
        }
        const wudu = target.clone().add(5, 'minutes');
        if (wudu.isAfter(now)) {
            addTimer(guildId, setTimeout(() => sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'wudu').catch(() => {}), wudu.diff(now, 'milliseconds')));
        }
        if (prayer === 'Fajr') {
            const wakeup = target.clone().subtract(30, 'minutes');
            if (wakeup.isAfter(now)) {
                addTimer(guildId, setTimeout(() => sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'wakeup').catch(() => {}), wakeup.diff(now, 'milliseconds')));
            }
        }
        if (prayer === 'Isha') {
            const sleep = target.clone().add(1, 'hours');
            if (sleep.isAfter(now)) {
                addTimer(guildId, setTimeout(() => sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'sleep').catch(() => {}), sleep.diff(now, 'milliseconds')));
            }
        }
    }
}

async function scheduleAdhkarDay(client: Client, guildId: string, config: AdhkarV2Config, zone: ManagedAdhanZone) {
    await scheduleDaytimeGaps(client, guildId, config, zone);
    await schedulePrayerLinkedTimers(client, guildId, zone);
}

async function catchUp(client: Client, guildId: string, config: AdhkarV2Config, zone: ManagedAdhanZone) {
    const now = moment().tz(zone.timezone);
    for (const [type, time] of Object.entries(CORE_TYPES)) {
        const [hour, minute] = time.split(':').map(Number);
        const target = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
        const diff = now.diff(target, 'minutes');
        if (diff >= 0 && diff <= 120) await runCore(client, guildId, type);
    }
    const schedule = await fetchZonePrayerSchedule(zone);
    if (schedule) {
        for (const prayer of PRAYER_KEYS) {
            const [hour, minute] = schedule.timings[prayer].replace(/\s*\(.*\)/, '').split(':').map(Number);
            const target = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
            const adhanDiff = now.diff(target, 'minutes');
            const wuduDiff = now.diff(target.clone().add(5, 'minutes'), 'minutes');
            if (adhanDiff >= 0 && adhanDiff <= 15) await sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'adhan');
            if (wuduDiff >= 0 && wuduDiff <= 15) await sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'wudu');
            
            if (prayer === 'Fajr') {
                const wakeupDiff = now.diff(target.clone().subtract(30, 'minutes'), 'minutes');
                if (wakeupDiff >= 0 && wakeupDiff <= 15) await sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'wakeup');
            }
            if (prayer === 'Isha') {
                const sleepDiff = now.diff(target.clone().add(1, 'hours'), 'minutes');
                if (sleepDiff >= 0 && sleepDiff <= 15) await sendPrayerLinkedAdhkar(client, guildId, zone, prayer, 'sleep');
            }
        }
    }
}

export function stopAllGuildAdhkarCrons(guildId: string) {
    for (const job of activeCronJobs.get(guildId) || []) job.stop();
    activeCronJobs.delete(guildId);
    for (const timer of activeTimers.get(guildId) || []) clearTimeout(timer);
    activeTimers.delete(guildId);
}

async function scheduleGuild(client: Client, guildId: string, config: AdhkarV2Config) {
    stopAllGuildAdhkarCrons(guildId);
    if (!config.enabled) return;
    const zone = await primaryZone(config, guildId);
    if (!zone) {
        await sendAuditLog(client, guildId, { level: 'error', system: 'Adhkar', action: 'Primary adhan zone unavailable', details: 'أوقف نظام الأذكار حتى يتم اختيار منطقة أذان مفعلة.' });
        return;
    }
    const jobs: cron.ScheduledTask[] = [];
    for (const [type, time] of Object.entries(CORE_TYPES)) {
        const [hour, minute] = time.split(':').map(Number);
        jobs.push(cron.schedule(`${minute} ${hour} * * *`, () => runCore(client, guildId, type).catch(() => {}), { timezone: zone.timezone }));
    }
    jobs.push(cron.schedule('5 0 * * *', () => scheduleAdhkarDay(client, guildId, config, zone).catch(() => {}), { timezone: zone.timezone }));
    activeCronJobs.set(guildId, jobs);
    await catchUp(client, guildId, config, zone);
    await scheduleAdhkarDay(client, guildId, config, zone);
}

export async function rescheduleAdhkarGuild(client: Client, guildId: string) {
    const config = await getAdhkarV2Config(guildId);
    stopAllGuildAdhkarCrons(guildId);
    if (config) await scheduleGuild(client, guildId, config);
}

export async function initAdhkarCrons(client: Client): Promise<void> {
    const guilds = await getAllAdhkarV2Guilds();
    for (const entry of guilds) await scheduleGuild(client, entry.guildId, entry.config);
    logger.success(`📿 Initialized ${guilds.length} advanced adhkar systems.`);
}

export async function sendAdhkar(client: Client, channelId: string, type: string): Promise<void> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const guildId = channel && 'guildId' in channel ? channel.guildId : 'preview';
    await sendRandomAdhkar(client, guildId, channelId, type);
}

export function scheduleAdhkarCron(..._args: any[]): void {}
export function stopAdhkarCron(..._args: any[]): void {}






