import { Client, EmbedBuilder, AttachmentBuilder, TextChannel } from 'discord.js';
import * as cron from 'node-cron';
import { getAdvancedConfig, setAdvancedConfig, deleteAdvancedConfig } from './advancedConfigService';
import { KhatmaState, KhatmaMode } from '../types';
import { getAllUsersWithActiveKhatma, getUserDMConfig, updateUserDMConfig } from './dmSubscriptionService';
import { logger } from '../utils/logger';
import { getRolesConfig } from './rolesConfigService';
import { sendPersonalKhatmaReminders } from './personalGuildKhatmaService';

const KHATMA_MODULE = 'khatma';

export const QURAN_PAGE_IMAGE_BASE_URL = 'https://raw.githubusercontent.com/QuranHub/quran-pages-images/main/kfgqpc/hafs-wasat';

const KHATMA_DUA = `اللَّهُمَّ ارْحَمْنِي بالقُرْءَانِ وَاجْعَلهُ لِي إِمَاماً وَنُوراً وَهُدًى وَرَحْمَةً
اللَّهُمَّ ذَكِّرْنِي مِنْهُ مَانَسِيتُ وَعَلِّمْنِي مِنْهُ مَاجَهِلْتُ وَارْزُقْنِي تِلاَوَتَهُ آنَاءَ اللَّيْلِ وَأَطْرَافَ النَّهَارِ وَاجْعَلْهُ لِي حُجَّةً يَارَبَّ العَالَمِينَ
اللَّهُمَّ أَصْلِحْ لِي دِينِي الَّذِي هُوَ عِصْمَةُ أَمْرِي، وَأَصْلِحْ لِي دُنْيَايَ الَّتِي فِيهَا مَعَاشِي، وَأَصْلِحْ لِي آخِرَتِي الَّتِي فِيهَا مَعَادِي، وَاجْعَلِ الحَيَاةَ زِيَادَةً لِي فِي كُلِّ خَيْرٍ وَاجْعَلِ المَوْتَ رَاحَةً لِي مِنْ كُلِّ شَرٍّ
اللَّهُمَّ اجْعَلْ خَيْرَ عُمْرِي آخِرَهُ وَخَيْرَ عَمَلِي خَوَاتِمَهُ وَخَيْرَ أَيَّامِي يَوْمَ أَلْقَاكَ فِيهِ
اللَّهُمَّ إِنِّي أَسْأَلُكَ عِيشَةً هَنِيَّةً وَمِيتَةً سَوِيَّةً وَمَرَدًّا غَيْرَ مُخْزٍ وَلاَ فَاضِحٍ
اللَّهُمَّ إِنِّي أَسْأَلُكَ خَيْرَ المَسْأَلةِ وَخَيْرَ الدُّعَاءِ وَخَيْرَ النَّجَاحِ وَخَيْرَ العِلْمِ وَخَيْرَ العَمَلِ وَخَيْرَ الثَّوَابِ وَخَيْرَ الحَيَاةِ وَخيْرَ المَمَاتِ وَثَبِّتْنِي وَثَقِّلْ مَوَازِينِي وَحَقِّقْ إِيمَانِي وَارْفَعْ دَرَجَتِي وَتَقَبَّلْ صَلاَتِي وَاغْفِرْ خَطِيئَاتِي وَأَسْأَلُكَ العُلَا مِنَ الجَنَّةِ`;

const activeCronJobs = new Map<string, cron.ScheduledTask>();
const activeKhatmaDeliveries = new Set<string>();

