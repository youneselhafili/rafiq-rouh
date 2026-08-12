import { Client, TextChannel } from 'discord.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '../config/firebase';
import { KhatmaMode } from '../types';
import { getAllModuleConfigs, getModuleConfig, setModuleConfig } from './guildConfigService';
import { getRolesConfig } from './rolesConfigService';
import { logger } from '../utils/logger';

export const PERSONAL_KHATMA_PANEL_MODULE = 'personal_khatma_panel';

export interface PersonalGuildKhatmaConfig {
    guildId: string;
    userId: string;
    enabled: boolean;
    mode: KhatmaMode;
    pagesPerDay: number;
    ramadanKhatmas?: number;
    currentPage: number;
    startedAt: string;
    updatedAt: string;
    readingDates: string[];
    completedKhatmas: number;
    lastCompletedAt?: string;
    awaitingRestartChoice?: boolean;
}

export interface PersonalKhatmaPanelConfig {
    channelId: string;
    messageId?: string;
    lastReminderAt?: string;
    updatedAt?: string;
}

export interface PersonalKhatmaProgress {
    elapsedDays: number;
    plannedDays: number;
    targetPage: number;
    pagesRead: number;
    pagesDue: number;
    missedReadingDays: number;
    isAhead: boolean;
}

function userRef(guildId: string, userId: string) {
    return getDb().doc(`guilds/${guildId}/personalKhatmas/${userId}`);
}

