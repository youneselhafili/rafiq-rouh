import * as fs from 'fs';
import * as path from 'path';
import { GuildSettings, GuildAdhkarConfig, GuildAdhanConfig, GuildSalawatConfig, GuildQuranRadioConfig, GuildDonateConfig } from '../types';
import { logger } from '../utils/logger';
import { isFirestoreAvailable, getModuleConfig, setModuleConfig, deleteModuleConfig, getAllModuleConfigs } from './guildConfigService';
import type { AdhkarConfigDoc, AdhanConfigDoc, AdhanZone, SalawatConfigDoc, QuranRadioConfigDoc, DonateConfigDoc } from '../types/config';


// ─── Paths ────────────────────────────────────────────────────

const GUILDS_DIR = path.join(process.cwd(), 'data', 'guilds');

// ─── Helpers ──────────────────────────────────────────────────

function ensureGuildsDir(): void {
    if (!fs.existsSync(GUILDS_DIR)) {
        fs.mkdirSync(GUILDS_DIR, { recursive: true });
    }
}

function guildFilePath(guildId: string): string {
    return path.join(GUILDS_DIR, `${guildId}.json`);
}

function nowISO(): string {
    return new Date().toISOString();
}

function readGuild(guildId: string): GuildSettings | null {
    const fp = guildFilePath(guildId);
    try {
        if (!fs.existsSync(fp)) return null;
        return JSON.parse(fs.readFileSync(fp, 'utf-8')) as GuildSettings;
    } catch {
        return null;
    }
}

function writeGuild(settings: GuildSettings): void {
    ensureGuildsDir();
    settings.updatedAt = nowISO();
    fs.writeFileSync(guildFilePath(settings.guildId), JSON.stringify(settings, null, 2), 'utf-8');
}

function getOrCreateGuild(guildId: string): GuildSettings {
    const existing = readGuild(guildId);
    if (existing) return existing;
    const settings: GuildSettings = {
        guildId,
        adhkar: [],
        adhan: [],
        salawat: [],
        quranRadio: null,
        donate: null,
        khatma: null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
    };
    writeGuild(settings);
    return settings;

}

function getAllGuildIds(): string[] {
    ensureGuildsDir();
    try {
        return fs.readdirSync(GUILDS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace(/\.json$/, ''));
    } catch {
        return [];
    }
}

// ─── Adhkar Configs ───────────────────────────────────────────

export async function saveAdhkarConfig(
    guildId: string,
    type: string,
    channelId: string,
    time: string,
    city?: string,
    country?: string,
): Promise<void> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<AdhkarConfigDoc>(guildId, 'adhkarConfig');
        const existingTypes = doc?.types || [];
        const existingTimes = doc?.times || {};
        const types = existingTypes.includes(type) ? existingTypes : [...existingTypes, type];
        const times = { ...existingTimes, [type]: time };
        await setModuleConfig(guildId, 'adhkarConfig', {
            enabled: true,
            channelId,
            types,
            times,
        });
        logger.info(`Adhkar config saved via Firestore for guild ${guildId}, type: ${type}`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    const idx = (guild.adhkar || []).findIndex(c => c.type === type);
    const config: GuildAdhkarConfig = { type, channelId, time };
    if (!guild.adhkar) guild.adhkar = [];
    if (idx >= 0) guild.adhkar[idx] = config;
    else guild.adhkar.push(config);
    writeGuild(guild);
    logger.info(`Adhkar config saved for guild ${guildId}, type: ${type}`);
}

export async function getGuildAdhkarConfigs(guildId: string): Promise<GuildAdhkarConfig[]> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<AdhkarConfigDoc>(guildId, 'adhkarConfig');
        if (!doc || !doc.enabled || !doc.types || doc.types.length === 0) return [];
        return doc.types.map(t => ({
            type: t,
            channelId: doc.channelId,
            time: doc.times?.[t] || '',
        }));
    }

    const guild = readGuild(guildId);
    return guild?.adhkar || [];
}

export async function getAllAdhkarConfigs(): Promise<Array<GuildAdhkarConfig & { guildId: string }>> {
    if (isFirestoreAvailable()) {
        const all = await getAllModuleConfigs<AdhkarConfigDoc>('adhkarConfig');
        const results: Array<GuildAdhkarConfig & { guildId: string }> = [];
        for (const entry of all) {
            if (!entry.enabled || !entry.types) continue;
            for (const t of entry.types) {
                results.push({
                    guildId: entry.guildId,
                    type: t,
                    channelId: entry.channelId,
                    time: entry.times?.[t] || '',
                });
            }
        }
        return results;
    }

    const results: Array<GuildAdhkarConfig & { guildId: string }> = [];
    for (const id of getAllGuildIds()) {
        const guild = readGuild(id);
        if (guild && guild.adhkar) {
            for (const config of guild.adhkar) {
                results.push({ guildId: id, ...config });
            }
        }
    }
    return results;
}

