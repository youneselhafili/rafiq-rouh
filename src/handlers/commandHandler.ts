import {
    Client,
    Collection,
    REST,
    Routes,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
} from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface BotCommand {
    data: any;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export interface ExtendedClient extends Client {
    commands: Collection<string, BotCommand>;
}

/**
 * Dynamically loads all command files from src/commands subdirectories
 */
export async function loadCommands(client: ExtendedClient): Promise<void> {
    client.commands = new Collection();

    const commandsPath = path.join(__dirname, '..', 'commands');

    if (!fs.existsSync(commandsPath)) {
        logger.warn('Commands directory not found.');
        return;
    }

    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);

        if (!fs.statSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(
            (file) => (file.endsWith('.ts') && !file.endsWith('.d.ts')) || file.endsWith('.js')
        );

        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            try {
                const commandData: any = require(filePath);

                if (commandData.data && commandData.execute) {
                    const command = commandData as BotCommand;
                    client.commands.set(command.data.name, command);
                    logger.info(`✅ Loaded command: /${command.data.name}`);
                } else {
                    logger.warn(`⚠️ Command file ${file} is missing "data" or "execute" export.`);
                }
            } catch (error) {
                logger.error(`❌ Failed to load command ${file}:`, error);
            }
        }
    }

    logger.success(`📦 Loaded ${client.commands.size} commands.`);
}

/**
 * Registers all slash commands with Discord API
 */
export async function deployCommands(client: ExtendedClient): Promise<boolean> {
    const commands = client.commands.map((cmd) => cmd.data.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    try {
        logger.info(`🔄 Refreshing ${commands.length} slash commands...`);

        // Keep global commands synchronized so commands removed from the code
        // are also removed from Discord in every server.
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands }
        );
        logger.success(`✅ Registered ${commands.length} global commands.`);

        if (process.env.GUILD_ID) {
            // Also synchronize the development guild for immediate updates.
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
                { body: commands }
            );
            logger.success(`✅ Registered ${commands.length} guild commands.`);
        }
        return true;
    } catch (error) {
        logger.error('Failed to deploy commands:', error);
        return false;
    }
}
