import {
    Client,
    TextChannel,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits
} from 'discord.js';
import * as cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { getGuildDonateConfig } from './guildService';
import { isFirestoreAvailable } from './guildConfigService';
import { getAllDMUserConfigs } from './dmSubscriptionService';

const PAYPAL_URL = 'https://www.paypal.com/paypalme/youneselhafili';
const CIH_RIB = '230450524541421101740066';
const GLOBAL_DONATE_FILE = path.join(process.cwd(), 'data', 'global_donate_state.json');

// Store last broadcast times to prevent multiple sends on restarts
const lastBroadcasts = new Map<string, string>(); // guildId -> dateKey

interface GlobalDonateState {
    lastGlobalBroadcast?: string; // ISO string
}

async function getGlobalDonateState(): Promise<GlobalDonateState> {
    if (isFirestoreAvailable()) {
        try {
            const snap = await getFirestore().doc('globals/donate').get();
            if (snap.exists) {
                const data = snap.data();
                return { lastGlobalBroadcast: data?.lastGlobalBroadcast };
            }
        } catch (error) {
            logger.error('Failed to get global donate state from Firestore:', error);
        }
    }

    try {
        if (fs.existsSync(GLOBAL_DONATE_FILE)) {
            return JSON.parse(fs.readFileSync(GLOBAL_DONATE_FILE, 'utf-8'));
        }
    } catch {
        // ignore
    }
    return {};
}

