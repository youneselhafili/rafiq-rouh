import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as cron from 'node-cron';
import { logger } from '../utils/logger';
import { getGuildDonateConfig } from './guildService';

const PAYPAL_URL = 'https://www.paypal.com/paypalme/youneselhafili';
const CIH_RIB = '230450524541421101740066';

// Store last broadcast times to prevent multiple sends on restarts
const lastBroadcasts = new Map<string, string>(); // guildId -> dateKey

export function initDonateScheduler(client: Client) {
    logger.info('⚙️ Initializing Donate Auto Broadcast Scheduler...');

    // Run cron job every hour to check which guilds need to send the donation message
    cron.schedule('0 * * * *', async () => {
        try {
            const guilds = client.guilds.cache;
            const now = new Date();
            const dateStr = now.toDateString();

            for (const [guildId, guild] of guilds) {
                const config = await getGuildDonateConfig(guildId);
                if (!config || !config.enabled || !config.channelId) continue;

                // Unique identifier for this guild and interval to avoid double posting
                const taskKey = `${guildId}-${config.interval}-${dateStr}`;

                // Check interval condition
                let shouldBroadcast = false;
                if (config.interval === 'daily') {
                    shouldBroadcast = true;
                } else if (config.interval === 'weekly' && now.getDay() === 5 && now.getHours() === 13) {
                    // Send weekly on Fridays at 1:00 PM (typical high engagement time)
                    shouldBroadcast = true;
                } else if (config.interval === 'monthly' && now.getDate() === 1 && now.getHours() === 13) {
                    // Send monthly on the 1st of the month at 1:00 PM
                    shouldBroadcast = true;
                }

                if (shouldBroadcast && !lastBroadcasts.has(taskKey)) {
                    lastBroadcasts.set(taskKey, dateStr);
                    await sendDonationBroadcast(client, config.channelId);
                }
            }
        } catch (error) {
            logger.error('Error in Donate scheduler cron job:', error);
        }
    });
}

async function sendDonationBroadcast(client: Client, channelId: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !(channel instanceof TextChannel)) return;

        const embed = new EmbedBuilder()
            .setColor(0xD8AA4D)
            .setTitle('💝  ادعم رفيق الروح')
            .setDescription(
                '> *﴿ وَمَا تُنفِقُوا مِنْ خَيْرٍ فَإِنَّ اللَّهَ بِهِ عَلِيمٌ ﴾*\n\u200b'
            )
            .addFields(
                {
                    name: '🌙  عن البوت',
                    value:
                        'رفيق الروح بوت إسلامي مجاني بالكامل — آذان، أذكار، قرآن كريم، إذاعات مباشرة من مكة والمدينة.\n' +
                        'تم تطويره بمحبة خالصة لخدمة المسلمين في كل مكان.',
                    inline: false,
                },
                {
                    name: '🖥️  لماذا الدعم؟',
                    value:
                        'تكاليف تشغيل الخادم تُدفع من جيب المطوّر كل شهر.\n' +
                        'تبرعك — ولو بالقليل — يساعد على إبقاء البوت يعمل ومستمراً في التطوير ودعم تكاليف الاستضافة. 🙏',
                    inline: false,
                },
                {
                    name: '🤍  طرق التبرع المتاحة',
                    value: 
                        `💳 **عبر PayPal:**\nاضغط على الزر بالأسفل للانتقال لصفحة الدفع مباشرة.\n\n` +
                        `🏦 **عبر تحويل بنكي (CIH Bank):**\n` +
                        `• **الاسم:** يونس الحفيلي\n` +
                        `• **رقم الحساب (RIB):**\n\`${CIH_RIB}\``,
                    inline: false,
                }
            )
            .setThumbnail(client.user?.displayAvatarURL() ?? null)
            .setFooter({
                text: 'رفيق الروح • المطوّر: يونس الحفيلي  •  جزاكم الله خيراً ❤️',
                iconURL: client.user?.displayAvatarURL(),
            })
            .setTimestamp();

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setLabel('تبرع عبر PayPal  💳')
                .setURL(PAYPAL_URL)
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('نسخ رقم الحساب (RIB)  📋')
                .setCustomId('donate_copy_rib')
                .setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ embeds: [embed], components: [buttons] });
        logger.info(`Donation auto-broadcast sent to channel ${channelId}`);
    } catch (error) {
        logger.error(`Failed to send donation auto-broadcast to channel ${channelId}:`, error);
    }
}
