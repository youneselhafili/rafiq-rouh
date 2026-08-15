import {
    ApplicationIntegrationType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionContextType,
    SlashCommandBuilder,
} from 'discord.js';
import { buildCatalogSummary } from '../../services/botInfoService';

const BRAND_COLOR = 0xD8AA4D;

export const data = new SlashCommandBuilder()
    .setName('how_to_use')
    .setDescription('دليل كامل لجميع أوامر رفيق الروح وطريقة استعمالها')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

export function buildHowToUseEmbeds() {
    const overview = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('📖 دليل استعمال رفيق الروح')
        .setDescription(
            'رفيق الروح بوت إسلامي مجاني للقرآن والأذان والأذكار والختمات وتنبيهات الجمعة والرسائل الخاصة. هذا الدليل يشرح جميع أوامر النسخة الحالية من A إلى Z.'
        )
        .addFields(
            {
                name: '📊 مكتبة القرآن الكريم',
                value: `${buildCatalogSummary()}\nتشغيل عشوائي مستمر 24/24، أو اختيار القارئ والسورة وطريقة التشغيل.`,
            },
            {
                name: '👤 أوامر متاحة للجميع',
                value: '`/donate` • `/how_to_use` • `/setup_dm`\nيمكن لكل عضو فتح لوحة الخاص وإعداد تنبيهاته الشخصية بدون تغيير إعدادات السيرفر.',
            },
            {
                name: '🛡️ أوامر الإدارة',
                value: 'الأوامر التي تحمل علامة **إدارة السيرفر** تحتاج صلاحية Manage Server. أمر `/setup_logs` يحتاج Administrator.',
            },
            {
                name: '🚀 ترتيب إعداد مقترح',
                value: '1. `/setup_channels`\n2. `/setup_adhan` ثم `/adhan_zones`\n3. `/setup_quran` وباقي أنظمة النشر\n4. `/setup_dm` لنشر لوحة الأعضاء\n5. `/test` للتأكد من سلامة الإعدادات',
            },
        );

    const commandsAtoN = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('⌨️ الأوامر من A إلى N')
        .addFields(
            {
                name: '/adhan_zones — إدارة السيرفر',
                value: 'عرض مناطق الأذان المحفوظة وإدارتها: تفعيل/توقيف، تعديل، اختبار الإشعار أو الصوت، والحذف.',
            },
            {
                name: '/donate — للجميع',
                value: 'عرض معلومات دعم مصاريف الخادم والخدمة، مع زر يرسل بيانات RIB في رسالة خاصة. هذا الأمر سيبقى متاحاً.',
            },
            {
                name: '/how_to_use — للجميع',
                value: 'فتح هذا الدليل الكامل والمحدّث لجميع أوامر البوت.',
            },
            {
                name: '/nakhtim — إدارة السيرفر أو الخاص',
                value: 'إعداد ختمة يومية: أسبوع، شهر، 3 أو 6 أشهر، رمضان، أو عدد صفحات مخصص. في السيرفر تختار قناة مستقلة للختمة الجماعية وقناة أخرى للورد الشخصي. تُرسل أول دفعة فور الحفظ ثم يومياً في 08:00 بتوقيت مكة. رتبة المنشن تُحدد من `/setup_roles`، وبدونها لا يوجد منشن.',
            },
        );

    const setupCommands = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('⚙️ أوامر الإعداد')
        .addFields(
            {
                name: '/setup_adhan — إدارة السيرفر',
                value: 'إضافة منطقة أذان باختيار الدولة والمدينة والقناة، وضبط وضع الصوت والملف ومستوى الصوت. يدعم إدخال Channel ID.',
            },
            {
                name: '/setup_adhkar — إدارة السيرفر',
                value: 'اختيار قناة الأذكار والمنطقة المرجعية، ثم تفعيل الأنواع المطلوبة أو معاينتها وإيقافها. يدعم Channel ID.',
            },
            {
                name: '/setup_channels — إدارة السيرفر',
                value: 'اللوحة الموحدة لفتح إعداد الأذان، القرآن، الأذكار، الصلاة على النبي ﷺ، الجمعة، الختمة، الخاص، الرتب والسجلات.',
            },
            {
                name: '/setup_dm — للجميع',
                value: 'فتح لوحة الإعدادات الشخصية في الخاص. داخل السيرفر يمكن أيضاً نشر زر اللوحة في قناة ليستعمله الأعضاء.',
            },
            {
                name: '/setup_jumuah — إدارة السيرفر',
                value: 'إعداد تذكير الجمعة وموعده ومنطقته الزمنية، مع معاينة البطاقة وتشغيل أو إيقاف صوت سورة الكهف.',
            },
            {
                name: '/setup_logs — Administrator',
                value: 'اختيار قناة السجلات، تفعيل التنبيهات الحرجة في الخاص، اختبار السجلات أو حذف الإعداد.',
            },
            {
                name: '/setup_quran — إدارة السيرفر',
                value: 'اختيار قناة القرآن الصوتية وتفعيل التشغيل العشوائي 24/24. يدعم اختيار القناة بالاسم أو Channel ID.',
            },
            {
                name: '/setup_roles — إدارة السيرفر',
                value: 'ربط رتب المنشن الخاصة بالأذان والأذكار والصلاة على النبي ﷺ والجمعة والختمة.',
            },
            {
                name: '/setup_salawat — إدارة السيرفر',
                value: 'إعداد قناة وجدولة الصلاة على النبي ﷺ بفاصل زمني أو أوقات ثابتة، مع المعاينة والتفعيل والحذف.',
            },
            {
                name: '/test — إدارة السيرفر',
                value: 'تدقيق الروابط والصلاحيات والملفات والجدولة والصوت. الاختبارات الحية أو إعادة بناء الفهارس لا تعمل إلا بعد تأكيد صريح.',
            },
        )
        .setFooter({ text: 'رفيق الروح • المطوّر: يونس الحافلي • جزاكم الله خيراً ❤️' })
        .setTimestamp();

    return [overview, commandsAtoN, setupCommands];
}

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ embeds: buildHowToUseEmbeds(), flags: 64 });
}
