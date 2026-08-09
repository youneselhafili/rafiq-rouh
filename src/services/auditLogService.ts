import { AttachmentBuilder, ChannelType, Client, ColorResolvable, EmbedBuilder } from 'discord.js';
import { getAdvancedConfig, setAdvancedConfig } from './advancedConfigService';
import { logger } from '../utils/logger';

export type AuditLevel = 'success' | 'info' | 'warning' | 'error' | 'config';

export interface AuditEvent {
    at: string;
    level: AuditLevel;
    system: string;
    action: string;
    actorId?: string;
    details?: string;
}

export interface LogsConfig {
    enabled: boolean;
    channelId?: string;
    dmAlerts: boolean;
    eventCount: number;
    lastLogAt?: string;
    lastError?: string;
    buffer: AuditEvent[];
    droppedEvents: number;
}

const DEFAULT_CONFIG: LogsConfig = {
    enabled: false,
    dmAlerts: false,
    eventCount: 0,
    buffer: [],
    droppedEvents: 0,
};

const COLORS: Record<AuditLevel, ColorResolvable> = {
    success: 0x57f287,
    info: 0x3498db,
    warning: 0xfee75c,
    error: 0xed4245,
    config: 0x9b59b6,
};

const SYSTEM_LABELS: Record<string, string> = {
    Logs: '🗂️ نظام السجلات',
    'Test Log': '🧪 اختبار السجلات',
    Command: '⌨️ أوامر البوت',
    Interaction: '🖱️ التفاعل مع الواجهات',
    Adhan: '🕌 نظام الأذان',
    Adhkar: '📿 نظام الأذكار',
    Quran: '📖 القرآن والبث الصوتي',
    Salawat: '🌿 الصلاة على النبي ﷺ',
    Jumuah: '🌟 نظام يوم الجمعة',
    Test: '🧪 الفحص والتشخيص',
};

const LEVEL_LABELS: Record<AuditLevel, string> = {
    success: '✅ ناجح',
    info: 'ℹ️ معلومة',
    warning: '⚠️ تنبيه',
    error: '❌ خطأ',
    config: '⚙️ تغيير إعدادات',
};

