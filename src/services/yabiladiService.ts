import axios from 'axios';
import { logger } from '../utils/logger';

interface YabiladiTimings {
    Fajr: string;
    Dhuhr: string;
    Asr: string;
    Maghrib: string;
    Isha: string;
}

// Cache structure: key = "slug:YYYY-MM", value = full month map { "DD/MM": YabiladiTimings }
const monthlyCache = new Map<string, Map<string, YabiladiTimings>>();

function casablancaDateParts(now = new Date()): { day: string; month: string; year: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
    return { day: value('day'), month: value('month'), year: value('year') };
}

function getCacheKey(slug: string, now = new Date()): string {
    const { year, month } = casablancaDateParts(now);
    return `${slug}:${year}-${month}`;
}

/**
 * Parses a full month's prayer table from Yabiladi HTML.
 * Returns a map of { "DD": YabiladiTimings } for every day in the table.
 */
export function parseMonthlyTable(html: string): Map<string, YabiladiTimings> | null {
    const dayMap = new Map<string, YabiladiTimings>();
    const tableRegex = /<table\b[^>]*class=(?:"[^"]*\bprayer(?:-table)?\b[^"]*"|'[^']*\bprayer(?:-table)?\b[^']*')[^>]*>[\s\S]*?<\/table>/gi;
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
        const rowRegex = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
        let rowMatch: RegExpExecArray | null;
        while ((rowMatch = rowRegex.exec(tableMatch[0])) !== null) {
            const rowHtml = rowMatch[0];
            if (/<th\b/i.test(rowHtml)) continue;

            // Yabiladi now wraps the date in nested spans, so read it from the
            // complete row instead of expecting it directly inside the <td>.
            const dateMatch = rowHtml.match(/\b(\d{1,2})\/(\d{1,2})\b/);
            if (!dateMatch) continue;
            const dateKey = `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}`;
            const times = [...rowHtml.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b/g)]
                .map(match => `${match[1]}:${match[2]}`);

            if (times.length >= 5) {
                dayMap.set(dateKey, {
                    Fajr: times[0], Dhuhr: times[1], Asr: times[2],
                    Maghrib: times[3], Isha: times[4],
                });
            }
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
    const { day, month } = casablancaDateParts(now);
    const todayKey = `${day}/${month}`;
    const cacheKey = getCacheKey(slug, now);

    // ── 1. Return from cache if this month's data is already loaded ────────
    const cached = monthlyCache.get(cacheKey);
    if (cached) {
        const timings = cached.get(todayKey);
        if (timings) {
            logger.info(`📅 Yabiladi cache hit for ${slug} — day ${todayKey}`);
            return timings;
        }
        logger.warn(`⚠️ Yabiladi cache exists for ${slug} but no entry for day ${todayKey}`);
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

        return dayMap.get(todayKey) ?? null;

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
