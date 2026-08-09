import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
} from 'discord.js';

const PAYPAL_URL = 'https://www.paypal.com/paypalme/youneselhafili';

export const data = new SlashCommandBuilder()
    .setName('donate')
    .setDescription('ادعم مطوّر رفيق الروح لتغطية تكاليف الخادم والخدمة');

export async function execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setColor(0xD8AA4D)
        .setTitle('💝  ادعم رفيق الروح')
        .setDescription(
            '> *﴿ وَمَا تُنفِقُوا مِنْ خَيْرٍ فَإِنَّ اللَّهَ بِهِ عَلِيمٌ ﴾*\n\u200b'
        )
        .addFields(
            {
                name: '🌙  عن البوت',
                value:
                    'رفيق الروح بوت إسلامي مجاني بالكامل — آذان، أذكار، قرآن كريم، إذاعات مباشرة من مكة والمدينة.\n' +
                    'تم تطويره بمحبة خالصة لخدمة المسلمين في كل مكان.',
                inline: false,
            },
            {
                name: '🖥️  لماذا الدعم؟',
                value:
                    'تكاليف تشغيل الخادم تُدفع من جيب المطوّر كل شهر.\n' +
                    'تبرعك — ولو بالقليل — يساعد على إبقاء البوت يعمل ومستمراً في التطوير. 🙏',
                inline: false,
            },
            {
                name: '🤍  كيف تتبرع؟',
                value: 'اضغط الزر أدناه وأدخل المبلغ الذي يناسبك — لا يوجد حد أدنى.',
                inline: false,
            }
        )
        .setThumbnail(interaction.client.user?.displayAvatarURL() ?? null)
        .setFooter({
            text: 'رفيق الروح • المطوّر: يونس الحفيلي  •  جزاكم الله خيراً ❤️',
            iconURL: interaction.client.user?.displayAvatarURL(),
        })
        .setTimestamp();

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('تبرع عبر PayPal  💳')
            .setURL(PAYPAL_URL)
            .setStyle(ButtonStyle.Link),
    );

    await interaction.reply({ embeds: [embed], components: [button] });
}
