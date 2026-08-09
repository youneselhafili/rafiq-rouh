import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { getAdhanAudioConfig } from '../../services/adhanAudioService';
import { getNextPrayerForZone } from '../../services/adhanService';
import { getManagedAdhanZones, ManagedAdhanZone } from '../../services/adhanZoneService';
import { modeLabel } from './setupAdhan';

interface ZoneManagerSession {
    guildId: string;
    zones: ManagedAdhanZone[];
    selected?: number;
}

export const activeZoneManagers = new Map<string, ZoneManagerSession>();

export const data = new SlashCommandBuilder()
    .setName('adhan_zones')
    .setDescription('عرض وإدارة مناطق الأذان والصوت')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(await buildAdhanZonesPayload(interaction.client, interaction.guildId!, interaction.user.id));
}

export async function buildAdhanZonesPayload(client: Client, guildId: string, userId: string, notice?: string) {
    const zones = await getManagedAdhanZones(guildId);
    const existing = activeZoneManagers.get(userId);
    const session: ZoneManagerSession = {
        guildId,
        zones,
        selected: existing?.guildId === guildId ? existing.selected : undefined,
    };
    if (session.selected !== undefined && !zones[session.selected]) session.selected = undefined;
    activeZoneManagers.set(userId, session);

    const audio = await getAdhanAudioConfig(guildId);
    const nextResults = await Promise.all(
        zones.map(zone => zone.enabled ? getNextPrayerForZone(zone).catch(() => null) : Promise.resolve(null)),
    );

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🕌 مناطق الأذان')
        .setDescription(
            `${notice ? `${notice}\n\n` : ''}` +
            `**النظام العام:** ${modeLabel(audio.mode)}\n` +
            `**الصوت:** ${audio.audioChoice === 'random' ? 'عشوائي' : audio.audioChoice.replace(/\.mp3$/i, '')}`,
        )
        .setFooter({ text: 'اختر منطقة من القائمة لإدارتها.' });

    if (!zones.length) {
        embed.addFields({ name: 'لا توجد مناطق', value: 'استعمل `/setup_adhan` لإضافة أول منطقة.' });
        return { embeds: [embed], components: [] };
    }

    zones.slice(0, 20).forEach((zone, index) => {
        const next = nextResults[index];
        embed.addFields({
            name: `${index + 1}. ${zone.city} — ${zone.country}`,
            value:
                `${zone.enabled ? '✅ مفعلة' : '⏸️ متوقفة'} | <#${zone.channelId}> | \`${zone.timezone}\`\n` +
                (next
                    ? `القادم: **${next.arabicName}** في \`${next.time}\` (بعد ${next.minutes} دقيقة)`
                    : 'لا توجد صلاة قادمة اليوم أو تعذر جلب التوقيت.'),
        });
    });

    if (zones.length > 20) {
        embed.addFields({ name: 'مناطق إضافية', value: `يوجد ${zones.length - 20} منطقة أخرى محفوظة.` });
    }

    const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('myzone_select')
            .setPlaceholder('اختر المنطقة')
            .addOptions(zones.slice(0, 25).map((zone, index) => ({
                label: `${zone.city} — ${zone.country}`.slice(0, 100),
                value: String(index),
                emoji: zone.enabled ? '✅' : '⏸️',
                default: session.selected === index,
            }))),
    );

    const disabled = session.selected === undefined;
    const selected = session.selected === undefined ? undefined : zones[session.selected];
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('myzone_toggle').setLabel(selected?.enabled ? 'إيقاف مؤقت' : 'تفعيل').setEmoji(selected?.enabled ? '⏸️' : '▶️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('myzone_edit').setLabel('تعديل').setEmoji('✏️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('myzone_test_notification').setLabel('اختبار الإشعار').setEmoji('🔔').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('myzone_test_audio').setLabel('اختبار الصوت').setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('myzone_delete').setLabel('حذف').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );

    return { embeds: [embed], components: [select, actions] };
}



