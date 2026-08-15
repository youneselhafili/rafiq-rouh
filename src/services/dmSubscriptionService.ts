import { FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import {
    canAttemptFirebase,
    getDb,
    recordFirebaseFailure,
    recordFirebaseSuccess,
} from '../config/firebase';
import { logger } from '../utils/logger';
import { writeJsonAtomic } from '../utils/localJsonStore';

export type DMLanguage = 'ar' | 'darija' | 'en' | 'fr';
export type DMFormat = 'full' | 'compact';
export type DMPrayerKey = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';
export type DMAdhanEvent = 'warning' | 'adhan' | 'prayer_card';

export interface UserDMSubscriptions {
    adhkar_sabah: boolean;
    adhkar_masa: boolean;
    adhkar_adhan: boolean;
    adhkar_wudu: boolean;
    adhkar_nawm: boolean;
    adhkar_istiyqaz: boolean;
    adhkar_jumuah: boolean;
    adhkar_other: boolean;
    salawat: boolean;
    jumuah: boolean;
    adhan: boolean;
    adhan_zone?: string;
}

export interface UserDMConfig extends UserDMSubscriptions {
    enabled: boolean;
    language: DMLanguage;
    format: DMFormat;
    city?: string;
    timezone?: string;
    adhanConfig: {
        enabled: boolean;
        events: Record<DMAdhanEvent, boolean>;
        prayers: Record<DMPrayerKey, boolean>;
    };
    adhkarConfig: {
        enabled: boolean;
        categories: Pick<UserDMSubscriptions,
            'adhkar_sabah' | 'adhkar_masa' | 'adhkar_adhan' | 'adhkar_wudu' |
            'adhkar_nawm' | 'adhkar_istiyqaz' | 'adhkar_jumuah' | 'adhkar_other'>;
    };
    salawatConfig: {
        enabled: boolean;
        scheduleMode: 'interval' | 'fixed';
        intervalHours: 1 | 4 | 8 | 12 | 24;
        fixedTimes: string[];
        timezone?: string;
        nextRunAt?: string;
    };
    jumuahConfig: {
        enabled: boolean;
        reminderTime: string;
    };
    quranConfig: {
        enabled: boolean;
        dailyAyah: boolean;
        kahf: boolean;
        readingReminder: boolean;
        reminderTime: string;
    };
    khatma?: {
        enabled: boolean;
        currentPage: number;
        pagesPerDay: number;
        mode: import('../types').KhatmaMode;
        ramadanKhatmas?: number;
        lastSentAt?: string;
        updatedAt?: string;
    };
    runtime?: {
        sentEvents?: string[];
        updatedAt?: string;
    };
    dashboard?: {
        settings?: Record<string, unknown>;
        updatedAt?: string;
    };
    panel?: {
        channelId: string;
        messageId: string;
        pinned: boolean;
        updatedAt: string;
    };
}

export const DEFAULT_SUBSCRIPTIONS: UserDMSubscriptions = {
    adhkar_sabah: false,
    adhkar_masa: false,
    adhkar_adhan: false,
    adhkar_wudu: false,
    adhkar_nawm: false,
    adhkar_istiyqaz: false,
    adhkar_jumuah: false,
    adhkar_other: false,
    salawat: false,
    jumuah: false,
    adhan: false,
};

export const DEFAULT_DM_CONFIG: UserDMConfig = {
    ...DEFAULT_SUBSCRIPTIONS,
    enabled: true,
    language: 'ar',
    format: 'full',
    adhanConfig: {
        enabled: false,
        events: { warning: true, adhan: true, prayer_card: false },
        prayers: { Fajr: true, Dhuhr: true, Asr: true, Maghrib: true, Isha: true },
    },
    adhkarConfig: {
        enabled: false,
        categories: {
            adhkar_sabah: false,
            adhkar_masa: false,
            adhkar_adhan: false,
            adhkar_wudu: false,
            adhkar_nawm: false,
            adhkar_istiyqaz: false,
            adhkar_jumuah: false,
            adhkar_other: false,
        },
    },
    salawatConfig: { enabled: false, scheduleMode: 'interval', intervalHours: 4, fixedTimes: [], timezone: 'Africa/Casablanca' },
    jumuahConfig: { enabled: false, reminderTime: '08:00' },
    quranConfig: { enabled: false, dailyAyah: false, kahf: false, readingReminder: false, reminderTime: '09:00' },
    runtime: { sentEvents: [] },
};

const LEGACY_KEYS = Object.keys(DEFAULT_SUBSCRIPTIONS) as (keyof UserDMSubscriptions)[];
const ADHKAR_KEYS = Object.keys(DEFAULT_DM_CONFIG.adhkarConfig.categories) as (keyof UserDMConfig['adhkarConfig']['categories'])[];
const USERS_DIR = path.join(process.cwd(), 'data', 'users');

interface LocalUserEnvelope {
    config: Record<string, any>;
    pendingFirebase: boolean;
    updatedAt: string;
}

function db() {
    return getDb();
}

function userDoc(userId: string) {
    return db().doc(`users/${userId}`);
}

function userRef(userId: string) {
    return db().doc(`users/${userId}/preferences/dm`);
}

function localUserFile(userId: string): string {
    return path.join(USERS_DIR, `${userId}.json`);
}

function readLocalUser(userId: string): LocalUserEnvelope | null {
    try {
        const file = localUserFile(userId);
        if (!fs.existsSync(file)) return null;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data?.config && typeof data.config === 'object') return data as LocalUserEnvelope;
        return { config: data || {}, pendingFirebase: false, updatedAt: new Date(0).toISOString() };
    } catch (error) {
        logger.warn(`[Storage] Failed to read local DM config for ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

function writeLocalUser(userId: string, config: Record<string, any>, pendingFirebase: boolean): void {
    const envelope: LocalUserEnvelope = { config, pendingFirebase, updatedAt: new Date().toISOString() };
    writeJsonAtomic(localUserFile(userId), envelope);
}

async function writeRemoteUser(userId: string, config: Record<string, any>): Promise<boolean> {
    if (!canAttemptFirebase()) return false;
    try {
        await userDoc(userId).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await userRef(userId).set({ ...config, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        recordFirebaseSuccess();
        return true;
    } catch (error) {
        recordFirebaseFailure(error, `save DM config/${userId}`);
        return false;
    }
}

function mergeConfig(data: any = {}): UserDMConfig {
    const legacy: UserDMSubscriptions = { ...DEFAULT_SUBSCRIPTIONS };
    for (const key of LEGACY_KEYS) {
        if (data[key] !== undefined) (legacy as any)[key] = data[key] === true;
        else if (key.startsWith('adhkar_') && data.adhkar === true) (legacy as any)[key] = true;
    }

    const merged: UserDMConfig = {
        ...DEFAULT_DM_CONFIG,
        ...legacy,
        enabled: data.enabled !== undefined ? data.enabled !== false : DEFAULT_DM_CONFIG.enabled,
        language: 'ar',
        format: (['full', 'compact'].includes(data.format) ? data.format : DEFAULT_DM_CONFIG.format) as DMFormat,
        city: data.city || data.adhan_zone,
        timezone: data.timezone,
        adhan_zone: data.adhan_zone || data.city,
        adhanConfig: {
            ...DEFAULT_DM_CONFIG.adhanConfig,
            ...(data.adhanConfig || {}),
            enabled: data.adhanConfig?.enabled ?? legacy.adhan,
            events: { ...DEFAULT_DM_CONFIG.adhanConfig.events, ...(data.adhanConfig?.events || {}) },
            prayers: { ...DEFAULT_DM_CONFIG.adhanConfig.prayers, ...(data.adhanConfig?.prayers || {}) },
        },
        adhkarConfig: {
            ...DEFAULT_DM_CONFIG.adhkarConfig,
            ...(data.adhkarConfig || {}),
            enabled: data.adhkarConfig?.enabled ?? ADHKAR_KEYS.some(key => legacy[key]),
            categories: { ...DEFAULT_DM_CONFIG.adhkarConfig.categories, ...legacy, ...(data.adhkarConfig?.categories || {}) },
        },
        salawatConfig: { ...DEFAULT_DM_CONFIG.salawatConfig, ...(data.salawatConfig || {}), enabled: data.salawatConfig?.enabled ?? legacy.salawat, fixedTimes: Array.isArray(data.salawatConfig?.fixedTimes) ? data.salawatConfig.fixedTimes : [] },
        jumuahConfig: { ...DEFAULT_DM_CONFIG.jumuahConfig, ...(data.jumuahConfig || {}), enabled: data.jumuahConfig?.enabled ?? legacy.jumuah },
        quranConfig: { ...DEFAULT_DM_CONFIG.quranConfig, ...(data.quranConfig || {}) },
        khatma: data.khatma && typeof data.khatma === 'object' ? { ...(data.khatma as any) } : undefined,
        runtime: { ...DEFAULT_DM_CONFIG.runtime, ...(data.runtime || {}), sentEvents: data.runtime?.sentEvents || [] },
        dashboard: data.dashboard ? { ...data.dashboard } : undefined,
        panel: data.panel && typeof data.panel === 'object' ? { ...data.panel } : undefined,
    };

    merged.adhan = merged.adhanConfig.enabled;
    merged.adhan_zone = merged.city;
    for (const key of ADHKAR_KEYS) merged[key] = merged.adhkarConfig.categories[key];
    merged.salawat = merged.salawatConfig.enabled;
    merged.jumuah = merged.jumuahConfig.enabled;
    return merged;
}

function flattenConfig(config: UserDMConfig): Record<string, any> {
    const next: UserDMConfig = mergeConfig(config);
    next.adhanConfig.enabled = next.adhan;
    next.adhkarConfig.enabled = ADHKAR_KEYS.some(key => next.adhkarConfig.categories[key]);
    next.salawatConfig.enabled = next.salawat;
    next.jumuahConfig.enabled = next.jumuah;
    next.city = next.city || next.adhan_zone;
    next.adhan_zone = next.city;
    for (const key of ADHKAR_KEYS) next[key] = next.adhkarConfig.categories[key];
    return next;
}

export async function getUserDMConfig(userId: string): Promise<UserDMConfig> {
    let local = readLocalUser(userId);
    if (local?.pendingFirebase) {
        if (await writeRemoteUser(userId, local.config)) {
            writeLocalUser(userId, local.config, false);
            local = readLocalUser(userId);
        }
        return mergeConfig(local?.config || {});
    }
    if (!canAttemptFirebase()) return mergeConfig(local?.config || {});
    try {
        const snap = await userRef(userId).get();
        recordFirebaseSuccess();
        if (!snap.exists) return mergeConfig(local?.config || {});
        const config = mergeConfig(snap.data() || {});
        writeLocalUser(userId, flattenConfig(config), false);
        return config;
    } catch (error) {
        recordFirebaseFailure(error, `read DM config/${userId}`);
        return mergeConfig(local?.config || {});
    }
}

export async function updateUserDMConfig(userId: string, partialConfig: Partial<UserDMConfig>): Promise<void> {
    const current = await getUserDMConfig(userId);
    const merged = flattenConfig(mergeConfig({ ...current, ...partialConfig }));
    writeLocalUser(userId, merged, true);
    if (await writeRemoteUser(userId, merged)) writeLocalUser(userId, merged, false);
}

export async function getUserDMSubscriptions(userId: string): Promise<UserDMSubscriptions> {
    const config = await getUserDMConfig(userId);
    return {
        adhkar_sabah: config.adhkar_sabah,
        adhkar_masa: config.adhkar_masa,
        adhkar_adhan: config.adhkar_adhan,
        adhkar_wudu: config.adhkar_wudu,
        adhkar_nawm: config.adhkar_nawm,
        adhkar_istiyqaz: config.adhkar_istiyqaz,
        adhkar_jumuah: config.adhkar_jumuah,
        adhkar_other: config.adhkar_other,
        salawat: config.salawat,
        jumuah: config.jumuah,
        adhan: config.adhan,
        adhan_zone: config.adhan_zone,
    };
}

export async function updateUserDMSubscriptions(userId: string, partialConfig: Partial<UserDMSubscriptions>): Promise<void> {
    const current = await getUserDMConfig(userId);
    for (const [key, value] of Object.entries(partialConfig)) {
        if (key === 'adhan_zone') {
            current.city = String(value || '') || undefined;
            current.adhan_zone = current.city;
        } else if (key in current.adhkarConfig.categories) {
            (current.adhkarConfig.categories as any)[key] = value === true;
            (current as any)[key] = value === true;
        } else if (key === 'adhan') {
            current.adhan = value === true;
            current.adhanConfig.enabled = value === true;
        } else if (key === 'salawat') {
            current.salawat = value === true;
            current.salawatConfig.enabled = value === true;
        } else if (key === 'jumuah') {
            current.jumuah = value === true;
            current.jumuahConfig.enabled = value === true;
        }
    }
    await updateUserDMConfig(userId, current);
}

export async function addDMSentEvent(userId: string, eventKey: string): Promise<void> {
    const config = await getUserDMConfig(userId);
    const sentEvents = new Set([...(config.runtime?.sentEvents || []).slice(-500), eventKey]);
    await updateUserDMConfig(userId, { runtime: { ...config.runtime, sentEvents: [...sentEvents].slice(-500), updatedAt: new Date().toISOString() } });
}

export async function getAllDMUserConfigs(): Promise<Array<{ userId: string; config: UserDMConfig }>> {
    const byUser = new Map<string, UserDMConfig>();
    fs.mkdirSync(USERS_DIR, { recursive: true });
    for (const filename of fs.readdirSync(USERS_DIR).filter(name => name.endsWith('.json'))) {
        const userId = filename.slice(0, -5);
        let local = readLocalUser(userId);
        if (!local) continue;
        if (local.pendingFirebase && await writeRemoteUser(userId, local.config)) {
            writeLocalUser(userId, local.config, false);
            local = readLocalUser(userId)!;
        }
        byUser.set(userId, mergeConfig(local.config));
    }
    if (!canAttemptFirebase()) return [...byUser].map(([userId, config]) => ({ userId, config }));
    try {
        const snap = await db().collectionGroup('preferences').get();
        for (const doc of snap.docs) {
            if (doc.id !== 'dm') continue;
            const parts = doc.ref.path.split('/');
            if (parts.length >= 4 && parts[parts.length - 4] === 'users') {
                const userId = parts[parts.length - 3];
                const local = readLocalUser(userId);
                if (local?.pendingFirebase) continue;
                const config = mergeConfig(doc.data());
                writeLocalUser(userId, flattenConfig(config), false);
                byUser.set(userId, config);
            }
        }
        recordFirebaseSuccess();
    } catch (error) {
        recordFirebaseFailure(error, 'list DM configs');
    }
    return [...byUser].map(([userId, config]) => ({ userId, config }));
}

export async function getSubscribedUsers(feature: keyof UserDMSubscriptions, filterZone?: string): Promise<string[]> {
    const userIds: string[] = [];
    for (const { userId, config } of await getAllDMUserConfigs()) {
        if (!config.enabled) continue;
        let subscribed = false;
        if (feature === 'adhan') subscribed = config.adhanConfig.enabled;
        else if (feature === 'salawat') subscribed = config.salawatConfig.enabled;
        else if (feature === 'jumuah') subscribed = config.jumuahConfig.enabled;
        else if (feature in config.adhkarConfig.categories) subscribed = config.adhkarConfig.categories[feature as keyof UserDMConfig['adhkarConfig']['categories']];
        else subscribed = (config as any)[feature] === true;

        if (!subscribed) continue;
        if (feature === 'adhan' && filterZone && config.city && config.city !== filterZone) continue;
        userIds.push(userId);
    }
    return userIds;
}

export async function getAllUsersWithActiveKhatma(): Promise<{ userId: string; config: UserDMConfig }[]> {
    const users: { userId: string; config: UserDMConfig }[] = [];
    for (const { userId, config } of await getAllDMUserConfigs()) {
        if (config.khatma?.enabled) users.push({ userId, config });
    }
    return users;
}
