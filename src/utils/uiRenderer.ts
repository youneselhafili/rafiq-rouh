import {
    ActionRowBuilder,
    ButtonBuilder,
    ChannelSelectMenuBuilder,
    EmbedBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { BOT_FOOTER, BOT_NAME, COLORS } from './constants';

export const UI_COLORS = {
    BRAND: 0xD8AA4D,
    PRIMARY: 0x5865F2,
    SUCCESS: 0x57F287,
    DANGER: 0xED4245,
    MUTED: 0x747F8D,
} as const;

export const DM_PANEL_FOOTER = "رفيق الروح • يتم حفظ التغييرات تلقائيا";

export function renderPanelEmbed(
    title: string,
    description: string,
    fields?: { name: string; value: string; inline?: boolean }[],
    color: number = UI_COLORS.BRAND,
    iconURL?: string,
    footer: string = BOT_FOOTER,
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: footer });

    if (iconURL) embed.setAuthor({ name: BOT_NAME, iconURL });
    if (fields?.length) embed.addFields(fields);

    return embed;
}

export function renderStatusField(emoji: string, label: string, value: string): string {
    return `${emoji} **${label}:** \`${value}\``;
}

export function renderActionRow<T extends ButtonBuilder | StringSelectMenuBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder>(
    ...components: T[]
): ActionRowBuilder<T> {
    return new ActionRowBuilder<T>().addComponents(...components);
}

export function renderSuccessEmbed(title: string, description: string): EmbedBuilder {
    return renderPanelEmbed(`✅ ${title}`, description, [], COLORS.SUCCESS);
}

export function renderErrorEmbed(description: string): EmbedBuilder {
    return new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`❌ ${description}`);
}