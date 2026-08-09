import * as fs from 'fs';
import * as path from 'path';
import {
    Client, Guild, GuildMember, PermissionFlagsBits, VoiceBasedChannel,
} from 'discord.js';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { sendAuditLog } from './auditLogService';
import {
    acquireGuildPlaybackPriority, getPlaybackSnapshot, playLocalFileOnce,
    releaseGuildPlaybackPriority, resumePlayback,
} from './voicePlaybackService';

export type AdhanOperatingMode = 'voice_notification' | 'notification_only' | 'stopped';
export type AdhanAudience = 'everyone' | 'role';

export interface AdhanAudioConfig {
    mode: AdhanOperatingMode;
    audioChoice: string;
    volume: 0.25 | 0.5 | 0.75 | 1;
    audience: AdhanAudience;
    roleId?: string;
    missingRoleSince?: string;
    updatedBy?: string;
}

interface AdhanRuntime {
    lastVoiceAdhanAt?: string;
    randomPool: string[];
}

export interface AdhanAudienceResolution {
    mention: string;
    userIds: string[];
    voiceChannel: VoiceBasedChannel | null;
    fallbackEveryone: boolean;
}

const AUDIO_MODULE = 'adhanAudioV2';
const RUNTIME_MODULE = 'adhanAudioRuntime';
const ADHAN_DIR = path.join(process.cwd(), 'data', 'raw', 'الأذان');
const FAJR_FILE = 'أذان الفجر - مالك شيبة.mp3';
const DEDUPE_MS = 15 * 60 * 1000;
const activeAdhanPlaybacks = new Map<string, Promise<void>>();

export const DEFAULT_ADHAN_AUDIO_CONFIG: AdhanAudioConfig = {
    mode: 'notification_only',
    audioChoice: 'random',
    volume: 0.75,
    audience: 'everyone',
};

export function listAdhanAudioFiles(includeFajr = false): string[] {
    if (!fs.existsSync(ADHAN_DIR)) return [];
    return fs.readdirSync(ADHAN_DIR, { encoding: 'utf8' })
        .filter(name => name.toLowerCase().endsWith('.mp3'))
        .filter(name => includeFajr || name !== FAJR_FILE)
        .sort((a, b) => a.localeCompare(b, 'ar'));
}

export function adhanAudioLabel(file: string): string {
    return file.replace(/\.mp3$/i, '');
}

export function adhanStatusLabel(file: string): string {
    const label = adhanAudioLabel(file);
    const [kind, ...nameParts] = label.split(/\s*-\s*/);
    const muezzin = nameParts.join(' - ').trim();
    const adhanKind = kind.includes('الفجر') ? 'أذان الفجر' : 'الأذان';
    return muezzin ? `🕌 ${adhanKind} • ${muezzin}` : `🕌 ${adhanKind}`;
}

export async function getAdhanAudioConfig(guildId: string): Promise<AdhanAudioConfig> {
    return { ...DEFAULT_ADHAN_AUDIO_CONFIG, ...(await getAdvancedConfig<AdhanAudioConfig>(guildId, AUDIO_MODULE) || {}) };
}

export async function saveAdhanAudioConfig(guildId: string, config: AdhanAudioConfig): Promise<void> {
    await setAdvancedConfig(guildId, AUDIO_MODULE, config);
}

function humanVoiceMembers(guild: Guild): GuildMember[] {
    const unique = new Map<string, GuildMember>();
    for (const channel of guild.channels.cache.values()) {
        if (!channel.isVoiceBased()) continue;
        for (const member of channel.members.values()) {
            if (!member.user.bot) unique.set(member.id, member);
        }
    }
    return [...unique.values()];
}

