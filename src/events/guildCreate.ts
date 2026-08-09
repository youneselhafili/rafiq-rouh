import { Events, Guild } from 'discord.js';
import { sendFirstJoinGuide } from '../services/guildOnboardingService';
import { logger } from '../utils/logger';

export const name = Events.GuildCreate;

export async function execute(guild: Guild) {
    try {
        await sendFirstJoinGuide(guild);
    } catch (error) {
        logger.error(`[Onboarding] Failed to send the first-join guide in guild ${guild.id}:`, error);
    }
}
