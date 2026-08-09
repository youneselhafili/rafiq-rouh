import { getAllModuleConfigs, isFirestoreAvailable } from './guildConfigService';
import { deleteAdhanConfig, getAdhanConfigs, getAllAdhanGuilds, saveAdhanConfig } from './guildService';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';

export interface ManagedAdhanZone {
    country: string;
    city: string;
    timezone: string;
    channelId: string;
    enabled: boolean;
    createdAt: string;
    updatedBy?: string;
}

interface ManagedAdhanZonesDoc {
    enabled: boolean;
    zones: ManagedAdhanZone[];
}

const MODULE = 'adhanZonesV2';

function key(zone: Pick<ManagedAdhanZone, 'country' | 'city'>): string {
    return `${zone.country.toLowerCase()}::${zone.city.toLowerCase()}`;
}

async function migrateLegacy(guildId: string): Promise<ManagedAdhanZonesDoc> {
    const legacy = await getAdhanConfigs(guildId);
    const doc: ManagedAdhanZonesDoc = {
        enabled: true,
        zones: legacy.map(zone => ({
            country: zone.country,
            city: zone.city,
            timezone: zone.timezone,
            channelId: zone.channelId,
            enabled: true,
            createdAt: new Date().toISOString(),
        })),
    };
    if (doc.zones.length) await setAdvancedConfig(guildId, MODULE, doc);
    return doc;
}

export async function getManagedAdhanZones(guildId: string): Promise<ManagedAdhanZone[]> {
    const doc = await getAdvancedConfig<ManagedAdhanZonesDoc>(guildId, MODULE) || await migrateLegacy(guildId);
    return doc.zones || [];
}

export async function saveManagedAdhanZone(guildId: string, zone: Omit<ManagedAdhanZone, 'createdAt'>, actorId?: string): Promise<void> {
    const zones = await getManagedAdhanZones(guildId);
    const index = zones.findIndex(item => key(item) === key(zone));
    const next: ManagedAdhanZone = {
        ...zone,
        enabled: zone.enabled,
        createdAt: index >= 0 ? zones[index].createdAt : new Date().toISOString(),
        updatedBy: actorId,
    };
    if (index >= 0) zones[index] = next;
    else zones.push(next);
    await setAdvancedConfig<ManagedAdhanZonesDoc>(guildId, MODULE, { enabled: true, zones });
    await saveAdhanConfig(guildId, zone.country, zone.city, zone.timezone, zone.channelId);
}

export async function setManagedAdhanZoneEnabled(guildId: string, country: string, city: string, enabled: boolean, actorId?: string): Promise<void> {
    const zones = await getManagedAdhanZones(guildId);
    const zone = zones.find(item => key(item) === key({ country, city }));
    if (!zone) return;
    zone.enabled = enabled;
    zone.updatedBy = actorId;
    await setAdvancedConfig<ManagedAdhanZonesDoc>(guildId, MODULE, { enabled: true, zones });
}

export async function deleteManagedAdhanZone(guildId: string, country: string, city: string): Promise<void> {
    const zones = (await getManagedAdhanZones(guildId)).filter(item => key(item) !== key({ country, city }));
    await setAdvancedConfig<ManagedAdhanZonesDoc>(guildId, MODULE, { enabled: true, zones });
    await deleteAdhanConfig(guildId, city);
}

export async function getPrimaryAdhanZone(guildId: string): Promise<ManagedAdhanZone | null> {
    return (await getManagedAdhanZones(guildId)).find(zone => zone.enabled) || null;
}

export async function getAllManagedAdhanGuilds(): Promise<Array<{ guildId: string; zones: ManagedAdhanZone[] }>> {
    const byGuild = new Map<string, ManagedAdhanZone[]>();
    if (isFirestoreAvailable()) {
        const all = await getAllModuleConfigs<ManagedAdhanZonesDoc>(MODULE);
        for (const entry of all) byGuild.set(entry.guildId, entry.zones || []);
    }
    const legacy = await getAllAdhanGuilds();
    for (const entry of legacy) {
        if (!byGuild.has(entry.guildId)) byGuild.set(entry.guildId, await getManagedAdhanZones(entry.guildId));
    }
    return [...byGuild.entries()].map(([guildId, zones]) => ({ guildId, zones: zones.filter(zone => zone.enabled) }));
}

