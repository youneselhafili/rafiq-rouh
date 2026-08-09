import axios from 'axios';
import { logger } from '../utils/logger';

interface YabiladiTimings {
    Fajr: string;
    Dhuhr: string;
    Asr: string;
    Maghrib: string;
    Isha: string;
}

// Cache structure: key = "slug:YYYY-MM", value = full month map { "DD": YabiladiTimings }
const monthlyCache = new Map<string, Map<string, YabiladiTimings>>();

function getCacheKey(slug: string): string {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `${slug}:${yearMonth}`;
}

/**
 * Parses a full month's prayer table from Yabiladi HTML.
 * Returns a map of { "DD": YabiladiTimings } for every day in the table.
 */
function parseMonthlyTable(html: string): Map<string, YabiladiTimings> | null {
    const tableMatch = html.match(/<table[^>]*class="prayer"[^>]*>[\s\S]*?<\/table>/i);
    if (!tableMatch) return null;

    const tableHtml = tableMatch[0];
    const dayMap = new Map<string, YabiladiTimings>();

    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const rowHtml = rowMatch[0];
        if (rowHtml.includes('<th')) continue;

        const dateMatch = rowHtml.match(/<td[^>]*>\s*(\d{2})\/(\d{2})/);
        if (!dateMatch) continue;

        const day = dateMatch[1].padStart(2, '0');

        const timeRegex = /<td[^>]*>\s*(\d{2}:\d{2})/g;
        const times: string[] = [];
        let timeMatch: RegExpExecArray | null;
        while ((timeMatch = timeRegex.exec(rowHtml)) !== null) {
            times.push(timeMatch[1]);
        }

        if (times.length >= 5) {
            dayMap.set(day, {
                Fajr: times[0],
                Dhuhr: times[1],
                Asr: times[2],
                Maghrib: times[3],
                Isha: times[4],
            });
        }
    }

    return dayMap.size > 0 ? dayMap : null;
}

/**
 * Fetches and caches the full monthly prayer schedule from Yabiladi.
 * On subsequent calls within the same month, returns instantly from cache.
 * The cache is automatically invalidated when a new month starts (new key).
 */
export async function fetchYabiladiPrayerTimes(yabiladiId: number, slug: string): Promise<YabiladiTimings | null> {
    const now = new Date();
    const todayDay = String(now.getDate()).padStart(2, '0');
    const cacheKey = getCacheKey(slug);

    // ── 1. Return from cache if this month's data is already loaded ────────
    const cached = monthlyCache.get(cacheKey);
    if (cached) {
        const timings = cached.get(todayDay);
        if (timings) {
            logger.info(`📅 Yabiladi cache hit for ${slug} — day ${todayDay}`);
            return timings;
        }
        logger.warn(`⚠️ Yabiladi cache exists for ${slug} but no entry for day ${todayDay}`);
        return null;
    }

    // ── 2. First request this month: fetch page and build the monthly cache ─
    try {
        const url = `https://www.yabiladi.com/prieres/details/${yabiladiId}/${slug}.html`;
        logger.info(`🌐 Fetching Yabiladi monthly schedule: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.8',
            },
            timeout: 15000,
        });

        const dayMap = parseMonthlyTable(response.data);
        if (!dayMap) {
            logger.error(`Could not find prayer table in Yabiladi response for ${slug}`);
            return null;
        }

        // Store the full month in memory
        monthlyCache.set(cacheKey, dayMap);
        logger.success(`✅ Yabiladi ${slug}: cached ${dayMap.size} days for this month.`);

        return dayMap.get(todayDay) ?? null;

    } catch (error) {
        logger.error(`Failed to fetch Yabiladi prayer times: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Clears all cached monthly schedules.
 * Old months are automatically skipped (different cache key), but calling
 * this at start of a new month ensures stale entries are removed.
 */
export function clearYabiladiMonthlyCache(): void {
    const count = monthlyCache.size;
    monthlyCache.clear();
    if (count > 0) logger.info(`🗑️ Yabiladi monthly cache cleared (${count} entries).`);
}

