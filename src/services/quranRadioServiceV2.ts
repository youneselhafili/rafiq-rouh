import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GuildMember,
    MessageComponentInteraction, PermissionFlagsBits, StringSelectMenuBuilder, VoiceBasedChannel,
} from 'discord.js';
import { getQuranRadioConfig, saveQuranRadioConfig } from './guildService';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { getAllReciters, getReciterById } from '../quran/quranRegistry';
import {
    getPlaybackSnapshot, getVoicePlaybackHealth, nextGuildTrack, playTrackQueue, previousGuildTrack,
    recoverGuildVoiceConnection, resumePlayback, stopGuildPlayback, toggleGuildPause,
    PlaybackSnapshot, VoiceTrack,
} from './voicePlaybackService';
import { buildQuranPanel } from './quranPanelRendererV2';
import { sendAuditLog } from './auditLogService';
import { logger } from '../utils/logger';
import { isAdhanPlaybackActive } from './adhanAudioService';

export type QuranMode = 'Idle' | 'QuranKareem' | 'FavoriteReciters' | 'AudioLibrary' | 'Reciter';
export type PlaybackMode = 'بالترتيب' | 'عشوائي' | 'اختيار يدوي' | 'Playlist' | 'سورة الكهف — الجمعة';

export interface PlaylistTrack extends VoiceTrack {
    reciterId: string;
    surahIndex: number;
}

interface UserPlaylist {
    tracks: PlaylistTrack[];
    position: number;
    updatedAt: string;
}

export interface QuranRuntimeState {
    guildId: string;
    mode: QuranMode;
    controllerId?: string;
    panelMessageId?: string;
    nowPlayingMessageId?: string;
    voiceChannelId?: string;
    twentyFourSeven: boolean;
    isPaused: boolean;
    radioLabel?: string;
    playbackMode?: PlaybackMode;
    phase: 'main' | 'choose_mode' | 'choose_surah';
    selectedReciterId?: string;
    surahPage: number;
    reciterPage: number;
    pendingTrack?: PlaylistTrack;
    queue: PlaylistTrack[];
    currentIndex: number;
    currentTrack?: PlaylistTrack;
    userOverride: boolean;
    playlistPage: number;
    selectedQueueIndex?: number;
    controllerOrder: string[];
    completedQueueMode?: PlaybackMode;
}

const states = new Map<string, QuranRuntimeState>();
const cycleTimers = new Map<string, ReturnType<typeof setInterval>>();
const quran24StallSince = new Map<string, number>();
const QURAN_STALL_RESTART_MS = 120_000;

interface FridayKahfPreviousState {
    mode: QuranMode;
    playbackMode?: PlaybackMode;
    queue: PlaylistTrack[];
    currentIndex: number;
    currentTrack?: PlaylistTrack;
    radioLabel?: string;
    userOverride: boolean;
    phase: QuranRuntimeState['phase'];
}

interface FridayKahfSession {
    dateKey: string;
    previousSnapshot: PlaybackSnapshot | null;
    previousState: FridayKahfPreviousState;
    stopping: boolean;
    cycle: number;
}

const fridayKahfSessions = new Map<string, FridayKahfSession>();

export function getQuranRuntimeState(guildId: string): QuranRuntimeState {
    let state = states.get(guildId);
    if (!state) {
        state = {
            guildId, mode: 'Idle', twentyFourSeven: false, isPaused: false, phase: 'main',
            surahPage: 0, reciterPage: 0, queue: [], currentIndex: 0, userOverride: false, playlistPage: 0, controllerOrder: [],
        };
        states.set(guildId, state);
    }
    return state;
}

function playlistModule(userId: string): string {
    return `quranPlaylist_${userId}`;
}

async function loadPlaylist(guildId: string, userId: string): Promise<UserPlaylist> {
    return await getAdvancedConfig<UserPlaylist>(guildId, playlistModule(userId)) || {
        tracks: [], position: 0, updatedAt: new Date().toISOString(),
    };
}

async function savePlaylist(guildId: string, userId: string, playlist: UserPlaylist): Promise<void> {
    playlist.updatedAt = new Date().toISOString();
    await setAdvancedConfig(guildId, playlistModule(userId), playlist);
}

async function appendToSavedPlaylist(state: QuranRuntimeState, track: PlaylistTrack, fallbackUserId?: string): Promise<void> {
    const userId = state.controllerId || fallbackUserId;
    if (!userId) return;
    const playlist = await loadPlaylist(state.guildId, userId);
    playlist.tracks.push(track);
    await savePlaylist(state.guildId, userId, playlist);
}

async function voiceTextChannel(client: Client, channelId?: string): Promise<any | null> {
    if (!channelId) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
}

const warnedVoiceTextChannels = new Set<string>();
const cleanedPanelChannels = new Set<string>();
const cleanedNowPlayingChannels = new Set<string>();
const restoredTemporaryChannels = new Set<string>();

const QURAN_PANEL_TITLE = '📻 إذاعة رفيق الروح الإسلامية';
const NOW_PLAYING_TITLE_PREFIX = '📖 تعمل الآن:';
const RETURN_TO_LIVE_TITLE = '✅ اكتملت طلباتك';
const TEMPORARY_MESSAGE_LIFETIME_MS = 10 * 60 * 1000;
const CONTROLLER_NOTICE_LIFETIME_MS = 3 * 60 * 1000;

function isPlaybackNoticeTitle(title: string): boolean {
    return title.startsWith(NOW_PLAYING_TITLE_PREFIX) ||
        title === RETURN_TO_LIVE_TITLE ||
        title === '✅ اكتمل التشغيل';
}

function scheduleTemporaryMessageDelete(message: any, delayMs = TEMPORARY_MESSAGE_LIFETIME_MS): void {
    const timer = setTimeout(() => {
        void message.delete().catch(() => null);
    }, Math.max(1_000, delayMs));
    timer.unref();
}

