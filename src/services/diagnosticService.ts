import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import moment from 'moment-timezone';
import { Client, PermissionFlagsBits } from 'discord.js';
import { getVoiceConnection, VoiceConnectionStatus } from '@discordjs/voice';
// LIVE_MADINA_URL and LIVE_MAKKAH_URL removed
import { getAllRadios, getAllReciters } from '../quran/quranRegistry';
import { getQuranRadioConfig } from './guildService';
import { getManagedAdhanZones } from './adhanZoneService';
import { fetchPrayerTimes, fetchZonePrayerSchedule, getNextPrayerForZone } from './adhanService';
import { getAdhkarV2Config } from './adhkarConfigServiceV2';
import { getSalawatV2Config } from './salawatConfigServiceV2';
import { getJumuahV2Config } from './jumuahConfigServiceV2';
import { nextJumuahRun } from './jumuahService';
import { getLogsConfig } from './auditLogService';
import { loadSalawatTexts } from './salawatService';
import { listAdhanAudioFiles } from './adhanAudioService';
import { getVoicePlaybackHealth } from './voicePlaybackService';
import { getAdhkarByKey } from './contentService';

export type DiagnosticStatus = 'pass' | 'warning' | 'fail' | 'running' | 'pending';

export interface DiagnosticCheck {
    name: string;
    status: DiagnosticStatus;
    details: string;
    durationMs?: number;
}

export interface LinkTarget {
    id: string;
    label: string;
    url: string;
}

export interface LinkAuditResult {
    total: number;
    passed: number;
    failed: number;
    durationMs: number;
    failures: Array<LinkTarget & { error: string }>;
}

