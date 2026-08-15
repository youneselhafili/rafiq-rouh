import * as fs from 'fs';
import * as path from 'path';

export function writeJsonAtomic(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(temp, file);
    } catch (error) {
        try { fs.unlinkSync(temp); } catch {}
        throw error;
    }
}
