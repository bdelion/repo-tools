/** Construit le graphe filtré sans récursion, en conservant les cycles. */
import { nodes, nodesFiltered, addNode } from './nodeManager';
import { dependencies, dependenciesFiltered, addDependency } from './dependencyManager';
import { isFilteredNode, isJSXFile, isHooks } from '../scanner/fileFilter';

export function createRecursivedTGF(): void {
    // Une reconstruction ne doit pas conserver les résultats du scan précédent.
    for (const key of Object.keys(nodesFiltered)) delete nodesFiltered[key];
    for (const key of Object.keys(dependenciesFiltered)) delete dependenciesFiltered[key];

    const included = new Set<string>();
    for (const [name, node] of Object.entries(nodes)) {
        if (!isFilteredNode(node.fileName) && (isJSXFile(node.fileName) || isHooks(node.fileName))) {
            included.add(name);
            addNode(nodesFiltered, name, node.visibleName, node.icone, node.fileName);
        }
    }

    for (const source of included) {
        const pending = [...(dependencies[source] ?? [])];
        // Chaque source conserve ses arêtes vers les dépendances partagées.
        const visited = new Set<string>();
        while (pending.length > 0) {
            const target = pending.pop()!;
            if (visited.has(target)) continue;
            visited.add(target);

            const node = nodes[target];
            if (!node || isFilteredNode(node.fileName)) continue;

            if (included.has(target)) {
                addDependency(dependenciesFiltered, source, target);
            } else {
                // Traverser les intermédiaires sans créer de nœuds absents.
                for (const child of dependencies[target] ?? []) pending.push(child);
            }
        }
    }
}
