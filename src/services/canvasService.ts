import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import * as path from 'path';
import * as fs from 'fs';
import { PRAYER_NAMES } from '../utils/constants';

// Register Fonts
const cairoFontPath = path.resolve(process.cwd(), 'assets/fonts/Cairo-Bold.ttf');
const tajawalRegPath = path.resolve(process.cwd(), 'assets/fonts/Tajawal-Regular.ttf');
const tajawalBoldPath = path.resolve(process.cwd(), 'assets/fonts/Tajawal-Bold.ttf');

if (fs.existsSync(cairoFontPath)) GlobalFonts.registerFromPath(cairoFontPath, 'Cairo');
if (fs.existsSync(tajawalRegPath)) GlobalFonts.registerFromPath(tajawalRegPath, 'Tajawal');
if (fs.existsSync(tajawalBoldPath)) GlobalFonts.registerFromPath(tajawalBoldPath, 'Tajawal-Bold');

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 630;

// ─── Helpers ─────────────────────────────────────────────────

function wrapText(ctx: any, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + ' ' + word).width;
        if (width < maxWidth) {
            currentLine += ' ' + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

function drawIslamicArch(ctx: any, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    // Base
    ctx.moveTo(100, CANVAS_HEIGHT);
    ctx.lineTo(100, 300);
    // Left curve
    ctx.bezierCurveTo(100, 100, 300, 50, CANVAS_WIDTH / 2, 20);
    // Right curve
    ctx.bezierCurveTo(CANVAS_WIDTH - 300, 50, CANVAS_WIDTH - 100, 100, CANVAS_WIDTH - 100, 300);
    // Right base
    ctx.lineTo(CANVAS_WIDTH - 100, CANVAS_HEIGHT);
    ctx.closePath();
    ctx.fill();
}

function drawStars(ctx: any, count: number, opacity: number) {
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    for (let i = 0; i < count; i++) {
        const x = Math.random() * CANVAS_WIDTH;
        const y = Math.random() * (CANVAS_HEIGHT / 2); // Mostly top half
        const size = Math.random() * 2 + 1;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawMosqueSilhouette(ctx: any) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    
    // Base
    ctx.moveTo(0, CANVAS_HEIGHT);
    
    // Left Minaret
    ctx.lineTo(100, CANVAS_HEIGHT);
    ctx.lineTo(100, CANVAS_HEIGHT - 300);
    ctx.lineTo(120, CANVAS_HEIGHT - 320);
    ctx.lineTo(140, CANVAS_HEIGHT - 300);
    ctx.lineTo(140, CANVAS_HEIGHT - 100);
    
    // Main Dome
    ctx.lineTo(CANVAS_WIDTH / 2 - 150, CANVAS_HEIGHT - 100);
    ctx.bezierCurveTo(CANVAS_WIDTH / 2 - 150, CANVAS_HEIGHT - 300, CANVAS_WIDTH / 2 + 150, CANVAS_HEIGHT - 300, CANVAS_WIDTH / 2 + 150, CANVAS_HEIGHT - 100);
    
    // Right Minaret
    ctx.lineTo(CANVAS_WIDTH - 140, CANVAS_HEIGHT - 100);
    ctx.lineTo(CANVAS_WIDTH - 140, CANVAS_HEIGHT - 300);
    ctx.lineTo(CANVAS_WIDTH - 120, CANVAS_HEIGHT - 320);
    ctx.lineTo(CANVAS_WIDTH - 100, CANVAS_HEIGHT - 300);
    ctx.lineTo(CANVAS_WIDTH - 100, CANVAS_HEIGHT);
    
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.closePath();
    ctx.fill();
}

// ─── Premium Adhan Image (Redesigned) ────────────────────────

export async function generateAdhanImage(
    cityName: string,
    country: string,
    prayerId: string,
    prayerTime: string,
    verseText: string,
    verseReference: string
): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Premium dark teal gradient
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#0a192f');
    gradient.addColorStop(0.5, '#112240');
    gradient.addColorStop(1, '#020c1b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Decorative stars and mosque silhouette
    drawStars(ctx, 50, 0.2);
    drawIslamicArch(ctx, 'rgba(100, 255, 218, 0.05)');
    drawMosqueSilhouette(ctx);

    // Top decorative line
    ctx.strokeStyle = '#D4AF37'; // Gold
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(200, 80);
    ctx.lineTo(CANVAS_WIDTH - 200, 80);
    ctx.stroke();

    const arabicPrayer = PRAYER_NAMES[prayerId] || prayerId;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "حان الآن موعد أذان"
    ctx.fillStyle = '#64ffda'; // Mint green
    ctx.font = '35px Tajawal';
    ctx.fillText('حان الآن موعد أذان', CANVAS_WIDTH / 2, 130);

    // Prayer name
    ctx.fillStyle = '#D4AF37';
    ctx.font = '80px Cairo';
    ctx.fillText(arabicPrayer, CANVAS_WIDTH / 2, 210);

    // Prayer time — white, large
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 65px Tajawal-Bold';
    ctx.fillText(prayerTime, CANVAS_WIDTH / 2, 290);

    // City + country
    ctx.fillStyle = '#b0c4de';
    ctx.font = '28px Tajawal';
    ctx.fillText(`📍 ${cityName} — ${country}`, CANVAS_WIDTH / 2, 350);

    // Decorative separator
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2 - 150, 390);
    ctx.lineTo(CANVAS_WIDTH / 2 + 150, 390);
    ctx.stroke();

    // Verse
    ctx.fillStyle = '#e0e8f0';
    ctx.font = '33px Cairo';
    const verseLines = wrapText(ctx, `﴿${verseText}﴾`, CANVAS_WIDTH * 0.85);
    let vY = 430;
    for (const line of verseLines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, vY);
        vY += 45;
    }

    // Verse Reference
    ctx.fillStyle = '#D4AF37';
    ctx.font = '22px Tajawal';
    ctx.fillText(verseReference, CANVAS_WIDTH / 2, vY);

    // Bottom decorative line
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2 - 100, CANVAS_HEIGHT - 60);
    ctx.lineTo(CANVAS_WIDTH / 2 + 100, CANVAS_HEIGHT - 60);
    ctx.stroke();

    return canvas.toBuffer('image/png');
}

