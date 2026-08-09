import { Events, VoiceState } from 'discord.js';
import { handleUserJoinRadioV2, handleUserLeaveRadioV2 } from '../services/quranRadioServiceV2';
import { canSendToVoiceChannel, getOrCreateSession } from '../services/quranSessionManager';
import { logger } from '../utils/logger';

export const name = Events.VoiceStateUpdate;

export async function execute(oldState: VoiceState, newState: VoiceState) {
    try {
        const member = newState.member ?? await newState.guild?.members.fetch(newState.id).catch(() => null);
        if (!member || member.user.bot) return;

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        // User joined a voice channel
        if (!oldChannelId && newChannelId) {
            const channel = newState.channel ?? await newState.guild?.channels.fetch(newChannelId).catch(() => null);
            if (channel?.isVoiceBased()) {
                const guildId = newState.guild?.id;
                if (!guildId) return;
                const session = getOrCreateSession(guildId);
                if (!canSendToVoiceChannel(channel)) {
                    logger.warn(`[Quran] Bot cannot send messages in voice channel ${channel.id} (guild: ${guildId})`);
                }
                session.voiceChannelId = channel.id;
                await handleUserJoinRadioV2(newState.client, member, channel);
            }
        }
        // User switched voice channels
        else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
            const oldChannel = oldState.channel ?? await oldState.guild?.channels.fetch(oldChannelId).catch(() => null);
            const newChannel = newState.channel ?? await newState.guild?.channels.fetch(newChannelId).catch(() => null);
            if (oldChannel?.isVoiceBased() && newChannel?.isVoiceBased()) {
                const oldMember = oldState.member ?? await oldState.guild?.members.fetch(oldState.id).catch(() => null);
                if (oldMember) {
                    await handleUserLeaveRadioV2(oldState.client, oldMember, oldChannel);
                }
                const guildId = newState.guild?.id;
                if (!guildId) return;
                const session = getOrCreateSession(guildId);
                if (!canSendToVoiceChannel(newChannel)) {
                    logger.warn(`[Quran] Bot cannot send messages in voice channel ${newChannel.id} (guild: ${guildId})`);
                }
                session.voiceChannelId = newChannel.id;
                await handleUserJoinRadioV2(newState.client, member, newChannel);
            }
        }
        // User left a voice channel
        else if (oldChannelId && !newChannelId) {
            const channel = oldState.channel ?? await oldState.guild?.channels.fetch(oldChannelId).catch(() => null);
            const oldMember = oldState.member ?? await oldState.guild?.members.fetch(oldState.id).catch(() => null);
            if (channel?.isVoiceBased() && oldMember) {
                await handleUserLeaveRadioV2(oldState.client, oldMember, channel);
            }
        }
    } catch (error) {
        logger.error(`Error in voiceStateUpdate handler (guild: ${newState.guild?.id}):`, error);
    }
}


