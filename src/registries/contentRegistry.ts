import * as fs from 'fs';
import * as path from 'path';
import { ContentSource, ContentType } from '../types';
import { logger } from '../utils/logger';

// ─── Paths ────────────────────────────────────────────────────

const DATA_RAW = path.join(process.cwd(), 'data', 'raw');

const DIR_MAP: Record<ContentType, string> = {
    adhkar: path.join(DATA_RAW, 'أدعية و أذكار'),
    reciter: path.join(DATA_RAW, 'القرآن الكريم'),
    radio: path.join(DATA_RAW, 'القنوات'),
};

const RECITER_SUBDIR = 'المكتبة الصوتية للقرآن الكريم';

// ─── State ────────────────────────────────────────────────────

let registry: ContentSource[] | null = null;

// ─── Helpers ──────────────────────────────────────────────────

function scanFiles(dir: string, type: ContentType, prefix: string = ''): ContentSource[] {
    if (!fs.existsSync(dir)) {
        logger.warn(`Content registry: directory not found: ${dir}`);
        return [];
    }

    const results: ContentSource[] = [];
    const entries = fs.readdirSync(dir, { encoding: 'utf-8' });

    for (const name of entries) {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || !name.endsWith('.txt')) continue;

        const fileName = name.replace(/\.txt$/, '');
        const id = prefix ? `${prefix}:${fileName}` : fileName;

        results.push({ id, type, filePath: fullPath, label: fileName });
    }

    return results;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Build or return the cached content registry.
 */
export function buildRegistry(): ContentSource[] {
    if (registry) return registry;

    const sources: ContentSource[] = [
        ...scanFiles(DIR_MAP.adhkar, 'adhkar'),
        ...scanFiles(DIR_MAP.reciter, 'reciter'),
        ...scanFiles(path.join(DATA_RAW, RECITER_SUBDIR), 'reciter', 'riwayat'),
        ...scanFiles(DIR_MAP.radio, 'radio'),
    ];

    registry = sources;
    logger.info(`📦 Content registry built: ${sources.length} sources (${sources.filter(s => s.type === 'adhkar').length} adhkar, ${sources.filter(s => s.type === 'reciter').length} reciters, ${sources.filter(s => s.type === 'radio').length} radios)`);
    return sources;
}

/**
 * Get all registered content sources.
 */
export function getAllSources(): ContentSource[] {
    if (!registry) return buildRegistry();
    return registry;
}

/**
 * Get sources by content type.
 */
export function getSourcesByType(type: ContentType): ContentSource[] {
    return getAllSources().filter(s => s.type === type);
}

/**
 * Get a single source by its ID.
 */
export function getSourceById(id: string): ContentSource | undefined {
    return getAllSources().find(s => s.id === id);
}

/**
 * Get the raw directory path for a content type.
 */
export function getRawDir(type: ContentType): string {
    return DIR_MAP[type];
}

/**
 * Get the reciter subdirectory path (riwayat).
 */
export function getReciterSubDir(): string {
    return path.join(DATA_RAW, RECITER_SUBDIR);
}

/**
 * Clear the registry cache (useful for hot-reload).
 */
export function clearRegistry(): void {
    registry = null;
}

