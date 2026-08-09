import { Collection, PermissionFlagsBits } from 'discord.js';
import { getQuranRadioConfig } from './guildService';
import { logger } from '../utils/logger';

// ─── Cooldown ────────────────────────────────────────────────

const COOLDOWN_MS = 12_000;
const joinCooldowns = new Map<string, number>();

export function checkJoinCooldown(guildId: string): boolean {
    const last = joinCooldowns.get(guildId);
    const now = Date.now();
    if (last && now - last < COOLDOWN_MS) return false;
    joinCooldowns.set(guildId, now);
    return true;
}

// ─── Session Tracker ─────────────────────────────────────────

interface SessionInfo {
    guildId: string;
    voiceChannelId: string;
    controllerId: string | null;
    panelMessageId: string | null;
    lastActivity: number;
}

const sessions = new Collection<string, SessionInfo>();

export function getOrCreateSession(guildId: string): SessionInfo {
    let session = sessions.get(guildId);
    if (!session) {
        session = { guildId, voiceChannelId: '', controllerId: null, panelMessageId: null, lastActivity: 0 };
        sessions.set(guildId, session);
    }
    return session;
}

export function updateSession(guildId: string, partial: Partial<SessionInfo>): SessionInfo {
    const session = getOrCreateSession(guildId);
    Object.assign(session, partial, { lastActivity: Date.now() });
    return session;
}

export function getSession(guildId: string): SessionInfo | undefined {
    return sessions.get(guildId);
}

export function deleteSession(guildId: string): void {
    sessions.delete(guildId);
    joinCooldowns.delete(guildId);
    logger.info(`Quran session cleaned up for guild ${guildId}`);
}

// ─── Stale Session Cleanup ───────────────────────────────────

const STALE_MS = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
    const now = Date.now();
    for (const [guildId, session] of sessions) {
        if (now - session.lastActivity > STALE_MS) {
            const members = session.voiceChannelId ? 'unknown' : 'nobody';
            logger.info(`Cleaning stale quran session for guild ${guildId} (no activity for 30m)`);
            sessions.delete(guildId);
        }
    }
}, 5 * 60 * 1000);

// ─── Permission Check ────────────────────────────────────────

export function canSendToVoiceChannel(channel: import('discord.js').VoiceBasedChannel): boolean {
    if (!channel.guild) return false;
    const me = channel.guild.members.me;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    return perms.has(PermissionFlagsBits.ViewChannel)
        && perms.has(PermissionFlagsBits.SendMessages)
        && perms.has(PermissionFlagsBits.ReadMessageHistory);
}

// ─── Export ──────────────────────────────────────────────────

export { getQuranRadioConfig };