const ACTION_LABELS: Record<string, string> = {
    'Permission and delivery test': 'تم اختبار صلاحيات قناة السجلات وإرسال رسالة تجريبية',
    'Logs channel changed': 'تم تغيير قناة السجلات',
    'Logs enabled/configured': 'تم تفعيل وإعداد نظام السجلات',
    'Logs disabled': 'تم إيقاف نظام السجلات',
    'Logs settings deleted': 'تم حذف إعدادات السجلات',
    'Logs channel unavailable': 'تعذر الوصول إلى قناة السجلات',
    'Failed to send log': 'فشل إرسال السجل إلى القناة',
    'Adhkar settings saved': 'تم حفظ إعدادات الأذكار',
    'Quran settings saved': 'تم حفظ إعدادات القرآن والبث الصوتي',
    'Adhan zone saved': 'تم حفظ منطقة الأذان',
    'Global adhan audio settings saved': 'تم حفظ إعدادات صوت الأذان العامة',
    'Adhan zone deleted': 'تم حذف منطقة الأذان',
    'Adhan zone paused': 'تم إيقاف منطقة الأذان مؤقتاً',
    'Adhan zone enabled': 'تم تفعيل منطقة الأذان',
    'Zone notification test': 'تم اختبار إشعار منطقة الأذان',
    'Configured audience role is missing': 'الـRole المحدد لجمهور الأذان غير موجود',
    'Audience changed to @everyone after 48 hours': 'تم اعتماد @everyone بعد غياب الـRole مدة 48 ساعة',
    'Voice adhan completed': 'اكتمل تشغيل الأذان الصوتي وعاد المصدر السابق',
    'Voice permissions missing': 'صلاحيات تشغيل الأذان الصوتي ناقصة',
    'Text channel unavailable': 'قناة إشعارات الأذان غير متاحة',
    'Notification permission failure': 'فشل إرسال إشعار الأذان بسبب الصلاحيات',
    '5-minute warning sent': 'تم إرسال تنبيه قبل الأذان بخمس دقائق',
    'Prayer event completed': 'اكتملت معالجة موعد الصلاة',
    'Prayer API failed': 'فشل جلب مواقيت الصلاة',
    'Random dhikr sent': 'تم إرسال ذكر عشوائي',
    'Weekly Friday dhikr sent': 'تم إرسال ذكر الجمعة الأسبوعي من قاعدة الـ52 ذكراً',
    'Dhikr send failed': 'فشل إرسال الذكر',
    'Primary adhan zone unavailable': 'منطقة الأذان المرجعية غير متاحة',
    'Salawat configuration deleted': 'تم حذف إعدادات الصلاة على النبي ﷺ',
    'Salawat settings saved': 'تم حفظ إعدادات الصلاة على النبي ﷺ',
    'Salawat reminder sent': 'تم إرسال تذكير الصلاة على النبي ﷺ',
    'Salawat reminder failed': 'فشل إرسال تذكير الصلاة على النبي ﷺ',
    'Requests completed; live stream resumed': 'اكتملت طلبات القرآن وعاد البث المباشر',
    'Friday Surat Al-Kahf sent': 'تم إرسال بطاقة الجمعة وبدء سورة الكهف',
    'Friday Surat Al-Kahf voice started': 'بدأ تشغيل سورة الكهف في القناة الصوتية',
    'Friday Surat Al-Kahf completed': 'اكتمل تشغيل سورة الكهف وعاد المصدر السابق',
    'Friday system failed': 'تعذر تنفيذ نظام يوم الجمعة',
    'Jumuah settings saved': 'تم حفظ إعدادات يوم الجمعة',
    'Jumuah configuration deleted': 'تم حذف إعدادات يوم الجمعة',
    'Controller assigned': 'تم تعيين متحكم جديد في لوحة القرآن',
    'Quick Quran link audit': 'اكتمل الفحص السريع لروابط القرآن',
    'Full Quran link audit started': 'بدأ الفحص الكامل لروابط القرآن',
    'Full Quran link audit completed': 'اكتمل الفحص الكامل لروابط القرآن',
    'Failed links retried': 'تمت إعادة فحص الروابط الفاشلة',
    'Permission audit': 'اكتمل فحص صلاحيات البوت',
    'Prayer API audit': 'اكتمل فحص مصادر مواقيت الصلاة',
    'Content and database audit': 'اكتمل فحص الملفات وقاعدة البيانات',
    'Scheduler dry-run': 'اكتملت محاكاة نظام الجدولة',
    'Safe preview suite': 'تم إنشاء المعاينات الآمنة',
    'Live full adhan test': 'اكتمل اختبار الأذان الصوتي الكامل',
    'Catalog rebuilt after explicit confirmation': 'تمت إعادة بناء فهارس المحتوى بعد التأكيد',
    'Full diagnostic report downloaded': 'تم تنزيل تقرير التشخيص الكامل',
};

const COMMAND_LABELS: Record<string, string> = {
    adhan_zones: 'إدارة مناطق الأذان',
    setup_adhan: 'إعداد نظام الأذان',
    setup_adhkar: 'إعداد نظام الأذكار',
    setup_logs: 'إعداد نظام السجلات',
    setup_jumuah: 'إعداد نظام يوم الجمعة وسورة الكهف',
    setup_quran: 'إعداد القرآن والبث الصوتي',
    setup_salawat: 'إعداد الصلاة على النبي ﷺ',
    test: 'فتح لوحة الفحص والتشخيص',
};

