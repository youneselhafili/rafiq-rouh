import { ActionRowBuilder, AttachmentBuilder, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { activeAdhkarSetups, buildAdhkarSetupPayload } from './setupAdhkar';
import { buildAdhkarPreview, rescheduleAdhkarGuild } from '../../services/adhkarService';
import { saveAdhkarV2Config } from '../../services/adhkarConfigServiceV2';
import { sendAuditLog } from '../../services/auditLogService';

export async function handleAdhkarSetupInteraction(interaction: any) {
    const session = activeAdhkarSetups.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت جلسة الإعداد. استعمل `/setup_adhkar` من جديد.', flags: 64 });
        return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'adhkar_setup_channel') {
        session.generalChannelId = interaction.values[0];
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'adhkar_setup_channel_id_modal') {
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
        session.generalChannelId = channel.id;
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'adhkar_setup_zone') session.primaryZoneIndex = Number(interaction.values[0]);
        if (interaction.customId === 'adhkar_setup_type_select') session.selectedTypes = interaction.values;
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (!interaction.isButton()) return;
    const id = interaction.customId;
    if (id === 'adhkar_setup_cancel') {
        activeAdhkarSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }
    if (id === 'adhkar_setup_channel_id') {
        const modal = new ModalBuilder().setCustomId('adhkar_setup_channel_id_modal').setTitle('اختيار قناة الأذكار العامة بالـID');
        const input = new TextInputBuilder().setCustomId('channel_id').setLabel('\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0642\u0646\u0627\u0629').setPlaceholder('مثال: 123456789012345678').setRequired(true).setMinLength(17).setMaxLength(22).setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }
    if (id === 'adhkar_setup_categories') {
        session.view = 'categories';
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (id === 'adhkar_setup_back') {
        session.view = 'main';
        session.selectedTypes = [];
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (id === 'adhkar_setup_page_prev' || id === 'adhkar_setup_page_next') {
        session.categoryPage += id.endsWith('next') ? 1 : -1;
        session.selectedTypes = [];
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (id === 'adhkar_setup_master_toggle') {
        session.enabled = !session.enabled;
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (['adhkar_setup_type_enable', 'adhkar_setup_type_pause', 'adhkar_setup_type_delete'].includes(id)) {
        if (!session.selectedTypes.length) {
            await interaction.reply({ content: '❌ حدد نوعاً واحداً على الأقل.', flags: 64 });
            return;
        }
        for (const type of session.selectedTypes) {
            if (id === 'adhkar_setup_type_delete') delete session.categories[type];
            else session.categories[type] = id === 'adhkar_setup_type_enable' ? 'enabled' : 'paused';
        }
        await interaction.update(buildAdhkarSetupPayload(session));
        return;
    }
    if (id === 'adhkar_setup_preview') {
        const type = session.selectedTypes[0];
        if (!type) {
            await interaction.reply({ content: '❌ حدد النوع الذي تريد معاينته.', flags: 64 });
            return;
        }
        await interaction.deferReply({ flags: 64 });
        const preview = await buildAdhkarPreview(session.guildId, type);
        if (!preview) {
            await interaction.editReply('❌ لا يوجد محتوى صالح لهذا النوع.');
            return;
        }
        const files = preview.buffers.map((buffer, index) => new AttachmentBuilder(buffer, { name: `preview_${index + 1}.png` }));
        await interaction.editReply({
            content: `🖼️ **معاينة مخفية: ${preview.title}**\nلم يتم إرسال @everyone ولم يتم استهلاك دور هذا الذكر.`,
            files: files.slice(0, 10),
        });
        return;
    }
    if (id === 'adhkar_setup_save') {
        const zone = session.zones[session.primaryZoneIndex];
        if (!zone || !session.generalChannelId) {
            session.view = 'main';
            await interaction.update(buildAdhkarSetupPayload(session));
            await interaction.followUp({ content: '❌ اختر المنطقة المرجعية والقناة العامة قبل الحفظ.', flags: 64 });
            return;
        }
        await interaction.deferUpdate();
        await saveAdhkarV2Config(session.guildId, {
            enabled: session.enabled,
            generalChannelId: session.generalChannelId,
            primaryZoneCountry: zone.country,
            primaryZoneCity: zone.city,
            categories: session.categories,
            updatedBy: interaction.user.id,
        });
        await rescheduleAdhkarGuild(interaction.client, session.guildId);
        await sendAuditLog(interaction.client, session.guildId, {
            level: 'info', system: 'Adhkar', action: 'Adhkar settings saved', actorId: interaction.user.id,
            details: `${session.enabled ? 'مفعل' : 'متوقف'} — ${zone.city} — <#${session.generalChannelId}> — ${Object.values(session.categories).filter(value => value === 'enabled').length} نوع مفعل`,
        });
        activeAdhkarSetups.delete(interaction.user.id);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ تم حفظ نظام الأذكار')
                .setDescription(`**المنطقة المرجعية:** ${zone.city} — ${zone.country}\n**القناة العامة:** <#${session.generalChannelId}>\n**الحالة:** ${session.enabled ? '✅ مفعلة' : '⏸️ متوقفة'}\n**الأنواع المفعلة:** ${Object.values(session.categories).filter(value => value === 'enabled').length}\n\nلم يتم إرسال أي شيء فور الحفظ؛ سيعمل النظام في مواعيده المحددة.`)],
            components: [],
        });
    }
}
