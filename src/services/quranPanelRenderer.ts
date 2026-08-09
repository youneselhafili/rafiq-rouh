import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} from 'discord.js';
import { COLORS, BOT_FOOTER } from '../utils/constants';
import { RadioState } from './quranRadioService';
import { getAllReciters } from '../quran/quranRegistry';

export interface PanelPayload {
    embeds: [EmbedBuilder];
    components: ActionRowBuilder<any>[];
}

export async function buildControlPanel(
    controllerTag: string | null,
    state: RadioState,
): Promise<PanelPayload> {
    const embed = new EmbedBuilder()
        .setColor(COLORS.QURAN)
        .setTitle('📻 إذاعة رفيق الروح الإسلامية')
        .setFooter({ text: BOT_FOOTER })
        .setTimestamp();

    const controllerName = controllerTag ? `\`${controllerTag}\`` : 'لا يوجد';

    let statusText = '🟢 في انتظار اختيارك...';
    let modeIcon = '⏸️';

    if (state.mode === 'Makkah') {
        statusText = '📻 بث مباشر: **الحرم المكي**';
        modeIcon = '🕋';
    } else if (state.mode === 'Madinah') {
        statusText = '📻 بث مباشر: **المسجد النبوي**';
        modeIcon = '🕌';
    } else if (state.mode === 'Radio' && state.radioLabel) {
        statusText = `📻 **${state.radioLabel}**`;
        modeIcon = '📡';
    } else if (state.mode === 'AudioLibrary') {
        statusText = '📚 **المكتبة الصوتية للقرآن الكريم**\n🎧 اختر قارئاً من القائمة أدناه';
        modeIcon = '🎶';
    } else if (state.mode === 'Reciter' && state.reciterName) {
        statusText = `🎧 القارئ: **${state.reciterName}**`;
        modeIcon = '🎶';
        if (state.surahIndex !== undefined && state.surahTotal !== undefined) {
            statusText += `\n📖 السورة: **${state.surahIndex + 1}** / ${state.surahTotal}`;
        }
    }

    if (state.isPaused) statusText += '\n\n⏸️ *متوقف مؤقتاً*';

    const twentyFourStatus = state.twentyFourSeven ? '🕐 24/24 ✅' : '🕐 24/24 ❌';

    embed.setDescription(
        `${modeIcon} **الحالة:**\n${statusText}\n\n` +
        `👤 **المتحكم:** ${controllerName}\n` +
        `${twentyFourStatus}`
    );

    // ─── Row 1: Source Selection ──────────────────────────────
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('qr_btn_makkah')
            .setLabel('🕋 الحرم المكي')
            .setStyle(state.mode === 'Makkah' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('qr_btn_madinah')
            .setLabel('🕌 المسجد النبوي')
            .setStyle(state.mode === 'Madinah' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('qr_btn_audio_library')
            .setLabel('📚 المكتبة الصوتية')
            .setStyle(state.mode === 'AudioLibrary' || state.mode === 'Reciter' ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    // ─── Row 2: Radios ────────────────────────────────────────
    const isRadio = state.mode === 'Radio';
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('qr_btn_radio_saudi')
            .setLabel('🇸🇦 إذاعة القرآن')
            .setStyle(isRadio && state.radioLabel === 'إذاعة القرآن الكريم السعودية' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('qr_btn_radio_sunnah')
            .setLabel('📡 راديو السنة')
            .setStyle(isRadio && state.radioLabel === 'راديو السنة النبوية' ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    // ─── Row 3: Reciter Select ─────────────────────────────────
    const reciters = getAllReciters();
    const showReciter = state.mode === 'AudioLibrary' || state.mode === 'Reciter';
    const reciterSelect = new StringSelectMenuBuilder()
        .setCustomId('qr_select_reciter')
        .setPlaceholder(showReciter ? '🎧 اختر القارئ...' : '📚 اختر المكتبة الصوتية أولاً')
        .setDisabled(!showReciter)
        .addOptions(
            reciters.length > 0
                ? reciters.map((r) => ({
                    label: r.name,
                    value: r.id,
                    default: r.id === state.reciterId,
                }))
                : [{ label: 'لا يوجد قرّاء', value: 'none' }]
        );
    const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(reciterSelect);

    // ─── Row 4: Transport Controls ────────────────────────────
    const isReciter = state.mode === 'Reciter';
    const isPlaying = state.mode !== 'Idle' && state.mode !== 'AudioLibrary';
    const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('qr_btn_prev')
            .setLabel('⏮️ السابق')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!isReciter),
        new ButtonBuilder()
            .setCustomId('qr_btn_toggle_pause')
            .setLabel(state.isPaused ? '▶️ استئناف' : '⏸️ إيقاف مؤقت')
            .setStyle(state.isPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(!isPlaying),
        new ButtonBuilder()
            .setCustomId('qr_btn_next')
            .setLabel('⏭️ التالي')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!isReciter),
        new ButtonBuilder()
            .setCustomId('qr_btn_stop')
            .setLabel('⏹️ إيقاف')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isPlaying),
        new ButtonBuilder()
            .setCustomId('qr_btn_disconnect')
            .setLabel('🔇 قطع الاتصال')
            .setStyle(ButtonStyle.Danger),
    );

    // ─── Row 5: Refresh + 24/24 Toggle ────────────────────────
    const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('qr_btn_refresh')
            .setLabel('🔄 تحديث')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('qr_btn_toggle_24h')
            .setLabel(state.twentyFourSeven ? '🕐 24/24: ✅' : '🕐 24/24: ❌')
            .setStyle(state.twentyFourSeven ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    return {
        embeds: [embed],
        components: [row1, row2, row3, row4, row5],
    };
}
