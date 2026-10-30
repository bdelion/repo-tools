import fs from 'node:fs';
import path from 'node:path';
import { shouldProcessFile, isJSXFile, isFilteredNode } from './fileFilter';
import { processFiles } from '../parser/extractMetadata';

export function scanDirectory(directory: string, origin: string): void {
    const pending = [directory];
    const files: string[] = [];
    while (pending.length) {
        const current = pending.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name) && !isFilteredNode(fullPath)) pending.push(fullPath);
            } else if (isJSXFile(fullPath) && !fullPath.endsWith('.d.ts') && shouldProcessFile(fullPath)) {
                files.push(fullPath);
            }
        }
    }
    processFiles(files.sort(), origin);
}
