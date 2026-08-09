import * as fs from 'fs';
import * as path from 'path';
import { getModuleConfig, isFirestoreAvailable, setModuleConfig, deleteModuleConfig } from './guildConfigService';

const GUILDS_DIR = path.join(process.cwd(), 'data', 'guilds');

function filePath(guildId: string): string {
    return path.join(GUILDS_DIR, `${guildId}.json`);
}

function readLocal(guildId: string): Record<string, any> {
    try {
        const fp = filePath(guildId);
        if (!fs.existsSync(fp)) return { guildId, createdAt: new Date().toISOString() };
        return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
        return { guildId, createdAt: new Date().toISOString() };
    }
}

function writeLocal(guildId: string, data: Record<string, any>): void {
    fs.mkdirSync(GUILDS_DIR, { recursive: true });
    data.guildId = guildId;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath(guildId), JSON.stringify(data, null, 2), 'utf-8');
}

export async function getAdvancedConfig<T>(guildId: string, moduleName: string): Promise<T | null> {
    if (isFirestoreAvailable()) return getModuleConfig<T>(guildId, moduleName);
    const guild = readLocal(guildId);
    return (guild[moduleName] as T | undefined) ?? null;
}

export async function setAdvancedConfig<T>(guildId: string, moduleName: string, value: T): Promise<void> {
    if (isFirestoreAvailable()) {
        await setModuleConfig(guildId, moduleName, value);
        return;
    }
    const guild = readLocal(guildId);
    guild[moduleName] = value;
    writeLocal(guildId, guild);
}

export async function deleteAdvancedConfig(guildId: string, moduleName: string): Promise<void> {
    if (isFirestoreAvailable()) {
        await deleteModuleConfig(guildId, moduleName);
        return;
    }
    const guild = readLocal(guildId);
    delete guild[moduleName];
    writeLocal(guildId, guild);
}
