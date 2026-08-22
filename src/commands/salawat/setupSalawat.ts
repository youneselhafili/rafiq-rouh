import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
    ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import { getPrimaryAdhanZone } from '../../services/adhanZoneService';
import { getSalawatV2Config, SalawatScheduleMode } from '../../services/salawatConfigServiceV2';
import { getSalawatStats, SalawatStats } from '../../services/salawatService';

export interface SalawatSetupSession {
    guildId: string;
    enabled: boolean;
    channelId?: string;
    scheduleMode: SalawatScheduleMode;
    intervalHours: 1 | 4 | 8 | 12 | 24;
    fixedTimes: string[];
    timezone: string;
    usesPrimaryZone: boolean;
    updatedBy?: string;
    stats: SalawatStats;
    deleteExpiresAt?: number;
}

export const activeSalawatSetups = new Map<string, SalawatSetupSession>();

export const data = new SlashCommandBuilder()
    .setName('setup_salawat')
    .setDescription('إعداد التذكير بالصلاة على النبي ﷺ')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    const existing = await getSalawatV2Config(interaction.guildId!);
    const zone = await getPrimaryAdhanZone(interaction.guildId!);
    const session: SalawatSetupSession = {
        guildId: interaction.guildId!, enabled: existing?.enabled ?? true,
        channelId: existing?.channelId, scheduleMode: existing?.scheduleMode || 'interval',
        intervalHours: existing?.intervalHours || 4, fixedTimes: existing?.fixedTimes || [],
        timezone: zone?.timezone || existing?.timezone || 'Africa/Casablanca',
        usesPrimaryZone: Boolean(zone), updatedBy: existing?.updatedBy,
        stats: await getSalawatStats(interaction.guildId!),
    };
    activeSalawatSetups.set(interaction.user.id, session);
    await interaction.editReply(buildSalawatSetupPayload(session));
}

function timestamp(value?: string) {
    if (!value) return 'لا يوجد';
    const unix = Math.floor(new Date(value).getTime() / 1000);
    return Number.isFinite(unix) ? `<t:${unix}:F> (<t:${unix}:R>)` : 'غير معروف';
}

export function buildSalawatSetupPayload(session: SalawatSetupSession) {
    const schedule = session.scheduleMode === 'interval'
        ? `كل ${session.intervalHours === 1 ? 'ساعة' : `${session.intervalHours} ساعات`} ابتداءً من لحظة الحفظ`
        : session.fixedTimes.length ? session.fixedTimes.map(time => `\`${time}\``).join('، ') : 'لم يتم تحديد أوقات ثابتة';
    const embed = new EmbedBuilder().setColor(UI_COLORS.BRAND).setTitle('ﷺ إعداد الصلاة على النبي')
        .setDescription('الصيغ تُقرأ من `data/raw/salawat.txt` وتدور عشوائياً بدون تكرار حتى تنتهي اللائحة. لا يتم تطبيق أي تغيير قبل الحفظ.')
        .addFields(
            { name: 'الحالة', value: session.enabled ? '✅ مفعلة' : '⏸️ متوقفة', inline: true },
            { name: 'القناة', value: session.channelId ? `<#${session.channelId}>` : 'لم يتم الاختيار', inline: true },
            { name: 'الجدولة', value: schedule, inline: false },
            { name: 'المنطقة الزمنية', value: `\`${session.timezone}\` ${session.usesPrimaryZone ? '(من منطقة الأذان المرجعية)' : '(يدوية)'}`, inline: false },
            { name: 'الإحصائيات المحفوظة', value: `الصيغ: **${session.stats.formulaCount}** | مرات الإرسال: **${session.stats.sentCount}**\nآخر إرسال: ${timestamp(session.stats.lastSentAt)}\nالإرسال القادم: ${timestamp(session.stats.nextRunAt)}\nآخر تعديل: ${session.updatedBy ? `<@${session.updatedBy}>` : 'غير مسجل'}`, inline: false },
        )
        .setFooter({ text: 'يمكنك معاينة صورة مخفية بدون استهلاك دور الصيغة.' });
    const channel = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId('salawat_setup_channel').setPlaceholder('اختر قناة الإرسال').addChannelTypes(ChannelType.GuildText),
    );
    const mode = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('salawat_setup_mode').setPlaceholder('اختر نوع الجدولة').addOptions(
            { label: 'تكرار بالساعات', value: 'interval', description: '1 / 4 / 8 / 12 / 24 ساعة من لحظة الحفظ', default: session.scheduleMode === 'interval' },
            { label: 'أوقات ثابتة', value: 'fixed', description: 'وقت واحد أو عدة أوقات كل يوم', default: session.scheduleMode === 'fixed' },
        ),
    );
    const interval = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('salawat_setup_interval').setPlaceholder(session.scheduleMode === 'interval' ? 'اختر معدل التكرار' : 'الأوقات الثابتة تُعدّل من الزر أسفل')
            .setDisabled(session.scheduleMode !== 'interval').addOptions(
                ...[1, 4, 8, 12, 24].map(value => ({ label: value === 1 ? 'كل ساعة' : `كل ${value} ساعات`, value: String(value), default: session.intervalHours === value })),
            ),
    );
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('salawat_setup_edit_schedule').setLabel(session.scheduleMode === 'fixed' ? 'تعديل الأوقات' : session.usesPrimaryZone ? 'عرض/تعديل الجدولة' : 'الأوقات والمنطقة الزمنية').setEmoji('🕐').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('salawat_setup_preview').setLabel('معاينة').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('salawat_setup_toggle').setLabel(session.enabled ? 'توقيف' : 'تفعيل').setEmoji(session.enabled ? '⏸️' : '▶️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('salawat_setup_save').setLabel('حفظ').setEmoji('💾').setStyle(ButtonStyle.Success),
    );
    const secondary = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('salawat_setup_channel_id').setLabel('إدخال معرّف القناة').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('salawat_setup_delete').setLabel('حذف الإعداد').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('salawat_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [channel, mode, interval, actions, secondary] };
}