function busiestChannel(members: GuildMember[]): VoiceBasedChannel | null {
    const counts = new Map<string, { channel: VoiceBasedChannel; count: number }>();
    for (const member of members) {
        const channel = member.voice.channel;
        if (!channel) continue;
        const current = counts.get(channel.id) || { channel, count: 0 };
        current.count += 1;
        counts.set(channel.id, current);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.channel || null;
}

async function fallbackMissingRole(client: Client, guildId: string, config: AdhanAudioConfig): Promise<void> {
    const now = Date.now();
    if (!config.missingRoleSince) {
        config.missingRoleSince = new Date(now).toISOString();
        await saveAdhanAudioConfig(guildId, config);
        await sendAuditLog(client, guildId, {
            level: 'error', system: 'Adhan', action: 'Configured audience role is missing',
            details: 'تم استعمال @everyone مؤقتاً. إذا استمر غياب الـRole مدة 48 ساعة سيتم اعتماد @everyone تلقائياً.',
        });
        return;
    }
    if (now - new Date(config.missingRoleSince).getTime() >= 48 * 60 * 60 * 1000) {
        config.audience = 'everyone';
        config.roleId = undefined;
        config.missingRoleSince = undefined;
        await saveAdhanAudioConfig(guildId, config);
        await sendAuditLog(client, guildId, {
            level: 'error', system: 'Adhan', action: 'Audience changed to @everyone after 48 hours',
            details: 'لم يعد الـRole المحدد موجوداً، لذلك تم تثبيت @everyone إلى أن يغيّره المشرف.',
        });
    }
}

export async function resolveAdhanAudience(client: Client, guildId: string): Promise<AdhanAudienceResolution> {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { mention: '@everyone', userIds: [], voiceChannel: null, fallbackEveryone: true };
    const config = await getAdhanAudioConfig(guildId);
    const allHumans = humanVoiceMembers(guild);

    try {
        const { getRolesConfig } = await import('./rolesConfigService');
        const rolesConfig = await getRolesConfig(guildId);
        const configuredRole = rolesConfig.adhanRoleId ? await guild.roles.fetch(rolesConfig.adhanRoleId).catch(() => null) : null;
        if (configuredRole) {
            const eligible = allHumans.filter(member => member.roles.cache.has(configuredRole.id));
            return {
                mention: `<@&${configuredRole.id}>`,
                userIds: eligible.map(member => member.id),
                voiceChannel: busiestChannel(eligible),
                fallbackEveryone: false,
            };
        }
    } catch {
        // Fall back to the legacy audience config if roles setup cannot be read.
    }
    if (config.audience === 'everyone') {
        return { mention: '@everyone', userIds: allHumans.map(member => member.id), voiceChannel: busiestChannel(allHumans), fallbackEveryone: false };
    }

    const role = config.roleId ? await guild.roles.fetch(config.roleId).catch(() => null) : null;
    if (!role) {
        await fallbackMissingRole(client, guildId, config);
        return { mention: '@everyone', userIds: allHumans.map(member => member.id), voiceChannel: busiestChannel(allHumans), fallbackEveryone: true };
    }
    if (config.missingRoleSince) {
        config.missingRoleSince = undefined;
        await saveAdhanAudioConfig(guildId, config);
    }
    const eligible = allHumans.filter(member => member.roles.cache.has(role.id));
    return {
        mention: eligible.map(member => `<@${member.id}>`).join(' '),
        userIds: eligible.map(member => member.id),
        voiceChannel: busiestChannel(eligible),
        fallbackEveryone: false,
    };
}

function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const pick = Math.floor(Math.random() * (index + 1));
        [result[index], result[pick]] = [result[pick], result[index]];
    }
    return result;
}

async function chooseAudio(guildId: string, prayer: string, config: AdhanAudioConfig): Promise<string | null> {
    if (prayer === 'Fajr' && fs.existsSync(path.join(ADHAN_DIR, FAJR_FILE))) return FAJR_FILE;
    const available = listAdhanAudioFiles(false);
    if (!available.length) return null;
    if (config.audioChoice !== 'random' && available.includes(config.audioChoice)) return config.audioChoice;
    const runtime = await getAdvancedConfig<AdhanRuntime>(guildId, RUNTIME_MODULE) || { randomPool: [] };
    runtime.randomPool = runtime.randomPool.filter(file => available.includes(file));
    if (!runtime.randomPool.length) runtime.randomPool = shuffle(available);
    const selected = runtime.randomPool.shift()!;
    await setAdvancedConfig(guildId, RUNTIME_MODULE, runtime);
    return selected;
}

export function canPlayInVoice(channel: VoiceBasedChannel): boolean {
    const me = channel.guild.members.me;
    if (!me) return false;
    const permissions = channel.permissionsFor(me);
    return Boolean(permissions?.has(PermissionFlagsBits.Connect) && permissions.has(PermissionFlagsBits.Speak));
}

export function isAdhanPlaybackActive(guildId: string): boolean {
    return activeAdhanPlaybacks.has(guildId);
}