const COMPONENT_LABELS: Record<string, string> = {
    qr_btn_quran_kareem: 'تشغيل القرآن الكريم 24/24',
    qr_btn_audio_library: 'فتح المكتبة الصوتية',
    qr_select_reciter: 'اختيار قارئ',
    qr_select_surah: 'اختيار سورة',
    qr_mode_ordered: 'التشغيل بالترتيب',
    qr_mode_random: 'التشغيل العشوائي',
    qr_mode_manual: 'اختيار سورة يدوياً',
    qr_btn_toggle_pause: 'إيقاف أو استئناف الصوت',
    qr_btn_next: 'الانتقال إلى السورة التالية',
    qr_btn_prev: 'الرجوع إلى السورة السابقة',
    qr_btn_stop: 'إيقاف التشغيل',
    qr_playlist: 'فتح قائمة التشغيل المحفوظة',
    qr_playlist_combine: 'جمع اختيارات السور في قائمة تشغيل واحدة',
    qr_playlist_reset: 'مسح اختيارات السور والبدء من جديد',
    qr_play_now_discard: 'تشغيل السورة الآن وإلغاء الحالية',
    qr_play_now_return: 'تشغيل السورة ثم الرجوع للحالية',
    qr_add_next: 'إضافة السورة بعد الحالية',
    jumuah_setup_time: 'تعديل موعد نظام الجمعة',
    jumuah_setup_preview: 'معاينة بطاقة سورة الكهف',
    jumuah_setup_toggle: 'تبديل تفعيل نظام الجمعة',
    jumuah_setup_voice: 'تبديل تشغيل سورة الكهف صوتياً',
    jumuah_setup_mention: 'تبديل منشن @everyone في الجمعة',
    jumuah_setup_save: 'حفظ إعدادات نظام الجمعة',
    jumuah_setup_delete: 'طلب حذف إعدادات نظام الجمعة',
    logs_setup_save: 'حفظ إعدادات السجلات',
    logs_setup_test: 'اختبار قناة السجلات',
    logs_setup_toggle: 'تبديل تفعيل نظام السجلات',
    logs_setup_dm: 'تبديل تنبيهات الأخطاء في الخاص',
    logs_setup_channel: 'اختيار قناة السجلات',
    logs_setup_channel_id: 'إدخال معرّف قناة السجلات',
    logs_setup_delete: 'طلب حذف إعدادات السجلات',
    logs_setup_delete_confirm: 'تأكيد حذف إعدادات السجلات',
    test_cmd_full_analysis: 'بدء التحليل الشامل',
    test_cmd_voice_health: 'فحص الاتصال والتشغيل الصوتي',
    test_cmd_quick_links: 'الفحص السريع لروابط القرآن',
    test_cmd_full_links: 'الفحص الكامل لروابط القرآن',
    test_cmd_permissions: 'فحص صلاحيات البوت',
    test_cmd_prayer_apis: 'فحص مصادر مواقيت الصلاة',
    test_cmd_content: 'فحص الملفات وقاعدة البيانات',
    test_cmd_schedulers: 'محاكاة نظام الجدولة',
    test_cmd_previews: 'إنشاء معاينات آمنة',
    test_cmd_voice_adhan: 'اختبار الأذان الصوتي',
    test_cmd_summary: 'تنزيل تقرير التشخيص',
};

