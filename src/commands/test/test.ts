import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
    EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { DiagnosticCheck, LinkTarget } from '../../services/diagnosticService';

export interface TestSession {
    guildId: string;
    userId: string;
    startedAt: string;
    statuses: Record<string, 'pending' | 'running' | 'pass' | 'warning' | 'fail'>;
    checks: DiagnosticCheck[];
    data: Record<string, any>;
    failedLinks: LinkTarget[];
}

export const activeTestSessions = new Map<string, TestSession>();

export const data = new SlashCommandBuilder()
    .setName('test')
    .setDescription('تدقيق آمن وشامل لجميع أنظمة البوت')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const TASK_LABELS: Record<string, string> = {
    quickLinks: 'الفحص السريع لروابط القرآن',
    fullLinks: 'الفحص الكامل لجميع روابط القرآن',
    permissions: 'صلاحيات القنوات والرسائل',
    prayerApis: 'مصادر مواقيت الصلاة',
    content: 'الملفات وقاعدة البيانات والفهارس',
    schedulers: 'الجدولة والاستدراك',
    previews: 'المعاينات الآمنة',
    voice: 'الاتصال والتشغيل الصوتي',
    analysis: 'التحليل الشامل',
};

export function buildTestPanel(session: TestSession) {
    const icon = (status: string) => status === 'pass' ? '✅' : status === 'fail' ? '❌' : status === 'warning' ? '⚠️' : status === 'running' ? '🔄' : '⚪';
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle('🛠️ مركز تدقيق رفيق الروح')
        .setDescription('كل الاختبارات آمنة ومخفية. الاختبارات الحية وإعادة بناء الفهارس تحتاج تأكيداً صريحاً. زر **تحديث الحالة** يعرض النتيجة الحالية فقط ولا يعيد الاختبارات الثقيلة.')
        .addFields(
            { name: 'حالة الاختبارات', value: Object.entries(TASK_LABELS).map(([key, label]) => `${icon(session.statuses[key])} ${label}`).join('\n') },
            { name: 'النتائج', value: `الفحوصات: **${session.checks.length}** | المشاكل: **${session.checks.filter(check => check.status === 'fail').length}** | الروابط الفاشلة: **${session.failedLinks.length}**` },
        )
        .setFooter({ text: `بدأ التدقيق: ${session.startedAt} — يستعمل إعدادات السيرفر الحقيقية، ويصرح بوضوح عند استعمال عينة بديلة.` })
        .setTimestamp();
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('test_cmd_quick_links').setLabel('فحص سريع').setEmoji('⚡').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('test_cmd_full_links').setLabel('جميع الروابط').setEmoji('🌐').setStyle(ButtonStyle.Secondary).setDisabled(session.statuses.fullLinks === 'running'),
        new ButtonBuilder().setCustomId('test_cmd_permissions').setLabel('الصلاحيات').setEmoji('🔐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('test_cmd_prayer_apis').setLabel('مواقيت الصلاة').setEmoji('🕐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('test_cmd_content').setLabel('الملفات والبيانات').setEmoji('🗄️').setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('test_cmd_schedulers').setLabel('محاكاة الجدولة').setEmoji('📅').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('test_cmd_previews').setLabel('معاينات آمنة').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('test_cmd_voice_health').setLabel('فحص الصوت').setEmoji('🎙️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('test_cmd_voice_adhan').setLabel('تجربة الأذان صوتياً').setEmoji('🔊').setStyle(ButtonStyle.Danger),
    );
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('test_cmd_full_analysis').setLabel('تحليل شامل').setEmoji('🩺').setStyle(ButtonStyle.Success).setDisabled(session.statuses.analysis === 'running'),
        new ButtonBuilder().setCustomId('test_cmd_summary').setLabel('تحميل التقرير').setEmoji('📄').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('test_cmd_refresh').setLabel('تحديث الحالة').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('test_cmd_retry').setLabel('إعادة فحص الفاشل').setEmoji('♻️').setStyle(ButtonStyle.Secondary).setDisabled(!session.failedLinks.length),
        new ButtonBuilder().setCustomId('test_cmd_rebuild').setLabel('إعادة بناء الفهارس').setEmoji('🧱').setStyle(ButtonStyle.Danger),
    );
    return { embeds: [embed], components: [row1, row2, row3] };
}

export async function execute(interaction: ChatInputCommandInteraction) {
    const session: TestSession = {
        guildId: interaction.guildId!, userId: interaction.user.id, startedAt: new Date().toISOString(),
        statuses: { quickLinks: 'pending', fullLinks: 'pending', permissions: 'pending', prayerApis: 'pending', content: 'pending', schedulers: 'pending', previews: 'pending', voice: 'pending', analysis: 'pending' },
        checks: [], data: {}, failedLinks: [],
    };
    activeTestSessions.set(interaction.user.id, session);
    await interaction.reply({ ...buildTestPanel(session), flags: 64 });
}
