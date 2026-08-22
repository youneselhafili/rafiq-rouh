import {
    ActionRowBuilder,
    ButtonInteraction,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { activeRolesSetups, buildSetupPanel } from './setupRoles';
import { setRolesConfig } from '../../services/rolesConfigService';

const EDIT_BUTTON_MAP: Record<string, { field: string; label: string; emoji: string }> = {
    roles_setup_edit_adhkar: { field: 'adhkarRoleId', label: 'رتبة الأذكار', emoji: '📿' },
    roles_setup_edit_salawat: { field: 'salawatRoleId', label: 'رتبة الصلوات', emoji: '🌿' },
    roles_setup_edit_jumuah: { field: 'jumuahRoleId', label: 'رتبة الجمعة', emoji: '🌟' },
    roles_setup_edit_adhan: { field: 'adhanRoleId', label: 'رتبة الآذان', emoji: '🕌' },
    roles_setup_edit_khatma: { field: 'khatmaRoleId', label: 'رتبة الختمة', emoji: '📖' },
};

export async function handleRolesSetupInteraction(interaction: ButtonInteraction) {
    const session = activeRolesSetups.get(interaction.user.id);

    if (!session) {
        await interaction.reply({ content: '⚠️ انتهت صلاحية الجلسة. يرجى إعادة كتابة الأمر `/setup_roles`.', flags: 64 });
        return;
    }

    const { customId } = interaction;

    if (EDIT_BUTTON_MAP[customId]) {
        const { field, label, emoji } = EDIT_BUTTON_MAP[customId];
        const currentId = (session.config as any)[field] as string | undefined;

        const modal = new ModalBuilder()
            .setCustomId(`roles_setup_modal_${field}`)
            .setTitle(`${emoji} تعديل ${label}`);

        const input = new TextInputBuilder()
            .setCustomId('role_id_input')
            .setLabel(`أدخل Role ID لـ${label}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('مثال: 1301861097694953541')
            .setRequired(false);

        if (currentId) input.setValue(currentId);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }

    if (customId === 'roles_setup_save') {
        await setRolesConfig(session.guildId, session.config);
        activeRolesSetups.delete(interaction.user.id);
        await interaction.update({
            content: '✅ **تم حفظ إعدادات الرتب بنجاح!**',
            embeds: [],
            components: [],
        });
        return;
    }

    if (customId === 'roles_setup_cancel') {
        activeRolesSetups.delete(interaction.user.id);
        await interaction.update({ content: '❌ تم إلغاء الإعداد.', embeds: [], components: [] });
    }
}

export async function handleRolesSetupModal(interaction: ModalSubmitInteraction) {
    const session = activeRolesSetups.get(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: '⚠️ انتهت الجلسة.', flags: 64 });
        return;
    }

    const field = interaction.customId.replace('roles_setup_modal_', '') as keyof typeof session.config;
    const value = interaction.fields.getTextInputValue('role_id_input').trim();

    if (value && !/^\d{17,20}$/.test(value)) {
        await interaction.reply({ content: '❌ معرف الرتبة (Role ID) يجب أن يكون رقماً من 17-20 خانة. تأكد من نسخه بشكل صحيح.', flags: 64 });
        return;
    }

    (session.config as any)[field] = value || undefined;
    await interaction.deferUpdate();
    await interaction.message?.edit(buildSetupPanel(session.config)).catch(() => {});
}
