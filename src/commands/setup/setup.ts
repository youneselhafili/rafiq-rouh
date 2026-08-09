import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    ActionRowBuilder,
} from 'discord.js';
import { execute as setupAdhan } from '../adhan/setupAdhan';
import { execute as setupAdhkar } from '../adhkar/setupAdhkar';
import { execute as setupSalawat } from '../salawat/setupSalawat';
import { execute as setupJumuah } from '../jumuah/setupJumuah';
import { execute as setupKhatma } from '../khatma/setupKhatma';
import { execute as setupQuran } from '../quran/setupQuran';
import { execute as setupLogs } from '../logs/setupLogs';
import { execute as setupRoles } from '../roles/setupRoles';
import { execute as setupDm } from '../dm/setupDm';
import { UI_COLORS } from '../../utils/uiRenderer';

const CHANNEL_SETUPS: Record<string, (interaction: any) => Promise<void>> = {
    adhan: setupAdhan,
    adhkar: setupAdhkar,
    salawat: setupSalawat,
    jumuah: setupJumuah,
    khatma: setupKhatma,
    quran: setupQuran,
    logs: setupLogs,
    roles: setupRoles,
    dm: setupDm,
};

const SYSTEM_OPTIONS = [
    { label: 'الأذان', value: 'adhan', emoji: '🕌', description: 'القنوات والمناطق والصوت والإشعارات' },
    { label: 'الأذكار', value: 'adhkar', emoji: '📿', description: 'قنوات الأذكار وجدولتها' },
    { label: 'الصلاة على النبي ﷺ', value: 'salawat', emoji: '🌿', description: 'قناة وجدولة رسائل الصلاة على النبي' },
    { label: 'الجمعة وسورة الكهف', value: 'jumuah', emoji: '🌟', description: 'رسائل الجمعة وتشغيل سورة الكهف' },
    { label: 'الختمة اليومية', value: 'khatma', emoji: '📖', description: 'قناة وصفحات الختمة اليومية' },
    { label: 'إذاعة القرآن الصوتية', value: 'quran', emoji: '📻', description: 'القناة الصوتية ووضع 24/24' },
    { label: 'سجلات البوت', value: 'logs', emoji: '📋', description: 'قناة سجلات الأحداث والإعدادات' },
    { label: 'رتب المنشن', value: 'roles', emoji: '🏷️', description: 'رتب إشعارات أنظمة البوت' },
    { label: 'لوحة الرسائل الخاصة', value: 'dm', emoji: '✉️', description: 'نشر لوحة إعدادات الرسائل الخاصة' },
];

function buildSetupChannelsPanel() {
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('⚙️ مركز إعداد قنوات البوت')
        .setDescription(
            'اختَر النظام من القائمة أسفله لفتح لوحة إعداده الخاصة.\n\n' +
            'كل تغيير يبقى مؤقتًا حتى تضغط **حفظ** داخل لوحة النظام.',
        )
        .addFields(
            { name: '🕌 العبادات والتذكير', value: 'الأذان • الأذكار • الصلاة على النبي ﷺ • الجمعة • الختمة', inline: false },
            { name: '📻 الصوت والإدارة', value: 'إذاعة القرآن • السجلات • الرتب • الرسائل الخاصة', inline: false },
        )
        .setFooter({ text: 'لوحة خاصة بك — اختَر نظامًا للمتابعة' });

    const menu = new StringSelectMenuBuilder()
        .setCustomId('setup_channels_select')
        .setPlaceholder('اختَر النظام الذي تريد إعداده')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(SYSTEM_OPTIONS);

    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

export const data = new SlashCommandBuilder()
    .setName('setup_channels')
    .setDescription('فتح لوحة إعداد قنوات وأنظمة البوت')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: '❌ هذا الأمر يعمل داخل السيرفر فقط.', flags: 64 });
        return;
    }
    await interaction.reply({ ...buildSetupChannelsPanel(), flags: 64 });
}

export async function handleSetupChannelsInteraction(interaction: any) {
    if (!interaction.isStringSelectMenu?.() || interaction.customId !== 'setup_channels_select') return;
    if (!interaction.inGuild?.() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ تحتاج صلاحية إدارة السيرفر لاستعمال هذه اللوحة.', flags: 64 });
        return;
    }
    const openSetup = CHANNEL_SETUPS[interaction.values[0]];
    if (!openSetup) {
        await interaction.reply({ content: '❌ نظام الإعداد غير معروف.', flags: 64 });
        return;
    }
    await openSetup(interaction);
}
