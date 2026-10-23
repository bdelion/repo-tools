import { Graph } from '../model/Graph';

export class TgfParser {
    parse(content: string): Graph {
        const nodes = new Map<string, string>();

        const dependencies =
            new Map<string, Set<string>>();

        const reverseDependencies =
            new Map<string, Set<string>>();

        let inEdges = false;

        const lines = content
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

        for (const line of lines) {
            if (line === '#') {
                inEdges = true;
                continue;
            }

            if (!inEdges) {
                const parts = line.split(/\s+/);

                const id = parts.shift()!;
                const label = parts.join(' ');

                nodes.set(id, label);

                dependencies.set(
                    label,
                    new Set<string>(),
                );

                reverseDependencies.set(
                    label,
                    new Set<string>(),
                );
            } else {
                const parts = line.split(/\s+/);

                const source = nodes.get(parts[0]);
                const target = nodes.get(parts[1]);

                if (source && target) {
                    dependencies
                        .get(source)!
                        .add(target);

                    reverseDependencies
                        .get(target)!
                        .add(source);
                }
            }
        }

        return new Graph(
            dependencies,
            reverseDependencies,
        );
    }
}