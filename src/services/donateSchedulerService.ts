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
import { FieldValue } from 'firebase-admin/firestore';
import { canAttemptFirebase, getDb, recordFirebaseFailure, recordFirebaseSuccess } from '../config/firebase';
import { logger } from '../utils/logger';
import {
    getGuildDonateConfig,
    getGuildAdhkarConfigs,
    getGuildDonateTracking,
    saveGuildDonateTracking
} from './guildService';
import { isFirestoreAvailable } from './guildConfigService';
import { getAllDMUserConfigs } from './dmSubscriptionService';
import { buildCatalogSummary } from './botInfoService';
import { writeJsonAtomic } from '../utils/localJsonStore';

const PAYPAL_URL = 'https://www.paypal.com/paypalme/youneselhafili';
const CIH_RIB = '230450524541421101740066';
const GLOBAL_DONATE_FILE = path.join(process.cwd(), 'data', 'global_donate_state.json');

// Store last local broadcast times to prevent multiple sends on restarts
const lastBroadcasts = new Map<string, string>(); // guildId -> dateKey

interface GlobalDonateState {
    lastGlobalDMVerify?: string; // ISO string
}

async function getGlobalDonateState(): Promise<GlobalDonateState> {
    if (isFirestoreAvailable() && canAttemptFirebase()) {
        try {
            const snap = await getDb().doc('globals/donate').get();
            if (snap.exists) {
                const data = snap.data();
                recordFirebaseSuccess();
                return { lastGlobalDMVerify: data?.lastGlobalDMVerify };
            }
        } catch (error) {
            recordFirebaseFailure(error, 'read global donate state');
        }
    }

    try {
        if (fs.existsSync(GLOBAL_DONATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(GLOBAL_DONATE_FILE, 'utf-8'));
            return { lastGlobalDMVerify: raw.lastGlobalDMVerify };
        }
    } catch {
        // ignore
    }
    return {};
}

