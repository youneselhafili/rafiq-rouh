import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
    ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import { UI_COLORS } from '../../utils/uiRenderer';
import { getAllAdhkarCategoryNames } from '../../services/contentService';
import { AdhkarCategoryStatus, getAdhkarV2Config } from '../../services/adhkarConfigServiceV2';
import { getManagedAdhanZones, ManagedAdhanZone } from '../../services/adhanZoneService';

export interface AdhkarSetupSession {
    guildId: string;
    enabled: boolean;
    generalChannelId?: string;
    zones: ManagedAdhanZone[];
    primaryZoneIndex: number;
    categories: Record<string, AdhkarCategoryStatus>;
    selectedTypes: string[];
    categoryPage: number;
    view: 'main' | 'categories';
}

export const activeAdhkarSetups = new Map<string, AdhkarSetupSession>();
const DEFAULT_TYPES = ['أذكار الصباح', 'أذكار المساء', 'أذكار النوم', 'أذكار الآذان', 'أذكار الوضوء'];

export const data = new SlashCommandBuilder()
    .setName('setup_adhkar')
    .setDescription('إعداد الأذكار العشوائية المرتبطة بمواقيت الصلاة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    const zones = (await getManagedAdhanZones(interaction.guildId!)).filter(zone => zone.enabled);
    if (!zones.length) {
        await interaction.editReply({ content: '❌ خاصك أولاً تضيف وتفعّل منطقة أذان باستعمال `/setup_adhan`، لأنها هي المرجع للتوقيت.' });
        return;
    }
    const existing = await getAdhkarV2Config(interaction.guildId!);
    const primaryIndex = existing
        ? Math.max(0, zones.findIndex(zone => zone.country === existing.primaryZoneCountry && zone.city === existing.primaryZoneCity))
        : 0;
    const categories = existing?.categories || Object.fromEntries(DEFAULT_TYPES.map(type => [type, 'enabled' as const]));
    const session: AdhkarSetupSession = {
        guildId: interaction.guildId!, enabled: existing?.enabled ?? true,
        generalChannelId: existing?.generalChannelId, zones, primaryZoneIndex: primaryIndex,
        categories, selectedTypes: [], categoryPage: 0, view: 'main',
    };
    activeAdhkarSetups.set(interaction.user.id, session);
    await interaction.editReply(buildAdhkarSetupPayload(session));
}

export function buildAdhkarSetupPayload(session: AdhkarSetupSession) {
    return session.view === 'categories' ? categoryPayload(session) : mainPayload(session);
}

function mainPayload(session: AdhkarSetupSession) {
    const zone = session.zones[session.primaryZoneIndex];
    const enabledCount = Object.values(session.categories).filter(status => status === 'enabled').length;
    const pausedCount = Object.values(session.categories).filter(status => status === 'paused').length;
    const embed = new EmbedBuilder().setColor(UI_COLORS.BRAND).setTitle('📿 إعداد الأذكار المتقدمة')
        .setDescription('اختَر منطقة الأذان المرجعية وقناة الأذكار العامة. أذكار الأذان والوضوء تذهب إلى قناة الأذان الخاصة بالمنطقة، وباقي الأذكار إلى القناة العامة.')
        .addFields(
            { name: 'الحالة العامة', value: session.enabled ? '✅ مفعلة' : '⏸️ متوقفة', inline: true },
            { name: 'المنطقة المرجعية', value: zone ? `${zone.city} — ${zone.country} (\`${zone.timezone}\`)` : 'غير محددة', inline: true },
            { name: 'القناة العامة', value: session.generalChannelId ? `<#${session.generalChannelId}>` : 'لم يتم الاختيار', inline: true },
            { name: 'الأنواع', value: `✅ ${enabledCount} مفعلة | ⏸️ ${pausedCount} متوقفة`, inline: false },
            { name: 'المواعيد الثابتة', value: 'الصباح 06:00 • المساء 18:00 • النوم 22:00\nنهار الجمعة: ذكر واحد من قاعدة الجمعة مباشرة بعد ذكر الصباح، بلا تكرار حتى تكمل 52 ذكراً.\nأذكار الأذان مع كل صلاة، والوضوء بعد 5 دقائق. باقي الأنواع داخل الفواصل النهارية بين الصلوات.', inline: false },
        )
        .setFooter({ text: 'لا يتم تطبيق أي تغيير قبل الضغط على حفظ.' });
    const zones = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhkar_setup_zone').setPlaceholder('اختر المنطقة المرجعية').addOptions(
            session.zones.slice(0, 25).map((item, index) => ({ label: `${item.city} — ${item.country}`.slice(0, 100), description: item.timezone, value: String(index), default: index === session.primaryZoneIndex })),
        ),
    );
    const channel = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId('adhkar_setup_channel').setPlaceholder('اختر قناة الأذكار العامة').addChannelTypes(ChannelType.GuildText),
    );
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('adhkar_setup_categories').setLabel('إدارة الأنواع').setEmoji('🗂️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('adhkar_setup_master_toggle').setLabel(session.enabled ? 'إيقاف الكل' : 'تفعيل الكل').setEmoji(session.enabled ? '⏸️' : '▶️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('adhkar_setup_channel_id').setLabel('إدخال معرّف القناة').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('adhkar_setup_save').setLabel('حفظ').setEmoji('💾').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('adhkar_setup_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [zones, channel, buttons] };
}

function categoryPayload(session: AdhkarSetupSession) {
    const categories = getAllAdhkarCategoryNames();
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(categories.length / pageSize));
    session.categoryPage = Math.max(0, Math.min(session.categoryPage, pages - 1));
    const start = session.categoryPage * pageSize;
    const visible = categories.slice(start, start + pageSize);
    const lines = visible.map(category => {
        const status = session.categories[category.key];
        return `${status === 'enabled' ? '✅' : status === 'paused' ? '⏸️' : '⚪'} **${category.name}**`;
    });
    const embed = new EmbedBuilder().setColor(UI_COLORS.BRAND).setTitle('🗂️ إدارة أنواع الأذكار')
        .setDescription(`${lines.join('\n')}\n\nحدد نوعاً أو أكثر ثم اختَر تفعيل/توقيف/حذف. زر المعاينة يستعمل أول نوع محدد ولا يستهلك دوره.`)
        .setFooter({ text: `صفحة ${session.categoryPage + 1}/${pages} — التعديلات مؤقتة حتى الحفظ` });
    const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('adhkar_setup_type_select').setPlaceholder('حدد الأنواع').setMinValues(1).setMaxValues(visible.length).addOptions(
            visible.map(category => ({ label: category.name.slice(0, 100), value: category.key, emoji: category.emoji, default: session.selectedTypes.includes(category.key) })),
        ),
    );
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('adhkar_setup_type_enable').setLabel('تفعيل').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('adhkar_setup_type_pause').setLabel('توقيف').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('adhkar_setup_type_delete').setLabel('حذف الإعداد').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('adhkar_setup_preview').setLabel('معاينة').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
    );
    const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('adhkar_setup_page_prev').setLabel('السابق').setStyle(ButtonStyle.Secondary).setDisabled(session.categoryPage === 0),
        new ButtonBuilder().setCustomId('adhkar_setup_page_next').setLabel('التالي').setStyle(ButtonStyle.Secondary).setDisabled(session.categoryPage >= pages - 1),
        new ButtonBuilder().setCustomId('adhkar_setup_back').setLabel('رجوع').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('adhkar_setup_save').setLabel('حفظ').setEmoji('💾').setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [select, actions, nav] };
}
