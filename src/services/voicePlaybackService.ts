import axios from 'axios';
import { ChildProcess, spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import {
    AudioPlayer, AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState,
    joinVoiceChannel, StreamType, VoiceConnection, VoiceConnectionStatus,
} from '@discordjs/voice';
import { Client, PermissionFlagsBits, Routes, VoiceBasedChannel } from 'discord.js';
import { logger } from '../utils/logger';
import { isBlacklisted, addToBlacklist } from './blacklistService';
import { sendAuditLog } from './auditLogService';

export interface VoiceTrack {
    url: string;
    title: string;
    subtitle?: string;
    statusText?: string;
}

export interface PlaybackSnapshot {
    kind: 'radio' | 'tracks';
    channel: VoiceBasedChannel;
    radioUrl?: string;
    radioLabel?: string;
    tracks?: VoiceTrack[];
    index?: number;
    onTrackStart?: (track: VoiceTrack, index: number, total: number) => void | Promise<void>;
    onComplete?: () => void | Promise<void>;
}

interface ActivePlayback extends PlaybackSnapshot {
    connection: VoiceConnection;
    player: AudioPlayer;
    index: number;
    history: number[];
    nextOverride?: number;
    stopped: boolean;
    paused: boolean;
    transcoder?: ChildProcess;
}

const active = new Map<string, ActivePlayback>();
const voiceStatusCache = new Map<string, string | null>();
const voiceStatusWarnings = new Set<string>();
const playbackPriorityOwners = new Map<string, string>();
const guardedConnections = new WeakSet<VoiceConnection>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();

export function acquireGuildPlaybackPriority(guildId: string, owner: string): boolean {
    const current = playbackPriorityOwners.get(guildId);
    if (current && current !== owner) return false;
    playbackPriorityOwners.set(guildId, owner);
    return true;
}

export function releaseGuildPlaybackPriority(guildId: string, owner: string): void {
    if (playbackPriorityOwners.get(guildId) === owner) playbackPriorityOwners.delete(guildId);
}

function assertPlaybackTransitionAllowed(guildId: string, owner?: string): void {
    const current = playbackPriorityOwners.get(guildId);
    if (current && current !== owner) throw new Error(`playback_priority_active:${current}`);
}

export async function setPlaybackChannelStatus(channel: VoiceBasedChannel, value: string | null): Promise<boolean> {
    const status = value?.trim().slice(0, 500) || null;
    if (voiceStatusCache.get(channel.id) === status) return true;
    const me = channel.guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.SetVoiceChannelStatus)) {
        if (!voiceStatusWarnings.has(channel.id)) {
            voiceStatusWarnings.add(channel.id);
            logger.warn(`[Voice] Missing Set Voice Channel Status in ${channel.id}; status text cannot be updated.`);
        }
        return false;
    }
    try {
        await channel.client.rest.put(Routes.channelVoiceStatus(channel.id), { body: { status } });
        voiceStatusCache.set(channel.id, status);
        voiceStatusWarnings.delete(channel.id);
        logger.info(`[Voice] Channel status ${status ? `updated: ${status}` : 'cleared'} (${channel.id}).`);
        return true;
    } catch (error) {
        logger.warn(`[Voice] Failed to update channel status ${channel.id}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export async function recoverGuildVoiceConnection(guildId: string): Promise<boolean> {
    const session = active.get(guildId);
    if (!session) return false;
    const me = session.channel.guild.members.me;
    const permissions = me ? session.channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return false;
    if (!me?.voice.suppress && !me?.voice.selfMute && !me?.voice.serverMute && session.connection.state.status === VoiceConnectionStatus.Ready) return true;
    try {
        session.connection.rejoin({ channelId: session.channel.id, selfMute: false, selfDeaf: false });
        await entersState(session.connection, VoiceConnectionStatus.Ready, 15_000);
        logger.success(`[Voice] Connection recovered after permission update (${session.channel.id}).`);
        return true;
    } catch (error) {
        logger.warn(`[Voice] Automatic connection recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

export function getVoicePlaybackHealth(guildId: string) {
    const session = active.get(guildId);
    if (!session) return { active: false };
    const voice = session.channel.guild.members.me?.voice;
    return {
        active: true,
        kind: session.kind,
        channelId: session.channel.id,
        connectionStatus: session.connection.state.status,
        playerStatus: session.player.state.status,
        selfMute: voice?.selfMute ?? null,
        selfDeaf: voice?.selfDeaf ?? null,
        serverMute: voice?.serverMute ?? null,
        serverDeaf: voice?.serverDeaf ?? null,
        suppress: voice?.suppress ?? null,
        statusText: voiceStatusCache.get(session.channel.id) ?? null,
        label: session.kind === 'radio' ? session.radioLabel : session.tracks?.[session.index]?.title,
    };
}

function stopTranscoder(session: ActivePlayback): void {
    const transcoder = session.transcoder;
    session.transcoder = undefined;
    if (transcoder && transcoder.exitCode === null && !transcoder.killed) {
        try { transcoder.kill(); } catch {}
    }
}

function clearReconnectTimer(guildId: string): void {
    const timer = reconnectTimers.get(guildId);
    if (!timer) return;
    clearTimeout(timer);
    reconnectTimers.delete(guildId);
}

function scheduleVoiceRecovery(guildId: string, reason: string, delayMs = 5_000): void {
    const session = active.get(guildId);
    if (!session || session.stopped || reconnectTimers.has(guildId)) return;

    const timer = setTimeout(async () => {
        reconnectTimers.delete(guildId);
        const latest = active.get(guildId);
        if (!latest || latest.stopped) return;

        try {
            latest.connection.rejoin({
                channelId: latest.channel.id,
                selfMute: false,
                selfDeaf: false,
            });
            await entersState(latest.connection, VoiceConnectionStatus.Ready, 15_000);
            latest.connection.subscribe(latest.player);
            logger.success(`[Voice] ${guildId}: recovered voice connection after ${reason}.`);
        } catch (error) {
            logger.warn(`[Voice] ${guildId}: recovery failed after ${reason}: ${error instanceof Error ? error.message : String(error)}`);
            const snapshot = getPlaybackSnapshot(guildId);
            try { latest.connection.destroy(); } catch {}
            active.delete(guildId);
            if (snapshot) {
                resumePlayback(snapshot).catch(resumeError => {
                    logger.error(`[Voice] ${guildId}: failed to resume playback after reconnect:`, resumeError);
                });
            }
        }
    }, delayMs);

    timer.unref?.();
    reconnectTimers.set(guildId, timer);
}

function attachConnectionGuards(connection: VoiceConnection, guildId: string): void {
    if (guardedConnections.has(connection)) return;
    guardedConnections.add(connection);

    connection.on('stateChange', (oldState, newState) => {
        if (oldState.status !== newState.status) {
            logger.info(`[Voice] ${guildId}: ${oldState.status} -> ${newState.status}`);
        }
        if (newState.status === VoiceConnectionStatus.Ready) clearReconnectTimer(guildId);
        if (newState.status === VoiceConnectionStatus.Disconnected) scheduleVoiceRecovery(guildId, 'disconnect');
        if (newState.status === VoiceConnectionStatus.Destroyed) clearReconnectTimer(guildId);
    });

    connection.on('error', error => {
        logger.warn(`[Voice] ${guildId}: voice connection error handled: ${error instanceof Error ? error.message : String(error)}`);
        scheduleVoiceRecovery(guildId, 'connection_error', 2_000);
    });
}

async function connect(channel: VoiceBasedChannel, priorityOwner?: string): Promise<{ connection: VoiceConnection; player: AudioPlayer }> {
    const guildId = channel.guild.id;
    assertPlaybackTransitionAllowed(guildId, priorityOwner);
    const existing = active.get(guildId);
    if (
        existing &&
        existing.channel.id === channel.id &&
        existing.connection.state.status === VoiceConnectionStatus.Ready
    ) {
        existing.stopped = true;
        stopTranscoder(existing);
        try { existing.player.stop(); } catch {}
        active.delete(guildId);
        const player = createAudioPlayer();
        attachConnectionGuards(existing.connection, guildId);
        existing.connection.subscribe(player);
        logger.info(`[Voice] Reusing ready connection in ${channel.id} for source transition.`);
        return { connection: existing.connection, player };
    }

    stopGuildPlayback(guildId, false, priorityOwner);
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        daveEncryption: true,
    });
    attachConnectionGuards(connection, guildId);

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
        try { connection.destroy(); } catch {}
        throw error;
    }
    const me = channel.guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (me?.voice.serverMute) {
        if (permissions?.has(PermissionFlagsBits.MuteMembers)) {
            await me.voice.setMute(false, 'إزالة كتم البوت بعد الاتصال الصوتي').catch(error => {
                logger.warn(`[Voice] Could not remove server mute: ${error instanceof Error ? error.message : String(error)}`);
            });
        } else {
            logger.warn(`[Voice] Bot is server-muted in ${channel.id}; grant Mute Members temporarily or unmute it manually.`);
        }
    }
    const voice = channel.guild.members.me?.voice;
    logger.info(
        `[Voice] Ready state in ${channel.id}: selfMute=${voice?.selfMute}, selfDeaf=${voice?.selfDeaf}, ` +
        `serverMute=${voice?.serverMute}, serverDeaf=${voice?.serverDeaf}, suppress=${voice?.suppress}, ` +
        `Speak=${permissions?.has(PermissionFlagsBits.Speak)}, Connect=${permissions?.has(PermissionFlagsBits.Connect)}, ` +
        `SetStatus=${permissions?.has(PermissionFlagsBits.SetVoiceChannelStatus)}`,
    );
    const player = createAudioPlayer();
    connection.subscribe(player);
    return { connection, player };
}

