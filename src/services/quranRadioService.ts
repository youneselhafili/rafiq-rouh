import {
    Client,
    VoiceBasedChannel,
    GuildMember,
    TextChannel,
    PermissionFlagsBits,
} from 'discord.js';
import { getQuranRadioConfig, saveQuranRadioConfig } from './guildService';
import {
    getActivePlayer,
    streamSurahs,
    streamRadio,
    stopAudio,
    fetchRadios,
    skipTrack,
    previousTrack,
} from './quranService';
import { getAllReciters, getReciterById } from '../quran/quranRegistry';
import { buildControlPanel } from './quranPanelRenderer';
import { updateSession } from './quranSessionManager';
import { logger } from '../utils/logger';

export type RadioMode = 'Idle' | 'Reciter' | 'Makkah' | 'Madinah' | 'Radio' | 'AudioLibrary';

export interface RadioState {
    mode: RadioMode;
    reciterId?: string;
    reciterName?: string;
    surahIndex?: number;
    surahTotal?: number;
    controllerId?: string;
    panelMessageId?: string;
    voiceChannelId?: string;
    textChannelId?: string;
    isPaused: boolean;
    radioLabel?: string;
    radioUrl?: string;
    twentyFourSeven: boolean;
    defaultSource: string;
}

const radioStates = new Map<string, RadioState>();

export function getRadioState(guildId: string): RadioState {
    let state = radioStates.get(guildId);
    if (!state) {
        state = { mode: 'Idle', isPaused: false, twentyFourSeven: false, defaultSource: 'none' };
        radioStates.set(guildId, state);
    }
    return state;
}

export function updateRadioState(guildId: string, partial: Partial<RadioState>) {
    const state = getRadioState(guildId);
    Object.assign(state, partial);
}

async function getControllerTag(client: Client, guildId: string, userId?: string): Promise<string | null> {
    if (!userId) return null;
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return member.user.tag;
    } catch {
        return null;
    }
}

export async function sendOrUpdatePanel(
    client: Client,
    guildId: string,
    mentionText?: string,
): Promise<void> {
    const state = getRadioState(guildId);

    const channelId = state.textChannelId || state.voiceChannelId;
    if (!channelId) {
        logger.warn(`[Radio] No channel ID configured for guild ${guildId}, cannot send panel.`);
        return;
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            logger.error(`[Radio] Channel ${channelId} not found for guild ${guildId}. Check that the configured text channel still exists and the bot has access to it.`);
            return;
        }

        if (!channel.isTextBased()) {
            logger.error(`[Radio] Channel ${channelId} does not support text messages (guild: ${guildId}). The configured text channel is not a text channel. Run /setup_quran to set a valid text channel.`);
            return;
        }

        const textChannel = channel as TextChannel;
        const controllerTag = await getControllerTag(client, guildId, state.controllerId);
        const panelPayload = await buildControlPanel(controllerTag, state);

        if (state.panelMessageId) {
            try {
                const message = await textChannel.messages.fetch(state.panelMessageId).catch(() => null);
                if (message) {
                    await message.edit(panelPayload);
                    return;
                }
            } catch {
                state.panelMessageId = undefined;
                logger.warn(`[Radio] Panel message was deleted, will re-send (guild: ${guildId})`);
            }
        }

        const msgPayload: Record<string, unknown> = { embeds: panelPayload.embeds, components: panelPayload.components };
        if (mentionText) msgPayload.content = mentionText;

        const newMessage = await textChannel.send(msgPayload);
        state.panelMessageId = newMessage.id;
        updateSession(guildId, { panelMessageId: newMessage.id });
        logger.info(`[Radio] Control panel sent to ${channelId} (guild: ${guildId})`);
    } catch (error) {
        logger.error(`[Radio] Failed to send/update panel in ${channelId} (guild: ${guildId}):`, error);
    }
}

async function startDefaultSource(channel: VoiceBasedChannel, defaultSource: string, state: RadioState) {
    switch (defaultSource) {
    case 'makkah':
    case 'madinah':
        // Legacy live streams removed
        break;
    case 'radio_saudi': {
        const radios = await fetchRadios();
        const saudiRadio = radios.find(r => r.name.includes('السعودية'));
        state.radioLabel = saudiRadio?.name || 'إذاعة القرآن الكريم السعودية';
        state.radioUrl = saudiRadio?.url || 'http://stream.radiojar.com/0tpy1h0kxtzuv';
        await streamRadio(channel, state.radioUrl, state.radioLabel);
        break;
    }
    case 'radio_sunnah': {
        const radios = await fetchRadios();
        const sunnahRadio = radios.find(r => r.name.includes('السنة'));
        state.radioLabel = sunnahRadio?.name || 'راديو السنة النبوية';
        state.radioUrl = sunnahRadio?.url || 'https://radiosunna.radioca.st/stream';
        await streamRadio(channel, state.radioUrl, state.radioLabel);
        break;
    }
    case 'audio_library':
        state.radioLabel = undefined;
        state.radioUrl = undefined;
        stopAudio(channel.guild.id);
        break;
    }
}

