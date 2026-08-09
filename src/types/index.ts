// ─── Content Types ────────────────────────────────────────────

export interface AdhkarItem {
    id: string;
    text: string;
    count: number;
    source: string;
    type: 'dua' | 'tasbih' | 'ayah' | 'hadith';
}

export interface AdhkarCategory {
    id: string;
    key: string;
    name: string;
    items: AdhkarItem[];
    defaultTime?: string;
    group: 'daily' | 'dua' | 'misc';
    emoji: string;
}

export interface Reciter {
    id: number;
    name: string;
    letter: string;
    moshaf: Moshaf[];
}

export interface Moshaf {
    id: number;
    name: string;
    server: string;
    surah_total: number;
    surah_list: string;
}

export interface RadioStation {
    id: number;
    name: string;
    url: string;
    recent_date: string;
}

// ─── Guild Settings Types ─────────────────────────────────────

export interface GuildAdhkarConfig {
    type: string;
    channelId: string;
    time: string;
    city?: string;
    country?: string;
}

export interface GuildAdhanConfig {
    country: string;
    city: string;
    timezone: string;
    channelId: string;
    roleId?: string;
}

export interface GuildSalawatConfig {
    channelId: string;
    intervalHours: number;
}

export interface GuildQuranRadioConfig {
    voiceChannelId: string;
    textChannelId: string;
    twentyFourSeven: boolean;
    defaultSource: string;
}

export interface GuildSettings {
    guildId: string;
    adhkar: GuildAdhkarConfig[];
    adhan: GuildAdhanConfig[];
    salawat: GuildSalawatConfig[];
    quranRadio: GuildQuranRadioConfig | null;
    createdAt: string;
    updatedAt: string;
}

// ─── Catalog Types ────────────────────────────────────────────

export interface AdhkarCatalog {
    version: string;
    generatedAt: string;
    categories: AdhkarCategory[];
}

export interface RecitersCatalog {
    version: string;
    generatedAt: string;
    reciters: Reciter[];
}

export interface RadiosCatalog {
    version: string;
    generatedAt: string;
    radios: RadioStation[];
}

// ─── Content Registry Types ───────────────────────────────────

export type ContentType = 'adhkar' | 'reciter' | 'radio';

export interface ContentSource {
    id: string;
    type: ContentType;
    filePath: string;
    label: string;
}

// ─── Quran Registry Types (isolated from adhkar/adhan/salawat) ─

export interface QuranSurah {
    name: string;
    url: string;
}

export interface QuranReciterSource {
    id: string;
    name: string;
    surahs: QuranSurah[];
}

export interface QuranRadioSource {
    id: string;
    name: string;
    streamUrl: string;
}

export interface QuranLibrarySource {
    id: string;
    name: string;
    description: string;
}

export type QuranContentType = 'reciter' | 'radio' | 'audio_library';

export interface QuranSource {
    id: string;
    type: QuranContentType;
    label: string;
}

// ─── Service Response Types ───────────────────────────────────

export interface ContentResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}
