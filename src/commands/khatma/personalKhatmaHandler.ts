import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { KhatmaMode } from '../../types';
import { calculatePagesPerDay, QURAN_PAGE_IMAGE_BASE_URL } from '../../services/khatmaService';
import {
    acknowledgePersonalKhatmaPage,
    completionStatistics,
    deletePersonalGuildKhatma,
    getPersonalGuildKhatma,
    getPersonalKhatmaProgress,
    PersonalGuildKhatmaConfig,
    restartPersonalKhatma,
    savePersonalGuildKhatma,
} from '../../services/personalGuildKhatmaService';
import { getRolesConfig } from '../../services/rolesConfigService';

type PersonalInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

const MODE_LABELS: Record<KhatmaMode, string> = {
    custom: 'عدد صفحات مخصص',
    week: 'ختمة في أسبوع',
    month: 'ختمة في شهر',
    '3_months': 'ختمة في ثلاثة أشهر',
    '6_months': 'ختمة في ستة أشهر',
    ramadan: 'ختمة رمضانية',
};
const VALID_MODES = Object.keys(MODE_LABELS) as KhatmaMode[];

interface PersonalSetupSession {
    guildId: string;
    ownerId: string;
    enabled: boolean;
    mode: KhatmaMode;
    pagesPerDay: number;
    ramadanKhatmas: number;
    existing?: PersonalGuildKhatmaConfig;
}

const setupSessions = new Map<string, PersonalSetupSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

interface SurahItem {
    name: string;
    start: number;
    end: number;
}

