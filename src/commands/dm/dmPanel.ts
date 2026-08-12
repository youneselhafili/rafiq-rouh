import {
    ApplicationIntegrationType,
    ChatInputCommandInteraction,
    InteractionContextType,
    SlashCommandBuilder,
} from 'discord.js';
import { sendDMPanel } from './setupDm';

export const data = new SlashCommandBuilder()
    .setName('dm_panel')
    .setDescription('إرسال وتثبيت لوحة إعداداتك الخاصة')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    await sendDMPanel(interaction);
}
