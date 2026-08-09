import moment from 'moment-timezone';
import {
    ActionRowBuilder,
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
import cities from '../../data/cities.json';
import { DM_PANEL_FOOTER, renderPanelEmbed, UI_COLORS } from '../../utils/uiRenderer';
import { DMAdhanEvent, DMLanguage, DMPrayerKey, getUserDMConfig, updateUserDMConfig, UserDMConfig } from '../../services/dmSubscriptionService';

export type DMPage = 'home' | 'prayer' | 'adhkar' | 'quran' | 'more' | 'disable' | 'location';
type PanelInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

const LANGUAGE_LABELS: Record<DMLanguage, string> = { ar: 'العربية', darija: 'العربية', en: 'العربية', fr: 'العربية' };
const PRAYERS: Array<[DMPrayerKey, string, string]> = [
    ['Fajr', '\u0627\u0644\u0641\u062c\u0631', 'Fajr'], ['Dhuhr', '\u0627\u0644\u0638\u0647\u0631', 'Dhuhr'], ['Asr', '\u0627\u0644\u0639\u0635\u0631', 'Asr'], ['Maghrib', '\u0627\u0644\u0645\u063a\u0631\u0628', 'Maghrib'], ['Isha', '\u0627\u0644\u0639\u0634\u0627\u0621', 'Isha'],
];
const EVENTS: Array<[DMAdhanEvent, string, string]> = [
    ['adhan', '\u0645\u0648\u0627\u0642\u064a\u062a \u0627\u0644\u0635\u0644\u0627\u0629', '\u0625\u0631\u0633\u0627\u0644 \u0645\u0648\u0627\u0642\u064a\u062a \u0627\u0644\u0635\u0644\u0627\u0629 \u0627\u0644\u064a\u0648\u0645\u064a\u0629'],
    ['warning', '\u0642\u0628\u0644 \u0627\u0644\u0635\u0644\u0627\u0629 \u0628\u0640 5 \u062f\u0642\u0627\u0626\u0642', '\u062a\u0646\u0628\u064a\u0647 \u0642\u0628\u0644 \u062f\u062e\u0648\u0644 \u0648\u0642\u062a \u0627\u0644\u0635\u0644\u0627\u0629'],
    ['prayer_card', '\u062f\u0639\u0627\u0621 \u0628\u0639\u062f \u0627\u0644\u0635\u0644\u0627\u0629', '\u062f\u0639\u0627\u0621 \u0642\u0635\u064a\u0631 \u0628\u0639\u062f \u0627\u0644\u0635\u0644\u0627\u0629'],
];
const ADHKAR: Array<[keyof UserDMConfig['adhkarConfig']['categories'], string, string]> = [
    ['adhkar_sabah', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0635\u0628\u0627\u062d', '\u062a\u0631\u0633\u0644 \u0641\u064a \u0627\u0644\u0635\u0628\u0627\u062d'],
    ['adhkar_masa', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0645\u0633\u0627\u0621', '\u062a\u0631\u0633\u0644 \u0641\u064a \u0627\u0644\u0645\u0633\u0627\u0621'],
    ['adhkar_nawm', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0646\u0648\u0645', '\u0642\u0628\u0644 \u0627\u0644\u0646\u0648\u0645'],
    ['adhkar_istiyqaz', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0627\u0633\u062a\u064a\u0642\u0627\u0638', '\u0628\u0639\u062f \u0627\u0644\u0627\u0633\u062a\u064a\u0642\u0627\u0638'],
    ['adhkar_wudu', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0648\u0636\u0648\u0621', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0648\u0636\u0648\u0621'],
    ['adhkar_adhan', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0623\u0630\u0627\u0646', '\u0628\u0639\u062f \u0627\u0644\u0623\u0630\u0627\u0646'],
    ['adhkar_jumuah', '\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u062c\u0645\u0639\u0629', '\u064a\u0648\u0645 \u0627\u0644\u062c\u0645\u0639\u0629'],
    ['adhkar_other', '\u062f\u0639\u0627\u0621 \u064a\u0648\u0645\u064a', '\u062f\u0639\u0627\u0621 \u064a\u0648\u0645\u064a \u0645\u062e\u062a\u0627\u0631'],
];
const LOCATION_PAGE_SIZE = 25;
const locationState = new Map<string, { country?: string; countryPage: number; cityPage: number }>();

function countryEntries() {
    const result = new Map<string, string>();
    for (const city of cities) if (!result.has(city.country)) result.set(city.country, city.countryAr || city.country);
    return Array.from(result.entries()).map(([country, countryAr]) => ({ country, countryAr }));
}

function currentCountry(config: UserDMConfig, userId: string): string {
    const state = locationState.get(userId);
    if (state?.country) return state.country;
    const city = cities.find(item => item.nameEn === config.city);
    return city?.country || 'Morocco';
}

function getLocationState(userId: string, config: UserDMConfig) {
    const countries = countryEntries();
    const country = currentCountry(config, userId);
    const existing = locationState.get(userId) || { country, countryPage: 0, cityPage: 0 };
    existing.country = country;
    const countryIndex = Math.max(0, countries.findIndex(item => item.country === country));
    existing.countryPage = Math.max(0, Math.min(existing.countryPage ?? Math.floor(countryIndex / LOCATION_PAGE_SIZE), Math.ceil(countries.length / LOCATION_PAGE_SIZE) - 1));
    const countryPageStart = existing.countryPage * LOCATION_PAGE_SIZE;
    if (countryIndex >= 0 && (countryIndex < countryPageStart || countryIndex >= countryPageStart + LOCATION_PAGE_SIZE)) existing.countryPage = Math.floor(countryIndex / LOCATION_PAGE_SIZE);
    const cityCount = cities.filter(item => item.country === existing.country).length;
    existing.cityPage = Math.max(0, Math.min(existing.cityPage || 0, Math.max(0, Math.ceil(cityCount / LOCATION_PAGE_SIZE) - 1)));
    locationState.set(userId, existing);
    return existing;
}

function navButton(id: string, label: string, disabled: boolean) {
    return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
}

function cityLabel(config: UserDMConfig): string {
    if (!config.city) return '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0627\u062e\u062a\u064a\u0627\u0631 \u0628\u0639\u062f';
    const city = cities.find(item => item.nameEn === config.city);
    return city ? city.name : config.city;
}
function enabled(value: boolean): string { return value ? 'مفعلة' : 'متوقفة'; }
function validTimes(value: string): string[] {
    return [...new Set(value.match(/(?:[01]\d|2[0-3]):[0-5]\d/g) || [])].sort();
}
function salawatTimezone(config: UserDMConfig): string {
    return config.salawatConfig.timezone || config.timezone || 'Africa/الدار البيضاء';
}
function nextSalawatRun(config: UserDMConfig): string | undefined {
    const salawat = config.salawatConfig;
    if (!salawat.enabled) return undefined;
    if (salawat.scheduleMode === 'fixed' && salawat.fixedTimes.length) {
        const now = moment().tz(salawatTimezone(config));
        const candidates = salawat.fixedTimes.flatMap(time => {
            const [hour, minute] = time.split(':').map(Number);
            return [0, 1].map(offset => now.clone().add(offset, 'day').hour(hour).minute(minute).second(0).millisecond(0));
        }).filter(value => value.isAfter(now)).sort((a, b) => a.valueOf() - b.valueOf());
        return candidates[0]?.toISOString();
    }
    return moment().add(salawat.intervalHours || 4, 'hours').toISOString();
}
function salawatScheduleLabel(config: UserDMConfig): string {
    const salawat = config.salawatConfig;
    if (salawat.scheduleMode === 'fixed') return salawat.fixedTimes.length ? salawat.fixedTimes.join('، ') : 'أوقات محددة غير مضبوطة';
    return `كل ${salawat.intervalHours || 4} ساعة`;
}
function selectedLabels<T extends string>(items: Array<[T, string, string]>, source: Record<T, boolean>): string {
    const labels = items.filter(([key]) => source[key]).map(([, ar]) => ar);
    return labels.length ? labels.join('\u060c ') : '\u0644\u0627 \u064a\u0648\u062c\u062f \u0627\u062e\u062a\u064a\u0627\u0631';
}
function panelEmbed(title: string, description: string, _config: UserDMConfig, iconURL?: string) {
    return renderPanelEmbed(title, description, undefined, UI_COLORS.BRAND, iconURL, DM_PANEL_FOOTER);
}
function actionButton(id: string, label: string, emoji: string, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
}
function homeButton() { return actionButton('dm_panel_page_home', '\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629', '\uD83C\uDFE0'); }
function statusLine(config: UserDMConfig): string { return config.enabled ? '🟢 **تنبيهات الرسائل الخاصة مفعلة**' : '🔴 **تنبيهات الرسائل الخاصة متوقفة**'; }


function buildHome(config: UserDMConfig, iconURL?: string) {
    const description = statusLine(config)
        + '\n📍 **المدينة / المنطقة**\n' + cityLabel(config)
        + '\n🌐 **لغة الرسائل**\nالعربية'
        + '\n🔔 **تنبيهات الصلاة**\n' + enabled(config.adhanConfig.enabled)
        + '\n📿 **الأذكار**\n' + selectedLabels(ADHKAR, config.adhkarConfig.categories)
        + '\n📖 **القرآن**\n' + enabled(config.quranConfig.enabled);
    const embed = panelEmbed('⚙️ إعداداتك الخاصة', description, config, iconURL);
    const primary = new ActionRowBuilder<ButtonBuilder>().addComponents(
        actionButton('dm_panel_page_prayer', 'الصلاة', '🕒', ButtonStyle.Primary),
        actionButton('dm_panel_page_adhkar', 'الأذكار', '📿', ButtonStyle.Primary),
        actionButton('dm_panel_page_quran', 'القرآن', '📖', ButtonStyle.Primary),
    );
    const personal = new ActionRowBuilder<ButtonBuilder>().addComponents(
        actionButton('dm_panel_city_set', 'المدينة', '📍'),
        actionButton('dm_panel_page_more', 'المزيد', '⚙️'),
    );
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        actionButton('dm_panel_test', 'اختبار الرسائل الخاصة', '✉️'),
        actionButton('dm_panel_delete_chat', 'حذف رسائل البوت', '🧹', ButtonStyle.Danger),
        actionButton('dm_panel_page_disable', config.enabled ? 'إيقاف الكل' : 'تفعيل الكل', config.enabled ? '🗑️' : '✅', config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        actionButton('dm_panel_close', 'إغلاق اللوحة', '✖️', ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [primary, personal, actions] };
}

function buildLocation(config: UserDMConfig, iconURL?: string, userId = 'system') {
    const state = getLocationState(userId, config);
    const countries = countryEntries();
    const countryPages = Math.max(1, Math.ceil(countries.length / LOCATION_PAGE_SIZE));
    const countryOptions = countries.slice(state.countryPage * LOCATION_PAGE_SIZE, (state.countryPage + 1) * LOCATION_PAGE_SIZE);
    const selectedCountry = countries.find(item => item.country === state.country);
    const cityList = cities.filter(item => item.country === state.country);
    const cityPages = Math.max(1, Math.ceil(cityList.length / LOCATION_PAGE_SIZE));
    const cityOptions = cityList.slice(state.cityPage * LOCATION_PAGE_SIZE, (state.cityPage + 1) * LOCATION_PAGE_SIZE);
    const selectedCity = cities.find(item => item.nameEn === config.city);
    const description = 'اختر الدولة أولا، ثم اختر المدينة من القائمة. هذا الاختيار خاص بك وسيستعمله البوت في تنبيهات الصلاة والأذكار.'
        + '\n\n🌍 **الدولة المختارة:** ' + (selectedCountry ? selectedCountry.countryAr : 'لم يتم الاختيار بعد')
        + '\n📍 **المدينة المختارة:** ' + (selectedCity ? selectedCity.name : 'لم يتم الاختيار بعد')
        + '\n📄 **الصفحات:** ' + (state.countryPage + 1) + '/' + countryPages + ' | ' + (state.cityPage + 1) + '/' + cityPages;
    const embed = panelEmbed('📍 اختيار المدينة والمنطقة', description, config, iconURL);
    const countryRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('dm_panel_select_country').setPlaceholder('اختر الدولة').addOptions(
            countryOptions.map(item => ({ label: item.countryAr.slice(0, 100), value: item.country, default: item.country === state.country, emoji: '🌍' })),
        ),
    );
    const cityRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('dm_panel_select_city').setPlaceholder('اختر المدينة').addOptions(
            cityOptions.map(city => ({ label: city.name.slice(0, 100), description: (city.countryAr || city.timezone).slice(0, 100), value: city.nameEn, default: city.nameEn === config.city, emoji: '📍' })),
        ),
    );
    const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
        navButton('dm_panel_country_prev', 'دول سابقة', state.countryPage <= 0),
        navButton('dm_panel_country_next', 'دول أخرى', state.countryPage >= countryPages - 1),
        navButton('dm_panel_city_prev', 'مدن سابقة', state.cityPage <= 0),
        navButton('dm_panel_city_next', 'مدن أخرى', state.cityPage >= cityPages - 1),
        homeButton(),
    );
    return { embeds: [embed], components: [countryRow, cityRow, nav] };
}

function buildPrayer(config: UserDMConfig, iconURL?: string) {
    const embed = panelEmbed('\uD83D\uDD52 \u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0627\u0644\u0635\u0644\u0627\u0629', statusLine(config) + '\n\uD83D\uDCCD **\u0627\u0644\u0645\u062f\u064a\u0646\u0629:** ' + cityLabel(config) + '\n\uD83D\uDD14 **\u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629:** ' + selectedLabels(EVENTS, config.adhanConfig.events) + '\n\uD83D\uDD4C **\u0627\u0644\u0635\u0644\u0648\u0627\u062a \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629:** ' + selectedLabels(PRAYERS, config.adhanConfig.prayers), config, iconURL);
    const features = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dm_panel_select_prayer_features').setPlaceholder('\u0627\u062e\u062a\u0631 \u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0635\u0644\u0627\u0629 \u0627\u0644\u062a\u064a \u062a\u0631\u064a\u062f\u0647\u0627').setMinValues(0).setMaxValues(EVENTS.length).addOptions(EVENTS.map(([key, ar, desc]) => ({ label: ar, description: desc, value: key, default: config.adhanConfig.events[key] }))));
    const prayers = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dm_panel_select_prayers').setPlaceholder('\u0627\u062e\u062a\u0631 \u0627\u0644\u0635\u0644\u0648\u0627\u062a \u0627\u0644\u062a\u064a \u062a\u0631\u064a\u062f \u0627\u0644\u062a\u0646\u0628\u064a\u0647 \u0644\u0647\u0627').setMinValues(0).setMaxValues(PRAYERS.length).addOptions(PRAYERS.map(([key, ar]) => ({ label: ar, description: 'تنبيه ' + ar, value: key, default: config.adhanConfig.prayers[key] }))));
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(actionButton('dm_panel_toggle_prayer', config.adhanConfig.enabled ? '\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0635\u0644\u0627\u0629' : '\u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0635\u0644\u0627\u0629', config.adhanConfig.enabled ? '\u23F8\uFE0F' : '\u25B6\uFE0F', config.adhanConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success), actionButton('dm_panel_city_set', '\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u0645\u062f\u064a\u0646\u0629', '\uD83D\uDCCD'), homeButton());
    return { embeds: [embed], components: [features, prayers, actions] };
}

function buildAdhkar(config: UserDMConfig, iconURL?: string) {
    const embed = panelEmbed('\uD83D\uDCFF \u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u064a\u0648\u0645\u064a\u0629', statusLine(config) + '\n**\u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629**\n' + selectedLabels(ADHKAR, config.adhkarConfig.categories), config, iconURL);
    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dm_panel_select_adhkar').setPlaceholder('\u0627\u062e\u062a\u0631 \u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u062a\u064a \u062a\u0631\u064a\u062f\u0647\u0627').setMinValues(0).setMaxValues(ADHKAR.length).addOptions(ADHKAR.map(([key, ar, desc]) => ({ label: ar, description: desc, value: key, default: config.adhkarConfig.categories[key] }))));
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(actionButton('dm_panel_toggle_adhkar', config.adhkarConfig.enabled ? '\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0623\u0630\u0643\u0627\u0631' : '\u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0623\u0630\u0643\u0627\u0631', config.adhkarConfig.enabled ? '\u23F8\uFE0F' : '\u25B6\uFE0F', config.adhkarConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success), homeButton());
    return { embeds: [embed], components: [menu, actions] };
}

function buildQuran(config: UserDMConfig, iconURL?: string) {
    const quran = config.quranConfig;
    const selected = [quran.dailyAyah && '\u0622\u064a\u0629 \u064a\u0648\u0645\u064a\u0629', quran.kahf && '\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641', quran.readingReminder && '\u062a\u0630\u0643\u064a\u0631 \u0627\u0644\u0648\u0631\u062f'].filter(Boolean).join('\u060c ') || '\u0644\u0627 \u064a\u0648\u062c\u062f \u0627\u062e\u062a\u064a\u0627\u0631';
    const embed = panelEmbed('\uD83D\uDCD6 \u0631\u0648\u062a\u064a\u0646 \u0627\u0644\u0642\u0631\u0622\u0646', statusLine(config) + '\n\uD83D\uDCD6 **\u0627\u0644\u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629**\n' + selected + '\n\uD83D\uDD58 **\u0648\u0642\u062a \u0627\u0644\u062a\u0630\u0643\u064a\u0631:** ' + quran.reminderTime, config, iconURL);
    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dm_panel_select_quran').setPlaceholder('\u0627\u062e\u062a\u0631 \u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0627\u0644\u0642\u0631\u0622\u0646').setMinValues(0).setMaxValues(3).addOptions({ label: '\u0622\u064a\u0629 \u064a\u0648\u0645\u064a\u0629', description: '\u0625\u0631\u0633\u0627\u0644 \u0622\u064a\u0629 \u064a\u0648\u0645\u064a\u0629', value: 'dailyAyah', default: quran.dailyAyah }, { label: '\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641', description: '\u062a\u0630\u0643\u064a\u0631 \u064a\u0648\u0645 \u0627\u0644\u062c\u0645\u0639\u0629', value: 'kahf', default: quran.kahf }, { label: '\u062a\u0630\u0643\u064a\u0631 \u0627\u0644\u0648\u0631\u062f', description: '\u062a\u0630\u0643\u064a\u0631 \u0628\u0627\u0644\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u064a\u0648\u0645\u064a\u0629', value: 'readingReminder', default: quran.readingReminder }));
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(actionButton('dm_panel_toggle_quran', quran.enabled ? '\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0642\u0631\u0622\u0646' : '\u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0642\u0631\u0622\u0646', quran.enabled ? '\u23F8\uFE0F' : '\u25B6\uFE0F', quran.enabled ? ButtonStyle.Danger : ButtonStyle.Success), actionButton('dm_panel_quran_time_set', '\u0648\u0642\u062a \u0627\u0644\u062a\u0630\u0643\u064a\u0631', '\uD83D\uDD58'), homeButton());
    return { embeds: [embed], components: [menu, actions] };
}
function buildMore(config: UserDMConfig, iconURL?: string) {
    const extras = { salawat: config.salawatConfig.enabled, jumuah: config.jumuahConfig.enabled };
    const next = config.salawatConfig.nextRunAt ? '<t:' + Math.floor(new Date(config.salawatConfig.nextRunAt).getTime() / 1000) + ':R>' : '\u063a\u064a\u0631 \u0645\u062d\u062f\u062f';
    const description = '\uD83C\uDF3F **\u0627\u0644\u0635\u0644\u0627\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0628\u064a:** ' + enabled(extras.salawat)
        + '\n\uD83D\uDD52 **\u062c\u062f\u0648\u0644\u0629 \u0627\u0644\u0635\u0644\u0627\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0628\u064a:** ' + salawatScheduleLabel(config)
        + '\n\u23ED\uFE0F **\u0627\u0644\u0645\u0648\u0639\u062f \u0627\u0644\u0642\u0627\u062f\u0645:** ' + next
        + '\n\u2B50 **\u062a\u0630\u0643\u064a\u0631 \u0627\u0644\u062c\u0645\u0639\u0629:** ' + enabled(extras.jumuah)
        + '\n\uD83D\uDD52 **\u0648\u0642\u062a \u0627\u0644\u062c\u0645\u0639\u0629:** ' + config.jumuahConfig.reminderTime;
    const embed = panelEmbed('\u2699\uFE0F \u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0625\u0636\u0627\u0641\u064a\u0629', description, config, iconURL);
    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dm_panel_select_more').setPlaceholder('\u0627\u062e\u062a\u0631 \u0627\u0644\u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0627\u0644\u0625\u0636\u0627\u0641\u064a\u0629').setMinValues(0).setMaxValues(2).addOptions({ label: '\u0627\u0644\u0635\u0644\u0627\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0628\u064a', description: '\u0625\u0631\u0633\u0627\u0644 \u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0627\u0644\u0635\u0644\u0627\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0628\u064a \u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645 \u0641\u064a \u0627\u0644\u062e\u0627\u0635', value: 'salawat', default: extras.salawat }, { label: '\u062a\u0630\u0643\u064a\u0631 \u0627\u0644\u062c\u0645\u0639\u0629', description: '\u062a\u0630\u0643\u064a\u0631 \u0627\u0644\u062c\u0645\u0639\u0629 \u0648\u0633\u0648\u0631\u0629 \u0627\u0644\u0643\u0647\u0641', value: 'jumuah', default: extras.jumuah }));
    const schedule = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('dm_panel_salawat_schedule').setPlaceholder('\u062c\u062f\u0648\u0644\u0629 \u0627\u0644\u0635\u0644\u0627\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0628\u064a').setMinValues(1).setMaxValues(1).addOptions(
        { label: '\u0643\u0644 \u0633\u0627\u0639\u0629', value: 'interval:1', default: config.salawatConfig.scheduleMode === 'interval' && config.salawatConfig.intervalHours === 1 },
        { label: '\u0643\u0644 4 \u0633\u0627\u0639\u0627\u062a', value: 'interval:4', default: config.salawatConfig.scheduleMode === 'interval' && config.salawatConfig.intervalHours === 4 },
        { label: '\u0643\u0644 8 \u0633\u0627\u0639\u0627\u062a', value: 'interval:8', default: config.salawatConfig.scheduleMode === 'interval' && config.salawatConfig.intervalHours === 8 },
        { label: '\u0643\u0644 12 \u0633\u0627\u0639\u0629', value: 'interval:12', default: config.salawatConfig.scheduleMode === 'interval' && config.salawatConfig.intervalHours === 12 },
        { label: '\u0643\u0644 24 \u0633\u0627\u0639\u0629', value: 'interval:24', default: config.salawatConfig.scheduleMode === 'interval' && config.salawatConfig.intervalHours === 24 },
        { label: '\u0623\u0648\u0642\u0627\u062a \u0645\u062d\u062f\u062f\u0629', description: '\u0645\u062b\u0644\u0627 09:00, 18:30', value: 'fixed', default: config.salawatConfig.scheduleMode === 'fixed' },
    ));
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(actionButton('dm_panel_salawat_times_set', '\u0623\u0648\u0642\u0627\u062a \u0627\u0644\u0635\u0644\u0627\u0629 \u0639\u0644\u0649 \u0627\u0644\u0646\u0628\u064a', '\uD83D\uDD52'), actionButton('dm_panel_jumuah_time_set', '\u0648\u0642\u062a \u0627\u0644\u062c\u0645\u0639\u0629', '\uD83D\uDD52'), homeButton());
    return { embeds: [embed], components: [menu, schedule, actions] };
}

function buildDisable(config: UserDMConfig, iconURL?: string) {
    const turningOff = config.enabled;
    const embed = panelEmbed(turningOff ? '\u26A0\uFE0F \u0647\u0644 \u062a\u0631\u064a\u062f \u0625\u064a\u0642\u0627\u0641 \u0643\u0644 \u0627\u0644\u062a\u0646\u0628\u064a\u0647\u0627\u062a\u061f' : '\u2705 \u0647\u0644 \u062a\u0631\u064a\u062f \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u062a\u0646\u0628\u064a\u0647\u0627\u062a\u061f', turningOff ? '\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a\u0643 \u0633\u062a\u0628\u0642\u0649 \u0645\u062d\u0641\u0648\u0638\u0629\u060c \u0648\u064a\u0645\u0643\u0646\u0643 \u062a\u0641\u0639\u064a\u0644\u0647\u0627 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649 \u0641\u064a \u0623\u064a \u0648\u0642\u062a.' : '\u0633\u064a\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a\u0643 \u0627\u0644\u0645\u062d\u0641\u0648\u0638\u0629 \u0644\u0644\u0635\u0644\u0627\u0629 \u0648\u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u0648\u0627\u0644\u0642\u0631\u0622\u0646.', config, iconURL).setColor(turningOff ? UI_COLORS.DANGER : UI_COLORS.SUCCESS);
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(actionButton('dm_panel_confirm_toggle_all', turningOff ? '\u0646\u0639\u0645\u060c \u0623\u0648\u0642\u0641 \u0627\u0644\u0643\u0644' : '\u0646\u0639\u0645\u060c \u0641\u0639\u0644 \u0627\u0644\u0643\u0644', turningOff ? '\uD83D\uDDD1\uFE0F' : '\u2705', turningOff ? ButtonStyle.Danger : ButtonStyle.Success), homeButton());
    return { embeds: [embed], components: [actions] };
}

export function buildDMPanelPayload(config: UserDMConfig, page: DMPage = 'home', iconURL?: string) {
    if (page === 'location') return buildLocation(config, iconURL);
    if (page === 'prayer') return buildPrayer(config, iconURL);
    if (page === 'adhkar') return buildAdhkar(config, iconURL);
    if (page === 'quran') return buildQuran(config, iconURL);
    if (page === 'more') return buildMore(config, iconURL);
    if (page === 'disable') return buildDisable(config, iconURL);
    return buildHome(config, iconURL);
}

async function showPanel(interaction: PanelInteraction, page: DMPage, config?: UserDMConfig) {
    const latest = config || await getUserDMConfig(interaction.user.id);
    const iconURL = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
    const payload = page === 'location' ? buildLocation(latest, iconURL, interaction.user.id) : buildDMPanelPayload(latest, page, iconURL);
    if (interaction.isButton() && interaction.customId === 'dm_panel_open') await interaction.reply({ ...payload, flags: 64 });
    else if (interaction.isModalSubmit() || interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
}
function textModal(interaction: ButtonInteraction, customId: string, title: string, label: string, placeholder: string, value?: string) {
    const input = new TextInputBuilder().setCustomId('value').setLabel(label).setStyle(TextInputStyle.Short).setPlaceholder(placeholder).setRequired(true);
    if (value) input.setValue(value);
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    return interaction.showModal(modal);
}
async function deleteBotMessagesInDM(interaction: ButtonInteraction) {
    if (interaction.inGuild()) {
        await interaction.reply({ content: '\u0647\u0630\u0627 \u0627\u0644\u0632\u0631 \u064a\u0639\u0645\u0644 \u062f\u0627\u062e\u0644 الرسائل الخاصة \u0641\u0642\u0637. \u0627\u0641\u062a\u062d \u0644\u0648\u062d\u0629 \u0627\u0644\u0628\u0648\u062a \u0641\u064a \u0627\u0644\u062e\u0627\u0635 \u062b\u0645 \u0627\u0636\u063a\u0637\u0647 \u0645\u0646 \u0647\u0646\u0627\u0643.', flags: 64 });
        return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    if (!channel || !('messages' in channel)) return;
    let before: string | undefined;
    let safety = 0;
    while (safety < 20) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!messages || messages.size === 0) break;
        before = messages.last()?.id;
        const botMessages = messages.filter(message => message.author.id === interaction.client.user?.id);
        for (const message of botMessages.values()) await message.delete().catch(() => null);
        if (messages.size < 100) break;
        safety += 1;
    }
}


function messagePreview(content: string): string {
    const clean = content.replace(/\s+/g, ' ').trim();
    return clean ? clean.slice(0, 70) : 'رسالة بدون نص';
}

async function recentBotDMMessages(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, limit = 25) {
    const channel = interaction.channel;
    if (!channel || !('messages' in channel)) return [];
    const currentMessageId = (interaction as any).message?.id;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return [];
    return [...messages.values()]
        .filter(message => message.author.id === interaction.client.user?.id && message.id !== currentMessageId)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(0, limit);
}

async function allBotDMMessages(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
    const channel = interaction.channel;
    if (!channel || !('messages' in channel)) return [];
    const currentMessageId = (interaction as any).message?.id;
    const result: any[] = [];
    let before: string | undefined;

    while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch?.size) break;
        result.push(...[...batch.values()].filter(message =>
            message.author.id === interaction.client.user?.id && message.id !== currentMessageId,
        ));
        if (batch.size < 100) break;
        before = batch.last()?.id;
        if (!before) break;
    }

    return result.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
}

async function buildDeletePanel(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, note?: string) {
    const messages = await recentBotDMMessages(interaction, 25);
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.DANGER)
        .setTitle('تنظيف رسائل البوت في الخاص')
        .setDescription(`${note ? `${note}\n\n` : ''}اختار عدد الرسائل التي تريد حذفها، أو اختار رسائل محددة من القائمة. الحذف يمسح رسائل رفيق الروح فقط داخل هذا الخاص.`)
        .setFooter({ text: DM_PANEL_FOOTER })
        .setTimestamp();

    const countRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        actionButton('dm_panel_delete_count_5', '5', '🧹', ButtonStyle.Danger),
        actionButton('dm_panel_delete_count_10', '10', '🧹', ButtonStyle.Danger),
        actionButton('dm_panel_delete_count_25', '25', '🧹', ButtonStyle.Danger),
        actionButton('dm_panel_delete_count_50', '50', '🧹', ButtonStyle.Danger),
    );
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        actionButton('dm_panel_delete_custom', 'عدد مخصص', '🔢', ButtonStyle.Secondary),
        actionButton('dm_panel_delete_all', 'حذف الكل', '🗑️', ButtonStyle.Danger),
        homeButton(),
    );
    const components: any[] = [];
    if (messages.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId('dm_panel_delete_select')
            .setPlaceholder('اختار رسائل محددة للحذف')
            .setMinValues(1)
            .setMaxValues(Math.min(messages.length, 25))
            .addOptions(messages.map((message, index) => ({
                label: `${index + 1}. ${messagePreview(message.content || message.embeds[0]?.data?.title || '')}`.slice(0, 100),
                description: new Date(message.createdTimestamp).toLocaleString('ar-MA').slice(0, 100),
                value: message.id,
                emoji: '🗑️',
            })));
        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }
    components.push(countRow, actionRow);
    return { embeds: [embed], components };
}

