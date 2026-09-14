import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, GuildMember,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import cities from '../../data/cities.json';
import { listCities, listAreas } from '../../utils/locationCatalog';
import { activeAdhanSetups, buildAdhanSetupPayload, modeLabel } from './setupAdhan';
import { saveManagedAdhanZone } from '../../services/adhanZoneService';
import {
    adhanAudioLabel, saveAdhanAudioConfig, testConfiguredAdhan,
} from '../../services/adhanAudioService';
import { scheduleAdhanForGuild } from '../../services/adhanService';
import { sendAuditLog } from '../../services/auditLogService';

export async function handleAdhanSetupInteraction(interaction: any) {
    const session = activeAdhanSetups.get(interaction.user.id);
    if (!session || session.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ انتهت جلسة الإعداد. استعمل `/setup_adhan` من جديد.', flags: 64 });
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'adhan_setup_search_modal') {
        session.countryQuery = interaction.fields.getTextInputValue('country_query').trim();
        session.cityQuery = interaction.fields.getTextInputValue('city_query').trim();
        session.areaQuery = interaction.fields.getTextInputValue('area_query').trim();
        session.countryPage = 0; session.cityPage = 0; session.areaPage = 0;
        await interaction.deferUpdate();
        await interaction.editReply(buildAdhanSetupPayload(session));
        return;
    }
    if (interaction.isButton() && interaction.customId === 'adhan_setup_search') {
        const modal = new ModalBuilder().setCustomId('adhan_setup_search_modal').setTitle('البحث في القوائم');
        for (const [id, label, value] of [['country_query', 'اسم الدولة (فارغ لإظهار الكل)', session.countryQuery], ['city_query', 'اسم المدينة (فارغ لإظهار الكل)', session.cityQuery], ['area_query', 'اسم المنطقة (فارغ لإظهار الكل)', session.areaQuery]]) {
            const input = new TextInputBuilder().setCustomId(id!).setLabel(label!).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80);
            if (value) input.setValue(value);
            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        }
        await interaction.showModal(modal);
        return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId === 'adhan_setup_channel') {
        session.channelId = interaction.values[0];
        await interaction.update(buildAdhanSetupPayload(session));
        return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'adhan_setup_channel_id_modal') {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim().replace(/[<#>]/g, '');
        if (!/^\d{17,22}$/.test(channelId)) {
            await interaction.reply({ content: '❌ معرّف القناة غير صالح. دير Copy ID للقناة ولسق الرقم كامل.', flags: 64 });
            return;
        }

        await interaction.deferUpdate();
        const channel = await interaction.guild?.channels.fetch(channelId).catch(async () =>
            interaction.client.channels.fetch(channelId).catch(() => null),
        );
        if (!channel || channel.guildId !== interaction.guildId) {
            await interaction.followUp({ content: '❌ هاد معرّف القناة ما تابعش لهاد السيرفر أو البوت ما عندوش الوصول ليه.', flags: 64 });
            return;
        }
        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
            await interaction.followUp({ content: '❌ القناة تلقات، ولكن خاصها تكون نصية أو إعلانات channel.', flags: 64 });
            return;
        }

        session.channelId = channel.id;
        await interaction.editReply(buildAdhanSetupPayload(session));
        await interaction.followUp({ content: `✅ تم اختيار القناة <#${channel.id}> بنجاح.`, flags: 64 });
        return;
    }

    if (interaction.isStringSelectMenu()) {
        const value = interaction.values[0];
        if (interaction.customId === 'adhan_setup_country') {
            if (value === '__prev' || value === '__next') session.countryPage = Math.max(0, (session.countryPage || 0) + (value === '__next' ? 1 : -1));
            else {
                session.country = value;
                session.city = undefined; session.parentCity = undefined; session.countryPage = 0; session.cityPage = 0; session.areaPage = 0; session.countryQuery = undefined; session.cityQuery = undefined; session.areaQuery = undefined;
            }
        } else if (interaction.customId === 'adhan_setup_city' && value !== 'none') {
            if (value === '__prev' || value === '__next') session.cityPage = Math.max(0, Math.min(Math.ceil(listCities(session.country).length / 22) - 1, (session.cityPage || 0) + (value === '__next' ? 1 : -1)));
            else if (listCities(session.country).some(x => x.nameEn === value)) { session.parentCity = value; session.city = value; session.areaPage = 0; }
        } else if (interaction.customId === 'adhan_setup_area') {
            if (value === '__prev' || value === '__next') session.areaPage = Math.max(0, Math.min(Math.ceil(listAreas(session.parentCity).length / 22) - 1, (session.areaPage || 0) + (value === '__next' ? 1 : -1)));
            else if (value === '__center') session.city = session.parentCity;
            else if (listAreas(session.parentCity).some(x => x.nameEn === value)) session.city = value;
        } else if (interaction.customId === 'adhan_audio_mode') {
            session.audio.mode = value as typeof session.audio.mode;
        } else if (interaction.customId === 'adhan_audio_file') {
            session.audio.audioChoice = value;
        } else if (interaction.customId === 'adhan_audio_volume') {
            session.audio.volume = (Number(value) / 100) as typeof session.audio.volume;
        }
        await interaction.update(buildAdhanSetupPayload(session));
        return;
    }
    if (!interaction.isButton()) return;

    const id = interaction.customId;
    if (id === 'adhan_setup_cancel') {
        activeAdhanSetups.delete(interaction.user.id);
        await interaction.update({ content: 'تم إلغاء الإعداد بدون حفظ.', embeds: [], components: [] });
        return;
    }
    if (id === 'adhan_setup_channel_id') {
        const modal = new ModalBuilder().setCustomId('adhan_setup_channel_id_modal').setTitle('اختيار قناة الأذان بالـID');
        const input = new TextInputBuilder().setCustomId('channel_id').setLabel('لسق معرّف القناة هنا').setPlaceholder('مثال: 123456789012345678').setRequired(true).setMinLength(17).setMaxLength(22).setStyle(TextInputStyle.Short);
        if (session.channelId) input.setValue(session.channelId);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
        return;
    }
    if (id === 'adhan_setup_audio') {
        session.view = 'audio';
        await interaction.update(buildAdhanSetupPayload(session));
        return;
    }
    if (id === 'adhan_audio_back') {
        session.view = 'zone';
        await interaction.update(buildAdhanSetupPayload(session));
        return;
    }
    if (id === 'adhan_setup_save_zone') {
        if (!session.channelId || !session.country || !session.city) {
            await interaction.reply({ content: '❌ اختر القناة والدولة والمدينة قبل الحفظ.', flags: 64 });
            return;
        }
        const meta = cities.find(city => city.country === session.country && city.nameEn === session.city);
        if (!meta) {
            await interaction.reply({ content: '❌ تعذر العثور على بيانات المدينة.', flags: 64 });
            return;
        }
        await interaction.deferUpdate();
        await saveManagedAdhanZone(session.guildId, {
            country: meta.country, city: meta.nameEn, timezone: meta.timezone,
            channelId: session.channelId, enabled: session.zoneEnabled,
        }, interaction.user.id);
        await scheduleAdhanForGuild(session.guildId, interaction.client);
        await sendAuditLog(interaction.client, session.guildId, {
            level: 'info', system: 'Adhan', action: 'Adhan zone saved', actorId: interaction.user.id,
            details: `${meta.name} (${meta.countryAr}) — <#${session.channelId}> — ${meta.timezone}`,
        });
        activeAdhanSetups.delete(interaction.user.id);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ تم حفظ منطقة الأذان')
                .setDescription(`📍 **${meta.name} (${meta.nameEn})**\n🌍 ${meta.countryAr}\n💬 <#${session.channelId}>\n🕐 ${meta.timezone}\n\nتم تحديث مواعيد الأذان تلقائياً.`)],
            components: [],
        });
        return;
    }
    if (id === 'adhan_audio_save') {
        await interaction.deferUpdate();
        session.audio.updatedBy = interaction.user.id;
        session.audio.missingRoleSince = undefined;
        await saveAdhanAudioConfig(session.guildId, session.audio);
        await scheduleAdhanForGuild(session.guildId, interaction.client);
        await sendAuditLog(interaction.client, session.guildId, {
            level: 'info', system: 'Adhan', action: 'Global adhan audio settings saved', actorId: interaction.user.id,
            details: `${modeLabel(session.audio.mode)} — ${session.audio.audioChoice === 'random' ? 'عشوائي' : adhanAudioLabel(session.audio.audioChoice)} — ${Math.round(session.audio.volume * 100)}%`,
        });
        activeAdhanSetups.delete(interaction.user.id);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ تم حفظ إعداد صوت الأذان')
                .setDescription(`**الحالة:** ${modeLabel(session.audio.mode)}\n**الصوت:** ${session.audio.audioChoice === 'random' ? 'عشوائي' : adhanAudioLabel(session.audio.audioChoice)}\n**المستوى:** ${Math.round(session.audio.volume * 100)}%`)],
            components: [],
        });
        return;
    }
    if (id === 'adhan_audio_test') {
        await interaction.deferReply({ flags: 64 });
        const member = interaction.member as GuildMember;
        const result = await testConfiguredAdhan(interaction.client, member, session.audio);
        if (!result.played) {
            const messages: Record<string, string> = {
                admin_not_in_voice: '❌ ادخل إلى قناة صوتية أولاً.',
                missing_permissions: '❌ البوت لا يملك صلاحيات Connect وSpeak في قناتك.',
                audio_missing: '❌ لم يتم العثور على ملفات الأذان.',
                adhan_in_progress: '🕌 كاين أذان خدام الآن؛ تسنّى حتى يسالي ثم عاود التجربة.',
            };
            await interaction.editReply(messages[result.reason || ''] || '❌ تعذر تشغيل تجربة الأذان.');
            return;
        }
        await interaction.editReply(`✅ انتهت تجربة **${adhanAudioLabel(result.file!)}** كاملة، وتم استرجاع الصوت السابق إن كان موجوداً.`);
    }
}




