import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    ChannelType,
    Client,
    EmbedBuilder,
    Guild,
    GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
    canAttemptFirebase,
    getDb,
    recordFirebaseFailure,
    recordFirebaseSuccess,
} from '../config/firebase';
import { getUserDMConfig, updateUserDMConfig, UserDMConfig } from './dmSubscriptionService';
import { getModuleConfig, setModuleConfig } from './guildConfigService';
import { getAdhkarV2Config, saveAdhkarV2Config } from './adhkarConfigServiceV2';
import { getJumuahV2Config, saveJumuahV2Config } from './jumuahConfigServiceV2';
import { getAllAdhkarCategoryNames } from './contentService';
import { getSalawatV2Config, saveSalawatV2Config, SalawatV2Config } from './salawatConfigServiceV2';
import { deleteManagedAdhanZone, getManagedAdhanZones, getPrimaryAdhanZone, saveManagedAdhanZone } from './adhanZoneService';
import { scheduleAdhanForGuild } from './adhanService';
import cities from '../data/cities.json';
import { calculatePagesPerDay, getGuildKhatma, setGuildKhatma } from './khatmaService';
import {
    getPersonalGuildKhatma,
    getPersonalKhatmaProgress,
    PersonalGuildKhatmaConfig,
    deletePersonalGuildKhatma,
    savePersonalGuildKhatma,
} from './personalGuildKhatmaService';
import { getPersonalKhatmaPanel } from './personalGuildKhatmaService';
import { getQuranRadioConfig } from './guildService';
import { logger } from '../utils/logger';
import { buildDMIntroPayload } from '../commands/dm/setupDm';

interface OAuthGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
}

interface DashboardUser {
    id: string;
    username: string;
    globalName?: string | null;
    avatar: string | null;
}

interface DashboardSession {
    user: DashboardUser;
    oauthGuilds: OAuthGuild[];
    expiresAt: number;
}

interface ServerConfig extends Record<string, unknown> {
    dashboardAdminRoleId?: string;
    adhanChannelId?: string;
    adhkarChannelId?: string;
    quranChannelId?: string;
    jumuahChannelId?: string;
    logsChannelId?: string;
    rolePanelChannelId?: string;
    dmPanelChannelId?: string;
}

const memorySessions = new Map<string, DashboardSession>();
const pendingOAuthStates = new Map<string, number>();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const websiteRoot = path.resolve(process.cwd(), 'website');
let dashboardStarted = false;

function env(name: string, fallback = ''): string {
    return String(process.env[name] || fallback).trim();
}

function cookieMap(request: IncomingMessage): Record<string, string> {
    const result: Record<string, string> = {};
    for (const part of String(request.headers.cookie || '').split(';')) {
        const index = part.indexOf('=');
        if (index < 1) continue;
        result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return result;
}

function bearerToken(request: IncomingMessage): string {
    const authorization = String(request.headers.authorization || '');
    return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
}

function dashboardWebUrl(pathname = '/dashboard'): string {
    const origin = env('DASHBOARD_WEB_ORIGIN', DEFAULT_DASHBOARD_ORIGINS[0]).replace(/\/$/, '');
    return `${origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function cookie(name: string, value: string, options: { maxAge?: number; clear?: boolean } = {}): string {
    const production = env('NODE_ENV') === 'production';
    const secure = production ? '; Secure' : '';
    const sameSite = production ? 'None' : 'Lax';
    const maxAge = options.clear ? '; Max-Age=0' : options.maxAge ? `; Max-Age=${options.maxAge}` : '';
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}${maxAge}`;
}

const DEFAULT_DASHBOARD_ORIGINS = ['https://rafikk-rouh.web.app'];

function allowedDashboardOrigins(): string[] {
    const extra = env('DASHBOARD_ALLOWED_ORIGIN')
        .split(',')
        .map(origin => origin.trim().replace(/\/$/, ''))
        .filter(Boolean);
    return [...new Set([...DEFAULT_DASHBOARD_ORIGINS, ...extra])];
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
    const origin = String(request.headers.origin || '').replace(/\/$/, '');
    if (!origin || !allowedDashboardOrigins().includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
    };
}

function sessionKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function avatarUrl(user: DashboardUser): string {
    if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    const index = Number((BigInt(user.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers,
    });
    response.end(JSON.stringify(body));
}

function redirect(response: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
    response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
    response.end();
}

async function bodyJson(request: IncomingMessage): Promise<Record<string, any>> {
    return await new Promise((resolve, reject) => {
        const chunks: string[] = [];
        let size = 0;
        request.on('data', chunk => {
            const text = String(chunk);
            size += text.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                request.destroy();
                return;
            }
            chunks.push(text);
        });
        request.on('end', () => {
            if (!chunks.length) return resolve({});
            try {
                resolve(JSON.parse(chunks.join('')));
            } catch {
                reject(new Error('Invalid JSON body.'));
            }
        });
        request.on('error', reject);
    });
}

function firestoreAvailable(): boolean {
    return canAttemptFirebase();
}

async function putSession(token: string, session: DashboardSession): Promise<void> {
    memorySessions.set(sessionKey(token), session);
    if (!firestoreAvailable()) return;
    try {
        await getDb().doc(`dashboardSessions/${sessionKey(token)}`).set({
            ...session,
            createdAt: FieldValue.serverTimestamp(),
        });
        recordFirebaseSuccess();
    } catch (error) {
        recordFirebaseFailure(error, 'save dashboard session');
    }
}

async function readSession(token: string): Promise<DashboardSession | null> {
    if (!token) return null;
    const key = sessionKey(token);
    const cached = memorySessions.get(key);
    if (cached) {
        if (cached.expiresAt > Date.now()) return cached;
        memorySessions.delete(key);
    }
    if (!firestoreAvailable()) return null;
    try {
        const snap = await getDb().doc(`dashboardSessions/${key}`).get();
        recordFirebaseSuccess();
        if (!snap.exists) return null;
        const data = snap.data() as DashboardSession;
        if (!data || Number(data.expiresAt) <= Date.now()) {
            await snap.ref.delete().catch(() => undefined);
            return null;
        }
        memorySessions.set(key, data);
        return data;
    } catch (error) {
        recordFirebaseFailure(error, 'read dashboard session');
        return null;
    }
}

async function deleteSession(token: string): Promise<void> {
    if (!token) return;
    const key = sessionKey(token);
    memorySessions.delete(key);
    if (firestoreAvailable()) await getDb().doc(`dashboardSessions/${key}`).delete().catch(() => undefined);
}

async function requireSession(request: IncomingMessage, response: ServerResponse): Promise<DashboardSession | null> {
    const session = await readSession(bearerToken(request) || cookieMap(request).rafiq_session || '');
    if (!session) json(response, 401, { error: 'authentication_required' });
    return session;
}

async function memberFor(guild: Guild, userId: string): Promise<GuildMember | null> {
    return guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
}

async function canManageGuild(guild: Guild, userId: string): Promise<boolean> {
    const member = await memberFor(guild, userId);
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    const config = await getModuleConfig<ServerConfig>(guild.id, 'serverConfig');
    return Boolean(config?.dashboardAdminRoleId && member.roles.cache.has(config.dashboardAdminRoleId));
}

async function manageableGuilds(client: Client, session: DashboardSession) {
    const result = [];
    for (const oauthGuild of session.oauthGuilds) {
        const guild = client.guilds.cache.get(oauthGuild.id);
        if (!guild || !await canManageGuild(guild, session.user.id)) continue;
        result.push({
            id: guild.id,
            name: guild.name,
            iconUrl: guild.iconURL({ extension: 'png', size: 128 }),
            memberCount: guild.memberCount,
            owner: guild.ownerId === session.user.id,
        });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function authorizedGuild(client: Client, session: DashboardSession, guildId: string): Promise<Guild | null> {
    if (!session.oauthGuilds.some(guild => guild.id === guildId)) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild || !await canManageGuild(guild, session.user.id)) return null;
    return guild;
}

async function sharedGuild(client: Client, session: DashboardSession, guildId: string): Promise<Guild | null> {
    if (!session.oauthGuilds.some(guild => guild.id === guildId)) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild || !await memberFor(guild, session.user.id)) return null;
    return guild;
}

async function visibleGuilds(client: Client, session: DashboardSession) {
    const result: Array<{ id: string; name: string; iconUrl: string | null; memberCount: number; owner: boolean; canManage: boolean }> = [];
    for (const oauthGuild of session.oauthGuilds) {
        const guild = client.guilds.cache.get(oauthGuild.id);
        if (!guild) continue;
        const canManage = await canManageGuild(guild, session.user.id);
        result.push({
            id: guild.id,
            name: guild.name,
            iconUrl: guild.iconURL({ extension: 'png', size: 128 }),
            memberCount: guild.memberCount,
            owner: guild.ownerId === session.user.id,
            canManage,
        });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
}

function channelKind(type: ChannelType): 'text' | 'voice' | 'category' | 'other' {
    if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(type)) return 'text';
    if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(type)) return 'voice';
    if (type === ChannelType.GuildCategory) return 'category';
    return 'other';
}