async function sendVoiceChat(
    channel: any,
    payload: any,
    temporary = false,
    lifetimeMs = TEMPORARY_MESSAGE_LIFETIME_MS,
): Promise<any | null> {
    try {
        const message = await channel.send(payload);
        warnedVoiceTextChannels.delete(channel.id);
        if (temporary) scheduleTemporaryMessageDelete(message, lifetimeMs);
        return message;
    } catch (error) {
        if (!warnedVoiceTextChannels.has(channel.id)) {
            warnedVoiceTextChannels.add(channel.id);
            logger.warn(
                `[QuranV2] Cannot send in voice chat ${channel.id}; audio will continue. ` +
                `Grant View Channel, Send Messages and Embed Links. ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return null;
    }
}

async function cleanupBotMessages(
    client: Client,
    channel: any,
    keepMessageId: string,
    titleMatches: (title: string) => boolean,
): Promise<boolean> {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return false;

    const deletions: Promise<unknown>[] = [];
    for (const message of messages.values()) {
        if (message.id === keepMessageId || message.author?.id !== client.user?.id) continue;
        const title = message.embeds?.[0]?.title || '';
        if (titleMatches(title)) deletions.push(message.delete().catch(() => null));
    }
    await Promise.all(deletions);
    return true;
}

function temporaryMessageLifetime(message: any): number {
    const content = String(message.content || '');
    if (
        content.includes('أنت المتحكم الآن') ||
        content.includes('انتقل إليك التحكم') ||
        content.includes('أنت المتحكم الحالي')
    ) {
        return CONTROLLER_NOTICE_LIFETIME_MS;
    }
    return TEMPORARY_MESSAGE_LIFETIME_MS;
}

async function restoreTemporaryMessageCleanup(client: Client, channel: any, keepMessageId: string): Promise<boolean> {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return false;

    const now = Date.now();
    const deletions: Promise<unknown>[] = [];
    for (const message of messages.values()) {
        if (message.id === keepMessageId || message.author?.id !== client.user?.id) continue;
        const lifetimeMs = temporaryMessageLifetime(message);
        const remaining = lifetimeMs - (now - message.createdTimestamp);
        if (remaining <= 0) deletions.push(message.delete().catch(() => null));
        else scheduleTemporaryMessageDelete(message, remaining);
    }
    await Promise.all(deletions);
    return true;
}

async function clearNowPlayingNotification(client: Client, state: QuranRuntimeState): Promise<void> {
    const messageId = state.nowPlayingMessageId;
    state.nowPlayingMessageId = undefined;
    const channel = await voiceTextChannel(client, state.voiceChannelId);
    if (!channel) return;

    if (messageId) {
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (message?.author?.id === client.user?.id) await message.delete().catch(() => null);
    }
    if (!cleanedNowPlayingChannels.has(channel.id)) {
        const cleaned = await cleanupBotMessages(
            client,
            channel,
            '',
            title => isPlaybackNoticeTitle(title),
        );
        if (cleaned) cleanedNowPlayingChannels.add(channel.id);
    }
}
export async function renderQuranPanel(
    client: Client,
    guildId: string,
    mention?: string,
    mentionLifetimeMs = TEMPORARY_MESSAGE_LIFETIME_MS,
): Promise<void> {
    const state = getQuranRuntimeState(guildId);
    const channel = await voiceTextChannel(client, state.voiceChannelId);
    if (!channel) {
        logger.warn(`[QuranV2] Voice chat unavailable for ${state.voiceChannelId}`);
        return;
    }
    const payload = buildQuranPanel(state);
    if (state.panelMessageId) {
        const existing = await channel.messages.fetch(state.panelMessageId).catch(() => null);
        if (existing) {
            await existing.edit(payload);
            if (!cleanedPanelChannels.has(channel.id)) {
                const cleaned = await cleanupBotMessages(
                    client,
                    channel,
                    existing.id,
                    title => title === QURAN_PANEL_TITLE,
                );
                if (cleaned) cleanedPanelChannels.add(channel.id);
            }
            if (!restoredTemporaryChannels.has(channel.id)) {
                const restored = await restoreTemporaryMessageCleanup(client, channel, existing.id);
                if (restored) restoredTemporaryChannels.add(channel.id);
            }
            if (mention) await sendVoiceChat(channel, { content: mention }, true, mentionLifetimeMs);
            return;
        }
        state.panelMessageId = undefined;
    }
    const message = await sendVoiceChat(channel, payload);
    if (message) {
        state.panelMessageId = message.id;
        const cleaned = await cleanupBotMessages(
            client,
            channel,
            message.id,
            title => title === QURAN_PANEL_TITLE,
        );
        if (cleaned) cleanedPanelChannels.add(channel.id);
        const restored = await restoreTemporaryMessageCleanup(client, channel, message.id);
        if (restored) restoredTemporaryChannels.add(channel.id);
        if (mention) await sendVoiceChat(channel, { content: mention }, true, mentionLifetimeMs);
    }
}

async function notifyNowPlaying(client: Client, state: QuranRuntimeState, track: PlaylistTrack, index: number, total: number) {
    const channel = await voiceTextChannel(client, state.voiceChannelId);
    if (!channel) return;
    const embed = new EmbedBuilder()
        .setColor(0x2e8b57)
        .setTitle(`📖 تعمل الآن: ${track.title}`)
        .setDescription(
            `🎙️ **القارئ:** ${track.subtitle}\n` +
            `🎵 **النظام:** ${state.playbackMode || 'اختيار يدوي'}\n` +
            `📋 **الترتيب:** ${index + 1}/${total}\n` +
            `⏭️ **المتبقي:** ${Math.max(0, total - index - 1)}`,
        )
        .setTimestamp();
    const previousMessageId = state.nowPlayingMessageId;
    const message = await sendVoiceChat(channel, {
        content: state.controllerId ? `<@${state.controllerId}>` : undefined,
        embeds: [embed],
    }, true);
    if (!message) return;

    state.nowPlayingMessageId = message.id;
    if (previousMessageId && previousMessageId !== message.id) {
        const previous = await channel.messages.fetch(previousMessageId).catch(() => null);
        if (previous?.author?.id === client.user?.id) await previous.delete().catch(() => null);
    }
    if (!cleanedNowPlayingChannels.has(channel.id)) {
        const cleaned = await cleanupBotMessages(
            client,
            channel,
            message.id,
            title => isPlaybackNoticeTitle(title),
        );
        if (cleaned) cleanedNowPlayingChannels.add(channel.id);
    }
}

function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function reciterTracks(reciterId: string): PlaylistTrack[] {
    const reciter = getReciterById(reciterId);
    if (!reciter) return [];
    return reciter.surahs.map((surah, index) => ({
        url: surah.url, title: surah.name, subtitle: reciter.name, reciterId, surahIndex: index,
    }));
}

// Live streaming functions removed

export function getAllReciterTracks(): PlaylistTrack[] {
    const reciters = getAllReciters();
    const tracks: PlaylistTrack[] = [];
    for (const reciter of reciters) {
        for (let i = 0; i < reciter.surahs.length; i++) {
            const surah = reciter.surahs[i];
            tracks.push({
                url: surah.url,
                title: surah.name,
                subtitle: reciter.name,
                reciterId: reciter.id,
                surahIndex: i,
            });
        }
    }
    return tracks;
}

export async function startRandomQuranKareem(
    client: Client,
    state: QuranRuntimeState,
    channel: VoiceBasedChannel,
    isManual = true,
): Promise<void> {
    const allTracks = getAllReciterTracks();
    if (allTracks.length === 0) return;

    const randomTrack = allTracks[Math.floor(Math.random() * allTracks.length)];

    state.mode = 'QuranKareem';
    state.radioLabel = 'القرآن الكريم';
    state.playbackMode = 'عشوائي';
    state.phase = 'main';
    if (isManual) state.userOverride = true;

    await playTrackQueue(
        channel,
        [randomTrack],
        0,
        async (rawTrack, index, total) => {
            const track = rawTrack as PlaylistTrack;
            state.currentIndex = 0;
            state.currentTrack = track;
            await notifyNowPlaying(client, state, track, 0, 1);
            await renderQuranPanel(client, state.guildId);
        },
        async () => {
            const currentVoice = state.voiceChannelId ? channel.guild.channels.cache.get(state.voiceChannelId) : null;
            if (currentVoice?.isVoiceBased() && (state.mode === 'QuranKareem' || state.twentyFourSeven)) {
                await startRandomQuranKareem(client, state, currentVoice, false);
            } else {
                await finishPlayback(client, state);
            }
        },
    );
}

async function finishPlayback(client: Client, state: QuranRuntimeState) {
    state.completedQueueMode = state.playbackMode;
    state.currentTrack = undefined;
    const guild = client.guilds.cache.get(state.guildId);
    const voiceChannel = state.voiceChannelId ? guild?.channels.cache.get(state.voiceChannelId) : null;
    if (!voiceChannel?.isVoiceBased()) {
        state.mode = 'Idle';
        await clearNowPlayingNotification(client, state);
        await renderQuranPanel(client, state.guildId);
        return;
    }

    await startRandomQuranKareem(client, state, voiceChannel, false);
    const channel = await voiceTextChannel(client, state.voiceChannelId);
    if (!channel) return;
    const completeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_complete_loop').setLabel('كمل الدورة').setEmoji('🔁').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('qr_complete_source').setLabel('الرجوع للمصدر').setEmoji('🕌').setStyle(ButtonStyle.Secondary),
    );
    await sendVoiceChat(channel, {
        content: state.controllerId ? `<@${state.controllerId}>` : undefined,
        embeds: [new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('📖 العودة إلى القرآن الكريم')
            .setDescription(
                'انتهت السور المطلوبة، وعادت التلاوات العشوائية للقرآن الكريم.\n' +
                'سأبقى داخل القناة الصوتية وأواصل البث 24/24.',
            )
            .setTimestamp()],
        components: [completeRow],
    }, true);
    // NOTE: intentionally NOT stored as nowPlayingMessageId so the next
    // track's notification does not delete this completion message/buttons.
    state.nowPlayingMessageId = undefined;
    await sendAuditLog(client, state.guildId, {
        level: 'info', system: 'Quran', action: 'Requests completed; Quran Kareem 24/7 resumed', actorId: state.controllerId,
        details: `القرآن الكريم في <#${voiceChannel.id}>`,
    });
}

async function startQueue(client: Client, state: QuranRuntimeState, channel: VoiceBasedChannel, tracks: PlaylistTrack[], mode: PlaybackMode, startIndex = 0) {
    state.queue = tracks;
    state.currentIndex = startIndex;
    state.playbackMode = mode;
    state.mode = 'Reciter';
    state.userOverride = true;
    state.phase = 'main';
    await playTrackQueue(channel, tracks, startIndex, async (rawTrack, index, total) => {
        const track = rawTrack as PlaylistTrack;
        state.currentIndex = index;
        state.currentTrack = track;
        if (mode === 'Playlist' && state.controllerId) {
            await savePlaylist(state.guildId, state.controllerId, { tracks, position: index, updatedAt: new Date().toISOString() });
        }
        await notifyNowPlaying(client, state, track, index, total);
        await renderQuranPanel(client, state.guildId);
    }, async () => finishPlayback(client, state));
    await sendAuditLog(client, state.guildId, {
        level: 'info', system: 'Quran', action: `Playback started: ${mode}`, actorId: state.controllerId,
        details: `${tracks.length} سورة في <#${channel.id}>`,
    });
}

export async function playScheduledKahf(client: Client, guildId: string, reciterId: string): Promise<boolean> {
    const config = await getQuranRadioConfig(guildId);
    const guild = client.guilds.cache.get(guildId);
    const voiceChannel = config ? guild?.channels.cache.get(config.voiceChannelId) : null;
    const reciter = getReciterById(reciterId);
    const surah = reciter?.surahs[17];
    if (!config || !voiceChannel?.isVoiceBased() || !reciter || !surah) return false;

    const state = getQuranRuntimeState(guildId);
    state.voiceChannelId = config.voiceChannelId;
    state.twentyFourSeven = config.twentyFourSeven;
    const previousSnapshot = getPlaybackSnapshot(guildId);
    const previousState = {
        mode: state.mode,
        playbackMode: state.playbackMode,
        queue: [...state.queue],
        currentIndex: state.currentIndex,
        currentTrack: state.currentTrack,
        radioLabel: state.radioLabel,
        userOverride: state.userOverride,
        phase: state.phase,
    };
    const track: PlaylistTrack = {
        url: surah.url,
        title: 'سورة الكهف',
        subtitle: reciter.name,
        statusText: `📖 سورة الكهف • القارئ: ${reciter.name}`,
        reciterId: reciter.id,
        surahIndex: 17,
    };

    state.mode = 'Reciter';
    state.playbackMode = 'سورة الكهف — الجمعة';
    state.queue = [track];
    state.currentIndex = 0;
    state.currentTrack = track;
    state.userOverride = true;
    state.phase = 'main';
    await clearNowPlayingNotification(client, state);

    await playTrackQueue(voiceChannel, [track], 0, async () => {
        state.currentTrack = track;
        await notifyNowPlaying(client, state, track, 0, 1);
        await renderQuranPanel(client, guildId);
    }, async () => {
        state.mode = previousState.mode;
        state.playbackMode = previousState.playbackMode;
        state.queue = previousState.queue;
        state.currentIndex = previousState.currentIndex;
        state.currentTrack = previousState.currentTrack;
        state.radioLabel = previousState.radioLabel;
        state.userOverride = previousState.userOverride;
        state.phase = previousState.phase;
        await clearNowPlayingNotification(client, state);
        if (previousSnapshot) {
            await resumePlayback(previousSnapshot);
        } else if (config.twentyFourSeven) {
            await startRandomQuranKareem(client, state, voiceChannel, false);
        } else {
            state.mode = 'Idle';
            state.currentTrack = undefined;
        }
        await renderQuranPanel(client, guildId);
        await sendAuditLog(client, guildId, {
            level: 'success', system: 'Jumuah', action: 'Friday Surat Al-Kahf completed',
            details: `القارئ: ${reciter.name} — المصدر السابق: ${previousSnapshot ? 'تمت استعادته' : config.twentyFourSeven ? 'عاد البث المباشر' : 'لا يوجد'}`,
        });
    });
    await sendAuditLog(client, guildId, {
        level: 'info', system: 'Jumuah', action: 'Friday Surat Al-Kahf voice started',
        details: `${reciter.name} في <#${voiceChannel.id}>`,
    });
    return true;
}
export function isFridayKahfLoopActive(guildId: string): boolean {
    return fridayKahfSessions.has(guildId);
}

function buildFridayKahfTracks(dateKey: string): PlaylistTrack[] {
    const tracks = getAllReciters().flatMap(reciter => {
        const surah = reciter.surahs[17];
        if (!surah?.url) return [];
        return [{
            url: surah.url,
            title: '\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641',
            subtitle: reciter.name,
            statusText: `\u{1F4D6} \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u2022 \u0627\u0644\u0642\u0627\u0631\u0626: ${reciter.name}`,
            reciterId: reciter.id,
            surahIndex: 17,
        } as PlaylistTrack];
    });
    if (tracks.length < 2) return tracks;
    const offset = [...dateKey].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tracks.length;
    return [...tracks.slice(offset), ...tracks.slice(0, offset)];
}

export async function startFridayKahfLoop(client: Client, guildId: string, dateKey: string): Promise<boolean> {
    const existing = fridayKahfSessions.get(guildId);
    if (existing?.dateKey === dateKey && !existing.stopping) return true;
    if (existing) await stopFridayKahfLoop(client, guildId, 'new_friday_session');

    const config = await getQuranRadioConfig(guildId);
    const guild = client.guilds.cache.get(guildId);
    const voiceChannel = config ? guild?.channels.cache.get(config.voiceChannelId) : null;
    const tracks = buildFridayKahfTracks(dateKey);
    if (!config || !voiceChannel?.isVoiceBased() || tracks.length === 0) return false;

    const state = getQuranRuntimeState(guildId);
    state.voiceChannelId = config.voiceChannelId;
    state.twentyFourSeven = config.twentyFourSeven;
    const previousSnapshot = getPlaybackSnapshot(guildId);
    const previousState: FridayKahfPreviousState = {
        mode: state.mode,
        playbackMode: state.playbackMode,
        queue: [...state.queue],
        currentIndex: state.currentIndex,
        currentTrack: state.currentTrack,
        radioLabel: state.radioLabel,
        userOverride: state.userOverride,
        phase: state.phase,
    };
    const session: FridayKahfSession = {
        dateKey,
        previousSnapshot,
        previousState,
        stopping: false,
        cycle: 0,
    };
    fridayKahfSessions.set(guildId, session);

    state.mode = 'Reciter';
    state.playbackMode = '\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u2014 \u0627\u0644\u062c\u0645\u0639\u0629' as PlaybackMode;
    state.queue = tracks;
    state.currentIndex = 0;
    state.currentTrack = tracks[0];
    state.userOverride = true;
    state.phase = 'main';
    await clearNowPlayingNotification(client, state);

    const playCycle = async (): Promise<void> => {
        if (session.stopping || fridayKahfSessions.get(guildId) !== session) return;
        session.cycle += 1;
        await playTrackQueue(voiceChannel, tracks, 0, async (rawTrack, index, total) => {
            if (session.stopping || fridayKahfSessions.get(guildId) !== session) return;
            const track = rawTrack as PlaylistTrack;
            state.currentIndex = index;
            state.currentTrack = track;
            await notifyNowPlaying(client, state, track, index, total);
            await renderQuranPanel(client, guildId);
        }, async () => {
            if (session.stopping || fridayKahfSessions.get(guildId) !== session) return;
            await sendAuditLog(client, guildId, {
                level: 'info', system: 'Jumuah', action: 'Friday Al-Kahf cycle completed',
                details: `Cycle ${session.cycle} completed with ${tracks.length} reciters; restarting automatically.`,
            });
            await playCycle();
        });
    };

    try {
        await playCycle();
        await sendAuditLog(client, guildId, {
            level: 'success', system: 'Jumuah', action: 'Friday Al-Kahf loop started after Fajr',
            details: `${tracks.length} reciters in <#${voiceChannel.id}> \u2014 ${dateKey}.`,
        });
        return true;
    } catch (error) {
        logger.error(`[Jumuah] Failed to start Friday Al-Kahf loop for ${guildId}:`, error);
        await stopFridayKahfLoop(client, guildId, 'start_failed').catch(() => {});
        return false;
    }
}

export async function stopFridayKahfLoop(
    client: Client,
    guildId: string,
    reason = 'dhuhr',
): Promise<boolean> {
    const session = fridayKahfSessions.get(guildId);
    if (!session) return false;
    session.stopping = true;
    fridayKahfSessions.delete(guildId);
    stopGuildPlayback(guildId);

    const state = getQuranRuntimeState(guildId);
    const previous = session.previousState;
    state.mode = previous.mode;
    state.playbackMode = previous.playbackMode;
    state.queue = previous.queue;
    state.currentIndex = previous.currentIndex;
    state.currentTrack = previous.currentTrack;
    state.radioLabel = previous.radioLabel;
    state.userOverride = previous.userOverride;
    state.phase = previous.phase;
    await clearNowPlayingNotification(client, state);

    const config = await getQuranRadioConfig(guildId);
    const guild = client.guilds.cache.get(guildId);
    const voiceChannel = config ? guild?.channels.cache.get(config.voiceChannelId) : null;
    if (session.previousSnapshot) {
        await resumePlayback(session.previousSnapshot);
    } else if (config?.twentyFourSeven && voiceChannel?.isVoiceBased()) {
        await startRandomQuranKareem(client, state, voiceChannel, false);
    } else {
        state.mode = 'Idle';
        state.currentTrack = undefined;
    }
    await renderQuranPanel(client, guildId);
    await sendAuditLog(client, guildId, {
        level: 'success', system: 'Jumuah', action: 'Friday Al-Kahf loop stopped; normal source restored',
        details: `Reason: ${reason} \u2014 previous source: ${session.previousSnapshot ? 'restored' : config?.twentyFourSeven ? '24/7 live' : 'none'}.`,
    });
    return true;
}
function memberVoice(interaction: any): VoiceBasedChannel | null {
    return (interaction.member as GuildMember)?.voice?.channel || null;
}

// startLive function removed

async function startSavedPlaylistPrompt(client: Client, state: QuranRuntimeState, userId: string) {
    const playlist = await loadPlaylist(state.guildId, userId);
    if (playlist.tracks.length === 0) return;
    const channel = await voiceTextChannel(client, state.voiceChannelId);
    if (!channel) return;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_saved_resume').setLabel('كمل من فين وقفتي').setEmoji('▶️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('qr_saved_restart').setLabel('عاود من البداية').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('qr_saved_normal').setLabel('تشغيل عادي').setEmoji('🎧').setStyle(ButtonStyle.Secondary),
    );
    await sendVoiceChat(channel, { content: `<@${userId}> عندك Playlist محفوظة (${playlist.tracks.length} سورة).`, components: [row] }, true);
}

