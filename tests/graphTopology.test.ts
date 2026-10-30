import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../src/graph/model/Graph';
import { TgfParser } from '../src/graph/parsers/TgfParser';
import { GraphQueries } from '../src/graph/queries/GraphQueries';
import { analyzeTopology } from '../src/graph/topology';
import { analyzeGraph } from '../src/graph/analyzeGraph';
import { OUTPUT_GRAPHE_DIR } from '../src/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('les groupes cycliques ont des niveaux stables et des dépendances hors source', () => {
    const graph = new TgfParser().parse('A Alpha a.ts\nB Beta b.ts\nC Leaf c.ts\nD Root d.ts\n#\nA B\nB A\nB C\nD A');
    const structure = analyzeTopology(graph);
    assert.deepEqual(structure.cyclicGroups, [['A', 'B']]);
    assert.equal(structure.levels.get('C'), 0);
    assert.equal(structure.levels.get('A'), 1);
    assert.equal(structure.levels.get('B'), 1);
    assert.equal(structure.levels.get('D'), 2);
    const query = new GraphQueries(graph);
    assert.deepEqual(new Set(query.getTransitiveDependencies('A')), new Set(['B', 'C']));
    const report = query.getRequiredComponentsByNameDetailed(['Root']);
    assert.equal(report.maxDepth, 2);
    assert.deepEqual(report.cyclicGroups, [['A', 'B']]);
    const restricted = graph.subgraph(['A', 'C']);
    assert.equal(restricted.getEdgeCount(), 0);
    assert.equal(analyzeTopology(restricted).cyclicGroups.length, 0);
});

test('les labels identiques ne fusionnent pas les identifiants et les TGF invalides échouent', () => {
    const graph = new TgfParser().parse('A Same\nB Same\n#\nA B');
    assert.equal(graph.getNodeCount(), 2);
    assert.deepEqual(graph.getDependencies('A'), ['B']);
    assert.throws(() => new TgfParser().parse('A Same\nA Other\n#'), /dupliqué/);
    assert.throws(() => new TgfParser().parse('A Same\n#\nA Missing'), /inconnu/);
});

test('20 000 nœuds : niveaux, fermeture transitive et arbre borné sans récursion', () => {
    const dependencies = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    for (let i = 0; i < 20000; i++) {
        dependencies.set(String(i), new Set(i < 19999 ? [String(i + 1)] : []));
        reverse.set(String(i), new Set(i > 0 ? [String(i - 1)] : []));
    }
    const graph = new Graph(dependencies, reverse);
    const query = new GraphQueries(graph);
    assert.equal(analyzeTopology(graph).levels.get('0'), 19999);
    assert.equal(query.getTransitiveDependencies('0').length, 19999);
    const report = query.getRequiredComponentsByNameDetailed(['0']);
    assert.equal(report.maxDepth, 19999);
    assert.equal(report.dependencyTreeTruncated, true);
    assert.ok(report.dependencyTreeText.includes('[truncated]'));
});

test('le rapport complet et les métadonnées utilisent les mêmes identités et le périmètre filtré', () => {
    const originalDirectory = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-graph-report-'));
    try {
        process.chdir(root);
        const input = path.join(root, 'graph.tgf');
        fs.writeFileSync(input, 'A Alpha a.ts\nB Ignored b.ts\nC Leaf c.ts\n#\nA B\nB A\nA C');
        analyzeGraph(input, { componentsOnly: true, customPatterns: [/Ignored/] });
        const directory = path.join(root, 'reports', OUTPUT_GRAPHE_DIR);
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'analysis-report.json'), 'utf8'));
        const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'components.json'), 'utf8'));
        assert.equal(report.totalNodes, 2);
        assert.equal(report.totalEdges, 1);
        assert.equal(report.cycleCount, 0);
        assert.equal(metadata.A.name, 'Alpha');
        assert.equal(metadata.A.level, 1);
        assert.deepEqual(metadata.A.dependencies, ['C']);
    } finally {
        process.chdir(originalDirectory);
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(root).startsWith('repo-tools-graph-report-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
