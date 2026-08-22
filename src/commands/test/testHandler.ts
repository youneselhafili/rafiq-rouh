import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    GuildMember, MessageComponentInteraction, PermissionFlagsBits,
} from 'discord.js';
import {
    auditContentAndDatabase, auditGuildPermissions, auditPrayerApis, auditQuranLinks, auditVoiceSystem,
    DiagnosticCheck, fullQuranTargets, quickQuranTargets, schedulerDryRun,
} from '../../services/diagnosticService';
import { activeTestSessions, buildTestPanel, TestSession } from './test';
import { buildAdhkarPreview } from '../../services/adhkarService';
import { buildSalawatPreview } from '../../services/salawatService';
import { getAdhkarV2Config } from '../../services/adhkarConfigServiceV2';
import { getManagedAdhanZones } from '../../services/adhanZoneService';
import { fetchZonePrayerSchedule } from '../../services/adhanService';
import { generateAdhanImage } from '../../services/canvasService';
import { testConfiguredAdhan } from '../../services/adhanAudioService';
import { rebuildCatalogs } from '../../bootstrap/catalogBuilder';
import { sendAuditLog } from '../../services/auditLogService';
import { logger } from '../../utils/logger';

function statusOf(checks: DiagnosticCheck[]): 'pass' | 'warning' | 'fail' {
    if (checks.some(check => check.status === 'fail')) return 'fail';
    if (checks.some(check => check.status === 'warning')) return 'warning';
    return 'pass';
}

function record(session: TestSession, key: string, checks: DiagnosticCheck[], data?: any) {
    session.statuses[key] = statusOf(checks);
    session.checks.push(...checks);
    if (data !== undefined) session.data[key] = data;
}

function checksEmbed(title: string, checks: DiagnosticCheck[], fallback = false) {
    const lines = checks.slice(0, 25).map(check => `${check.status === 'pass' ? '✅' : check.status === 'warning' ? '⚠️' : '❌'} **${check.name}**\n${check.details}`);
    return new EmbedBuilder().setColor(statusOf(checks) === 'fail' ? 0xed4245 : statusOf(checks) === 'warning' ? 0xfee75c : 0x57f287)
        .setTitle(title).setDescription(`${fallback ? '🧪 **عينة بديلة مستعمل لأن إعداد السيرفر غير موجود.**\n\n' : ''}${lines.join('\n\n') || 'لا توجد نتائج.'}`.slice(0, 4000)).setTimestamp();
}

async function logTest(interaction: MessageComponentInteraction, action: string, details?: string) {
    if (interaction.guildId) await sendAuditLog(interaction.client, interaction.guildId, { level: 'info', system: 'Test', action, actorId: interaction.user.id, details }).catch(() => {});
}