function componentLabel(customId: string): string {
    const exact = COMPONENT_LABELS[customId];
    if (exact) return exact;
    const system = customId.startsWith('adhan_') || customId.startsWith('myzone_') ? 'الأذان'
        : customId.startsWith('adhkar_') ? 'الأذكار'
            : customId.startsWith('quran_') || customId.startsWith('qr_') ? 'القرآن'
                : customId.startsWith('salawat_') ? 'الصلاة على النبي ﷺ'
                    : customId.startsWith('logs_') ? 'السجلات'
                        : customId.startsWith('test_') ? 'الفحص والتشخيص' : 'البوت';
    if (customId.includes('confirm_delete') || customId.includes('delete_confirm')) return `تأكيد الحذف — ${system}`;
    if (customId.includes('cancel_delete') || customId.includes('delete_cancel')) return `إلغاء الحذف — ${system}`;
    if (customId.includes('delete')) return `حذف الإعدادات — ${system}`;
    if (customId.includes('save')) return `حفظ الإعدادات — ${system}`;
    if (customId.includes('preview')) return `معاينة المحتوى — ${system}`;
    if (customId.includes('test')) return `تشغيل اختبار — ${system}`;
    if (customId.includes('channel')) return `اختيار القناة — ${system}`;
    if (customId.includes('role')) return `اختيار الـRole — ${system}`;
    if (customId.includes('toggle') || customId.includes('enable') || customId.includes('pause')) return `تغيير حالة التفعيل — ${system}`;
    if (customId.includes('cancel') || customId.includes('back')) return `إلغاء أو رجوع — ${system}`;
    if (customId.includes('select')) return `اختيار عنصر — ${system}`;
    return `استعمال خيار من واجهة ${system}`;
}

function localizeAction(action: string): string {
    if (ACTION_LABELS[action]) return ACTION_LABELS[action];
    if (action.startsWith('/')) {
        const command = action.slice(1);
        return `تم استعمال أمر /${command} — ${COMMAND_LABELS[command] || 'أمر من أوامر البوت'}`;
    }
    if (action.startsWith('Modal ')) return `تم إرسال نموذج: ${componentLabel(action.slice(6))}`;
    const playback = action.match(/^Playback started:\s*(.+)$/i);
    if (playback) return `بدأ تشغيل القرآن — النظام: ${playback[1]}`;
    const failedInteraction = action.match(/^([a-z0-9_]+) failed$/i);
    if (failedInteraction) return `فشل تنفيذ: ${componentLabel(failedInteraction[1])}`;
    if (/^[a-z0-9_]+$/i.test(action)) return `تم اختيار: ${componentLabel(action)}`;
    return action;
}

function localizeDetails(details?: string): string {
    if (!details) return 'لم تُرفق تفاصيل إضافية لهذا الحدث.';
    return details
        .replace(/DM Alerts:\s*ON/gi, 'تنبيهات الأخطاء في الخاص: مفعّلة')
        .replace(/DM Alerts:\s*OFF/gi, 'تنبيهات الأخطاء في الخاص: غير مفعّلة')
        .replace(/hidden preview without mention/gi, 'معاينة مخفية بدون منشن')
        .replace(/image\(s\)/gi, 'صورة')
        .replace(/still failing/gi, 'ما زالت فاشلة')
        .replace(/targets/gi, 'عناصر تم فحصها')
        .replace(/zones/gi, 'مناطق')
        .replace(/checks/gi, 'فحوصات');
}

function isLogsChannel(channel: any): channel is { send: (payload: any) => Promise<any> } {
    return !!channel
        && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
        && channel.isTextBased?.()
        && typeof channel.send === 'function';
}

export async function getLogsConfig(guildId: string): Promise<LogsConfig> {
    const stored = await getAdvancedConfig<Partial<LogsConfig>>(guildId, 'logsConfig');
    return { ...DEFAULT_CONFIG, ...stored, buffer: stored?.buffer || [] };
}

export async function saveLogsConfig(guildId: string, config: LogsConfig): Promise<void> {
    await setAdvancedConfig(guildId, 'logsConfig', config);
}

