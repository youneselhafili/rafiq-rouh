import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
} from 'discord.js';
import { getBlacklistedUrls, removeFromBlacklist } from '../../services/blacklistService';

type BlacklistInteraction = ButtonInteraction | StringSelectMenuInteraction;

function buildBlacklistPanel() {
    const urls = getBlacklistedUrls();

    const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('🚫 الروابط المعطلة (Blacklist)')
        .setDescription(
            urls.length === 0
                ? '✅ لا توجد روابط في القائمة السوداء حالياً.'
                : `يوجد **${urls.length}** رابط معطّل. اختر رابطاً من القائمة أدناه لحذفه وإعادة تشغيله.`,
        )
        .setFooter({ text: 'الروابط المعطلة تُتجاهل تلقائياً أثناء التشغيل.' });

    if (urls.length > 0) {
        const preview = urls.slice(0, 10).map((e, i) => {
            const short = e.url.length > 55 ? `${e.url.slice(0, 52)}...` : e.url;
            const addedTs = Math.floor(new Date(e.addedAt).getTime() / 1000);
            const lastCheck = e.lastRetried ?? e.addedAt;
            const nextRetryTs = Math.floor(new Date(lastCheck).getTime() / 1000) + 3 * 24 * 3600;
            const attempts = e.retryCount ?? 0;
            return (
                `\`${i + 1}.\` ${short}\n` +
                `> ${e.reason} — أُضيف <t:${addedTs}:R>\n` +
                `> 🔁 محاولات الاسترداد: **${attempts}** · الفحص القادم: <t:${nextRetryTs}:R>`
            );
        }).join('\n\n');
        embed.addFields({ name: '📋 الروابط المعطلة', value: preview });
    }


    const components: ActionRowBuilder<any>[] = [];

    if (urls.length > 0) {
        const options = urls.slice(0, 25).map(e => ({
            label: e.url.length > 90 ? `${e.url.slice(0, 87)}...` : e.url,
            value: e.url,
            description: e.reason.slice(0, 50),
        }));
        const select = new StringSelectMenuBuilder()
            .setCustomId('blacklist_remove_url')
            .setPlaceholder('🗑️ اختر رابطاً لإزالته من القائمة السوداء')
            .addOptions(options);
        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }

    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('blacklist_refresh')
            .setLabel('تحديث القائمة')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('blacklist_close')
            .setLabel('إغلاق')
            .setStyle(ButtonStyle.Secondary),
    ));

    return { embeds: [embed], components };
}

export async function handleBlacklistInteraction(interaction: BlacklistInteraction): Promise<void> {
    const id = interaction.customId;

    if (id === 'blacklist_manage') {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
        const payload = buildBlacklistPanel();
        await interaction.editReply(payload);
        return;
    }

    if (id === 'blacklist_refresh') {
        await (interaction as ButtonInteraction).deferUpdate();
        const payload = buildBlacklistPanel();
        await interaction.editReply(payload);
        return;
    }

    if (id === 'blacklist_close') {
        await (interaction as ButtonInteraction).update({
            content: '✅ تم إغلاق لوحة إدارة الروابط المعطلة.',
            embeds: [],
            components: [],
        });
        return;
    }

    if (id === 'blacklist_remove_url' && interaction.isStringSelectMenu()) {
        await interaction.deferUpdate();
        const url = interaction.values[0];
        const removed = removeFromBlacklist(url);
        const payload = buildBlacklistPanel();
        const notice = removed
            ? `✅ تم إزالة الرابط من القائمة السوداء وسيُجرَّب مجدداً عند التشغيل التالي.`
            : `⚠️ لم يُعثر على هذا الرابط في القائمة.`;
        await interaction.editReply({ ...payload, content: notice });
        return;
    }
}
