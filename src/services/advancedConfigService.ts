import { getModuleConfig, setModuleConfig, deleteModuleConfig } from './guildConfigService';

export async function getAdvancedConfig<T>(guildId: string, moduleName: string): Promise<T | null> {
    return getModuleConfig<T>(guildId, moduleName);
}

export async function setAdvancedConfig<T>(guildId: string, moduleName: string, value: T): Promise<void> {
    await setModuleConfig(guildId, moduleName, value);
}

export async function deleteAdvancedConfig(guildId: string, moduleName: string): Promise<void> {
    await deleteModuleConfig(guildId, moduleName);
}
