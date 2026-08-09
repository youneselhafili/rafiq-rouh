import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
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

const QURAN_PAGE_BASE_URL = 'https://raw.githubusercontent.com/QuranHub/quran-pages-images/main/kfgqpc/hafs-wasat';

const CHANNEL_SETUPS: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>> = {
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

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('مركز إعداد قنوات أنظمة البوت ومعاينة صفحات القرآن')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
        .setName('channel')
        .setDescription('فتح إعداد قناة أي نظام من مكان واحد')
        .addStringOption(option => option
            .setName('system')
            .setDescription('النظام الذي تريد إعداده')
            .setRequired(true)
            .addChoices(
                { name: 'الأذان', value: 'adhan' },
                { name: 'الأذكار', value: 'adhkar' },
                { name: 'الصلاة على النبي ﷺ', value: 'salawat' },
                { name: 'الجمعة وسورة الكهف', value: 'jumuah' },
                { name: 'الختمة اليومية', value: 'khatma' },
                { name: 'إذاعة القرآن الصوتية', value: 'quran' },
                { name: 'سجلات البوت', value: 'logs' },
                { name: 'رتب المنشن', value: 'roles' },
                { name: 'لوحة الرسائل الخاصة', value: 'dm' },
            )))
    .addSubcommand(subcommand => subcommand
        .setName('quran_preview')
        .setDescription('معاينة إرسال صورة صفحة من المصحف بدون تغيير الإعدادات')
        .addIntegerOption(option => option
            .setName('page')
            .setDescription('رقم الصفحة من 1 إلى 604 (عشوائي إذا تُرك فارغاً)')
            .setMinValue(1)
            .setMaxValue(604)
            .setRequired(false)));

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: '❌ هذا الأمر يعمل داخل السيرفر فقط.', flags: 64 });
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'channel') {
        const system = interaction.options.getString('system', true);
        const openSetup = CHANNEL_SETUPS[system];
        if (!openSetup) {
            await interaction.reply({ content: '❌ نظام الإعداد غير معروف.', flags: 64 });
            return;
        }
        await openSetup(interaction);
        return;
    }

    await interaction.deferReply({ flags: 64 });
    const page = interaction.options.getInteger('page') || Math.floor(Math.random() * 604) + 1;
    const filename = `quran_page_${page}.jpg`;
    const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('📖 معاينة صفحة من المصحف')
        .setDescription(`هذه معاينة خاصة للصفحة **${page} / 604** ولا تغيّر التقدم أو إعدادات الختمة.`)
        .setImage(`attachment://${filename}`)
        .setFooter({ text: 'إذا ظهرت الصفحة هنا فإرسال صور القرآن يعمل بشكل صحيح.' });
    await interaction.editReply({
        embeds: [embed],
        files: [new AttachmentBuilder(`${QURAN_PAGE_BASE_URL}/${page}.jpg`, { name: filename })],
    });
}
