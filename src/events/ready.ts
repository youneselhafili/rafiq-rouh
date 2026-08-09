import { ActivityType, Events, Client } from 'discord.js';
import { ExtendedClient, deployCommands } from '../handlers/commandHandler';
import { initAdhanCrons } from '../services/adhanService';
import { initJumuahCron } from '../services/jumuahService';
import { initSalawatCrons } from '../services/salawatService';
import { initAdhkarCrons } from '../services/adhkarService';
import { logger } from '../utils/logger';
import { initializeQuranSystems } from '../services/quranRadioServiceV2';
import { initPersonalDMScheduler } from '../services/personalDmSchedulerService';
import { startKhatmaCron } from '../services/khatmaService';
import { startDashboardApi } from '../services/dashboardApiService';
import { acquirePrimaryRuntime } from '../services/runtimeLeadershipService';
import { initDonateScheduler } from '../services/donateSchedulerService';
import { buildApplicationDescription, getBotCatalogStats } from '../services/botInfoService';

export const name = Events.ClientReady;
export const once = true;

async function ensureApplicationProfile(client: ExtendedClient): Promise<void> {
    try {
        const application = await client.application?.fetch();
        if (!application || !client.user) return;

        const description = buildApplicationDescription();
        const tags = ['قرآن', 'أذان', 'أذكار', 'ختمة', 'إسلامي'];
        const updates: Parameters<typeof application.edit>[0] = {};

        if (application.description !== description) updates.description = description;
        if (JSON.stringify(application.tags || []) !== JSON.stringify(tags)) updates.tags = tags;

        if (!application.icon) {
            const avatarUrl = client.user.displayAvatarURL({ extension: 'png', size: 256 });
            const response = await fetch(avatarUrl);
            if (!response.ok) throw new Error(`Avatar download failed: HTTP ${response.status}`);
            updates.icon = (globalThis as any).Buffer.from(await response.arrayBuffer());
        }

        if (Object.keys(updates).length) {
            await application.edit(updates);
            logger.success('Discord application bio, tags and icon synchronized.');
        } else {
            logger.info('Discord application profile is already up to date.');
        }
    } catch (error) {
        logger.warn(`Could not synchronize the Discord application profile: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function execute(client: ExtendedClient) {
    logger.success(`Logged in as ${client.user?.tag}!`);
    if (!await acquirePrimaryRuntime()) {
        logger.warn('Duplicate bot process detected: Discord events and background jobs are disabled in this instance.');
        return;
    }
    startDashboardApi(client);

    // Deploy slash commands to Discord
    await deployCommands(client);

    // Discord activity cards use the application icon, not the bot avatar.
    await ensureApplicationProfile(client);

    // Set bot presence
    const stats = getBotCatalogStats();
    client.user?.setActivity({
        name: `القرآن 24/24 • ${stats.reciters} قارئ | /how_to_use`,
        type: ActivityType.Listening,
    });

    // Initialize cron jobs
    logger.info('Initializing background jobs...');
    // Establish the normal Quran source before prayer recovery can activate the Friday override.
    await initializeQuranSystems(client);
    initAdhanCrons(client);
    initJumuahCron(client);
    await initSalawatCrons(client);
    await initAdhkarCrons(client);
    initPersonalDMScheduler(client);
    startKhatmaCron(client);
    initDonateScheduler(client);
    logger.success('Background jobs initialized.');
}
