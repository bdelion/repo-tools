/**
 * Construit le graphe de dépendances récursif à partir des nœuds et dépendances.
 * Seuls les fichiers JSX ou situés dans des dossiers de hooks/contextes sont inclus.
 */

import { nodes, nodesFiltered, addNode } from './nodeManager';
import { dependencies, dependenciesFiltered, addDependency } from './dependencyManager';
import { isFilteredNode, isJSXFile, isHooks } from '../scanner/fileFilter';

/**
 * Fonction principale pour construire le graphe filtré.
 * Elle parcourt les dépendances et ajoute les nœuds et arêtes valides.
 */
export function createRecursivedTGF(): void {
    /**
     * Ajoute récursivement les arêtes du graphe à partir d’un nœud donné.
     * @param {string} node - Nom du nœud à analyser
     * @param {string | null} parent - Nœud parent (si applicable)
     */
    function addEdges(node: string, parent: string | null): void {
        const current = nodes[node];
        if (
            current &&
            !isFilteredNode(current.fileName) &&
            (isJSXFile(current.fileName) || isHooks(current.fileName))
        ) {
            addNode(nodesFiltered, node, current.visibleName, current.icone, current.fileName);
            if (parent) {
                addDependency(dependenciesFiltered, parent, node);
            }
        }

        dependencies[node]?.forEach(dep => {
            const child = nodes[dep];
            if (child && !isFilteredNode(child.fileName)) {
                addEdges(dep, (isJSXFile(child.fileName) || isHooks(child.fileName)) ? node : parent);
            }
        });
    }

    Object.entries(dependencies).forEach(([key, deps]) => {
        const node = nodes[key];
        if (
            node &&
            !isFilteredNode(node.fileName) &&
            (isJSXFile(node.fileName) || isHooks(node.fileName))
        ) {
            addNode(nodesFiltered, key, node.visibleName, node.icone, node.fileName);
            deps.forEach(dep => addEdges(dep, key));
        }
    });
}
