import * as fs from 'fs';
import * as path from 'path';
import { AdhkarCategory, AdhkarCatalog, Reciter, RecitersCatalog, RadioStation, RadiosCatalog } from '../types';
import { getSourcesByType } from '../registries/contentRegistry';
import { parseAdhkarFile } from '../parsers/adhkarParser';
import { parseReciterFiles } from '../parsers/reciterParser';
import { parseRadioFiles } from '../parsers/radioParser';
import { logger } from '../utils/logger';

// ─── Paths ────────────────────────────────────────────────────

const CATALOG_DIR = path.join(process.cwd(), 'data', 'catalog');
const ADHKAR_CATALOG_PATH = path.join(CATALOG_DIR, 'adhkar.json');
const RECITERS_CATALOG_PATH = path.join(CATALOG_DIR, 'reciters.json');
const RADIOS_CATALOG_PATH = path.join(CATALOG_DIR, 'radios.json');

const CATALOG_VERSION = '1.0.0';

// ─── In-memory cache ──────────────────────────────────────────

let cachedAdhkar: AdhkarCategory[] | null = null;
let cachedReciters: Reciter[] | null = null;
let cachedRadios: RadioStation[] | null = null;

// ─── Catalog generation ───────────────────────────────────────

function generateAdhkarCatalog(): AdhkarCatalog {
    const sources = getSourcesByType('adhkar');
    const categories: AdhkarCategory[] = [];

    for (const source of sources) {
        const parsed = parseAdhkarFile(source.filePath, source.id);
        if (parsed) {
            categories.push(parsed);
        }
    }

    return {
        version: CATALOG_VERSION,
        generatedAt: new Date().toISOString(),
        categories,
    };
}

function generateRecitersCatalog(): RecitersCatalog {
    const sources = getSourcesByType('reciter');
    const reciters = parseReciterFiles(sources.map(s => s.filePath));

    return {
        version: CATALOG_VERSION,
        generatedAt: new Date().toISOString(),
        reciters,
    };
}

function generateRadiosCatalog(): RadiosCatalog {
    const sources = getSourcesByType('radio');
    const radios = parseRadioFiles(sources.map(s => s.filePath));

    return {
        version: CATALOG_VERSION,
        generatedAt: new Date().toISOString(),
        radios,
    };
}

// ─── File I/O ─────────────────────────────────────────────────

function ensureCatalogDir(): void {
    if (!fs.existsSync(CATALOG_DIR)) {
        fs.mkdirSync(CATALOG_DIR, { recursive: true });
    }
}

function saveCatalog<T>(filePath: string, catalog: T): void {
    ensureCatalogDir();
    fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2), 'utf-8');
}

function loadCatalog<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Build all catalogs from raw files and persist them to data/catalog/.
 */
export function buildAndSaveCatalogs(): void {
    logger.info('Building content catalogs...');

    const adhkarCatalog = generateAdhkarCatalog();
    saveCatalog(ADHKAR_CATALOG_PATH, adhkarCatalog);
    logger.success(`Adhkar catalog saved: ${adhkarCatalog.categories.length} categories (${adhkarCatalog.categories.reduce((s, c) => s + c.items.length, 0)} items)`);

    const recitersCatalog = generateRecitersCatalog();
    saveCatalog(RECITERS_CATALOG_PATH, recitersCatalog);
    logger.success(`Reciters catalog saved: ${recitersCatalog.reciters.length} reciters`);

    const radiosCatalog = generateRadiosCatalog();
    saveCatalog(RADIOS_CATALOG_PATH, radiosCatalog);
    logger.success(`Radios catalog saved: ${radiosCatalog.radios.length} radios`);

    cachedAdhkar = adhkarCatalog.categories;
    cachedReciters = recitersCatalog.reciters;
    cachedRadios = radiosCatalog.radios;
}

/**
 * Initialize catalogs on startup. Loads from disk if available, otherwise builds.
 */
export function initializeCatalogs(): void {
    const adhkarCatalog = loadCatalog<AdhkarCatalog>(ADHKAR_CATALOG_PATH);
    const recitersCatalog = loadCatalog<RecitersCatalog>(RECITERS_CATALOG_PATH);
    const radiosCatalog = loadCatalog<RadiosCatalog>(RADIOS_CATALOG_PATH);

    if (adhkarCatalog && recitersCatalog && radiosCatalog) {
        cachedAdhkar = adhkarCatalog.categories;
        cachedReciters = recitersCatalog.reciters;
        cachedRadios = radiosCatalog.radios;
        logger.info('Catalogs loaded from disk');
        logger.info(`  Adhkar: ${cachedAdhkar.length} categories (${cachedAdhkar.reduce((s, c) => s + c.items.length, 0)} items)`);
        logger.info(`  Reciters: ${cachedReciters.length}`);
        logger.info(`  Radios: ${cachedRadios.length}`);
    } else {
        buildAndSaveCatalogs();
    }
}

/**
 * Force rebuild all catalogs and overwrite disk files.
 */
export function rebuildCatalogs(): void {
    cachedAdhkar = null;
    cachedReciters = null;
    cachedRadios = null;
    buildAndSaveCatalogs();
}

/**
 * Get cached adhkar categories (must call initializeCatalogs or buildAndSaveCatalogs first).
 */
export function getAdhkarCategories(): AdhkarCategory[] {
    if (!cachedAdhkar) {
        const catalog = loadCatalog<AdhkarCatalog>(ADHKAR_CATALOG_PATH);
        if (catalog) cachedAdhkar = catalog.categories;
    }
    return cachedAdhkar ?? [];
}

/**
 * Get cached reciters (must call initializeCatalogs or buildAndSaveCatalogs first).
 */
export function getReciters(): Reciter[] {
    if (!cachedReciters) {
        const catalog = loadCatalog<RecitersCatalog>(RECITERS_CATALOG_PATH);
        if (catalog) cachedReciters = catalog.reciters;
    }
    return cachedReciters ?? [];
}

/**
 * Get cached radios (must call initializeCatalogs or buildAndSaveCatalogs first).
 */
export function getRadios(): RadioStation[] {
    if (!cachedRadios) {
        const catalog = loadCatalog<RadiosCatalog>(RADIOS_CATALOG_PATH);
        if (catalog) cachedRadios = catalog.radios;
    }
    return cachedRadios ?? [];
}
