import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { initializeFirebase } from './src/config/firebase';
import { isFirestoreAvailable, setModuleConfig } from './src/services/guildConfigService';
import type { AdhkarConfigDoc, AdhanConfigDoc, SalawatConfigDoc, QuranRadioConfigDoc } from './src/types/config';
import { logger } from './src/utils/logger';

dotenv.config();

interface GuildFile {
    guildId: string;
    adhkar?: Array<{ type: string; channelId: string; time: string; city?: string; country?: string }>;
    adhan?: Array<{ country: string; city: string; timezone: string; channelId: string; roleId?: string }>;
    salawat?: Array<{ channelId: string; intervalHours: number }>;
    quranRadio?: { voiceChannelId: string; textChannelId: string; twentyFourSeven?: boolean; defaultSource?: string } | null;
}

const GUILDS_DIR = path.join(process.cwd(), 'data', 'guilds');

async function migrate() {
    initializeFirebase();

    if (!isFirestoreAvailable()) {
        logger.error('Firebase is not available. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in .env');
        process.exit(1);
    }

    if (!fs.existsSync(GUILDS_DIR)) {
        logger.info('No data/guilds directory found. Nothing to migrate.');
        process.exit(0);
    }

    const files = fs.readdirSync(GUILDS_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        logger.info('No guild JSON files found. Nothing to migrate.');
        process.exit(0);
    }

    let migrated = 0;
    let errors = 0;

    for (const file of files) {
        const filePath = path.join(GUILDS_DIR, file);
        const guildId = file.replace(/\.json$/, '');

        try {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as GuildFile;
            if (!raw.guildId) continue;

            // Migrate adhkar configs
            if (raw.adhkar && raw.adhkar.length > 0) {
                const times: Record<string, string> = {};
                const types = raw.adhkar.map(a => {
                    times[a.type] = a.time;
                    return a.type;
                });
                const adhkarDoc: AdhkarConfigDoc = {
                    enabled: true,
                    channelId: raw.adhkar[0].channelId,
                    types,
                    times,
                    updatedAt: null,
                };
                await setModuleConfig(guildId, 'adhkarConfig', adhkarDoc);
                logger.info(`  Migrated adhkar config (${types.length} types) for guild ${guildId}`);
            }

            // Migrate adhan configs
            if (raw.adhan && raw.adhan.length > 0) {
                const zones = raw.adhan.map(a => ({
                    country: a.country,
                    city: a.city,
                    timezone: a.timezone,
                    channelId: a.channelId,
                    roleId: a.roleId ?? null,
                    enabled: true,
                }));
                const adhanDoc: AdhanConfigDoc = {
                    enabled: true,
                    zones,
                    updatedAt: null,
                };
                await setModuleConfig(guildId, 'adhanConfig', adhanDoc);
                logger.info(`  Migrated adhan config (${zones.length} zones) for guild ${guildId}`);
            }

            // Migrate salawat configs
            if (raw.salawat && raw.salawat.length > 0) {
                const salawatDoc: SalawatConfigDoc = {
                    enabled: true,
                    channelId: raw.salawat[0].channelId,
                    intervalHours: raw.salawat[0].intervalHours,
                    updatedAt: null,
                };
                await setModuleConfig(guildId, 'salawatConfig', salawatDoc);
                logger.info(`  Migrated salawat config for guild ${guildId}`);
            }

            // Migrate quran radio config
            if (raw.quranRadio) {
                const quranDoc: QuranRadioConfigDoc = {
                    enabled: true,
                    voiceChannelId: raw.quranRadio.voiceChannelId,
                    textChannelId: raw.quranRadio.textChannelId,
                    twentyFourSeven: raw.quranRadio.twentyFourSeven ?? false,
                    defaultSource: raw.quranRadio.defaultSource ?? 'none',
                    updatedAt: null,
                };
                await setModuleConfig(guildId, 'quranRadioConfig', quranDoc);
                logger.info(`  Migrated quran radio config for guild ${guildId}`);
            }

            migrated++;
            logger.success(`Migrated guild ${guildId} (${file})`);
        } catch (error) {
            errors++;
            logger.error(`Failed to migrate guild from ${file}:`, error);
        }
    }

    logger.success(`Migration complete: ${migrated} guilds migrated, ${errors} errors.`);
    process.exit(errors > 0 ? 1 : 0);
}

migrate();
