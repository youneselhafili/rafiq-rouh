import * as dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { logger } from './src/utils/logger';

dotenv.config();

async function clearGlobalCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
    try {
        logger.info('Clearing global commands...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), { body: [] });
        logger.success('✅ Successfully cleared all global commands!');
    } catch (error) {
        logger.error('Failed to clear global commands:', error);
    }
}

clearGlobalCommands();
