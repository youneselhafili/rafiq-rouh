import {
    ChannelType,
    Guild,
    GuildBasedChannel,
    NewsChannel,
    PermissionFlagsBits,
    TextChannel,
} from 'discord.js';
import { buildHowToUseEmbeds } from '../commands/info/howToUse';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { logger } from '../utils/logger';

const CONFIG_KEY = 'onboardingConfig';

interface OnboardingConfig {
    howToUseSentAt?: string;
    channelId?: string;
}

type OnboardingChannel = TextChannel | NewsChannel;

function canSendGuide(guild: Guild, channel: GuildBasedChannel | null | undefined): channel is OnboardingChannel {
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        return false;
    }

    const botMember = guild.members.me;
    if (!botMember || !channel.isTextBased() || typeof (channel as any).send !== 'function') return false;

    return channel.permissionsFor(botMember).has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ]);
}

function normalizedChannelName(channel: GuildBasedChannel): string {
    return 'name' in channel ? channel.name.trim().toLocaleLowerCase() : '';
}

export function findOnboardingChannel(guild: Guild): OnboardingChannel | null {
    const textChannels = guild.channels.cache
        .filter(channel => canSendGuide(guild, channel))
        .sort((a, b) => a.rawPosition - b.rawPosition);

    const preferredNames = new Set([
        'general',
        'general-chat',
        'chat-general',
        'عام',
        'العامة',
        'الدردشة-العامة',
    ]);
    const general = textChannels.find(channel => preferredNames.has(normalizedChannelName(channel)));
    if (general) return general;
    if (canSendGuide(guild, guild.systemChannel)) return guild.systemChannel;
    return textChannels.first() || null;
}

export async function sendFirstJoinGuide(guild: Guild): Promise<boolean> {
    const existing = await getAdvancedConfig<OnboardingConfig>(guild.id, CONFIG_KEY);
    if (existing?.howToUseSentAt) {
        logger.info(`[Onboarding] Usage guide was already sent in guild ${guild.id}.`);
        return false;
    }

    await guild.channels.fetch().catch(error => {
        logger.warn(`[Onboarding] Could not refresh channels for guild ${guild.id}: ${String(error)}`);
    });

    const channel = findOnboardingChannel(guild);
    if (!channel) {
        logger.warn(`[Onboarding] No text channel with send/embed permissions in guild ${guild.id}.`);
        return false;
    }

    const message = await channel.send({
        content: 'السلام عليكم ورحمة الله وبركاته 👋\nشكراً لإضافة **رفيق الروح**. هذا دليل النسخة الحالية، ويمكن للمشرفين البدء من `/setup_channels`.',
        embeds: buildHowToUseEmbeds(),
    });

    await setAdvancedConfig<OnboardingConfig>(guild.id, CONFIG_KEY, {
        howToUseSentAt: new Date().toISOString(),
        channelId: channel.id,
    });

    logger.success(`[Onboarding] Usage guide sent once in guild ${guild.id}, channel ${channel.id}, message ${message.id}.`);
    return true;
}
