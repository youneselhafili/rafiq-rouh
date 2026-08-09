import axios from 'axios';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnection,
    AudioPlayer,
    VoiceConnectionStatus,
    entersState,
    StreamType,
} from '@discordjs/voice';
import { VoiceBasedChannel } from 'discord.js';
import { LIVE_MAKKAH_URL, LIVE_MADINA_URL } from '../utils/constants';
import { logger } from '../utils/logger';
import { getReciterByName, getReciterById, getRadioWithLive, getRadioById, searchReciters, getReciters, buildSurahUrls } from './contentService';

export { Moshaf, Reciter, RadioStation } from '../types';

export const activeConnections = new Map<string, { connection: VoiceConnection; player: AudioPlayer }>();

export function getActivePlayer(guildId: string): AudioPlayer | undefined {
    return activeConnections.get(guildId)?.player;
}

export function getActiveConnection(guildId: string): VoiceConnection | undefined {
    return activeConnections.get(guildId)?.connection;
}

export function skipTrack(guildId: string) {
    const player = getActivePlayer(guildId);
    if (player) player.stop();
}

export function previousTrack(guildId: string) {
    const player = getActivePlayer(guildId);
    if (player) player.stop();
}

export function fetchReciters() {
    return Promise.resolve(getReciters());
}

export function fetchRadios() {
    return Promise.resolve(getRadioWithLive());
}

export { getRadioById, searchReciters, getReciterById, getReciterByName, buildSurahUrls };

function joinChannel(channel: VoiceBasedChannel): VoiceConnection {
    const guildId = channel.guild.id;

    const existing = activeConnections.get(guildId);
    if (existing) {
        existing.player.stop();
        try { existing.connection.destroy(); } catch {}
        activeConnections.delete(guildId);
    }

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        daveEncryption: true,
    });

    
    connection.on('error', error => {
        logger.warn(`[Voice] ${guildId}: legacy voice connection error handled: ${error instanceof Error ? error.message : String(error)}`);
    });

    return connection;
}

async function validateUrl(url: string): Promise<boolean> {
    try {
        const response = await axios.head(url, { timeout: 5000 });
        return response.status >= 200 && response.status < 400;
    } catch {
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                responseType: 'stream',
                headers: { Range: 'bytes=0-1024' },
            });
            response.data.destroy();
            return true;
        } catch {
            return false;
        }
    }
}

export async function streamSurahs(
    channel: VoiceBasedChannel,
    urls: string[]
): Promise<void> {
    const connection = joinChannel(channel);
    const player = createAudioPlayer();
    const guildId = channel.guild.id;

    activeConnections.set(guildId, { connection, player });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
        logger.error('Voice connection failed to become ready.');
        try { connection.destroy(); } catch {}
        activeConnections.delete(guildId);
        return;
    }

    connection.subscribe(player);

    let currentIndex = 0;
    let consecutiveErrors = 0;

    const playNext = async () => {
        if (!activeConnections.has(guildId)) return;

        if (currentIndex >= urls.length) {
            currentIndex = 0;
            consecutiveErrors = 0;
        }

        let attempts = 0;
        while (attempts < Math.min(5, urls.length)) {
            if (currentIndex >= urls.length) currentIndex = 0;

            const url = urls[currentIndex];
            logger.info(`🎵 Validating surah ${currentIndex + 1}/${urls.length}: ${url}`);

            const isValid = await validateUrl(url);
            if (isValid) break;

            logger.warn(`⏭️ Skipping invalid URL: ${url}`);
            currentIndex++;
            attempts++;
        }

        if (attempts >= Math.min(5, urls.length)) {
            logger.error('Too many invalid URLs. Stopping playback.');
            stopAudio(guildId);
            return;
        }

        try {
            const url = urls[currentIndex];
            const response = await axios.get(url, { responseType: 'stream' });
            const resource = createAudioResource(response.data, {
                inputType: StreamType.Arbitrary,
                inlineVolume: false,
            });

            player.play(resource);
            consecutiveErrors = 0;
            logger.success(`▶️ Playing surah ${currentIndex + 1}/${urls.length}`);
            currentIndex++;
        } catch (error) {
            logger.error(`Error playing surah ${currentIndex + 1}:`, error);
            consecutiveErrors++;
            if (consecutiveErrors > 3) {
                logger.error('Too many consecutive errors. Stopping.');
                stopAudio(guildId);
                return;
            }
            currentIndex++;
            await new Promise(resolve => setTimeout(resolve, 2000));
            playNext();
        }
    };

    player.on(AudioPlayerStatus.Idle, () => {
        playNext();
    });

    player.on('error', (error) => {
        logger.error(`Audio player error: ${error.message}`);
        consecutiveErrors++;
        if (consecutiveErrors > 3) {
            logger.error('Too many errors. Stopping.');
            stopAudio(guildId);
            return;
        }
        currentIndex++;
        setTimeout(playNext, 2000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch {
            try { connection.destroy(); } catch {}
            activeConnections.delete(guildId);
        }
    });

    playNext();
}

export async function streamRadio(
    channel: VoiceBasedChannel,
    streamUrl: string,
    label: string = 'Radio'
): Promise<boolean> {
    const connection = joinChannel(channel);
    const player = createAudioPlayer();
    const guildId = channel.guild.id;

    activeConnections.set(guildId, { connection, player });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
        logger.error(`Voice connection failed for radio: ${label}`);
        try { connection.destroy(); } catch {}
        activeConnections.delete(guildId);
        return false;
    }

    connection.subscribe(player);

    const startStream = async () => {
        if (!activeConnections.has(guildId)) return;
        try {
            const response = await axios.get(streamUrl, { responseType: 'stream' });
            const resource = createAudioResource(response.data, {
                inputType: StreamType.Arbitrary,
            });
            player.play(resource);
            logger.info(`📻 Streaming radio: ${label}`);
        } catch (error) {
            logger.error(`Error starting radio stream ${label}:`, error);
            setTimeout(startStream, 5000);
        }
    };

    player.on(AudioPlayerStatus.Idle, () => {
        logger.info(`📻 Radio stream idle (${label}), reconnecting...`);
        setTimeout(startStream, 3000);
    });

    player.on('error', (error) => {
        logger.error(`Radio stream error (${label}): ${error.message}`);
        setTimeout(startStream, 5000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch {
            try { connection.destroy(); } catch {}
            activeConnections.delete(guildId);
        }
    });

    startStream();
    return true;
}

export async function streamLive(
    channel: VoiceBasedChannel,
    type: 'makkah' | 'madina'
): Promise<void> {
    const url = type === 'makkah' ? LIVE_MAKKAH_URL : LIVE_MADINA_URL;
    const label = type === 'makkah' ? 'الحرم المكي' : 'المسجد النبوي';
    await streamRadio(channel, url, label);
}

export function stopAudio(guildId: string): boolean {
    const active = activeConnections.get(guildId);
    if (active) {
        active.player.stop();
        try { active.connection.destroy(); } catch {}
        activeConnections.delete(guildId);
        logger.info(`⏹️ Stopped audio in guild ${guildId}`);
        return true;
    }
    return false;
}



