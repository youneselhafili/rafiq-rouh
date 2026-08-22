import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
    ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits,
    SlashCommandBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import cities from '../../data/cities.json';
import { COUNTRY_FLAGS } from '../../utils/constants';
import {
    AdhanAudioConfig, adhanAudioLabel, getAdhanAudioConfig, listAdhanAudioFiles,
} from '../../services/adhanAudioService';

export type AdhanSetupView = 'zone' | 'audio';

export interface AdhanSetupSession {
    guildId: string;
    channelId?: string;
    country?: string;
    city?: string;
    zoneEnabled: boolean;
    view: AdhanSetupView;
    audio: AdhanAudioConfig;
}

export const activeAdhanSetups = new Map<string, AdhanSetupSession>();

function uniqueCountries() {
    const result = new Map<string, string>();
    for (const city of cities) if (!result.has(city.country)) result.set(city.country, city.countryAr);
    return [...result.entries()].map(([en, ar]) => ({ en, ar })).slice(0, 25);
}

function cityOptions(country?: string) {
    return cities.filter(city => city.country === country).slice(0, 25).map(city => ({
        label: city.name.slice(0, 100), value: city.nameEn, emoji: '📍',
    }));
}

export const data = new SlashCommandBuilder()
    .setName('setup_adhan')
    .setDescription('إعداد مناطق الأذان والصوت والإشعارات')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    const session: AdhanSetupSession = {
        guildId: interaction.guildId!, zoneEnabled: true, view: 'zone',
        audio: await getAdhanAudioConfig(interaction.guildId!),
    };
    activeAdhanSetups.set(interaction.user.id, session);
    await interaction.editReply(buildAdhanSetupPayload(session));
}

export function buildAdhanSetupPayload(session: AdhanSetupSession) {
    if (session.view === 'audio') return buildAudioPayload(session);
    const country = cities.find(city => city.country === session.country);
    const city = cities.find(item => item.nameEn === session.city && item.country === session.country);
    const countries = uniqueCountries();
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('🕌 إعداد منطقة الأذان')
        .setDescription('اختر قناة الإشعارات والمنطقة ثم اضغط **حفظ المنطقة**. إذا لديك معرّف القناة استعمل زر **لصق معرّف القناة**؛ البحث داخل القائمة كيخدم باسم القناة فقط.')
        .addFields(
            { name: '💬 قناة الإشعارات', value: session.channelId ? `<#${session.channelId}>` : 'لم يتم الاختيار', inline: true },
            { name: '🌍 الدولة', value: country ? country.countryAr : 'لم يتم الاختيار', inline: true },
            { name: '📍 المدينة', value: city ? city.name : 'لم يتم الاختيار', inline: true },
            { name: '🔊 النظام الصوتي العام', value: modeLabel(session.audio.mode), inline: false },
        )
        .setFooter({ text: 'لا يتم حفظ أي تغيير قبل الضغط على زر الحفظ.' });
    const channels = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId('adhan_setup_channel').setPlaceholder('اختر القناة بالاسم (لاستعمال المعرّف اضغط الزر في الأسفل)').addChannelTypes(ChannelType.GuildText),
    );
    const countriesRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhan_setup_country').setPlaceholder('اختر الدولة').addOptions(
            countries.map(item => ({ label: item.ar, description: 'دولة متاحة', value: item.en, emoji: COUNTRY_FLAGS[item.en] || '🌍', default: item.en === session.country })),
        ),
    );
    const availableCities = cityOptions(session.country);
    const citiesRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhan_setup_city').setPlaceholder('اختر المدينة')
            .setDisabled(!availableCities.length).addOptions(availableCities.length ? availableCities.map(item => ({ ...item, default: item.value === session.city })) : [{ label: 'اختر الدولة أولاً', value: 'none' }]),
    );
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('adhan_setup_save_zone').setLabel('حفظ المنطقة').setEmoji('💾').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('adhan_setup_audio').setLabel('إعداد الصوت').setEmoji('🔊').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('adhan_setup_channel_id').setLabel('لصق معرّف القناة').setEmoji('🔢').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('adhan_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [channels, countriesRow, citiesRow, buttons] };
}

function buildAudioPayload(session: AdhanSetupSession) {
    const files = listAdhanAudioFiles(false);
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('🔊 إعداد صوت الأذان العام')
        .setDescription('هذه الإعدادات تطبق على جميع المناطق. أذان الفجر يستعمل دائماً الملف الخاص به، وبقية الصلوات تستعمل اختيارك أدناه.')
        .addFields(
            { name: 'الحالة', value: modeLabel(session.audio.mode), inline: true },
            { name: 'الصوت', value: session.audio.audioChoice === 'random' ? '🔀 عشوائي بدون تكرار حتى تنتهي القائمة' : adhanAudioLabel(session.audio.audioChoice), inline: true },
            { name: 'الصوت المرتفع', value: `${Math.round(session.audio.volume * 100)}%`, inline: true },
        )
        .setFooter({ text: 'التغييرات مؤقتة حتى تضغط حفظ.' });
    const mode = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhan_audio_mode').setPlaceholder('طريقة التشغيل').addOptions(
            { label: 'صوت + إشعار', value: 'voice_notification', emoji: '🔊', default: session.audio.mode === 'voice_notification' },
            { label: 'إشعار فقط', value: 'notification_only', emoji: '🔔', default: session.audio.mode === 'notification_only' },
            { label: 'متوقف', value: 'stopped', emoji: '⏹️', default: session.audio.mode === 'stopped' },
        ),
    );
    const audio = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhan_audio_file').setPlaceholder('اختر صوت الأذان').addOptions(
            { label: 'عشوائي', value: 'random', emoji: '🔀', default: session.audio.audioChoice === 'random' },
            ...files.slice(0, 24).map(file => ({ label: adhanAudioLabel(file).slice(0, 100), value: file, default: session.audio.audioChoice === file })),
        ),
    );
    const volume = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhan_audio_volume').setPlaceholder('مستوى الصوت').addOptions(
            ...[25, 50, 75, 100].map(value => ({ label: `${value}%`, value: String(value), default: Math.round(session.audio.volume * 100) === value })),
        ),
    );
    const buttons = audioButtons();
    return { embeds: [embed], components: [mode, audio, volume, buttons] };
}



function audioButtons() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('adhan_audio_save').setLabel('حفظ').setEmoji('💾').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('adhan_audio_test').setLabel('تجربة الصوت كاملاً').setEmoji('🔊').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('adhan_audio_back').setLabel('رجوع').setStyle(ButtonStyle.Secondary),
    );
}

export function modeLabel(mode: AdhanAudioConfig['mode']) {
    if (mode === 'voice_notification') return '🔊 صوت + إشعار';
    if (mode === 'notification_only') return '🔔 إشعار فقط';
    return '⏹️ متوقف مع الاحتفاظ بالإعدادات';
}

