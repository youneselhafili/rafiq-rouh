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
    logsChannelId?: string;
    rolePanelChannelId?: string;
    dmPanelChannelId?: string;
}

const memorySessions = new Map<string, DashboardSession>();
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

function cookie(name: string, value: string, options: { maxAge?: number; clear?: boolean } = {}): string {
    const maxAge = options.clear ? '; Max-Age=0' : options.maxAge ? `; Max-Age=${options.maxAge}` : '';
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=None; Secure${maxAge}`;
}

function getCorsHeaders(request?: IncomingMessage): Record<string, string> {
    const origin = request?.headers?.origin || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, X-Requested-With',
        'Access-Control-Max-Age': '86400',
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

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}, request?: IncomingMessage): void {
    const cors = request ? getCorsHeaders(request) : getCorsHeaders();
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors,
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
    const session = await readSession(cookieMap(request).rafiq_session || '');
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

async function handleOAuthStart(response: ServerResponse): Promise<void> {
    const clientId = env('CLIENT_ID', env('DISCORD_CLIENT_ID'));
    const secret = env('DISCORD_CLIENT_SECRET');
    const redirectUri = env('DASHBOARD_REDIRECT_URI', 'http://127.0.0.1:5174/auth/callback');
    if (!clientId || !secret) {
        json(response, 503, { error: 'oauth_not_configured', message: 'Set CLIENT_ID and DISCORD_CLIENT_SECRET in .env.' });
        return;
    }
    const state = randomBytes(24).toString('hex');
    const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'identify guilds', state, prompt: 'consent' });
    redirect(response, `https://discord.com/oauth2/authorize?${params.toString()}`, {
        'Set-Cookie': cookie('rafiq_oauth_state', state, { maxAge: 600 }),
    });
}

async function handleOAuthCallback(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expectedState = cookieMap(request).rafiq_oauth_state;
    if (!code || !state || !expectedState || state !== expectedState) {
        redirect(response, '/?auth_error=invalid_state', { 'Set-Cookie': cookie('rafiq_oauth_state', '', { clear: true }) });
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
        redirect(response, '/', {
            'Set-Cookie': [
                cookie('rafiq_session', sessionToken, { maxAge: Math.floor(SESSION_TTL_MS / 1000) }),
                cookie('rafiq_oauth_state', '', { clear: true }),
            ],
        });
    } catch (error) {
        logger.error('[Dashboard OAuth] Callback failed:', error);
        redirect(response, '/?auth_error=discord_login_failed', { 'Set-Cookie': cookie('rafiq_oauth_state', '', { clear: true }) });
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
    if (method === 'OPTIONS') {
        response.writeHead(204, getCorsHeaders(request));
        response.end();
        return true;
    }
    if (url.pathname === '/api/health') {
        json(response, 200, { ok: true, discord: client.isReady(), oauthConfigured: Boolean(env('DISCORD_CLIENT_SECRET')), firebase: firestoreAvailable() }, {}, request);
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
    if (url.pathname === '/api/guilds' && method === 'GET') {
        json(response, 200, { guilds: await manageableGuilds(client, session) });
        return true;
    }
    if (url.pathname === '/api/me/dm-config' && method === 'GET') {
        json(response, 200, { config: await getUserDMConfig(session.user.id) });
        return true;
    }
    if (url.pathname === '/api/me/dm-config' && method === 'PUT') {
        const body = await bodyJson(request);
        const current = await getUserDMConfig(session.user.id);
        await updateUserDMConfig(session.user.id, dmConfigFromDashboard(current, body));
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

    const match = url.pathname.match(/^\/api\/guilds\/(\d+)(?:\/(config|channels|roles|test-message|publish-dm))?$/);
    if (!match) { json(response, 404, { error: 'not_found' }); return true; }
    const [, guildId, resource = 'config'] = match;
    const guild = await authorizedGuild(client, session, guildId);
    if (!guild) { json(response, 403, { error: 'guild_access_denied' }); return true; }

    if (resource === 'channels' && method === 'GET') { json(response, 200, { channels: await listChannels(guild) }); return true; }
    if (resource === 'roles' && method === 'GET') { json(response, 200, { roles: await listRoles(guild) }); return true; }
    if (resource === 'config' && method === 'GET') {
        const config = await getModuleConfig<ServerConfig>(guild.id, 'serverConfig') || {};
        const roles = await getModuleConfig<any>(guild.id, 'roles') || {};
        json(response, 200, { config, roles });
        return true;
    }
    if (resource === 'config' && method === 'PUT') {
        const body = await bodyJson(request) as any;
        let configToSave = body.config;
        let rolesToSave = body.roles;
        
        // Backward compatibility for flat objects
        if (!body.config && !body.roles) {
            configToSave = body;
        }
        
        if (configToSave) {
            const allowed = ['dashboardAdminRoleId','adhanChannelId','adhkarChannelId','quranChannelId','logsChannelId','rolePanelChannelId','dmPanelChannelId'];
            const clean: ServerConfig = {};
            for (const key of allowed) if (typeof configToSave[key] === 'string') clean[key] = configToSave[key];
            await setModuleConfig(guild.id, 'serverConfig', clean);
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
