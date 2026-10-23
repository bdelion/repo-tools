export class Graph {
    constructor(
        private readonly dependencies: Map<string, Set<string>>,
        private readonly reverseDependencies: Map<string, Set<string>>,
    ) { }

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