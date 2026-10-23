/**
 * Génère un fichier TGF à partir des nœuds et dépendances.
 * Le format TGF (Trivial Graph Format) est utilisé pour représenter les graphes :
 * - La première partie contient les nœuds (ID + label)
 * - La seconde partie (après '#') contient les arêtes (relations entre nœuds)
 *
 * @param {NodeMap} nodes - Nœuds du graphe
 * @param {DependencyMap} dependencies - Dépendances entre nœuds
 * @param {string} outputFile - Chemin du fichier TGF à générer
 */

import * as fs from 'fs';
import { NodeMap, DependencyMap } from '../types/types';

export function writeTgfFile(nodes: NodeMap, dependencies: DependencyMap, outputFile: string): void {
    let fileContent = '';

    // Écriture des nœuds
    Object.entries(nodes).forEach(([key, node]) => {
        fileContent += `\n${key} ${node.visibleName} ${node.icone} ${node.fileName}`;
    });

    // Séparateur entre nœuds et arêtes
    fileContent += '\n#';

    // Écriture des arêtes
    Object.entries(dependencies).forEach(([key, deps]) => {
        deps.forEach(dep => {
            fileContent += `\n${key} ${dep}`;
        });
    });

    fs.writeFileSync(outputFile, fileContent, 'utf-8');
}
