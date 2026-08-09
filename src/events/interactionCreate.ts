import { Events, Interaction, ButtonInteraction, AttachmentBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { ExtendedClient } from '../handlers/commandHandler';
import { logger } from '../utils/logger';
import { generateAdhanImage, generateJumuahKahfImage } from '../services/canvasService';
import { streamSurahs } from '../services/quranService';
import { handleAdhanSetupInteraction } from '../commands/adhan/adhanSetupHandler';
import { handleSalawatSetupInteraction } from '../commands/salawat/salawatSetupHandler';
import { handleAdhkarSetupInteraction } from '../commands/adhkar/adhkarSetupHandler';
import { handleMyZoneInteraction } from '../commands/adhan/myZoneHandler';
import { handleTestInteraction } from '../commands/test/testHandler';
import { handleLogsSetupInteraction } from '../commands/logs/logsSetupHandler';
import { handleJumuahSetupInteraction } from '../commands/jumuah/jumuahSetupHandler';
import { handleKhatmaSetupInteraction } from '../commands/khatma/khatmaSetupHandler';
import { sendAuditLog } from '../services/auditLogService';

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction) {
    const client = interaction.client as ExtendedClient;

    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            logger.warn(`No command matching ${interaction.commandName} was found.`);
                    await interaction.reply({ content: '\u274C \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0637\u0644\u0628.', flags: 64 });
            return;
        }

        try {
            await command.execute(interaction);
            if (interaction.guildId) void sendAuditLog(client, interaction.guildId, { level: 'info', system: 'Command', action: '/' + interaction.commandName, actorId: interaction.user.id }).catch(() => {});
        } catch (error) {
            logger.error(`Error executing ${interaction.commandName}:`, error);
            const replyOptions = {
                content: '\u274C \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u062a\u0646\u0641\u064a\u0630 \u0647\u0630\u0627 \u0627\u0644\u0623\u0645\u0631!',
                flags: 64,
            };
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyOptions);
                } else {
                    await interaction.reply(replyOptions);
                }
            } catch (replyError) {
                logger.error('Failed to send error message to user:', replyError);
            }
        }
    } else if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);

        if (!command || !command.autocomplete) {
            await interaction.respond([]);
            return;
        }

        try {
            await command.autocomplete(interaction);
        } catch (error) {
            logger.error(`Autocomplete error in ${interaction.commandName}:`, error);
        }
    } else if (interaction.isModalSubmit()) {
        try {
            if (interaction.guildId) void sendAuditLog(client, interaction.guildId, { level: 'info', system: 'Interaction', action: 'Modal ' + interaction.customId, actorId: interaction.user.id }).catch(() => {});
            if (interaction.customId.startsWith('adhan_setup_')) {
                await handleAdhanSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('adhkar_setup_')) {
                await handleAdhkarSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('salawat_setup_')) {
                await handleSalawatSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('jumuah_setup_')) {
                await handleJumuahSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('khatma_setup_')) {
                await handleKhatmaSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('quran_setup_')) {
                const { handleQuranSetupInteraction } = await import('../commands/quran/quranSetupHandler');
                await handleQuranSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('logs_setup_')) {
                await handleLogsSetupInteraction(interaction as any);
            } else if (interaction.customId.startsWith('roles_setup_modal_')) {
                const { handleRolesSetupModal } = await import('../commands/roles/rolesSetupHandler');
                await handleRolesSetupModal(interaction as any);
            } else if (interaction.customId === 'dm_panel_city_modal' || interaction.customId === 'dm_panel_zone_modal') {
                const { handleDMZoneModal } = await import('../commands/dm/dmPanelHandler');
                await handleDMZoneModal(interaction as any);
            } else if (interaction.customId === 'dm_panel_salawat_times_modal') {
                const { handleDMSalawatTimesModal } = await import('../commands/dm/dmPanelHandler');
                await handleDMSalawatTimesModal(interaction as any);
            } else if (interaction.customId === 'dm_panel_jumuah_time_modal') {
                const { handleDMJumuahTimeModal } = await import('../commands/dm/dmPanelHandler');
                await handleDMJumuahTimeModal(interaction as any);
            } else if (interaction.customId === 'dm_panel_quran_time_modal') {
                const { handleDMQuranTimeModal } = await import('../commands/dm/dmPanelHandler');
                await handleDMQuranTimeModal(interaction as any);
            } else if (interaction.customId === 'dm_panel_delete_count_modal') {
                const { handleDMDeleteCountModal } = await import('../commands/dm/dmPanelHandler');
                await handleDMDeleteCountModal(interaction as any);
            }
        } catch (error) {
            logger.error(`Error handling modal ${interaction.customId}:`, error);
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '\u274C \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062c.', flags: 64 }).catch(() => {});
        }
    } else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
        try {
            if (interaction.guildId) void sendAuditLog(client, interaction.guildId, { level: 'info', system: 'Interaction', action: interaction.customId, actorId: interaction.user.id }).catch(() => {});
            if (interaction.customId.startsWith('quran_setup_')) {
                const { handleQuranSetupInteraction } = await import('../commands/quran/quranSetupHandler');
                await handleQuranSetupInteraction(interaction as any);
                return;
            }

            if (interaction.customId.startsWith('qr_')) {
                const { handleRadioInteractionV2 } = await import('../services/quranRadioServiceV2');
                await handleRadioInteractionV2(interaction);
                return;
            }

            if (interaction.customId.startsWith('adhan_')) {
                await handleAdhanSetupInteraction(interaction);
                return;
            }

            if (interaction.customId.startsWith('myzone_')) {
                await handleMyZoneInteraction(interaction as any);
                return;
            }

            if (interaction.customId.startsWith('test_cmd_')) {
                await handleTestInteraction(interaction as any);
                return;
            }

            if (interaction.customId.startsWith('salawat_setup_')) {
                await handleSalawatSetupInteraction(interaction);
                return;
            }

            if (interaction.customId.startsWith('jumuah_setup_')) {
                await handleJumuahSetupInteraction(interaction);
                return;
            }

            if (interaction.customId.startsWith('khatma_setup_')) {
                await handleKhatmaSetupInteraction(interaction);
                return;
            }

            if (interaction.customId.startsWith('adhkar_setup_')) {
                await handleAdhkarSetupInteraction(interaction);
                return;
            }

            if (interaction.customId.startsWith('logs_setup_')) {
                await handleLogsSetupInteraction(interaction);
                return;
            }

            if (interaction.customId.startsWith('roles_setup_') && interaction.isButton()) {
                const { handleRolesSetupInteraction } = await import('../commands/roles/rolesSetupHandler');
                await handleRolesSetupInteraction(interaction as any);
                return;
            }

            if (interaction.customId.startsWith('dm_setup_') && (interaction.isButton() || interaction.isChannelSelectMenu())) {
                const { handleDMSetupInteraction } = await import('../commands/dm/setupDm');
                await handleDMSetupInteraction(interaction as any);
                return;
            }

            if (interaction.customId.startsWith('dm_panel_') && (interaction.isButton() || interaction.isStringSelectMenu())) {
                const { handleDMPanelInteraction } = await import('../commands/dm/dmPanelHandler');
                await handleDMPanelInteraction(interaction as any);
                return;
            }

            if (interaction.customId === 'donate_copy_rib') {
                const { handleButton: handleDonateButton } = await import('../commands/info/donate');
                await handleDonateButton(interaction as any);
                return;
            }

            if (interaction.isButton()) {
                await handleButton(interaction);
            }

        } catch (error) {
            logger.error(`Error handling component interaction ${interaction.customId}:`, error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '\u274C \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0637\u0644\u0628.', flags: 64 });
                } else {
                    await interaction.reply({ content: '\u274C \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0637\u0644\u0628.', flags: 64 });
                }
            } catch (e) {
                logger.error('Failed to send fallback error response:', e);
            }
        }
    }
}

