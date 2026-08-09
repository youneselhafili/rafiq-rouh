import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
    EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import { getRolesConfig, RolesConfig } from '../../services/rolesConfigService';

export const activeRolesSetups = new Map<string, { guildId: string; config: RolesConfig }>();

export const data = new SlashCommandBuilder()
    .setName('setup_roles')
    .setDescription('إعداد الرتب المخصصة للمنشنات')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const guildId = interaction.guildId!;
    const existingConfig = await getRolesConfig(guildId);

    activeRolesSetups.set(interaction.user.id, { guildId, config: { ...existingConfig } });

    await interaction.editReply(buildSetupPanel(existingConfig));
}

export function buildSetupPanel(config: RolesConfig) {
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('⚙️ إعدادات الرتب والمنشنات')
        .setDescription(
            'اضغط على زر كل ميزة لتعديل الـ Role ID الخاص بها.\n' +
            'يمكنك لصق أي Role ID مباشرة في خانة الإدخال.\n\n' +
            '> للحصول على معرّف الرتبة: افتح **إعدادات السيرفر ثم الرتب**، واضغط بزر الفأرة الأيمن على الرتبة واختر **نسخ معرّف الرتبة**'
        )
        .addFields(
            { name: '📿 الأذكار', value: config.adhkarRoleId ? `<@&${config.adhkarRoleId}>\n\`${config.adhkarRoleId}\`` : '`غير محدد`', inline: true },
            { name: '🌿 الصلوات', value: config.salawatRoleId ? `<@&${config.salawatRoleId}>\n\`${config.salawatRoleId}\`` : '`غير محدد`', inline: true },
            { name: '🌟 الجمعة', value: config.jumuahRoleId ? `<@&${config.jumuahRoleId}>\n\`${config.jumuahRoleId}\`` : '`غير محدد`', inline: true },
            { name: '🕌 الآذان', value: config.adhanRoleId ? `<@&${config.adhanRoleId}>\n\`${config.adhanRoleId}\`` : '`غير محدد`', inline: true },
        )
        .setFooter({ text: 'هذه الإعدادات تلغي المنشن الافتراضي (@everyone)' });

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('roles_setup_edit_adhkar').setLabel('تعديل رتبة الأذكار').setStyle(ButtonStyle.Secondary).setEmoji('📿'),
        new ButtonBuilder().setCustomId('roles_setup_edit_salawat').setLabel('تعديل رتبة الصلوات').setStyle(ButtonStyle.Secondary).setEmoji('🌿'),
        new ButtonBuilder().setCustomId('roles_setup_edit_jumuah').setLabel('تعديل رتبة الجمعة').setStyle(ButtonStyle.Secondary).setEmoji('🌟'),
        new ButtonBuilder().setCustomId('roles_setup_edit_adhan').setLabel('تعديل رتبة الآذان').setStyle(ButtonStyle.Secondary).setEmoji('🕌'),
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('roles_setup_save').setLabel('حفظ الإعدادات').setStyle(ButtonStyle.Success).setEmoji('💾'),
        new ButtonBuilder().setCustomId('roles_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
    );

    return { embeds: [embed], components: [row1, row2], content: '' };
}

