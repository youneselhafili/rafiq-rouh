import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import {
    canAttemptFirebase,
    getDb,
    isFirebaseInitialized,
    recordFirebaseFailure,
    recordFirebaseSuccess,
} from '../config/firebase';
import { logger } from '../utils/logger';
import { writeJsonAtomic } from '../utils/localJsonStore';

const MODULE_DOC_ID = 'default';
const GUILDS_DIR = path.join(process.cwd(), 'data', 'guilds');

interface LocalGuildRecord extends Record<string, any> {
    guildId: string;
    createdAt?: string;
    updatedAt?: string;
    __storage?: {
        pendingModules?: Record<string, 'set' | 'delete'>;
    };
}

export function isFirestoreAvailable(): boolean {
    return isFirebaseInitialized();
}

function db() {
    return getDb();
}

function moduleRef(guildId: string, moduleName: string): DocumentReference {
    return db().doc(`guilds/${guildId}/${moduleName}/${MODULE_DOC_ID}`);
}

function localFile(guildId: string): string {
    return path.join(GUILDS_DIR, `${guildId}.json`);
}

function plainValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, item) => {
        if (item && typeof item.toDate === 'function') return item.toDate().toISOString();
        return item;
    })) as T;
}

function readLocalGuild(guildId: string): LocalGuildRecord {
    try {
        const file = localFile(guildId);
        if (fs.existsSync(file)) {
            const record = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalGuildRecord;
            hydrateLegacyModules(record);
            return record;
        }
    } catch (error) {
        logger.warn(`[Storage] Failed to read local guild config ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { guildId, createdAt: new Date().toISOString() };
}

function hydrateLegacyModules(record: LocalGuildRecord): void {
    if (record.adhkarConfig === undefined && Array.isArray(record.adhkar) && record.adhkar.length) {
        record.adhkarConfig = {
            enabled: true,
            channelId: record.adhkar[0].channelId,
            types: record.adhkar.map((item: any) => item.type),
            times: Object.fromEntries(record.adhkar.map((item: any) => [item.type, item.time || ''])),
        };
    }
    if (record.adhanConfig === undefined && Array.isArray(record.adhan) && record.adhan.length) {
        record.adhanConfig = { enabled: true, zones: record.adhan.map((zone: any) => ({ ...zone, enabled: true, roleId: zone.roleId || null })) };
    }
    if (record.salawatConfig === undefined && Array.isArray(record.salawat) && record.salawat.length) {
        record.salawatConfig = { enabled: true, ...record.salawat[0] };
    }
    if (record.quranRadioConfig === undefined && record.quranRadio) {
        record.quranRadioConfig = { enabled: true, ...record.quranRadio };
    }
    if (record.donateConfig === undefined && record.donate) {
        record.donateConfig = { ...record.donate, enabled: record.donate.enabled !== false };
    }
}

function writeLocalGuild(guildId: string, record: LocalGuildRecord): void {
    const file = localFile(guildId);
    record.guildId = guildId;
    record.updatedAt = new Date().toISOString();
    writeJsonAtomic(file, record);
}

function mirrorLegacyShape(record: LocalGuildRecord, moduleName: string, value: any): void {
    if (moduleName === 'adhkarConfig') {
        record.adhkar = value?.enabled
            ? (value.types || []).map((type: string) => ({ type, channelId: value.channelId, time: value.times?.[type] || '' }))
            : [];
    } else if (moduleName === 'adhanConfig') {
        record.adhan = value?.enabled
            ? (value.zones || []).filter((zone: any) => zone.enabled !== false).map((zone: any) => ({ ...zone, roleId: zone.roleId || undefined }))
            : [];
    } else if (moduleName === 'salawatConfig') {
        record.salawat = value?.enabled ? [{ channelId: value.channelId, intervalHours: value.intervalHours }] : [];
    } else if (moduleName === 'quranRadioConfig') {
        record.quranRadio = value?.enabled ? {
            voiceChannelId: value.voiceChannelId,
            textChannelId: value.textChannelId,
            twentyFourSeven: value.twentyFourSeven,
            defaultSource: value.defaultSource,
        } : null;
    } else if (moduleName === 'donateConfig') {
        record.donate = value?.enabled ? { channelId: value.channelId, interval: value.interval, enabled: true } : null;
    }
}

function saveLocalModule<T>(guildId: string, moduleName: string, data: T, pending: boolean): void {
    const record = readLocalGuild(guildId);
    const value = plainValue(data);
    record[moduleName] = value;
    mirrorLegacyShape(record, moduleName, value);
    record.__storage ||= {};
    record.__storage.pendingModules ||= {};
    if (pending) record.__storage.pendingModules[moduleName] = 'set';
    else delete record.__storage.pendingModules[moduleName];
    writeLocalGuild(guildId, record);
}

function deleteLocalModule(guildId: string, moduleName: string, pending: boolean): void {
    const record = readLocalGuild(guildId);
    delete record[moduleName];
    mirrorLegacyShape(record, moduleName, null);
    record.__storage ||= {};
    record.__storage.pendingModules ||= {};
    if (pending) record.__storage.pendingModules[moduleName] = 'delete';
    else delete record.__storage.pendingModules[moduleName];
    writeLocalGuild(guildId, record);
}

async function flushPendingModule(guildId: string, moduleName: string, record: LocalGuildRecord): Promise<boolean> {
    const operation = record.__storage?.pendingModules?.[moduleName];
    if (!operation) return true;
    if (!canAttemptFirebase()) return false;
    try {
        if (operation === 'delete') {
            await moduleRef(guildId, moduleName).delete();
            deleteLocalModule(guildId, moduleName, false);
        } else {
            const value = record[moduleName];
            await db().doc(`guilds/${guildId}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            await moduleRef(guildId, moduleName).set({ ...value, updatedAt: FieldValue.serverTimestamp() });
            saveLocalModule(guildId, moduleName, value, false);
        }
        recordFirebaseSuccess();
        return true;
    } catch (error) {
        recordFirebaseFailure(error, `sync ${moduleName}/${guildId}`);
        return false;
    }
}