async function playFileWithPriority(client: Client, guildId: string, channel: VoiceBasedChannel, file: string, volume: number): Promise<void> {
    if (activeAdhanPlaybacks.has(guildId)) throw new Error('adhan_in_progress');
    if (!acquireGuildPlaybackPriority(guildId, 'adhan')) throw new Error('playback_priority_unavailable');
    const snapshot = getPlaybackSnapshot(guildId);
    const playback = (async () => {
        try {
            await playLocalFileOnce(channel, path.join(ADHAN_DIR, file), volume, adhanStatusLabel(file), 'adhan');
        } finally {
            releaseGuildPlaybackPriority(guildId, 'adhan');
            await resumePlayback(snapshot);
        }
        await sendAuditLog(client, guildId, {
            level: 'info', system: 'Adhan', action: 'Voice adhan completed',
            details: `${adhanAudioLabel(file)} \u0641\u064a <#${channel.id}> \u2014 \u0627\u0643\u062a\u0645\u0644 \u0627\u0644\u0623\u0630\u0627\u0646 \u0643\u0627\u0645\u0644\u0627\u064b \u062b\u0645 \u062a\u0645\u062a \u0627\u0633\u062a\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u0635\u062f\u0631 \u0627\u0644\u0633\u0627\u0628\u0642.`,
        });
    })();
    activeAdhanPlaybacks.set(guildId, playback);
    try {
        await playback;
    } finally {
        if (activeAdhanPlaybacks.get(guildId) === playback) activeAdhanPlaybacks.delete(guildId);
    }
}

export async function playScheduledAdhan(client: Client, guildId: string, channel: VoiceBasedChannel, prayer: string): Promise<{ played: boolean; reason?: string; file?: string }> {
    const config = await getAdhanAudioConfig(guildId);
    if (config.mode !== 'voice_notification') return { played: false, reason: 'voice_disabled' };
    if (!canPlayInVoice(channel)) {
        await sendAuditLog(client, guildId, {
            level: 'error', system: 'Adhan', action: 'Voice permissions missing',
            details: `تعذر الدخول أو الكلام في <#${channel.id}>؛ تم الاكتفاء بالإشعار النصي.`,
        });
        return { played: false, reason: 'missing_permissions' };
    }
    // A live test or another zone may already be playing. Wait so the real adhan is never cut off or nested.
    await waitForScheduledAdhanCompletion(guildId);
    const runtime = await getAdvancedConfig<AdhanRuntime>(guildId, RUNTIME_MODULE) || { randomPool: [] };
    if (runtime.lastVoiceAdhanAt && Date.now() - new Date(runtime.lastVoiceAdhanAt).getTime() < DEDUPE_MS) {
        return { played: false, reason: 'deduplicated_15m' };
    }
    const file = await chooseAudio(guildId, prayer, config);
    if (!file) return { played: false, reason: 'audio_missing' };
    runtime.lastVoiceAdhanAt = new Date().toISOString();
    const latestRuntime = await getAdvancedConfig<AdhanRuntime>(guildId, RUNTIME_MODULE) || runtime;
    latestRuntime.lastVoiceAdhanAt = runtime.lastVoiceAdhanAt;
    await setAdvancedConfig(guildId, RUNTIME_MODULE, latestRuntime);
    await playFileWithPriority(client, guildId, channel, file, config.volume);
    return { played: true, file };
}

export async function waitForScheduledAdhanCompletion(guildId: string): Promise<void> {
    const playback = activeAdhanPlaybacks.get(guildId);
    if (playback) await playback.catch(() => {});
}

export async function auditAdhanAudienceRoles(client: Client): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
        const config = await getAdhanAudioConfig(guild.id);
        if (config.audience === 'role') await resolveAdhanAudience(client, guild.id);
    }
}

export async function testConfiguredAdhan(client: Client, member: GuildMember, override?: AdhanAudioConfig): Promise<{ played: boolean; reason?: string; file?: string }> {
    if (isAdhanPlaybackActive(member.guild.id)) return { played: false, reason: 'adhan_in_progress' };
    const channel = member.voice.channel;
    if (!channel) return { played: false, reason: 'admin_not_in_voice' };
    if (!canPlayInVoice(channel)) return { played: false, reason: 'missing_permissions' };
    const config = override || await getAdhanAudioConfig(member.guild.id);
    const file = await chooseAudio(member.guild.id, 'Dhuhr', config);
    if (!file) return { played: false, reason: 'audio_missing' };
    await playFileWithPriority(client, member.guild.id, channel, file, config.volume);
    return { played: true, file };
}




