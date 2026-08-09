import axios from 'axios';
import { logger } from '../utils/logger';

interface YabiladiTimings {
    Fajr: string;
    Dhuhr: string;
    Asr: string;
    Maghrib: string;
    Isha: string;
}

export async function fetchYabiladiPrayerTimes(yabiladiId: number, slug: string): Promise<YabiladiTimings | null> {
    try {
        const url = `https://www.yabiladi.com/prieres/details/${yabiladiId}/${slug}.html`;
        logger.info(`🌐 Fetching Yabiladi prayer times: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.8',
            },
            timeout: 15000,
        });

        const html = response.data;

        const tableMatch = html.match(/<table[^>]*class="prayer"[^>]*>[\s\S]*?<\/table>/i);
        if (!tableMatch) {
            logger.error('Could not find prayer table in Yabiladi response');
            return null;
        }

        const tableHtml = tableMatch[0];

        const now = new Date();
        const todayDay = now.getDate().toString().padStart(2, '0');
        const todayMonth = (now.getMonth() + 1).toString().padStart(2, '0');

        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
        let rowMatch: RegExpExecArray | null;

        while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
            const rowHtml = rowMatch[0];

            if (rowHtml.includes('<th')) continue;

            const dateMatch = rowHtml.match(/<td[^>]*>\s*(\d{2})\/(\d{2})/);
            if (!dateMatch) continue;

            const day = dateMatch[1].padStart(2, '0');
            const month = dateMatch[2].padStart(2, '0');

            if (day === todayDay && month === todayMonth) {
                const timeRegex = /<td[^>]*>\s*(\d{2}:\d{2})/g;
                const times: string[] = [];
                let timeMatch: RegExpExecArray | null;

                while ((timeMatch = timeRegex.exec(rowHtml)) !== null) {
                    times.push(timeMatch[1]);
                }

                if (times.length >= 5) {
                    const result: YabiladiTimings = {
                        Fajr: times[0],
                        Dhuhr: times[1],
                        Asr: times[2],
                        Maghrib: times[3],
                        Isha: times[4],
                    };
                    logger.success(`✅ Yabiladi ${slug}: Fajr=${times[0]}, Dhuhr=${times[1]}, Asr=${times[2]}, Maghrib=${times[3]}, Isha=${times[4]}`);
                    return result;
                }
                break;
            }
        }

        logger.warn(`⚠️ Could not find today's (${todayDay}/${todayMonth}) prayer times for ${slug}`);
        return null;
    } catch (error) {
        logger.error(`Failed to fetch Yabiladi prayer times:`, error);
        return null;
    }
}
