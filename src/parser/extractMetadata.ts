import { createRequire } from 'node:module';
import { nodes, nodesFiltered, addNode } from '../graph/nodeManager';
import { dependencies, dependenciesFiltered, addDependency } from '../graph/dependencyManager';
import { isFilteredNode } from '../scanner/fileFilter';

type SourceNode = { id: string; visibleName: string; icone: string; fileName: string };
const sourceProject: {
    buildSourceGraph(root: string, files: string[], excluded: (file: string) => boolean): {
        nodes: SourceNode[]; edges: [string, string[]][];
    };
} = createRequire(__filename)('../sourceProject.cjs');

export function processFiles(files: string[], origin: string): void {
    const graph = sourceProject.buildSourceGraph(origin, files, isFilteredNode);
    for (const map of [nodes, nodesFiltered, dependencies, dependenciesFiltered]) {
        for (const key of Object.keys(map)) delete map[key];
    }
    for (const node of graph.nodes) addNode(nodes, node.id, node.visibleName, node.icone, node.fileName);
    for (const [source, targets] of graph.edges) {
        for (const target of targets) addDependency(dependencies, source, target);
    }
}

export function processFile(filePath: string, origin: string): void {
    processFiles([filePath], origin);
}
