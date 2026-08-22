import { getAllModuleConfigs, isFirestoreAvailable } from './guildConfigService';
import { deleteAllGuildAdhkarConfigs, getAllAdhkarConfigs, getGuildAdhkarConfigs, saveAdhkarConfig } from './guildService';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { getPrimaryAdhanZone } from './adhanZoneService';
import { getAllAdhkarCategoryNames } from './contentService';

export type AdhkarCategoryStatus = 'enabled' | 'paused';

export interface AdhkarV2Config {
    enabled: boolean;
    generalChannelId: string;
    primaryZoneCountry: string;
    primaryZoneCity: string;
    categories: Record<string, AdhkarCategoryStatus>;
    updatedBy?: string;
}

const MODULE = 'adhkarV2';
const FRIDAY_ADHKAR = 'أذكار يوم الجمعة';

function reconcileCategoryConfig(config: AdhkarV2Config): boolean {
    // The catalog is the source of truth. New categories start paused: users must
    // explicitly opt in before the scheduler is allowed to send them.
    const validKeys = getAllAdhkarCategoryNames().map(category => category.key);
    if (!validKeys.length) return false;
    const valid = new Set(validKeys);
    let changed = false;
    for (const key of Object.keys(config.categories)) {
        if (!valid.has(key)) {
            delete config.categories[key];
            changed = true;
        }
    }
    for (const key of validKeys) {
        if (!config.categories[key]) {
            config.categories[key] = 'paused';
            changed = true;
        }
    }
    return changed;
}

export async function getAdhkarV2Config(guildId: string): Promise<AdhkarV2Config | null> {
    const existing = await getAdvancedConfig<AdhkarV2Config>(guildId, MODULE);
    if (existing) {
        if (reconcileCategoryConfig(existing)) await setAdvancedConfig(guildId, MODULE, existing);
        return existing;
    }
    const legacy = await getGuildAdhkarConfigs(guildId);
    const primary = await getPrimaryAdhanZone(guildId);
    if (!legacy.length || !primary) return null;
    const migrated: AdhkarV2Config = {
        enabled: true,
        generalChannelId: legacy[0].channelId,
        primaryZoneCountry: primary.country,
        primaryZoneCity: primary.city,
        categories: {
            ...Object.fromEntries(legacy.filter(item => item.type !== '__adhkar_v2__').map(item => [item.type, 'enabled'])),
            [FRIDAY_ADHKAR]: 'enabled',
        },
    };
    await setAdvancedConfig(guildId, MODULE, migrated);
    return migrated;
}

export async function saveAdhkarV2Config(guildId: string, config: AdhkarV2Config): Promise<void> {
    await setAdvancedConfig(guildId, MODULE, config);
    await deleteAllGuildAdhkarConfigs(guildId);
    await saveAdhkarConfig(guildId, '__adhkar_v2__', config.generalChannelId, '');
}

export async function getAllAdhkarV2Guilds(): Promise<Array<{ guildId: string; config: AdhkarV2Config }>> {
    const result = new Map<string, AdhkarV2Config>();
    if (isFirestoreAvailable()) {
        for (const entry of await getAllModuleConfigs<AdhkarV2Config>(MODULE)) result.set(entry.guildId, entry);
    }
    const guildIds = new Set((await getAllAdhkarConfigs()).map(item => item.guildId));
    for (const guildId of guildIds) {
        if (result.has(guildId)) continue;
        const config = await getAdhkarV2Config(guildId);
        if (config) result.set(guildId, config);
    }
    return [...result.entries()].map(([guildId, config]) => ({ guildId, config }));
}