export async function handleUserJoinRadioV2(client: Client, member: GuildMember, voiceChannel: VoiceBasedChannel) {
    const config = await getQuranRadioConfig(member.guild.id);
    if (!config || voiceChannel.id !== config.voiceChannelId) return;
    const state = getQuranRuntimeState(member.guild.id);
    state.voiceChannelId = config.voiceChannelId;
    state.twentyFourSeven = config.twentyFourSeven;
    if (!state.controllerOrder.includes(member.id)) state.controllerOrder.push(member.id);
    if (state.controllerId) return;
    state.controllerId = state.controllerOrder[0] || member.id;
    if (isFridayKahfLoopActive(member.guild.id)) {
        await renderQuranPanel(client, member.guild.id, `\u{1F31F} <@${member.id}> \u0646\u0638\u0627\u0645 \u0627\u0644\u062c\u0645\u0639\u0629 \u0645\u0641\u0639\u0644: \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u0628\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621 \u0645\u0633\u062a\u0645\u0631\u0629 \u062d\u062a\u0649 \u0623\u0630\u0627\u0646 \u0627\u0644\u0638\u0647\u0631.`);
        return;
    }
    await renderQuranPanel(
        client,
        member.guild.id,
        `👋 <@${member.id}> أنت المتحكم الآن. اختَر المصدر الذي تريد سماعه.`,
        CONTROLLER_NOTICE_LIFETIME_MS,
    );
    await startSavedPlaylistPrompt(client, state, member.id);
    await sendAuditLog(client, member.guild.id, {
        level: 'info', system: 'Quran', action: 'Controller assigned', actorId: member.id,
        details: `أول عضو دخل <#${voiceChannel.id}>.`,
    });
}