export async function handleTestInteraction(interaction: MessageComponentInteraction) {
    if (!interaction.customId.startsWith('test_cmd_') || !interaction.guildId) return;
    const member = interaction.member as GuildMember;
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ هذا الأمر مخصص للمشرفين فقط.', flags: 64 });
        return;
    }
    const session = activeTestSessions.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت جلسة الاختبار. استعمل `/test` من جديد.', flags: 64 });
        return;
    }
    const id = interaction.customId;
    try {
        if (id === 'test_cmd_full_analysis') {
            session.statuses = {
                quickLinks: 'pending', fullLinks: 'pending', permissions: 'pending', prayerApis: 'pending',
                content: 'pending', schedulers: 'pending', previews: 'pending', voice: 'pending', analysis: 'running',
            };
            session.checks = [];
            session.data = {};
            session.failedLinks = [];
            await interaction.deferReply({ flags: 64 });
            const totalSteps = 8;
            const progress = async (step: number, title: string) => {
                await interaction.editReply({
                    content: `🔄 **التحليل الشامل قيد التنفيذ (${step}/${totalSteps})**\n${title}\n\nيتم تنفيذ الفحوصات بالتتابع بدون تغيير إعدادات السيرفر.`,
                    embeds: [], files: [],
                });
            };

            await progress(1, 'فحص عينة سريعة من روابط القرآن والإذاعات...');
            const quick = await auditQuranLinks(quickQuranTargets(), 8);
            const quickChecks: DiagnosticCheck[] = [{
                name: 'الفحص السريع لروابط القرآن', status: quick.failed ? 'fail' : 'pass',
                details: `نجح ${quick.passed} من ${quick.total} خلال ${quick.durationMs} مللي ثانية.`,
            }];
            record(session, 'quickLinks', quickChecks, quick);

            await progress(2, `فحص جميع روابط القرآن (${fullQuranTargets().length} رابط)...`);
            const full = await auditQuranLinks(fullQuranTargets(), 8);
            const fullChecks: DiagnosticCheck[] = [{
                name: 'الفحص الكامل لروابط القرآن', status: full.failed ? 'fail' : 'pass',
                details: `نجح ${full.passed} من ${full.total} خلال ${Math.round(full.durationMs / 1000)} ثانية.`,
            }];
            session.failedLinks = full.failures.map(({ id, label, url }) => ({ id, label, url }));
            record(session, 'fullLinks', fullChecks, full);

            await progress(3, 'فحص صلاحيات القنوات والرسائل والـالسجلات...');
            const permissionResult = await auditGuildPermissions(interaction.client, interaction.guildId);
            record(session, 'permissions', permissionResult.checks, permissionResult);

            await progress(4, 'فحص اتصال Discord الصوتي والكتم والمشغل وحالة القناة...');
            const voiceResult = await auditVoiceSystem(interaction.client, interaction.guildId);
            record(session, 'voice', voiceResult.checks, voiceResult.details);

            await progress(5, 'فحص مصادر مواقيت الصلاة والمناطق الزمنية...');
            const prayerResult = await auditPrayerApis(interaction.guildId);
            record(session, 'prayerApis', prayerResult.checks, prayerResult);

            await progress(6, 'فحص الملفات وقاعدة البيانات والفهارس وملفات الصوت...');
            const contentResult = await auditContentAndDatabase();
            record(session, 'content', contentResult.checks, contentResult.details);

            await progress(7, 'محاكاة الجدولة والاستدراك بدون إرسال حقيقي...');
            const schedulerChecks = await schedulerDryRun(interaction.guildId);
            record(session, 'schedulers', schedulerChecks, schedulerChecks);

            await progress(8, 'إنشاء معاينات آمنة للأذكار والصلاة على النبي والأذان...');
            const adhkarConfig = await getAdhkarV2Config(interaction.guildId);
            const previewType = adhkarConfig ? Object.entries(adhkarConfig.categories).find(([, status]) => status === 'enabled')?.[0] || 'أذكار الصباح' : 'أذكار الصباح';
            const adhkarPreview = await buildAdhkarPreview(interaction.guildId, previewType);
            const salawatPreview = await buildSalawatPreview(interaction.guildId);
            let previewCount = (adhkarPreview?.buffers.length || 0) + (salawatPreview?.image ? 1 : 0);
            let adhanPreviewCreated = false;
            const zones = (await getManagedAdhanZones(interaction.guildId)).filter(zone => zone.enabled);
            if (zones[0]) {
                const schedule = await fetchZonePrayerSchedule(zones[0]);
                if (schedule) {
                    await generateAdhanImage(schedule.city.name, schedule.city.countryAr, 'Fajr', schedule.timings.Fajr.replace(/\s*\(.*\)/, ''), 'إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا', 'النساء');
                    previewCount += 1;
                    adhanPreviewCreated = true;
                }
            }
            const previewChecks: DiagnosticCheck[] = [{
                name: 'المعاينات الآمنة',
                status: previewCount >= 2 ? 'pass' : 'warning',
                details: `تم إنشاء ${previewCount} معاينة بدون منشن أو إرسال حي أو استهلاك للدورات${adhanPreviewCreated ? '' : '؛ لم تُنشأ معاينة الأذان لغياب منطقة صالحة'}.`,
            }];
            record(session, 'previews', previewChecks, { previewType, previewCount, adhanPreviewCreated });

            const problems = session.checks.filter(check => check.status === 'fail' || check.status === 'warning');
            const failures = session.checks.filter(check => check.status === 'fail').length;
            const warnings = session.checks.filter(check => check.status === 'warning').length;
            session.statuses.analysis = failures ? 'fail' : warnings ? 'warning' : 'pass';
            const recommendations = problems.map(check => ({
                problem: check.name,
                severity: check.status === 'fail' ? 'مشكلة' : 'تنبيه',
                action: check.details,
            }));
            const report = {
                generatedAt: new Date().toISOString(), guildId: session.guildId, startedAt: session.startedAt,
                finalStatus: session.statuses.analysis, totals: { checks: session.checks.length, failures, warnings, failedLinks: session.failedLinks.length },
                statuses: session.statuses, checks: session.checks, recommendations, failedLinks: session.failedLinks, data: session.data,
            };
            const problemLines = problems.slice(0, 12).map(check => `${check.status === 'fail' ? '❌' : '⚠️'} **${check.name}**\n${check.details}`);
            const finalEmbed = new EmbedBuilder()
                .setColor(failures ? 0xed4245 : warnings ? 0xfee75c : 0x57f287)
                .setTitle(failures ? '❌ النتيجة النهائية: توجد مشاكل تحتاج إصلاحاً' : warnings ? '⚠️ النتيجة النهائية: النظام يعمل مع تنبيهات' : '✅ النتيجة النهائية: جميع الأنظمة سليمة')
                .setDescription((problemLines.join('\n\n') || 'اجتاز البوت جميع الفحوصات بنجاح.').slice(0, 4000))
                .addFields(
                    { name: 'ملخص التحليل', value: `الفحوصات: **${session.checks.length}**\nالمشاكل: **${failures}**\nالتنبيهات: **${warnings}**\nالروابط الفاشلة: **${session.failedLinks.length}**`, inline: true },
                    { name: 'طريقة الاعتماد', value: 'أرفق ملف التقرير في طلب الإصلاح القادم؛ يحتوي الحالة الحية والتوصيات والبيانات اللازمة لتحديد السبب.', inline: true },
                )
                .setTimestamp();
            await interaction.editReply({
                content: '', embeds: [finalEmbed],
                files: [new AttachmentBuilder((globalThis as any).Buffer.from(JSON.stringify(report, null, 2), 'utf8'), { name: `تقرير-التحليل-الشامل-${Date.now()}.json` })],
            });
            await logTest(interaction, 'اكتمل التحليل الشامل', `${session.checks.length} فحص، ${failures} مشكلة، ${warnings} تنبيه`);
            return;
        }
        if (id === 'test_cmd_voice_health') {
            await interaction.deferReply({ flags: 64 });
            const result = await auditVoiceSystem(interaction.client, interaction.guildId);
            record(session, 'voice', result.checks, result.details);
            await interaction.editReply({ embeds: [checksEmbed('🎙️ فحص الاتصال والتشغيل الصوتي', result.checks)] });
            await logTest(interaction, 'فحص الاتصال الصوتي', `${result.checks.length} فحوصات`);
            return;
        }
        if (id === 'test_cmd_refresh') {
            await interaction.update(buildTestPanel(session));
            return;
        }
        if (id === 'test_cmd_quick_links') {
            await interaction.deferReply({ flags: 64 });
            const result = await auditQuranLinks(quickQuranTargets(), 8);
            const checks: DiagnosticCheck[] = [{ name: 'الفحص السريع لروابط القرآن', status: result.failed ? 'fail' : 'pass', details: `نجح ${result.passed} من ${result.total} — ${result.durationMs} مللي ثانية` }];
            session.failedLinks = result.failures.map(({ id, label, url }) => ({ id, label, url }));
            record(session, 'quickLinks', checks, result);
            await interaction.editReply({ embeds: [checksEmbed('⚡ روابط القرآن السريعة', checks)], files: result.failures.length ? [new AttachmentBuilder((globalThis as any).Buffer.from(JSON.stringify(result.failures, null, 2), 'utf8'), { name: 'quick-link-failures.json' })] : [] });
            await logTest(interaction, 'Quick Quran link audit', `${result.passed}/${result.total}`);
            return;
        }
        if (id === 'test_cmd_full_links') {
            session.statuses.fullLinks = 'running';
            await interaction.reply({ content: `🌐 بدأ الفحص الكامل في الخلفية لـ **${fullQuranTargets().length}** رابط. استعمل **تحديث الحالة** لعرض النتيجة بدون إعادة الفحص.`, flags: 64 });
            await logTest(interaction, 'Full Quran link audit started');
            (async () => {
                const result = await auditQuranLinks(fullQuranTargets(), 8);
                const checks: DiagnosticCheck[] = [{ name: 'الفحص الكامل لروابط القرآن', status: result.failed ? 'fail' : 'pass', details: `نجح ${result.passed} من ${result.total} — ${Math.round(result.durationMs / 1000)} ثانية` }];
                session.failedLinks = result.failures.map(({ id, label, url }) => ({ id, label, url }));
                record(session, 'fullLinks', checks, result);
                await interaction.followUp({ content: `✅ انتهى فحص جميع الروابط: **${result.passed}/${result.total}** ناجح، **${result.failed}** فاشل.`, files: result.failures.length ? [new AttachmentBuilder((globalThis as any).Buffer.from(JSON.stringify(result.failures, null, 2), 'utf8'), { name: 'full-link-failures.json' })] : [], flags: 64 }).catch(() => {});
                await logTest(interaction, 'Full Quran link audit completed', `${result.passed}/${result.total}`);
            })().catch(error => { session.statuses.fullLinks = 'fail'; logger.error('[Test] Background link audit failed:', error); });
            return;
        }
        if (id === 'test_cmd_retry') {
            await interaction.deferReply({ flags: 64 });
            const result = await auditQuranLinks(session.failedLinks, 4);
            session.failedLinks = result.failures.map(({ id, label, url }) => ({ id, label, url }));
            const checks: DiagnosticCheck[] = [{ name: 'إعادة فحص الروابط الفاشلة', status: result.failed ? 'fail' : 'pass', details: `نجح أو تعافى ${result.passed} من ${result.total}` }];
            session.checks.push(...checks);
            session.data.retry = result;
            await interaction.editReply({ embeds: [checksEmbed('♻️ إعادة اختبار الروابط الفاشلة', checks)] });
            await logTest(interaction, 'Failed links retried', `${result.failed} still failing`);
            return;
        }
        if (id === 'test_cmd_permissions') {
            await interaction.deferReply({ flags: 64 });
            const result = await auditGuildPermissions(interaction.client, interaction.guildId);
            record(session, 'permissions', result.checks, result);
            await interaction.editReply({ embeds: [checksEmbed('🔐 فحص الصلاحيات', result.checks, result.usedFallback)] });
            await logTest(interaction, 'Permission audit', `${result.checks.length} targets`);
            return;
        }
        if (id === 'test_cmd_prayer_apis') {
            await interaction.deferReply({ flags: 64 });
            const result = await auditPrayerApis(interaction.guildId);
            record(session, 'prayerApis', result.checks, result);
            await interaction.editReply({ embeds: [checksEmbed('🕐 مصادر مواقيت الصلاة', result.checks, result.usedFallback)] });
            await logTest(interaction, 'Prayer API audit', `${result.checks.length} zones`);
            return;
        }
        if (id === 'test_cmd_content') {
            await interaction.deferReply({ flags: 64 });
            const result = await auditContentAndDatabase();
            record(session, 'content', result.checks, result.details);
            await interaction.editReply({ embeds: [checksEmbed('🗄️ الملفات وقاعدة البيانات والفهارس', result.checks)], files: [new AttachmentBuilder((globalThis as any).Buffer.from(JSON.stringify(result.details, null, 2), 'utf8'), { name: 'content-audit.json' })] });
            await logTest(interaction, 'Content and database audit', `${result.checks.length} checks`);
            return;
        }
        if (id === 'test_cmd_schedulers') {
            await interaction.deferReply({ flags: 64 });
            const checks = await schedulerDryRun(interaction.guildId);
            record(session, 'schedulers', checks, checks);
            await interaction.editReply({ embeds: [checksEmbed('📅 محاكاة الجدولة والاستدراك', checks)] });
            await logTest(interaction, 'Scheduler dry-run');
            return;
        }
        if (id === 'test_cmd_previews') {
            await interaction.deferReply({ flags: 64 });
            const adhkarConfig = await getAdhkarV2Config(interaction.guildId);
            const type = adhkarConfig ? Object.entries(adhkarConfig.categories).find(([, status]) => status === 'enabled')?.[0] || 'أذكار الصباح' : 'أذكار الصباح';
            const adhkar = await buildAdhkarPreview(interaction.guildId, type);
            const salawat = await buildSalawatPreview(interaction.guildId);
            const files: AttachmentBuilder[] = [];
            if (adhkar?.buffers[0]) files.push(new AttachmentBuilder(adhkar.buffers[0], { name: 'preview_adhkar.png' }));
            files.push(new AttachmentBuilder(salawat.image, { name: 'preview_salawat.png' }));
            const zones = (await getManagedAdhanZones(interaction.guildId)).filter(zone => zone.enabled);
            let fallback = false;
            if (zones[0]) {
                const schedule = await fetchZonePrayerSchedule(zones[0]);
                if (schedule) {
                    const image = await generateAdhanImage(schedule.city.name, schedule.city.countryAr, 'Fajr', schedule.timings.Fajr.replace(/\s*\(.*\)/, ''), 'إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا', 'النساء');
                    files.push(new AttachmentBuilder(image, { name: 'preview_adhan.png' }));
                }
            } else fallback = true;
            const checks: DiagnosticCheck[] = [{ name: 'حزمة المعاينات المخفية', status: files.length >= 2 ? 'pass' : 'warning', details: `${files.length} صور — بدون منشن وبدون استهلاك للدورات${fallback ? ' — تم تجاوز معاينة الأذان لعدم وجود منطقة حقيقية ولم يتم إرسال عينة' : ''}` }];
            record(session, 'previews', checks, { type, fileCount: files.length, fallback });
            await interaction.editReply({ content: '🖼️ معاينات مخفية وآمنة: لا @everyone، لا إرسال حي، ولا استهلاك للدورات.', embeds: [checksEmbed('المعاينات الآمنة الشاملة', checks, fallback)], files });
            await logTest(interaction, 'Safe preview suite', `${files.length} images`);
            return;
        }
        if (id === 'test_cmd_voice_adhan') {
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('test_cmd_confirm_voice').setLabel('تأكيد تشغيل الأذان كاملاً').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('test_cmd_cancel_live').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
            );
            await interaction.reply({ content: '⚠️ هذا اختبار حي: سيوقف الصوت الحالي مؤقتاً، ويشغّل الأذان كاملاً في قناتك، ثم يعيد الصوت السابق. هل أنت متأكد؟', components: [row], flags: 64 });
            return;
        }
        if (id === 'test_cmd_confirm_voice') {
            await interaction.deferReply({ flags: 64 });
            const result = await testConfiguredAdhan(interaction.client, member);
            const failure = result.reason === 'adhan_in_progress'
                ? '\u{1F54C} \u0643\u0627\u064a\u0646 \u0623\u0630\u0627\u0646 \u062e\u062f\u0627\u0645 \u062f\u0627\u0628\u0627\u061b \u062a\u0633\u0646\u0649 \u062d\u062a\u0649 \u064a\u0633\u0627\u0644\u064a \u062b\u0645 \u0639\u0627\u0648\u062f \u0627\u0644\u062a\u062c\u0631\u0628\u0629.'
                : `\u274C \u062a\u0639\u0630\u0631 \u0627\u0644\u0627\u062e\u062a\u0628\u0627\u0631: ${result.reason}`;
            await interaction.editReply(result.played
                ? `\u2705 \u0627\u0646\u062a\u0647\u0649 \u0627\u0644\u0623\u0630\u0627\u0646 \u0643\u0627\u0645\u0644\u0627\u064b: **${result.file?.replace(/\.mp3$/i, '')}** \u0648\u062a\u0645 \u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0627\u0644\u0635\u0648\u062a \u0627\u0644\u0633\u0627\u0628\u0642.`
                : failure);            await logTest(interaction, 'Live full adhan test', result.played ? result.file : result.reason);
            return;
        }
        if (id === 'test_cmd_cancel_live') {
            await interaction.update({ content: 'تم إلغاء الاختبار الحي.', components: [] });
            return;
        }
        if (id === 'test_cmd_rebuild') {
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('test_cmd_confirm_rebuild').setLabel('تأكيد إعادة البناء').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('test_cmd_cancel_live').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
            );
            await interaction.reply({ content: '⚠️ التدقيق للعرض فقط. هذا الزر وحده سيعيد بناء ملفات `data/catalog/*.json`. تأكيد؟', components: [row], flags: 64 });
            return;
        }
        if (id === 'test_cmd_confirm_rebuild') {
            await interaction.deferReply({ flags: 64 });
            rebuildCatalogs();
            await interaction.editReply('✅ تمت إعادة بناء الفهارس بعد التأكيد الصريح.');
            await logTest(interaction, 'Catalog rebuilt after explicit confirmation');
            return;
        }
        if (id === 'test_cmd_summary') {
            await interaction.deferReply({ flags: 64 });
            const report = { generatedAt: new Date().toISOString(), guildId: session.guildId, startedAt: session.startedAt, statuses: session.statuses, checks: session.checks, failedLinks: session.failedLinks, data: session.data };
            const failures = session.checks.filter(check => check.status === 'fail').length;
            await interaction.editReply({ content: `📄 التقرير الكامل: **${session.checks.length}** فحص، **${failures}** مشكلة، **${session.failedLinks.length}** روابط فاشلة.`, files: [new AttachmentBuilder((globalThis as any).Buffer.from(JSON.stringify(report, null, 2), 'utf8'), { name: `rafiq-test-report-${Date.now()}.json` })] });
            await logTest(interaction, 'Full diagnostic report downloaded', `${session.checks.length} checks`);
        }
    } catch (error) {
        if (id === 'test_cmd_full_analysis') session.statuses.analysis = 'fail';
        logger.error(`[Test] ${id} failed:`, error);
        await sendAuditLog(interaction.client, interaction.guildId, { level: 'error', system: 'Test', action: `${id} failed`, actorId: interaction.user.id, details: error instanceof Error ? error.message : String(error) }).catch(() => {});
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `❌ فشل الاختبار: ${error instanceof Error ? error.message : String(error)}` }).catch(() => {});
        else await interaction.reply({ content: '❌ فشل الاختبار. راجع السجلات.', flags: 64 }).catch(() => {});
    }
}

