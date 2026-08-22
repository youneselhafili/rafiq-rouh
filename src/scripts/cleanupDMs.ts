import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { initializeFirebase } from '../config/firebase';
import { isFirestoreAvailable } from '../services/guildConfigService';
import { getAllDMUserConfigs } from '../services/dmSubscriptionService';
import { logger } from '../utils/logger';
import { buildCatalogSummary } from '../services/botInfoService';

dotenv.config();

const PAYPAL_URL = 'https://www.paypal.com/paypalme/youneselhafili';
const CIH_RIB = '230450524541421101740066';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
    ]
});

async function run() {
    try {
        logger.info('🚀 Starting DM Cleanup and Update script...');

        // 1. Initialize Firebase
        try {
            initializeFirebase();
        } catch (error) {
            logger.error('Failed to initialize Firebase. Firestore is required for DM configs:', error);
            process.exit(1);
        }

        if (!isFirestoreAvailable()) {
            logger.error('Firestore is not available. Please verify service-account.json');
            process.exit(1);
        }

        // 2. Login to Discord
        if (!process.env.DISCORD_TOKEN) {
            logger.error('DISCORD_TOKEN is missing in .env file!');
            process.exit(1);
        }
        await client.login(process.env.DISCORD_TOKEN);

        client.once('ready', async () => {
            logger.success(`Logged in as ${client.user?.tag}`);

            // 3. Fetch all DM configs
            const userConfigs = await getAllDMUserConfigs();
            const activeUsers = userConfigs.filter(u => u.config.enabled);

            logger.info(`Found ${activeUsers.length} users with active DM configurations.`);

            for (const { userId } of activeUsers) {
                try {
                    logger.info(`Processing DM cleanup for user ${userId}...`);
                    const user = await client.users.fetch(userId);
                    if (!user) {
                        logger.warn(`User ${userId} not found.`);
                        continue;
                    }

                    // Create/fetch DM channel
                    const dmChannel = await user.createDM();

                    // Fetch the last 100 messages in DM
                    const messages = await dmChannel.messages.fetch({ limit: 100 });
                    const botMessages = messages.filter(m => m.author.id === client.user?.id);

                    logger.info(`Deleting ${botMessages.size} messages in DMs for ${user.tag}...`);

                    // Delete existing messages
                    for (const [_, msg] of botMessages) {
                        try {
                            await msg.delete();
                            await new Promise(r => setTimeout(r, 1000)); // Respect rate limits
                        } catch (delErr) {
                            logger.error(`Error deleting message:`, delErr);
                        }
                    }

                    // Send the new corrected donation message
                    const embed = new EmbedBuilder()
                        .setColor(0xD8AA4D)
                        .setTitle('💝 رسالة خاصة دورية: ادعم رفيق الروح')
                        .setDescription(
                            '> *﴿ وَمَا تُنفِقُوا مِنْ خَيْرٍ فَإِنَّ اللَّهَ بِهِ عَلِيمٌ ﴾*\n\u200b'
                        )
                        .addFields(
                            {
                                name: '🌙  عن البوت',
                                value:
                                    'رفيق الروح بوت إسلامي مجاني بالكامل: قرآن 24/24، أذان ومواقيت الصلاة، أذكار، صلاة على النبي ﷺ، الجمعة وسورة الكهف، ختمات يومية وتنبيهات شخصية في الخاص.\n' +
                                    `${buildCatalogSummary()}.`,
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
                                    `💳 **عبر PayPal:**\nاضغط على الزر بالأسفل للانتقال لصفحة الدفع ملكيرة.\n\n` +
                                    `🏦 **عبر تحويل بنكي (CIH Bank):**\n` +
                                    `• **الاسم:** YOUNES ELHAFILI\n` +
                                    `• **رقم الحساب (RIB):**\n\`${CIH_RIB}\``,
                                inline: false,
                            }
                        )
                        .setThumbnail(client.user?.displayAvatarURL() ?? null)
                        .setFooter({
                            text: 'رفيق الروح • المطوّر: يونس الحافلي  •  جزاكم الله خيراً ❤️',
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

                    await dmChannel.send({ embeds: [embed], components: [buttons] });
                    logger.success(`Successfully cleaned and sent new DM to ${user.tag}`);
                    await new Promise(r => setTimeout(r, 2000)); // Pause between users to stay completely safe
                } catch (userErr) {
                    logger.error(`Failed to process DM for user ${userId}:`, userErr);
                }
            }

            logger.success('🎉 All DMs cleaned and updated successfully!');
            process.exit(0);
        });
    } catch (error) {
        logger.error('Error running DM cleanup:', error);
        process.exit(1);
    }
}

run();