function walk(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    const entries = fs.readdirSync(directory, { withFileTypes: true } as any) as any[];
    return entries.flatMap(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}

export function quickQuranTargets(): LinkTarget[] {
    const targets: LinkTarget[] = [];
    for (const radio of getAllRadios()) targets.push({ id: `radio:${radio.id}`, label: radio.name, url: radio.streamUrl });
    for (const reciter of getAllReciters()) {
        const first = reciter.surahs[0];
        if (first) targets.push({ id: `reciter:${reciter.id}:1`, label: `${reciter.name} — ${first.name}`, url: first.url });
    }
    return targets;
}

export function fullQuranTargets(): LinkTarget[] {
    const targets = quickQuranTargets().filter(target => target.id.startsWith('live_') || target.id.startsWith('radio:'));
    for (const reciter of getAllReciters()) reciter.surahs.forEach((surah, index) => targets.push({ id: `reciter:${reciter.id}:${index + 1}`, label: `${reciter.name} — ${surah.name}`, url: surah.url }));
    return targets;
}

async function checkLink(target: LinkTarget): Promise<(LinkTarget & { error?: string })> {
    if (!/^https?:\/\//i.test(target.url)) return { ...target, error: 'invalid_url' };
    try {
        const response = await axios.get(target.url, {
            responseType: 'stream', timeout: 15_000, maxRedirects: 5,
            headers: { Range: 'bytes=0-1023', 'User-Agent': 'Rafiq-Al-Rouh-Diagnostics/1.0' },
            validateStatus: status => status >= 200 && status < 400,
        });
        response.data?.destroy?.();
        return target;
    } catch (error: any) {
        return { ...target, error: error?.response?.status ? `HTTP ${error.response.status}` : error?.code || error?.message || 'request_failed' };
    }
}

export async function auditQuranLinks(targets: LinkTarget[], concurrency = 12): Promise<LinkAuditResult> {
    const started = Date.now();
    const results: Array<LinkTarget & { error?: string }> = new Array(targets.length);
    let cursor = 0;
    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= targets.length) return;
            results[index] = await checkLink(targets[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, worker));
    const failures = results.filter(item => item.error).map(item => ({ ...item, error: item.error! }));
    return { total: targets.length, passed: targets.length - failures.length, failed: failures.length, failures, durationMs: Date.now() - started };
}

function duplicateValues(values: string[]): string[] {
    const counts = new Map<string, number>();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

export async function auditContentAndDatabase(): Promise<{ checks: DiagnosticCheck[]; details: Record<string, any> }> {
    const started = Date.now();
    const rawRoot = path.join(process.cwd(), 'data', 'raw');
    const files = walk(rawRoot);
    const textFiles = files.filter(file => file.toLowerCase().endsWith('.txt'));
    const invalidUtf8: string[] = [];
    const Decoder = require('util').TextDecoder;
    for (const file of textFiles) {
        try { new Decoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)); } catch { invalidUtf8.push(path.relative(rawRoot, file)); }
    }
    const rawAdhkarFiles = textFiles.filter(file => file.includes(path.sep + 'أدعية و أذكار' + path.sep));
    const rawAdhkarCount = rawAdhkarFiles.length;
    const adhkarFormatIssues: string[] = [];
    let rawAdhkarItems = 0;
    for (const file of rawAdhkarFiles) {
        const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
        const numbers = lines.map(line => line.trim().match(/^(\d+)\.$/)).filter(Boolean).map(match => Number(match![1]));
        const textFields = lines.filter(line => /^النص\s*:/.test(line.trim())).length;
        rawAdhkarItems += numbers.length;
        const sequential = numbers.length > 0 && numbers.every((number, index) => number === index + 1);
        if (!sequential || textFields !== numbers.length) {
            adhkarFormatIssues.push(`${path.basename(file)}: الأرقام=${numbers.length}، النصوص=${textFields}`);
        }
    }
    const rawReciterCount = textFiles.filter(file => file.includes(path.sep + 'القراء المفضلون' + path.sep) || file.includes(path.sep + 'المكتبة الصوتية' + path.sep)).length;
    const rawRadioCount = textFiles.filter(file => file.includes(path.sep + 'القنوات' + path.sep)).length;
    const reciters = getAllReciters();
    const radios = getAllRadios();
    const allUrls = reciters.flatMap(reciter => reciter.surahs.map(surah => surah.url)).concat(radios.map(radio => radio.streamUrl));
    const duplicateUrls = duplicateValues(allUrls);
    const emptyUrls = allUrls.filter(url => !url.trim()).length;
    const badReciterCounts = reciters.filter(reciter => reciter.category === 'favorite' && reciter.surahs.length !== 114).map(reciter => `${reciter.name}:${reciter.surahs.length}`);
    const duplicateReciterIds = duplicateValues(reciters.map(reciter => reciter.id));
    const duplicateRadioIds = duplicateValues(radios.map(radio => radio.id));
    const salawat = loadSalawatTexts();
    const adhanFiles = listAdhanAudioFiles(true);
    const catalogDir = path.join(process.cwd(), 'data', 'catalog');
    const catalogFiles = ['adhkar.json', 'reciters.json', 'radios.json'].filter(file => fs.existsSync(path.join(catalogDir, file)));
    let catalogSummary: Record<string, number> = {};
    try {
        const adhkar = JSON.parse(fs.readFileSync(path.join(catalogDir, 'adhkar.json'), 'utf8'));
        const oldReciters = JSON.parse(fs.readFileSync(path.join(catalogDir, 'reciters.json'), 'utf8'));
        const oldRadios = JSON.parse(fs.readFileSync(path.join(catalogDir, 'radios.json'), 'utf8'));
        catalogSummary = { adhkarCategories: adhkar.categories?.length || 0, adhkarItems: adhkar.categories?.reduce((sum: number, item: any) => sum + (item.items?.length || 0), 0) || 0, catalogReciters: oldReciters.reciters?.length || 0, catalogRadios: oldRadios.radios?.length || 0 };
    } catch {}
    const details = {
        rawFiles: files.length, textFiles: textFiles.length, invalidUtf8, rawAdhkarCount, rawAdhkarItems, adhkarFormatIssues, rawReciterCount, rawRadioCount,
        reciters: reciters.length, reciterSurahs: reciters.reduce((sum, reciter) => sum + reciter.surahs.length, 0), badReciterCounts,
        radios: radios.length, emptyUrls, duplicateUrls: duplicateUrls.length, duplicateReciterIds, duplicateRadioIds,
        salawatCount: salawat.length, adhanFiles, catalogFiles, catalogSummary,
    };
    const checks: DiagnosticCheck[] = [
        { name: 'ترميز ملفات المصدر', status: invalidUtf8.length ? 'fail' : 'pass', details: invalidUtf8.length ? `${invalidUtf8.length} ملف غير صالح: ${invalidUtf8.join('، ')}` : `${textFiles.length} ملفاً نصياً بترميز UTF-8 سليم.` },
        { name: 'تنسيق قاعدة الأدعية والأذكار', status: adhkarFormatIssues.length ? 'fail' : 'pass', details: adhkarFormatIssues.length ? adhkarFormatIssues.join('، ') : `${rawAdhkarCount} ملفاً و${rawAdhkarItems} عنصراً؛ الأرقام متسلسلة ولكل عنصر حقل نص.` },
        { name: 'فهرس القراء والسور', status: badReciterCounts.length || reciters.length !== 10 ? 'fail' : 'pass', details: `${reciters.length} قراء و${details.reciterSurahs} سورة مسجلة.` },
        { name: 'الروابط الناقصة أو المكررة', status: emptyUrls ? 'fail' : duplicateUrls.length ? 'warning' : 'pass', details: `الروابط الفارغة=${emptyUrls}، الروابط المكررة=${duplicateUrls.length}.` },
        { name: 'المعرفات المكررة', status: duplicateReciterIds.length || duplicateRadioIds.length ? 'fail' : 'pass', details: `معرفات القراء المكررة=${duplicateReciterIds.length}، معرفات الإذاعات المكررة=${duplicateRadioIds.length}.` },
        { name: 'ملف صيغ الصلاة على النبي', status: salawat.length === 5 ? 'pass' : 'warning', details: `${salawat.length} صيغ متوفرة.` },
        { name: 'ملفات الأذان المحلية', status: adhanFiles.length === 14 && adhanFiles.some(file => file.startsWith('أذان الفجر')) ? 'pass' : 'fail', details: `${adhanFiles.length} ملف MP3.` },
        { name: 'توفر ملفات الفهارس', status: catalogFiles.length === 3 ? 'pass' : 'fail', details: `${catalogFiles.length} من 3 فهارس متوفرة — ${JSON.stringify(catalogSummary)}` },
        { name: 'تطابق المصدر والسجل والفهارس', status: rawReciterCount === reciters.length && rawRadioCount === radios.length && rawAdhkarCount === (catalogSummary.adhkarCategories || 0) && reciters.length === (catalogSummary.catalogReciters || 0) && radios.length === (catalogSummary.catalogRadios || 0) ? 'pass' : 'fail', details: 'المصدر (أذكار/قراء/إذاعات)=' + rawAdhkarCount + '/' + rawReciterCount + '/' + rawRadioCount + '؛ السجل=' + reciters.length + '/' + radios.length + '؛ الفهارس=' + (catalogSummary.adhkarCategories || 0) + '/' + (catalogSummary.catalogReciters || 0) + '/' + (catalogSummary.catalogRadios || 0) },
    ];
    checks.forEach(check => check.durationMs = Date.now() - started);
    return { checks, details };
}

