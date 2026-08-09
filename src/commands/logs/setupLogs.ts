import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
    ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import { getLogsConfig, LogsConfig } from '../../services/auditLogService';

export interface LogsSetupSession extends LogsConfig {
    guildId: string;
    originalChannelId?: string;
}

export const activeLogsSetups = new Map<string, LogsSetupSession>();

export const data = new SlashCommandBuilder()
    .setName('setup_logs')
    .setDescription('إعداد قناة سجلات البوت والتنبيهات الحرجة')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export function buildLogsPanel(session: LogsSetupSession) {
    const embed = new EmbedBuilder()
        .setColor(session.enabled ? UI_COLORS.SUCCESS : UI_COLORS.MUTED)
        .setTitle('📋 إعداد سجلات رفيق الروح')
        .setDescription('جميع أنظمة البوت تسجل أحداثها في القناة المختارة. تنبيهات الأخطاء في الرسائل الخاصة موقوفة افتراضياً.')
        .addFields(
            { name: 'القناة', value: session.channelId ? `<#${session.channelId}>` : 'لم يتم الاختيار', inline: true },
            { name: 'السجلات', value: session.enabled ? '✅ مفعلة' : '⏸️ موقوفة', inline: true },
            { name: 'تنبيهات الأخطاء في الخاص', value: session.dmAlerts ? '✅ مفعلة' : '⏸️ موقوفة', inline: true },
            { name: 'عدد الأحداث', value: String(session.eventCount || 0), inline: true },
            { name: 'آخر سجل', value: session.lastLogAt ? `<t:${Math.floor(new Date(session.lastLogAt).getTime() / 1000)}:R>` : 'لا يوجد', inline: true },
            { name: 'الذاكرة المؤقتة', value: `${session.buffer.length}/1000`, inline: true },
        );

    const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('logs_setup_channel')
            .setPlaceholder('اختر قناة نصية أو إعلانات')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('logs_setup_toggle').setLabel(session.enabled ? 'إيقاف السجلات' : 'تفعيل السجلات').setStyle(session.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('logs_setup_dm').setLabel(session.dmAlerts ? 'تنبيهات الخاص: مفعلة' : 'تنبيهات الخاص: متوقفة').setStyle(session.dmAlerts ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('logs_setup_test').setLabel('اختبار السجلات').setEmoji('🧪').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('logs_setup_channel_id').setLabel('إدخال معرّف القناة').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
    );
    const saveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('logs_setup_save').setLabel('حفظ الإعدادات').setEmoji('💾').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('logs_setup_delete').setLabel('حذف الإعدادات').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('logs_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [channelRow, controls, saveRow] };
}

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ هذا الأمر مخصص لمالك السيرفر والمشرفين بصلاحية مدير.', flags: 64 });
        return;
    }
    await interaction.deferReply({ flags: 64 });
    const config = await getLogsConfig(interaction.guildId);
    const session: LogsSetupSession = { guildId: interaction.guildId, originalChannelId: config.channelId, ...config };
    activeLogsSetups.set(interaction.user.id, session);
    await interaction.editReply(buildLogsPanel(session));
}