async function saveGlobalDonateState(state: GlobalDonateState): Promise<void> {
    try {
        writeJsonAtomic(GLOBAL_DONATE_FILE, state);
    } catch (error) {
        logger.error('Failed to save global donate state locally:', error);
    }

    if (isFirestoreAvailable() && canAttemptFirebase()) {
        try {
            await getDb().doc('globals/donate').set({
                lastGlobalDMVerify: state.lastGlobalDMVerify || new Date().toISOString(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            recordFirebaseSuccess();
        } catch (error) {
            recordFirebaseFailure(error, 'save global donate state');
        }
    }
}

export function initDonateScheduler(client: Client) {
    logger.info('⚙️ Initializing Donate Auto Broadcast Scheduler...');

    // Run cron job once every day at 12:00 PM to check both individual guild timers, manual schedules, and DM broadcasts
    cron.schedule('0 12 * * *', async () => {
        try {
            const now = new Date();
            await checkAndRunServerTimers(client, now);
            await checkAndRunGuildBroadcasts(client, now);
            await checkAndRunDMGlobalBroadcast(client, now);
        } catch (error) {
            logger.error('Error in Donate scheduler cron job:', error);
        }
    });

    // Also run immediately at startup (after a short delay to let guilds load)
    setTimeout(async () => {
        try {
            const now = new Date();
            await checkAndRunServerTimers(client, now);
            await checkAndRunDMGlobalBroadcast(client, now);
        } catch (error) {
            logger.error('Error in Donate startup scheduler run:', error);
        }
    }, 30000);
}

/**
 * Handles individual server timeline logic:
 * - Sends 1st broadcast after 7 days of server configuration creation.
 * - Sends subsequent broadcasts every 91 days.
 */
async function checkAndRunServerTimers(client: Client, now: Date) {
    logger.info('🔍 Checking individual server donation timelines...');
    const guilds = client.guilds.cache;

    for (const [guildId, guild] of guilds) {
        try {
            const tracking = await getGuildDonateTracking(guildId);
            const diffTime = Math.abs(now.getTime() - tracking.createdAt.getTime());
            const daysWorking = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            if (daysWorking < 7) {
                // Too new, skip
                continue;
            }

            let shouldBroadcast = false;

            if (!tracking.firstSent) {
                // 7 days completed, trigger first broadcast
                shouldBroadcast = true;
            } else if (tracking.lastSentAt) {
                // Check if 91 days have passed since last broadcast
                const lastSent = new Date(tracking.lastSentAt);
                const daysSinceLast = Math.floor(Math.abs(now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24));
                if (daysSinceLast >= 91) {
                    shouldBroadcast = true;
                }
            }

            if (shouldBroadcast) {
                // Find appropriate channel: Configured channel -> Dhikr (Adhkar) Channel -> First Writeable Text Channel
                let targetChannelId: string | undefined;

                const config = await getGuildDonateConfig(guildId);
                if (config?.enabled && config?.channelId) {
                    targetChannelId = config.channelId;
                }

                if (!targetChannelId) {
                    const adhkarConfigs = await getGuildAdhkarConfigs(guildId);
                    if (adhkarConfigs && adhkarConfigs.length > 0 && adhkarConfigs[0].channelId) {
                        targetChannelId = adhkarConfigs[0].channelId;
                    }
                }

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
                    const titleText = !tracking.firstSent 
                        ? '📢 مرحباً بكم! تذكير دوري لـ رفيق الروح' 
                        : '📢 تذكير دوري لـ رفيق الروح';
                    
                    await sendDonationBroadcast(client, targetChannelId, titleText);
                    
                    // Save new state
                    await saveGuildDonateTracking(guildId, {
                        firstSent: true,
                        lastSentAt: now.toISOString(),
                    });
                }
            }
        } catch (error) {
            logger.error(`Error executing server timer check for guild ${guildId}:`, error);
        }
    }
}

/**
 * Handles manual schedules configured by admins (daily, weekly, monthly)
 */
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
                shouldBroadcast = true;
            } else if (config.interval === 'monthly' && now.getDate() === 1) {
                shouldBroadcast = true;
            }

            if (shouldBroadcast && !lastBroadcasts.has(taskKey)) {
                lastBroadcasts.set(taskKey, dateStr);
                await sendDonationBroadcast(client, config.channelId, '💝 تذكير دوري لدعم البوت');
            }
        } catch (error) {
            logger.error(`Error checking guild manual broadcast for ${guildId}:`, error);
        }
    }
}

/**
 * Handles global DM broadcast to all active DM subscribers every 91 days
 */
async function checkAndRunDMGlobalBroadcast(client: Client, now: Date) {
    const state = await getGlobalDonateState();
    let shouldBroadcast = false;

    if (!state.lastGlobalDMVerify) {
        shouldBroadcast = true;
    } else {
        const lastDate = new Date(state.lastGlobalDMVerify);
        const diffTime = Math.abs(now.getTime() - lastDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 91) {
            shouldBroadcast = true;
        }
    }

    if (!shouldBroadcast) return;

    logger.info('📢 Triggering 91-day Global Donation DM Broadcast...');

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

    await saveGlobalDonateState({ lastGlobalDMVerify: now.toISOString() });
    logger.success('✅ 91-day Global DM Broadcast completed successfully.');
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
                    `💳 **عبر PayPal:**\nاضغط على الزر بالأسفل للانتقال لصفحة الدفع مباشرة.\n\n` +
                    `🏦 **عبر تحويل بنكي (CIH Bank):**\n` +
                    `• **الاسم:** YOUNES ELHAFILI\n` +
                    `• **رقم الحساب (RIB):**\n\`${CIH_RIB}\``,
                inline: false,
            }
        )
        .setThumbnail(client.user?.displayAvatarURL() ?? null)
        .setFooter({
            text: 'رفيق الروح • المطوّر: YOUNES ELHAFILI  •  جزاكم الله خيراً ❤️',
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
