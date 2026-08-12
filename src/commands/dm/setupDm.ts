import {
    ActionRowBuilder,
    ApplicationIntegrationType,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelSelectMenuInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    InteractionContextType,
    Message,
    SlashCommandBuilder,
} from 'discord.js';
import { getUserDMConfig, updateUserDMConfig } from '../../services/dmSubscriptionService';
import { DM_PANEL_FOOTER, renderPanelEmbed, UI_COLORS } from '../../utils/uiRenderer';
import { logger } from '../../utils/logger';
import { buildDMPanelPayload } from './dmPanelHandler';

export const data = new SlashCommandBuilder()
    .setName('setup_dm')
    .setDescription("إعداد لوحة الرسائل الخاصة للمستخدمين")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

function buildDMIntroPayload(includeChannelPicker: boolean, iconURL?: string) {
    const embed = renderPanelEmbed(
        "رفيق الروح • لوحة الرسائل الخاصة",
        "لوحة خاصة بكل عضو، تخليه يتحكم في التنبيهات التي تصله في الخاص بدون تغيير إعدادات السيرفر. يمكن نشر هذه اللوحة في قناة عامة، وكل عضو يضغط الزر يحصل على إعداداته الخاصة.",
        [
            { name: "ما الذي يستطيع العضو التحكم فيه؟", value: "📍 اختيار الدولة والمدينة من قوائم جاهزة\n🕌 تنبيهات الصلاة ومواقيت الأذان\n📿 الأذكار اليومية حسب الاختيار\n📖 تذكيرات القرآن وسورة الكهف\n🧹 حذف رسائل البوت من محادثته الخاصة", inline: false },
            { name: "طريقة الاستعمال", value: "1. اضغط **فتح الرسائل الخاصة**.\n2. افتح رسالة البوت الخاصة.\n3. اختر المدينة من القوائم الجاهزة.\n4. فعّل أو أوقف التنبيهات التي تريدها.\n5. أي تغيير يتم حفظه تلقائيا.", inline: false },
            { name: "ملاحظة مهمة", value: "إذا لم تصلك رسالة خاصة، فعّل الرسائل الخاصة من إعدادات الخصوصية لهذا السيرفر ثم اضغط الزر مرة أخرى.", inline: false },
        ],
        UI_COLORS.BRAND,
        iconURL,
        DM_PANEL_FOOTER,
    );

    const openRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_setup_open_dm')
            .setLabel("فتح الرسائل الخاصة")
            .setEmoji('\uD83D\uDCE9')
            .setStyle(ButtonStyle.Primary),
    );

    if (!includeChannelPicker) return { embeds: [embed], components: [openRow] };

    const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('dm_setup_publish_channel')
            .setPlaceholder("اختر القناة التي تريد نشر لوحة الرسائل الخاصة فيها")
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );

    return { embeds: [embed], components: [openRow, channelRow] };
}

function isDMPanelMessage(message: Message, botId?: string): boolean {
    return message.author.id === botId
        && message.components.some(row => 'components' in row
            && row.components.some(component => 'customId' in component
                && component.customId?.startsWith('dm_panel_')));
}

export async function sendDMPanel(interaction: ChatInputCommandInteraction | ButtonInteraction) {
    const config = await getUserDMConfig(interaction.user.id);
    const iconURL = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
    const panel = buildDMPanelPayload(config, 'home', iconURL);

    try {
        const channel = await interaction.user.createDM();
        const knownMessage = config.panel?.channelId === channel.id
            ? await channel.messages.fetch(config.panel.messageId).catch(() => null)
            : null;
        const candidates = new Map<string, Message>();
        if (knownMessage && isDMPanelMessage(knownMessage, interaction.client.user?.id)) {
            candidates.set(knownMessage.id, knownMessage);
        }

        const [pins, recent] = await Promise.all([
            channel.messages.fetchPins({ limit: 50 }).catch(() => null),
            channel.messages.fetch({ limit: 50 }).catch(() => null),
        ]);
        for (const item of pins?.items ?? []) {
            if (isDMPanelMessage(item.message, interaction.client.user?.id)) candidates.set(item.message.id, item.message);
        }
        for (const item of recent?.values() ?? []) {
            if (isDMPanelMessage(item, interaction.client.user?.id)) candidates.set(item.id, item);
        }

        let message = knownMessage && candidates.get(knownMessage.id)
            || [...candidates.values()].find(item => item.pinned)
            || [...candidates.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0]
            || null;

        if (message) await message.edit(panel);
        else message = await channel.send(panel);

        // Invariant: only one bot-owned DM panel may remain for this user.
        const duplicates = [...candidates.values()].filter(item => item.id !== message.id);
        await Promise.allSettled(duplicates.map(item => item.delete()));

        let pinned = message.pinned;
        if (!pinned) {
            try {
                await message.pin('لوحة إعدادات الرسائل الخاصة للمستخدم');
                pinned = true;
            } catch (error) {
                logger.warn(`Could not pin DM panel for user ${interaction.user.id}:`, error);
            }
        }

        await updateUserDMConfig(interaction.user.id, {
            panel: {
                channelId: channel.id,
                messageId: message.id,
                pinned,
                updatedAt: new Date().toISOString(),
            },
        });

        const content = pinned
            ? '✅ تم تحديث لوحة إعداداتك الخاصة وتثبيتها في أعلى المحادثة دون إنشاء نسخة مكررة.'
            : '✅ تم تحديث لوحة إعداداتك الخاصة دون إنشاء نسخة مكررة. تعذر تثبيتها تلقائيا، ويمكنك تثبيتها يدويا.';
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
        else await interaction.reply({ content, flags: 64 });
    } catch {
        const fallback = { content: "⚠️ لم أستطع إرسال رسالة خاصة لك. فعّل الرسائل الخاصة من هذا السيرفر، أو استعمل اللوحة هنا مؤقتا:", ...panel };
        if (interaction.deferred || interaction.replied) await interaction.editReply(fallback);
        else await interaction.reply({ ...fallback, flags: 64 });
    }
}

export async function execute(interaction: ChatInputCommandInteraction) {
    const iconURL = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });

    if (!interaction.inGuild()) {
        await interaction.deferReply();
        await sendDMPanel(interaction);
        return;
    }

    await interaction.reply({ ...buildDMIntroPayload(true, iconURL), flags: 64 });
}

export async function handleDMSetupInteraction(interaction: ButtonInteraction | ChannelSelectMenuInteraction) {
    if (interaction.isButton() && interaction.customId === 'dm_setup_open_dm') {
        await interaction.deferReply({ flags: 64 });
        await sendDMPanel(interaction);
        return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId === 'dm_setup_publish_channel') {
        await interaction.deferReply({ flags: 64 });
        const channelId = interaction.values[0];
        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);

        if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
            await interaction.editReply("❌ لم أستطع الوصول لهذه القناة. اختر قناة كتابية يستطيع البوت الإرسال فيها.");
            return;
        }

        const iconURL = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
        await channel.send(buildDMIntroPayload(false, iconURL));
        await interaction.editReply("✅ تم نشر لوحة الرسائل الخاصة في" + ' <#' + channelId + '> ' + ". أي عضو يضغط **فتح الرسائل الخاصة** سيحصل على لوحة إعداداته الخاصة.");
    }
}
