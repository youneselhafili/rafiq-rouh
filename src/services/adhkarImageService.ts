import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import * as fs from 'fs';
import * as path from 'path';

const WIDTH = 1200;
const HEIGHT = 630;
const MIN_FONT = 32;
const MAX_FONT = 48;
const MAX_TEXT_WIDTH = 980;
const TEXT_TOP = 175;
const TEXT_BOTTOM = 520;

const cairo = path.resolve(process.cwd(), 'assets/fonts/Cairo-Bold.ttf');
const tajawal = path.resolve(process.cwd(), 'assets/fonts/Tajawal-Regular.ttf');
if (fs.existsSync(cairo)) GlobalFonts.registerFromPath(cairo, 'Cairo');
if (fs.existsSync(tajawal)) GlobalFonts.registerFromPath(tajawal, 'Tajawal');

function wrap(ctx: any, text: string, maxWidth: number): string[] {
    const paragraphs = text.split(/\n+/).filter(Boolean);
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (!line || ctx.measureText(candidate).width <= maxWidth) line = candidate;
            else { lines.push(line); line = word; }
        }
        if (line) lines.push(line);
    }
    return lines;
}

function fits(ctx: any, text: string, fontSize: number): boolean {
    ctx.font = `${fontSize}px Tajawal`;
    const lines = wrap(ctx, text, MAX_TEXT_WIDTH);
    return lines.length * Math.round(fontSize * 1.42) <= TEXT_BOTTOM - TEXT_TOP;
}

function splitLongUnit(ctx: any, unit: string): string[] {
    ctx.font = `${MIN_FONT}px Tajawal`;
    const maxLines = Math.floor((TEXT_BOTTOM - TEXT_TOP) / Math.round(MIN_FONT * 1.42));
    const lines = wrap(ctx, unit, MAX_TEXT_WIDTH);
    const pages: string[] = [];
    for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join(' '));
    return pages;
}

function paginate(ctx: any, text: string): string[] {
    if (fits(ctx, text, MIN_FONT)) return [text];
    const units = text.split(/(?<=[.!؟؛،:])\s+|\n+/u).map(value => value.trim()).filter(Boolean);
    const pages: string[] = [];
    let page = '';
    for (const unit of units.length ? units : [text]) {
        const candidate = page ? `${page} ${unit}` : unit;
        if (fits(ctx, candidate, MIN_FONT)) { page = candidate; continue; }
        if (page) pages.push(page);
        if (fits(ctx, unit, MIN_FONT)) page = unit;
        else {
            const pieces = splitLongUnit(ctx, unit);
            pages.push(...pieces.slice(0, -1));
            page = pieces[pieces.length - 1] || '';
        }
    }
    if (page) pages.push(page);
    return pages;
}

function background(ctx: any) {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#173b2a');
    gradient.addColorStop(0.55, '#0c281b');
    gradient.addColorStop(1, '#06150e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = '#55b873';
    ctx.lineWidth = 3;
    ctx.strokeRect(45, 42, WIDTH - 90, HEIGHT - 84);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 75; x < WIDTH; x += 120) for (let y = 70; y < HEIGHT; y += 110) ctx.fillRect(x, y, 3, 3);
}

function renderPage(text: string, title: string, page: number, total: number, source?: string, count?: number): any {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    background(ctx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#67d18a';
    ctx.font = 'bold 42px Cairo';
    ctx.fillText(title, WIDTH / 2, 105);
    let fontSize = MAX_FONT;
    while (fontSize > MIN_FONT && !fits(ctx, text, fontSize)) fontSize -= 2;
    ctx.font = `${fontSize}px Tajawal`;
    ctx.fillStyle = '#ffffff';
    const lines = wrap(ctx, text, MAX_TEXT_WIDTH);
    const lineHeight = Math.round(fontSize * 1.42);
    const totalHeight = lines.length * lineHeight;
    let y = TEXT_TOP + Math.max(0, (TEXT_BOTTOM - TEXT_TOP - totalHeight) / 2) + lineHeight / 2;
    for (const line of lines) { ctx.fillText(line, WIDTH / 2, y, MAX_TEXT_WIDTH); y += lineHeight; }
    const details = [count && count > 1 ? `التكرار: ${count}` : '', source ? source : '', total > 1 ? `الصفحة ${page}/${total}` : ''].filter(Boolean).join('  •  ');
    ctx.fillStyle = '#b9d8c4';
    ctx.font = '24px Tajawal';
    ctx.fillText(details || 'رفيق الروح', WIDTH / 2, 570, MAX_TEXT_WIDTH);
    return canvas.toBuffer('image/png');
}

export function generateAdaptiveAdhkarImages(text: string, title: string, source?: string, count?: number): any[] {
    const measure = createCanvas(WIDTH, HEIGHT).getContext('2d');
    const pages = paginate(measure, text.trim());
    const continuationTitle = /(?:دعاء|أدعية|الدعاء)/u.test(`${title} ${text}`)
        ? 'تكملة الدعاء'
        : 'تكملة الذكر';
    return pages.map((pageText, index) => renderPage(
        pageText,
        index === 0 ? title : continuationTitle,
        index + 1,
        pages.length,
        source,
        count,
    ));
}

export function generateNamesGridImage(names: string[], page: number, totalPages: number): any {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    background(ctx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#67d18a';
    ctx.font = 'bold 42px Cairo';
    ctx.fillText('أسماء الله الحسنى', WIDTH / 2, 92);
    const cellWidth = 300;
    const cellHeight = 115;
    const startX = 150;
    const startY = 150;
    names.slice(0, 9).forEach((name, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const x = startX + col * cellWidth;
        const y = startY + row * cellHeight;
        ctx.fillStyle = 'rgba(103,209,138,0.10)';
        ctx.strokeStyle = 'rgba(103,209,138,0.55)';
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, cellWidth - 20, cellHeight - 18);
        ctx.strokeRect(x, y, cellWidth - 20, cellHeight - 18);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 38px Cairo';
        ctx.fillText(name, x + (cellWidth - 20) / 2, y + (cellHeight - 18) / 2, cellWidth - 40);
    });
    ctx.fillStyle = '#b9d8c4';
    ctx.font = '24px Tajawal';
    ctx.fillText(`9 أسماء في كل مرة • المجموعة ${page}/${totalPages}`, WIDTH / 2, 565);
    return canvas.toBuffer('image/png');
}