async function saveGlobalDonateState(state: GlobalDonateState): Promise<void> {
    if (isFirestoreAvailable()) {
        try {
            await getFirestore().doc('globals/donate').set({
                lastGlobalBroadcast: state.lastGlobalBroadcast || new Date().toISOString(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return;
        } catch (error) {
            logger.error('Failed to save global donate state to Firestore:', error);
        }
    }

    try {
        const dir = path.dirname(GLOBAL_DONATE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(GLOBAL_DONATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Failed to save global donate state locally:', error);
    }
}

export function initDonateScheduler(client: Client) {
    logger.info('⚙️ Initializing Donate Auto Broadcast Scheduler...');

    // Run cron job once every day at 12:00 PM to check both guild schedules and the 91-day global broadcast
    cron.schedule('0 12 * * *', async () => {
        try {
            const now = new Date();
            await checkAndRunGlobalBroadcast(client, now);
            await checkAndRunGuildBroadcasts(client, now);
        } catch (error) {
            logger.error('Error in Donate scheduler cron job:', error);
        }
    });

    // Also run immediately at startup (after a short delay to let guilds load)
    setTimeout(async () => {
        try {
            const now = new Date();
            await checkAndRunGlobalBroadcast(client, now);
        } catch (error) {
            logger.error('Error in Donate startup scheduler run:', error);
        }
    }, 30000);
}

async function checkAndRunGlobalBroadcast(client: Client, now: Date) {
    const state = await getGlobalDonateState();
    let shouldBroadcast = false;

    if (!state.lastGlobalBroadcast) {
        // First time ever, run it and initialize
        shouldBroadcast = true;
    } else {
        const lastDate = new Date(state.lastGlobalBroadcast);
        const diffTime = Math.abs(now.getTime() - lastDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 91) {
            shouldBroadcast = true;
        }
    }

    if (!shouldBroadcast) return;

    logger.info('📢 Triggering 91-day Global Donation Broadcast to all servers and DMs...');

    // 1. Broadcast to all guilds (servers)
    const guilds = client.guilds.cache;
    for (const [guildId, guild] of guilds) {
        try {
            // Check if guild has configured channel, otherwise find first writeable text channel
            const config = await getGuildDonateConfig(guildId);
            let targetChannelId = config?.channelId;

            if (!targetChannelId) {
                const writeableChannel = guild.channels.cache.find(c =>
                    c.type === ChannelType.GuildText &&
                    c.permissionsFor(guild.members.me || '')?.has(PermissionFlagsBits.SendMessages)
                );
                if (writeableChannel) {
                    targetChannelId = writeableChannel.id;
                }
            }

            if (targetChannelId) {
                await sendDonationBroadcast(client, targetChannelId, '📢 تذكير دوري لـ رفيق الروح');
            }
        } catch (guildError) {
            logger.error(`Failed to send global broadcast to guild ${guildId}:`, guildError);
        }
    }

    // 2. Broadcast to all users in DMs who have active DM configs
    if (isFirestoreAvailable()) {
        try {
            const userConfigs = await getAllDMUserConfigs();
            for (const { userId, config } of userConfigs) {
                if (!config.enabled) continue;
                try {
                    const user = await client.users.fetch(userId);
                    if (user) {
                        const embed = buildDonateEmbed(client, '💝 رسالة خاصة دورية: ادعم رفيق الروح');
                        const buttons = buildDonateButtons();
                        await user.send({ embeds: [embed], components: [buttons] });
                    }
                } catch (dmError) {
                    // Ignore blocked DMs
                }
            }
        } catch (dmFetchError) {
            logger.error('Failed to run DM broadcasts:', dmFetchError);
        }
    }

    // Update global state
    await saveGlobalDonateState({ lastGlobalBroadcast: now.toISOString() });
    logger.success('✅ 91-day Global Donation Broadcast completed successfully.');
}

async function checkAndRunGuildBroadcasts(client: Client, now: Date) {
    const guilds = client.guilds.cache;
    const dateStr = now.toDateString();

    for (const [guildId, guild] of guilds) {
        try {
            const config = await getGuildDonateConfig(guildId);
            if (!config || !config.enabled || !config.channelId) continue;

            const taskKey = `${guildId}-${config.interval}-${dateStr}`;

            let shouldBroadcast = false;
            if (config.interval === 'daily') {
                shouldBroadcast = true;
            } else if (config.interval === 'weekly' && now.getDay() === 5) {
                // Send weekly on Fridays
                shouldBroadcast = true;
            } else if (config.interval === 'monthly' && now.getDate() === 1) {
                // Send monthly on the 1st of the month
                shouldBroadcast = true;
            }

            if (shouldBroadcast && !lastBroadcasts.has(taskKey)) {
                lastBroadcasts.set(taskKey, dateStr);
                await sendDonationBroadcast(client, config.channelId, '💝 تذكير دوري لدعم البوت');
            }
        } catch (error) {
            logger.error(`Error checking guild broadcast for ${guildId}:`, error);
        }
    }
}

function buildDonateEmbed(client: Client, title: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(0xD8AA4D)
        .setTitle(title)
        .setDescription(
            '> *﴿ وَمَا تُنفِقُوا مِنْ خَيْرٍ فَإِنَّ اللَّهَ بِهِ عَلِيمٌ ﴾*\n\u200b'
        )
        .addFields(
            {
                name: '🌙  عن البوت',
                value:
                    'رفيق الروح بوت إسلامي مجاني بالكامل — آذان، أذكار، وقوائم تشغيل (Playlists) مجمعة لأشهر القراء لتشغيل القرآن الكريم بشكل عشوائي ومستمر.\n' +
                    'وجاري العمل حالياً على إضافة مجموعة جديدة ومميزة من كبار القراء قريباً بمشيئة الله.',
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
}

function buildDonateButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('تبرع عبر PayPal  💳')
            .setURL(PAYPAL_URL)
            .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
            .setLabel('نسخ رقم الحساب (RIB)  📋')
            .setCustomId('donate_copy_rib')
            .setStyle(ButtonStyle.Secondary)
    );
}

async function sendDonationBroadcast(client: Client, channelId: string, title: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !(channel instanceof TextChannel)) return;

        const embed = buildDonateEmbed(client, title);
        const buttons = buildDonateButtons();

        await channel.send({ embeds: [embed], components: [buttons] });
        logger.info(`Donation auto-broadcast sent to channel ${channelId}`);
    } catch (error) {
        logger.error(`Failed to send donation auto-broadcast to channel ${channelId}:`, error);
    }
}
