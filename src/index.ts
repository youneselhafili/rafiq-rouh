import { Client, GatewayIntentBits, Partials } from 'discord.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { initContentService } from './services/contentService';
import { buildQuranRegistry } from './quran/quranRegistry';
import { initializeFirebase } from './config/firebase';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

process.on('unhandledRejection', reason => {
    logger.error('Unhandled promise rejection caught by process guard:', reason);
});

process.on('uncaughtException', error => {
    logger.error('Uncaught exception caught by process guard:', error);
});
// Add FFmpeg to PATH for @discordjs/voice audio processing
const ffmpegDir = path.join(
    process.env.LOCALAPPDATA || 'C:\\Users\\Administrator\\AppData\\Local',
    'Microsoft', 'WinGet', 'Packages',
    'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'ffmpeg-8.1.1-full_build', 'bin'
);
if (!process.env.PATH?.includes('ffmpeg')) {
    process.env.PATH = `${ffmpegDir};${process.env.PATH || ''}`;
}

// Define ExtendedClient interface (since we exported it from commandHandler)
import { ExtendedClient } from './handlers/commandHandler';

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.GuildMember],
}) as ExtendedClient;

async function bootstrap() {
    try {
        logger.info('🚀 Starting رفيق الروح bot...');

        // 1. Initialize Firebase (optional — fallback to file-based if not configured)
        try {
            initializeFirebase();
        } catch (error) {
            logger.warn(`Firebase not configured: ${error instanceof Error ? error.message : 'unknown error'}`);
            logger.warn('Guild configs will use local file-based storage (data/guilds/).');
        }

        // 2. Initialize Content Catalogs
        initContentService();

        // 3. Build Quran Registry (reciters, radios — independent of adhkar/adhan)
        buildQuranRegistry();

        // 4. Initialize Cron Jobs (these need client, scheduled after login)
        //    Done after loadCommands/loadEvents

        // 3. Load Handlers
        await loadCommands(client);
        loadEvents(client);

        // 3. Login to Discord
        if (!process.env.DISCORD_TOKEN) {
            throw new Error('DISCORD_TOKEN is missing in .env file!');
        }

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        logger.error('Failed to start the bot:', error);
        process.exit(1);
    }
}

bootstrap();