async function listChannels(guild: Guild) {
    const channels = await guild.channels.fetch();
    const botMember = guild.members.me;
    return [...channels.values()]
        .filter((channel): channel is NonNullable<typeof channel> => Boolean(channel))
        .map(channel => {
            const permissions = botMember ? channel.permissionsFor(botMember) : null;
            const kind = channelKind(channel.type);
            const canView = Boolean(permissions?.has(PermissionFlagsBits.ViewChannel));
            const canSend = kind === 'text' && Boolean(
                permissions?.has(PermissionFlagsBits.SendMessages) &&
                permissions?.has(PermissionFlagsBits.EmbedLinks)
            );
            const canConnect = kind === 'voice' && Boolean(permissions?.has(PermissionFlagsBits.Connect));
            return {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                kind,
                parentId: channel.parentId,
                parentName: channel.parent?.name || null,
                position: channel.rawPosition,
                canView,
                canSend,
                canConnect,
            };
        })
        .filter(channel => channel.kind !== 'category' && channel.kind !== 'other' && channel.canView)
        .sort((a, b) => (a.parentName || '').localeCompare(b.parentName || '') || a.position - b.position);
}

async function listRoles(guild: Guild) {
    await guild.roles.fetch();
    const botHighest = guild.members.me?.roles.highest.position ?? 0;
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((a, b) => b.position - a.position)
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.hexColor,
            position: role.position,
            editableByBot: role.position < botHighest,
        }));
}

function findSetting(body: Record<string, any>, id: string): boolean {
    const groups = Object.values(body.settings || {});
    for (const group of groups) {
        if (!Array.isArray(group)) continue;
        const setting = group.find((item: any) => Array.isArray(item) ? item[0] === id : item?.id === id);
        if (setting) return Array.isArray(setting) ? setting[7] === true : setting.enabled === true;
    }
    return false;
}

function dmConfigFromDashboard(current: UserDMConfig, body: Record<string, any>): Partial<UserDMConfig> {
    const prayer = findSetting(body, 'prayer');
    const before = findSetting(body, 'before');
    const after = findSetting(body, 'after');
    const morning = findSetting(body, 'morning');
    const evening = findSetting(body, 'evening');
    const sleep = findSetting(body, 'sleep');
    const dua = findSetting(body, 'dua');
    const kahf = findSetting(body, 'kahf');
    return {
        enabled: body.enabled !== false,
        language: 'ar',
        city: String(body.city || current.city || '').trim() || undefined,
        timezone: String(body.timezone || current.timezone || '').trim() || undefined,
        adhan: prayer,
        adhan_zone: String(body.city || current.city || '').trim() || undefined,
        adhanConfig: {
            ...current.adhanConfig,
            enabled: prayer,
            events: { ...current.adhanConfig.events, warning: before, prayer_card: after },
        },
        adhkar_sabah: morning,
        adhkar_masa: evening,
        adhkar_nawm: sleep,
        adhkar_other: dua,
        adhkarConfig: {
            ...current.adhkarConfig,
            enabled: morning || evening || sleep || dua,
            categories: {
                ...current.adhkarConfig.categories,
                adhkar_sabah: morning,
                adhkar_masa: evening,
                adhkar_nawm: sleep,
                adhkar_other: dua,
            },
        },
        jumuah: kahf,
        jumuahConfig: { ...current.jumuahConfig, enabled: kahf },
        dashboard: { settings: body.settings || {}, updatedAt: new Date().toISOString() },
    } as Partial<UserDMConfig>;
}