export async function handleUserLeaveRadioV2(client: Client, member: GuildMember, voiceChannel: VoiceBasedChannel) {
    const config = await getQuranRadioConfig(member.guild.id);
    if (!config || voiceChannel.id !== config.voiceChannelId) return;
    const state = getQuranRuntimeState(member.guild.id);
    state.controllerOrder = state.controllerOrder.filter(id => id !== member.id);
    const remaining = voiceChannel.members.filter(m => !m.user.bot);
    if (remaining.size > 0 && state.controllerId === member.id) {
        const nextId = state.controllerOrder.find(id => remaining.has(id)) || remaining.firstKey()!;
        const next = remaining.get(nextId)!;
        state.controllerId = next.id;
        await renderQuranPanel(
            client,
            state.guildId,
            `🔄 <@${next.id}> انتقل إليك التحكم بعد خروج المتحكم السابق.`,
            CONTROLLER_NOTICE_LIFETIME_MS,
        );
        await startSavedPlaylistPrompt(client, state, next.id);
        return;
    }
    if (remaining.size === 0) {
        state.controllerId = undefined;
        if (isFridayKahfLoopActive(state.guildId) || isAdhanPlaybackActive(state.guildId)) {
            await renderQuranPanel(client, state.guildId);
            return;
        }
        state.userOverride = false;
        state.queue = [];
        state.currentTrack = undefined;
        if (state.twentyFourSeven) await enforceQuran24Cycle(client, state.guildId, true);
        else {
            stopGuildPlayback(state.guildId);
            state.mode = 'Idle';
        }
        await renderQuranPanel(client, state.guildId);
    }
}

