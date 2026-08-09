import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('how_to_use')
    .setDescription("دليل استخدام رفيق الروح وإعداد خصائصه")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setColor(0xD8AA4D)
        .setTitle("🕌 دليل استخدام رفيق الروح")
        .setDescription("هذا الدليل يعطيك ترتيب الإعدادات الأساسية للسيرفر، ويشرح لوحة الرسائل الخاصة التي يستعملها كل عضو لإعداد تنبيهاته الشخصية.")
        .addFields(
            { name: "1️⃣ إعداد الآذان للسيرفر", value: "ابدأ بـ /setup_adhan لاختيار قناة الإرسال، الدولة، المدينة، والتنبيهات العامة. هذا الإعداد خاص بالسيرفر ويؤثر على رسائل الآذان العامة.", inline: false },
            { name: "2️⃣ إعداد لوحة الرسائل الخاصة للمستخدمين", value: "استعمل /setup_dm لعرض شرح لوحة الرسائل الخاصة، ثم اختر القناة التي تريد نشر اللوحة فيها. كل عضو يضغط **فتح الرسائل الخاصة** يحصل على لوحة خاصة به، ويختار المدينة والتنبيهات التي يريدها بنفسه.", inline: false },
            { name: "3️⃣ ما الذي يتحكم فيه العضو داخل الرسائل الخاصة؟", value: "• اختيار الدولة والمدينة من قوائم جاهزة\n• تفعيل أو إيقاف تنبيهات الصلاة\n• اختيار الأذكار التي يريد استقبالها\n• إعداد تذكيرات القرآن وسورة الكهف\n• حذف رسائل البوت من محادثته الخاصة", inline: false },
            { name: "4️⃣ إعداد باقي ميزات السيرفر", value: "بعد الآذان يمكنك إعداد باقي الخصائص:\n• /setup_adhkar للأذكار العامة\n• /setup_salawat للصلاة على النبي ﷺ\n• /setup_jumuah لتذكيرات الجمعة وسورة الكهف\n• /setup_quran لراديو القرآن الكريم", inline: false },
            { name: "⚙️ أوامر مفيدة", value: "• /setup_roles لإدارة رسائل وأدوار التفاعل\n• /setup_logs لاختيار قناة السجلات\n• /adhan_zones لاستعراض مناطق الآذان\n• /test لاختبار الإعدادات بدون إزعاج الأعضاء", inline: false },
        )
        .setFooter({ text: "هذه الأوامر الإدارية تظهر للمشرفين فقط، أما لوحة الرسائل الخاصة فهي لكل عضو بشكل شخصي." })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
}
