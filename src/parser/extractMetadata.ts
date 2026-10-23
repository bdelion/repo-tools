/**
 * Traite un fichier source pour en extraire les composants et leurs dépendances.
 * Cette fonction combine l'extraction des imports, exports et métadonnées visibles.
 *
 * @module parser/extractMetadata
 */

import { extractImportNames } from './extractImports';
import { extractExportNames } from './extractExports';
import { addNode, nodes } from '../graph/nodeManager';
import { addDependency, dependencies } from '../graph/dependencyManager';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Analyse un fichier source et ajoute les nœuds et dépendances au graphe.
 * Les données sont ajoutées dans les objets `nodes` et `dependencies`.
 *
 * @param {string} filePath - Chemin absolu du fichier à analyser
 * @param {string} origin - Chemin racine à retirer pour obtenir un chemin relatif
 */
export function processFile(filePath: string, origin: string): void {
    try {
        // 🔧 Correction du chemin relatif, compatible Windows/Linux
        const fileName = path.relative(origin, filePath).replace(/\\/g, '/');

        const content = fs.readFileSync(filePath, 'utf-8');

        // 📦 Extraction des imports et exports
        const importNames = extractImportNames(content);
        const exportNames = extractExportNames(content);

        // 🔗 Ajout des nœuds et dépendances dans les objets globaux
        exportNames.forEach(({ extractName, visibleName, icone }) => {
            addNode(nodes, extractName, visibleName, icone, fileName);
            importNames.forEach(importName => {
                addDependency(dependencies, extractName, importName);
            });
        });
    } catch (error) {
        console.error(`❌ Erreur lors du traitement du fichier ${filePath}:`, error);
    }
}
