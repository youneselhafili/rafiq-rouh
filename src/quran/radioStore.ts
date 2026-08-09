import * as fs from 'fs';
import * as path from 'path';
import { QuranRadioSource } from '../types';
import { classifyQuranFile } from './quranClassifier';
// Removed LIVE_MAKKAH_URL and LIVE_MADINA_URL
import { logger } from '../utils/logger';

const URL_REGEX = /^https?:\/\//;

interface RawRadioFile {
    filePath: string;
    name: string;
    streamUrl: string;
}

/**
 * Parse a single radio .txt file.
 * Expected format: line 1 = name, line 2 = stream URL.
 * Returns null if invalid.
 */
function parseRadioFile(filePath: string): RawRadioFile | null {
    const classification = classifyQuranFile(filePath);
    if (classification.type !== 'radio' || classification.confidence < 0.5) {
        logger.warn(`[RadioStore] Skipping non-radio file: ${path.basename(filePath)} (${classification.reason})`);
        return null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        const urlLine = lines.find(l => URL_REGEX.test(l));
        const nameLine = lines.find(l => !URL_REGEX.test(l));

        if (!urlLine || !nameLine) {
            logger.warn(`[RadioStore] Invalid radio file ${path.basename(filePath)}: missing name or URL`);
            return null;
        }

        logger.debug(`[RadioStore] Parsed radio "${nameLine}" → ${urlLine}`);
        return { filePath, name: nameLine, streamUrl: urlLine };
    } catch (err) {
        logger.error(`[RadioStore] Failed to parse ${path.basename(filePath)}:`, err);
        return null;
    }
}

/**
 * Parse multiple radio files into QuranRadioSource objects.
 */
export function parseRadioFiles(filePaths: string[]): QuranRadioSource[] {
    const radios: QuranRadioSource[] = [];
    let idCounter = 1;

    for (const filePath of filePaths) {
        const parsed = parseRadioFile(filePath);
        if (parsed) {
            radios.push({
                id: `radio_${idCounter++}`,
                name: parsed.name,
                streamUrl: parsed.streamUrl,
            });
        }
    }

    logger.info(`[RadioStore] Loaded ${radios.length} radios from ${filePaths.length} files`);
    return radios;
}

// getRadiosWithLive removed
