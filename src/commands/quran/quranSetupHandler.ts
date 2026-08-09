import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
} from 'discord.js';
import { activeQuranSetups, QuranSetupSession } from './setupQuran';
import { saveQuranSetupV2 } from '../../services/quranRadioServiceV2';
import { COLORS } from '../../utils/constants';
import { sendAuditLog } from '../../services/auditLogService';

export async function handleQuranSetupInteraction(interaction: any) {
    const session = activeQuranSetups.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت صلاحية جلسة الإعداد. استعمل `/setup_quran` من جديد.', flags: 64 });
        return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId === 'quran_setup_channel_select') {
        session.voiceChannelId = interaction.values[0];
        await interaction.update({ embeds: [buildEmbed(session)], components: buildRows(session) });
        return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'quran_setup_channel_id_modal') {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim().replace(/[<#>]/g, '');
        if (!/^\d{17,22}$/.test(channelId)) {
            await interaction.reply({ content: '❌ معرّف القناة غير صالح.', flags: 64 });
            return;
        }
        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.guildId !== interaction.guildId || channel.type !== ChannelType.GuildVoice) {
            await interaction.reply({ content: '❌ القناة غير موجودة أو ليست قناة صوتية.', flags: 64 });
            return;
        }
        session.voiceChannelId = channel.id;
        await interaction.update({ embeds: [buildEmbed(session)], components: buildRows(session) });
        return;
    }
    if (!interaction.isButton()) return;

    if (interaction.customId === 'quran_setup_cancel') {
        activeQuranSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ أي تغيير.', embeds: [], components: [] });
        return;
    }
    if (interaction.customId === 'quran_setup_channel_id') {
        const modal = new ModalBuilder().setCustomId('quran_setup_channel_id_modal').setTitle('اختيار قناة القرآن بالـID');
        const input = new TextInputBuilder().setCustomId('channel_id').setLabel('معرّف القناة').setPlaceholder('مثال: 123456789012345678').setRequired(true).setMinLength(17).setMaxLength(22).setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }
    if (!session.voiceChannelId) {
        await interaction.reply({ content: '❌ اختر القناة الصوتية أولاً.', flags: 64 });
        return;
    }
    if (interaction.customId === 'quran_setup_toggle_24h') {
        session.twentyFourSeven = !session.twentyFourSeven;
        await interaction.update({ embeds: [buildEmbed(session)], components: buildRows(session) });
        return;
    }
    if (interaction.customId !== 'quran_setup_save') return;

    await interaction.deferUpdate();
    await saveQuranSetupV2(interaction.client, session.guildId, session.voiceChannelId, session.twentyFourSeven);
    await sendAuditLog(interaction.client, session.guildId, {
        level: 'info', system: 'Quran', action: 'Quran settings saved', actorId: interaction.user.id,
        details: `القناة <#${session.voiceChannelId}> — 24/24: ${session.twentyFourSeven ? 'مفعل' : 'متوقف'}`,
    });
    activeQuranSetups.delete(interaction.user.id);
    const done = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('✅ تم حفظ إعدادات القرآن الكريم')
        .setDescription(
            `🔊 **القناة:** <#${session.voiceChannelId}>\n` +
            `💬 **لوحة التحكم:** داخل محادثة نفس القناة\n` +
            `🕐 **24/24:** ${session.twentyFourSeven ? '✅ مفعل — يبدأ بالحرم المكي' : '❌ متوقف'}\n\n` +
            'أول عضو يدخل القناة يحصل على التحكم، وعند خروجه ينتقل التحكم تلقائياً للعضو الذي بعده.'
        );
    await interaction.editReply({ embeds: [done], components: [] });
}

function buildEmbed(session: QuranSetupSession) {
    return new EmbedBuilder()
        .setColor(COLORS.QURAN)
        .setTitle('📻 إعداد نظام القرآن الكريم')
        .setDescription('راجع الإعدادات ثم اضغط **حفظ**. لا يوجد مصدر افتراضي يدوي؛ وضع 24/24 يبدأ دائماً بالحرم المكي.')
        .addFields(
            { name: '🔊 القناة الصوتية', value: session.voiceChannelId ? `<#${session.voiceChannelId}>` : 'لم يتم الاختيار', inline: true },
            { name: '🕐 وضع 24/24', value: session.twentyFourSeven ? '✅ مفعل' : '❌ متوقف', inline: true },
            { name: '💬 لوحة التحكم', value: session.voiceChannelId ? `محادثة <#${session.voiceChannelId}>` : 'تظهر بعد اختيار القناة', inline: false },
        )
        .setFooter({ text: 'التغييرات لا تطبق قبل الحفظ.' });
}

function buildRows(session: QuranSetupSession) {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('quran_setup_toggle_24h')
                .setLabel(session.twentyFourSeven ? '24/24: مفعل' : '24/24: متوقف')
                .setEmoji('🕐').setStyle(session.twentyFourSeven ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('quran_setup_channel_id').setLabel('إدخال معرّف القناة').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('quran_setup_save').setLabel('حفظ').setEmoji('💾').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('quran_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        ),
    ];
}