// ─── Adhan Warning Image ────────────────────────────────────

export async function generateAdhanWarningImage(
    cityNameAr: string,
    countryAr: string,
    arabicPrayerName: string,
    prayerTime: string
): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, 400);
    const ctx = canvas.getContext('2d');

    // Warm amber-to-dark gradient
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, 400);
    gradient.addColorStop(0, '#1a0f00');
    gradient.addColorStop(0.5, '#2d1600');
    gradient.addColorStop(1, '#1a0f00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, 400);

    drawStars(ctx, 30, 0.15);

    // Soft amber glow in center
    const glow = ctx.createRadialGradient(CANVAS_WIDTH / 2, 200, 20, CANVAS_WIDTH / 2, 200, 400);
    glow.addColorStop(0, 'rgba(245, 158, 11, 0.1)');
    glow.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CANVAS_WIDTH, 400);

    // Top & bottom lines
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(150, 30);
    ctx.lineTo(CANVAS_WIDTH - 150, 30);
    ctx.moveTo(150, 370);
    ctx.lineTo(CANVAS_WIDTH - 150, 370);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.fillStyle = '#f59e0b'; // Amber
    ctx.font = '30px Tajawal';
    ctx.fillText('تذكير باقتراب الأذان', CANVAS_WIDTH / 2, 90);

    // Message
    ctx.fillStyle = '#ffffff';
    ctx.font = '55px Cairo';
    ctx.fillText(`تبقى 5 دقائق على رفع أذان ${arabicPrayerName}`, CANVAS_WIDTH / 2, 170);

    // Location & Time
    ctx.fillStyle = '#fcd34d'; // Lighter amber
    ctx.font = 'bold 35px Tajawal-Bold';
    ctx.fillText(`⏰ ${prayerTime}`, CANVAS_WIDTH / 2, 250);

    ctx.fillStyle = '#d4d4d8';
    ctx.font = '25px Tajawal';
    ctx.fillText(`📍 ${cityNameAr} — ${countryAr}`, CANVAS_WIDTH / 2, 310);

    return canvas.toBuffer('image/png');
}