export async function deleteAdhkarConfig(guildId: string, type: string): Promise<void> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<AdhkarConfigDoc>(guildId, 'adhkarConfig');
        if (!doc) return;
        const types = (doc.types || []).filter(t => t !== type);
        const { [type]: _, ...times } = doc.times || {};
        if (types.length === 0) {
            await deleteModuleConfig(guildId, 'adhkarConfig');
        } else {
            await setModuleConfig(guildId, 'adhkarConfig', {
                ...doc,
                types,
                times,
            });
        }
        logger.info(`Adhkar config deleted via Firestore for guild ${guildId}, type: ${type}`);
        return;
    }

    const guild = readGuild(guildId);
    if (!guild || !guild.adhkar) return;
    guild.adhkar = guild.adhkar.filter(c => c.type !== type);
    writeGuild(guild);
    logger.info(`Adhkar config deleted for guild ${guildId}, type: ${type}`);
}

export async function deleteAllGuildAdhkarConfigs(guildId: string): Promise<void> {
    if (isFirestoreAvailable()) {
        await deleteModuleConfig(guildId, 'adhkarConfig');
        logger.info(`All adhkar configs deleted via Firestore for guild ${guildId}`);
        return;
    }

    const guild = readGuild(guildId);
    if (!guild) return;
    guild.adhkar = [];
    writeGuild(guild);
    logger.info(`All adhkar configs deleted for guild ${guildId}`);
}

// ─── Adhan Configs ────────────────────────────────────────────

export async function saveAdhanConfig(
    guildId: string,
    country: string,
    city: string,
    timezone: string,
    channelId: string,
    roleId?: string,
): Promise<void> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<AdhanConfigDoc>(guildId, 'adhanConfig');
        const zones = doc?.zones || [];
        const idx = zones.findIndex(z => z.city === city);
        const zone: AdhanZone = { country, city, timezone, channelId, roleId: roleId || null, enabled: true };
        if (idx >= 0) zones[idx] = zone;
        else zones.push(zone);
        await setModuleConfig(guildId, 'adhanConfig', { enabled: true, zones });
        logger.info(`Adhan config saved via Firestore for guild ${guildId}, city: ${city}`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    if (!guild.adhan) guild.adhan = [];
    const idx = guild.adhan.findIndex(c => c.city === city);
    const config: GuildAdhanConfig = { country, city, timezone, channelId, roleId };
    if (idx >= 0) guild.adhan[idx] = config;
    else guild.adhan.push(config);
    writeGuild(guild);
    logger.info(`Adhan config saved for guild ${guildId}, city: ${city}`);
}

export async function getAdhanConfigs(guildId: string): Promise<GuildAdhanConfig[]> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<AdhanConfigDoc>(guildId, 'adhanConfig');
        if (!doc || !doc.enabled) return [];
        return doc.zones
            .filter(z => z.enabled)
            .map(z => ({
                country: z.country,
                city: z.city,
                timezone: z.timezone,
                channelId: z.channelId,
                roleId: z.roleId ?? undefined,
            }));
    }

    const guild = readGuild(guildId);
    return guild?.adhan || [];
}

export async function deleteAdhanConfig(guildId: string, city: string): Promise<void> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<AdhanConfigDoc>(guildId, 'adhanConfig');
        if (!doc) return;
        const zones = (doc.zones || []).filter(z => z.city !== city);
        if (zones.length === 0) {
            await deleteModuleConfig(guildId, 'adhanConfig');
        } else {
            await setModuleConfig(guildId, 'adhanConfig', { ...doc, zones });
        }
        logger.info(`Adhan config deleted via Firestore for guild ${guildId}, city: ${city}`);
        return;
    }

    const guild = readGuild(guildId);
    if (!guild || !guild.adhan) return;
    guild.adhan = guild.adhan.filter(c => c.city !== city);
    writeGuild(guild);
    logger.info(`Adhan config deleted for guild ${guildId}, city: ${city}`);
}

export async function getAllAdhanGuilds(): Promise<Array<{ guildId: string; configs: GuildAdhanConfig[] }>> {
    if (isFirestoreAvailable()) {
        const all = await getAllModuleConfigs<AdhanConfigDoc>('adhanConfig');
        const results: Array<{ guildId: string; configs: GuildAdhanConfig[] }> = [];
        for (const entry of all) {
            const configs = (entry.zones || [])
                .filter(z => z.enabled)
                .map(z => ({
                    country: z.country,
                    city: z.city,
                    timezone: z.timezone,
                    channelId: z.channelId,
                    roleId: z.roleId ?? undefined,
                }));
            if (configs.length > 0) {
                results.push({ guildId: entry.guildId, configs });
            }
        }
        return results;
    }

    const results: Array<{ guildId: string; configs: GuildAdhanConfig[] }> = [];
    for (const id of getAllGuildIds()) {
        const guild = readGuild(id);
        if (guild && guild.adhan && guild.adhan.length > 0) {
            results.push({ guildId: id, configs: guild.adhan });
        }
    }
    return results;
}

