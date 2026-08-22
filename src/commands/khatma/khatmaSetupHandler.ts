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
import { activeKhatmaSetups, buildKhatmaSetupPayload, khatmaSetupKey } from './setupKhatma';
import {
    calculatePagesPerDay, setGuildKhatma, deleteGuildKhatma, QURAN_PAGE_IMAGE_BASE_URL,
    sendKhatmaPages, wasKhatmaSentToday,
} from '../../services/khatmaService';
import { getUserDMConfig, updateUserDMConfig } from '../../services/dmSubscriptionService';
import { sendAuditLog } from '../../services/auditLogService';
import { logger } from '../../utils/logger';
import { buildPublicPersonalKhatmaPanel } from './personalKhatmaHandler';
import { getPersonalKhatmaPanel, setPersonalKhatmaPanel } from '../../services/personalGuildKhatmaService';

const MODE_ORDER: KhatmaMode[] = ['custom', 'week', 'month', '3_months', '6_months', 'ramadan'];

export async function handleKhatmaSetupInteraction(interaction: any) {
    const lookupKey = interaction.guildId
        ? khatmaSetupKey('guild', interaction.user.id, interaction.guildId)
        : khatmaSetupKey('dm', interaction.user.id);
    const session = activeKhatmaSetups.get(lookupKey);
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
            const channelIds = [
                {
                    fieldId: 'khatma_channel_id',
                    label: 'قناة الختمة الجماعية',
                    assign: (channelId: string) => { session.channelId = channelId; },
                },
                {
                    fieldId: 'personal_khatma_channel_id',
                    label: 'قناة الورد الشخصي',
                    assign: (channelId: string) => { session.personalChannelId = channelId; },
                },
            ].map(item => ({
                ...item,
                channelId: interaction.fields.getTextInputValue(item.fieldId).trim().replace(/[<#>]/g, ''),
            })).filter(item => item.channelId);

            if (!channelIds.length) {
                await interaction.reply({ content: '❌ دخل معرّف قناة واحدة على الأقل.', flags: 64 });
                return;
            }

            const validatedChannels: Array<{ assign: (channelId: string) => void; channelId: string }> = [];
            for (const item of channelIds) {
                if (!/^\d{17,22}$/.test(item.channelId)) {
                    await interaction.reply({ content: `❌ معرّف ${item.label} غير صالح.`, flags: 64 });
                    return;
                }
                const channel = await interaction.guild?.channels.fetch(item.channelId).catch(() => null);
                if (!channel || channel.guildId !== interaction.guildId ||
                    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
                    await interaction.reply({ content: `❌ ${item.label} غير موجودة أو ليست قناة نصية/إعلانات.`, flags: 64 });
                    return;
                }
                validatedChannels.push({ assign: item.assign, channelId: channel.id });
            }

            for (const item of validatedChannels) item.assign(item.channelId);

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

    if (interaction.isChannelSelectMenu?.() && interaction.customId === 'khatma_setup_personal_channel') {
        session.personalChannelId = interaction.values[0];
        await interaction.update(buildKhatmaSetupPayload(session));
        return;
    }

    if (!interaction.isButton?.()) return;
    const id = interaction.customId;

    if (id === 'khatma_setup_publish_personal') {
        if (session.scope !== 'guild' || !session.personalChannelId) {
            await interaction.reply({ content: '❌ اختر قناة الورد الشخصي أولاً، ثم انشر اللوحة.', flags: 64 });
            return;
        }
        await interaction.deferReply({ flags: 64 });
        const channel = await interaction.guild?.channels.fetch(session.personalChannelId).catch(() => null);
        if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
            await interaction.editReply('❌ تعذر الوصول إلى قناة الورد الشخصي أو الإرسال فيها.');
            return;
        }
        const existingPanel = await getPersonalKhatmaPanel(session.guildId!);
        const existingMessage = existingPanel?.channelId === session.personalChannelId && existingPanel.messageId
            ? await channel.messages.fetch(existingPanel.messageId).catch(() => null)
            : null;
        const message = existingMessage
            ? await existingMessage.edit(buildPublicPersonalKhatmaPanel())
            : await channel.send(buildPublicPersonalKhatmaPanel());
        await message.pin('لوحة الورد الشخصي للقرآن').catch(() => null);

        if (existingPanel?.messageId && existingPanel.channelId !== session.personalChannelId) {
            const oldChannel = await interaction.guild?.channels.fetch(existingPanel.channelId).catch(() => null);
            if (oldChannel && 'messages' in oldChannel) {
                const oldMessage = await oldChannel.messages.fetch(existingPanel.messageId).catch(() => null);
                await oldMessage?.delete().catch(() => null);
            }
        }

        await setPersonalKhatmaPanel(session.guildId!, {
            channelId: session.personalChannelId,
            messageId: message.id,
            updatedAt: new Date().toISOString(),
        });
        await interaction.editReply(`✅ تم نشر لوحة الورد الشخصي في <#${session.personalChannelId}>. قناة الختمة الجماعية لم تتغير.`);
        return;
    }

    if (id === 'khatma_setup_channel_id') {
        const khatmaInput = new TextInputBuilder()
            .setCustomId('khatma_channel_id')
            .setLabel('ID قناة الختمة الجماعية')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMinLength(17)
            .setMaxLength(22)
            .setPlaceholder('مثال: 123456789012345678');
        if (session.channelId) khatmaInput.setValue(session.channelId);

        const personalInput = new TextInputBuilder()
            .setCustomId('personal_khatma_channel_id')
            .setLabel('ID قناة الورد الشخصي')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMinLength(17)
            .setMaxLength(22)
            .setPlaceholder('مثال: 123456789012345678');
        if (session.personalChannelId) personalInput.setValue(session.personalChannelId);

        const modal = new ModalBuilder()
            .setCustomId('khatma_setup_channel_id_modal')
            .setTitle('إدخال ID قنوات الختمة والورد')
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(khatmaInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(personalInput),
            );
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
        activeKhatmaSetups.delete(lookupKey);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }

    if (id === 'khatma_setup_delete') {
        session.deleteExpiresAt = Date.now() + 2 * 60 * 1000;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('khatma_setup_confirm_delete').setLabel('نعم، احذف').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('khatma_setup_cancel_delete').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: '⚠️ هل أنت متأكد من حذف إعداد الختمة وإيقافه؟ التأكيد صالح لمدة دقيقتين.', components: [row], flags: 64 });
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
        activeKhatmaSetups.delete(lookupKey);
        await interaction.editReply({ content: '✅ تم حذف إعداد الختمة.', components: [] });
        return;
    }

    if (id === 'khatma_setup_save') {
        if (session.scope === 'guild' && !session.channelId) {
            await interaction.reply({ content: '❌ يجب أن تختار القناة التي تُرسل فيها صفحات الختمة أولا.', flags: 64 });
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

        activeKhatmaSetups.delete(lookupKey);
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
