import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

const MODULE_DOC_ID = 'default';

export function isFirestoreAvailable(): boolean {
    try {
        getFirestore();
        return true;
    } catch {
        return false;
    }
}

function db() {
    return getFirestore();
}

function moduleRef(guildId: string, moduleName: string): DocumentReference {
    return db().doc(`guilds/${guildId}/${moduleName}/${MODULE_DOC_ID}`);
}

export async function getModuleConfig<T>(guildId: string, moduleName: string): Promise<T | null> {
    try {
        const snap = await moduleRef(guildId, moduleName).get();
        if (!snap.exists) return null;
        const data = snap.data();
        if (!data) return null;
        return { ...data } as unknown as T;
    } catch (error) {
        logger.error(`Failed to read ${moduleName} config for guild ${guildId}:`, error);
        return null;
    }
}

export async function setModuleConfig<T>(guildId: string, moduleName: string, data: T): Promise<void> {
    try {
        await db().doc(`guilds/${guildId}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await moduleRef(guildId, moduleName).set({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (error) {
        logger.error(`Failed to save ${moduleName} config for guild ${guildId}:`, error);
        throw error;
    }
}

export async function updateModuleConfig<T extends Record<string, unknown>>(
    guildId: string,
    moduleName: string,
    partialData: Partial<T>,
): Promise<void> {
    try {
        await db().doc(`guilds/${guildId}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const ref = moduleRef(guildId, moduleName);
        const existing = await ref.get();
        const base = existing.exists ? (existing.data() || {}) : {};

        const merged = {
            ...base,
            ...partialData,
            updatedAt: FieldValue.serverTimestamp(),
        };

        await ref.set(merged);
    } catch (error) {
        logger.error(`Failed to update ${moduleName} config for guild ${guildId}:`, error);
        throw error;
    }
}

export async function deleteModuleConfig(guildId: string, moduleName: string): Promise<void> {
    try {
        await moduleRef(guildId, moduleName).delete();
        logger.info(`Deleted ${moduleName} config for guild ${guildId}`);
    } catch (error) {
        logger.error(`Failed to delete ${moduleName} config for guild ${guildId}:`, error);
    }
}

export async function getAllModuleConfigs<T>(
    moduleName: string,
    mapFn?: (guildId: string, data: T) => T & { guildId: string },
): Promise<Array<T & { guildId: string }>> {
    const results: Array<T & { guildId: string }> = [];
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
            if (mapFn) {
                results.push(mapFn(guildId, data));
            } else {
                results.push({ ...data, guildId } as unknown as T & { guildId: string });
            }
        }
    } catch (error) {
        logger.error(`Failed to list all ${moduleName} configs:`, error);
    }
    return results;
}
