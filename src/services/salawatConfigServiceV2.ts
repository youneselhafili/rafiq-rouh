import { getAllModuleConfigs, isFirestoreAvailable } from './guildConfigService';
import { getAllSalawatConfigs, saveSalawatConfig } from './guildService';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { getPrimaryAdhanZone } from './adhanZoneService';

export type SalawatScheduleMode = 'interval' | 'fixed';

export interface SalawatV2Config {
    enabled: boolean;
    channelId: string;
    scheduleMode: SalawatScheduleMode;
    intervalHours: 1 | 4 | 8 | 12 | 24;
    fixedTimes: string[];
    timezone: string;
    anchorAt: string;
    nextRunAt?: string;
    updatedBy?: string;
    deleted?: boolean;
}

const MODULE = 'salawatV2';

export async function getSalawatV2Config(guildId: string): Promise<SalawatV2Config | null> {
    const raw = await getAdvancedConfig<SalawatV2Config>(guildId, MODULE);
    if (raw?.deleted) return null;
    if (raw) return raw;
    const legacy = (await getAllSalawatConfigs()).find(item => item.guildId === guildId);
    if (!legacy) return null;
    const zone = await getPrimaryAdhanZone(guildId);
    const migrated: SalawatV2Config = {
        enabled: true, channelId: legacy.channelId, scheduleMode: 'interval',
        intervalHours: ([1, 4, 8, 12, 24].includes(legacy.intervalHours) ? legacy.intervalHours : 4) as SalawatV2Config['intervalHours'],
        fixedTimes: [], timezone: zone?.timezone || 'Africa/Casablanca',
        anchorAt: new Date().toISOString(),
    };
    migrated.nextRunAt = new Date(Date.now() + migrated.intervalHours * 60 * 60 * 1000).toISOString();
    await setAdvancedConfig(guildId, MODULE, migrated);
    return migrated;
}

export async function saveSalawatV2Config(guildId: string, config: SalawatV2Config): Promise<void> {
    await setAdvancedConfig(guildId, MODULE, { ...config, deleted: false });
    await saveSalawatConfig(guildId, config.channelId, config.intervalHours);
}

export async function deleteSalawatV2Config(guildId: string, actorId?: string): Promise<void> {
    await setAdvancedConfig<Partial<SalawatV2Config>>(guildId, MODULE, {
        enabled: false, deleted: true, updatedBy: actorId, anchorAt: new Date().toISOString(),
    });
}

export async function getAllSalawatV2Guilds(): Promise<Array<{ guildId: string; config: SalawatV2Config }>> {
    const result = new Map<string, SalawatV2Config>();
    if (isFirestoreAvailable()) {
        for (const entry of await getAllModuleConfigs<SalawatV2Config>(MODULE)) {
            if (!entry.deleted) result.set(entry.guildId, entry);
        }
    }
    for (const legacy of await getAllSalawatConfigs()) {
        if (result.has(legacy.guildId)) continue;
        const raw = await getAdvancedConfig<SalawatV2Config>(legacy.guildId, MODULE);
        if (raw?.deleted) continue;
        const config = raw || await getSalawatV2Config(legacy.guildId);
        if (config) result.set(legacy.guildId, config);
    }
    return [...result.entries()].map(([guildId, config]) => ({ guildId, config }));
}

