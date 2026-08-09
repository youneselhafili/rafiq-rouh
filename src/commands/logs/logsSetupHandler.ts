import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageComponentInteraction,
    ModalBuilder, ModalSubmitInteraction, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { activeLogsSetups, buildLogsPanel } from './setupLogs';
import { deleteAdvancedConfig } from '../../services/advancedConfigService';
import { saveLogsConfig, sendDirectAuditLog } from '../../services/auditLogService';

type LogsInteraction = MessageComponentInteraction | ModalSubmitInteraction;

export async function handleLogsSetupInteraction(interaction: LogsInteraction) {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ هذا الإجراء مخصص لمديري السيرفر.', flags: 64 });
        return;
    }
    const session = activeLogsSetups.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت الجلسة. استعمل `/setup_logs` من جديد.', flags: 64 });
        return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'logs_setup_channel_id_modal') {
        const channelId = interaction.fields.getTextInputValue('logs_channel_id').trim().replace(/[<#>]/g, '');
        if (!/^\d{17,20}$/.test(channelId)) {
            await interaction.reply({ content: '❌ معرّف القناة غير صالح. فعّل وضع المطوّر ثم انسخ معرّف القناة.', flags: 64 });
            return;
        }
        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.guildId !== interaction.guildId) {
            await interaction.reply({
                content: '❌ القناة غير موجودة داخل هذا السيرفر، أو البوت ماعندوش صلاحية **عرض القناة** فيها.',
                flags: 64,
            });
            return;
        }
        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
            await interaction.reply({ content: '❌ يجب أن يكون معرّف القناة خاصاً بقناة نصية أو قناة إعلانات.', flags: 64 });
            return;
        }
        session.channelId = channel.id;
        const me = interaction.guild?.members.me;
        const permissions = me ? channel.permissionsFor(me) : null;
        const missing: string[] = [];
        if (!permissions?.has(PermissionFlagsBits.ViewChannel)) missing.push('عرض القناة');
        if (!permissions?.has(PermissionFlagsBits.SendMessages)) missing.push('إرسال الرسائل');
        if (!permissions?.has(PermissionFlagsBits.EmbedLinks)) missing.push('إرسال الروابط المضمنة');
        if (!permissions?.has(PermissionFlagsBits.AttachFiles)) missing.push('إرفاق الملفات');
        await interaction.reply({
            content: missing.length
                ? `⚠️ تم اختيار <#${channel.id}>، ولكن خاص البوت هاد الصلاحيات فيها: **${missing.join(', ')}**.`
                : `✅ تم اختيار <#${channel.id}> بنجاح. اضغط **اختبار السجلات** ثم احفظ الإعدادات.`,
            flags: 64,
        });
        return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'logs_setup_channel') {
        session.channelId = interaction.values[0];
        await interaction.update(buildLogsPanel(session));
        return;
    }
    if (!interaction.isButton()) return;

    if (interaction.customId === 'logs_setup_cancel') {
        activeLogsSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }
    if (interaction.customId === 'logs_setup_toggle') {
        session.enabled = !session.enabled;
        await interaction.update(buildLogsPanel(session));
        return;
    }
    if (interaction.customId === 'logs_setup_dm') {
        session.dmAlerts = !session.dmAlerts;
        await interaction.update(buildLogsPanel(session));
        return;
    }
    if (interaction.customId === 'logs_setup_channel_id') {
        const modal = new ModalBuilder()
            .setCustomId('logs_setup_channel_id_modal')
            .setTitle('اختيار قناة السجلات بالمعرّف');
        const input = new TextInputBuilder()
            .setCustomId('logs_channel_id')
            .setLabel('معرّف القناة')
            .setPlaceholder('مثال: 123456789012345678')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(22)
            .setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }
    if (interaction.customId === 'logs_setup_test') {
        if (!session.channelId) {
            await interaction.reply({ content: '❌ اختر القناة أولاً.', flags: 64 });
            return;
        }
        await interaction.deferReply({ flags: 64 });
        const started = Date.now();
        const ok = await sendDirectAuditLog(interaction.client, session.channelId, {
            level: 'info', system: 'Test Log', action: 'Permission and delivery test', actorId: interaction.user.id,
            details: 'هذه رسالة تجريبية للتحقق من قناة السجلات. لا تُحتسب كحدث حقيقي.',
        });
        await interaction.editReply(ok ? `✅ نجح الاختبار خلال ${Date.now() - started} مللي ثانية.` : '❌ فشل الاختبار. تحقق من القناة والصلاحيات.');
        return;
    }
    if (interaction.customId === 'logs_setup_save') {
        if (session.enabled && !session.channelId) {
            await interaction.reply({ content: '❌ اختر قناة السجلات قبل التفعيل.', flags: 64 });
            return;
        }
        await interaction.deferUpdate();
        if (session.originalChannelId && session.originalChannelId !== session.channelId) {
            await sendDirectAuditLog(interaction.client, session.originalChannelId, {
                level: 'config', system: 'Logs', action: 'Logs channel changed', actorId: interaction.user.id,
                details: `تم نقل السجلات إلى ${session.channelId ? `<#${session.channelId}>` : 'قناة غير محددة'}.`,
            });
        }
        const { guildId, originalChannelId, ...configToSave } = session;
        await saveLogsConfig(guildId, configToSave);
        if (session.channelId) {
            await sendDirectAuditLog(interaction.client, session.channelId, {
                level: 'config', system: 'Logs', action: session.enabled ? 'Logs enabled/configured' : 'Logs disabled', actorId: interaction.user.id,
                details:
                    `📝 **قناة السجلات:** ${session.channelId ? `<#${session.channelId}>` : 'غير محددة'}\n` +
                    `📨 **تنبيهات الأخطاء في الخاص:** ${session.dmAlerts ? 'مفعّلة ✅' : 'غير مفعّلة ❌'}\n` +
                    `🔌 **حالة النظام:** ${session.enabled ? 'مفعّل ويستقبل الأحداث' : 'متوقف'}`,
            });
        }
        activeLogsSetups.delete(interaction.user.id);
        await interaction.editReply({ content: '✅ تم حفظ إعدادات السجلات.', embeds: [], components: [] });
        return;
    }
    if (interaction.customId === 'logs_setup_delete') {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('logs_setup_delete_confirm').setLabel('تأكيد الحذف').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('logs_setup_delete_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ content: '⚠️ هل تريد حذف إعدادات السجلات نهائياً؟', embeds: [], components: [row] });
        return;
    }
    if (interaction.customId === 'logs_setup_delete_cancel') {
        await interaction.update(buildLogsPanel(session));
        return;
    }
    if (interaction.customId === 'logs_setup_delete_confirm') {
        if (session.channelId) {
            await sendDirectAuditLog(interaction.client, session.channelId, {
                level: 'config', system: 'Logs', action: 'Logs settings deleted', actorId: interaction.user.id,
                details: 'تم حذف إعدادات السجلات بعد التأكيد.',
            });
        }
        await deleteAdvancedConfig(session.guildId, 'logsConfig');
        activeLogsSetups.delete(interaction.user.id);
        await interaction.update({ content: '✅ تم حذف إعدادات السجلات.', embeds: [], components: [] });
    }
}

