import path from 'node:path';
import fs from 'fs-extra';

import { TgfParser } from './parsers/TgfParser';
import { Graph } from './model/Graph';
import { GraphQueries } from './queries/GraphQueries';
import { analyzeTopology } from './topology';

import { DEFAULT_EXCLUDE_PATTERNS } from './constants';

import { OUTPUT_GRAPHE_DIR } from '../config';

export interface AnalyzeGraphOptions {
  componentsOnly?: boolean;
  customPatterns?: RegExp[];
}

export interface ComponentAnalysis {
  fullName: string;
  name: string;
  path: string;

  level: number;

  dependencyCount: number;
  dependencies: string[];

  usedByCount: number;
  usedBy: string[];

  orphan: boolean;
  leaf: boolean;
}

export interface AnalysisReport {
  totalNodes: number;
  totalEdges: number;
  maxLevel: number;
  orphanCount: number;
  cycleCount: number;
  cycleGroups: string[][];
  mostUsed: [string, number][];
}

function splitNodeLabel(label: string) {
  const parts = label.trim().split(/\s+/);

  return {
    fullName: label,
    name: parts[0] ?? '',
    path: parts.slice(1).join(' '),
  };
}

export function analyzeGraph(
  file: string,
  options: AnalyzeGraphOptions = {},
): void {
  const {
    componentsOnly = false,
    customPatterns = [],
  } = options;

  const content = fs.readFileSync(file, 'utf8');

  let graph: Graph =
    new TgfParser().parse(content);


  const patterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...customPatterns,
  ];

  const shouldExclude = (
    node: string,
  ): boolean =>
    patterns.some(pattern =>
      pattern.test(graph.getLabel(node)),
    );

  const nodes = graph
    .getNodes()
    .filter(
      node =>
        !(
          componentsOnly &&
          shouldExclude(node)
        ),
    );

  //
  // DETECTION DES CYCLES
  //

  graph = graph.subgraph(nodes);
  const queries = new GraphQueries(graph);
  const topology = analyzeTopology(graph);
  const cycles = topology.cyclicGroups;
  const computeLevel = (node: string): number => topology.levels.get(node) ?? 0;

  const components: Record<
    string,
    ComponentAnalysis
  > = {};

  nodes.forEach(node => {
    const metadata =
      splitNodeLabel(graph.getLabel(node));

    const dependencies =
      queries.getDirectDependencies(
        node,
      );

    const dependents =
      queries.getDirectDependents(
        node,
      );

    components[node] = {
      fullName: node,
      name: metadata.name,
      path: metadata.path,

      level: computeLevel(node),

      dependencyCount:
        dependencies.length,

      dependencies,

      usedByCount:
        dependents.length,

      usedBy: dependents,

      orphan:
        dependencies.length === 0 &&
        dependents.length === 0,

      leaf:
        dependencies.length === 0,
    };
  });

  //
  // ORPHELINS
  //

  const orphans = Object.values(
    components,
  ).filter(
    component =>
      component.orphan,
  );

  //
  // PLUS UTILISÉS
  //

  const usageCount =
    new Map<string, number>();

  nodes.forEach(node => {
    queries
      .getDirectDependencies(node)
      .forEach(dependency => {
        usageCount.set(
          dependency,
          (usageCount.get(
            dependency,
          ) ?? 0) + 1,
        );
      });
  });

  const mostUsed: [string, number][] =
    [...usageCount.entries()]
      .sort(
        (a, b) => b[1] - a[1],
      )
      .slice(0, 20);

  //
  // RAPPORT
  //

  const report: AnalysisReport = {
    totalNodes:
      graph.getNodeCount(),

    totalEdges:
      graph.getEdgeCount(),

    maxLevel: Math.max(
      0,
      ...Object.values(
        components,
      ).map(
        component =>
          component.level,
      ),
    ),

    orphanCount:
      orphans.length,

    cycleCount:
      cycles.length,
    cycleGroups: cycles,

    mostUsed,
  };

  //
  // EXPORTS JSON
  //
  const reportsDir = path.join('reports', OUTPUT_GRAPHE_DIR);
  fs.ensureDirSync(reportsDir);
  fs.writeFileSync(`${reportsDir}/analysis-report.json`, JSON.stringify(report, null, 2,), 'utf8',);
  fs.writeFileSync(`${reportsDir}/components.json`, JSON.stringify(components, null, 2,), 'utf8',);
  fs.writeFileSync(`${reportsDir}/orphans.json`, JSON.stringify(orphans, null, 2,), 'utf8',);
  fs.writeFileSync(`${reportsDir}/cycles.json`, JSON.stringify(cycles, null, 2,), 'utf8',);

  //
  // EXPORT CSV
  //
  let csv = 'name,path,level,usedByCount,dependencyCount,orphan,leaf\n';
  Object.values(components,).forEach(component => {
    csv += [
      `"${component.name}"`,
      `"${component.path}"`,
      component.level,
      component.usedByCount,
      component.dependencyCount,
      component.orphan,
      component.leaf,
    ].join(',');

    csv += '\n';
  });
  fs.writeFileSync(`${reportsDir}/components.csv`, csv, 'utf8',);

  //
  // MATRICE DES DEPENDANCES
  //
  const nodeList = Object.keys(components);
  let matrixCsv = ',' + nodeList.join(',') + '\n';
  nodeList.forEach(source => {
    matrixCsv += source;

    nodeList.forEach(target => {
      matrixCsv += ',' + (
        components[
          source
        ].dependencies.includes(
          target,
        )
          ? 1
          : 0
      );
    });
    matrixCsv += '\n';
  });
  fs.writeFileSync(`${reportsDir}//dependency-matrix.csv`, matrixCsv, 'utf8',);

  //
  // SORTIE CONSOLE
  //
  console.log(`Nodes: ${report.totalNodes}`,);
  console.log(`Edges: ${report.totalEdges}`,);
  console.log(`Max Level: ${report.maxLevel}`,);
  console.log(`Orphans: ${report.orphanCount}`,);
  console.log(`Cycles: ${report.cycleCount}`,);
}