const SURAHS: SurahItem[] = [
    { name: '1. الفاتحة', start: 1, end: 1 },
    { name: '2. البقرة', start: 2, end: 49 },
    { name: '3. آل عمران', start: 50, end: 76 },
    { name: '4. النساء', start: 77, end: 106 },
    { name: '5. المائدة', start: 106, end: 127 },
    { name: '6. الأنعام', start: 128, end: 150 },
    { name: '7. الأعراف', start: 151, end: 176 },
    { name: '8. الأنفال', start: 177, end: 186 },
    { name: '9. التوبة', start: 187, end: 207 },
    { name: '10. يونس', start: 208, end: 221 },
    { name: '11. هود', start: 221, end: 235 },
    { name: '12. يوسف', start: 235, end: 248 },
    { name: '13. الرعد', start: 249, end: 255 },
    { name: '14. إبراهيم', start: 255, end: 261 },
    { name: '15. الحجر', start: 262, end: 267 },
    { name: '16. النحل', start: 267, end: 281 },
    { name: '17. الإسراء', start: 282, end: 293 },
    { name: '18. الكهف', start: 293, end: 304 },
    { name: '19. مريم', start: 305, end: 312 },
    { name: '20. طه', start: 312, end: 321 },
    { name: '21. الأنبياء', start: 322, end: 331 },
    { name: '22. الحج', start: 332, end: 341 },
    { name: '23. المؤمنون', start: 342, end: 349 },
    { name: '24. النور', start: 350, end: 359 },
    { name: '25. الفرقان', start: 359, end: 366 },
    { name: '26. الشعراء', start: 367, end: 376 },
    { name: '27. النمل', start: 377, end: 385 },
    { name: '28. القصص', start: 385, end: 396 },
    { name: '29. العنكبوت', start: 396, end: 404 },
    { name: '30. الروم', start: 404, end: 410 },
    { name: '31. لقمان', start: 411, end: 414 },
    { name: '32. السجدة', start: 415, end: 417 },
    { name: '33. الأحزاب', start: 418, end: 427 },
    { name: '34. سبأ', start: 428, end: 434 },
    { name: '35. فاطر', start: 434, end: 440 },
    { name: '36. يس', start: 440, end: 445 },
    { name: '37. الصافات', start: 446, end: 452 },
    { name: '38. ص', start: 453, end: 458 },
    { name: '39. الزمر', start: 458, end: 467 },
    { name: '40. غافر', start: 467, end: 476 },
    { name: '41. فصلت', start: 477, end: 482 },
    { name: '42. الشورى', start: 483, end: 489 },
    { name: '43. الزخرف', start: 489, end: 495 },
    { name: '44. الدخان', start: 496, end: 498 },
    { name: '45. الجاثية', start: 499, end: 502 },
    { name: '46. الأحقاف', start: 502, end: 506 },
    { name: '47. محمد', start: 507, end: 510 },
    { name: '48. الفتح', start: 511, end: 515 },
    { name: '49. الحجرات', start: 515, end: 517 },
    { name: '50. ق', start: 518, end: 520 },
    { name: '51. الذاريات', start: 520, end: 523 },
    { name: '52. الطور', start: 523, end: 525 },
    { name: '53. النجم', start: 526, end: 528 },
    { name: '54. القمر', start: 528, end: 531 },
    { name: '55. الرحمن', start: 531, end: 534 },
    { name: '56. الواقعة', start: 534, end: 537 },
    { name: '57. الحديد', start: 537, end: 541 },
    { name: '58. المجادلة', start: 542, end: 545 },
    { name: '59. الحشر', start: 545, end: 548 },
    { name: '60. الممتحنة', start: 549, end: 551 },
    { name: '61. الصف', start: 551, end: 552 },
    { name: '62. الجمعة', start: 553, end: 554 },
    { name: '63. المنافقون', start: 554, end: 555 },
    { name: '64. التغابن', start: 556, end: 557 },
    { name: '65. الطلاق', start: 558, end: 559 },
    { name: '66. التحريم', start: 560, end: 561 },
    { name: '67. الملك', start: 562, end: 564 },
    { name: '68. القلم', start: 564, end: 566 },
    { name: '69. الحاقة', start: 566, end: 568 },
    { name: '70. المعارج', start: 568, end: 570 },
    { name: '71. نوح', start: 570, end: 571 },
    { name: '72. الجن', start: 572, end: 573 },
    { name: '73. المزمل', start: 574, end: 575 },
    { name: '74. المدثر', start: 575, end: 577 },
    { name: '75. القيامة', start: 577, end: 578 },
    { name: '76. الإنسان', start: 578, end: 580 },
    { name: '77. المرسلات', start: 580, end: 581 },
    { name: '78. النبأ', start: 582, end: 583 },
    { name: '79. النازعات', start: 583, end: 584 },
    { name: '80. عبس', start: 585, end: 585 },
    { name: '81. التكوير', start: 586, end: 586 },
    { name: '82. الانفطار', start: 587, end: 587 },
    { name: '83. المطففين', start: 587, end: 589 },
    { name: '84. الانشقاق', start: 589, end: 590 },
    { name: '85. البروج', start: 590, end: 591 },
    { name: '86. الطارق', start: 591, end: 592 },
    { name: '87. الأعلى', start: 592, end: 592 },
    { name: '88. الغاشية', start: 592, end: 593 },
    { name: '89. الفجر', start: 593, end: 594 },
    { name: '90. البلد', start: 594, end: 595 },
    { name: '91. الشمس', start: 595, end: 595 },
    { name: '92. الليل', start: 595, end: 596 },
    { name: '93. الضحى', start: 596, end: 596 },
    { name: '94. الشرح', start: 596, end: 596 },
    { name: '95. التين', start: 597, end: 597 },
    { name: '96. العلق', start: 597, end: 597 },
    { name: '97. القدر', start: 598, end: 598 },
    { name: '98. البينة', start: 598, end: 599 },
    { name: '99. الزلزلة', start: 599, end: 599 },
    { name: '100. العاديات', start: 599, end: 600 },
    { name: '101. القارعة', start: 600, end: 600 },
    { name: '102. التكاثر', start: 600, end: 600 },
    { name: '103. العصر', start: 601, end: 601 },
    { name: '104. الهمزة', start: 601, end: 601 },
    { name: '105. الفيل', start: 601, end: 601 },
    { name: '106. قريش', start: 602, end: 602 },
    { name: '107. الماعون', start: 602, end: 602 },
    { name: '108. الكوثر', start: 602, end: 602 },
    { name: '109. الكافرون', start: 603, end: 603 },
    { name: '110. النصر', start: 603, end: 603 },
    { name: '111. المسد', start: 603, end: 603 },
    { name: '112. الإخلاص', start: 604, end: 604 },
    { name: '113. الفلق', start: 604, end: 604 },
    { name: '114. الناس', start: 604, end: 604 },
];