export function meccaDateKey(value: Date | string = new Date()): string {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateKeyToUtc(key: string): number {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

export function inclusiveMeccaDays(from: Date | string, to: Date | string = new Date()): number {
    const difference = dateKeyToUtc(meccaDateKey(to)) - dateKeyToUtc(meccaDateKey(from));
    return Math.max(1, Math.floor(difference / 86_400_000) + 1);
}

function normalizeConfig(guildId: string, userId: string, data: Partial<PersonalGuildKhatmaConfig>): PersonalGuildKhatmaConfig {
    const now = new Date().toISOString();
    return {
        guildId,
        userId,
        enabled: data.enabled === true,
        mode: data.mode || 'month',
        pagesPerDay: Math.max(1, Math.min(604, Number(data.pagesPerDay) || 21)),
        ramadanKhatmas: data.ramadanKhatmas,
        currentPage: Math.max(1, Math.min(605, Number(data.currentPage) || 1)),
        startedAt: data.startedAt || now,
        updatedAt: data.updatedAt || now,
        readingDates: Array.isArray(data.readingDates) ? [...new Set(data.readingDates.filter(Boolean))].slice(-700) : [],
        completedKhatmas: Math.max(0, Number(data.completedKhatmas) || 0),
        lastCompletedAt: data.lastCompletedAt,
        awaitingRestartChoice: data.awaitingRestartChoice === true,
    };
}

export async function getPersonalGuildKhatma(guildId: string, userId: string): Promise<PersonalGuildKhatmaConfig | null> {
    const snap = await userRef(guildId, userId).get();
    if (!snap.exists) return null;
    return normalizeConfig(guildId, userId, snap.data() || {});
}

export async function savePersonalGuildKhatma(config: PersonalGuildKhatmaConfig): Promise<void> {
    const normalized = normalizeConfig(config.guildId, config.userId, { ...config, updatedAt: new Date().toISOString() });
    await getDb().doc(`guilds/${config.guildId}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await userRef(config.guildId, config.userId).set(normalized);
}

export async function deletePersonalGuildKhatma(guildId: string, userId: string): Promise<void> {
    await userRef(guildId, userId).delete();
}

export async function listPersonalGuildKhatmas(guildId: string, enabledOnly = false): Promise<PersonalGuildKhatmaConfig[]> {
    const snap = await getDb().collection(`guilds/${guildId}/personalKhatmas`).get();
    return snap.docs
        .map(doc => normalizeConfig(guildId, doc.id, doc.data()))
        .filter(config => !enabledOnly || config.enabled);
}

export async function getPersonalKhatmaPanel(guildId: string): Promise<PersonalKhatmaPanelConfig | null> {
    return getModuleConfig<PersonalKhatmaPanelConfig>(guildId, PERSONAL_KHATMA_PANEL_MODULE);
}

export async function setPersonalKhatmaPanel(guildId: string, config: PersonalKhatmaPanelConfig): Promise<void> {
    await setModuleConfig(guildId, PERSONAL_KHATMA_PANEL_MODULE, config);
}

export function getPersonalKhatmaProgress(config: PersonalGuildKhatmaConfig, now: Date | string = new Date()): PersonalKhatmaProgress {
    const elapsedDays = inclusiveMeccaDays(config.startedAt, now);
    const plannedDays = Math.ceil(604 / config.pagesPerDay);
    const pagesRead = Math.max(0, Math.min(604, config.currentPage - 1));
    const targetPage = Math.min(604, elapsedDays * config.pagesPerDay);
    const today = meccaDateKey(now);
    const readBeforeToday = new Set(config.readingDates.filter(key => key < today)).size;
    const previousDays = Math.max(0, elapsedDays - 1);
    return {
        elapsedDays,
        plannedDays,
        targetPage,
        pagesRead,
        pagesDue: Math.max(0, targetPage - pagesRead),
        missedReadingDays: Math.max(0, previousDays - readBeforeToday),
        isAhead: pagesRead > targetPage,
    };
}

export async function acknowledgePersonalKhatmaPage(
    guildId: string,
    userId: string,
    expectedPage: number,
): Promise<{ config: PersonalGuildKhatmaConfig; advanced: boolean; completed: boolean }> {
    return getDb().runTransaction(async transaction => {
        const ref = userRef(guildId, userId);
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('PERSONAL_KHATMA_NOT_FOUND');
        const config = normalizeConfig(guildId, userId, snap.data() || {});
        if (!config.enabled || config.currentPage !== expectedPage || expectedPage > 604) {
            return { config, advanced: false, completed: config.currentPage > 604 };
        }

        const today = meccaDateKey();
        if (!config.readingDates.includes(today)) config.readingDates.push(today);
        const completed = expectedPage === 604;
        config.currentPage = expectedPage + 1;
        config.updatedAt = new Date().toISOString();
        if (completed) {
            config.enabled = false;
            config.awaitingRestartChoice = true;
            config.completedKhatmas += 1;
            config.lastCompletedAt = config.updatedAt;
        }
        transaction.set(ref, config);
        return { config, advanced: true, completed };
    });
}

export function restartPersonalKhatma(config: PersonalGuildKhatmaConfig): PersonalGuildKhatmaConfig {
    const now = new Date().toISOString();
    return {
        ...config,
        enabled: true,
        currentPage: 1,
        startedAt: now,
        updatedAt: now,
        readingDates: [],
        awaitingRestartChoice: false,
    };
}

export function completionStatistics(config: PersonalGuildKhatmaConfig) {
    const completedAt = config.lastCompletedAt || new Date().toISOString();
    const actualDays = inclusiveMeccaDays(config.startedAt, completedAt);
    const plannedDays = Math.ceil(604 / config.pagesPerDay);
    const readingDays = new Set(config.readingDates).size;
    return {
        actualDays,
        plannedDays,
        readingDays,
        missedReadingDays: Math.max(0, actualDays - readingDays),
        earlyDays: Math.max(0, plannedDays - actualDays),
        delayDays: Math.max(0, actualDays - plannedDays),
    };
}

export async function sendPersonalKhatmaReminders(client: Client): Promise<void> {
    const today = meccaDateKey();
    const panels = await getAllModuleConfigs<PersonalKhatmaPanelConfig>(PERSONAL_KHATMA_PANEL_MODULE);
    for (const panel of panels) {
        const guildId = panel.guildId;
        if (!panel.channelId || (panel.lastReminderAt && meccaDateKey(panel.lastReminderAt) === today)) continue;
        try {
            const subscribers = await listPersonalGuildKhatmas(guildId, true);
            if (!subscribers.length) continue;
            const channel = await client.channels.fetch(panel.channelId).catch(() => null) as TextChannel | null;
            if (!channel?.isTextBased() || !('send' in channel)) continue;

            const roles = await getRolesConfig(guildId);
            const guild = client.guilds.cache.get(guildId);
            const role = roles.khatmaRoleId && guild
                ? await guild.roles.fetch(roles.khatmaRoleId).catch(() => null)
                : null;
            const mention = role
                ? `<@&${role.id}>`
                : subscribers.slice(0, 50).map(item => `<@${item.userId}>`).join(' ');
            await channel.send({
                content: mention || undefined,
                embeds: [{
                    color: 0x7c3aed,
                    title: '📖 حان وقت وردك اليومي',
                    description: 'اضغط الزر لقراءة صفحاتك المستحقة. لن تظهر صفحاتك ولا تقدمك لأي عضو آخر.',
                }],
                components: [{
                    type: 1,
                    components: [{ type: 2, custom_id: 'personal_khatma_read', label: 'استلم ورد اليوم', emoji: { name: '📖' }, style: 1 }],
                }],
                allowedMentions: role ? { parse: [], roles: [role.id] } : { parse: [], users: subscribers.slice(0, 50).map(item => item.userId) },
            });
            await setPersonalKhatmaPanel(guildId, { ...panel, lastReminderAt: new Date().toISOString() });
        } catch (error) {
            logger.error(`Failed to send personal Khatma reminder for guild ${guildId}:`, error);
        }
    }
}
