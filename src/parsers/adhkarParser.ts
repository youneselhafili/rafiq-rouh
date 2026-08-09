import * as fs from 'fs';
import { AdhkarCategory, AdhkarItem } from '../types';
import { logger } from '../utils/logger';

// Each TXT file in data/raw/أدعية و أذكار is one database category.
// Canonical format:
//   # اسم التصنيف
//   1.
//   العنوان: عنوان اختياري
//   النص: نص الذكر أو الدعاء
//   التكرار: 3
//   المصدر: مصدر اختياري
//   الفضل: فضل اختياري

const DAILY_ADHKAR = [
    'أذكار الاستيقاظ', 'أذكار الصباح', 'أذكار المساء', 'أذكار النوم',
    'أذكار الصلاة', 'أذكار الوضوء', 'أذكار بعد الصلاة', 'أذكار المسجد',
    'أذكار الآذان', 'أذكار الخلاء', 'أذكار المنزل', 'أذكار الطعام', 'أذكار يوم الجمعة',
];

const DUAS = [
    'أدعية الأنبياء', 'أدعية نبوية', 'أدعية للميت', 'الأدعية القرآنية',
    'جوامع الدعاء', 'فضل الدعاء', 'فضل الذكر', 'دعاء ختم القرآن', 'فضائل السور',
];

const EMOJI_MAP: Record<string, string> = {
    'أذكار الصباح': '🌅', 'أذكار المساء': '🌇', 'أذكار النوم': '🌙',
    'أذكار الاستيقاظ': '☀️', 'أذكار بعد الصلاة': '🤲', 'أذكار الوضوء': '💧',
    'أذكار الخلاء': '🚽', 'أذكار الطعام': '🍽️', 'أذكار المنزل': '🏠',
    'أذكار المسجد': '🕌', 'أذكار الصلاة': '🕌', 'أذكار الحج والعمرة': '🕋',
    'أذكار الآذان': '📢', 'أذكار متفرقة': '📿',
    'أدعية الأنبياء': '📜', 'أدعية نبوية': '📜', 'أدعية للميت': '🕊️',
    'الأدعية القرآنية': '📖', 'أسماء الله الحسنى': '🤍', 'الرقية الشرعية': '🛡️',
    'تسابيح': '📿', 'جوامع الدعاء': '🤲', 'دعاء ختم القرآن': '📖',
    'فضائل السور': '📖', 'فضل الدعاء': '🤲', 'فضل الذكر': '✨',
    'أذكار يوم الجمعة': '🌟',
};

const DEFAULT_TIME_MAP: Record<string, string> = {
    'أذكار الصباح': '06:00',
    'أذكار المساء': '18:00',
    'أذكار النوم': '22:00',
};

interface ParsedBlock {
    number: number;
    title: string;
    textLines: string[];
    count: number;
    sources: string[];
}

function getCategoryMetadata(fileKey: string): { group: 'daily' | 'dua' | 'misc'; emoji: string } {
    let group: 'daily' | 'dua' | 'misc' = 'misc';
    if (DAILY_ADHKAR.includes(fileKey)) group = 'daily';
    else if (DUAS.includes(fileKey)) group = 'dua';
    return { group, emoji: EMOJI_MAP[fileKey] || '📿' };
}

function parseCount(value: string): number {
    const numeric = value.match(/\d+/);
    if (numeric) return Math.max(1, Number(numeric[0]));
    if (/مرة واحدة|واحدة/.test(value)) return 1;
    if (/ثلاث/.test(value)) return 3;
    if (/سبع/.test(value)) return 7;
    if (/مائة|مئة/.test(value)) return 100;
    return 1;
}

function cleanLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function blockToItem(fileKey: string, block: ParsedBlock): AdhkarItem | null {
    const body = block.textLines.map(cleanLine).filter(Boolean).join('\n').trim();
    if (!body) return null;
    const text = block.title ? `${cleanLine(block.title)}\n\n${body}` : body;
    return {
        id: `${fileKey}_${block.number}`,
        text,
        count: block.count,
        source: block.sources.map(cleanLine).filter(Boolean).join(' • '),
        type: body.length < 30 ? 'tasbih' : 'dua',
    };
}

function parseNumberedItems(allLines: string[], fileKey: string): AdhkarItem[] {
    const items: AdhkarItem[] = [];
    let current: ParsedBlock | null = null;

    const flush = () => {
        if (!current) return;
        const item = blockToItem(fileKey, current);
        if (item) items.push(item);
    };

    for (const rawLine of allLines.slice(1)) {
        const line = rawLine.trim();
        const numbered = line.match(/^(\d+)[.)]\s*(.*)$/);
        if (numbered) {
            flush();
            current = {
                number: Number(numbered[1]),
                title: cleanLine(numbered[2]),
                textLines: [],
                count: 1,
                sources: [],
            };
            continue;
        }
        if (!current || !line || /^[#=\-]{3,}$/.test(line)) continue;

        const field = line.match(/^(العنوان|النص|التكرار|المصدر|الفضل)\s*:\s*(.*)$/);
        if (!field) {
            current.textLines.push(line);
            continue;
        }

        const [, key, value] = field;
        if (key === 'العنوان') current.title = value;
        else if (key === 'النص') current.textLines.push(value);
        else if (key === 'التكرار') current.count = parseCount(value);
        else current.sources.push(`${key}: ${value}`);
    }
    flush();
    return items;
}

export function parseAdhkarFile(filePath: string, fileKey: string): AdhkarCategory | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const allLines = content.replace(/\r/g, '').split('\n');
        const firstLine = allLines.find(line => line.trim().length > 0)?.trim();
        if (!firstLine) return null;

        const categoryName = firstLine.replace(/^#\s*/, '').trim();
        const items = parseNumberedItems(allLines, fileKey);
        if (!items.length) {
            logger.warn(`Adhkar database skipped (no numbered items): ${filePath}`);
            return null;
        }

        const numbers = items.map(item => Number(item.id.slice(item.id.lastIndexOf('_') + 1)));
        if (new Set(numbers).size !== items.length) {
            logger.warn(`Adhkar database has duplicate item numbers: ${filePath}`);
        }

        return {
            id: fileKey,
            key: fileKey,
            name: categoryName,
            items,
            defaultTime: DEFAULT_TIME_MAP[fileKey],
            ...getCategoryMetadata(fileKey),
        };
    } catch (error) {
        logger.error(`Failed to parse adhkar file ${filePath}:`, error);
        return null;
    }
}