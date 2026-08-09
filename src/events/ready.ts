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

export const name = Events.ClientReady;
export const once = true;

async function ensureApplicationIcon(client: ExtendedClient): Promise<void> {
    try {
        const application = await client.application?.fetch();
        if (!application || !client.user) return;
        if (application.icon) {
            logger.info('Discord application icon is already configured.');
            return;
        }
        const avatarUrl = client.user.displayAvatarURL({ extension: 'png', size: 256 });
        const response = await fetch(avatarUrl);
        if (!response.ok) throw new Error(`Avatar download failed: HTTP ${response.status}`);
        const icon = (globalThis as any).Buffer.from(await response.arrayBuffer());
        await application.edit({ icon });
        logger.success('Discord application icon synchronized with the bot avatar.');
    } catch (error) {
        logger.warn(`Could not synchronize the Discord application icon: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function execute(client: ExtendedClient) {
    logger.success(`Logged in as ${client.user?.tag}!`);
    startDashboardApi(client);

    // Deploy slash commands to Discord
    await deployCommands(client);

    // Discord activity cards use the application icon, not the bot avatar.
    await ensureApplicationIcon(client);

    // Set bot presence
    client.user?.setActivity({
        name: '\u0627\u0644\u0642\u0631\u0622\u0646 \u0627\u0644\u0643\u0631\u064a\u0645 | \u0631\u0641\u064a\u0642 \u0627\u0644\u0631\u0648\u062d',
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
    logger.success('Background jobs initialized.');
}


