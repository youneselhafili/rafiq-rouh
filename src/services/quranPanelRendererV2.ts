import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { getAllReciters } from '../quran/quranRegistry';
import type { QuranRuntimeState } from './quranRadioServiceV2';

export function buildQuranPanel(state: QuranRuntimeState) {
    const allReciters = getAllReciters();
    const current = state.currentTrack
        ? `📖 **${state.currentTrack.title}**\n🎙️ ${state.currentTrack.subtitle || 'غير محدد'}`
        : state.mode === 'QuranKareem' ? '📖 القرآن الكريم (بث عشوائي 24/24)'
            : state.mode === 'FavoriteReciters' ? '⭐ القراء المفضلون — اختر القارئ وطريقة التشغيل'
            : state.mode === 'AudioLibrary' ? '📚 المكتبة الصوتية — اختر القارئ وطريقة التشغيل' : '⏸️ في انتظار الاختيار';

    const embed = new EmbedBuilder()
        .setColor(0x2e8b57)
        .setTitle('📻 إذاعة رفيق الروح الإسلامية')
        .setDescription(
            `${current}\n\n` +
            `👤 **المتحكم:** ${state.controllerId ? `<@${state.controllerId}>` : 'لا يوجد'}\n` +
            `🎙️ **القراء المتوفرون:** ${allReciters.length}\n` +
            `🎵 **طريقة التشغيل:** ${state.playbackMode || 'عادي'}\n` +
            `📋 **المتبقي:** ${Math.max(0, state.queue.length - state.currentIndex - 1)}\n` +
            `🕐 **24/24:** ${state.twentyFourSeven ? '✅' : '❌'}\n\n` +
            '✨ **معلومة:** تشغيل القرآن الكريم يدور عشوائياً بين جميع القراء والتلاوات على مدار 24 ساعة.',
        )
        .setFooter({ text: 'رفيق الروح • المطوّر: يونس الحافلي • قرآن 24/24' })
        .setTimestamp();

    const selectedReciter = allReciters.find(r => r.id === state.selectedReciterId);
    
    const isFavoriteActive = state.mode === 'FavoriteReciters' || 
        (state.mode === 'Reciter' && selectedReciter?.category === 'favorite');
        
    const isLibraryActive = state.mode === 'AudioLibrary' || 
        (state.mode === 'Reciter' && selectedReciter?.category === 'library');

    const sources = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_btn_quran_kareem').setLabel('القرآن الكريم').setEmoji('📖').setStyle(state.mode === 'QuranKareem' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('qr_btn_favorite_reciters').setLabel('القراء المفضلون').setEmoji('⭐').setStyle(isFavoriteActive ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('qr_btn_audio_library').setLabel('المكتبة الصوتية').setEmoji('📚').setStyle(isLibraryActive ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    const componentsList: ActionRowBuilder<any>[] = [sources];

    if (state.phase === 'choose_mode') {
        const modeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_mode_ordered').setLabel('بالترتيب').setEmoji('🔢').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('qr_mode_random').setLabel('عشوائي').setEmoji('🔀').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('qr_mode_manual').setLabel('اختيار سورة').setEmoji('📖').setStyle(ButtonStyle.Primary),
        );
        componentsList.push(modeRow);
    }

    let selector: ActionRowBuilder<StringSelectMenuBuilder>;
    if (state.phase === 'choose_surah' && state.selectedReciterId) {
        const reciter = allReciters.find(r => r.id === state.selectedReciterId);
        const pageStart = state.surahPage * 25;
        const items = reciter?.surahs.slice(pageStart, pageStart + 25) || [];
        selector = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('qr_select_surah').setPlaceholder(`اختر السورة — صفحة ${state.surahPage + 1}/5`).addOptions(
                items.map((s, i) => ({ label: `${pageStart + i + 1}. ${s.name}`, value: String(pageStart + i) })),
            ),
        );
    } else {
        let reciterCategory: 'favorite' | 'library' = 'favorite';
        if (state.mode === 'AudioLibrary') {
            reciterCategory = 'library';
        } else if (state.mode === 'FavoriteReciters') {
            reciterCategory = 'favorite';
        } else if (state.mode === 'Reciter' && selectedReciter) {
            reciterCategory = selectedReciter.category || 'favorite';
        }

        const filteredReciters = allReciters.filter(r => r.category === reciterCategory);
        
        let displayReciters = filteredReciters;
        let placeholder = 'اختر القارئ...';
        
        if (reciterCategory === 'library') {
            const pageStart = (state.reciterPage || 0) * 25;
            const totalPages = Math.ceil(filteredReciters.length / 25) || 1;
            displayReciters = filteredReciters.slice(pageStart, pageStart + 25);
            placeholder = `اختر القارئ — صفحة ${(state.reciterPage || 0) + 1}/${totalPages}`;
        } else {
            placeholder = 'اختر القارئ المفضل...';
        }

        const isEnabled = ['AudioLibrary', 'FavoriteReciters', 'Reciter'].includes(state.mode);

        selector = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('qr_select_reciter')
                .setPlaceholder(isEnabled ? placeholder : 'اختر القراء المفضلين أو المكتبة الصوتية أولاً')
                .setDisabled(!isEnabled)
                .addOptions(
                    displayReciters.map(r => ({
                        label: r.name,
                        value: r.id,
                        default: r.id === state.selectedReciterId
                    }))
                ),
        );
    }
    componentsList.push(selector);

    let transport: ActionRowBuilder<ButtonBuilder>;
    if (state.phase === 'choose_surah') {
        transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_surah_prevpage').setLabel('السابق').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(state.surahPage === 0),
            new ButtonBuilder().setCustomId('qr_surah_nextpage').setLabel('التالي').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(state.surahPage >= 4),
            new ButtonBuilder().setCustomId('qr_back_library').setLabel('رجوع').setStyle(ButtonStyle.Secondary),
        );
    } else if (state.mode === 'AudioLibrary' && state.phase === 'main') {
        const filteredReciters = allReciters.filter(r => r.category === 'library');
        const totalPages = Math.ceil(filteredReciters.length / 25) || 1;
        const currentPage = state.reciterPage || 0;
        
        transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_reciter_prevpage').setLabel('السابق').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
            new ButtonBuilder().setCustomId('qr_reciter_nextpage').setLabel('التالي').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
            new ButtonBuilder().setCustomId('qr_btn_stop').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        );
    } else {
        transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('qr_btn_prev').setLabel('السابق').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_toggle_pause').setLabel(state.isPaused ? 'استئناف' : 'Pause').setEmoji(state.isPaused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_next').setLabel('التالي').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('qr_btn_stop').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        );
    }
    componentsList.push(transport);

    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('qr_playlist').setLabel('قائمتي').setEmoji('📋').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('qr_btn_refresh').setLabel('تحديث').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    );
    componentsList.push(actions);

    return { embeds: [embed], components: componentsList };
}
