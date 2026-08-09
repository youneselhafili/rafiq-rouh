import { Client, Events } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { isPrimaryRuntime } from '../services/runtimeLeadershipService';

export interface BotEvent {
    name: string;
    once?: boolean;
    execute: (...args: unknown[]) => Promise<void> | void;
}

/**
 * Dynamically loads all event files from src/events
 */
export function loadEvents(client: Client): void {
    const eventsPath = path.join(__dirname, '..', 'events');

    if (!fs.existsSync(eventsPath)) {
        logger.warn('Events directory not found.');
        return;
    }

    const eventFiles = fs.readdirSync(eventsPath).filter(
        (file) => (file.endsWith('.ts') && !file.endsWith('.d.ts')) || file.endsWith('.js')
    );

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        try {
            const event: BotEvent = require(filePath);

            const execute = (...args: unknown[]) => {
                if (event.name !== Events.ClientReady && !isPrimaryRuntime()) return;
                return event.execute(...args);
            };
            if (event.once) client.once(event.name, execute);
            else client.on(event.name, execute);

            logger.info(`🎧 Loaded event: ${event.name} ${event.once ? '(once)' : ''}`);
        } catch (error) {
            logger.error(`❌ Failed to load event ${file}:`, error);
        }
    }
}
