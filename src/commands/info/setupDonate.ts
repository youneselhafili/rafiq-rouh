import {
    ChannelType,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { saveDonateConfig, deleteDonateConfig, getGuildDonateConfig } from '../../services/guildService';

export const data = new SlashCommandBuilder()
    .setName('setup_donate')
    .setDescription('إعداد النشر التلقائي لرسالة دعم البوت والتبرع')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
        subcommand
            .setName('enable')
            .setDescription('تفعيل وتحديد القناة والوقت الدوري')
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('القناة التي سيتم نشر رسالة الدعم فيها')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            )
            .addStringOption(option =>
                option
                    .setName('interval')
                    .setDescription('معدل تكرار إرسال الرسالة')
                    .setRequired(true)
                    .addChoices(
                        { name: 'يومياً (مرة كل يوم)', value: 'daily' },
                        { name: 'أسبوعياً (مرة كل أسبوع)', value: 'weekly' },
                        { name: 'شهرياً (مرة كل شهر)', value: 'monthly' }
                    )
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('disable')
            .setDescription('إيقاف النشر التلقائي لرسائل الدعم')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('عرض حالة إعداد الدعم الحالي بالسيرفر')
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (subcommand === 'enable') {
        const channel = interaction.options.getChannel('channel', true);
        const interval = interaction.options.getString('interval', true) as 'daily' | 'weekly' | 'monthly';

        await saveDonateConfig(guildId, channel.id, interval);

        const intervalText = interval === 'daily' ? 'يومياً' : interval === 'weekly' ? 'أسبوعياً' : 'شهرياً';
        await interaction.reply({
            content: `✅ **تم تفعيل النشر التلقائي لرسالة التبرع بنجاح!**\n• **القناة:** <#${channel.id}>\n• **التكرار:** ${intervalText}`,
            ephemeral: true
        });
    } else if (subcommand === 'disable') {
        await deleteDonateConfig(guildId);
        await interaction.reply({
            content: '❌ **تم إيقاف وتعطيل النشر التلقائي لرسائل الدعم بنجاح!**',
            ephemeral: true
        });
    } else if (subcommand === 'status') {
        const config = await getGuildDonateConfig(guildId);

        if (!config || !config.enabled) {
            await interaction.reply({
                content: 'ℹ️ **النشر التلقائي لرسائل التبرع معطّل حالياً في هذا السيرفر.**\nلتفعيله استخدم: `/setup_donate enable`',
                ephemeral: true
            });
            return;
        }

        const intervalText = config.interval === 'daily' ? 'يومياً' : config.interval === 'weekly' ? 'أسبوعياً' : 'شهرياً';
        await interaction.reply({
            content: `⚙️ **حالة إعداد الدعم الحالي:**\n• **النشر التلقائي:** مفعل ✅\n• **القناة:** <#${config.channelId}>\n• **التكرار:** ${intervalText}`,
            ephemeral: true
        });
    }
}
