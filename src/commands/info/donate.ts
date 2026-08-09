import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder,
} from 'discord.js';

const PAYPAL_URL = 'https://www.paypal.com/paypalme/youneselhafili';
const CIH_RIB = '230450524541421101740066';

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
                    'رفيق الروح بوت إسلامي مجاني بالكامل — آذان، أذكار، وقوائم تشغيل (Playlists) مجمعة لأشهر القراء لتشغيل القرآن الكريم بشكل عشوائي ومستمر.\n' +
                    'وجاري العمل حالياً على إضافة مجموعة جديدة ومميزة من كبار القراء قريباً بمشيئة الله.',
                inline: false,
            },
            {
                name: '🖥️  لماذا الدعم؟',
                value:
                    'تكاليف تشغيل الخادم تُدفع من جيب المطوّر كل شهر.\n' +
                    'تبرعك — ولو بالقليل — يساعد على إبقاء البوت يعمل ومستمراً في التطوير ودعم تكاليف الاستضافة. 🙏',
                inline: false,
            },
            {
                name: '🤍  طرق التبرع المتاحة',
                value: 
                    `💳 **عبر PayPal:**\nاضغط على الزر بالأسفل للانتقال لصفحة الدفع مباشرة.\n\n` +
                    `🏦 **عبر تحويل بنكي (CIH Bank):**\n` +
                    `• **الاسم:** يونس الحفيلي\n` +
                    `• **رقم الحساب (RIB):**\n\`${CIH_RIB}\``,
                inline: false,
            }
        )
        .setThumbnail(interaction.client.user?.displayAvatarURL() ?? null)
        .setFooter({
            text: 'رفيق الروح • المطوّر: يونس الحفيلي  •  جزاكم الله خيراً ❤️',
            iconURL: interaction.client.user?.displayAvatarURL(),
        })
        .setTimestamp();

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('تبرع عبر PayPal  💳')
            .setURL(PAYPAL_URL)
            .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
            .setLabel('نسخ رقم الحساب (RIB)  📋')
            .setCustomId('donate_copy_rib')
            .setStyle(ButtonStyle.Secondary)
    );

    // Send to channel
    await interaction.reply({ embeds: [embed], components: [buttons] });

    // Send to user's DM
    try {
        const dmEmbed = EmbedBuilder.from(embed)
            .setTitle('💝 رسالة خاصة: ادعم رفيق الروح')
            .setDescription('وصلتك هذه الرسالة الخاصة لأنك استخدمت أمر التبرع `/donate`. جزاك الله خيراً على نية الدعم!');
        
        await interaction.user.send({ embeds: [dmEmbed], components: [buttons] });
    } catch {
        // DM is blocked, ignore silently
    }
}

// Handler for the copy RIB button click
export async function handleButton(interaction: any) {
    if (interaction.customId === 'donate_copy_rib') {
        await interaction.reply({
            content: `إليك رقم الحساب البنكي (RIB) لنسخه بسهولة:\n\`\`\`\n${CIH_RIB}\n\`\`\``,
            ephemeral: true
        });
    }
}
