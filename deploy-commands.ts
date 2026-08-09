import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import { loadCommands, deployCommands, ExtendedClient } from './src/handlers/commandHandler';
import { logger } from './src/utils/logger';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] }) as ExtendedClient;

async function deploy() {
    try {
        if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
            logger.error('Missing DISCORD_TOKEN or CLIENT_ID in .env file');
            process.exit(1);
        }

        logger.info('Started deploying slash commands...');
        
        await loadCommands(client);
        await deployCommands(client);

        logger.success('✅ Successfully deployed all slash commands!');
        process.exit(0);
    } catch (error) {
        logger.error('Error deploying commands:', error);
        process.exit(1);
    }
}

deploy();
