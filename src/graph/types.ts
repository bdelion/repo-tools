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
    mostUsed: [string, number][];
}