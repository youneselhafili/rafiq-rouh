import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
} from 'discord.js';
import { KhatmaMode, KhatmaState } from '../../types';
import { activeKhatmaSetups, buildKhatmaSetupPayload } from './setupKhatma';
import {
    calculatePagesPerDay, setGuildKhatma, deleteGuildKhatma, QURAN_PAGE_IMAGE_BASE_URL,
    sendKhatmaPages, wasKhatmaSentToday,
} from '../../services/khatmaService';
import { getUserDMConfig, updateUserDMConfig } from '../../services/dmSubscriptionService';
import { sendAuditLog } from '../../services/auditLogService';
import { logger } from '../../utils/logger';

const MODE_ORDER: KhatmaMode[] = ['custom', 'week', 'month', '3_months', '6_months', 'ramadan'];

export async function handleKhatmaSetupInteraction(interaction: any) {
    const session = activeKhatmaSetups.get(interaction.user.id);
    if (!session || session.ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ انتهت جلسة الإعداد. استعمل `/nakhtim` من جديد.', flags: 64 });
        return;
    }
    if (session.scope === 'guild' && interaction.guildId && session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ جلسة الإعداد غير صالحة لهذا السيرفر.', flags: 64 });
        return;
    }

    if (interaction.isModalSubmit?.()) {
        if (interaction.customId === 'khatma_setup_channel_id_modal') {
            const channelId = interaction.fields.getTextInputValue('khatma_channel_id').trim().replace(/[<#>]/g, '');
            if (!/^\d{17,22}$/.test(channelId)) {
                await interaction.reply({ content: '❌ معرّف القناة غير صالح.', flags: 64 });
                return;
            }
            const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
            if (!channel || channel.guildId !== interaction.guildId ||
                (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
                await interaction.reply({ content: '❌ القناة غير موجودة أو ليست قناة نصية/إعلانات.', flags: 64 });
                return;
            }
            session.channelId = channel.id;
            await interaction.update(buildKhatmaSetupPayload(session));
            return;
        }
        if (interaction.customId === 'khatma_setup_custom_pages_modal') {
            const raw = interaction.fields.getTextInputValue('khatma_custom_pages').trim();
            const pages = Number(raw);
            if (!Number.isInteger(pages) || pages < 1 || pages > 604) {
                await interaction.reply({ content: '❌ عدد الصفحات يجب أن يكون رقما بين 1 و 604.', flags: 64 });
                return;
            }
            session.mode = 'custom';
            session.pagesPerDay = pages;
            await interaction.update(buildKhatmaSetupPayload(session));
            return;
        }
        if (interaction.customId === 'khatma_setup_ramadan_modal') {
            const raw = interaction.fields.getTextInputValue('khatma_ramadan').trim();
            const khatmas = Number(raw);
            if (!Number.isInteger(khatmas) || khatmas < 1 || khatmas > 10) {
                await interaction.reply({ content: '❌ عدد الختمات يجب أن يكون رقما بين 1 و 10.', flags: 64 });
                return;
            }
            session.mode = 'ramadan';
            session.ramadanKhatmas = khatmas;
            session.pagesPerDay = calculatePagesPerDay('ramadan', khatmas);
            await interaction.update(buildKhatmaSetupPayload(session));
            return;
        }
        return;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId === 'khatma_setup_mode') {
        const mode = interaction.values[0] as KhatmaMode;
        if (!MODE_ORDER.includes(mode)) return;
        session.mode = mode;
        session.pagesPerDay = calculatePagesPerDay(mode, session.ramadanKhatmas);
        await interaction.update(buildKhatmaSetupPayload(session));
        return;
    }

    if (interaction.isChannelSelectMenu?.() && interaction.customId === 'khatma_setup_channel') {
        session.channelId = interaction.values[0];
        await interaction.update(buildKhatmaSetupPayload(session));
        return;
    }

    if (!interaction.isButton?.()) return;
    const id = interaction.customId;

    if (id === 'khatma_setup_channel_id') {
        const input = new TextInputBuilder()
            .setCustomId('khatma_channel_id')
            .setLabel('معرّف قناة الختمة')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(22)
            .setPlaceholder('مثال: 123456789012345678');
        if (session.channelId) input.setValue(session.channelId);
        const modal = new ModalBuilder()
            .setCustomId('khatma_setup_channel_id_modal')
            .setTitle('اختيار قناة الختمة بالـID')
            .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }

    if (id === 'khatma_setup_preview_page') {
        const page = Math.max(1, Math.min(604, session.currentPage || 1));
        const filename = `quran_page_${page}.jpg`;
        await interaction.deferReply({ flags: 64 });
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('📖 معاينة صفحة الختمة')
                .setDescription(`هذه معاينة للصفحة الحالية **${page} / 604** ولا تغيّر تقدم الختمة.`)
                .setImage(`attachment://${filename}`)
                .setFooter({ text: 'اضغط حفظ في لوحة الختمة لتطبيق تغييرات الإعداد.' })],
            files: [new AttachmentBuilder(`${QURAN_PAGE_IMAGE_BASE_URL}/${page}.jpg`, { name: filename })],
        });
        return;
    }

    if (id === 'khatma_setup_custom_pages') {
        const input = new TextInputBuilder()
            .setCustomId('khatma_custom_pages')
            .setLabel('عدد الصفحات في اليوم (1-604)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(session.pagesPerDay))
            .setPlaceholder('مثلا 10');
        const modal = new ModalBuilder()
            .setCustomId('khatma_setup_custom_pages_modal')
            .setTitle('عدد الصفحات المخصص')
            .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }

    if (id === 'khatma_setup_ramadan') {
        const input = new TextInputBuilder()
            .setCustomId('khatma_ramadan')
            .setLabel('عدد الختمات الرمضانية (1-10)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(session.ramadanKhatmas))
            .setPlaceholder('مثلا 3');
        const modal = new ModalBuilder()
            .setCustomId('khatma_setup_ramadan_modal')
            .setTitle('ختمة رمضانية')
            .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }

    if (id === 'khatma_setup_toggle') {
        session.enabled = !session.enabled;
        await interaction.update(buildKhatmaSetupPayload(session));
        return;
    }

    if (id === 'khatma_setup_reset_progress') {
        session.currentPage = 1;
        session.lastSentAt = undefined;
        session.restartFromFirstPage = true;
        await interaction.update(buildKhatmaSetupPayload(session));
        return;
    }

    if (id === 'khatma_setup_cancel') {
        activeKhatmaSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }

    if (id === 'khatma_setup_delete') {
        session.deleteExpiresAt = Date.now() + 2 * 60 * 1000;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('khatma_setup_confirm_delete').setLabel('نعم، احذف').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('khatma_setup_cancel_delete').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: '⚠️ واش متأكد بغيتي تحذف إعداد الختمة وتوقفه؟ التأكيد صالح لدقيقتين.', components: [row], flags: 64 });
        return;
    }

    if (id === 'khatma_setup_cancel_delete') {
        session.deleteExpiresAt = undefined;
        await interaction.update({ content: 'تم إلغاء الحذف.', components: [] });
        return;
    }

    if (id === 'khatma_setup_confirm_delete') {
        if (!session.deleteExpiresAt || session.deleteExpiresAt < Date.now()) {
            await interaction.update({ content: '❌ انتهت مهلة التأكيد.', components: [] });
            return;
        }
        await interaction.deferUpdate();
        if (session.scope === 'guild') {
            await deleteGuildKhatma(session.guildId!);
            await sendAuditLog(interaction.client, session.guildId!, {
                level: 'config', system: 'Khatma', action: 'Khatma configuration deleted', actorId: interaction.user.id,
            });
        } else {
            const config = await getUserDMConfig(interaction.user.id);
            await updateUserDMConfig(interaction.user.id, {
                khatma: {
                    enabled: false,
                    currentPage: 1,
                    pagesPerDay: session.pagesPerDay,
                    mode: session.mode,
                    ramadanKhatmas: session.ramadanKhatmas,
                    updatedAt: new Date().toISOString(),
                },
            });
        }
        activeKhatmaSetups.delete(interaction.user.id);
        await interaction.editReply({ content: '✅ تم حذف إعداد الختمة.', components: [] });
        return;
    }

    if (id === 'khatma_setup_save') {
        if (session.scope === 'guild' && !session.channelId) {
            await interaction.reply({ content: '❌ خاصك تختار القناة التي تُرسل فيها صفحات الختمة أولا.', flags: 64 });
            return;
        }
        await interaction.deferUpdate();

        const currentPage = session.currentPage > 604 ? 1 : session.currentPage;
        const forceInitialDelivery = session.restartFromFirstPage === true;
        const now = new Date().toISOString();
        let nextPage = currentPage;
        let initialDelivery: 'sent' | 'already_sent' | 'failed' | 'stopped' = session.enabled ? 'failed' : 'stopped';

        if (session.scope === 'guild') {
            const state: KhatmaState = {
                id: session.guildId!,
                isGuild: true,
                channelId: session.channelId,
                currentPage,
                pagesPerDay: session.pagesPerDay,
                mode: session.mode,
                ramadanKhatmas: session.mode === 'ramadan' ? session.ramadanKhatmas : undefined,
                isActive: session.enabled,
                lastSentAt: session.lastSentAt,
                createdAt: now,
                updatedAt: now,
            };
            await setGuildKhatma(session.guildId!, state);
            if (session.enabled) {
                if (!forceInitialDelivery && wasKhatmaSentToday(state.lastSentAt)) {
                    initialDelivery = 'already_sent';
                } else {
                    initialDelivery = await sendKhatmaPages(interaction.client, state) ? 'sent' : 'failed';
                    nextPage = state.currentPage;
                }
            }
            await sendAuditLog(interaction.client, session.guildId!, {
                level: 'config',
                system: 'Khatma',
                action: 'Khatma settings saved',
                actorId: interaction.user.id,
                details:
                    `${session.enabled ? 'مفعّل' : 'متوقف'} — <#${session.channelId}> — ` +
                    `الوضع ${session.mode} — ${session.pagesPerDay} صفحة/اليوم`,
            });
        } else {
            const config = await getUserDMConfig(interaction.user.id);
            await updateUserDMConfig(interaction.user.id, {
                khatma: {
                    enabled: session.enabled,
                    currentPage,
                    pagesPerDay: session.pagesPerDay,
                    mode: session.mode,
                    ramadanKhatmas: session.mode === 'ramadan' ? session.ramadanKhatmas : undefined,
                    lastSentAt: session.lastSentAt,
                    updatedAt: now,
                },
            });
            if (session.enabled) {
                const state: KhatmaState = {
                    id: interaction.user.id,
                    isGuild: false,
                    currentPage,
                    pagesPerDay: session.pagesPerDay,
                    mode: session.mode,
                    ramadanKhatmas: session.mode === 'ramadan' ? session.ramadanKhatmas : undefined,
                    isActive: true,
                    lastSentAt: session.lastSentAt,
                    createdAt: now,
                    updatedAt: now,
                };
                if (!forceInitialDelivery && wasKhatmaSentToday(state.lastSentAt)) {
                    initialDelivery = 'already_sent';
                } else {
                    initialDelivery = await sendKhatmaPages(interaction.client, state) ? 'sent' : 'failed';
                    nextPage = state.currentPage;
                }
            }
        }

        activeKhatmaSetups.delete(interaction.user.id);
        await interaction.editReply({
            embeds: [{
                color: 0x57f287,
                title: '✅ تم حفظ إعداد الختمة',
                description:
                    `**الحالة:** ${session.enabled ? '✅ مفعّل' : '⏸️ متوقف'}\n` +
                    `**الوضع:** ${session.mode}\n` +
                    `**الصفحات في اليوم:** ${session.pagesPerDay}\n` +
                    `**الصفحة القادمة:** ${Math.min(nextPage, 604)} / 604\n` +
                    (session.scope === 'guild' ? `**القناة:** <#${session.channelId}>\n` : '') +
                    (initialDelivery === 'sent' ? '**أول إرسال:** ✅ تم إرسال الدفعة الأولى الآن\n'
                        : initialDelivery === 'already_sent' ? '**أول إرسال:** ✅ تم الإرسال اليوم؛ لن تتكرر الدفعة\n'
                            : initialDelivery === 'failed' ? '**أول إرسال:** ⚠️ تعذر الآن؛ سيعيد المحاولة في الموعد اليومي\n'
                                : '**أول إرسال:** لن يتم حتى تفعيل الختمة\n') +
                    `**الإرسال التالي:** يومياً الساعة 08:00 بتوقيت مكة`,
            }],
            components: [],
        });
        return;
    }
}
