import * as fs from 'fs';
import * as path from 'path';
import { QuranReciterSource, QuranSurah } from '../types';
import { classifyQuranFile } from './quranClassifier';
import { logger } from '../utils/logger';

const LINE_REGEX = /^([\u0600-\u06FF\s]+)=\s*(https?:\/\/\S+)/;

interface RawReciterFile {
    filePath: string;
    name: string;
    surahs: QuranSurah[];
}

/**
 * Parse a single reciter .txt file into an ordered list of surahs.
 * Returns null if the file is invalid or has no surahs.
 */
function parseReciterFile(filePath: string): RawReciterFile | null {
    const classification = classifyQuranFile(filePath);
    if (classification.type !== 'reciter' || classification.confidence < 0.5) {
        logger.warn(`[ReciterStore] Skipping non-reciter file: ${path.basename(filePath)} (${classification.reason})`);
        return null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const surahs: QuranSurah[] = [];

        for (const line of lines) {
            const match = line.match(LINE_REGEX);
            if (match) {
                surahs.push({ name: match[1].trim(), url: match[2] });
            }
        }

        if (surahs.length === 0) {
            logger.warn(`[ReciterStore] No valid surah lines found in ${path.basename(filePath)}`);
            return null;
        }

        const name = path.basename(filePath, '.txt');
        logger.debug(`[ReciterStore] Parsed "${name}" with ${surahs.length} surahs`);
        return { filePath, name, surahs };
    } catch (err) {
        logger.error(`[ReciterStore] Failed to parse ${path.basename(filePath)}:`, err);
        return null;
    }
}

/**
 * Parse multiple reciter files into an array of QuranReciterSource objects.
 * Preserves surah order exactly as in the source files.
 */
export function parseReciterFiles(filePaths: string[], startId: number = 1, idPrefix: string = 'reciter_'): QuranReciterSource[] {
    const result: QuranReciterSource[] = [];
    let idCounter = startId;

    for (const filePath of filePaths) {
        const parsed = parseReciterFile(filePath);
        if (parsed) {
            result.push({
                id: `${idPrefix}${idCounter++}`,
                name: parsed.name,
                surahs: parsed.surahs,
            });
        }
    }

    logger.info(`[ReciterStore] Loaded ${result.length} reciters from ${filePaths.length} files`);
    return result;
}

/**
 * Parse reciter files from a directory (scans all .txt files).
 */
export function parseRecitersFromDirectory(dirPath: string): QuranReciterSource[] {
    if (!fs.existsSync(dirPath)) {
        logger.warn(`[ReciterStore] Directory not found: ${dirPath}`);
        return [];
    }

    const files = fs.readdirSync(dirPath, { encoding: 'utf-8' })
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(dirPath, f));

    const allReciters: QuranReciterSource[] = [];
    allReciters.push(...parseReciterFiles(files));

    // Also check for subdirectories (e.g. المكتبة الصوتية للقرآن الكريم)
    const subDirs = fs.readdirSync(dirPath, { encoding: 'utf-8' })
        .filter(f => fs.statSync(path.join(dirPath, f)).isDirectory());

    for (const subDir of subDirs) {
        const subPath = path.join(dirPath, subDir);
        const subFiles = fs.readdirSync(subPath, { encoding: 'utf-8' })
            .filter(f => f.endsWith('.txt'))
            .map(f => path.join(subPath, f));
        allReciters.push(...parseReciterFiles(subFiles));
    }

    return allReciters;
}
