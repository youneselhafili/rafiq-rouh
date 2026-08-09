import type { Timestamp } from 'firebase-admin/firestore';

// ─── Firestore Document Types (single /default doc per module) ──

export interface AdhkarConfigDoc {
    enabled: boolean;
    channelId: string;
    types: string[];
    times: Record<string, string>;
    updatedAt: Timestamp | null;
}

export interface AdhanZone {
    country: string;
    city: string;
    timezone: string;
    channelId: string;
    roleId?: string | null;
    enabled: boolean;
}

export interface AdhanConfigDoc {
    enabled: boolean;
    zones: AdhanZone[];
    updatedAt: Timestamp | null;
}

export interface QuranRadioConfigDoc {
    enabled: boolean;
    voiceChannelId: string;
    textChannelId: string;
    twentyFourSeven: boolean;
    defaultSource: string;
    updatedAt: Timestamp | null;
}

export interface SalawatConfigDoc {
    enabled: boolean;
    channelId: string;
    intervalHours: number;
    updatedAt: Timestamp | null;
}

