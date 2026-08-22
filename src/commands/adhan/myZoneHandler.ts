import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    GuildMember,
    MessageComponentInteraction,
    PermissionFlagsBits,
} from 'discord.js';
import { fetchZonePrayerSchedule, getNextPrayerForZone, scheduleAdhanForGuild } from '../../services/adhanService';
import { deleteManagedAdhanZone, getManagedAdhanZones, setManagedAdhanZoneEnabled } from '../../services/adhanZoneService';
import { generateAdhanImage } from '../../services/canvasService';
import { getAdhanAudioConfig, testConfiguredAdhan } from '../../services/adhanAudioService';
import { sendAuditLog } from '../../services/auditLogService';
import { activeAdhanSetups, buildAdhanSetupPayload } from './setupAdhan';
import { activeZoneManagers, buildAdhanZonesPayload } from './myZone';

const deleteConfirmations = new Map<string, { guildId: string; index: number; expiresAt: number }>();

function selectedZone(interaction: MessageComponentInteraction) {
    const session = activeZoneManagers.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId || session.selected === undefined) return null;
    return session.zones[session.selected] || null;
}

export async function handleMyZoneInteraction(interaction: MessageComponentInteraction) {
    if (!interaction.customId.startsWith('myzone_') || !interaction.guildId) return;

    const session = activeZoneManagers.get(interaction.user.id);
    if ((!session || session.guildId !== interaction.guildId) && !['myzone_confirm_delete', 'myzone_cancel_delete'].includes(interaction.customId)) {
        await interaction.reply({ content: '❌ انتهت جلسة الإدارة. افتح `/adhan_zones` من جديد.', flags: 64 });
        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'myzone_select') {
        session!.selected = Number(interaction.values[0]);
        await interaction.update(await buildAdhanZonesPayload(interaction.client, interaction.guildId, interaction.user.id));
        return;
    }

    if (!interaction.isButton()) return;

    const id = interaction.customId;
    if (id === 'myzone_cancel_delete') {
        deleteConfirmations.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الحذف.', components: [], embeds: [] });
        return;
    }

    if (id === 'myzone_confirm_delete') {
        const confirmation = deleteConfirmations.get(interaction.user.id);
        if (!confirmation || confirmation.guildId !== interaction.guildId || confirmation.expiresAt < Date.now()) {
            await interaction.update({ content: '❌ انتهت مهلة التأكيد (دقيقتان).', components: [], embeds: [] });
            return;
        }

        const zones = await getManagedAdhanZones(interaction.guildId);
        const zone = zones[confirmation.index];
        deleteConfirmations.delete(interaction.user.id);
        if (!zone) {
            await interaction.update({ content: '❌ المنطقة لم تعد موجودة.', components: [], embeds: [] });
            return;
        }

        await interaction.deferUpdate();
        await deleteManagedAdhanZone(interaction.guildId, zone.country, zone.city);
        await scheduleAdhanForGuild(interaction.guildId, interaction.client);
        await sendAuditLog(interaction.client, interaction.guildId, {
            level: 'info',
            system: 'Adhan',
            action: 'Adhan zone deleted',
            actorId: interaction.user.id,
            details: `${zone.city}, ${zone.country}`,
        });
        const activeSession = activeZoneManagers.get(interaction.user.id);
        if (activeSession) activeSession.selected = undefined;
        await interaction.editReply({ content: `✅ تم حذف **${zone.city}**.`, components: [], embeds: [] });
        return;
    }

    const zone = selectedZone(interaction);
    if (!zone) {
        await interaction.reply({ content: '❌ اختر منطقة أولاً.', flags: 64 });
        return;
    }

    if (id === 'myzone_toggle') {
        await interaction.deferUpdate();
        await setManagedAdhanZoneEnabled(interaction.guildId, zone.country, zone.city, !zone.enabled, interaction.user.id);
        await scheduleAdhanForGuild(interaction.guildId, interaction.client);
        await sendAuditLog(interaction.client, interaction.guildId, {
            level: 'info',
            system: 'Adhan',
            action: zone.enabled ? 'Adhan zone paused' : 'Adhan zone enabled',
            actorId: interaction.user.id,
            details: `${zone.city}, ${zone.country}`,
        });
        await interaction.editReply(await buildAdhanZonesPayload(
            interaction.client,
            interaction.guildId,
            interaction.user.id,
            zone.enabled ? '⏸️ تم إيقاف المنطقة مؤقتاً.' : '▶️ تم تفعيل المنطقة.',
        ));
        return;
    }

    if (id === 'myzone_delete') {
        deleteConfirmations.set(interaction.user.id, {
            guildId: interaction.guildId,
            index: session!.selected!,
            expiresAt: Date.now() + 2 * 60 * 1000,
        });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('myzone_confirm_delete').setLabel('نعم، احذف').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('myzone_cancel_delete').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
            content: `⚠️ واش متأكد أردت تحذف **${zone.city}**؟ التأكيد صالح لمدة دقيقتين.`,
            components: [row],
            flags: 64,
        });
        return;
    }

    if (id === 'myzone_edit') {
        const audio = await getAdhanAudioConfig(interaction.guildId);
        activeAdhanSetups.set(interaction.user.id, {
            guildId: interaction.guildId,
            channelId: zone.channelId,
            country: zone.country,
            city: zone.city,
            zoneEnabled: zone.enabled,
            view: 'zone',
            audio,
        });
        await interaction.reply({ ...buildAdhanSetupPayload(activeAdhanSetups.get(interaction.user.id)!), flags: 64 });
        return;
    }

    if (id === 'myzone_test_audio') {
        await interaction.deferReply({ flags: 64 });
        const result = await testConfiguredAdhan(interaction.client, interaction.member as GuildMember);
        if (!result.played) {
            const reason = result.reason === 'admin_not_in_voice'
                ? 'ادخل لقناة صوتية أولاً.'
                : result.reason === 'missing_permissions'
                    ? 'البوت محتاج Connect وSpeak.'
                    : result.reason === 'adhan_in_progress'
                        ? 'كاين أذان خدام الآن؛ تسنّى حتى يسالي ثم عاود التجربة.'
                        : 'ملف الأذان غير موجود.';
            await interaction.editReply(`❌ ${reason}`);
            return;
        }
        await interaction.editReply(`✅ انتهى اختبار الصوت كاملاً: **${result.file?.replace(/\.mp3$/i, '')}**.`);
        return;
    }

    if (id === 'myzone_test_notification') {
        await interaction.deferReply({ flags: 64 });
        const schedule = await fetchZonePrayerSchedule(zone);
        const next = await getNextPrayerForZone(zone);
        if (!schedule) {
            await interaction.editReply('❌ تعذر جلب المواقيت الحقيقية لهذه المنطقة.');
            return;
        }

        const prayer = next?.prayer || 'Fajr';
        const time = next?.time || schedule.timings.Fajr;
        const verse = 'إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا';
        const image = await generateAdhanImage(schedule.city.name, schedule.city.countryAr, prayer, time, verse, 'النساء');
        const attachment = new AttachmentBuilder(image, { name: 'adhan_zone_test.png' });
        const textChannel = await interaction.client.channels.fetch(zone.channelId).catch(() => null);
        const permissions = textChannel && 'permissionsFor' in textChannel && interaction.guild?.members.me
            ? textChannel.permissionsFor(interaction.guild.members.me)
            : null;
        const required: Array<[string, bigint]> = [
            ['ViewChannel', PermissionFlagsBits.ViewChannel],
            ['SendMessages', PermissionFlagsBits.SendMessages],
            ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
            ['AttachFiles', PermissionFlagsBits.AttachFiles],
            ['MentionEveryone', PermissionFlagsBits.MentionEveryone],
        ];
        const audit = required.map(([name, flag]) => `${permissions?.has(flag) ? '✅' : '❌'} ${name}`).join('\n');
        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`🔔 اختبار بدون Mention — ${schedule.city.name}`)
            .setDescription(
                `**الموعد الحقيقي القادم:** ${next ? `${next.arabicName} في ${next.time} (بعد ${next.minutes} دقيقة)` : `فجر اليوم في ${time}`}\n` +
                `**القناة المحفوظة:** <#${zone.channelId}>\n\n` +
                `**فحص الصلاحيات:**\n${audit}`,
            )
            .setImage('attachment://adhan_zone_test.png');
        await interaction.editReply({ embeds: [embed], files: [attachment] });
        await sendAuditLog(interaction.client, interaction.guildId, {
            level: 'info',
            system: 'Adhan',
            action: 'Zone notification test',
            actorId: interaction.user.id,
            details: `${zone.city} — hidden preview without mention`,
        });
    }
}
