import { AdhkarCategory, AdhkarItem, Reciter, RadioStation, Moshaf } from '../types';
import * as catalog from '../bootstrap/catalogBuilder';
// LIVE_MAKKAH_URL and LIVE_MADINA_URL removed

// ─── Initialization ───────────────────────────────────────────

export function initContentService(): void {
    catalog.initializeCatalogs();
}

// ─── Adhkar ───────────────────────────────────────────────────

export function getAllAdhkarCategories(): AdhkarCategory[] {
    return catalog.getAdhkarCategories();
}

export function getAdhkarByKey(key: string): AdhkarItem[] {
    const category = catalog.getAdhkarCategories().find(c => c.key === key);
    return category?.items || [];
}

export function getAdhkarCategory(key: string): AdhkarCategory | undefined {
    return catalog.getAdhkarCategories().find(c => c.key === key);
}

export function getAllAdhkarCategoryNames():
    { key: string; name: string; defaultTime?: string; group: string; emoji: string }[] {
    return catalog.getAdhkarCategories().map(c => ({
        key: c.key,
        name: c.name,
        defaultTime: c.defaultTime,
        group: c.group,
        emoji: c.emoji,
    })) as any;
}

// ─── Reciters ─────────────────────────────────────────────────

export function getReciters(): Reciter[] {
    return catalog.getReciters();
}

export function getReciterById(id: number): Reciter | undefined {
    return catalog.getReciters().find(r => r.id === id);
}

export function getReciterByName(name: string): Reciter | undefined {
    return catalog.getReciters().find(r => r.name.includes(name));
}

export function searchReciters(query: string): Reciter[] {
    const all = catalog.getReciters();
    if (!query) return all;
    return all.filter(r => r.name.includes(query) || r.name.toLowerCase().includes(query.toLowerCase()));
}

export function buildSurahUrls(moshaf: Moshaf): string[] {
    const surahIds = moshaf.surah_list.split(',').map(Number);
    return surahIds.map(id => {
        const paddedId = id.toString().padStart(3, '0');
        return `${moshaf.server}${paddedId}.mp3`;
    });
}

// ─── Radios ───────────────────────────────────────────────────

export function getRadios(): RadioStation[] {
    return catalog.getRadios();
}

export function getRadioById(id: number): RadioStation | undefined {
    return catalog.getRadios().find(r => r.id === id);
}

export function getAllRadios(): RadioStation[] {
    return catalog.getRadios();
}

export function getRadioWithLive(): RadioStation[] {
    return catalog.getRadios();
}

export function getRadioByName(name: string): RadioStation | undefined {
    return catalog.getRadios().find(r => r.name.includes(name));
}