function customSurahPagePayload(page: number, startPage: number, endPage: number, surahName: string) {
    const filename = `quran_page_${page}.jpg`;
    const surahPageNum = page - startPage + 1;
    const totalSurahPages = endPage - startPage + 1;

    const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle(`📖 ${surahName} - الصفحة ${page} (صفحة ${surahPageNum} من ${totalSurahPages})`)
        .setDescription('قراءة اختيارية خاصة لا تؤثر على تقدم وردك اليومي.')
        .setImage(`attachment://${filename}`)
        .setFooter({ text: 'تصفح الصفحات باستخدام الأزرار أدناه.' });

    const row = new ActionRowBuilder<ButtonBuilder>();

    if (page > startPage) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`personal_khatma_view_page_${page - 1}_${startPage}_${endPage}_${surahName}`)
                .setLabel('الصفحة السابقة')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Primary)
        );
    }

    if (page < endPage) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`personal_khatma_view_page_${page + 1}_${startPage}_${endPage}_${surahName}`)
                .setLabel('الصفحة التالية')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Primary)
        );
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('personal_khatma_view_stop')
            .setLabel('توقف')
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        files: [new AttachmentBuilder(`${QURAN_PAGE_IMAGE_BASE_URL}/${page}.jpg`, { name: filename })],
        attachments: [],
        components: [row],
    };
}

async function startCustomSurahReading(interaction: PersonalInteraction, startPage: number, endPage: number, surahName: string) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
    }
    const payload = customSurahPagePayload(startPage, startPage, endPage, surahName);
    await interaction.editReply(payload);
}

async function updateCustomSurahReading(interaction: PersonalInteraction, page: number, startPage: number, endPage: number, surahName: string) {
    await interaction.deferUpdate();
    const payload = customSurahPagePayload(page, startPage, endPage, surahName);
    await interaction.editReply(payload);
}

async function sendSurahSelectionMenu(interaction: PersonalInteraction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
    }

    const selectMenu1 = new StringSelectMenuBuilder()
        .setCustomId('personal_khatma_select_surah_1')
        .setPlaceholder('📖 السور 1 - 23 (الفاتحة - المؤمنون)')
        .addOptions(SURAHS.slice(0, 23).map(s => ({
            label: s.name,
            value: `${s.start}_${s.end}_${s.name.split('. ')[1]}`,
        })));

    const selectMenu2 = new StringSelectMenuBuilder()
        .setCustomId('personal_khatma_select_surah_2')
        .setPlaceholder('📖 السور 24 - 46 (النور - الأحقاف)')
        .addOptions(SURAHS.slice(23, 46).map(s => ({
            label: s.name,
            value: `${s.start}_${s.end}_${s.name.split('. ')[1]}`,
        })));

    const selectMenu3 = new StringSelectMenuBuilder()
        .setCustomId('personal_khatma_select_surah_3')
        .setPlaceholder('📖 السور 47 - 69 (محمد - الحاقة)')
        .addOptions(SURAHS.slice(46, 69).map(s => ({
            label: s.name,
            value: `${s.start}_${s.end}_${s.name.split('. ')[1]}`,
        })));

    const selectMenu4 = new StringSelectMenuBuilder()
        .setCustomId('personal_khatma_select_surah_4')
        .setPlaceholder('📖 السور 70 - 92 (المعارج - الليل)')
        .addOptions(SURAHS.slice(69, 92).map(s => ({
            label: s.name,
            value: `${s.start}_${s.end}_${s.name.split('. ')[1]}`,
        })));

    const selectMenu5 = new StringSelectMenuBuilder()
        .setCustomId('personal_khatma_select_surah_5')
        .setPlaceholder('📖 السور 93 - 114 (الضحى - الناس)')
        .addOptions(SURAHS.slice(92, 114).map(s => ({
            label: s.name,
            value: `${s.start}_${s.end}_${s.name.split('. ')[1]}`,
        })));

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu1);
    const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu2);
    const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu3);
    const row4 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu4);
    const row5 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu5);

    await interaction.editReply({
        content: 'اختر السورة التي ترغب في قراءتها من القوائم أدناه (لن تُحتسب القراءة من وردك اليومي):',
        components: [row1, row2, row3, row4, row5],
    });
}

export function buildPublicPersonalKhatmaPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('📖 ورد القرآن الكريم الشخصي')
        .setDescription(
            'أنشئ خطة ختمة خاصة بك داخل هذا السيرفر، ثم اقرأ صفحاتك صفحةً بعد صفحة في رسالة لا يراها غيرك.\n\n' +
            'يحفظ البوت تقدمك بعد كل صفحة، ولن تفوتك أي صفحة إذا انقطعت عن القراءة عدة أيام.',
        )
        .addFields(
            { name: '⚙️ إعداد شخصي', value: 'اختر مدة الختمة أو عدداً مخصصاً من الصفحات اليومية.', inline: true },
            { name: '👁️ خصوصية كاملة', value: 'الصفحات والتقدم يظهران لك وحدك داخل السيرفر.', inline: true },
        )
        .setFooter({ text: 'اضغط «استلم ورد اليوم» في أي وقت لمتابعة القراءة من آخر صفحة.' });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('personal_khatma_config').setLabel('إعداد ختمتي').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('personal_khatma_read').setLabel('استلم ورد اليوم').setEmoji('📖').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('personal_khatma_choose_surah').setLabel('قراءة سورة').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}

function buildSetupPayload(session: PersonalSetupSession) {
    const existing = session.existing;
    const progress = existing && existing.currentPage <= 604 ? getPersonalKhatmaProgress(existing) : null;
    const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('⚙️ إعداد ختمتك الشخصية')
        .setDescription('هذه الإعدادات خاصة بك داخل هذا السيرفر، ولا تغيّر ختمة السيرفر أو إعدادات أي عضو آخر.')
        .addFields(
            { name: 'الحالة', value: session.enabled ? '✅ مفعلة' : '⏸️ متوقفة', inline: true },
            { name: 'الخطة', value: MODE_LABELS[session.mode], inline: true },
            { name: 'الصفحات اليومية', value: String(session.pagesPerDay), inline: true },
            ...(progress ? [{ name: 'تقدمك المحفوظ', value: `${progress.pagesRead} من 604 صفحة`, inline: true }] : []),
        );
    const mode = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('personal_khatma_mode')
            .setPlaceholder('اختر خطة الختمة')
            .addOptions(VALID_MODES.map(value => ({ label: MODE_LABELS[value], value, default: value === session.mode }))),
    );
    const settings = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('personal_khatma_custom').setLabel('عدد الصفحات').setEmoji('🔢').setStyle(ButtonStyle.Secondary).setDisabled(session.mode !== 'custom'),
        new ButtonBuilder().setCustomId('personal_khatma_ramadan').setLabel('عدد الختمات الرمضانية').setEmoji('🌙').setStyle(ButtonStyle.Secondary).setDisabled(session.mode !== 'ramadan'),
        new ButtonBuilder().setCustomId('personal_khatma_toggle').setLabel(session.enabled ? 'إيقاف' : 'تفعيل').setStyle(session.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    );
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('personal_khatma_save').setLabel('حفظ وبدء الختمة').setEmoji('💾').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('personal_khatma_delete').setLabel('حذف الإعداد').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('personal_khatma_close').setLabel('إغلاق').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [mode, settings, actions] };
}

