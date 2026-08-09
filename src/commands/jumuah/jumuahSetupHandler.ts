import moment from 'moment-timezone';
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { activeJumuahSetups, buildJumuahSetupPayload } from './setupJumuah';
import {
    disableAndDeleteJumuahV2Config, saveJumuahV2Config,
} from '../../services/jumuahConfigServiceV2';
import {
    buildJumuahPreview, nextJumuahRun, refreshJumuahGuild,
} from '../../services/jumuahService';
import { getAdhkarV2Config } from '../../services/adhkarConfigServiceV2';
import { sendAuditLog } from '../../services/auditLogService';

export async function handleJumuahSetupInteraction(interaction: any) {
    const session = activeJumuahSetups.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت جلسة الإعداد. استعمل `/setup_jumuah` من جديد.', flags: 64 });
        return;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === 'jumuah_setup_time_modal') {
        const time = interaction.fields.getTextInputValue('jumuah_time').trim();
        const timezone = interaction.fields.getTextInputValue('jumuah_timezone').trim();
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            await interaction.reply({ content: '❌ الوقت خاصو يكون بصيغة `HH:MM`، مثلاً `08:00`.', flags: 64 });
            return;
        }
        if (!session.usesPrimaryZone) {
            if (!moment.tz.zone(timezone)) {
                await interaction.reply({ content: '❌ المنطقة الزمنية غير صحيحة. مثال: `Africa/Casablanca`.', flags: 64 });
                return;
            }
            session.timezone = timezone;
        }
        session.time = time;
        if (interaction.isFromMessage?.()) await interaction.update(buildJumuahSetupPayload(session));
        else await interaction.reply({ content: '✅ تم تحديث الموعد مؤقتاً. اضغط **حفظ** لتطبيقه.', flags: 64 });
        return;
    }

    if (!interaction.isButton?.()) return;
    const id = interaction.customId;
    if (id === 'jumuah_setup_cancel') {
        activeJumuahSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }
    if (id === 'jumuah_setup_toggle') {
        session.enabled = !session.enabled;
        await interaction.update(buildJumuahSetupPayload(session));
        return;
    }
    if (id === 'jumuah_setup_voice') {
        session.playKahfVoice = !session.playKahfVoice;
        await interaction.update(buildJumuahSetupPayload(session));
        return;
    }
    if (id === 'jumuah_setup_time') {
        const modal = new ModalBuilder().setCustomId('jumuah_setup_time_modal').setTitle('موعد نظام الجمعة');
        const time = new TextInputBuilder()
            .setCustomId('jumuah_time')
            .setLabel('وقت الجمعة بصيغة HH:MM')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(session.time)
            .setPlaceholder('08:00');
        const timezone = new TextInputBuilder()
            .setCustomId('jumuah_timezone')
            .setLabel(session.usesPrimaryZone ? 'المنطقة الزمنية من إعداد الأذان (للقراءة فقط)' : 'المنطقة الزمنية')
            .setStyle(TextInputStyle.Short)
            .setRequired(!session.usesPrimaryZone)
            .setValue(session.timezone)
            .setPlaceholder('Africa/Casablanca');
        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(time),
            new ActionRowBuilder<TextInputBuilder>().addComponents(timezone),
        );
        await interaction.showModal(modal);
        return;
    }
    if (id === 'jumuah_setup_preview') {
        await interaction.deferReply({ flags: 64 });
        const preview = await buildJumuahPreview(session.guildId);
        await interaction.editReply({
            content:
                `🖼️ **معاينة مخفية — ما كتستهلكش دور القارئ وما كتديرش @everyone:**\n` +
                `🎙️ القارئ في المعاينة: **${preview.reciterName}**`,
            files: [new AttachmentBuilder(preview.image, { name: 'jumuah-kahf-preview.png' })],
        });
        return;
    }
    if (id === 'jumuah_setup_delete') {
        session.deleteExpiresAt = Date.now() + 2 * 60 * 1000;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('jumuah_setup_confirm_delete').setLabel('نعم، احذف').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('jumuah_setup_cancel_delete').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: '⚠️ واش متأكد بغيتي تحذف إعداد الجمعة وتوقفه؟ التأكيد صالح لدقيقتين.', components: [row], flags: 64 });
        return;
    }
    if (id === 'jumuah_setup_cancel_delete') {
        session.deleteExpiresAt = undefined;
        await interaction.update({ content: 'تم إلغاء الحذف.', components: [] });
        return;
    }
    if (id === 'jumuah_setup_confirm_delete') {
        if (!session.deleteExpiresAt || session.deleteExpiresAt < Date.now()) {
            await interaction.update({ content: '❌ انتهت مهلة التأكيد.', components: [] });
            return;
        }
        await interaction.deferUpdate();
        await disableAndDeleteJumuahV2Config(session.guildId, interaction.user.id);
        await sendAuditLog(interaction.client, session.guildId, {
            level: 'config', system: 'Jumuah', action: 'Jumuah configuration deleted', actorId: interaction.user.id,
        });
        activeJumuahSetups.delete(interaction.user.id);
        await interaction.editReply({ content: '✅ تم حذف إعداد الجمعة وإيقاف جدولتِه.', components: [] });
        return;
    }
    if (id === 'jumuah_setup_save') {
        const adhkar = await getAdhkarV2Config(session.guildId);
        session.channelId = adhkar?.generalChannelId;
        if (!session.channelId) {
            await interaction.reply({
                content: '❌ خاصك تكمل إعداد `/setup_adhkar` وتختار القناة العامة أولاً؛ نظام الجمعة مرتبط بنفس القناة.',
                flags: 64,
            });
            return;
        }
        await interaction.deferUpdate();
        const config = {
            enabled: session.enabled,
            channelId: session.channelId,
            time: session.time,
            timezone: session.timezone,
            mentionEveryone: true,
            playKahfVoice: session.playKahfVoice,
            updatedBy: interaction.user.id,
        };
        await saveJumuahV2Config(session.guildId, config);
        await refreshJumuahGuild(session.guildId);
        const next = nextJumuahRun(config);
        await sendAuditLog(interaction.client, session.guildId, {
            level: 'config',
            system: 'Jumuah',
            action: 'Jumuah settings saved',
            actorId: interaction.user.id,
            details:
                `${session.enabled ? 'مفعل' : 'متوقف'} — الجمعة ${session.time} — ${session.timezone} — ` +
                `<#${session.channelId}> — صوت الكهف: ${session.playKahfVoice ? 'نعم' : 'لا'}`,
        });
        activeJumuahSetups.delete(interaction.user.id);
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('✅ تم حفظ نظام يوم الجمعة')
                    .setDescription(
                        `**القناة:** <#${session.channelId}> (نفس قناة الأذكار)\n` +
                        `**الموعد:** الجمعة \`${session.time}\` — \`${session.timezone}\`\n` +
                        `**الحالة:** ${session.enabled ? '✅ مفعّل' : '⏸️ متوقف'}\n` +
                        `**صوت سورة الكهف:** ${session.playKahfVoice ? '✅' : '❌'}\n` +
                        `**الإرسال القادم:** <t:${Math.floor(next.valueOf() / 1000)}:F>`,
                    ),
            ],
            components: [],
        });
    }
}