async function playlistView(interaction: any, state: QuranRuntimeState, replace = false, notice?: string) {
    const userId = state.controllerId || interaction.user.id;
    const playlist = await loadPlaylist(state.guildId, userId);
    const pageSize = 10;
    const pages = Math.max(1, Math.ceil(playlist.tracks.length / pageSize));
    state.playlistPage = Math.max(0, Math.min(state.playlistPage, pages - 1));
    const start = state.playlistPage * pageSize;
    const pageTracks = playlist.tracks.slice(start, start + pageSize);
    const listDescription = pageTracks.length
        ? pageTracks.map((t, i) => `**${start + i + 1}.** ${t.title} — ${t.subtitle}`).join('\n')
        : 'القائمة فارغة.';
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle(`📋 Playlist ديال <@${userId}>`)
        .setDescription(`${notice ? `${notice}\n\n` : ''}${listDescription}`)
        .setFooter({ text: `صفحة ${state.playlistPage + 1}/${pages} — ${playlist.tracks.length} سورة` });
    const components: any[] = [];
    if (pageTracks.length) {
        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('qr_playlist_select').setPlaceholder('اختر سورة لإدارتها').addOptions(
                pageTracks.map((t, i) => ({ label: `${start + i + 1}. ${t.title}`.slice(0, 100), value: String(start + i), description: t.subtitle?.slice(0, 100) })),
            ),
        ));
    }
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_playlist_prevpage').setLabel('السابق').setStyle(ButtonStyle.Secondary).setDisabled(state.playlistPage === 0),
        new ButtonBuilder().setCustomId('qr_playlist_nextpage').setLabel('التالي').setStyle(ButtonStyle.Secondary).setDisabled(state.playlistPage >= pages - 1),
        new ButtonBuilder().setCustomId('qr_playlist_restart').setLabel('تشغيل من البداية').setStyle(ButtonStyle.Success).setDisabled(!playlist.tracks.length),
        new ButtonBuilder().setCustomId('qr_playlist_clear').setLabel('مسح القائمة').setStyle(ButtonStyle.Danger).setDisabled(!playlist.tracks.length),
    ));
    const payload = { embeds: [embed], components };
    if (replace) await interaction.editReply(payload);
    else await interaction.followUp({ ...payload, flags: 64 });
}