async function syncSubscriberRole(interaction: PersonalInteraction, enabled: boolean) {
    if (!interaction.guild || !interaction.guildId) return;
    const roles = await getRolesConfig(interaction.guildId);
    if (!roles.khatmaRoleId) return;
    const role = await interaction.guild.roles.fetch(roles.khatmaRoleId).catch(() => null);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!role || !member) return;
    if (enabled) await member.roles.add(role, 'تفعيل الورد الشخصي للقرآن').catch(() => null);
    else await member.roles.remove(role, 'إيقاف الورد الشخصي للقرآن').catch(() => null);
}

async function openSetup(interaction: PersonalInteraction, forceFresh = false) {
    if (!interaction.guildId) {
        await interaction.reply({ content: '❌ هذه اللوحة تعمل داخل السيرفرات فقط.', flags: 64 });
        return;
    }
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const existing = await getPersonalGuildKhatma(interaction.guildId, interaction.user.id);
    const session: PersonalSetupSession = {
        guildId: interaction.guildId,
        ownerId: interaction.user.id,
        enabled: forceFresh ? true : (existing?.enabled ?? true),
        mode: existing?.mode ?? 'month',
        pagesPerDay: existing?.pagesPerDay || calculatePagesPerDay(existing?.mode ?? 'month'),
        ramadanKhatmas: existing?.ramadanKhatmas ?? 1,
        existing: forceFresh && existing ? { ...existing, awaitingRestartChoice: true } : existing || undefined,
    };
    setupSessions.set(sessionKey(session.guildId, session.ownerId), session);
    if (interaction.deferred || interaction.replied) await interaction.editReply(buildSetupPayload(session));
    else await interaction.reply({ ...buildSetupPayload(session), flags: 64 });
}

function readingPagePayload(config: PersonalGuildKhatmaConfig, extra = false) {
    const page = Math.min(604, config.currentPage);
    const progress = getPersonalKhatmaProgress(config);
    const filename = `quran_page_${page}.jpg`;
    const context = extra
        ? 'قراءة إضافية اختيارية؛ سيحفظ البوت تقدمك عند تأكيد قراءة الصفحة.'
        : progress.missedReadingDays > 0
            ? `لديك ${progress.pagesDue} صفحة مستحقة، وعدد أيام الانقطاع السابقة: ${progress.missedReadingDays}. ابدأ بهدوء وسيُحفظ تقدمك بعد كل صفحة.`
            : `وردك المستحق اليوم: ${progress.pagesDue} صفحة. سيُحفظ تقدمك بعد كل صفحة.`;
    return {
        embeds: [new EmbedBuilder()
            .setColor(0x7c3aed)
            .setTitle(`📖 الصفحة ${page} من 604`)
            .setDescription(context)
            .setImage(`attachment://${filename}`)
            .setFooter({ text: 'بعد إتمام القراءة اضغط «تمت قراءة الصفحة» للانتقال إلى الصفحة التالية.' })],
        files: [new AttachmentBuilder(`${QURAN_PAGE_IMAGE_BASE_URL}/${page}.jpg`, { name: filename })],
        attachments: [],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`personal_khatma_ack_${page}_${extra ? 'extra' : 'due'}`).setLabel('تمت قراءة الصفحة').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('personal_khatma_pause_reading').setLabel('توقف الآن').setStyle(ButtonStyle.Secondary),
        )],
    };
}

