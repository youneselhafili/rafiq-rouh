import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export type QuranFileType = 'reciter' | 'radio' | 'unknown';

export interface ClassificationResult {
    type: QuranFileType;
    confidence: number;
    lineCount: number;
    reason: string;
}

const RECITER_LINE_REGEX = /^[\u0600-\u06FF\s]+=\s*https?:\/\//;
const URL_REGEX = /^https?:\/\//;

/**
 * Classify a single file by reading its content and analyzing line patterns.
 * Does NOT rely on directory structure — only on actual file content.
 */
export function classifyQuranFile(filePath: string): ClassificationResult {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const lineCount = lines.length;

        if (lineCount === 0) {
            return { type: 'unknown', confidence: 0, lineCount: 0, reason: 'Empty file' };
        }

        // ─── Radio pattern: exactly 2 lines, first is name, second is URL ──
        if (lineCount <= 3) {
            const urlLines = lines.filter(l => URL_REGEX.test(l));
            const nameLines = lines.filter(l => !URL_REGEX.test(l));
            if (urlLines.length >= 1 && nameLines.length >= 1 && lineCount <= 3) {
                return {
                    type: 'radio',
                    confidence: 0.9,
                    lineCount,
                    reason: `Radio pattern: ${nameLines.length} name line(s), ${urlLines.length} URL line(s)`,
                };
            }
        }

        // ─── Reciter pattern: "surah_name = URL" for most lines ────────────
        const reciterMatches = lines.filter(l => RECITER_LINE_REGEX.test(l));
        const reciterRatio = reciterMatches.length / lineCount;

        if (reciterRatio >= 0.8 && lineCount >= 10) {
            return {
                type: 'reciter',
                confidence: Math.min(0.5 + reciterRatio * 0.5, 1.0),
                lineCount,
                reason: `Reciter pattern: ${reciterMatches.length}/${lineCount} lines match "surah = URL"`,
            };
        }

        // ─── Fallback: check if most lines have any URL ────────────────────
        const anyUrlLines = lines.filter(l => URL_REGEX.test(l));
        const urlRatio = anyUrlLines.length / lineCount;

        if (urlRatio >= 0.8 && lineCount >= 10) {
            return {
                type: 'reciter',
                confidence: 0.6,
                lineCount,
                reason: `URL-dominant: ${anyUrlLines.length}/${lineCount} lines contain URLs`,
            };
        }

        return {
            type: 'unknown',
            confidence: 0,
            lineCount,
            reason: `No Quran pattern matched: ${reciterMatches.length} reciter lines, ${anyUrlLines.length} URL lines out of ${lineCount}`,
        };
    } catch (err) {
        logger.error(`Failed to classify file ${filePath}:`, err);
        return { type: 'unknown', confidence: 0, lineCount: 0, reason: `Error: ${err}` };
    }
}

/**
 * Scan a directory and classify every .txt file by content.
 * Returns a map of filename → classification.
 */
export function classifyDirectory(dirPath: string): Map<string, ClassificationResult> {
    const results = new Map<string, ClassificationResult>();

    if (!fs.existsSync(dirPath)) {
        logger.warn(`Directory not found: ${dirPath}`);
        return results;
    }

    const entries = fs.readdirSync(dirPath, { encoding: 'utf-8', recursive: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        try {
            if (!fs.statSync(fullPath).isFile() || !fullPath.endsWith('.txt')) continue;
            const relPath = entry.replace(/\\/g, '/');
            const result = classifyQuranFile(fullPath);
            results.set(relPath, result);
            logger.debug(`[QuranClassifier] ${relPath}: ${result.type} (${Math.round(result.confidence * 100)}%) — ${result.reason}`);
        } catch {
            // skip non-files
        }
    }

    return results;
}
