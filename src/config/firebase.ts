import { initializeApp, cert } from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

let db: ReturnType<typeof getFirestore> | null = null;
let retryAfter = 0;
let consecutiveFailures = 0;

function resolveServiceAccountPath(configuredPath: string): string {
    if (path.isAbsolute(configuredPath)) return configuredPath;
    const relativePath = configuredPath.replace(/^\.\//, '');
    const candidates = [
        path.resolve(process.cwd(), relativePath),
        path.resolve(__dirname, '../../../', relativePath), // compiled dist/src/config
        path.resolve(__dirname, '../../', relativePath), // ts-node src/config
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

export function initializeFirebase(): void {
    if (db) return;

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
        try {
            const serviceAccount = JSON.parse(serviceAccountJson);
            initializeApp({
                credential: cert(serviceAccount),
            });
        } catch {
            throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON. Ensure it is valid JSON.');
        }
    } else if (serviceAccountPath) {
        const resolvedPath = resolveServiceAccountPath(serviceAccountPath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Firebase service account file not found: ${resolvedPath}`);
        }
        initializeApp({
            credential: cert(resolvedPath),
        });
    } else {
        throw new Error(
            'Firebase not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in .env'
        );
    }

    db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });
    retryAfter = 0;
    consecutiveFailures = 0;
    logger.success('✅ Firebase initialized successfully.');
}

export function isFirebaseInitialized(): boolean {
    return db !== null;
}

export function canAttemptFirebase(): boolean {
    return db !== null && Date.now() >= retryAfter;
}

export function recordFirebaseSuccess(): void {
    retryAfter = 0;
    consecutiveFailures = 0;
}

export function recordFirebaseFailure(error: unknown, context: string): void {
    consecutiveFailures += 1;
    const cooldownMs = Math.min(5 * 60_000, 15_000 * (2 ** Math.min(consecutiveFailures - 1, 4)));
    retryAfter = Date.now() + cooldownMs;
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`[Storage] Firebase unavailable during ${context}; using local storage for at least ${Math.round(cooldownMs / 1000)}s. ${reason}`);
}

export function getDb(): ReturnType<typeof getFirestore> {
    if (!db) {
        throw new Error('Firestore not initialized. Call initializeFirebase() first.');
    }
    return db;
}