// ─── Prayer Card (Generic) ───────────────────────────────────

export async function generatePrayerCard(
    cityName: string,
    fajr: string,
    dhuhr: string,
    asr: string,
    maghrib: string,
    isha: string
): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#2b1055');
    gradient.addColorStop(1, '#7597de');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawStars(ctx, 100, 0.5);
    drawMosqueSilhouette(ctx);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffffff';
    ctx.font = '60px Cairo';
    ctx.fillText('مواقيت الصلاة', CANVAS_WIDTH / 2, 100);

    ctx.fillStyle = '#d4d4d8';
    ctx.font = '30px Tajawal';
    ctx.fillText(`📍 مدينة ${cityName}`, CANVAS_WIDTH / 2, 160);

    const startX = 150;
    const spacing = (CANVAS_WIDTH - 300) / 4;
    const yPos = 300;

    const prayers = [
        { name: 'الفجر', time: fajr },
        { name: 'الظهر', time: dhuhr },
        { name: 'العصر', time: asr },
        { name: 'المغرب', time: maghrib },
        { name: 'العشاء', time: isha },
    ];

    prayers.forEach((prayer, index) => {
        const x = startX + index * spacing;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.roundRect(x - 80, yPos - 80, 160, 160, 20);
        ctx.fill();

        ctx.fillStyle = '#D4AF37';
        ctx.font = '30px Tajawal';
        ctx.fillText(prayer.name, x, yPos - 30);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 35px Tajawal-Bold';
        ctx.fillText(prayer.time, x, yPos + 30);
    });

    return canvas.toBuffer('image/png');
}

// ─── Jumuah Image ────────────────────────────────────────────

export async function generateJumuahImage(quote: string): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#1e3c2f');
    gradient.addColorStop(1, '#0c1b14');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawIslamicArch(ctx, 'rgba(255, 255, 255, 0.05)');

    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2 - 200, 100);
    ctx.lineTo(CANVAS_WIDTH / 2 + 200, 100);
    ctx.moveTo(CANVAS_WIDTH / 2 - 200, CANVAS_HEIGHT - 100);
    ctx.lineTo(CANVAS_WIDTH / 2 + 200, CANVAS_HEIGHT - 100);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#D4AF37';
    ctx.font = '70px Cairo';
    ctx.fillText('جمعة مباركة', CANVAS_WIDTH / 2, 180);

    ctx.fillStyle = '#ffffff';
    ctx.font = '40px Tajawal';
    const lines = wrapText(ctx, quote, CANVAS_WIDTH - 300);
    const lineHeight = 60;
    
    const centerPoint = 390; // Center between 180 (title) and 630
    const totalHeight = lines.length * lineHeight;
    let startY = centerPoint - (totalHeight / 2) + (lineHeight / 2);

    for (const line of lines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, startY);
        startY += lineHeight;
    }

    return canvas.toBuffer('image/png');
}

export async function generateJumuahKahfImage(quote: string, reciterName: string): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#071a15');
    gradient.addColorStop(0.52, '#123c2e');
    gradient.addColorStop(1, '#07110d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawStars(ctx, 42, 0.14);
    drawIslamicArch(ctx, 'rgba(212, 175, 55, 0.06)');

    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 3;
    ctx.strokeRect(42, 42, CANVAS_WIDTH - 84, CANVAS_HEIGHT - 84);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';

    ctx.fillStyle = '#e8d28a';
    ctx.font = '30px Tajawal-Bold';
    ctx.fillText('تلاوة يوم الجمعة', CANVAS_WIDTH / 2, 105);

    ctx.fillStyle = '#ffffff';
    ctx.font = '84px Cairo';
    ctx.fillText('سورة الكهف', CANVAS_WIDTH / 2, 205);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.roundRect(220, 275, CANVAS_WIDTH - 440, 92, 24);
    ctx.fill();

    ctx.fillStyle = '#D4AF37';
    ctx.font = '27px Tajawal-Bold';
    ctx.fillText('القارئ', CANVAS_WIDTH / 2, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = '38px Tajawal-Bold';
    ctx.fillText(reciterName, CANVAS_WIDTH / 2, 340);

    ctx.fillStyle = '#e7eee9';
    ctx.font = '29px Tajawal';
    const lines = wrapText(ctx, quote, CANVAS_WIDTH - 250).slice(0, 3);
    const lineHeight = 43;
    let y = 440 - ((lines.length - 1) * lineHeight) / 2;
    for (const line of lines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, y);
        y += lineHeight;
    }

    ctx.fillStyle = '#D4AF37';
    ctx.font = '24px Tajawal-Bold';
    ctx.fillText('رفيق الروح • جمعة مباركة', CANVAS_WIDTH / 2, 565);

    return canvas.toBuffer('image/png');
}
// ─── Quran Live Image ─────────────────────────────────────────

