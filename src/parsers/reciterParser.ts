import * as fs from 'fs';
import * as path from 'path';
import { Reciter, Moshaf } from '../types';
import { logger } from '../utils/logger';

interface ParsedReciterData {
    name: string;
    surahUrls: { name: string; url: string }[];
}

function parseReciterFileContent(filePath: string): ParsedReciterData | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        const surahUrls: { name: string; url: string }[] = [];
        const name = path.basename(filePath, '.txt');

        for (const line of lines) {
            const sepIndex = line.indexOf('=');
            if (sepIndex === -1) continue;
            const surahName = line.substring(0, sepIndex).trim();
            const url = line.substring(sepIndex + 1).trim();
            if (url) {
                surahUrls.push({ name: surahName, url });
            }
        }

        if (surahUrls.length === 0) return null;
        return { name, surahUrls };
    } catch (err) {
        logger.error(`Failed to parse reciter file ${filePath}:`, err);
        return null;
    }
}

function convertToReciter(parsed: ParsedReciterData, id: number): Reciter {
    const surahList = parsed.surahUrls.map((_, i) => (i + 1).toString()).join(',');
    const serverUrl = parsed.surahUrls.length > 0
        ? parsed.surahUrls[0].url.substring(0, parsed.surahUrls[0].url.lastIndexOf('/') + 1)
        : '';

    const moshaf: Moshaf = {
        id,
        name: parsed.name,
        server: serverUrl,
        surah_total: parsed.surahUrls.length,
        surah_list: surahList,
    };

    return {
        id,
        name: parsed.name,
        letter: parsed.name.charAt(0),
        moshaf: [moshaf],
    };
}

let idCounter = 1;

export function parseReciterFiles(filePaths: string[]): Reciter[] {
    const reciters: Reciter[] = [];
    idCounter = 1;

    for (const filePath of filePaths) {
        const parsed = parseReciterFileContent(filePath);
        if (parsed) {
            reciters.push(convertToReciter(parsed, idCounter++));
        }
    }

    return reciters;
}

export function resetReciterIdCounter(): void {
    idCounter = 1;
}