export async function getModuleConfig<T>(guildId: string, moduleName: string): Promise<T | null> {
    let local = readLocalGuild(guildId);
    if (local.__storage?.pendingModules?.[moduleName]) {
        await flushPendingModule(guildId, moduleName, local);
        local = readLocalGuild(guildId);
        if (local.__storage?.pendingModules?.[moduleName]) return (local[moduleName] as T | undefined) ?? null;
    }
    if (!canAttemptFirebase()) return (local[moduleName] as T | undefined) ?? null;
    try {
        const snap = await moduleRef(guildId, moduleName).get();
        recordFirebaseSuccess();
        if (!snap.exists) {
            const localValue = local[moduleName] as T | undefined;
            if (localValue !== undefined) {
                await db().doc(`guilds/${guildId}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
                await moduleRef(guildId, moduleName).set({ ...localValue, updatedAt: FieldValue.serverTimestamp() });
                saveLocalModule(guildId, moduleName, localValue, false);
            }
            return localValue ?? null;
        }
        const data = snap.data();
        if (!data) return null;
        const value = plainValue({ ...data }) as unknown as T;
        saveLocalModule(guildId, moduleName, value, false);
        return value;
    } catch (error) {
        recordFirebaseFailure(error, `read ${moduleName}/${guildId}`);
        return (local[moduleName] as T | undefined) ?? null;
    }
}

export async function setModuleConfig<T>(guildId: string, moduleName: string, data: T): Promise<void> {
    saveLocalModule(guildId, moduleName, data, true);
    if (!canAttemptFirebase()) return;
    try {
        await db().doc(`guilds/${guildId}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await moduleRef(guildId, moduleName).set({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });
        saveLocalModule(guildId, moduleName, data, false);
        recordFirebaseSuccess();
    } catch (error) {
        recordFirebaseFailure(error, `save ${moduleName}/${guildId}`);
    }
}

export async function updateModuleConfig<T extends Record<string, unknown>>(
    guildId: string,
    moduleName: string,
    partialData: Partial<T>,
): Promise<void> {
    const existing = await getModuleConfig<T>(guildId, moduleName);
    await setModuleConfig(guildId, moduleName, {
        ...(existing || {} as T),
        ...partialData,
    } as T);
}

export async function deleteModuleConfig(guildId: string, moduleName: string): Promise<void> {
    deleteLocalModule(guildId, moduleName, true);
    if (!canAttemptFirebase()) return;
    try {
        await moduleRef(guildId, moduleName).delete();
        deleteLocalModule(guildId, moduleName, false);
        recordFirebaseSuccess();
        logger.info(`Deleted ${moduleName} config for guild ${guildId}`);
    } catch (error) {
        recordFirebaseFailure(error, `delete ${moduleName}/${guildId}`);
    }
}

export async function getAllModuleConfigs<T>(
    moduleName: string,
    mapFn?: (guildId: string, data: T) => T & { guildId: string },
): Promise<Array<T & { guildId: string }>> {
    const byGuild = new Map<string, T & { guildId: string }>();
    fs.mkdirSync(GUILDS_DIR, { recursive: true });
    for (const filename of fs.readdirSync(GUILDS_DIR).filter(name => name.endsWith('.json'))) {
        const guildId = filename.slice(0, -5);
        let local = readLocalGuild(guildId);
        if (local.__storage?.pendingModules?.[moduleName]) {
            await flushPendingModule(guildId, moduleName, local);
            local = readLocalGuild(guildId);
        }
        if (local[moduleName] !== undefined) {
            const value = plainValue(local[moduleName]) as T;
            byGuild.set(guildId, mapFn ? mapFn(guildId, value) : ({ ...value, guildId } as T & { guildId: string }));
        }
    }
    if (!canAttemptFirebase()) return [...byGuild.values()];
    try {
        const guildsSnap = await db().collection('guilds').get();
        for (const guildDoc of guildsSnap.docs) {
            const configSnap = await guildDoc.ref
                .collection(moduleName)
                .doc(MODULE_DOC_ID)
                .get();
            if (!configSnap.exists) continue;
            const data = configSnap.data() as T | undefined;
            if (!data) continue;
            const guildId = guildDoc.id;
            const local = readLocalGuild(guildId);
            if (local.__storage?.pendingModules?.[moduleName]) continue;
            const value = plainValue(data) as T;
            saveLocalModule(guildId, moduleName, value, false);
            if (mapFn) {
                byGuild.set(guildId, mapFn(guildId, value));
            } else {
                byGuild.set(guildId, { ...value, guildId } as unknown as T & { guildId: string });
            }
        }
        recordFirebaseSuccess();
    } catch (error) {
        recordFirebaseFailure(error, `list ${moduleName}`);
    }
    return [...byGuild.values()];
}