async function showDeletePanel(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, note?: string) {
    if (interaction.inGuild()) {
        await interaction.reply({ content: 'هذا الاختيار يعمل داخل الرسائل الخاصة فقط. افتح لوحة البوت في الخاص ثم استعمل تنظيف الرسائل من هناك.', flags: 64 });
        return;
    }
    const payload = await buildDeletePanel(interaction, note);
    if (interaction.isModalSubmit() || interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
}

async function deleteBotMessagesByIds(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, ids: string[]): Promise<number> {
    const channel = interaction.channel;
    if (!channel || !('messages' in channel)) return 0;
    let deleted = 0;
    for (const id of ids) {
        const message = await channel.messages.fetch(id).catch(() => null);
        if (!message || message.author.id !== interaction.client.user?.id) continue;
        await message.delete().then(() => { deleted += 1; }).catch(() => null);
    }
    return deleted;
}

async function deleteNewestBotMessages(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, count: number): Promise<number> {
    const messages = await recentBotDMMessages(interaction, Math.max(1, Math.min(count, 100)));
    return deleteBotMessagesByIds(interaction, messages.map(message => message.id).slice(0, count));
}
function valuesRecord<T extends string>(keys: readonly T[], values: readonly string[]): Record<T, boolean> { return Object.fromEntries(keys.map(key => [key, values.includes(key)])) as Record<T, boolean>; }

async function sendDMTest(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    const config = await getUserDMConfig(interaction.user.id);
    const city = cityLabel(config).replace(/ \? /g, ' | ');
    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.SUCCESS)
        .setTitle('✅ اختبار الرسائل الخاصة من رفيق الروح')
        .setDescription('رسائل الخاص خدامة بنجاح. هذا نموذج صغير من الرسائل الهادئة التي يمكن أن توصلك من البوت.')
        .addFields(
            {
                name: 'دعاء قصير',
                value: 'اللهم اجعل القرآن ربيع قلوبنا، ونور صدورنا، وجلاء أحزاننا، وذهاب همومنا.',
                inline: false,
            },
            {
                name: 'إعداداتك الحالية',
                value: `📍 ${city}\n🕌 الصلاة: ${enabled(config.adhanConfig.enabled)}\n📿 الأذكار: ${enabled(config.adhkarConfig.enabled)}\n📖 القرآن: ${enabled(config.quranConfig.enabled)}`,
                inline: false,
            },
        )
        .setFooter({ text: DM_PANEL_FOOTER })
        .setTimestamp();

    if (interaction.inGuild()) await interaction.reply({ embeds: [embed], flags: 64 });
    else await interaction.reply({ embeds: [embed] });
}

