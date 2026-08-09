import { getModuleConfig, setModuleConfig, updateModuleConfig } from './guildConfigService';

export interface RolesConfig {
    adhkarRoleId?: string;
    salawatRoleId?: string;
    jumuahRoleId?: string;
    adhanRoleId?: string;
}

const MODULE_NAME = 'roles';

export async function getRolesConfig(guildId: string): Promise<RolesConfig> {
    const config = await getModuleConfig<RolesConfig>(guildId, MODULE_NAME);
    return config || {};
}

export async function setRolesConfig(guildId: string, config: RolesConfig): Promise<void> {
    await setModuleConfig(guildId, MODULE_NAME, config);
}

export async function updateRolesConfig(guildId: string, partialConfig: Partial<RolesConfig>): Promise<void> {
    await updateModuleConfig(guildId, MODULE_NAME, partialConfig);
}
