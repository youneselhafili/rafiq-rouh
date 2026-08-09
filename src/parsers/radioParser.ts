import * as fs from 'fs';
import { RadioStation } from '../types';
import { logger } from '../utils/logger';

let idCounter = 1;

export function parseRadioFiles(filePaths: string[]): RadioStation[] {
    const radios: RadioStation[] = [];
    idCounter = 1;

    for (const filePath of filePaths) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length >= 2) {
                radios.push({
                    id: idCounter++,
                    name: lines[0],
                    url: lines[1],
                    recent_date: '',
                });
            }
        } catch (err) {
            logger.error(`Failed to parse radio file ${filePath}:`, err);
        }
    }

    return radios;
}

export function resetRadioIdCounter(): void {
    idCounter = 1;
}