function meccaDateKey(value: Date | string = new Date()): string {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

export function wasKhatmaSentToday(lastSentAt?: string): boolean {
    if (!lastSentAt) return false;
    const parsed = new Date(lastSentAt);
    return !Number.isNaN(parsed.valueOf()) && meccaDateKey(parsed) === meccaDateKey();
}

export async function getGuildKhatma(guildId: string): Promise<KhatmaState | null> {
    return getAdvancedConfig<KhatmaState>(guildId, KHATMA_MODULE);
}

export async function setGuildKhatma(guildId: string, state: KhatmaState): Promise<void> {
    await setAdvancedConfig(guildId, KHATMA_MODULE, state);
}

export async function deleteGuildKhatma(guildId: string): Promise<void> {
    await deleteAdvancedConfig(guildId, KHATMA_MODULE);
}

export function calculatePagesPerDay(mode: KhatmaMode, ramadanKhatmas?: number): number {
    switch (mode) {
        case 'week': return Math.ceil(604 / 7);
        case 'month': return Math.ceil(604 / 30);
        case '3_months': return Math.ceil(604 / 90);
        case '6_months': return Math.ceil(604 / 180);
        case 'ramadan': return Math.ceil((604 * (ramadanKhatmas || 1)) / 30);
        case 'custom': return 1; // Default, overridden in UI
        default: return 1;
    }
}

export async function sendKhatmaPages(client: Client, state: KhatmaState): Promise<boolean> {
    const deliveryKey = `${state.isGuild ? 'guild' : 'dm'}:${state.id}`;
    if (activeKhatmaDeliveries.has(deliveryKey)) {
        logger.warn(`Skipped duplicate concurrent Khatma delivery for ${deliveryKey}.`);
        return false;
    }
    activeKhatmaDeliveries.add(deliveryKey);

    if (state.currentPage > 604 || state.currentPage < 1) state.currentPage = 1;
    const pagesPerDay = Math.max(1, state.pagesPerDay || 1);
    const pagesToSend = [];
    const startPage = state.currentPage;
    let endPage = startPage + pagesPerDay - 1;

    let finished = false;
    if (endPage >= 604) {
        endPage = 604;
        finished = true;
    }

    for (let i = startPage; i <= endPage; i++) {
        pagesToSend.push(`${QURAN_PAGE_IMAGE_BASE_URL}/${i}.jpg`);
    }

    try {
        let target: TextChannel | any;
        if (state.isGuild) {
            target = await client.channels.fetch(state.channelId!) as TextChannel;
        } else {
            const user = await client.users.fetch(state.id);
            target = await user.createDM();
        }

        if (!target) return false;

        let khatmaRoleId: string | undefined;
        if (state.isGuild) {
            const rolesConfig = await getRolesConfig(state.id);
            if (rolesConfig.khatmaRoleId) {
                const guild = client.guilds.cache.get(state.id) || await client.guilds.fetch(state.id).catch(() => null);
                const role = guild ? await guild.roles.fetch(rolesConfig.khatmaRoleId).catch(() => null) : null;
                if (role) khatmaRoleId = role.id;
                else logger.warn(`Configured Khatma role ${rolesConfig.khatmaRoleId} was not found in guild ${state.id}.`);
            }
        }

        // Send pages in batches of 5 to respect Discord attachment limits
        for (let i = 0; i < pagesToSend.length; i += 5) {
            const batch = pagesToSend.slice(i, i + 5);
            const attachments = batch.map((url, index) => new AttachmentBuilder(url, { name: `page_${startPage + i + index}.jpg` }));
            await target.send({
                content: i === 0 && khatmaRoleId ? `<@&${khatmaRoleId}>` : undefined,
                files: attachments,
                allowedMentions: khatmaRoleId ? { parse: [], roles: [khatmaRoleId] } : { parse: [] },
            });
        }

        state.currentPage = endPage + 1;
        state.lastSentAt = new Date().toISOString();
        state.updatedAt = state.lastSentAt;

        if (finished) {
            const duaEmbed = new EmbedBuilder()
                .setTitle('✨ دعاء ختم القرآن الكريم ✨')
                .setDescription(KHATMA_DUA)
                .setColor(0x2ecc71)
                .setFooter({ text: 'تقبل الله منا ومنكم صالح الأعمال' });
            
            await target.send({ embeds: [duaEmbed] });
            state.isActive = false; // Stop sending
        }

        if (state.isGuild) {
            await setGuildKhatma(state.id, state);
        } else {
            const config = await getUserDMConfig(state.id);
            if (config.khatma) {
                config.khatma.currentPage = state.currentPage;
                config.khatma.enabled = state.isActive;
                config.khatma.lastSentAt = state.lastSentAt;
                config.khatma.updatedAt = state.updatedAt;
                await updateUserDMConfig(state.id, config);
            }
        }

        return true;

    } catch (error) {
        logger.error(`Failed to send Khatma pages for ${state.id}: ${error}`);
        return false;
    } finally {
        activeKhatmaDeliveries.delete(deliveryKey);
    }
}

export async function processAllKhatmas(client: Client) {
    logger.info('Running daily Khatma process...');
    // Process Guilds
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const state = await getGuildKhatma(guildId);
            if (state && state.isActive && !wasKhatmaSentToday(state.lastSentAt)) {
                await sendKhatmaPages(client, state);
            }
        } catch (error) {
            logger.error(`Failed to process guild Khatma for ${guildId}: ${error}`);
        }
    }

    // Process DMs
    const users = await getAllUsersWithActiveKhatma();
    for (const { userId, config } of users) {
        const khatma = config.khatma;
        if (!khatma || !khatma.enabled) continue;
        const state: KhatmaState = {
            id: userId,
            isGuild: false,
            currentPage: khatma.currentPage,
            pagesPerDay: khatma.pagesPerDay || calculatePagesPerDay(khatma.mode, khatma.ramadanKhatmas),
            mode: khatma.mode,
            ramadanKhatmas: khatma.ramadanKhatmas,
            lastSentAt: khatma.lastSentAt,
            isActive: true,
            createdAt: khatma.updatedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        if (wasKhatmaSentToday(state.lastSentAt)) continue;
        try {
            await sendKhatmaPages(client, state);
        } catch (error) {
            logger.error(`Failed to process DM Khatma for ${userId}: ${error}`);
        }
    }

    // The public reminder contains only a button. Each member's pages are
    // delivered later as an ephemeral response to their own interaction.
    await sendPersonalKhatmaReminders(client);
}

export function startKhatmaCron(client: Client) {
    // Run every day at 08:00 AM Mecca time
    const job = cron.schedule('0 8 * * *', () => {
        processAllKhatmas(client);
    }, {
        timezone: 'Asia/Riyadh'
    });
    
    activeCronJobs.set('daily_khatma', job);
    logger.info('Started daily Khatma cron job (08:00 Mecca time)');
}
