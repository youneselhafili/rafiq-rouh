import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
    EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import { getAdhkarV2Config } from '../../services/adhkarConfigServiceV2';
import { getPrimaryAdhanZone } from '../../services/adhanZoneService';
import { getJumuahV2Config } from '../../services/jumuahConfigServiceV2';
import { getJumuahStats, JumuahStats, nextJumuahRun } from '../../services/jumuahService';
import { getAllReciters } from '../../quran/quranRegistry';

export interface JumuahSetupSession {
    guildId: string;
    enabled: boolean;
    channelId?: string;
    time: string;
    timezone: string;
    mentionEveryone: boolean;
    playKahfVoice: boolean;
    usesPrimaryZone: boolean;
    updatedBy?: string;
    stats: JumuahStats;
    deleteExpiresAt?: number;
}

export const activeJumuahSetups = new Map<string, JumuahSetupSession>();

export const data = new SlashCommandBuilder()
    .setName('setup_jumuah')
    .setDescription('إعداد تذكير الجمعة وتشغيل سورة الكهف')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    const existing = await getJumuahV2Config(interaction.guildId!);
    const adhkar = await getAdhkarV2Config(interaction.guildId!);
    const zone = await getPrimaryAdhanZone(interaction.guildId!);
    const session: JumuahSetupSession = {
        guildId: interaction.guildId!,
        enabled: existing?.deleted ? false : existing?.enabled ?? true,
        channelId: adhkar?.generalChannelId || existing?.channelId,
        time: existing?.time || '08:00',
        timezone: zone?.timezone || existing?.timezone || 'Africa/Casablanca',
        mentionEveryone: true,
        playKahfVoice: existing?.playKahfVoice ?? true,
        usesPrimaryZone: Boolean(zone?.timezone),
        updatedBy: existing?.updatedBy,
        stats: await getJumuahStats(interaction.guildId!),
    };
    activeJumuahSetups.set(interaction.user.id, session);
    await interaction.editReply(buildJumuahSetupPayload(session));
}

function discordTimestamp(value?: string) {
    if (!value) return 'لا يوجد';
    const unix = Math.floor(new Date(value).getTime() / 1000);
    return Number.isFinite(unix) ? `<t:${unix}:F> (<t:${unix}:R>)` : 'غير معروف';
}

