import moment from 'moment-timezone';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { getAdhkarV2Config, getAllAdhkarV2Guilds } from './adhkarConfigServiceV2';
import { getPrimaryAdhanZone } from './adhanZoneService';

export interface JumuahV2Config {
    enabled: boolean;
    channelId: string;
    time: string;
    timezone: string;
    mentionEveryone: boolean;
    playKahfVoice: boolean;
    updatedBy?: string;
    deleted?: boolean;
}

const MODULE = 'jumuahV2';

export async function getJumuahV2Config(guildId: string): Promise<JumuahV2Config | null> {
    const existing = await getAdvancedConfig<JumuahV2Config>(guildId, MODULE);
    if (existing) return existing;
    const adhkar = await getAdhkarV2Config(guildId);
    if (!adhkar?.generalChannelId) return null;
    const zone = await getPrimaryAdhanZone(guildId);
    const migrated: JumuahV2Config = {
        enabled: true,
        channelId: adhkar.generalChannelId,
        time: '08:00',
        timezone: zone?.timezone && moment.tz.zone(zone.timezone) ? zone.timezone : 'Africa/Casablanca',
        mentionEveryone: true,
        playKahfVoice: true,
    };
    await setAdvancedConfig(guildId, MODULE, migrated);
    return migrated;
}

export async function saveJumuahV2Config(guildId: string, config: JumuahV2Config): Promise<void> {
    await setAdvancedConfig(guildId, MODULE, { ...config, deleted: false });
}

export async function disableAndDeleteJumuahV2Config(guildId: string, updatedBy: string): Promise<void> {
    const existing = await getJumuahV2Config(guildId);
    if (!existing) return;
    await setAdvancedConfig(guildId, MODULE, { ...existing, enabled: false, deleted: true, updatedBy });
}

export async function getAllJumuahV2Guilds(): Promise<Array<{ guildId: string; config: JumuahV2Config }>> {
    const result: Array<{ guildId: string; config: JumuahV2Config }> = [];
    for (const entry of await getAllAdhkarV2Guilds()) {
        const config = await getJumuahV2Config(entry.guildId);
        if (!config || config.deleted) continue;
        const channelId = config.channelId || entry.config.generalChannelId;
        result.push({ guildId: entry.guildId, config: { ...config, channelId } });
    }
    return result;
}
