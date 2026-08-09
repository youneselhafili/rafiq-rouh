import { Events, Role } from 'discord.js';
import { getAdhanAudioConfig, resolveAdhanAudience } from '../services/adhanAudioService';
import { logger } from '../utils/logger';

export const name = Events.GuildRoleDelete;

export async function execute(role: Role) {
    try {
        const config = await getAdhanAudioConfig(role.guild.id);
        if (config.audience === 'role' && config.roleId === role.id) {
            await resolveAdhanAudience(role.client, role.guild.id);
        }
    } catch (error) {
        logger.error('[Adhan] Failed to process deleted audience role:', error);
    }
}