export async function handleUserJoinRadio(client: Client, member: GuildMember, voiceChannel: VoiceBasedChannel) {
    const guildId = member.guild.id;
    const config = await getQuranRadioConfig(guildId);
    if (!config) {
        logger.warn(`[Radio] No config found for guild ${guildId}. Run /setup_quran first.`);
        return;
    }

    if (voiceChannel.id !== config.voiceChannelId) {
        logger.warn(`[Radio] User joined VC ${voiceChannel.id} but configured VC is ${config.voiceChannelId} (guild: ${guildId})`);
        return;
    }

    if (!config.textChannelId) {
        logger.error(`[Radio] textChannelId is missing in config for guild ${guildId}. Run /setup_quran again to set a text channel for the control panel.`);
        return;
    }

    const state = getRadioState(guildId);
    state.voiceChannelId = config.voiceChannelId;
    state.textChannelId = config.textChannelId;
    state.twentyFourSeven = config.twentyFourSeven;
    state.defaultSource = config.defaultSource;

    const isNewController = !state.controllerId || state.controllerId === member.id;
    if (!state.controllerId) {
        state.controllerId = member.id;
    }

    if (state.mode === 'Idle' && config.defaultSource && config.defaultSource !== 'none') {
        state.mode = getModeFromDefaultSource(config.defaultSource);
        state.isPaused = false;
        await startDefaultSource(voiceChannel, config.defaultSource, state);
    }

    await sendOrUpdatePanel(
        client,
        guildId,
        isNewController ? `👋 <@${member.id}> مرحباً بك! لوحة التحكم في إذاعة القرآن الكريم` : undefined,
    );
}

function getModeFromDefaultSource(source: string): RadioMode {
    switch (source) {
    case 'makkah': return 'Makkah';
    case 'madinah': return 'Madinah';
    case 'radio_saudi':
    case 'radio_sunnah': return 'Radio';
    case 'audio_library': return 'AudioLibrary';
    default: return 'Idle';
    }
}

export async function handleUserLeaveRadio(client: Client, member: GuildMember, voiceChannel: VoiceBasedChannel) {
    const guildId = member.guild.id;
    const config = await getQuranRadioConfig(guildId);
    if (!config) {
        logger.warn(`[Radio] No config found for guild ${guildId} on leave.`);
        return;
    }
    if (voiceChannel.id !== config.voiceChannelId) {
        logger.warn(`[Radio] User left VC ${voiceChannel.id} but configured VC is ${config.voiceChannelId} (guild: ${guildId})`);
        return;
    }

    const state = getRadioState(guildId);
    const remainingMembers = voiceChannel.members.filter(m => !m.user.bot);

    if (remainingMembers.size === 0) {
        if (state.twentyFourSeven && config.defaultSource && config.defaultSource !== 'none') {
            state.controllerId = undefined;
            state.mode = getModeFromDefaultSource(config.defaultSource);
            state.isPaused = false;
            state.reciterId = undefined;
            state.reciterName = undefined;
            state.surahIndex = undefined;
            state.surahTotal = undefined;
            state.radioLabel = undefined;
            state.radioUrl = undefined;
            await startDefaultSource(voiceChannel, config.defaultSource, state);
            await sendOrUpdatePanel(client, guildId);
            return;
        }

        state.controllerId = undefined;
        state.mode = 'Idle';
        state.reciterId = undefined;
        state.reciterName = undefined;
        state.surahIndex = undefined;
        state.surahTotal = undefined;
        state.isPaused = false;
        state.radioLabel = undefined;
        state.radioUrl = undefined;
        stopAudio(guildId);
        await sendOrUpdatePanel(client, guildId);
        return;
    }

    if (state.controllerId === member.id) {
        const nextController = remainingMembers.first()!;
        state.controllerId = nextController.id;
        await sendOrUpdatePanel(
            client,
            guildId,
            `🔄 غادر المتحكم السابق. <@${nextController.id}> هو المتحكم الجديد!`,
        );
    }
}

function setStateFromSourceButton(state: RadioState, member: GuildMember, mode: RadioMode, extra: Partial<RadioState> = {}) {
    state.mode = mode;
    state.isPaused = false;
    state.reciterId = undefined;
    state.reciterName = undefined;
    state.radioLabel = undefined;
    state.radioUrl = undefined;
    Object.assign(state, extra);
}

function getVoiceChannel(member: GuildMember): VoiceBasedChannel | null {
    return member.voice.channel;
}