export async function generateQuranLiveImage(reciterName: string, isLive: boolean = false): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#111827');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#D4AF37';
    ctx.font = '60px Cairo';
    ctx.fillText('القرآن الكريم', CANVAS_WIDTH / 2, 200);

    ctx.fillStyle = '#ffffff';
    ctx.font = '40px Tajawal';
    ctx.fillText(`القارئ: ${reciterName}`, CANVAS_WIDTH / 2, 300);

    if (isLive) {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 30px Tajawal-Bold';
        ctx.fillText('🔴 بث مباشر', CANVAS_WIDTH / 2, 400);
    }

    return canvas.toBuffer('image/png');
}

// ─── Adhkar Image ────────────────────────────────────────────

export async function generateAdhkarImage(dhikrText: string, isTasbih: boolean = false, title: string = 'ذِكْرُ اللهِ'): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#1a3a2a');
    gradient.addColorStop(0.5, '#0d2818');
    gradient.addColorStop(1, '#06140c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawStars(ctx, 40, 0.2);
    drawIslamicArch(ctx, 'rgba(76, 175, 80, 0.15)');

    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(200, 80);
    ctx.lineTo(CANVAS_WIDTH - 200, 80);
    ctx.moveTo(200, CANVAS_HEIGHT - 60);
    ctx.lineTo(CANVAS_WIDTH - 200, CANVAS_HEIGHT - 60);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#4CAF50';
    ctx.font = '45px Cairo';
    ctx.fillText(title, CANVAS_WIDTH / 2, 140);

    ctx.fillStyle = '#ffffff';
    const fontSize = isTasbih ? 55 : 40;
    ctx.font = `${fontSize}px "Tajawal"`;
    const lines = wrapText(ctx, dhikrText, CANVAS_WIDTH - 250);
    const lineHeight = isTasbih ? 75 : 60;
    
    // We center the text between the header (Y=140) and the bottom line (Y=570)
    // Usable center is roughly (140 + 570) / 2 = 355
    const centerPoint = 355;
    const totalHeight = lines.length * lineHeight;
    let startY = centerPoint - (totalHeight / 2) + (lineHeight / 2);

    for (const line of lines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, startY);
        startY += lineHeight;
    }

    return canvas.toBuffer('image/png');
}

// ─── Salawat Image ───────────────────────────────────────────

export async function generateSalawatImage(text: string = 'اللهم صل وسلم على نبينا محمد'): Promise<any> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#0f1b0e');
    gradient.addColorStop(1, '#1a3317');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawStars(ctx, 60, 0.3);
    drawIslamicArch(ctx, 'rgba(76, 175, 80, 0.3)');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#4CAF50';
    ctx.font = '50px Cairo';
    ctx.fillText('صلوا على النبي', CANVAS_WIDTH / 2, 160);
    ctx.font = '30px Cairo';
    ctx.fillText('صلى الله عليه وسلم', CANVAS_WIDTH / 2, 210);

    ctx.fillStyle = '#ffffff';
    ctx.font = '42px Tajawal';
    const lines = wrapText(ctx, text, CANVAS_WIDTH - 250);
    const lineHeight = 60;
    
    const centerPoint = 390; // Center between 180 and 630
    const totalHeight = lines.length * lineHeight;
    let startY = centerPoint - (totalHeight / 2) + (lineHeight / 2);
    
    for (const line of lines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, startY);
        startY += lineHeight;
    }

    return canvas.toBuffer('image/png');
}