export async function handleDMPanelInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    const id = interaction.customId;
    if (id === 'dm_panel_test') return sendDMTest(interaction);
    if (id === 'dm_panel_close' && interaction.isButton()) {
        await interaction.deferUpdate();
        const deleted = await interaction.message.delete().then(() => true).catch(() => false);
        if (!deleted) {
            await interaction.editReply({ content: 'تم إغلاق لوحة الرسائل الخاصة.', embeds: [], components: [] }).catch(() => null);
        }
        return;
    }
    if (id === 'dm_panel_delete_chat') return showDeletePanel(interaction);
    if (id === 'dm_panel_delete_all' && interaction.isButton()) {
        if (interaction.inGuild()) return showDeletePanel(interaction);
        const embed = new EmbedBuilder()
            .setColor(UI_COLORS.DANGER)
            .setTitle('تأكيد حذف جميع رسائل البوت')
            .setDescription('سيتم حذف جميع رسائل رفيق الروح التي يمكن الوصول إليها داخل هذه المحادثة الخاصة. لا يمكن التراجع عن هذا الإجراء.')
            .setFooter({ text: DM_PANEL_FOOTER });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            actionButton('dm_panel_delete_all_confirm', 'تأكيد حذف الكل', '🗑️', ButtonStyle.Danger),
            actionButton('dm_panel_delete_all_cancel', 'إلغاء', '↩️', ButtonStyle.Secondary),
        );
        return interaction.update({ embeds: [embed], components: [row] });
    }
    if (id === 'dm_panel_delete_all_cancel' && interaction.isButton()) return showDeletePanel(interaction);
    if (id === 'dm_panel_delete_all_confirm' && interaction.isButton()) {
        if (interaction.inGuild()) return showDeletePanel(interaction);
        await interaction.deferUpdate();
        const messages = await allBotDMMessages(interaction);
        const deleted = await deleteBotMessagesByIds(interaction, messages.map(message => message.id));
        return showDeletePanel(interaction, `تم حذف ${deleted} رسالة. جرى تنظيف جميع رسائل البوت التي أمكن الوصول إليها.`);
    }
    if (id === 'dm_panel_delete_custom' && interaction.isButton()) return textModal(interaction, 'dm_panel_delete_count_modal', 'تنظيف رسائل الخاص', 'عدد رسائل البوت التي تريد حذفها', 'مثلا 10');
    if (id.startsWith('dm_panel_delete_count_')) {
        const count = Number(id.replace('dm_panel_delete_count_', ''));
        if (interaction.inGuild()) return showDeletePanel(interaction);
        await interaction.deferUpdate();
        const deleted = await deleteNewestBotMessages(interaction, count);
        return showDeletePanel(interaction, `تم حذف ${deleted} رسالة من رسائل البوت.`);
    }
    if (id === 'dm_panel_delete_select' && interaction.isStringSelectMenu()) {
        if (interaction.inGuild()) return showDeletePanel(interaction);
        await interaction.deferUpdate();
        const deleted = await deleteBotMessagesByIds(interaction, interaction.values);
        return showDeletePanel(interaction, `تم حذف ${deleted} رسالة محددة.`);
    }

    if (interaction.isButton() && (
        id === 'dm_panel_salawat_times_set' ||
        id === 'dm_panel_jumuah_time_set' ||
        id === 'dm_panel_quran_time_set'
    )) {
        if (id === 'dm_panel_salawat_times_set') {
            return textModal(interaction, 'dm_panel_salawat_times_modal', 'أوقات الصلاة على النبي', 'الأوقات بصيغة HH:MM مفصولة بفاصلة', '09:00, 18:30');
        }
        if (id === 'dm_panel_jumuah_time_set') {
            return textModal(interaction, 'dm_panel_jumuah_time_modal', 'وقت تذكير الجمعة', 'الوقت بصيغة HH:MM', '08:00');
        }
        return textModal(interaction, 'dm_panel_quran_time_modal', 'وقت تذكير القرآن', 'الوقت بصيغة HH:MM', '09:00');
    }

    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    const config = await getUserDMConfig(interaction.user.id);
    if (interaction.isStringSelectMenu()) {
        if (id === 'dm_panel_select_prayer_features') { const events = valuesRecord(EVENTS.map(([key]) => key), interaction.values); await updateUserDMConfig(interaction.user.id, { adhan: Object.values(events).some(Boolean), adhanConfig: { ...config.adhanConfig, enabled: Object.values(events).some(Boolean), events } }); return showPanel(interaction, 'prayer'); }
        if (id === 'dm_panel_select_prayers') { const prayers = valuesRecord(PRAYERS.map(([key]) => key), interaction.values); await updateUserDMConfig(interaction.user.id, { adhanConfig: { ...config.adhanConfig, prayers } }); return showPanel(interaction, 'prayer'); }
        if (id === 'dm_panel_select_adhkar') { const categories = valuesRecord(ADHKAR.map(([key]) => key), interaction.values); const active = Object.values(categories).some(Boolean); await updateUserDMConfig(interaction.user.id, { ...categories, adhkarConfig: { ...config.adhkarConfig, enabled: active, categories } }); return showPanel(interaction, 'adhkar'); }
        if (id === 'dm_panel_select_quran') { const selected = new Set(interaction.values); const quranConfig = { ...config.quranConfig, enabled: selected.size > 0, dailyAyah: selected.has('dailyAyah'), kahf: selected.has('kahf'), readingReminder: selected.has('readingReminder') }; await updateUserDMConfig(interaction.user.id, { quranConfig }); return showPanel(interaction, 'quran'); }
        if (id === 'dm_panel_select_more') { const salawat = interaction.values.includes('salawat'); const jumuah = interaction.values.includes('jumuah'); const salawatConfig = { ...config.salawatConfig, enabled: salawat, timezone: salawatTimezone(config), nextRunAt: salawat ? nextSalawatRun({ ...config, salawatConfig: { ...config.salawatConfig, enabled: true } }) : undefined }; await updateUserDMConfig(interaction.user.id, { salawat, jumuah, salawatConfig, jumuahConfig: { ...config.jumuahConfig, enabled: jumuah } }); return showPanel(interaction, 'more'); }
        if (id === 'dm_panel_salawat_schedule') {
            const value = interaction.values[0];
            let salawatConfig = { ...config.salawatConfig, enabled: true, timezone: salawatTimezone(config) };
            if (value.startsWith('interval:')) salawatConfig = { ...salawatConfig, scheduleMode: 'interval', intervalHours: Number(value.split(':')[1]) as any };
            else salawatConfig = { ...salawatConfig, scheduleMode: 'fixed' };
            salawatConfig.nextRunAt = nextSalawatRun({ ...config, salawatConfig });
            await updateUserDMConfig(interaction.user.id, { salawat: true, salawatConfig });
            return showPanel(interaction, 'more');
        }
if (id === 'dm_panel_select_country') { const state = getLocationState(interaction.user.id, config); state.country = interaction.values[0]; state.cityPage = 0; locationState.set(interaction.user.id, state); return showPanel(interaction, 'location', config); }
        if (id === 'dm_panel_select_city') { const city = cities.find(item => item.nameEn === interaction.values[0]); if (!city) return showPanel(interaction, 'location', config); await updateUserDMConfig(interaction.user.id, { city: city.nameEn, adhan_zone: city.nameEn, timezone: city.timezone }); const state = getLocationState(interaction.user.id, config); state.country = city.country; locationState.set(interaction.user.id, state); return showPanel(interaction, 'location'); }
        return;
    }
    if (id === 'dm_panel_country_prev' || id === 'dm_panel_country_next' || id === 'dm_panel_city_prev' || id === 'dm_panel_city_next') {
        const state = getLocationState(interaction.user.id, config);
        if (id === 'dm_panel_country_prev') state.countryPage -= 1;
        if (id === 'dm_panel_country_next') state.countryPage += 1;
        if (id === 'dm_panel_city_prev') state.cityPage -= 1;
        if (id === 'dm_panel_city_next') state.cityPage += 1;
        locationState.set(interaction.user.id, state);
        return showPanel(interaction, 'location', config);
    }
    if (id === 'dm_panel_open') return showPanel(interaction, 'home', config);
    if (id.startsWith('dm_panel_page_')) return showPanel(interaction, id.replace('dm_panel_page_', '') as DMPage, config);
    if (id === 'dm_panel_city_set' || id === 'dm_panel_zone_set') return showPanel(interaction, 'location', config);


    if (id === 'dm_panel_toggle_prayer') { const active = !config.adhanConfig.enabled; await updateUserDMConfig(interaction.user.id, { adhan: active, adhanConfig: { ...config.adhanConfig, enabled: active } }); return showPanel(interaction, 'prayer'); }
    if (id === 'dm_panel_toggle_adhkar') { const active = !config.adhkarConfig.enabled; const categories = active ? (Object.values(config.adhkarConfig.categories).some(Boolean) ? config.adhkarConfig.categories : { ...config.adhkarConfig.categories, adhkar_sabah: true, adhkar_masa: true }) : valuesRecord(ADHKAR.map(([key]) => key), []); await updateUserDMConfig(interaction.user.id, { ...categories, adhkarConfig: { ...config.adhkarConfig, enabled: active, categories } }); return showPanel(interaction, 'adhkar'); }
    if (id === 'dm_panel_toggle_quran') { await updateUserDMConfig(interaction.user.id, { quranConfig: { ...config.quranConfig, enabled: !config.quranConfig.enabled } }); return showPanel(interaction, 'quran'); }
    if (id === 'dm_panel_confirm_toggle_all') { await updateUserDMConfig(interaction.user.id, { enabled: !config.enabled }); return showPanel(interaction, 'home'); }
}
function findCity(value: string) { const normalized = value.trim().toLocaleLowerCase(); return cities.find(item => item.name.toLocaleLowerCase() === normalized || item.nameEn.toLocaleLowerCase() === normalized); }
export async function handleDMZoneModal(interaction: ModalSubmitInteraction) { const value = interaction.fields.getTextInputValue('value'); const city = findCity(value); if (!city) { await interaction.reply({ content: '\u274C \u0644\u0645 \u0623\u062c\u062f \u0647\u0630\u0647 \u0627\u0644\u0645\u062f\u064a\u0646\u0629. \u062c\u0631\u0628 \u0627\u0644\u0627\u0633\u0645 \u0628\u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0623\u0648 \u0628\u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629\u060c \u0645\u062b\u0644\u0627 الدار البيضاء \u0623\u0648 \u0627\u0644\u062f\u0627\u0631 \u0627\u0644\u0628\u064a\u0636\u0627\u0621.', flags: 64 }); return; } await interaction.deferUpdate(); await updateUserDMConfig(interaction.user.id, { city: city.nameEn, adhan_zone: city.nameEn, timezone: city.timezone }); await showPanel(interaction, 'home'); }
function validTime(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export async function handleDMSalawatTimesModal(interaction: ModalSubmitInteraction) {
    const value = interaction.fields.getTextInputValue('value').trim();
    const fixedTimes = validTimes(value);
    if (!fixedTimes.length) {
        await interaction.reply({ content: 'دخل وقت واحد على الأقل بصيغة HH:MM، مثلا 09:00, 18:30.', flags: 64 });
        return;
    }
    const config = await getUserDMConfig(interaction.user.id);
    const salawatConfig = { ...config.salawatConfig, enabled: true, scheduleMode: 'fixed' as const, fixedTimes, timezone: salawatTimezone(config) };
    salawatConfig.nextRunAt = nextSalawatRun({ ...config, salawatConfig });
    await interaction.deferUpdate();
    await updateUserDMConfig(interaction.user.id, { salawat: true, salawatConfig });
    await showPanel(interaction, 'more');
}
export async function handleDMJumuahTimeModal(interaction: ModalSubmitInteraction) { const value = interaction.fields.getTextInputValue('value').trim(); if (!validTime(value)) { await interaction.reply({ content: '\u274C \u0627\u0633\u062a\u0639\u0645\u0644 \u0635\u064a\u063a\u0629 HH:MM\u060c \u0645\u062b\u0644\u0627 08:00.', flags: 64 }); return; } const config = await getUserDMConfig(interaction.user.id); await interaction.deferUpdate(); await updateUserDMConfig(interaction.user.id, { jumuahConfig: { ...config.jumuahConfig, reminderTime: value } }); await showPanel(interaction, 'more'); }
export async function handleDMQuranTimeModal(interaction: ModalSubmitInteraction) { const value = interaction.fields.getTextInputValue('value').trim(); if (!validTime(value)) { await interaction.reply({ content: '\u274C \u0627\u0633\u062a\u0639\u0645\u0644 \u0635\u064a\u063a\u0629 HH:MM\u060c \u0645\u062b\u0644\u0627 09:00.', flags: 64 }); return; } const config = await getUserDMConfig(interaction.user.id); await interaction.deferUpdate(); await updateUserDMConfig(interaction.user.id, { quranConfig: { ...config.quranConfig, reminderTime: value } }); await showPanel(interaction, 'quran'); }




export async function handleDMDeleteCountModal(interaction: ModalSubmitInteraction) {
    const raw = interaction.fields.getTextInputValue('value').trim();
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
        await interaction.reply({ content: 'استعمل رقم صحيح بين 1 و 100.', flags: 64 });
        return;
    }
    if (interaction.inGuild()) {
        await interaction.reply({ content: 'تنظيف رسائل الرسائل الخاصة يعمل داخل الخاص فقط.', flags: 64 });
        return;
    }
    await interaction.deferUpdate();
    const deleted = await deleteNewestBotMessages(interaction, count);
    await showDeletePanel(interaction, `تم حذف ${deleted} رسالة من رسائل البوت.`);
}









