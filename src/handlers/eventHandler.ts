import { Client } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

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

            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args));
            } else {
                client.on(event.name, (...args) => event.execute(...args));
            }

            logger.info(`🎧 Loaded event: ${event.name} ${event.once ? '(once)' : ''}`);
        } catch (error) {
            logger.error(`❌ Failed to load event ${file}:`, error);
        }
    }
}
