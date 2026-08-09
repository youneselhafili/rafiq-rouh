import { initializeApp, cert } from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

let db: ReturnType<typeof getFirestore> | null = null;

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
    logger.success('✅ Firebase initialized successfully.');
}

export function getDb(): ReturnType<typeof getFirestore> {
    if (!db) {
        throw new Error('Firestore not initialized. Call initializeFirebase() first.');
    }
    return db;
}