export function buildAuditEmbed(event: AuditEvent): EmbedBuilder {
    const icon = event.level === 'error' ? '❌' : event.level === 'warning' ? '⚠️' : event.level === 'success' ? '✅' : event.level === 'config' ? '⚙️' : '📋';
    const action = localizeAction(event.action);
    const system = SYSTEM_LABELS[event.system] || `🧩 ${event.system}`;
    const details = localizeDetails(event.details);
    const unixTime = Math.floor(new Date(event.at).getTime() / 1000);
    const embed = new EmbedBuilder()
        .setColor(COLORS[event.level])
        .setTitle(`${icon} ${action}`.slice(0, 256))
        .setDescription(`**شنو وقع؟**\n${details}`.slice(0, 4096))
        .addFields(
            { name: '🧩 النظام', value: system, inline: true },
            { name: '📊 الحالة', value: LEVEL_LABELS[event.level], inline: true },
            { name: '👤 المنفذ', value: event.actorId ? `<@${event.actorId}>` : '🤖 النظام تلقائياً', inline: true },
            { name: '🕐 التوقيت', value: `<t:${unixTime}:F>\n<t:${unixTime}:R>`, inline: false },
        )
        .setTimestamp(new Date(event.at));
    if (/^[a-z0-9_:/.-]+$/i.test(event.action)) {
        embed.setFooter({ text: `المعرّف التقني للحدث: ${event.action}`.slice(0, 2048) });
    }
    return embed;
}

async function notifyOwner(client: Client, guildId: string, event: AuditEvent, config: LogsConfig): Promise<void> {
    if (!config.dmAlerts || event.level !== 'error') return;
    try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        const owner = await guild.fetchOwner();
        await owner.send({ embeds: [buildAuditEmbed(event).setTitle(`🚨 ${guild.name} — ${localizeAction(event.action)}`.slice(0, 256))] });
    } catch (error) {
        logger.warn(`Could not DM owner of guild ${guildId}: ${String(error)}`);
    }
}

async function bufferEvent(guildId: string, config: LogsConfig, event: AuditEvent): Promise<void> {
    config.buffer.push(event);
    if (config.buffer.length > 1000) {
        const overflow = config.buffer.length - 1000;
        config.buffer.splice(0, overflow);
        config.droppedEvents += overflow;
    }
    config.lastError = 'Logs channel unavailable';
    await saveLogsConfig(guildId, config);
}

export async function sendAuditLog(client: Client, guildId: string, input: Omit<AuditEvent, 'at'>): Promise<boolean> {
    const event: AuditEvent = { ...input, at: new Date().toISOString() };
    const config = await getLogsConfig(guildId);
    if (!config.enabled || !config.channelId) return false;
    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!isLogsChannel(channel)) {
        await bufferEvent(guildId, config, event);
        await notifyOwner(client, guildId, { ...event, level: 'error', action: 'Logs channel unavailable' }, config);
        return false;
    }
    try {
        if (config.buffer.length > 0) {
            const report = JSON.stringify({ droppedEvents: config.droppedEvents, events: config.buffer }, null, 2);
            await channel.send({
                content: `📦 تمت استعادة **${config.buffer.length}** حدث مؤقت${config.droppedEvents ? ` (فُقد ${config.droppedEvents} حدث قديم)` : ''}.`,
                files: [new AttachmentBuilder((globalThis as any).Buffer.from(report, 'utf-8'), { name: 'buffered-logs.json' })],
            });
            config.buffer = [];
            config.droppedEvents = 0;
        }
        await channel.send({ embeds: [buildAuditEmbed(event)] });
        config.eventCount += 1;
        config.lastLogAt = event.at;
        config.lastError = undefined;
        await saveLogsConfig(guildId, config);
        await notifyOwner(client, guildId, event, config);
        return true;
    } catch (error) {
        logger.error(`Failed to send audit log for guild ${guildId}:`, error);
        await bufferEvent(guildId, config, event);
        await notifyOwner(client, guildId, { ...event, level: 'error', action: 'Failed to send log' }, config);
        return false;
    }
}

export async function sendDirectAuditLog(client: Client, channelId: string, input: Omit<AuditEvent, 'at'>): Promise<boolean> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!isLogsChannel(channel)) return false;
    try {
        await channel.send({ embeds: [buildAuditEmbed({ ...input, at: new Date().toISOString() })] });
        return true;
    } catch {
        return false;
    }
}



