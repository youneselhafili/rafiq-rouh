import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Client } from 'discord.js';
import { logger } from '../utils/logger';
import { sendAuditLog } from './auditLogService';

const BLACKLIST_FILE = path.join(process.cwd(), 'data', 'blacklist.json');

// How many days before a blacklisted URL is given a second chance.
const RETRY_INTERVAL_DAYS = 3;

// How long between scheduler ticks — check every 6 hours, but only retry entries
// whose RETRY_INTERVAL_DAYS window has elapsed.
const SCHEDULER_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

export interface BlacklistEntry {
    url: string;
    addedAt: string;
    reason: string;
    /** ISO timestamp of the last retry attempt (undefined = never retried) */
    lastRetried?: string;
    /** Total number of retry attempts made */
    retryCount?: number;
}

interface BlacklistData {
    urls: BlacklistEntry[];
}

let cache: BlacklistData | null = null;
let schedulerHandle: NodeJS.Timeout | null = null;

// ─── Read / Write ────────────────────────────────────────────────────────────

function readBlacklist(): BlacklistData {
    if (cache) return cache;
    try {
        if (!fs.existsSync(BLACKLIST_FILE)) return { urls: [] };
        const raw = fs.readFileSync(BLACKLIST_FILE, 'utf-8');
        cache = JSON.parse(raw) as BlacklistData;
        return cache;
    } catch {
        logger.warn('[Blacklist] Failed to read blacklist file. Using empty list.');
        return { urls: [] };
    }
}

function writeBlacklist(data: BlacklistData): void {
    try {
        fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true });
        fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2), 'utf-8');
        cache = data;
    } catch (error) {
        logger.warn(`[Blacklist] Failed to write blacklist file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function isBlacklisted(url: string): boolean {
    const data = readBlacklist();
    return data.urls.some(entry => entry.url === url);
}

export function addToBlacklist(url: string, reason = 'تكرار فشل الاتصال'): void {
    const data = readBlacklist();
    if (data.urls.some(entry => entry.url === url)) return;
    data.urls.push({ url, addedAt: new Date().toISOString(), reason, retryCount: 0 });
    writeBlacklist(data);
    logger.warn(`[Blacklist] Added URL to blacklist: ${url} — ${reason}`);
}

export function removeFromBlacklist(url: string): boolean {
    const data = readBlacklist();
    const before = data.urls.length;
    data.urls = data.urls.filter(entry => entry.url !== url);
    if (data.urls.length === before) return false;
    writeBlacklist(data);
    logger.info(`[Blacklist] Removed URL from blacklist: ${url}`);
    return true;
}

export function getBlacklistedUrls(): BlacklistEntry[] {
    return readBlacklist().urls;
}

export function clearBlacklistCache(): void {
    cache = null;
}

// ─── Retry Scheduler ─────────────────────────────────────────────────────────

/** Returns entries whose last retry (or initial add) was ≥ RETRY_INTERVAL_DAYS ago. */
function getEntriesDueForRetry(): BlacklistEntry[] {
    const now = Date.now();
    const windowMs = RETRY_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    return readBlacklist().urls.filter(entry => {
        const lastCheck = entry.lastRetried ?? entry.addedAt;
        return now - new Date(lastCheck).getTime() >= windowMs;
    });
}

/** Attempt a lightweight HEAD (then GET) to check if a URL is reachable again. */
async function isUrlReachable(url: string): Promise<boolean> {
    try {
        const res = await axios.head(url, {
            timeout: 10000,
            headers: { 'User-Agent': 'Rafiq-Rouh/0.1 Quran audio player' },
        });
        return res.status >= 200 && res.status < 400;
    } catch {
        // Fall back to a small GET request
        try {
            const res = await axios.get(url, {
                timeout: 10000,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Rafiq-Rouh/0.1 Quran audio player',
                    Range: 'bytes=0-1023',
                },
            });
            // Immediately destroy the stream — we only need the status code
            res.data?.destroy?.();
            return res.status >= 200 && res.status < 400;
        } catch {
            return false;
        }
    }
}

async function runRetryTick(client: Client): Promise<void> {
    const due = getEntriesDueForRetry();
    if (due.length === 0) {
        logger.info('[Blacklist] Retry scheduler: no URLs due for retry.');
        return;
    }

    logger.info(`[Blacklist] Retry scheduler: testing ${due.length} URL(s)…`);

    const data = readBlacklist();
    const recovered: string[] = [];
    const stillBroken: string[] = [];

    for (const entry of due) {
        const reachable = await isUrlReachable(entry.url);

        // Update the entry in-place (cache is data.urls)
        const live = data.urls.find(e => e.url === entry.url);
        if (!live) continue;

        if (reachable) {
            // Remove from blacklist — it works again.
            data.urls = data.urls.filter(e => e.url !== entry.url);
            recovered.push(entry.url);
            logger.success(`[Blacklist] URL recovered and removed from blacklist: ${entry.url}`);
        } else {
            // Still broken — update lastRetried and increment counter.
            live.lastRetried = new Date().toISOString();
            live.retryCount = (live.retryCount ?? 0) + 1;
            stillBroken.push(entry.url);
            logger.warn(`[Blacklist] URL still unreachable (attempt #${live.retryCount}): ${entry.url}`);
        }
    }

    writeBlacklist(data);

    // Send a single audit log summarising the retry run if anything happened.
    if (recovered.length > 0 || stillBroken.length > 0) {
        const client_ = client;
        const guilds = [...client_.guilds.cache.keys()];
        const lines: string[] = [];

        if (recovered.length > 0) {
            lines.push(
                `✅ **${recovered.length}** رابط تعافى وأُزيل من القائمة السوداء تلقائياً:`,
                ...recovered.map(u => `\`${u}\``),
            );
        }
        if (stillBroken.length > 0) {
            lines.push(
                ``,
                `❌ **${stillBroken.length}** رابط لا يزال معطلاً (سيُعاد الفحص بعد ${RETRY_INTERVAL_DAYS} أيام):`,
                ...stillBroken.map(u => `\`${u}\``),
            );
        }

        for (const guildId of guilds) {
            sendAuditLog(client_, guildId, {
                system: 'quran',
                action: recovered.length > 0 ? 'Audio link error' : 'Audio link blacklisted',
                level: recovered.length > 0 && stillBroken.length === 0 ? 'success' : 'warning',
                details: lines.join('\n').slice(0, 4000),
            }).catch(() => {});
        }
    }
}

/**
 * Start the periodic blacklist retry scheduler.
 * Call once from the `ready` event after the client is available.
 */
export function initBlacklistRetryScheduler(client: Client): void {
    if (schedulerHandle) return; // Already running

    logger.info(`[Blacklist] Retry scheduler started — checking every 6h, retrying after ${RETRY_INTERVAL_DAYS} days.`);

    // Run one tick shortly after startup to catch anything stale from a previous run.
    const initialDelay = setTimeout(() => {
        runRetryTick(client).catch(e =>
            logger.warn(`[Blacklist] Retry tick error: ${e instanceof Error ? e.message : String(e)}`),
        );
    }, 60 * 1000); // 1 minute after ready
    initialDelay.unref?.();

    schedulerHandle = setInterval(() => {
        runRetryTick(client).catch(e =>
            logger.warn(`[Blacklist] Retry tick error: ${e instanceof Error ? e.message : String(e)}`),
        );
    }, SCHEDULER_INTERVAL_MS);

    schedulerHandle.unref?.();
}