async function playlistDecisionView(interaction: any, state: QuranRuntimeState) {
    const userId = state.controllerId || interaction.user.id;
    const playlist = await loadPlaylist(state.guildId, userId);
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📋 تنظيم اختياراتك')
        .setDescription(
            `عندك حالياً **${playlist.tracks.length}** اختيار محفوظ.\n\n` +
            'واش بغيتي تجمعهم كاملين فـPlaylist وحدة بنفس الترتيب، ولا تمسح الاختيارات وتبدا من جديد؟',
        );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('qr_playlist_combine')
            .setLabel('جمع اختياراتي')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!playlist.tracks.length),
        new ButtonBuilder()
            .setCustomId('qr_playlist_reset')
            .setLabel('مسح والبدء من جديد')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger),
    );
    await interaction.followUp({ embeds: [embed], components: [row], flags: 64 });
}

async function resetPlaylistChoices(interaction: any, state: QuranRuntimeState): Promise<void> {
    const userId = state.controllerId || interaction.user.id;
    await savePlaylist(state.guildId, userId, { tracks: [], position: 0, updatedAt: new Date().toISOString() });
    state.pendingTrack = undefined;
    state.selectedQueueIndex = undefined;
    state.playlistPage = 0;
    state.selectedReciterId = undefined;
    state.phase = 'main';
    state.mode = 'AudioLibrary';
    await interaction.editReply({
        content: '✅ تم مسح اختياراتك. تقدر دابا تختار القارئ والسور من جديد، والصوت الحالي غيبقى خدام حتى تشغل اختيار جديد.',
        embeds: [],
        components: [],
    });
}

async function requireControl(interaction: any, state: QuranRuntimeState): Promise<boolean> {
    const member = interaction.member as GuildMember;
    const isAdmin = member.permissions.has(PermissionFlagsBits.ManageGuild);
    if (!state.controllerId && !isAdmin) {
        if (member.voice.channelId !== state.voiceChannelId) {
            await interaction.reply({ content: '❌ خاصك تكون داخل قناة القرآن باش تولّي المتحكم.', flags: 64 });
            return false;
        }
        state.controllerId = member.id;
        if (!state.controllerOrder.includes(member.id)) state.controllerOrder.push(member.id);
    }
    if (state.controllerId && state.controllerId !== member.id && !isAdmin) {
        await interaction.reply({ content: '❌ التحكم متاح للمتحكم الحالي والمشرفين فقط.', flags: 64 });
        return false;
    }
    return true;
}