// ─── Jumuah Configs ───────────────────────────────────────────

export async function saveJumuahConfig(
    guildId: string,
    country: string,
    city: string,
    timezone: string,
    channelId: string,
    roleId?: string,
): Promise<void> {
    await saveAdhanConfig(guildId, country, city, timezone, channelId, roleId);
    logger.info(`Jumuah config saved for guild ${guildId}`);
}

export async function getAllJumuahConfigs(): Promise<Array<{ guildId: string; country: string; city: string; timezone: string; channelId: string; roleId?: string }>> {
    if (isFirestoreAvailable()) {
        const all = await getAllModuleConfigs<AdhanConfigDoc>('adhanConfig');
        const results: Array<{ guildId: string; country: string; city: string; timezone: string; channelId: string; roleId?: string }> = [];
        for (const entry of all) {
            for (const z of entry.zones || []) {
                if (!z.enabled) continue;
                results.push({
                    guildId: entry.guildId,
                    country: z.country,
                    city: z.city,
                    timezone: z.timezone,
                    channelId: z.channelId,
                    roleId: z.roleId ?? undefined,
                });
            }
        }
        return results;
    }

    const results: Array<{ guildId: string; country: string; city: string; timezone: string; channelId: string; roleId?: string }> = [];
    for (const id of getAllGuildIds()) {
        const guild = readGuild(id);
        if (guild && guild.adhan) {
            for (const config of guild.adhan) {
                results.push({ guildId: id, ...config });
            }
        }
    }
    return results;
}

// ─── Salawat Configs ──────────────────────────────────────────