function spawnOggTranscoder(url: string, label: string): ChildProcess {
    if (!ffmpegPath) throw new Error('FFmpeg executable is unavailable for remote playback.');
    const transcoder = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'warning',
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
        '-reconnect_on_network_error', '1',
        '-i', url, '-map', '0:a:0', '-vn',
        '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-b:a', '96k', '-vbr', 'on', '-application', 'audio',
        '-f', 'ogg', 'pipe:1',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!transcoder.stdout) {
        try { transcoder.kill(); } catch {}
        throw new Error('FFmpeg did not expose an audio output stream.');
    }
    let stderr = '';
    transcoder.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2000); });
    transcoder.once('error', error => {
        logger.warn(`[Voice] ${label} transcoder process error: ${error instanceof Error ? error.message : String(error)}`);
    });
    transcoder.once('exit', code => {
        if (code && !transcoder.killed) logger.warn(`[Voice] ${label} transcoder exited with code ${code}: ${stderr.trim()}`);
    });
    return transcoder;
}

async function resourceFromUrl(url: string) {
    if (/^https?:\/\//i.test(url)) {
        // Use native FFmpeg HTTP streaming with auto-reconnect for all remote audio.
        // This prevents network stalls or Node socket closures from cutting off recitations mid-surah.
        const transcoder = spawnOggTranscoder(url, 'MP3');
        if (!transcoder.stdout) {
            try { transcoder.kill(); } catch {}
            throw new Error('FFmpeg did not expose an audio output stream.');
        }
        return {
            resource: createAudioResource(transcoder.stdout, { inputType: StreamType.OggOpus }),
            transcoder,
        };
    }
    return { resource: createAudioResource(url) };
}


