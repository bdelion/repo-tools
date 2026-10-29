import { Graph } from './model/Graph';

/** Composantes fortement connexes et niveaux du graphe condensé, sans récursion. */
export function analyzeTopology(graph: Graph) {
    const visited = new Set<string>();
    const order: string[] = [];
    for (const root of graph.getNodes()) {
        const pending: [string, boolean][] = [[root, false]];
        while (pending.length) {
            const [node, finished] = pending.pop()!;
            if (finished) { order.push(node); continue; }
            if (visited.has(node)) continue;
            visited.add(node);
            pending.push([node, true]);
            for (const child of graph.getDependencies(node)) {
                if (!visited.has(child)) pending.push([child, false]);
            }
        }
    }
    const assigned = new Set<string>();
    const groups: string[][] = [];
    for (const root of order.reverse()) {
        if (assigned.has(root)) continue;
        const group: string[] = [];
        const pending = [root];
        while (pending.length) {
            const node = pending.pop()!;
            if (assigned.has(node)) continue;
            assigned.add(node);
            group.push(node);
            for (const parent of graph.getDependents(node)) {
                if (!assigned.has(parent)) pending.push(parent);
            }
        }
        groups.push(group.sort());
    }
    groups.sort((a, b) => a[0].localeCompare(b[0]));
    const groupByNode = new Map<string, number>();
    groups.forEach((group, index) => group.forEach(node => groupByNode.set(node, index)));
    const dependencies = groups.map(() => new Set<number>());
    const dependents = groups.map(() => new Set<number>());
    for (const node of graph.getNodes()) {
        const source = groupByNode.get(node)!;
        for (const child of graph.getDependencies(node)) {
            const target = groupByNode.get(child)!;
            if (source !== target) {
                dependencies[source].add(target);
                dependents[target].add(source);
            }
        }
    }
    const remaining = dependencies.map(children => children.size);
    const groupLevels = groups.map(() => 0);
    const ready = remaining.flatMap((count, index) => count === 0 ? [index] : []);
    for (let index = 0; index < ready.length; index++) {
        const child = ready[index];
        for (const parent of dependents[child]) {
            groupLevels[parent] = Math.max(groupLevels[parent], groupLevels[child] + 1);
            if (--remaining[parent] === 0) ready.push(parent);
        }
    }
    const levels = new Map<string, number>();
    for (const [node, group] of groupByNode) levels.set(node, groupLevels[group]);
    const cyclicGroups = groups.filter(group => group.length > 1 || graph.getDependencies(group[0]).includes(group[0]));
    return { levels, groups, cyclicGroups, groupByNode };
}