function caughtUpPayload(config: PersonalGuildKhatmaConfig) {
    const progress = getPersonalKhatmaProgress(config);
    return {
        embeds: [new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('✅ أتممت وردك المستحق')
            .setDescription(
                `أحسنت، وصلت إلى الصفحة **${progress.pagesRead} من 604**. تم حفظ تقدمك.\n\n` +
                'هل ترغب في مواصلة القراءة والتقدم أكثر في ختمتك؟',
            )],
        files: [], attachments: [],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('personal_khatma_continue_extra').setLabel('نعم، أريد المتابعة').setEmoji('📖').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('personal_khatma_pause_reading').setLabel('سأتوقف هنا').setStyle(ButtonStyle.Secondary),
        )],
    };
}

function completionPayload(config: PersonalGuildKhatmaConfig) {
    const stats = completionStatistics(config);
    const timing = stats.earlyDays > 0
        ? `أنهيت الختمة قبل المدة المخططة بـ **${stats.earlyDays} أيام**.`
        : stats.delayDays > 0
            ? `أتممت الختمة بعد المدة المخططة بـ **${stats.delayDays} أيام**، واستمرارك حتى النهاية هو الإنجاز الأهم.`
            : 'أتممت الختمة في المدة المخططة تماماً.';
    const encouragement = stats.delayDays > 0
        ? 'عودتك بعد الانقطاع وثباتك حتى النهاية أمر يستحق التقدير. لا تجعل تأخرك يحجب عنك فرحة الوصول؛ فكل صفحة قرأتها خطوة مباركة.'
        : 'بارك الله في ثباتك، واجعل هذا الإنجاز بدايةً لمزيد من الصحبة مع كتاب الله.';
    return {
        embeds: [new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('✨ مبارك إتمام ختم القرآن الكريم ✨')
            .setDescription(
                'اللهم اجعل القرآن ربيع قلبك، ونور صدرك، وهدىً ورحمةً لك. تقبل الله منك صالح العمل.\n\n' +
                `${encouragement}\n\n${timing}`,
            )
            .addFields(
                { name: 'المدة المخططة', value: `${stats.plannedDays} يوماً`, inline: true },
                { name: 'المدة الفعلية', value: `${stats.actualDays} يوماً`, inline: true },
                { name: 'أيام القراءة', value: `${stats.readingDays} يوماً`, inline: true },
                { name: 'أيام الانقطاع', value: `${stats.missedReadingDays} يوماً`, inline: true },
                { name: 'عدد ختماتك', value: String(config.completedKhatmas), inline: true },
            )
            .setFooter({ text: 'اختر ما تريد فعله بعد هذه الختمة.' })],
        files: [], attachments: [],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('personal_khatma_restart_same').setLabel('إعادة الختمة بالإعدادات نفسها').setEmoji('🔄').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('personal_khatma_restart_change').setLabel('تغيير إعدادات الختمة').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('personal_khatma_finish_stop').setLabel('التوقف حالياً').setStyle(ButtonStyle.Secondary),
        )],
    };
}

async function startReading(interaction: PersonalInteraction, extra = false) {
    if (!interaction.guildId) return interaction.reply({ content: '❌ القراءة الشخصية متاحة داخل السيرفر فقط.', flags: 64 });
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const config = await getPersonalGuildKhatma(interaction.guildId, interaction.user.id);
    if (!config) {
        await interaction.editReply({ content: 'لم تُنشئ خطة ختمة بعد. اضغط **إعداد ختمتي** أولاً.' });
        return;
    }
    if (config.awaitingRestartChoice || config.currentPage > 604) {
        const payload = completionPayload(config);
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: 64 });
        return;
    }
    if (!config.enabled) {
        await interaction.editReply({ content: '⏸️ ختمتك متوقفة حالياً. افتح **إعداد ختمتي** ثم فعّلها.' });
        return;
    }
    const progress = getPersonalKhatmaProgress(config);
    const payload = extra || progress.pagesDue > 0 ? readingPagePayload(config, extra) : caughtUpPayload(config);
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: 64 });
}