export async function playRadioSource(channel: VoiceBasedChannel, url: string, label: string): Promise<void> {
    const { connection, player } = await connect(channel);
    const guildId = channel.guild.id;
    const session: ActivePlayback = {
        kind: 'radio', channel, radioUrl: url, radioLabel: label,
        connection, player, index: 0, history: [], stopped: false, paused: false,
    };
    active.set(guildId, session);

    const start = async () => {
        if (session.stopped || active.get(guildId) !== session) return;
        try {
            const prepared = await resourceFromUrl(url);
            stopTranscoder(session);
            session.transcoder = prepared.transcoder;
            player.play(prepared.resource);
        } catch (error) {
            logger.error(`[Voice] Radio failed (${label}):`, error);
            setTimeout(start, 5_000);
        }
    };
    player.on(AudioPlayerStatus.Idle, () => setTimeout(start, 2_000));
    player.on('error', error => {
        logger.error(`[Voice] Radio player error (${label}):`, error);
        setTimeout(start, 3_000);
    });
    await setPlaybackChannelStatus(channel, `📻 ${label}`);
    await start();
    logger.success(`[Voice] Radio playback started: ${label} (${channel.id}).`);
}

export async function playTrackQueue(
    channel: VoiceBasedChannel,
    tracks: VoiceTrack[],
    startIndex = 0,
    onTrackStart?: PlaybackSnapshot['onTrackStart'],
    onComplete?: PlaybackSnapshot['onComplete'],
): Promise<void> {
    if (tracks.length === 0) return;
    const { connection, player } = await connect(channel);
    const guildId = channel.guild.id;
    const session: ActivePlayback = {
        kind: 'tracks', channel, tracks, index: Math.max(0, Math.min(startIndex, tracks.length - 1)),
        onTrackStart, onComplete, connection, player, history: [], stopped: false, paused: false,
    };
    active.set(guildId, session);

    let sameTrackRetries = 0;
    let retryIndex = session.index;
    let playbackStartedAt = 0;
    let announcedIndex = -1;
    const minimumHealthyPlaybackMs = 3_000;

    const registerFailure = () => {
        if (retryIndex !== session.index) {
            retryIndex = session.index;
            sameTrackRetries = 0;
        }
        sameTrackRetries += 1;
        return sameTrackRetries;
    };

    const resetRetries = () => {
        retryIndex = session.index;
        sameTrackRetries = 0;
    };

    const playIndex = async () => {
        if (session.stopped || active.get(guildId) !== session) return;
        if (session.index >= session.tracks!.length) {
            session.stopped = true;
            await session.onComplete?.();
            if (active.get(guildId) === session) stopGuildPlayback(guildId);
            return;
        }
        const track = session.tracks![session.index];

        // Skip blacklisted URLs immediately without retrying.
        if (isBlacklisted(track.url)) {
            logger.warn(`[Voice] Skipping blacklisted URL: ${track.url}`);
            session.index += 1;
            announcedIndex = -1;
            resetRetries();
            setTimeout(playIndex, 500);
            return;
        }

        try {
            const prepared = await resourceFromUrl(track.url);
            stopTranscoder(session);
            session.transcoder = prepared.transcoder;
            player.play(prepared.resource);
            logger.info(`[Voice] Track prepared: ${track.title}${track.subtitle ? ` — ${track.subtitle}` : ''}.`);
        } catch (error) {
            logger.error(`[Voice] Track failed (${track.title}):`, error);
            if (registerFailure() <= 2) {
                setTimeout(playIndex, 3_000);
                return;
            }
            // Blacklist the URL after 3 consecutive failures.
            addToBlacklist(track.url, `فشل الاتصال 3 مرات متتالية — ${track.title}`);
            const client: Client | undefined = (global as any).discordClient;
            if (client && session.channel.guild.id) {
                sendAuditLog(client, session.channel.guild.id, {
                    system: 'quran',
                    action: 'Audio link blacklisted',
                    level: 'error',
                    details: `تم حظر الرابط تلقائياً بعد 3 محاولات فاشلة:\n\`${track.url}\`\nالسبب: ${error instanceof Error ? error.message : String(error)}`,
                }).catch(e => logger.warn(`[Voice] Could not send blacklist audit log: ${String(e)}`));
            }
            session.index += 1;
            announcedIndex = -1;
            resetRetries();
            setTimeout(playIndex, 3_000);
        }
    };

    player.on(AudioPlayerStatus.Playing, () => {
        if (session.stopped || active.get(guildId) !== session) return;
        playbackStartedAt = Date.now();
        if (announcedIndex === session.index) return;
        announcedIndex = session.index;
        const track = session.tracks![session.index];
        void (async () => {
            await session.onTrackStart?.(track, session.index, session.tracks!.length);
            await setPlaybackChannelStatus(
                channel,
                track.statusText || `📖 ${track.title}${track.subtitle ? ` • القارئ: ${track.subtitle}` : ''}`,
            );
            logger.success(`[Voice] Track playback started: ${track.title}${track.subtitle ? ` — ${track.subtitle}` : ''}.`);
        })().catch(error => logger.warn(
            `[Voice] Track start notification failed (${track.title}): ${error instanceof Error ? error.message : String(error)}`,
        ));
    });

    player.on(AudioPlayerStatus.Idle, () => {
        if (session.stopped) return;
        const override = session.nextOverride;
        const elapsed = playbackStartedAt ? Date.now() - playbackStartedAt : 0;
        if (override === undefined && elapsed < minimumHealthyPlaybackMs && registerFailure() <= 2) {
            logger.warn(
                `[Voice] ${guildId}: ${session.tracks![session.index]?.title || 'track'} ended after ${elapsed}ms; retrying same track.`,
            );
            setTimeout(playIndex, 3_000);
            return;
        }
        if (session.history[session.history.length - 1] !== session.index) session.history.push(session.index);
        const nextIndex = override ?? session.index + 1;
        const changingTrack = nextIndex !== session.index;
        session.index = nextIndex;
        session.nextOverride = undefined;
        playbackStartedAt = 0;
        if (changingTrack) {
            announcedIndex = -1;
            resetRetries();
        }
        playIndex();
    });
    player.on('error', () => {
        if (session.stopped) return;
        // A transient stream/FFmpeg error should not skip the current surah:
        // retry the same track a couple of times before advancing.
        session.nextOverride = registerFailure() > 2 ? session.index + 1 : session.index;
        player.stop();
    });
    await playIndex();
}