function dmConfigFromPatch(current: UserDMConfig, patch: Record<string, any>): Partial<UserDMConfig> {
    const out: Partial<UserDMConfig> = {};
    if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
    if (typeof patch.city === 'string') out.city = patch.city.trim() || undefined;
    if (typeof patch.timezone === 'string') out.timezone = patch.timezone.trim() || undefined;

    if (patch.adhanConfig && typeof patch.adhanConfig === 'object') {
        out.adhanConfig = { ...current.adhanConfig, ...(patch.adhanConfig as any) };
        if (patch.adhanConfig.events && typeof patch.adhanConfig.events === 'object') {
            out.adhanConfig = { ...(out.adhanConfig || {}), enabled: Boolean((out.adhanConfig || {}).enabled ?? current.adhanConfig?.enabled), prayers: { ...(current.adhanConfig?.prayers || {}) }, events: { ...(current.adhanConfig?.events || {}), ...(patch.adhanConfig.events as any) } };
        }
    }

    if (patch.adhkarConfig && typeof patch.adhkarConfig === 'object') {
        out.adhkarConfig = { ...current.adhkarConfig, ...(patch.adhkarConfig as any) };
        if (patch.adhkarConfig.categories && typeof patch.adhkarConfig.categories === 'object') {
            out.adhkarConfig = { ...(out.adhkarConfig || {}), enabled: Boolean((out.adhkarConfig || {}).enabled ?? current.adhkarConfig?.enabled), categories: { ...(current.adhkarConfig?.categories || {}), ...(patch.adhkarConfig.categories as any) } };
        }
    }

    if (patch.quranConfig && typeof patch.quranConfig === 'object') out.quranConfig = { ...current.quranConfig, ...(patch.quranConfig as any) };
    if (patch.salawatConfig && typeof patch.salawatConfig === 'object') out.salawatConfig = { ...current.salawatConfig, ...(patch.salawatConfig as any) };
    if (patch.jumuahConfig && typeof patch.jumuahConfig === 'object') out.jumuahConfig = { ...current.jumuahConfig, ...(patch.jumuahConfig as any) };
    if (patch.khatma && typeof patch.khatma === 'object') out.khatma = { ...current.khatma, ...(patch.khatma as any) };

    // store dashboard snapshot if provided
    if (patch.dashboard && typeof patch.dashboard === 'object') out.dashboard = { ...(current.dashboard || {}), ...(patch.dashboard as any), updatedAt: new Date().toISOString() };

    return out;
}

function summarizeWird(config: UserDMConfig | null, guildId?: string) {
    if (!config) return { enabled: false, items: [] };
    const items: string[] = [];
    if (config.adhkarConfig?.enabled) items.push('أذكار');
    if (config.quranConfig?.dailyAyah) items.push('آية يومية');
    if (config.salawatConfig?.enabled) items.push('الصلاة على النبي');
    if (config.khatma?.enabled) items.push('ختمة');
    // guildId currently unused but kept for future per-guild logic
    return { enabled: items.length > 0, items, text: items.length ? items.join(' • ') : 'غير مفعل' };
}

async function discoverDmPanelChannel(guild: Guild, client: Client): Promise<string | null> {
    const channels = await guild.channels.fetch();
    const botMember = guild.members.me;
    for (const channel of channels.values()) {
        if (!channel?.isTextBased() || channel.isDMBased() || !('messages' in channel)) continue;
        const permissions = botMember ? channel.permissionsFor(botMember) : null;
        if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ReadMessageHistory)) continue;
        const messages = await (channel as any).messages.fetch({ limit: 100 }).catch(() => null);
        const panel = messages?.find((message: any) => message.author?.id === client.user?.id && message.components?.some((row: any) => row.components?.some((component: any) => component.customId === 'dm_setup_open_dm')));
        if (panel) return channel.id;
    }
    return null;
}

function dmWirdProgress(config: UserDMConfig['khatma'] | undefined) {
    if (!config) return null;
    const pagesRead = Math.max(0, Math.min(604, (config.currentPage || 1) - 1));
    return {
        pagesRead,
        currentPage: Math.max(1, Math.min(605, config.currentPage || 1)),
        remainingPages: Math.max(0, 604 - pagesRead),
        percentage: Math.round((pagesRead / 604) * 100),
        completedKhatmas: 0,
        pagesDue: config.enabled ? Math.max(0, config.pagesPerDay || 0) : 0,
        isAhead: false,
    };
}

function personalWirdProgress(config: PersonalGuildKhatmaConfig | null) {
    if (!config) return null;
    const progress = getPersonalKhatmaProgress(config);
    return {
        ...progress,
        currentPage: config.currentPage,
        remainingPages: Math.max(0, 605 - config.currentPage),
        percentage: Math.round((Math.max(0, Math.min(604, config.currentPage - 1)) / 604) * 100),
        completedKhatmas: config.completedKhatmas,
    };
}

function cleanPersonalWird(body: Record<string, any>, guildId: string, userId: string, previous?: PersonalGuildKhatmaConfig | null): PersonalGuildKhatmaConfig {
    const validModes = ['custom', 'week', 'month', '3_months', '6_months', 'ramadan'] as const;
    const mode = validModes.includes(body.mode) ? body.mode : previous?.mode || 'month';
    const ramadanKhatmas = Math.max(1, Math.min(15, Number(body.ramadanKhatmas) || previous?.ramadanKhatmas || 1));
    const automaticPages = calculatePagesPerDay(mode, ramadanKhatmas);
    const pagesPerDay = mode === 'custom'
        ? Math.max(1, Math.min(604, Number(body.pagesPerDay) || previous?.pagesPerDay || 1))
        : automaticPages;
    const now = new Date().toISOString();
    return {
        guildId,
        userId,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : previous?.enabled ?? true,
        mode,
        pagesPerDay,
        ramadanKhatmas: mode === 'ramadan' ? ramadanKhatmas : undefined,
        currentPage: previous?.currentPage || 1,
        startedAt: previous?.startedAt || now,
        updatedAt: now,
        readingDates: previous?.readingDates || [],
        completedKhatmas: previous?.completedKhatmas || 0,
        lastCompletedAt: previous?.lastCompletedAt,
        awaitingRestartChoice: previous?.awaitingRestartChoice || false,
    };
}

