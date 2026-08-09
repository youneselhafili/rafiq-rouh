import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { getAllReciters } from '../quran/quranRegistry';
import type { QuranRuntimeState } from './quranRadioServiceV2';

export function buildQuranPanel(state: QuranRuntimeState) {
    const current = state.currentTrack
        ? `📖 **${state.currentTrack.title}**\n🎙️ ${state.currentTrack.subtitle || 'غير محدد'}`
        : state.mode === 'Makkah' ? '🕋 بث الحرم المكي'
            : state.mode === 'Madinah' ? '🕌 بث المسجد النبوي'
                : state.mode === 'Radio' ? `📡 ${state.radioLabel || 'إذاعة مباشرة'}`
                    : state.mode === 'AudioLibrary' ? '📚 اختر القارئ وطريقة التشغيل' : '⏸️ في انتظار الاختيار';

    const embed = new EmbedBuilder()
        .setColor(0x2e8b57)
        .setTitle('📻 إذاعة رفيق الروح الإسلامية')
        .setDescription(
            `${current}\n\n` +
            `👤 **المتحكم:** ${state.controllerId ? `<@${state.controllerId}>` : 'لا يوجد'}\n` +
            `🎵 **طريقة التشغيل:** ${state.playbackMode || 'عادي'}\n` +
            `📋 **المتبقي:** ${Math.max(0, state.queue.length - state.currentIndex - 1)}\n` +
            `🕐 **24/24:** ${state.twentyFourSeven ? '✅' : '❌'}\n\n` +
            '🔴 **معلومة:** جميع الإذاعات هنا بث مباشر.',
        )
        .setTimestamp();

    const sources = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_btn_makkah').setLabel('الحرم المكي').setEmoji('🕋').setStyle(state.mode === 'Makkah' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('qr_btn_madinah').setLabel('المسجد النبوي').setEmoji('🕌').setStyle(state.mode === 'Madinah' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('qr_btn_audio_library').setLabel('المكتبة الصوتية').setEmoji('📚').setStyle(['AudioLibrary', 'Reciter'].includes(state.mode) ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    const secondRow = state.phase === 'choose_mode'
        ? new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_mode_ordered').setLabel('بالترتيب').setEmoji('🔢').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('qr_mode_random').setLabel('عشوائي').setEmoji('🔀').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('qr_mode_manual').setLabel('اختيار سورة').setEmoji('📖').setStyle(ButtonStyle.Primary),
        )
        : new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_btn_radio_saudi').setLabel('إذاعة القرآن').setEmoji('🇸🇦').setStyle(state.mode === 'Radio' && state.radioLabel?.includes('السعودية') ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_radio_sunnah').setLabel('راديو السنة').setEmoji('📡').setStyle(state.mode === 'Radio' && state.radioLabel?.includes('السنة') ? ButtonStyle.Success : ButtonStyle.Secondary),
        );

    let selector: ActionRowBuilder<StringSelectMenuBuilder>;
    if (state.phase === 'choose_surah' && state.selectedReciterId) {
        const reciter = getAllReciters().find(r => r.id === state.selectedReciterId);
        const pageStart = state.surahPage * 25;
        const items = reciter?.surahs.slice(pageStart, pageStart + 25) || [];
        selector = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('qr_select_surah').setPlaceholder(`اختر السورة — صفحة ${state.surahPage + 1}/5`).addOptions(
                items.map((s, i) => ({ label: `${pageStart + i + 1}. ${s.name}`, value: String(pageStart + i) })),
            ),
        );
    } else {
        const reciters = getAllReciters();
        selector = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('qr_select_reciter')
                .setPlaceholder(state.mode === 'AudioLibrary' || state.mode === 'Reciter' ? 'اختر القارئ...' : 'اختر المكتبة الصوتية أولاً')
                .setDisabled(!(state.mode === 'AudioLibrary' || state.mode === 'Reciter'))
                .addOptions(reciters.map(r => ({ label: r.name, value: r.id, default: r.id === state.selectedReciterId }))),
        );
    }

    const transport = state.phase === 'choose_surah'
        ? new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_surah_prevpage').setLabel('السابق').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(state.surahPage === 0),
            new ButtonBuilder().setCustomId('qr_surah_nextpage').setLabel('التالي').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(state.surahPage >= 4),
            new ButtonBuilder().setCustomId('qr_back_library').setLabel('رجوع').setStyle(ButtonStyle.Secondary),
        )
        : new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_btn_prev').setLabel('السابق').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_toggle_pause').setLabel(state.isPaused ? 'استئناف' : 'Pause').setEmoji(state.isPaused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_next').setLabel('التالي').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_stop').setLabel('\u0625\u064a\u0642\u0627\u0641').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        );

    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_playlist').setLabel('قائمتي').setEmoji('📋').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('qr_btn_refresh').setLabel('تحديث').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [sources, secondRow, selector, transport, actions] };
}