export async function handleRadioInteractionV2(interaction: any) {
    if (!interaction.customId.startsWith('qr_') || !interaction.guildId) return;
    const state = getQuranRuntimeState(interaction.guildId);
    if (isAdhanPlaybackActive(interaction.guildId)) {
        await interaction.reply({
            content: '\u{1F54C} \u0627\u0644\u0623\u0630\u0627\u0646 \u062e\u062f\u0627\u0645 \u062f\u0627\u0628\u0627. \u0644\u0648\u062d\u0629 \u0627\u0644\u0642\u0631\u0622\u0646 \u063a\u062a\u0631\u062c\u0639 \u062a\u062e\u062f\u0645 \u0645\u0646 \u0628\u0639\u062f \u0645\u0627 \u064a\u0633\u0627\u0644\u064a \u0627\u0644\u0623\u0630\u0627\u0646 \u0643\u0627\u0645\u0644.',
            flags: 64,
        });
        return;
    }
    if (isFridayKahfLoopActive(interaction.guildId)) {
        await interaction.reply({
            content: '\u{1F31F} \u0646\u0638\u0627\u0645 \u0627\u0644\u062c\u0645\u0639\u0629 \u062e\u062f\u0627\u0645 \u062f\u0627\u0628\u0627: \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u0628\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621 \u063a\u062a\u0628\u0642\u0649 Loop \u062d\u062a\u0649 \u0623\u0630\u0627\u0646 \u0627\u0644\u0638\u0647\u0631\u060c \u0648\u0645\u0646 \u0628\u0639\u062f \u063a\u064a\u0631\u062c\u0639 \u0627\u0644\u062a\u062d\u0643\u0645 \u0627\u0644\u0639\u0627\u062f\u064a.',
            flags: 64,
        });
        return;
    }
    if (!(await requireControl(interaction, state))) return;
    const vc = memberVoice(interaction);

    try {
        if (interaction.isStringSelectMenu()) {
            await interaction.deferUpdate();
            if (interaction.customId === 'qr_select_reciter') {
                state.selectedReciterId = interaction.values[0];
                state.mode = 'AudioLibrary';
                state.phase = 'choose_mode';
            } else if (interaction.customId === 'qr_select_surah') {
                const index = Number(interaction.values[0]);
                const reciter = state.selectedReciterId ? getReciterById(state.selectedReciterId) : undefined;
                const surah = reciter?.surahs[index];
                if (reciter && surah) {
                    state.pendingTrack = { url: surah.url, title: surah.name, subtitle: reciter.name, reciterId: reciter.id, surahIndex: index };
                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('qr_play_now_discard').setLabel('تشغيل الآن وإلغاء الحالية').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('qr_play_now_return').setLabel('تشغيل ثم الرجوع للحالية').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('qr_add_next').setLabel('إضافة من بعد').setStyle(ButtonStyle.Success),
                    );
                    await interaction.followUp({ content: `📖 **${surah.name}** — ${reciter.name}`, components: [row], flags: 64 });
                }
            } else if (interaction.customId === 'qr_playlist_select') {
                state.selectedQueueIndex = Number(interaction.values[0]);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId('qr_playlist_up').setLabel('تقديم').setEmoji('⬆️').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('qr_playlist_down').setLabel('تأخير').setEmoji('⬇️').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('qr_playlist_delete').setLabel('حذف').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
                );
                await interaction.followUp({ content: 'اختر العملية:', components: [row], flags: 64 });
            }
            await renderQuranPanel(interaction.client, state.guildId);
            return;
        }

        if (!interaction.isButton()) return;
        await interaction.deferUpdate();
        const id = interaction.customId;
        if (id === 'qr_btn_quran_kareem' && vc) {
            await startRandomQuranKareem(interaction.client, state, vc, true);
        } else if (id === 'qr_btn_audio_library') {
            state.mode = 'AudioLibrary'; state.phase = 'main'; state.userOverride = true; state.reciterPage = 0; state.selectedReciterId = undefined;
        } else if (id === 'qr_btn_favorite_reciters') {
            state.mode = 'FavoriteReciters'; state.phase = 'main'; state.userOverride = true; state.selectedReciterId = undefined;
        } else if (id === 'qr_reciter_prevpage') {
            state.reciterPage = Math.max(0, state.reciterPage - 1);
        } else if (id === 'qr_reciter_nextpage') {
            const allReciters = getAllReciters();
            const filteredReciters = allReciters.filter(r => r.category === 'library');
            const totalPages = Math.ceil(filteredReciters.length / 25);
            state.reciterPage = Math.min(totalPages - 1, state.reciterPage + 1);
        } else if (id === 'qr_mode_ordered' && vc && state.selectedReciterId) {
            await startQueue(interaction.client, state, vc, reciterTracks(state.selectedReciterId), 'بالترتيب');
        } else if (id === 'qr_mode_random' && vc && state.selectedReciterId) {
            await startQueue(interaction.client, state, vc, shuffle(reciterTracks(state.selectedReciterId)), 'عشوائي');
        } else if (id === 'qr_mode_manual') {
            state.phase = 'choose_surah'; state.surahPage = 0; state.playbackMode = 'اختيار يدوي';
        } else if (id === 'qr_surah_prevpage') state.surahPage = Math.max(0, state.surahPage - 1);
        else if (id === 'qr_surah_nextpage') state.surahPage = Math.min(4, state.surahPage + 1);
        else if (id === 'qr_back_library') state.phase = 'choose_mode';
        else if (id === 'qr_play_now_discard' && vc && state.pendingTrack) {
            await appendToSavedPlaylist(state, state.pendingTrack, interaction.user.id);
            const remaining = state.queue.slice(state.currentIndex + 1);
            await startQueue(interaction.client, state, vc, [state.pendingTrack, ...remaining], 'اختيار يدوي');
            state.pendingTrack = undefined;
        } else if (id === 'qr_play_now_return' && vc && state.pendingTrack) {
            await appendToSavedPlaylist(state, state.pendingTrack, interaction.user.id);
            const current = state.currentTrack ? [state.currentTrack] : [];
            const remaining = state.queue.slice(state.currentIndex + 1);
            await startQueue(interaction.client, state, vc, [state.pendingTrack, ...current, ...remaining], 'اختيار يدوي');
            state.pendingTrack = undefined;
        } else if (id === 'qr_add_next' && state.pendingTrack) {
            await appendToSavedPlaylist(state, state.pendingTrack, interaction.user.id);
            if (state.queue.length) state.queue.splice(state.currentIndex + 1, 0, state.pendingTrack);
            else state.queue.push(state.pendingTrack);
            state.pendingTrack = undefined;
        } else if (id === 'qr_btn_toggle_pause') state.isPaused = toggleGuildPause(state.guildId) || false;
        else if (id === 'qr_btn_next') nextGuildTrack(state.guildId);
        else if (id === 'qr_btn_prev') previousGuildTrack(state.guildId);
        else if (id === 'qr_btn_stop') {
            stopGuildPlayback(state.guildId);
            state.mode = 'Idle';
            state.currentTrack = undefined;
            await clearNowPlayingNotification(interaction.client, state);
        }
        else if (id === 'qr_playlist') await playlistDecisionView(interaction, state);
        else if (id === 'qr_playlist_combine') {
            const userId = state.controllerId || interaction.user.id;
            const playlist = await loadPlaylist(state.guildId, userId);
            playlist.position = 0;
            await savePlaylist(state.guildId, userId, playlist);
            state.playlistPage = 0;
            state.selectedQueueIndex = undefined;
            await playlistView(
                interaction,
                state,
                true,
                `✅ تجمعو **${playlist.tracks.length}** اختيار فـPlaylist وحدة بنفس الترتيب.`,
            );
        }
        else if (id === 'qr_playlist_reset') await resetPlaylistChoices(interaction, state);
        else if (id === 'qr_playlist_prevpage') { state.playlistPage = Math.max(0, state.playlistPage - 1); await playlistView(interaction, state); }
        else if (id === 'qr_playlist_nextpage') { state.playlistPage += 1; await playlistView(interaction, state); }
        else if (id === 'qr_playlist_clear') {
            await resetPlaylistChoices(interaction, state);
        } else if (id === 'qr_playlist_restart' && vc && state.controllerId) {
            const playlist = await loadPlaylist(state.guildId, state.controllerId);
            await startQueue(interaction.client, state, vc, playlist.tracks, 'Playlist', 0);
        } else if (['qr_playlist_up', 'qr_playlist_down', 'qr_playlist_delete'].includes(id) && state.controllerId && state.selectedQueueIndex !== undefined) {
            const playlist = await loadPlaylist(state.guildId, state.controllerId);
            const index = state.selectedQueueIndex;
            if (id === 'qr_playlist_delete') playlist.tracks.splice(index, 1);
            else {
                const target = id === 'qr_playlist_up' ? index - 1 : index + 1;
                if (target >= 0 && target < playlist.tracks.length) [playlist.tracks[index], playlist.tracks[target]] = [playlist.tracks[target], playlist.tracks[index]];
            }
            await savePlaylist(state.guildId, state.controllerId, playlist);
            state.queue = playlist.tracks;
            await interaction.followUp({ content: '✅ تم تحديث Playlist.', flags: 64 });
        } else if (id === 'qr_saved_normal') {
            await interaction.followUp({ content: '🎧 استعمل لوحة المصادر للتشغيل العادي.', flags: 64 });
        } else if ((id === 'qr_saved_resume' || id === 'qr_saved_restart') && vc && state.controllerId) {
            const playlist = await loadPlaylist(state.guildId, state.controllerId);
            await startQueue(interaction.client, state, vc, playlist.tracks, 'Playlist', id === 'qr_saved_resume' ? playlist.position : 0);
        } else if (id === 'qr_complete_loop' && vc) {
            const queueMode = state.completedQueueMode || state.playbackMode;
            const tracks = queueMode === 'عشوائي' ? shuffle(state.queue) : state.queue;
            state.completedQueueMode = undefined;
            await interaction.editReply({ components: [] }).catch(() => {});
            await startQueue(interaction.client, state, vc, tracks, queueMode || 'بالترتيب', 0);
        } else if (id === 'qr_complete_source') {
            state.completedQueueMode = undefined;
            await interaction.editReply({ components: [] }).catch(() => {});
            if (state.twentyFourSeven) {
                state.mode = 'QuranKareem';
                state.phase = 'main';
            } else {
                stopGuildPlayback(state.guildId);
                state.mode = 'Idle';
                state.phase = 'main';
                state.queue = [];
                state.currentTrack = undefined;
            }
        }
        await renderQuranPanel(interaction.client, state.guildId);
    } catch (error) {
        logger.error('[QuranV2] Interaction error:', error);
        await interaction.followUp({ content: '❌ وقع خطأ أثناء معالجة التحكم.', flags: 64 }).catch(() => {});
    }
}