function nextKhatmaRunAt(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const value = (type: string) => Number(parts.find(part => part.type === type)?.value || 0);
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    // Riyadh is UTC+3 all year; the daily Khatma job runs at 08:00 Riyadh.
    return new Date(Date.UTC(year, month - 1, day + (hour >= 8 ? 1 : 0), 5, 0, 0)).toISOString();
}

async function handleOAuthStart(response: ServerResponse): Promise<void> {
    const clientId = env('CLIENT_ID', env('DISCORD_CLIENT_ID'));
    const secret = env('DISCORD_CLIENT_SECRET');
    const redirectUri = env('DASHBOARD_REDIRECT_URI', 'http://127.0.0.1:5174/auth/callback');
    if (!clientId || !secret) {
        json(response, 503, { error: 'oauth_not_configured', message: 'Set CLIENT_ID and DISCORD_CLIENT_SECRET in .env.' });
        return;
    }
    const state = randomBytes(24).toString('hex');
    pendingOAuthStates.set(state, Date.now() + 10 * 60 * 1000);
    const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'identify guilds', state, prompt: 'consent' });
    redirect(response, `https://discord.com/oauth2/authorize?${params.toString()}`);
}

async function handleOAuthCallback(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const stateExpiresAt = state ? pendingOAuthStates.get(state) : undefined;
    if (state) pendingOAuthStates.delete(state);
    if (!code || !state || !stateExpiresAt || stateExpiresAt <= Date.now()) {
        redirect(response, `${dashboardWebUrl()}?auth_error=invalid_state`);
        return;
    }
    const clientId = env('CLIENT_ID', env('DISCORD_CLIENT_ID'));
    const clientSecret = env('DISCORD_CLIENT_SECRET');
    const redirectUri = env('DASHBOARD_REDIRECT_URI', 'http://127.0.0.1:5174/auth/callback');
    try {
        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
        });
        if (!tokenResponse.ok) throw new Error(`Discord token exchange failed (${tokenResponse.status}).`);
        const token = await tokenResponse.json() as { access_token: string };
        const headers = { Authorization: `Bearer ${token.access_token}` };
        const [userResponse, guildsResponse] = await Promise.all([
            fetch('https://discord.com/api/v10/users/@me', { headers }),
            fetch('https://discord.com/api/v10/users/@me/guilds', { headers }),
        ]);
        if (!userResponse.ok || !guildsResponse.ok) throw new Error('Discord profile request failed.');
        const user = await userResponse.json() as DashboardUser;
        const oauthGuilds = await guildsResponse.json() as OAuthGuild[];
        const sessionToken = randomBytes(36).toString('base64url');
        await putSession(sessionToken, { user, oauthGuilds, expiresAt: Date.now() + SESSION_TTL_MS });
        if (firestoreAvailable()) {
            try {
                await getDb().doc(`users/${user.id}`).set({
                    discordId: user.id,
                    username: user.username,
                    globalName: user.globalName || null,
                    avatarUrl: avatarUrl(user),
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                recordFirebaseSuccess();
            } catch (error) {
                recordFirebaseFailure(error, `save dashboard profile/${user.id}`);
            }
        }
        redirect(response, `${dashboardWebUrl()}#dashboard_session=${encodeURIComponent(sessionToken)}`, {
            'Set-Cookie': [
                cookie('rafiq_session', sessionToken, { maxAge: Math.floor(SESSION_TTL_MS / 1000) }),
            ],
        });
    } catch (error) {
        logger.error('[Dashboard OAuth] Callback failed:', error);
        redirect(response, `${dashboardWebUrl()}?auth_error=discord_login_failed`);
    }
}

function staticFile(response: ServerResponse, pathname: string): void {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(websiteRoot, `.${decodeURIComponent(requested)}`);
    if (!filePath.startsWith(websiteRoot + path.sep) && filePath !== path.join(websiteRoot, 'index.html')) {
        response.writeHead(403); response.end('Forbidden'); return;
    }
    let target = filePath;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(websiteRoot, 'index.html');
    fs.readFile(target, (error, data) => {
        if (error) { response.writeHead(404); response.end('Not found'); return; }
        const types: Record<string, string> = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml' };
        response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
        response.end(data);
    });
}