export function getPlaybackSnapshot(guildId: string): PlaybackSnapshot | null {
    const session = active.get(guildId);
    if (!session) return null;
    if (session.kind === 'radio') {
        return { kind: 'radio', channel: session.channel, radioUrl: session.radioUrl, radioLabel: session.radioLabel };
    }
    return {
        kind: 'tracks', channel: session.channel, tracks: session.tracks || [], index: session.index,
        onTrackStart: session.onTrackStart, onComplete: session.onComplete,
    };
}

export async function resumePlayback(snapshot: PlaybackSnapshot | null): Promise<void> {
    if (!snapshot) return;
    if (snapshot.kind === 'radio' && snapshot.radioUrl) {
        await playRadioSource(snapshot.channel, snapshot.radioUrl, snapshot.radioLabel || 'Radio');
    } else if (snapshot.kind === 'tracks' && snapshot.tracks) {
        await playTrackQueue(snapshot.channel, snapshot.tracks, snapshot.index || 0, snapshot.onTrackStart, snapshot.onComplete);
    }
}

export function stopGuildPlayback(guildId: string, clearStatus = true, priorityOwner?: string): void {
    const lockedBy = playbackPriorityOwners.get(guildId);
    if (lockedBy && lockedBy !== priorityOwner) return;
    const session = active.get(guildId);
    if (!session) return;
    clearReconnectTimer(guildId);
    session.stopped = true;
    stopTranscoder(session);
    try { session.player.stop(); } catch {}
    try { session.connection.destroy(); } catch {}
    if (clearStatus) void setPlaybackChannelStatus(session.channel, null);
    active.delete(guildId);
}

