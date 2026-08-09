import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ChannelSelectMenuBuilder,
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import { COLORS } from '../../utils/constants';
import { getQuranRadioConfig } from '../../services/guildService';

export interface QuranSetupSession {
    guildId: string;
    voiceChannelId: string | null;
    twentyFourSeven: boolean;
}

export const activeQuranSetups = new Map<string, QuranSetupSession>();

export const data = new SlashCommandBuilder()
    .setName('setup_quran')
    .setDescription('إعداد قناة القرآن الكريم ونظام التشغيل 24/24')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    const guildId = interaction.guildId!;
    const current = await getQuranRadioConfig(guildId);
    const session: QuranSetupSession = {
        guildId,
        voiceChannelId: current?.voiceChannelId || null,
        twentyFourSeven: current?.twentyFourSeven || false,
    };
    activeQuranSetups.set(interaction.user.id, session);

    const embed = new EmbedBuilder()
        .setColor(UI_COLORS.BRAND)
        .setTitle('📻 إعداد نظام القرآن الكريم')
        .setDescription(
            'اختر القناة الصوتية التي سيعمل فيها البوت. لوحة التحكم ستظهر داخل محادثة نفس القناة، وأول عضو يدخلها يصبح المتحكم.\n\n' +
            'وضع **24/24** يبدأ بالحرم المكي ثم يبدّل تلقائياً بين الحرم المكي والمسجد النبوي كل 6 ساعات.'
        )
        .addFields(
            { name: '🔊 القناة الحالية', value: session.voiceChannelId ? `<#${session.voiceChannelId}>` : 'لم يتم الاختيار', inline: true },
            { name: '🕐 وضع 24/24', value: session.twentyFourSeven ? '✅ مفعل' : '❌ متوقف', inline: true },
        )
        .setFooter({ text: 'لن يتم تطبيق أي تغيير قبل الضغط على حفظ.' });

    const channelSelectRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('quran_setup_channel_select')
            .setPlaceholder('اختر القناة الصوتية...')
            .addChannelTypes(ChannelType.GuildVoice),
    );

    await interaction.editReply({ embeds: [embed], components: [channelSelectRow] });
}