async function apiRequest(client: Client, request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    const method = request.method || 'GET';
    if (url.pathname === '/api/health') {
        json(response, 200, { ok: true, discord: client.isReady(), oauthConfigured: Boolean(env('DISCORD_CLIENT_SECRET')), firebase: firestoreAvailable() });
        return true;
    }
    if (url.pathname === '/api/auth/discord/start' && method === 'GET') { await handleOAuthStart(response); return true; }
    if (url.pathname === '/auth/callback' && method === 'GET') { await handleOAuthCallback(request, response, url); return true; }
    if (url.pathname === '/api/logout' && method === 'POST') {
        const token = cookieMap(request).rafiq_session || '';
        await deleteSession(token);
        json(response, 200, { ok: true }, { 'Set-Cookie': cookie('rafiq_session', '', { clear: true }) });
        return true;
    }
    if (!url.pathname.startsWith('/api/')) return false;
    const session = await requireSession(request, response);
    if (!session) return true;

    if (url.pathname === '/api/me' && method === 'GET') {
        json(response, 200, { id: session.user.id, username: session.user.username, globalName: session.user.globalName, avatarUrl: avatarUrl(session.user) });
        return true;
    }
    if (url.pathname === '/api/context' && method === 'GET') {
        // This powers the account card and server picker shown on every dashboard
        // page. It must use the authenticated Discord session, never placeholders.
        json(response, 200, {
            user: {
                id: session.user.id,
                username: session.user.username,
                globalName: session.user.globalName,
                avatarUrl: avatarUrl(session.user),
            },
            // Server-management dashboards are intentionally limited to servers
            // where the signed-in member can manage the bot. Shared servers remain
            // available in the personal daily-wird view through /api/me/overview.
            guilds: await manageableGuilds(client, session),
            health: { discord: client.isReady() },
        });
        return true;
    }
    if (url.pathname === '/api/me/overview' && method === 'GET') {
        const [config, guilds] = await Promise.all([getUserDMConfig(session.user.id), visibleGuilds(client, session)]);
        const guildsWithPreview = await Promise.all(guilds.map(async guild => {
            const wird = await getPersonalGuildKhatma(guild.id, session.user.id);
            const progress = personalWirdProgress(wird);
            return {
                ...guild,
                wirdPreview: {
                    enabled: Boolean(wird?.enabled),
                    text: wird ? `${progress?.percentage || 0}% • صفحة ${wird.currentPage}` : 'لم يعد ما بديتيش الورد',
                    percentage: progress?.percentage || 0,
                },
            };
        }));
        json(response, 200, { user: { username: session.user.username, globalName: session.user.globalName, avatarUrl: avatarUrl(session.user) }, config, guilds: guildsWithPreview, health: { discord: client.isReady() } });
        return true;
    }
    if (url.pathname === '/api/guilds' && method === 'GET') {
        json(response, 200, { guilds: await manageableGuilds(client, session) });
        return true;
    }
    if (url.pathname === '/api/me/location' && ['GET', 'PUT', 'DELETE'].includes(method)) {
        const current = await getUserDMConfig(session.user.id);
        if (method === 'GET') {
            json(response, 200, {
                config: { city: current.city || null, timezone: current.timezone || null },
                locations: cities.map(city => ({
                    name: city.name,
                    nameEn: city.nameEn,
                    country: city.country,
                    countryAr: city.countryAr,
                    timezone: city.timezone,
                })),
            });
            return true;
        }
        if (method === 'DELETE') {
            await updateUserDMConfig(session.user.id, { city: undefined, timezone: undefined, adhan_zone: undefined });
            json(response, 200, { ok: true, config: { city: null, timezone: null } });
            return true;
        }
        const body = await bodyJson(request);
        const cityName = String(body.city || '').trim();
        const location = cities.find(item => item.nameEn === cityName);
        if (!location) { json(response, 400, { error: 'invalid_location' }); return true; }
        await updateUserDMConfig(session.user.id, { city: location.nameEn, timezone: location.timezone, adhan_zone: location.nameEn });
        json(response, 200, { ok: true, config: { city: location.nameEn, timezone: location.timezone } });
        return true;
    }
    if (url.pathname === '/api/me/adhkar-categories' && method === 'GET') {
        json(response, 200, { categories: getAllAdhkarCategoryNames() });
        return true;
    }
    if (url.pathname === '/api/me/dm-config' && method === 'GET') {
        const config = await getUserDMConfig(session.user.id);
        const guildId = url.searchParams.get('guildId') || undefined;
        const preview = summarizeWird(config, guildId);
        json(response, 200, { config, guildId, wirdPreview: preview });
        return true;
    }
    if (url.pathname === '/api/me/dm-messages' && (method === 'GET' || method === 'DELETE')) {
        const dm = await client.users.fetch(session.user.id).then(user => user.createDM()).catch(() => null);
        if (!dm) { json(response, 400, { error: 'dm_unavailable' }); return true; }
        const messages = await dm.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) { json(response, 400, { error: 'messages_unavailable' }); return true; }
        const botMessages = [...messages.values()].filter(message => message.author.id === client.user?.id);
        if (method === 'GET') {
            json(response, 200, { messages: botMessages.slice(0, 25).map(message => ({ id: message.id, content: (message.embeds[0]?.title || message.content || 'رسالة من رفيق الروح').slice(0, 100), createdAt: message.createdAt.toISOString() })) });
            return true;
        }
        const body = await bodyJson(request);
        const ids = Array.isArray(body.ids) ? new Set(body.ids.map((id: unknown) => String(id))) : null;
        const requested = ids ? botMessages.filter(message => ids.has(message.id)) : botMessages.slice(0, Math.min(Math.max(Number(body.count) || 5, 1), body.all ? 100 : 50));
        const outcomes = await Promise.all(requested.map(message => message.delete().then(() => true).catch(() => false)));
        json(response, 200, { ok: true, deleted: outcomes.filter(Boolean).length });
        return true;
    }
    if (url.pathname === '/api/me/dm-config' && method === 'PUT') {
        const body = await bodyJson(request);
        const current = await getUserDMConfig(session.user.id);
        if (body && body.patch && typeof body.patch === 'object') {
            await updateUserDMConfig(session.user.id, dmConfigFromPatch(current, body.patch));
        } else {
            await updateUserDMConfig(session.user.id, dmConfigFromDashboard(current, body));
        }
        json(response, 200, { ok: true, config: await getUserDMConfig(session.user.id) });
        return true;
    }
    if (url.pathname === '/api/test-dm' && method === 'POST') {
        const user = await client.users.fetch(session.user.id);
        const config = await getUserDMConfig(session.user.id);
        const embed = new EmbedBuilder()
            .setColor('#52C99A')
            .setTitle('لوحة رفيق الروح')
            .setDescription('إعدادات الرسائل الخاصة تعمل بنجاح.')
            .addFields({ name: 'المدينة', value: config.city || 'غير مضبوطة', inline: true }, { name: 'المنطقة الزمنية', value: config.timezone || 'غير مضبوطة', inline: true })
            .setTimestamp();
        await user.send({ embeds: [embed] });
        json(response, 200, { ok: true });
        return true;
    }
    if (url.pathname === '/api/me/wird' && method === 'GET') {
        const [dmConfig, guilds] = await Promise.all([
            getUserDMConfig(session.user.id),
            visibleGuilds(client, session),
        ]);
        const personalGuilds = await Promise.all(guilds.map(async guild => {
            const config = await getPersonalGuildKhatma(guild.id, session.user.id);
            return { ...guild, config, progress: personalWirdProgress(config) };
        }));
        json(response, 200, {
            user: { id: session.user.id, username: session.user.username, globalName: session.user.globalName, avatarUrl: avatarUrl(session.user) },
            dm: { config: dmConfig.khatma || null, progress: dmWirdProgress(dmConfig.khatma) },
            guilds: personalGuilds,
        });
        return true;
    }
    if (url.pathname === '/api/me/wird/dm' && ['PUT', 'DELETE'].includes(method)) {
        if (method === 'DELETE') {
            await updateUserDMConfig(session.user.id, { khatma: undefined });
            const guilds = await visibleGuilds(client, session);
            const personalGuilds = await Promise.all(guilds.map(async guild => {
                const config = await getPersonalGuildKhatma(guild.id, session.user.id);
                return { ...guild, config, progress: personalWirdProgress(config) };
            }));
            json(response, 200, { user: { id: session.user.id, username: session.user.username, globalName: session.user.globalName, avatarUrl: avatarUrl(session.user) }, dm: { config: null, progress: null }, guilds: personalGuilds });
            return true;
        }
        const body = await bodyJson(request);
        const current = await getUserDMConfig(session.user.id);
        const next = cleanPersonalWird(body, 'dm', session.user.id, current.khatma ? {
            guildId: 'dm', userId: session.user.id, ...current.khatma,
            startedAt: current.khatma.updatedAt || new Date().toISOString(),
            updatedAt: current.khatma.updatedAt || new Date().toISOString(),
            readingDates: [], completedKhatmas: 0,
        } : null);
        await updateUserDMConfig(session.user.id, { khatma: {
            enabled: next.enabled, mode: next.mode, pagesPerDay: next.pagesPerDay,
            ramadanKhatmas: next.ramadanKhatmas, currentPage: next.currentPage, updatedAt: new Date().toISOString(),
        } });
        const updated = await getUserDMConfig(session.user.id);
        const guilds = await visibleGuilds(client, session);
        const personalGuilds = await Promise.all(guilds.map(async guild => {
            const config = await getPersonalGuildKhatma(guild.id, session.user.id);
            return { ...guild, config, progress: personalWirdProgress(config) };
        }));
        json(response, 200, { user: { id: session.user.id, username: session.user.username, globalName: session.user.globalName, avatarUrl: avatarUrl(session.user) }, dm: { config: updated.khatma || null, progress: dmWirdProgress(updated.khatma) }, guilds: personalGuilds });
        return true;
    }
    const personalWirdMatch = url.pathname.match(/^\/api\/me\/wird\/guilds\/(\d+)$/);
    if (personalWirdMatch && (method === 'PUT' || method === 'DELETE')) {
        const guild = await sharedGuild(client, session, personalWirdMatch[1]);
        if (!guild) { json(response, 403, { error: 'guild_access_denied' }); return true; }
        if (method === 'DELETE') {
            await deletePersonalGuildKhatma(guild.id, session.user.id);
            json(response, 200, { ok: true });
            return true;
        }
        const body = await bodyJson(request);
        const existing = await getPersonalGuildKhatma(guild.id, session.user.id);
        await savePersonalGuildKhatma(cleanPersonalWird(body, guild.id, session.user.id, existing));
        const dmConfig = await getUserDMConfig(session.user.id);
        const guilds = await visibleGuilds(client, session);
        const personalGuilds = await Promise.all(guilds.map(async item => {
            const config = await getPersonalGuildKhatma(item.id, session.user.id);
            return { ...item, config, progress: personalWirdProgress(config) };
        }));
        json(response, 200, { user: { id: session.user.id, username: session.user.username, globalName: session.user.globalName, avatarUrl: avatarUrl(session.user) }, dm: { config: dmConfig.khatma || null, progress: dmWirdProgress(dmConfig.khatma) }, guilds: personalGuilds });
        return true;
    }
    const adhanZonesMatch = url.pathname.match(/^\/api\/guilds\/(\d+)\/adhan-zones$/);
    if (adhanZonesMatch && ['GET', 'PUT', 'DELETE'].includes(method)) {
        const guild = await authorizedGuild(client, session, adhanZonesMatch[1]);
        if (!guild) { json(response, 403, { error: 'guild_access_denied' }); return true; }
        if (method === 'GET') {
            const channels = await listChannels(guild);
            json(response, 200, {
                ok: true,
                locations: cities.map(city => ({
                    name: city.name,
                    nameEn: city.nameEn,
                    country: city.country,
                    countryAr: city.countryAr,
                    timezone: city.timezone,
                })),
                channels,
                zones: await getManagedAdhanZones(guild.id),
            });
            return true;
        }
        const body = await bodyJson(request);
        const country = String(body.country || '').trim();
        const city = String(body.city || '').trim();
        if (!country || !city) { json(response, 400, { error: 'invalid_zone' }); return true; }
        if (method === 'PUT') {
            const location = cities.find(item => item.country === country && item.nameEn === city);
            const channelId = String(body.channelId || '').trim();
            const channel = (await listChannels(guild)).find(item => item.id === channelId && item.kind === 'text' && item.canSend);
            if (!location) { json(response, 400, { error: 'invalid_location' }); return true; }
            if (!channel) { json(response, 400, { error: 'invalid_channel' }); return true; }
            await saveManagedAdhanZone(guild.id, {
                country: location.country,
                city: location.nameEn,
                timezone: location.timezone,
                channelId,
                enabled: body.enabled !== false,
            }, session.user.id);
            await scheduleAdhanForGuild(guild.id, client);
            json(response, 200, { ok: true, zones: await getManagedAdhanZones(guild.id) });
            return true;
        }
        await deleteManagedAdhanZone(guild.id, country, city);
        await scheduleAdhanForGuild(guild.id, client);
        json(response, 200, { ok: true, zones: await getManagedAdhanZones(guild.id) });
        return true;
    }

    const match = url.pathname.match(/^\/api\/guilds\/(\d+)(?:\/(config|channels|roles|test-message|publish-dm))?$/);
    if (!match) { json(response, 404, { error: 'not_found' }); return true; }
    const [, guildId, resource = 'config'] = match;
    const guild = await authorizedGuild(client, session, guildId);
    if (!guild) { json(response, 403, { error: 'guild_access_denied' }); return true; }

    if (resource === 'channels' && method === 'GET') { json(response, 200, { channels: await listChannels(guild) }); return true; }
    if (resource === 'roles' && method === 'GET') { json(response, 200, { roles: await listRoles(guild) }); return true; }
    if (resource === 'config' && method === 'GET') {
        const [storedConfig, adhkarConfig, jumuahConfig, khatma, salawatConfig, adhanZones, quranConfig, personalKhatmaPanel] = await Promise.all([
            getModuleConfig<ServerConfig>(guild.id, 'serverConfig'),
            getAdhkarV2Config(guild.id),
            getJumuahV2Config(guild.id),
            getGuildKhatma(guild.id),
            getSalawatV2Config(guild.id),
            getManagedAdhanZones(guild.id),
            getQuranRadioConfig(guild.id),
            getPersonalKhatmaPanel(guild.id),
        ]);
        const config: ServerConfig = { ...(storedConfig || {}) };
        if (!config.dmPanelChannelId) {
            const discoveredPanelChannel = await discoverDmPanelChannel(guild, client);
            if (discoveredPanelChannel) {
                config.dmPanelChannelId = discoveredPanelChannel;
                await setModuleConfig(guild.id, 'serverConfig', config);
            }
        }
        // The real Adhkar channel is stored by the Adhkar module, not only in
        // the dashboard snapshot. Expose it here so its name and ID stay visible.
        if (adhkarConfig?.generalChannelId) config.adhkarChannelId = adhkarConfig.generalChannelId;
        if (jumuahConfig?.channelId) config.jumuahChannelId = jumuahConfig.channelId;
        if (quranConfig?.voiceChannelId) config.quranChannelId = quranConfig.voiceChannelId;
        if (salawatConfig?.channelId) {
            (config as any).salawatChannelId = salawatConfig.channelId;
            (config as any).salawatScheduleMode = salawatConfig.scheduleMode;
            (config as any).salawatIntervalHours = salawatConfig.intervalHours;
            (config as any).salawatFixedTimes = salawatConfig.fixedTimes;
            (config as any).salawatEnabled = salawatConfig.enabled;
            (config as any).salawatTimezone = salawatConfig.timezone;
        }
        if (khatma?.channelId) (config as any).khatmaChannelId = khatma.channelId;
        if (personalKhatmaPanel?.channelId) (config as any).personalKhatmaChannelId = personalKhatmaPanel.channelId;
        const roles = await getModuleConfig<any>(guild.id, 'roles') || {};
        const adhkarEnabled = Object.values(adhkarConfig?.categories || {}).filter(status => status === 'enabled').length;
        const configuredChannels = Object.values(config).filter(value => typeof value === 'string' && value.length > 0).length;
        json(response, 200, {
            config,
            roles,
            adhkar: {
                enabled: adhkarConfig?.enabled ?? false,
                categories: getAllAdhkarCategoryNames().map(category => ({
                    key: category.key,
                    name: category.name,
                    emoji: category.emoji,
                    group: category.group,
                    enabled: adhkarConfig?.categories[category.key] === 'enabled',
                })),
            },
            metrics: {
                modules: {
                    adhan: { active: adhanZones.filter(zone => zone.enabled).length, total: adhanZones.length, detail: 'مناطق الأذان المحفوظة' },
                    adhkar: { active: adhkarEnabled, total: getAllAdhkarCategoryNames().length, detail: 'أنواع الأذكار المفعلة' },
                    salawat: { active: salawatConfig?.enabled ? 1 : 0, total: salawatConfig?.scheduleMode === 'fixed' ? salawatConfig.fixedTimes.length : salawatConfig?.intervalHours || 0, detail: salawatConfig?.scheduleMode === 'fixed' ? 'مواعيد ثابتة' : 'ساعة بين كل تذكير' },
                    jumuah: { active: jumuahConfig?.enabled ? 1 : 0, total: jumuahConfig?.playKahfVoice ? 2 : 1, detail: jumuahConfig ? `موعد الإرسال ${jumuahConfig.time}` : 'إعداد الجمعة غير موجود' },
                    quran: { active: config.quranChannelId ? 1 : 0, total: config.quranChannelId ? 1 : 0, detail: config.quranChannelId ? 'قناة القرآن محفوظة' : 'لم يتم اختيار قناة' },
                    dm: { active: config.dmPanelChannelId ? 1 : 0, total: config.dmPanelChannelId ? 1 : 0, detail: config.dmPanelChannelId ? 'لوحة الرسائل الخاصة منشورة' : 'لوحة الرسائل غير منشورة' },
                    logs: { active: config.logsChannelId ? 1 : 0, total: config.logsChannelId ? 1 : 0, detail: config.logsChannelId ? 'قناة السجلات محفوظة' : 'لم يتم اختيار قناة' },
                    settings: { active: Object.values(roles).filter(value => typeof value === 'string' && value.length > 0).length, total: 5, detail: 'رتب البوت المضبوطة' },
                    test: { active: configuredChannels, total: 8, detail: 'قنوات وإعدادات محفوظة' },
                },
                khatma: khatma ? {
                    active: khatma.isActive,
                    currentPage: khatma.currentPage,
                    pagesPerDay: khatma.pagesPerDay,
                    lastRunAt: khatma.lastSentAt || null,
                    nextRunAt: khatma.isActive ? nextKhatmaRunAt() : null,
                } : null,
            },
        });
        return true;
    }
    if (resource === 'config' && method === 'PUT') {
        const body = await bodyJson(request) as any;
        let configToSave = body.config;
        let rolesToSave = body.roles;
        const adhkarToSave = body.adhkar;
        const salawatToSave = body.salawat;
        
        // Backward compatibility for flat objects
        if (!body.config && !body.roles) {
            configToSave = body;
        }
        
        if (configToSave) {
            const allowed = ['dashboardAdminRoleId','adhanChannelId','adhkarChannelId','quranChannelId','jumuahChannelId','logsChannelId','rolePanelChannelId','dmPanelChannelId'];
            const clean: ServerConfig = {};
            for (const key of allowed) if (typeof configToSave[key] === 'string') clean[key] = configToSave[key];
            await setModuleConfig(guild.id, 'serverConfig', clean);
            if (typeof configToSave.adhkarChannelId === 'string') {
                const adhkarConfig = await getAdhkarV2Config(guild.id);
                if (adhkarConfig) {
                    await saveAdhkarV2Config(guild.id, { ...adhkarConfig, generalChannelId: configToSave.adhkarChannelId });
                }
            }
            if (typeof configToSave.jumuahChannelId === 'string') {
                const jumuahConfig = await getJumuahV2Config(guild.id);
                await saveJumuahV2Config(guild.id, {
                    enabled: jumuahConfig?.enabled ?? true,
                    channelId: configToSave.jumuahChannelId,
                    time: jumuahConfig?.time || '08:00',
                    timezone: jumuahConfig?.timezone || 'Africa/Casablanca',
                    mentionEveryone: jumuahConfig?.mentionEveryone ?? true,
                    playKahfVoice: jumuahConfig?.playKahfVoice ?? true,
                    updatedBy: session.user.id,
                });
            }
        }
        if (salawatToSave && typeof salawatToSave === 'object') {
            const existing = await getSalawatV2Config(guild.id);
            const channelId = String(salawatToSave.channelId || existing?.channelId || '').trim();
            const channel = (await listChannels(guild)).find(item => item.id === channelId && item.kind === 'text' && item.canSend);
            if (!channel) { json(response, 400, { error: 'invalid_salawat_channel' }); return true; }
            const scheduleMode = salawatToSave.scheduleMode === 'fixed' ? 'fixed' : 'interval';
            const interval = Number(salawatToSave.intervalHours || existing?.intervalHours || 4);
            const intervalHours = ([1, 4, 8, 12, 24].includes(interval) ? interval : 4) as SalawatV2Config['intervalHours'];
            const rawFixedTimes: string[] = Array.isArray(salawatToSave.fixedTimes)
                ? salawatToSave.fixedTimes.map((value: unknown): string => String(value).trim())
                : (existing?.fixedTimes || []);
            const fixedTimes: string[] = [...new Set(rawFixedTimes.filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))].sort();
            if (scheduleMode === 'fixed' && !fixedTimes.length) { json(response, 400, { error: 'fixed_times_required' }); return true; }
            const zone = await getPrimaryAdhanZone(guild.id);
            await saveSalawatV2Config(guild.id, {
                enabled: salawatToSave.enabled !== false,
                channelId,
                scheduleMode,
                intervalHours,
                fixedTimes,
                timezone: String(salawatToSave.timezone || existing?.timezone || zone?.timezone || 'Africa/Casablanca'),
                anchorAt: existing?.anchorAt || new Date().toISOString(),
                nextRunAt: existing?.nextRunAt,
                updatedBy: session.user.id,
            });
        }
        if (adhkarToSave?.categories && typeof adhkarToSave.categories === 'object') {
            const adhkarConfig = await getAdhkarV2Config(guild.id);
            if (!adhkarConfig) { json(response, 400, { error: 'adhkar_not_configured' }); return true; }
            const validKeys = new Set(getAllAdhkarCategoryNames().map(category => category.key));
            const categories = { ...adhkarConfig.categories };
            for (const [key, enabled] of Object.entries(adhkarToSave.categories)) {
                if (validKeys.has(key)) categories[key] = enabled ? 'enabled' : 'paused';
            }
            await saveAdhkarV2Config(guild.id, { ...adhkarConfig, categories, updatedBy: session.user.id });
        }
        
        if (rolesToSave) {
            const allowedRoles = ['adhkarRoleId','salawatRoleId','jumuahRoleId','adhanRoleId','khatmaRoleId'];
            const cleanRoles: any = {};
            for (const key of allowedRoles) if (typeof rolesToSave[key] === 'string') cleanRoles[key] = rolesToSave[key];
            await setModuleConfig(guild.id, 'roles', cleanRoles);
        }
        
        json(response, 200, { ok: true });
        return true;
    }
    if (resource === 'test-message' && method === 'POST') {
        const body = await bodyJson(request);
        const channel = await guild.channels.fetch(String(body.channelId || '')).catch(() => null);
        if (!channel?.isTextBased() || channel.isDMBased() || !('send' in channel)) { json(response, 400, { error: 'invalid_channel' }); return true; }
        await channel.send({ embeds: [new EmbedBuilder().setColor('#52C99A').setTitle('رفيق الروح').setDescription('وصلت رسالة اختبار لوحة التحكم بنجاح.').setTimestamp()] });
        json(response, 200, { ok: true });
        return true;
    }
    if (resource === 'publish-dm' && method === 'POST') {
        const body = await bodyJson(request);
        const channelId = String(body.channelId || '').trim();
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
            json(response, 400, { error: 'invalid_channel', message: 'Channel is not accessible or not a text channel.' });
            return true;
        }
        const iconURL = client.user?.displayAvatarURL({ extension: 'png', size: 128 });
        await channel.send(buildDMIntroPayload(false, iconURL));
        
        // Save to config
        const config = await getModuleConfig<ServerConfig>(guild.id, 'serverConfig') || {};
        config.dmPanelChannelId = channelId;
        await setModuleConfig(guild.id, 'serverConfig', config);
        
        json(response, 200, { ok: true, config });
        return true;
    }
    json(response, 405, { error: 'method_not_allowed' });
    return true;
}

export function startDashboardApi(client: Client): void {
    if (dashboardStarted || process.env.DASHBOARD_ENABLED === 'false') return;
    dashboardStarted = true;
    const port = Number(env('DASHBOARD_PORT', env('PORT', '5174')));
    const host = env('DASHBOARD_HOST', '127.0.0.1');
    const server = createServer((request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
        for (const [header, value] of Object.entries(corsHeaders(request))) response.setHeader(header, value);
        if (request.method === 'OPTIONS') {
            if (!response.getHeader('Access-Control-Allow-Origin')) { response.writeHead(204); response.end(); return; }
            response.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            });
            response.end();
            return;
        }
        void apiRequest(client, request, response, url)
            .then(handled => { if (!handled) staticFile(response, url.pathname); })
            .catch(error => {
                logger.error(`[Dashboard API] ${request.method} ${url.pathname} failed:`, error);
                if (!response.headersSent) json(response, 500, { error: 'internal_error' });
                else response.end();
            });
    });
    server.on('error', error => {
        dashboardStarted = false;
        logger.error(`[Dashboard API] Server failed on ${host}:${port}:`, error);
    });
    server.listen(port, host, () => logger.success(`Dashboard API ready at http://${host}:${port}`));
}