export function toggleGuildPause(guildId: string): boolean | null {
    const session = active.get(guildId);
    if (!session) return null;
    if (session.paused) session.player.unpause(); else session.player.pause();
    session.paused = !session.paused;
    return session.paused;
}

export function nextGuildTrack(guildId: string): void {
    const session = active.get(guildId);
    if (!session || session.kind !== 'tracks') return;
    session.nextOverride = session.index + 1;
    session.player.stop();
}

export function previousGuildTrack(guildId: string): void {
    const session = active.get(guildId);
    if (!session || session.kind !== 'tracks') return;
    const previous = session.history.length ? session.history[session.history.length - 1] : Math.max(0, session.index - 1);
    session.nextOverride = previous;
    session.player.stop();
}

export async function playLocalFileOnce(
    channel: VoiceBasedChannel,
    filePath: string,
    volume = 0.75,
    statusText = '🕌 الأذان',
    priorityOwner?: string,
): Promise<void> {
    const { connection, player } = await connect(channel, priorityOwner);
    const guildId = channel.guild.id;
    const session: ActivePlayback = {
        kind: 'tracks', channel, tracks: [{ url: filePath, title: statusText, statusText }], index: 0,
        connection, player, history: [], stopped: false, paused: false,
    };
    active.set(guildId, session);
    await setPlaybackChannelStatus(channel, statusText);
    await new Promise<void>(async (resolve, reject) => {
        try {
            const resource = createAudioResource(filePath, { inlineVolume: true });
            resource.volume?.setVolume(Math.max(0, Math.min(volume, 1)));
            player.once(AudioPlayerStatus.Idle, resolve);
            player.once('error', reject);
            player.play(resource);
        } catch (error) {
            reject(error);
        }
    });
    stopGuildPlayback(guildId, true, priorityOwner);
}







