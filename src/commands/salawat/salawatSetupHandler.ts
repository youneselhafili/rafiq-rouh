import moment from 'moment-timezone';
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { activeSalawatSetups, buildSalawatSetupPayload } from './setupSalawat';
import {
    deleteSalawatV2Config, saveSalawatV2Config,
} from '../../services/salawatConfigServiceV2';
import {
    buildSalawatPreview, rescheduleSalawatGuild,
} from '../../services/salawatService';
import { sendAuditLog } from '../../services/auditLogService';

export async function handleSalawatSetupInteraction(interaction: any) {
    const session = activeSalawatSetups.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت جلسة الإعداد. استعمل `/setup_salawat` من جديد.', flags: 64 });
        return;
    }
    if (interaction.isModalSubmit?.() && interaction.customId === 'salawat_setup_channel_id_modal') {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim().replace(/[<#>]/g, '');
        if (!/^\d{17,22}$/.test(channelId)) {
            await interaction.reply({ content: '❌ معرّف القناة غير صالح.', flags: 64 });
            return;
        }
        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.guildId !== interaction.guildId || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
            await interaction.reply({ content: '❌ القناة غير موجودة أو ليست قناة نصية أو إعلانات صالحة.', flags: 64 });
            return;
        }
        session.channelId = channel.id;
        await interaction.update(buildSalawatSetupPayload(session));
        return;
    }
    if (interaction.isModalSubmit?.() && interaction.customId === 'salawat_setup_modal') {
        const timeInput = interaction.fields.getTextInputValue('salawat_fixed_times').trim();
        const timezoneInput = interaction.fields.getTextInputValue('salawat_timezone').trim();
        if (session.scheduleMode === 'fixed') {
            const matches: string[] = timeInput.match(/(?:[01]\d|2[0-3]):[0-5]\d/g) || [];
            session.fixedTimes = [...new Set<string>(matches)].sort();
            if (!session.fixedTimes.length) {
                await interaction.reply({ content: '❌ دخل وقتاً واحداً على الأقل بصيغة `HH:MM`، مثلاً `09:00, 18:30`.', flags: 64 });
                return;
            }
        }
        if (!session.usesPrimaryZone && timezoneInput) {
            if (!moment.tz.zone(timezoneInput)) {
                await interaction.reply({ content: '❌ المنطقة الزمنية غير صحيحة. مثال: `Africa/Casablanca`.', flags: 64 });
                return;
            }
            session.timezone = timezoneInput;
        }
        if (interaction.isFromMessage?.()) await interaction.update(buildSalawatSetupPayload(session));
        else await interaction.reply({ content: '✅ تم تحديث الجدولة مؤقتاً. اضغط حفظ لتطبيقها.', flags: 64 });
        return;
    }
    if (interaction.isChannelSelectMenu?.() && interaction.customId === 'salawat_setup_channel') {
        session.channelId = interaction.values[0];
        await interaction.update(buildSalawatSetupPayload(session));
        return;
    }
    if (interaction.isStringSelectMenu?.()) {
        if (interaction.customId === 'salawat_setup_mode') session.scheduleMode = interaction.values[0];
        if (interaction.customId === 'salawat_setup_interval') session.intervalHours = Number(interaction.values[0]) as typeof session.intervalHours;
        await interaction.update(buildSalawatSetupPayload(session));
        return;
    }
    if (!interaction.isButton?.()) return;
    const id = interaction.customId;
    if (id === 'salawat_setup_cancel') {
        activeSalawatSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }
    if (id === 'salawat_setup_channel_id') {
        const modal = new ModalBuilder().setCustomId('salawat_setup_channel_id_modal').setTitle('اختيار قناة الصلاة على النبي بالـID');
        const input = new TextInputBuilder().setCustomId('channel_id').setLabel('معرّف القناة').setPlaceholder('مثال: 123456789012345678').setRequired(true).setMinLength(17).setMaxLength(22).setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }
    if (id === 'salawat_setup_toggle') {
        session.enabled = !session.enabled;
        await interaction.update(buildSalawatSetupPayload(session));
        return;
    }
    if (id === 'salawat_setup_edit_schedule') {
        const modal = new ModalBuilder().setCustomId('salawat_setup_modal').setTitle('جدولة الصلاة على النبي');
        const times = new TextInputBuilder().setCustomId('salawat_fixed_times').setLabel('الأوقات الثابتة HH:MM (مفصولة بفاصلة)')
            .setStyle(TextInputStyle.Paragraph).setRequired(session.scheduleMode === 'fixed')
            .setValue(session.fixedTimes.join(', ').slice(0, 4000)).setPlaceholder('09:00, 13:30, 20:00');
        const timezone = new TextInputBuilder().setCustomId('salawat_timezone').setLabel(session.usesPrimaryZone ? 'المنطقة الزمنية من إعداد الأذان (للقراءة فقط)' : 'المنطقة الزمنية')
            .setStyle(TextInputStyle.Short).setRequired(!session.usesPrimaryZone).setValue(session.timezone).setPlaceholder('Africa/Casablanca');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(times), new ActionRowBuilder<TextInputBuilder>().addComponents(timezone));
        await interaction.showModal(modal);
        return;
    }
    if (id === 'salawat_setup_preview') {
        await interaction.deferReply({ flags: 64 });
        const preview = await buildSalawatPreview(session.guildId);
        await interaction.editReply({ content: `🖼️ **معاينة مخفية بدون @everyone وبدون استهلاك الدور:**\n${preview.text}`, files: [new AttachmentBuilder(preview.image, { name: 'salawat_preview.png' })] });
        return;
    }
    if (id === 'salawat_setup_delete') {
        session.deleteExpiresAt = Date.now() + 2 * 60 * 1000;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('salawat_setup_confirm_delete').setLabel('نعم، احذف').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('salawat_setup_cancel_delete').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: '⚠️ تأكيد حذف إعداد الصلاة على النبي؟ التأكيد صالح لدقيقتين.', components: [row], flags: 64 });
        return;
    }
    if (id === 'salawat_setup_cancel_delete') {
        session.deleteExpiresAt = undefined;
        await interaction.update({ content: 'تم إلغاء الحذف.', components: [] });
        return;
    }
    if (id === 'salawat_setup_confirm_delete') {
        if (!session.deleteExpiresAt || session.deleteExpiresAt < Date.now()) {
            await interaction.update({ content: '❌ انتهت مهلة التأكيد.', components: [] });
            return;
        }
        await interaction.deferUpdate();
        await deleteSalawatV2Config(session.guildId, interaction.user.id);
        await rescheduleSalawatGuild(interaction.client, session.guildId);
        await sendAuditLog(interaction.client, session.guildId, { level: 'info', system: 'Salawat', action: 'Salawat configuration deleted', actorId: interaction.user.id });
        activeSalawatSetups.delete(interaction.user.id);
        await interaction.editReply({ content: '✅ تم حذف الإعداد وإيقاف الجدولة.', components: [] });
        return;
    }
    if (id === 'salawat_setup_save') {
        if (!session.channelId) {
            await interaction.reply({ content: '❌ اختر قناة الإرسال أولاً.', flags: 64 });
            return;
        }
        if (session.scheduleMode === 'fixed' && !session.fixedTimes.length) {
            await interaction.reply({ content: '❌ اضغط **تعديل الأوقات** وأدخل وقتاً واحداً على الأقل.', flags: 64 });
            return;
        }
        await interaction.deferUpdate();
        const anchor = moment();
        let nextRun: moment.Moment;
        if (session.scheduleMode === 'interval') nextRun = anchor.clone().add(session.intervalHours, 'hours');
        else {
            const nowTz = moment().tz(session.timezone);
            const candidates = session.fixedTimes.flatMap(time => {
                const [hour, minute] = time.split(':').map(Number);
                return [0, 1].map(offset => nowTz.clone().add(offset, 'day').hour(hour).minute(minute).second(0).millisecond(0));
            }).filter(value => value.isAfter(nowTz)).sort((a, b) => a.valueOf() - b.valueOf());
            nextRun = candidates[0];
        }
        await saveSalawatV2Config(session.guildId, {
            enabled: session.enabled, channelId: session.channelId, scheduleMode: session.scheduleMode,
            intervalHours: session.intervalHours, fixedTimes: session.fixedTimes, timezone: session.timezone,
            anchorAt: anchor.toISOString(), nextRunAt: nextRun.toISOString(), updatedBy: interaction.user.id,
        });
        await rescheduleSalawatGuild(interaction.client, session.guildId);
        await sendAuditLog(interaction.client, session.guildId, {
            level: 'info', system: 'Salawat', action: 'Salawat settings saved', actorId: interaction.user.id,
            details: `${session.enabled ? 'مفعل' : 'متوقف'} — <#${session.channelId}> — ${session.scheduleMode === 'interval' ? `${session.intervalHours}h` : session.fixedTimes.join(', ')} — ${session.timezone}`,
        });
        activeSalawatSetups.delete(interaction.user.id);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ تم حفظ إعداد الصلاة على النبي')
                .setDescription(`**الحالة:** ${session.enabled ? '✅ مفعلة' : '⏸️ متوقفة'}\n**القناة:** <#${session.channelId}>\n**الجدولة:** ${session.scheduleMode === 'interval' ? `كل ${session.intervalHours} ساعة من لحظة الحفظ` : session.fixedTimes.join('، ')}\n**المنطقة الزمنية:** \`${session.timezone}\`\n**الموعد القادم:** <t:${Math.floor(nextRun.valueOf() / 1000)}:F>`)],
            components: [],
        });
    }
}


