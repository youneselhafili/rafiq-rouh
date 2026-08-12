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
