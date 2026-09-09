import { spawnSync } from 'child_process';
import { accessSync, constants } from 'fs';
import { isAbsolute } from 'path';

let cachedBinary: string | undefined;

/** Resolve lazily, after dotenv has loaded; never depend on a developer's PC path. */
export function getFFmpegBinary(): string {
    if (cachedBinary) return cachedBinary;
    const override = process.env.FFMPEG_PATH?.trim();
    let bundled: string | undefined;
    try { bundled = require('ffmpeg-static') || undefined; } catch { /* Try PATH below. */ }
    const candidates = override ? [override] : [bundled, 'ffmpeg'].filter(Boolean) as string[];
    for (const candidate of candidates) {
        if (isAbsolute(candidate)) {
            try {
                accessSync(candidate, constants.F_OK | constants.X_OK);
                return cachedBinary = candidate;
            } catch { continue; }
        }
        const result = spawnSync(candidate, ['-version'], { windowsHide: true, timeout: 10_000 });
        if (!result.error && result.status === 0) return cachedBinary = candidate;
    }
    throw new Error(override
        ? 'FFmpeg is unavailable: check FFMPEG_PATH on this host.'
        : 'FFmpeg is unavailable: reinstall ffmpeg-static on this host or install ffmpeg on PATH.');
}
