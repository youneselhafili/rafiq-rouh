import * as fs from 'fs';
import * as path from 'path';
import { QuranReciterSource, QuranRadioSource, QuranSource, QuranContentType } from '../types';
import { parseReciterFiles } from './reciterStore';
import { parseRadioFiles } from './radioStore';
import { logger } from '../utils/logger';

// ─── Paths ────────────────────────────────────────────────────

const DATA_RAW = path.join(process.cwd(), 'data', 'raw');
const RECITERS_DIR = path.join(DATA_RAW, 'القراء المفضلون');
const RADIOS_DIR = path.join(DATA_RAW, 'القنوات');

const RECITER_SUBDIR = 'المكتبة الصوتية';

// ─── State (cached singleton) ─────────────────────────────────

let cachedReciters: QuranReciterSource[] | null = null;
let cachedRadios: QuranRadioSource[] | null = null;

// ─── File Discovery ───────────────────────────────────────────

function discoverFavFiles(): string[] {
    if (!fs.existsSync(RECITERS_DIR)) {
        logger.warn(`[QuranRegistry] Favorite Reciters directory not found: ${RECITERS_DIR}`);
        return [];
    }
    return fs.readdirSync(RECITERS_DIR, { encoding: 'utf-8' })
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(RECITERS_DIR, f));
}

function discoverLibFiles(): string[] {
    const subPath = path.join(DATA_RAW, RECITER_SUBDIR);
    if (!fs.existsSync(subPath)) {
        logger.warn(`[QuranRegistry] Library directory not found: ${subPath}`);
        return [];
    }
    return fs.readdirSync(subPath, { encoding: 'utf-8' })
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(subPath, f));
}

function discoverRadioFiles(): string[] {
    if (!fs.existsSync(RADIOS_DIR)) {
        logger.warn(`[QuranRegistry] Radios directory not found: ${RADIOS_DIR}`);
        return [];
    }

    return fs.readdirSync(RADIOS_DIR, { encoding: 'utf-8' })
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(RADIOS_DIR, f));
}

// ─── Initialization ───────────────────────────────────────────

/**
 * Build the Quran registry by scanning raw files, classifying them
 * by content, and parsing them into structured objects.
 * Fully isolated from adhkar/adhan/salawat systems.
 */
export function buildQuranRegistry(): void {
    logger.info('[QuranRegistry] Building Quran content registry...');

    const favFiles = discoverFavFiles();
    const libFiles = discoverLibFiles();

    const favs = parseReciterFiles(favFiles, 1, 'reciter_').map(r => ({ ...r, category: 'favorite' as const }));
    const libs = parseReciterFiles(libFiles, 100, 'reciter_').map(r => ({ ...r, category: 'library' as const }));

    cachedReciters = [...favs, ...libs];
    logger.success(`[QuranRegistry] Loaded ${cachedReciters.length} reciters (${favFiles.length + libFiles.length} files scanned)`);

    // Radios
    const radioFiles = discoverRadioFiles();
    cachedRadios = parseRadioFiles(radioFiles);
    logger.success(`[QuranRegistry] Loaded ${cachedRadios.length} radios (${radioFiles.length} files scanned)`);
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Get all parsed reciters with full surah names preserved.
 */
export function getAllReciters(): QuranReciterSource[] {
    if (!cachedReciters) {
        buildQuranRegistry();
    }
    return cachedReciters ?? [];
}

/**
 * Get a single reciter by ID.
 */
export function getReciterById(id: string): QuranReciterSource | undefined {
    return getAllReciters().find(r => r.id === id);
}

/**
 * Get all parsed radios (file-based only).
 */
export function getAllRadios(): QuranRadioSource[] {
    if (!cachedRadios) {
        buildQuranRegistry();
    }
    return cachedRadios ?? [];
}

/**
 * Get all radios including live stations (Makkah, Madinah).
 */
export function getRadiosWithLiveStations(): QuranRadioSource[] {
    return getAllRadios();
}

/**
 * Get the unified list of all Quran sources for the control panel.
 */
export function getQuranSourceList(): QuranSource[] {
    const sources: QuranSource[] = [];

    for (const reciter of getAllReciters()) {
        sources.push({ id: reciter.id, type: 'reciter', label: reciter.name });
    }

    for (const radio of getRadiosWithLiveStations()) {
        sources.push({ id: radio.id, type: 'radio', label: radio.name });
    }

    sources.push({
        id: 'audio_library_main',
        type: 'audio_library',
        label: 'المكتبة الصوتية للقرآن الكريم',
    });

    return sources;
}

/**
 * Look up a source by its ID.
 */
export function findSourceById(id: string): { type: QuranContentType; label: string } | null {
    const reciter = getReciterById(id);
    if (reciter) return { type: 'reciter', label: reciter.name };

    const radio = getRadiosWithLiveStations().find(r => r.id === id);
    if (radio) return { type: 'radio', label: radio.name };

    if (id === 'audio_library_main') {
        return { type: 'audio_library', label: 'المكتبة الصوتية للقرآن الكريم' };
    }

    return null;
}

