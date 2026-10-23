/**
 * Explore récursivement un répertoire et traite les fichiers valides.
 * @param {string} directory - Répertoire à scanner
 * @param {string} origin - Chemin racine pour les chemins relatifs
 */

import * as fs from 'fs';
import * as path from 'path';
import { shouldProcessFile } from './fileFilter';
import { processFile } from '../parser/extractMetadata';

export function scanDirectory(directory: string, origin: string): void {
    try {
        const files = fs.readdirSync(directory);
        files.forEach(file => {
            const fullPath = path.join(directory, file);
            if (fs.statSync(fullPath).isDirectory()) {
                scanDirectory(fullPath, origin);
            } else if (shouldProcessFile(fullPath)) {
                processFile(fullPath, origin);
            }
        });
    } catch (error) {
        console.error(`❌ Erreur lors du scan du dossier ${directory}:`, error);
    }
}