export function buildJumuahSetupPayload(session: JumuahSetupSession) {
    const next = nextJumuahRun({
        enabled: session.enabled,
        channelId: session.channelId || '',
        time: session.time,
        timezone: session.timezone,
        mentionEveryone: true,
        playKahfVoice: session.playKahfVoice,
    });
    const reciterCount = getAllReciters().filter(reciter => reciter.surahs[17]?.url).length;
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('\u{1F31F} \u0625\u0639\u062f\u0627\u062f \u0646\u0638\u0627\u0645 \u064a\u0648\u0645 \u0627\u0644\u062c\u0645\u0639\u0629')
        .setDescription(
            '\u0643\u0644 \u062c\u0645\u0639\u0629 \u064a\u0631\u0633\u0644 \u0627\u0644\u0628\u0648\u062a \u0628\u0637\u0627\u0642\u0629 \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u0641\u064a **\u0646\u0641\u0633 \u0642\u0646\u0627\u0629 \u0627\u0644\u0623\u0630\u0643\u0627\u0631**. ' +
            '\u0641\u064a \u0627\u0644\u0642\u0646\u0627\u0629 \u0627\u0644\u0635\u0648\u062a\u064a\u0629 \u064a\u0628\u062f\u0623 \u0628\u0639\u062f \u0623\u0630\u0627\u0646 \u0627\u0644\u0641\u062c\u0631 \u0628\u062c\u0645\u064a\u0639 \u0627\u0644\u0642\u0631\u0627\u0621 \u0648\u064a\u0639\u064a\u062f \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u062a\u0644\u0642\u0627\u0626\u064a\u0627\u064b \u062d\u062a\u0649 \u0623\u0630\u0627\u0646 \u0627\u0644\u0638\u0647\u0631\u060c \u062b\u0645 \u064a\u0631\u062c\u0639 \u0644\u0644\u0625\u0630\u0627\u0639\u0629 \u0627\u0644\u0639\u0627\u062f\u064a\u0629.',
        )
        .addFields(
            { name: '\u0627\u0644\u062d\u0627\u0644\u0629', value: session.enabled ? '\u2705 \u0645\u0641\u0639\u0644' : '\u23F8\uFE0F \u0645\u062a\u0648\u0642\u0641', inline: true },
            { name: '\u0642\u0646\u0627\u0629 \u0627\u0644\u0623\u0630\u0643\u0627\u0631', value: session.channelId ? `<#${session.channelId}>` : '\u274C \u0625\u0639\u062f\u0627\u062f \u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u063a\u064a\u0631 \u0645\u0643\u062a\u0645\u0644', inline: true },
            { name: '\u0645\u0648\u0639\u062f \u0627\u0644\u0628\u0637\u0627\u0642\u0629', value: `\u0627\u0644\u062c\u0645\u0639\u0629 \`${session.time}\``, inline: true },
            { name: '\u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0632\u0645\u0646\u064a\u0629', value: `\`${session.timezone}\` ${session.usesPrimaryZone ? '(\u0645\u0646 \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0623\u0630\u0627\u0646 \u0627\u0644\u0645\u0631\u062c\u0639\u064a\u0629)' : ''}`, inline: false },
            { name: '\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u0635\u0648\u062a\u064a\u0627\u064b', value: session.playKahfVoice ? '\u2705 \u0645\u0646 \u0627\u0644\u0641\u062c\u0631 \u0625\u0644\u0649 \u0627\u0644\u0638\u0647\u0631' : '\u274C \u0645\u062a\u0648\u0642\u0641\u0629', inline: true },
            { name: '\u062f\u0648\u0631\u0629 \u0627\u0644\u0642\u0631\u0627\u0621', value: `**${reciterCount}** \u0642\u0631\u0627\u0621 \u0643\u0627\u0645\u0644\u064a\u0646 \u2022 Loop \u0628\u0644\u0627 \u062d\u062f`, inline: true },
            {
                name: '\u0627\u0644\u0625\u062d\u0635\u0627\u0626\u064a\u0627\u062a',
                value:
                    `\u0645\u0631\u0627\u062a \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0637\u0627\u0642\u0629: **${session.stats.totalSent}**\n` +
                    `\u0622\u062e\u0631 \u0625\u0631\u0633\u0627\u0644: ${discordTimestamp(session.stats.lastSentAt)}\n` +
                    `\u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0642\u0627\u062f\u0645: <t:${Math.floor(next.valueOf() / 1000)}:F>\n` +
                    `\u0622\u062e\u0631 \u062e\u0637\u0623: ${session.stats.lastError || '\u0644\u0627 \u064a\u0648\u062c\u062f'}`,
                inline: false,
            },
        )
        .setFooter({ text: `\u0622\u062e\u0631 \u062a\u0639\u062f\u064a\u0644: ${session.updatedBy ? `<@${session.updatedBy}>` : '\u063a\u064a\u0631 \u0645\u0633\u062c\u0644'} \u2022 \u0645\u0648\u0639\u062f \u0627\u0644\u0635\u0648\u062a \u0645\u0631\u0628\u0648\u0637 \u0628\u0627\u0644\u0641\u062c\u0631 \u0648\u0627\u0644\u0638\u0647\u0631` });

    const primary = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('jumuah_setup_time').setLabel('الوقت والمنطقة').setEmoji('🕐').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('jumuah_setup_preview').setLabel('معاينة البطاقة').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('jumuah_setup_toggle').setLabel(session.enabled ? 'توقيف' : 'تفعيل').setEmoji(session.enabled ? '⏸️' : '▶️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('jumuah_setup_save').setLabel('حفظ').setEmoji('💾').setStyle(ButtonStyle.Success),
    );
    const secondary = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('jumuah_setup_voice').setLabel(session.playKahfVoice ? 'إيقاف صوت الكهف' : 'تفعيل صوت الكهف').setEmoji('🎧').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('jumuah_setup_delete').setLabel('حذف الإعداد').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('jumuah_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [primary, secondary] };
}


