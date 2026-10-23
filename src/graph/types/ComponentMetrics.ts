export interface ComponentMetrics {
    component: string;
    level: number;
    directDependencyCount: number;
    transitiveDependencyCount: number;
    requiredComponentCount: number;
    maxDepth: number;
    complexityScore: number;
}