async function getCycleStart(guildId: string): Promise<string> {
    const runtime = await getAdvancedConfig<{ cycleStartedAt: string }>(guildId, 'quran24Runtime');
    if (runtime?.cycleStartedAt) return runtime.cycleStartedAt;
    const started = new Date().toISOString();
    await setAdvancedConfig(guildId, 'quran24Runtime', { cycleStartedAt: started });
    return started;
}

export async function enforceQuran24Cycle(client: Client, guildId: string, force = false) {
    if (isFridayKahfLoopActive(guildId) || isAdhanPlaybackActive(guildId)) return;
    const config = await getQuranRadioConfig(guildId);
    if (!config?.twentyFourSeven) return;
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(config.voiceChannelId);
    if (!channel?.isVoiceBased()) return;
    const state = getQuranRuntimeState(guildId);
    state.voiceChannelId = config.voiceChannelId;
    state.twentyFourSeven = true;
    const humans = channel.members.filter(m => !m.user.bot);
    if (!force) {
        const me = guild?.members.me;
        const permissions = me ? channel.permissionsFor(me) : null;
        if (permissions?.has(PermissionFlagsBits.Speak) && (me?.voice.suppress || me?.voice.selfMute || me?.voice.serverMute)) {
            await recoverGuildVoiceConnection(guildId);
        }
        if (!state.panelMessageId && permissions?.has(PermissionFlagsBits.SendMessages)) {
            await renderQuranPanel(client, guildId, state.controllerId ? `<@${state.controllerId}> تم تفعيل لوحة التحكم بعد إصلاح الصلاحيات.` : undefined);
        }
    }
    if (humans.size > 0 && state.userOverride && !force) {
        quran24StallSince.delete(guildId);
        return;
    }
    if (!force && state.mode === 'QuranKareem') {
        // ─── Watchdog: detect zombie/silent playback ───────────────────
        // Only restart when playback has been silent for a sustained period.
        // A single tick must never cut a surah that is still playing or
        // during the short transition between surahs.
        if (!state.isPaused) {
            const health = getVoicePlaybackHealth(guildId);
            const isHealthy = health.active
                && (health.connectionStatus as string) === 'ready'
                && (health.playerStatus as string) === 'playing';
            if (isHealthy) {
                quran24StallSince.delete(guildId);
                return; // Audio is healthy, nothing to do
            }
            const stalledSince = quran24StallSince.get(guildId) ?? Date.now();
            quran24StallSince.set(guildId, stalledSince);
            if (Date.now() - stalledSince < QURAN_STALL_RESTART_MS) {
                return; // Still within a legitimate transition window
            }
            logger.warn(
                `[QuranV2] ${guildId}: Zombie/silent playback detected for > ${QURAN_STALL_RESTART_MS / 1000}s ` +
                `(conn=${health.connectionStatus ?? 'none'}, player=${health.playerStatus ?? 'none'}). ` +
                `Restarting stream...`,
            );
            // Fall through → startRandomQuranKareem will restart
        } else {
            quran24StallSince.delete(guildId);
            return; // Bot is intentionally paused
        }
    } else {
        quran24StallSince.delete(guildId);
    }
    quran24StallSince.delete(guildId);
    state.controllerId = humans.first()?.id;
    state.userOverride = false;
    await startRandomQuranKareem(client, state, channel, false);
}

async function assignExistingController(client: Client, guildId: string): Promise<void> {
    const config = await getQuranRadioConfig(guildId);
    const guild = client.guilds.cache.get(guildId);
    const channel = config ? guild?.channels.cache.get(config.voiceChannelId) : null;
    if (!channel?.isVoiceBased()) return;
    const humans = channel.members.filter(member => !member.user.bot);
    if (!humans.size) return;
    const state = getQuranRuntimeState(guildId);
    state.controllerOrder = [...humans.keys()];
    const first = humans.first()!;
    state.controllerId = state.controllerId && humans.has(state.controllerId) ? state.controllerId : first.id;
    if (!state.panelMessageId) {
        await renderQuranPanel(
            client,
            guildId,
            `👋 <@${state.controllerId}> أنت المتحكم الحالي. تم استرجاع لوحة القرآن.`,
            CONTROLLER_NOTICE_LIFETIME_MS,
        );
        await startSavedPlaylistPrompt(client, state, state.controllerId);
    }
}

export async function applyQuranConfiguration(client: Client, guildId: string) {
    const config = await getQuranRadioConfig(guildId);
    if (!config) return;
    const state = getQuranRuntimeState(guildId);
    state.voiceChannelId = config.voiceChannelId;
    state.twentyFourSeven = config.twentyFourSeven;
    if (config.twentyFourSeven) {
        await setAdvancedConfig(guildId, 'quran24Runtime', { cycleStartedAt: new Date().toISOString() });
        await enforceQuran24Cycle(client, guildId, true);
        if (!cycleTimers.has(guildId)) {
            cycleTimers.set(guildId, setInterval(() => enforceQuran24Cycle(client, guildId).catch(() => {}), 60_000));
        }
    } else {
        const timer = cycleTimers.get(guildId);
        if (timer) clearInterval(timer);
        cycleTimers.delete(guildId);
        const guild = client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(config.voiceChannelId);
        if (channel?.isVoiceBased() && channel.members.filter(m => !m.user.bot).size === 0) stopGuildPlayback(guildId);
    }
    await assignExistingController(client, guildId);
}

export async function initializeQuranSystems(client: Client) {
    for (const guild of client.guilds.cache.values()) {
        const config = await getQuranRadioConfig(guild.id);
        if (!config) continue;
        const state = getQuranRuntimeState(guild.id);
        state.voiceChannelId = config.voiceChannelId;
        state.twentyFourSeven = config.twentyFourSeven;
        if (config.twentyFourSeven) await enforceQuran24Cycle(client, guild.id, true).catch(error => logger.error('[QuranV2] 24h startup failed:', error));
        await assignExistingController(client, guild.id).catch(() => {});
        if (!cycleTimers.has(guild.id)) {
            cycleTimers.set(guild.id, setInterval(() => enforceQuran24Cycle(client, guild.id).catch(() => {}), 60_000));
        }
    }
}

export async function saveQuranSetupV2(client: Client, guildId: string, voiceChannelId: string, enabled24h: boolean) {
    await saveQuranRadioConfig(guildId, voiceChannelId, voiceChannelId, enabled24h, enabled24h ? 'quran_kareem' : 'none');
    await applyQuranConfiguration(client, guildId);
}

export function getQuranPlaybackSnapshot(guildId: string) {
    return getPlaybackSnapshot(guildId);
}





