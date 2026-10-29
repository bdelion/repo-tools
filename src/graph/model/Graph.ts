export class Graph {
    constructor(
        private readonly dependencies: Map<string, Set<string>>,
        private readonly reverseDependencies: Map<string, Set<string>>,
        private readonly labels: Map<string, string> = new Map(),
    ) { }

    getLabel(node: string): string {
        return this.labels.get(node) ?? node;
    }

    subgraph(nodes: string[]): Graph {
        const selected = new Set(nodes);
        const dependencies = new Map<string, Set<string>>();
        const reverse = new Map(nodes.map(node => [node, new Set<string>()]));
        for (const node of nodes) {
            const children = new Set(this.getDependencies(node).filter(child => selected.has(child)));
            dependencies.set(node, children);
            for (const child of children) reverse.get(child)!.add(node);
        }
        return new Graph(dependencies, reverse, this.labels);
    }

    getNodes(): string[] {
        return [...this.dependencies.keys()];
    }

    getDependencies(node: string): string[] {
        return [
            ...(this.dependencies.get(node) ?? new Set<string>()),
        ];
    }

    getDependents(node: string): string[] {
        return [
            ...(this.reverseDependencies.get(node) ??
                new Set<string>()),
        ];
    }

    hasNode(node: string): boolean {
        return this.dependencies.has(node);
    }

    getNodeCount(): number {
        return this.dependencies.size;
    }

    getEdgeCount(): number {
        let count = 0;

        for (const deps of this.dependencies.values()) {
            count += deps.size;
        }

        return count;
    }
}
