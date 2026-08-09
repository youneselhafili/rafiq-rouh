import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomUUID } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { isFirestoreAvailable } from './guildConfigService';
import { logger } from '../utils/logger';

const LOCK_FILE = path.join(process.cwd(), 'data', '.rafiq-primary.lock');
const LEASE_DOC = 'globals/rafiqRuntimePrimary';
const LEASE_MS = 90_000;
const RENEW_MS = 30_000;
const ownerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
const deploymentId = createHash('sha256').update(`${os.hostname()}:${process.cwd()}`).digest('hex').slice(0, 24);

let primary = false;
let localLockOwned = false;
let renewTimer: NodeJS.Timeout | undefined;

function processIsAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function releaseLocalLock(): void {
    if (!localLockOwned) return;
    try {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (lock.ownerId === ownerId) fs.unlinkSync(LOCK_FILE);
    } catch {}
    localLockOwned = false;
}

function acquireLocalLock(): boolean {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const descriptor = fs.openSync(LOCK_FILE, 'wx');
            fs.writeFileSync(descriptor, JSON.stringify({ ownerId, pid: process.pid, startedAt: new Date().toISOString() }));
            fs.closeSync(descriptor);
            localLockOwned = true;
            process.once('exit', releaseLocalLock);
            return true;
        } catch (error: any) {
            if (error?.code !== 'EEXIST') throw error;
            try {
                const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
                if (processIsAlive(Number(lock.pid))) return false;
                fs.unlinkSync(LOCK_FILE);
            } catch {
                try { fs.unlinkSync(LOCK_FILE); } catch {}
            }
        }
    }
    return false;
}

async function claimFirestoreLease(): Promise<boolean> {
    if (!isFirestoreAvailable()) return true;
    const db = getFirestore();
    const ref = db.doc(LEASE_DOC);
    const now = Date.now();
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.data() as { ownerId?: string; deploymentId?: string; expiresAt?: number } | undefined;
        if (
            current?.ownerId !== ownerId &&
            current?.deploymentId !== deploymentId &&
            Number(current?.expiresAt || 0) > now
        ) return false;
        transaction.set(ref, { ownerId, deploymentId, pid: process.pid, host: os.hostname(), expiresAt: now + LEASE_MS });
        return true;
    });
}

function startLeaseRenewal(): void {
    if (!isFirestoreAvailable() || renewTimer) return;
    renewTimer = setInterval(async () => {
        try {
            const db = getFirestore();
            const ref = db.doc(LEASE_DOC);
            const renewed = await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                if (snapshot.data()?.ownerId !== ownerId) return false;
                transaction.set(ref, { expiresAt: Date.now() + LEASE_MS }, { merge: true });
                return true;
            });
            if (!renewed) {
                primary = false;
                logger.error('[Runtime] Primary lease was lost; this instance will ignore new Discord events.');
            }
        } catch (error) {
            logger.warn(`[Runtime] Could not renew primary lease: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, RENEW_MS);
    renewTimer.unref?.();
}

export async function acquirePrimaryRuntime(): Promise<boolean> {
    if (primary) return true;
    if (!acquireLocalLock()) {
        logger.warn('[Runtime] Another local bot process is already primary; this duplicate instance will remain idle.');
        return false;
    }
    try {
        if (!await claimFirestoreLease()) {
            releaseLocalLock();
            logger.warn('[Runtime] Another deployment holds the primary lease; this instance will remain idle.');
            return false;
        }
    } catch (error) {
        releaseLocalLock();
        logger.error(`[Runtime] Failed to acquire primary lease: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    primary = true;
    startLeaseRenewal();
    logger.success(`[Runtime] Primary instance acquired (${ownerId}).`);
    return true;
}

export function isPrimaryRuntime(): boolean {
    return primary;
}
