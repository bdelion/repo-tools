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

                if (!id || !label || nodes.has(id)) throw new Error(`Nœud TGF invalide ou dupliqué : ${line}`);

                nodes.set(id, label);

                dependencies.set(
                    id,
                    new Set<string>(),
                );

                reverseDependencies.set(
                    id,
                    new Set<string>(),
                );
            } else {
                const parts = line.split(/\s+/);

                const [source, target] = parts;
                if (!nodes.has(source) || !nodes.has(target)) throw new Error(`Arête TGF vers un nœud inconnu : ${line}`);

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

        if (!inEdges) throw new Error('Séparateur TGF # absent');
        return new Graph(
            dependencies,
            reverseDependencies,
            nodes,
        );
    }
}