async function handleButton(interaction: ButtonInteraction) {
    try {
        await interaction.deferReply({ flags: 64 });
    } catch (error) {
        logger.error('Button interaction deferReply failed:', error);
        throw error;
    }

    try {
        let imageBuffer;
        let filename;

        switch (interaction.customId) {
            case 'test_adhan':
                imageBuffer = await generateAdhanImage('\u0627\u0644\u0631\u064a\u0627\u0636', '\u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629', 'Fajr', '04:30', '\u0648\u064e\u0623\u064e\u0642\u0650\u0645\u0650 \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u064e \u0625\u0650\u0646\u0651\u064e \u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0627\u0629\u064e \u062a\u064e\u0646\u0652\u0647\u064e\u0649 \u0639\u064e\u0646\u0650 \u0627\u0644\u0652\u0641\u064e\u062d\u0652\u0634\u064e\u0627\u0621\u0650 \u0648\u064e\u0627\u0644\u0652\u0645\u064f\u0646\u0643\u064e\u0631\u0650', '\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 45');
                filename = 'test_adhan.png';
                break;
            case 'test_jumuah':
                imageBuffer = await generateJumuahKahfImage('\u0627\u0644\u0644\u0647\u0645 \u0641\u064a \u064a\u0648\u0645 \u0627\u0644\u062c\u0645\u0639\u0629 \u0627\u062c\u0639\u0644 \u0644\u0646\u0627 \u0645\u0646 \u0643\u0644 \u0647\u0645 \u0641\u0631\u062c\u0627 \u0648\u0645\u0646 \u0643\u0644 \u0636\u064a\u0642 \u0645\u062e\u0631\u062c\u0627.', '\u064a\u0627\u0633\u0631 \u0627\u0644\u062f\u0648\u0633\u0631\u064a');
                filename = 'test_jumuah.png';
                break;
            case 'test_quran':
                const member = interaction.member as GuildMember;
                if (!member?.voice?.channel) {
                return await interaction.editReply('\u25B6\uFE0F \u062c\u0627\u0631\u064a \u0627\u062e\u062a\u0628\u0627\u0631 \u0627\u0644\u0635\u0648\u062a \u0641\u064a \u0642\u0646\u0627\u062a\u0643 \u0627\u0644\u0635\u0648\u062a\u064a\u0629 (\u0633\u0648\u0631\u0629 \u0627\u0644\u0641\u0627\u062a\u062d\u0629)...');
                }
                // Test stream: short MP3 url
                const testUrl = 'https://server7.mp3quran.net/basit/001.mp3'; // Al-Fatihah, Abdul Basit
                await streamSurahs(member.voice.channel, [testUrl]);
                return await interaction.editReply('\u25B6\uFE0F \u062c\u0627\u0631\u064a \u0627\u062e\u062a\u0628\u0627\u0631 \u0627\u0644\u0635\u0648\u062a \u0641\u064a \u0642\u0646\u0627\u062a\u0643 \u0627\u0644\u0635\u0648\u062a\u064a\u0629 (\u0633\u0648\u0631\u0629 \u0627\u0644\u0641\u0627\u062a\u062d\u0629)...');
            default:
                return await interaction.editReply('Unknown button action.');
        }

        const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
        await interaction.editReply({ files: [attachment] });
    } catch (error) {
        logger.error('Button interaction error:', error);
        if (interaction.deferred) {
            await interaction.editReply('\u274C \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0637\u0644\u0628.');
        }
    }
}