export async function auditGuildPermissions(client: Client, guildId: string): Promise<{ checks: DiagnosticCheck[]; usedFallback: boolean }> {
    const guild = client.guilds.cache.get(guildId)!;
    const me = guild.members.me;
    const targets = new Map<string, { label: string; voice: boolean }>();
    const quran = await getQuranRadioConfig(guildId);
    if (quran?.voiceChannelId) targets.set(quran.voiceChannelId, { label: 'القرآن: الصوت والدردشة', voice: true });
    for (const zone of await getManagedAdhanZones(guildId)) targets.set(zone.channelId, { label: `الأذان: ${zone.city}`, voice: false });
    const adhkar = await getAdhkarV2Config(guildId);
    if (adhkar?.generalChannelId) targets.set(adhkar.generalChannelId, { label: 'قناة الأذكار العامة', voice: false });
    const salawat = await getSalawatV2Config(guildId);
    const jumuah = await getJumuahV2Config(guildId);
    const kahfReciters = getAllReciters().filter(reciter => reciter.surahs[17]?.url);
    if (salawat?.channelId) targets.set(salawat.channelId, { label: 'الصلاة على النبي', voice: false });
    const logs = await getLogsConfig(guildId);
    if (logs.channelId) targets.set(logs.channelId, { label: 'سجلات البوت', voice: false });
    let usedFallback = false;
    if (!targets.size) {
        const fallback = guild.channels.cache.find(channel => channel.isTextBased());
        if (fallback) { targets.set(fallback.id, { label: 'قناة عينة بديلة', voice: false }); usedFallback = true; }
    }
    const checks: DiagnosticCheck[] = [];
    for (const [channelId, meta] of targets) {
        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('permissionsFor' in channel) || !me) {
            checks.push({ name: meta.label, status: 'fail', details: `تعذر الوصول إلى <#${channelId}>.` });
            continue;
        }
        const perms = channel.permissionsFor(me);
        const required: Array<[string, bigint]> = [
            ['رؤية القناة', PermissionFlagsBits.ViewChannel], ['إرسال الرسائل ودردشة الصوت', PermissionFlagsBits.SendMessages],
            ['تضمين الروابط', PermissionFlagsBits.EmbedLinks], ['إرفاق الملفات', PermissionFlagsBits.AttachFiles],
            ['منشن الجميع', PermissionFlagsBits.MentionEveryone],
        ];
        if (meta.voice) {
            required.push(
                ['الاتصال', PermissionFlagsBits.Connect], ['التحدث', PermissionFlagsBits.Speak],
                ['استخدام نشاط الصوت', PermissionFlagsBits.UseVAD], ['تعيين حالة القناة الصوتية', PermissionFlagsBits.SetVoiceChannelStatus],
            );
        }
        const missing = required.filter(([, permission]) => !perms?.has(permission)).map(([name]) => name);
        checks.push({
            name: meta.label,
            status: missing.length ? 'fail' : 'pass',
            details: `<#${channelId}> — ${missing.length ? `الصلاحيات الناقصة: ${missing.join('، ')}` : `سليم: ${required.map(([name]) => name).join('، ')}`}`,
        });
    }
    return { checks, usedFallback };
}
export async function auditVoiceSystem(client: Client, guildId: string): Promise<{ checks: DiagnosticCheck[]; details: Record<string, any> }> {
    const checks: DiagnosticCheck[] = [];
    const guild = client.guilds.cache.get(guildId);
    const config = await getQuranRadioConfig(guildId);
    if (!guild || !config?.voiceChannelId) {
        checks.push({ name: 'إعداد القناة الصوتية', status: 'warning', details: 'لم يتم إعداد قناة القرآن الصوتية.' });
        return { checks, details: { configured: false } };
    }
    const channel = guild.channels.cache.get(config.voiceChannelId) || await guild.channels.fetch(config.voiceChannelId).catch(() => null);
    const me = guild.members.me;
    if (!channel?.isVoiceBased() || !me) {
        checks.push({ name: 'إعداد القناة الصوتية', status: 'fail', details: `تعذر الوصول إلى <#${config.voiceChannelId}> أو إلى عضو البوت.` });
        return { checks, details: { configured: true, channelFound: false } };
    }
    const permissions = channel.permissionsFor(me);
    const missingVoice: string[] = [];
    if (!permissions?.has(PermissionFlagsBits.Connect)) missingVoice.push('الاتصال');
    if (!permissions?.has(PermissionFlagsBits.Speak)) missingVoice.push('التحدث');
    if (!permissions?.has(PermissionFlagsBits.UseVAD)) missingVoice.push('استخدام نشاط الصوت');
    checks.push({
        name: 'صلاحيات الصوت',
        status: missingVoice.length ? 'fail' : 'pass',
        details: missingVoice.length ? `الصلاحيات الناقصة في <#${channel.id}>: ${missingVoice.join('، ')}` : `صلاحيات الاتصال والتحدث سليمة في <#${channel.id}>.`,
    });
    const missingPanel: string[] = [];
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) missingPanel.push('رؤية القناة');
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) missingPanel.push('إرسال الرسائل');
    if (!permissions?.has(PermissionFlagsBits.EmbedLinks)) missingPanel.push('تضمين الروابط');
    checks.push({
        name: 'لوحة التحكم في دردشة القناة الصوتية',
        status: missingPanel.length ? 'fail' : 'pass',
        details: missingPanel.length ? `الصلاحيات الناقصة: ${missingPanel.join('، ')}` : 'البوت قادر على عرض وتحديث لوحة التحكم.',
    });
    const canSetStatus = Boolean(permissions?.has(PermissionFlagsBits.SetVoiceChannelStatus));
    checks.push({
        name: 'حالة القناة الصوتية',
        status: canSetStatus ? 'pass' : 'fail',
        details: canSetStatus ? 'صلاحية تعيين حالة القناة الصوتية متوفرة.' : 'الصلاحية الناقصة: Set Voice Channel Status.',
    });
    const voice = me.voice;
    const muted = Boolean(voice.selfMute || voice.serverMute || voice.suppress);
    checks.push({
        name: 'حالة كتم البوت',
        status: muted ? 'fail' : voice.selfDeaf || voice.serverDeaf ? 'warning' : 'pass',
        details: `كتم ذاتي=${voice.selfMute}، كتم من السيرفر=${voice.serverMute}، صامت في Stage=${voice.suppress}، صمم ذاتي=${voice.selfDeaf}، صمم من السيرفر=${voice.serverDeaf}.`,
    });
    const connection = getVoiceConnection(guildId);
    const health = getVoicePlaybackHealth(guildId);
    const ready = connection?.state.status === VoiceConnectionStatus.Ready;
    checks.push({
        name: 'اتصال Discord الصوتي',
        status: ready ? 'pass' : 'fail',
        details: ready ? `الاتصال جاهز في <#${channel.id}>.` : `حالة الاتصال: ${connection?.state.status || 'غير متصل'}.`,
    });
    checks.push({
        name: 'مشغل الصوت الحالي',
        status: health.active && health.playerStatus === 'playing' ? 'pass' : health.active ? 'warning' : 'fail',
        details: health.active ? `المصدر=${health.label || health.kind}، المشغل=${health.playerStatus}، الحالة=${health.statusText || 'لم تُضبط بعد'}.` : 'لا توجد جلسة تشغيل صوتي نشطة.',
    });
    return {
        checks,
        details: {
            configured: true,
            channelId: channel.id,
            voiceState: {
                channelId: voice.channelId, selfMute: voice.selfMute, selfDeaf: voice.selfDeaf,
                serverMute: voice.serverMute, serverDeaf: voice.serverDeaf, suppress: voice.suppress,
            },
            playback: health,
            connectionStatus: connection?.state.status || null,
            permissions: { missingVoice, missingPanel, canSetStatus },
        },
    };
}
export async function auditPrayerApis(guildId: string): Promise<{ checks: DiagnosticCheck[]; usedFallback: boolean; details: any[] }> {
    const zones = (await getManagedAdhanZones(guildId)).filter(zone => zone.enabled);
    const checks: DiagnosticCheck[] = [];
    const details: any[] = [];
    let usedFallback = false;
    if (!zones.length) {
        usedFallback = true;
        const started = Date.now();
        const sample = await fetchPrayerTimes('Mecca', 'Saudi Arabia');
        const duration = Date.now() - started;
        checks.push({ name: 'عينة بديلة: مكة، السعودية', status: sample ? 'pass' : 'fail', details: `عينة بديلة من Aladhan — ${duration} مللي ثانية.`, durationMs: duration });
        return { checks, usedFallback, details };
    }
    for (const zone of zones) {
        const started = Date.now();
        const schedule = await fetchZonePrayerSchedule(zone);
        const next = schedule ? await getNextPrayerForZone(zone) : null;
        const validTimezone = Boolean(moment.tz.zone(zone.timezone));
        const duration = Date.now() - started;
        checks.push({
            name: `${zone.city}، ${zone.country}`,
            status: schedule && validTimezone ? 'pass' : 'fail',
            details: `${schedule ? `${schedule.source}${schedule.fallbackUsed ? ' (مصدر بديل)' : ''}` : 'فشل مصدر المواقيت'} — المنطقة الزمنية ${validTimezone ? 'صالحة' : 'غير صالحة'} — ${duration} مللي ثانية — القادم: ${next ? `${next.arabicName} ${next.time}` : 'لا توجد صلاة متبقية اليوم'}`,
            durationMs: duration,
        });
        details.push({ zone, source: schedule?.source, fallbackUsed: schedule?.fallbackUsed, next, durationMs: duration });
    }
    return { checks, usedFallback, details };
}
export async function schedulerDryRun(guildId: string): Promise<DiagnosticCheck[]> {
    const zones = (await getManagedAdhanZones(guildId)).filter(zone => zone.enabled);
    const adhkar = await getAdhkarV2Config(guildId);
    const salawat = await getSalawatV2Config(guildId);
    const jumuah = await getJumuahV2Config(guildId);
    const fridayAdhkarCount = getAdhkarByKey('أذكار يوم الجمعة').filter(item => item.text.trim() !== 'أذكار يوم الجمعة').length;
    const kahfReciters = getAllReciters().filter(reciter => reciter.surahs[17]?.url);
    const checks: DiagnosticCheck[] = [];
    if (zones.length) {
        const next = await getNextPrayerForZone(zones[0]);
        checks.push({ name: 'محاكاة جدولة الأذان', status: next ? 'pass' : 'warning', details: next ? `${zones[0].city}: ${next.arabicName} في ${next.time}` : 'لا توجد صلاة متبقية اليوم؛ لم يتم تنفيذ أي إرسال.' });
    } else checks.push({ name: 'محاكاة جدولة الأذان', status: 'warning', details: 'لا توجد منطقة أذان معدة.' });
    checks.push({
        name: 'محاكاة استدراك الأذكار', status: adhkar ? 'pass' : 'warning',
        details: adhkar ? `الأذكار الأساسية حتى ساعتين، وأذكار الصلاة والوضوء حتى 15 دقيقة، والفواصل داخل الفترة الحالية فقط — ${Object.values(adhkar.categories).filter(value => value === 'enabled').length} أقسام مفعلة.` : 'نظام الأذكار غير معد.',
    });
    checks.push({
        name: 'محاكاة استدراك الصلاة على النبي', status: salawat ? 'pass' : 'warning',
        details: salawat ? `استدراك واحد كحد أقصى — الموعد القادم: ${salawat.nextRunAt || 'غير محسوب'}` : 'نظام الصلاة على النبي غير معد.',
    });
    checks.push({
        name: '\u0642\u0627\u0639\u062f\u0629 \u0623\u0630\u0643\u0627\u0631 \u064a\u0648\u0645 \u0627\u0644\u062c\u0645\u0639\u0629',
        status: fridayAdhkarCount === 52 ? 'pass' : 'fail',
        details: `${fridayAdhkarCount} \u0630\u0643\u0631\u0627\u064b \u0648\u062f\u0639\u0627\u0621\u064b \u2014 \u064a\u0631\u0633\u0644 \u0630\u0643\u0631 \u0648\u0627\u062d\u062f \u0628\u0639\u062f \u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0635\u0628\u0627\u062d \u064a\u0648\u0645 \u0627\u0644\u062c\u0645\u0639\u0629 \u0641\u0642\u0637\u060c \u0628\u0644\u0627 \u062a\u0643\u0631\u0627\u0631 \u062d\u062a\u0649 \u062a\u0643\u062a\u0645\u0644 \u0627\u0644\u062f\u0648\u0631\u0629.`,
    });    checks.push({
        name: '\u0645\u062d\u0627\u0643\u0627\u0629 \u0646\u0638\u0627\u0645 \u0627\u0644\u062c\u0645\u0639\u0629 \u0648\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641',
        status: jumuah?.enabled && !jumuah.deleted && kahfReciters.length > 0 ? 'pass' : 'warning',
        details: jumuah?.enabled && !jumuah.deleted
            ? `\u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629: ${nextJumuahRun(jumuah).format()} \u2014 \u0642\u0646\u0627\u0629 \u0627\u0644\u0623\u0630\u0643\u0627\u0631 <#${jumuah.channelId}> \u2014 ${kahfReciters.length} \u0642\u0631\u0627\u0621 \u0645\u0639 \u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641 \u2014 \u0627\u0644\u0635\u0648\u062a ${jumuah.playKahfVoice ? '\u0645\u0641\u0639\u0644 Loop \u0645\u0646 \u0628\u0639\u062f \u0627\u0644\u0641\u062c\u0631 \u062d\u062a\u0649 \u0623\u0630\u0627\u0646 \u0627\u0644\u0638\u0647\u0631' : '\u0645\u062a\u0648\u0642\u0641'} \u2014 \u0627\u0633\u062a\u062f\u0631\u0627\u0643 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u062d\u062a\u0649 6 \u0633\u0627\u0639\u0627\u062a.`
            : '\u0646\u0638\u0627\u0645 \u0627\u0644\u062c\u0645\u0639\u0629 \u063a\u064a\u0631 \u0645\u0639\u062f \u0623\u0648 \u0645\u062a\u0648\u0642\u0641.',
    });
    return checks;
}