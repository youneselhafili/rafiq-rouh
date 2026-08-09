import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { KhatmaMode } from '../../types';
import { UI_COLORS } from '../../utils/uiRenderer';
import { calculatePagesPerDay, getGuildKhatma } from '../../services/khatmaService';
import { getUserDMConfig } from '../../services/dmSubscriptionService';

export const MODE_LABELS: Record<KhatmaMode, string> = {
    custom: 'عدد صفحات مخصص',
    week: 'ختمة في أسبوع',
    month: 'ختمة في شهر',
    '3_months': 'ختمة في 3 أشهر',
    '6_months': 'ختمة في 6 أشهر',
    ramadan: 'ختمة رمضانية',
};

export interface KhatmaSetupSession {
    scope: 'guild' | 'dm';
    ownerId: string;
    guildId?: string;
    channelId?: string;
    enabled: boolean;
    mode: KhatmaMode;
    pagesPerDay: number;
    ramadanKhatmas: number;
    currentPage: number;
    updatedAt?: string;
    deleteExpiresAt?: number;
}

export const activeKhatmaSetups = new Map<string, KhatmaSetupSession>();

export const data = new SlashCommandBuilder()
    .setName('nakhtim')
    .setDescription('إعداد ختمة القرآن الكريم اليومية')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    if (!interaction.inGuild()) {
        const config = await getUserDMConfig(interaction.user.id);
        const khatma = config.khatma;
        const session: KhatmaSetupSession = {
            scope: 'dm',
            ownerId: interaction.user.id,
            enabled: khatma?.enabled ?? false,
            mode: khatma?.mode ?? 'month',
            pagesPerDay: khatma?.pagesPerDay || calculatePagesPerDay(khatma?.mode ?? 'month'),
            ramadanKhatmas: khatma?.ramadanKhatmas ?? 1,
            currentPage: khatma?.currentPage ?? 1,
            updatedAt: khatma?.updatedAt,
        };
        activeKhatmaSetups.set(interaction.user.id, session);
        await interaction.editReply(buildKhatmaSetupPayload(session));
        return;
    }

    const guildId = interaction.guildId!;
    const state = await getGuildKhatma(guildId);
    const session: KhatmaSetupSession = {
        scope: 'guild',
        ownerId: interaction.user.id,
        guildId,
        channelId: state?.channelId,
        enabled: state?.isActive ?? false,
        mode: state?.mode ?? 'month',
        pagesPerDay: state?.pagesPerDay || calculatePagesPerDay(state?.mode ?? 'month'),
        ramadanKhatmas: state?.ramadanKhatmas ?? 1,
        currentPage: state?.currentPage ?? 1,
        updatedAt: state?.updatedAt,
    };
    activeKhatmaSetups.set(interaction.user.id, session);
    await interaction.editReply(buildKhatmaSetupPayload(session));
}

export function buildKhatmaSetupPayload(session: KhatmaSetupSession) {
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('📖 إعداد ختمة القرآن الكريم')
        .setDescription(session.scope === 'dm'
            ? 'يُرسل لك البوت صفحات المصحف يوميا في رسائلك الخاصة حسب الوضع الذي تختاره.'
            : 'يُرسل البوت صفحات المصحف يوميا في القناة المختارة حسب الوضع الذي تختاره.')
        .addFields(
            { name: 'الحالة', value: session.enabled ? '✅ مفعّل' : '⏸️ متوقف', inline: true },
            { name: 'الوضع', value: MODE_LABELS[session.mode], inline: true },
            { name: 'الصفحات في اليوم', value: `${session.pagesPerDay}`, inline: true },
            ...(session.mode === 'ramadan' ? [{ name: 'عدد الختمات', value: `${session.ramadanKhatmas}`, inline: true }] : []),
            { name: 'التقدم', value: `${Math.min(session.currentPage, 604)} / 604`, inline: true },
            ...(session.scope === 'guild' ? [{ name: 'القناة', value: session.channelId ? `<#${session.channelId}>` : '❌ لم يتم اختيار قناة', inline: false }] : []),
        )
        .setFooter({ text: 'تقبل الله منا ومنكم صالح الأعمال • تُرسل الختمة يوميا الساعة 08:00 بتوقيت مكة' });

    const modeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('khatma_setup_mode')
            .setPlaceholder('اختر وضع الختمة')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions((Object.keys(MODE_LABELS) as KhatmaMode[]).map(mode => ({
                label: MODE_LABELS[mode],
                value: mode,
                default: mode === session.mode,
            }))),
    );

    const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('khatma_setup_custom_pages')
            .setLabel('عدد الصفحات / اليوم')
            .setEmoji('🔢')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(session.mode !== 'custom'),
        new ButtonBuilder()
            .setCustomId('khatma_setup_ramadan')
            .setLabel('عدد الختمات الرمضانية')
            .setEmoji('🌙')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(session.mode !== 'ramadan'),
        new ButtonBuilder()
            .setCustomId('khatma_setup_toggle')
            .setLabel(session.enabled ? 'توقيف' : 'تفعيل')
            .setEmoji(session.enabled ? '⏸️' : '▶️')
            .setStyle(ButtonStyle.Secondary),
    );

    if (session.scope === 'guild') {
        firstRow.addComponents(
            new ButtonBuilder()
                .setCustomId('khatma_setup_channel_id')
                .setLabel('إدخال معرّف القناة')
                .setEmoji('🔢')
                .setStyle(ButtonStyle.Secondary),
        );
    }

    const components: any[] = [modeRow, firstRow];

    if (session.scope === 'guild') {
        const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('khatma_setup_channel')
                .setPlaceholder('اختر القناة التي تُرسل فيها صفحات الختمة')
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        );
        components.splice(1, 0, channelRow);
    }

    const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('khatma_setup_save')
            .setLabel('حفظ')
            .setEmoji('💾')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('khatma_setup_delete')
            .setLabel('حذف الإعداد')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('khatma_setup_cancel')
            .setLabel('إلغاء')
            .setStyle(ButtonStyle.Secondary),
    );
    components.push(secondRow);

    return { embeds: [embed], components };
}