export async function handleRadioInteraction(interaction: any) {
    if (!interaction.customId.startsWith('qr_')) return;

    const guildId = interaction.guildId;
    if (!guildId) return;

    try {
        const state = getRadioState(guildId);
        const member = interaction.member as GuildMember;

        if (state.controllerId && state.controllerId !== member.id && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ لا تملك صلاحية التحكم في الإذاعة حالياً.', flags: 64 });
        }

        await interaction.deferUpdate();

        if (interaction.isButton()) {
            switch (interaction.customId) {
            case 'qr_btn_makkah':
            case 'qr_btn_madinah':
                // Legacy live streams removed
                break;
            case 'qr_btn_radio_saudi': {
                const radios = await fetchRadios();
                const saudiRadio = radios.find(r => r.name.includes('السعودية'));
                const label = saudiRadio?.name || 'إذاعة القرآن الكريم السعودية';
                const url = saudiRadio?.url || 'http://stream.radiojar.com/0tpy1h0kxtzuv';
                setStateFromSourceButton(state, member, 'Radio', { radioLabel: label, radioUrl: url });
                const vc = getVoiceChannel(member);
                if (vc) await streamRadio(vc, url, label);
                break;
            }
            case 'qr_btn_radio_sunnah': {
                const radios = await fetchRadios();
                const sunnahRadio = radios.find(r => r.name.includes('السنة'));
                const label = sunnahRadio?.name || 'راديو السنة النبوية';
                const url = sunnahRadio?.url || 'https://radiosunna.radioca.st/stream';
                setStateFromSourceButton(state, member, 'Radio', { radioLabel: label, radioUrl: url });
                const vc = getVoiceChannel(member);
                if (vc) await streamRadio(vc, url, label);
                break;
            }
            case 'qr_btn_audio_library':
                setStateFromSourceButton(state, member, 'AudioLibrary');
                stopAudio(guildId);
                break;
            case 'qr_btn_stop':
                setStateFromSourceButton(state, member, 'Idle');
                stopAudio(guildId);
                break;
            case 'qr_btn_toggle_pause': {
                const player = getActivePlayer(guildId);
                if (player) {
                    if (state.isPaused) {
                        player.unpause();
                        state.isPaused = false;
                    } else {
                        player.pause();
                        state.isPaused = true;
                    }
                }
                break;
            }
            case 'qr_btn_next':
                skipTrack(guildId);
                break;
            case 'qr_btn_prev':
                previousTrack(guildId);
                break;
            case 'qr_btn_toggle_24h': {
                if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.followUp({ content: '❌ فقط المشرفين يمكنهم تغيير وضع 24/24.', flags: 64 });
                }
                state.twentyFourSeven = !state.twentyFourSeven;
                if (state.voiceChannelId) {
                    await saveQuranRadioConfig(
                        guildId,
                        state.voiceChannelId,
                        state.textChannelId || state.voiceChannelId,
                        state.twentyFourSeven,
                        state.defaultSource || 'none',
                    );
                }
                if (!state.twentyFourSeven) {
                    const guild = interaction.guild;
                    if (guild) {
                        try {
                            const channel = guild.channels.cache.get(state.voiceChannelId ?? '');
                            if (channel?.isVoiceBased()) {
                                const nonBot = channel.members.filter((m: any) => !m.user.bot);
                                if (nonBot.size === 0) {
                                    stopAudio(guildId);
                                    state.mode = 'Idle';
                                }
                            }
                        } catch { /* ignore */ }
                    }
                }
                break;
            }
            case 'qr_btn_disconnect':
                state.mode = 'Idle';
                state.isPaused = false;
                state.reciterId = undefined;
                state.reciterName = undefined;
                state.radioLabel = undefined;
                state.radioUrl = undefined;
                state.controllerId = undefined;
                state.panelMessageId = undefined;
                stopAudio(guildId);
                break;
            case 'qr_btn_refresh':
                break;
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'qr_select_reciter') {
                const reciterId = interaction.values[0];
                const reciter = getReciterById(reciterId);
                if (reciter && reciter.surahs.length > 0) {
                    state.mode = 'Reciter';
                    state.reciterId = reciter.id;
                    state.reciterName = reciter.name;
                    state.surahTotal = reciter.surahs.length;
                    state.surahIndex = 0;
                    state.isPaused = false;
                    state.radioLabel = undefined;
                    state.radioUrl = undefined;

                    const urls = reciter.surahs.map(s => s.url);
                    const vc = getVoiceChannel(member);
                    if (vc) {
                        await streamSurahs(vc, urls);
                    }
                }
            }
        }

        await sendOrUpdatePanel(interaction.client, guildId, `👋 <@${interaction.user.id}>`);
    } catch (error) {
        logger.error('Radio interaction error:', error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '❌ حدث خطأ في الإذاعة.', flags: 64 });
            } else {
                await interaction.reply({ content: '❌ حدث خطأ في الإذاعة.', flags: 64 });
            }
        } catch (e) {
            logger.error('Failed to send radio error fallback:', e);
        }
    }
}
