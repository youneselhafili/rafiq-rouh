import { AdhkarCategory, AdhkarItem, Reciter, RadioStation, Moshaf } from '../types';
import * as catalog from '../bootstrap/catalogBuilder';
// LIVE_MAKKAH_URL and LIVE_MADINA_URL removed

// ─── Initialization ───────────────────────────────────────────

export function initContentService(): void {
    catalog.initializeCatalogs();
}

// ─── Adhkar ───────────────────────────────────────────────────

export function getAllAdhkarCategories(): AdhkarCategory[] {
    return catalog.getAdhkarCategories();
}

export function getAdhkarByKey(key: string): AdhkarItem[] {
    const category = catalog.getAdhkarCategories().find(c => c.key === key);
    return category?.items || [];
}

export function getAdhkarCategory(key: string): AdhkarCategory | undefined {
    return catalog.getAdhkarCategories().find(c => c.key === key);
}

const adhkarCategoryDescriptions: Record<string, string> = {
    'أدعية الأنبياء': 'أدعية مأثورة وردت على ألسنة الأنبياء عليهم السلام',
    'أدعية للميت': 'أدعية للمتوفى بالرحمة والمغفرة والثبات',
    'أدعية نبوية': 'أدعية مأثورة عن النبي ﷺ في أحوال متنوعة',
    'أذكار الآذان': 'أذكار إجابة المؤذن والدعاء بعد الأذان',
    'أذكار الاستيقاظ': 'أذكار تُقال عند الاستيقاظ من النوم',
    'أذكار الحج والعمرة': 'أذكار وأدعية متعلقة بمناسك الحج والعمرة',
    'أذكار الخلاء': 'أذكار الدخول إلى الخلاء والخروج منه',
    'أذكار الصباح': 'أذكار التحصين التي تُقال في الصباح',
    'أذكار الصلاة': 'أذكار وأدعية مرتبطة بالصلاة وأحوالها',
    'أذكار الطعام': 'أذكار الطعام والشراب وما يتصل بهما',
    'أذكار المساء': 'أذكار التحصين التي تُقال في المساء',
    'أذكار المسجد': 'أذكار دخول المسجد والخروج منه',
    'أذكار المنزل': 'أذكار دخول المنزل والخروج منه',
    'أذكار النوم': 'أذكار وأدعية تُقال قبل النوم',
    'أذكار الوضوء': 'أذكار الوضوء والدعاء بعد الفراغ منه',
    'أذكار بعد الصلاة': 'الأذكار المشروعة بعد الصلوات المفروضة',
    'أذكار متفرقة': 'أذكار مأثورة لمواقف وأحوال متنوعة',
    'أذكار يوم الجمعة': 'أذكار وفضائل وأعمال متعلقة بيوم الجمعة',
    'أسماء الله الحسنى': 'أسماء الله الحسنى الواردة في مكتبة البوت',
    'الأدعية القرآنية': 'أدعية واردة في آيات القرآن الكريم',
    'الرقية الشرعية': 'آيات وأدعية مشروعة للرقية والتحصين',
    'تسابيح': 'صيغ التسبيح والتحميد والتهليل والتكبير',
    'جوامع الدعاء': 'أدعية جامعة لخيري الدنيا والآخرة',
    'دعاء ختم القرآن': 'أدعية تُقرأ عند إتمام تلاوة القرآن الكريم',
    'فضائل السور': 'نصوص تعريفية بفضائل سور من القرآن الكريم',
    'فضل الدعاء': 'نصوص تبيّن مكانة الدعاء وآدابه وفضله',
    'فضل الذكر': 'نصوص تبيّن فضل ذكر الله وآثاره',
};

export function getAllAdhkarCategoryNames():
    { key: string; name: string; defaultTime?: string; group: string; emoji: string; description: string; itemCount: number }[] {
    return catalog.getAdhkarCategories().map(c => ({
        key: c.key,
        name: c.name,
        defaultTime: c.defaultTime,
        group: c.group,
        emoji: c.emoji,
        itemCount: c.items.length,
        description: `${adhkarCategoryDescriptions[c.key] || 'أذكار وأدعية محفوظة في مكتبة البوت'} • ${c.items.length.toLocaleString('ar-MA')} نص${c.defaultTime ? ` • الموعد الافتراضي ${c.defaultTime}` : ''}`,
    })) as any;
}

// ─── Reciters ─────────────────────────────────────────────────

export function getReciters(): Reciter[] {
    return catalog.getReciters();
}

export function getReciterById(id: number): Reciter | undefined {
    return catalog.getReciters().find(r => r.id === id);
}

export function getReciterByName(name: string): Reciter | undefined {
    return catalog.getReciters().find(r => r.name.includes(name));
}

export function searchReciters(query: string): Reciter[] {
    const all = catalog.getReciters();
    if (!query) return all;
    return all.filter(r => r.name.includes(query) || r.name.toLowerCase().includes(query.toLowerCase()));
}

export function buildSurahUrls(moshaf: Moshaf): string[] {
    const surahIds = moshaf.surah_list.split(',').map(Number);
    return surahIds.map(id => {
        const paddedId = id.toString().padStart(3, '0');
        return `${moshaf.server}${paddedId}.mp3`;
    });
}

// ─── Radios ───────────────────────────────────────────────────

export function getRadios(): RadioStation[] {
    return catalog.getRadios();
}

export function getRadioById(id: number): RadioStation | undefined {
    return catalog.getRadios().find(r => r.id === id);
}

export function getAllRadios(): RadioStation[] {
    return catalog.getRadios();
}

export function getRadioWithLive(): RadioStation[] {
    return catalog.getRadios();
}

export function getRadioByName(name: string): RadioStation | undefined {
    return catalog.getRadios().find(r => r.name.includes(name));
}
