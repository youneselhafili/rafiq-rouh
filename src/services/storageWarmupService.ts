import { Client } from 'discord.js';
import { canAttemptFirebase } from '../config/firebase';
import { getAllDMUserConfigs } from './dmSubscriptionService';
import { listPersonalGuildKhatmas } from './personalGuildKhatmaService';
import { logger } from '../utils/logger';

/**
 * Hydrate the local mirror while Firebase is healthy so a later outage does
 * not start with an empty local cache for user-owned data.
 */
export async function warmLocalStorageMirror(client: Client): Promise<void> {
    if (!canAttemptFirebase()) {
        logger.info('[Storage] Firebase mirror unavailable at startup; using existing local data.');
        return;
    }

    await getAllDMUserConfigs();
    for (const guildId of client.guilds.cache.keys()) {
        if (!canAttemptFirebase()) break;
        await listPersonalGuildKhatmas(guildId).catch(error => {
            logger.warn(`[Storage] Could not warm personal Khatma mirror for ${guildId}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    logger.success('[Storage] Local user-data mirror warmed from Firebase.');
}
