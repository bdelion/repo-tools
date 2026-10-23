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
    const collator = new Intl.Collator('en', { numeric: true });
    const compareIdentifiers = (a: string, b: string): number =>
        collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

    // Écriture des nœuds par identifiant, dans l'ordre alphanumérique naturel.
    Object.keys(nodes).sort(compareIdentifiers).forEach(key => {
        const node = nodes[key];
        fileContent += `\n${key} ${node.visibleName} ${node.icone} ${node.fileName}`;
    });

    // Séparateur entre nœuds et arêtes
    fileContent += '\n#';

    // Écriture des arêtes triées par source, puis par cible.
    Object.keys(dependencies).sort(compareIdentifiers).forEach(key => {
        [...dependencies[key]].sort(compareIdentifiers).forEach(dep => {
            fileContent += `\n${key} ${dep}`;
        });
    });

    fs.writeFileSync(outputFile, fileContent, 'utf-8');
}