export async function handlePersonalKhatmaInteraction(interaction: PersonalInteraction) {
    const id = interaction.customId;
    if (id === 'personal_khatma_config') return openSetup(interaction);
    if (id === 'personal_khatma_read') return startReading(interaction);
    if (id === 'personal_khatma_continue_extra') return startReading(interaction, true);
    if (id === 'personal_khatma_pause_reading') {
        await (interaction as any).update({ content: '✅ تم حفظ تقدمك. يمكنك العودة في أي وقت من زر **استلم ورد اليوم**.', embeds: [], components: [], files: [], attachments: [] });
        return;
    }

    if (!interaction.guildId) {
        await interaction.reply({ content: '❌ هذه الميزة تعمل داخل السيرفرات فقط.', flags: 64 });
        return;
    }

    const key = sessionKey(interaction.guildId, interaction.user.id);
    const session = setupSessions.get(key);

    if (interaction.isModalSubmit()) {
        if (!session) return interaction.reply({ content: 'انتهت جلسة الإعداد. افتح اللوحة من جديد.', flags: 64 });
        const raw = interaction.fields.getTextInputValue('value').trim();
        const value = Number(raw);
        if (id === 'personal_khatma_custom_modal') {
            if (!Number.isInteger(value) || value < 1 || value > 604) return interaction.reply({ content: '❌ أدخل عدداً صحيحاً بين 1 و604.', flags: 64 });
            session.mode = 'custom'; session.pagesPerDay = value;
        } else if (id === 'personal_khatma_ramadan_modal') {
            if (!Number.isInteger(value) || value < 1 || value > 10) return interaction.reply({ content: '❌ أدخل عدداً صحيحاً بين 1 و10.', flags: 64 });
            session.mode = 'ramadan'; session.ramadanKhatmas = value; session.pagesPerDay = calculatePagesPerDay('ramadan', value);
        }
        await (interaction as any).update(buildSetupPayload(session));
        return;
    }

    if (interaction.isStringSelectMenu() && id === 'personal_khatma_mode') {
        if (!session) return interaction.reply({ content: 'انتهت جلسة الإعداد. افتح اللوحة من جديد.', flags: 64 });
        const mode = interaction.values[0] as KhatmaMode;
        if (!VALID_MODES.includes(mode)) return;
        session.mode = mode;
        session.pagesPerDay = calculatePagesPerDay(mode, session.ramadanKhatmas);
        await interaction.update(buildSetupPayload(session));
        return;
    }

    if (!interaction.isButton()) return;

    const ack = id.match(/^personal_khatma_ack_(\d+)_(due|extra)$/);
    if (ack) {
        await interaction.deferUpdate();
        const page = Number(ack[1]);
        const result = await acknowledgePersonalKhatmaPage(interaction.guildId, interaction.user.id, page);
        if (!result.advanced) {
            await interaction.editReply({ content: 'تم تسجيل هذه الصفحة من قبل. اضغط زر الورد من جديد لمتابعة القراءة.', embeds: [], components: [], files: [], attachments: [] });
            return;
        }
        if (result.completed) {
            await syncSubscriberRole(interaction, false);
            await interaction.editReply(completionPayload(result.config));
            return;
        }
        const progress = getPersonalKhatmaProgress(result.config);
        const extra = ack[2] === 'extra';
        await interaction.editReply(extra
            ? readingPagePayload(result.config, true)
            : progress.pagesDue > 0 ? readingPagePayload(result.config, false) : caughtUpPayload(result.config));
        return;
    }

    if (id === 'personal_khatma_restart_same') {
        const existing = await getPersonalGuildKhatma(interaction.guildId, interaction.user.id);
        if (!existing) return interaction.reply({ content: '❌ لم أجد إعداد الختمة.', flags: 64 });
        const restarted = restartPersonalKhatma(existing);
        await savePersonalGuildKhatma(restarted);
        await syncSubscriberRole(interaction, true);
        await interaction.update({ content: '✅ بدأت ختمة جديدة بالإعدادات نفسها. يمكنك استلام وردك الأول الآن.', embeds: [], files: [], attachments: [], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('personal_khatma_read').setLabel('استلم ورد اليوم').setEmoji('📖').setStyle(ButtonStyle.Primary))] });
        return;
    }
    if (id === 'personal_khatma_restart_change') return openSetup(interaction, true);
    if (id === 'personal_khatma_finish_stop') {
        const existing = await getPersonalGuildKhatma(interaction.guildId, interaction.user.id);
        if (existing) await savePersonalGuildKhatma({ ...existing, enabled: false, awaitingRestartChoice: false, updatedAt: new Date().toISOString() });
        await syncSubscriberRole(interaction, false);
        await interaction.update({ content: 'تم حفظ سجل ختمتك وإيقاف التنبيهات. يمكنك بدء ختمة جديدة متى شئت.', embeds: [], components: [], files: [], attachments: [] });
        return;
    }

    if (!session) {
        await interaction.reply({ content: 'انتهت جلسة الإعداد. اضغط **إعداد ختمتي** من جديد.', flags: 64 });
        return;
    }
    if (id === 'personal_khatma_custom' || id === 'personal_khatma_ramadan') {
        const isCustom = id.endsWith('custom');
        const modal = new ModalBuilder()
            .setCustomId(isCustom ? 'personal_khatma_custom_modal' : 'personal_khatma_ramadan_modal')
            .setTitle(isCustom ? 'عدد الصفحات اليومية' : 'عدد الختمات الرمضانية')
            .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel(isCustom ? 'عدد الصفحات من 1 إلى 604' : 'عدد الختمات من 1 إلى 10')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(isCustom ? session.pagesPerDay : session.ramadanKhatmas)),
            ));
        await interaction.showModal(modal);
        return;
    }
    if (id === 'personal_khatma_toggle') {
        session.enabled = !session.enabled;
        await interaction.update(buildSetupPayload(session));
        return;
    }
    if (id === 'personal_khatma_close') {
        setupSessions.delete(key);
        await interaction.update({ content: 'تم إغلاق الإعدادات دون حفظ تغييرات جديدة.', embeds: [], components: [] });
        return;
    }
    if (id === 'personal_khatma_delete') {
        await deletePersonalGuildKhatma(interaction.guildId, interaction.user.id);
        await syncSubscriberRole(interaction, false);
        setupSessions.delete(key);
        await interaction.update({ content: '✅ تم حذف إعداد ختمتك الشخصية وإيقاف تنبيهاتها.', embeds: [], components: [] });
        return;
    }
    if (id === 'personal_khatma_save') {
        const existing = session.existing;
        const shouldRestart = !existing || existing.awaitingRestartChoice || existing.currentPage > 604;
        const now = new Date().toISOString();
        const config: PersonalGuildKhatmaConfig = {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            enabled: session.enabled,
            mode: session.mode,
            pagesPerDay: session.pagesPerDay,
            ramadanKhatmas: session.mode === 'ramadan' ? session.ramadanKhatmas : undefined,
            currentPage: shouldRestart ? 1 : existing.currentPage,
            startedAt: shouldRestart ? now : existing.startedAt,
            updatedAt: now,
            readingDates: shouldRestart ? [] : existing.readingDates,
            completedKhatmas: existing?.completedKhatmas || 0,
            lastCompletedAt: existing?.lastCompletedAt,
            awaitingRestartChoice: false,
        };
        await savePersonalGuildKhatma(config);
        await syncSubscriberRole(interaction, config.enabled);
        setupSessions.delete(key);
        await interaction.update({
            content: config.enabled ? '✅ تم حفظ خطتك وبدء الختمة. اضغط الزر لاستلام وردك الأول.' : '✅ تم حفظ خطتك وهي متوقفة حالياً.',
            embeds: [],
            components: config.enabled ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('personal_khatma_read').setLabel('استلم ورد اليوم').setEmoji('📖').setStyle(ButtonStyle.Primary))] : [],
        });
    }
}
