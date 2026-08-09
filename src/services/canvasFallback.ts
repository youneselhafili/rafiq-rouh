import { AttachmentBuilder } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Try to generate a canvas image. If the native canvas fails (e.g. missing
 * system libraries on the server), return null so the caller can fall back
 * to sending a plain text message with the same information.
 */
export async function tryBuildAttachment(
    generator: () => Promise<any> | any,
    name: string,
): Promise<AttachmentBuilder | null> {
    try {
        const buffer = await generator();
        if (!buffer) return null;
        return new AttachmentBuilder(buffer, { name });
    } catch (error) {
        logger.warn(`[Canvas] Image generation failed for ${name}; falling back to text message: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
