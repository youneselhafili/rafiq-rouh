import { DMLanguage } from './dmSubscriptionService';

const UI_TEXT: Record<string, Record<DMLanguage, string>> = {
    adhan_warning: {
        ar: 'بقيت 5 دقائق على الأذان',
        darija: 'بقاو 5 دقايق على الآذان',
        en: '5 minutes left until Adhan',
        fr: 'Il reste 5 minutes avant l’adhan',
    },
    adhan_now: {
        ar: 'حان وقت الصلاة',
        darija: 'دخل وقت الصلاة',
        en: 'It is time for prayer',
        fr: 'C’est l’heure de la prière',
    },
    prayer_card: {
        ar: 'مواقيت الصلاة',
        darija: 'مواقيت الصلاة',
        en: 'Prayer times',
        fr: 'Horaires de prière',
    },
    salawat_dm: {
        ar: 'رسالة خاصة بالصلاة على النبي ﷺ',
        darija: 'رسالة ديال الصلاة على النبي ﷺ',
        en: 'Private Salawat reminder ﷺ',
        fr: 'Rappel privé de salawat ﷺ',
    },
    jumuah_dm: {
        ar: 'رسالة خاصة بيوم الجمعة',
        darija: 'رسالة ديال نهار الجمعة',
        en: 'Private Friday reminder',
        fr: 'Rappel privé du vendredi',
    },
    adhkar_dm: {
        ar: 'ذكر خاص',
        darija: 'ذكر فالخاص',
        en: 'Private dhikr',
        fr: 'Dhikr privé',
    },
};

export function dmText(key: keyof typeof UI_TEXT, language: DMLanguage = 'ar'): string {
    return UI_TEXT[key]?.[language] || UI_TEXT[key]?.ar || key;
}

export function localizeSacredContent(text: string, _language: DMLanguage = 'ar'): string {
    // Religious source text stays in Arabic until curated translations are added.
    return text;
}