export async function saveSalawatConfig(guildId: string, channelId: string, intervalHours: number): Promise<void> {
    if (isFirestoreAvailable()) {
        await setModuleConfig(guildId, 'salawatConfig', {
            enabled: true,
            channelId,
            intervalHours,
        });
        logger.info(`Salawat config saved via Firestore for guild ${guildId}, interval: ${intervalHours}h`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    guild.salawat = [{ channelId, intervalHours }];
    writeGuild(guild);
    logger.info(`Salawat config saved for guild ${guildId}, interval: ${intervalHours}h`);
}

export async function getAllSalawatConfigs(): Promise<Array<{ guildId: string; channelId: string; intervalHours: number }>> {
    if (isFirestoreAvailable()) {
        const all = await getAllModuleConfigs<SalawatConfigDoc>('salawatConfig');
        return all
            .filter(e => e.enabled)
            .map(e => ({
                guildId: e.guildId,
                channelId: e.channelId,
                intervalHours: e.intervalHours,
            }));
    }

    const results: Array<{ guildId: string; channelId: string; intervalHours: number }> = [];
    for (const id of getAllGuildIds()) {
        const guild = readGuild(id);
        if (guild && guild.salawat && guild.salawat.length > 0) {
            for (const config of guild.salawat) {
                results.push({ guildId: id, ...config });
            }
        }
    }
    return results;
}

// ─── Quran Radio Config ───────────────────────────────────────

export async function saveQuranRadioConfig(
    guildId: string,
    voiceChannelId: string,
    textChannelId: string,
    twentyFourSeven: boolean = false,
    defaultSource: string = 'none',
): Promise<void> {
    if (isFirestoreAvailable()) {
        await setModuleConfig(guildId, 'quranRadioConfig', {
            enabled: true,
            voiceChannelId,
            textChannelId,
            twentyFourSeven,
            defaultSource,
        });
        logger.info(`Quran Radio config saved via Firestore for guild ${guildId}`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    guild.quranRadio = { voiceChannelId, textChannelId, twentyFourSeven, defaultSource };
    writeGuild(guild);
    logger.info(`Quran Radio config saved for guild ${guildId}`);
}

export async function getQuranRadioConfig(guildId: string): Promise<GuildQuranRadioConfig | null> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<QuranRadioConfigDoc>(guildId, 'quranRadioConfig');
        if (!doc || !doc.enabled) return null;
        return {
            voiceChannelId: doc.voiceChannelId,
            textChannelId: doc.textChannelId,
            twentyFourSeven: doc.twentyFourSeven ?? false,
            defaultSource: doc.defaultSource ?? 'none',
        };
    }

    const guild = readGuild(guildId);
    if (!guild?.quranRadio) return null;
    return {
        voiceChannelId: guild.quranRadio.voiceChannelId,
        textChannelId: guild.quranRadio.textChannelId,
        twentyFourSeven: guild.quranRadio.twentyFourSeven ?? false,
        defaultSource: guild.quranRadio.defaultSource ?? 'none',
    };
}

// ─── Send History ─────────────────────────────────────────────

interface GuildData {
    history?: Record<string, string[]>;
}

function getGuildData(guildId: string): GuildData {
    const fp = guildFilePath(guildId);
    try {
        if (!fs.existsSync(fp)) return {};
        const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        return raw as GuildData;
    } catch {
        return {};
    }
}

function writeGuildData(guildId: string, data: GuildData): void {
    const fp = guildFilePath(guildId);
    ensureGuildsDir();
    let existing: Record<string, unknown> = {};
    try {
        if (fs.existsSync(fp)) existing = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
        // ignore
    }
    const merged = { ...existing, ...data, updatedAt: nowISO() };
    fs.writeFileSync(fp, JSON.stringify(merged, null, 2), 'utf-8');
}

export function getSendHistory(guildId: string, category: string): string[] {
    const data = getGuildData(guildId);
    return data.history?.[category] || [];
}

export function addToSendHistory(guildId: string, category: string, itemId: string): void {
    const data = getGuildData(guildId);
    if (!data.history) data.history = {};
    if (!data.history[category]) data.history[category] = [];
    data.history[category].push(itemId);
    writeGuildData(guildId, data);
}

export function clearSendHistory(guildId: string, category: string): void {
    const data = getGuildData(guildId);
    if (data.history) {
        data.history[category] = [];
    }
    writeGuildData(guildId, data);
}

// ─── Donate Configs ───────────────────────────────────────────

export async function saveDonateConfig(
    guildId: string,
    channelId: string,
    interval: 'daily' | 'weekly' | 'monthly'
): Promise<void> {
    if (isFirestoreAvailable()) {
        await setModuleConfig(guildId, 'donateConfig', {
            enabled: true,
            channelId,
            interval,
        });
        logger.info(`Donate config saved via Firestore for guild ${guildId}`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    guild.donate = {
        channelId,
        interval,
        enabled: true,
    };
    writeGuild(guild);
    logger.info(`Donate config saved locally for guild ${guildId}`);
}

export async function getGuildDonateConfig(guildId: string): Promise<GuildDonateConfig | null> {
    if (isFirestoreAvailable()) {
        const doc = await getModuleConfig<DonateConfigDoc>(guildId, 'donateConfig');
        if (!doc || !doc.enabled) return null;
        return {
            channelId: doc.channelId,
            interval: doc.interval,
            enabled: doc.enabled,
        };
    }

    const guild = readGuild(guildId);
    return guild?.donate || null;
}

export async function deleteDonateConfig(guildId: string): Promise<void> {
    if (isFirestoreAvailable()) {
        await deleteModuleConfig(guildId, 'donateConfig');
        logger.info(`Donate config deleted via Firestore for guild ${guildId}`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    guild.donate = null;
    writeGuild(guild);
    logger.info(`Donate config deleted locally for guild ${guildId}`);
}

export async function saveGuildDonateTracking(
    guildId: string,
    tracking: { firstSent: boolean; lastSentAt: string }
): Promise<void> {
    if (isFirestoreAvailable()) {
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        const db = getFirestore();
        await db.doc(`guilds/${guildId}/donateConfig/default`).set({
            firstSent: tracking.firstSent,
            lastSentAt: tracking.lastSentAt,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.info(`Donate tracking saved via Firestore for guild ${guildId}`);
        return;
    }

    const guild = getOrCreateGuild(guildId);
    guild.firstDonateBroadcastSent = tracking.firstSent;
    guild.lastDonateBroadcastAt = tracking.lastSentAt;
    writeGuild(guild);
    logger.info(`Donate tracking saved locally for guild ${guildId}`);
}

export async function getGuildDonateTracking(
    guildId: string
): Promise<{ firstSent: boolean; lastSentAt?: string; createdAt: Date }> {
    if (isFirestoreAvailable()) {
        const { getFirestore } = await import('firebase-admin/firestore');
        const db = getFirestore();
        const docSnap = await db.doc(`guilds/${guildId}/donateConfig/default`).get();
        const guildSnap = await db.doc(`guilds/${guildId}`).get();
        
        const data = docSnap.exists ? docSnap.data() : null;
        const createdAt = guildSnap.exists && guildSnap.createTime 
            ? guildSnap.createTime.toDate() 
            : new Date();

        return {
            firstSent: data?.firstSent || false,
            lastSentAt: data?.lastSentAt,
            createdAt,
        };
    }

    const guild = getOrCreateGuild(guildId);
    return {
        firstSent: guild.firstDonateBroadcastSent || false,
        lastSentAt: guild.lastDonateBroadcastAt,
        createdAt: guild.createdAt ? new Date(guild.createdAt) : new Date(),
    };
}


