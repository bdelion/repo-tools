import { Graph } from '../model/Graph';
import { analyzeTopology } from '../topology';
import { RequiredComponent } from '../types/RequiredComponent';
import { ComponentMetrics } from '../types/ComponentMetrics';

export interface ComponentDependencyReport {
    requestedNames: string[];
    foundComponents: string[];
    missingNames: string[];
    requiredComponents: RequiredComponent[];
    directDependencies: string[];
    transitiveDependencies: string[];
    sharedDependencies: string[];
    cyclicGroups: string[][];
    maxDepth: number;
    complexityScore: number;
    componentMetrics: ComponentMetrics[];
    dependencyTreeTruncated: boolean;
    dependencyTree: Record<string, unknown>;
    dependencyTreeText: string;
}

export class GraphQueries {
    constructor(
        private readonly graph: Graph,
    ) { }

    public getDirectDependencies(component: string,): string[] {
        return this.graph.getDependencies(component,);
    }

    public getDirectDependents(component: string,): string[] {
        return this.graph.getDependents(component,);
    }

    private topology?: ReturnType<typeof analyzeTopology>;

    private structure() {
        return this.topology ??= analyzeTopology(this.graph);
    }

    private reachable(component: string, reverse = false): string[] {
        const visited = new Set([component]);
        const pending = [component];
        const result: string[] = [];
        while (pending.length) {
            const node = pending.pop()!;
            const neighbors = reverse ? this.graph.getDependents(node) : this.graph.getDependencies(node);
            for (const child of neighbors) {
                if (visited.has(child)) continue;
                visited.add(child);
                result.push(child);
                pending.push(child);
            }
        }
        return result;
    }

    public getTransitiveDependencies(component: string): string[] {
        return this.reachable(component);
    }

    public getTransitiveDependents(component: string): string[] {
        return this.reachable(component, true);
    }

    public getRequiredComponents(components: string[]): string[] {
        const result = new Set(components);
        for (const component of components) {
            for (const child of this.reachable(component)) result.add(child);
        }
        return [...result].sort();
    }

    public findByComponentName(
        componentName: string,
    ): string[] {
        return this.graph
            .getNodes()
            .filter(node => {
                const name =
                    this.graph.getLabel(node)
                        .split(
                            /\s+/,
                        )[0];

                return (
                    name ===
                    componentName
                );
            });
    }

    public findByComponentNames(
        componentNames: string[],
    ): string[] {
        return componentNames.flatMap(
            componentName =>
                this.findByComponentName(
                    componentName,
                ),
        );
    }

    public getRequiredComponentsByName(
        componentNames: string[],
    ): string[] {
        const components =
            this.findByComponentNames(
                componentNames,
            );

        return this.getRequiredComponents(
            components,
        );
    }

    private treeTruncated = false;

    private buildTree(component: string): Record<string, unknown> {
        const root: Record<string, unknown> = {};
        const visited = new Set([component]);
        const pending = [{ node: component, tree: root, depth: 0 }];
        let count = 0;
        while (pending.length) {
            const { node, tree, depth } = pending.pop()!;
            if (depth >= 128) { tree.$truncated = true; this.treeTruncated = true; continue; }
            for (const child of this.graph.getDependencies(node)) {
                if (++count > 5000) { tree.$truncated = true; this.treeTruncated = true; return root; }
                if (visited.has(child)) { tree[child] = { $ref: child }; continue; }
                visited.add(child);
                const children: Record<string, unknown> = {};
                tree[child] = children;
                pending.push({ node: child, tree: children, depth: depth + 1 });
            }
        }
        return root;
    }

    public buildDependencyTree(
        component: string,
    ): Record<
        string,
        unknown
    > {
        return {
            [component]:
                this.buildTree(
                    component,
                ),
        };
    }

    private renderNode(node: string, prefix = '', isLast = true, visited = new Set<string>()): string[] {
        const lines: string[] = [];
        const pending = [{ node, prefix, isLast, depth: 0 }];
        while (pending.length) {
            const current = pending.pop()!;
            if (lines.length >= 5000 || current.depth >= 128) {
                lines.push(current.prefix + '[truncated]');
                this.treeTruncated = true;
                break;
            }
            const label = this.graph.getLabel(current.node);
            lines.push(current.prefix + (current.isLast ? '??? ' : '??? ') + label + (visited.has(current.node) ? ' [reference]' : ''));
            if (visited.has(current.node)) continue;
            visited.add(current.node);
            const children = this.graph.getDependencies(current.node);
            for (let i = children.length - 1; i >= 0; i--) {
                pending.push({ node: children[i], prefix: current.prefix + (current.isLast ? '    ' : '?   '),
                    isLast: i === children.length - 1, depth: current.depth + 1 });
            }
        }
        return lines;
    }

    public renderDependencyTree(
        component: string,
    ): string {
        const lines = [
            component,
        ];

        const dependencies =
            this.graph.getDependencies(
                component,
            );

        dependencies.forEach(
            (
                dependency,
                index,
            ) => {
                lines.push(
                    ...this.renderNode(
                        dependency,
                        '',
                        index ===
                        dependencies.length -
                        1,
                    ),
                );
            },
        );

        return lines.join(
            '\n',
        );
    }

    public renderDependencyTrees(
        components: string[],
    ): string {
        return components
            .map(
                component =>
                    this.renderDependencyTree(
                        component,
                    ),
            )
            .join('\n\n');
    }

    private computeDepth(component: string): number {
        return this.structure().levels.get(component) ?? 0;
    }

    private findSharedDependencies(
        components: string[],
    ): string[] {

        if (components.length < 2) {
            return [];
        }

        const dependencySets = components.map(
            component =>
                new Set(
                    this.getTransitiveDependencies(
                        component,
                    ),
                ),
        );

        if (dependencySets.length === 0) {
            return [];
        }

        let intersection =
            new Set<string>(
                dependencySets[0],
            );

        for (
            let i = 1;
            i < dependencySets.length;
            i++
        ) {
            intersection = new Set(
                [...intersection].filter(
                    value =>
                        dependencySets[i].has(
                            value,
                        ),
                ),
            );
        }

        return [...intersection].sort();
    }

    private buildComponentMetrics(component: string): ComponentMetrics {
        const level = this.computeDepth(component);
        const directDependencies = this.getDirectDependencies(component,);
        const transitiveDependencies = this.getTransitiveDependencies(component,);
        const requiredComponents = this.getRequiredComponents([component,]);
        const maxDepth = this.computeDepth(component,);
        return {
            component,
            level,
            directDependencyCount: directDependencies.length,
            transitiveDependencyCount: transitiveDependencies.length,
            requiredComponentCount: requiredComponents.length,
            maxDepth,
            complexityScore: this.computeComplexityScore(requiredComponents.length, maxDepth,),
        };
    }

    private computeComplexityScore(requiredCount: number, maxDepth: number,): number {
        return Math.min(10000, Math.round(requiredCount * 3 + maxDepth * 15,),);
    }

    public getRequiredComponentsByNameDetailed(componentNames: string[], componentLevels: Record<string, { level?: number; name?: string; path?: string }> = {},): ComponentDependencyReport {
        this.treeTruncated = false;
        const foundComponents = this.findByComponentNames(componentNames,);
        const foundNames = foundComponents.map(component => this.graph.getLabel(component).split(/\s+/,)[0],);
        const missingNames = componentNames.filter(componentName => !foundNames.includes(componentName,),);
        const requiredComponents = this.getRequiredComponents(foundComponents,);
        const requiredComponentsDetailed = requiredComponents.map(component => {
            const metadata = componentLevels[component];
            return {
                component,
                name: metadata?.name ?? '',
                path: metadata?.path ?? '',
                level: this.computeDepth(component),
            };
        },);
        requiredComponentsDetailed.sort((a, b) => a.level - b.level,);
        const directDependencies = [...new Set(foundComponents.flatMap(
            component => this.getDirectDependencies(component,),),),
        ].sort();

        const transitiveDependencies = [...new Set(foundComponents.flatMap(
            component => this.getTransitiveDependencies(component,),),),
        ].filter(
            dependency => !directDependencies.includes(dependency,),
        ).sort();

        const sharedDependencies = this.findSharedDependencies(foundComponents,);
        const maxDepth = Math.max(0, ...foundComponents.map(component => this.computeDepth(component,),),);

        const dependencyTree: Record<string, unknown> = {};

        foundComponents.forEach(
            component => { Object.assign(dependencyTree, this.buildDependencyTree(component,),); },
        );

        const componentMetrics = foundComponents.map(component => this.buildComponentMetrics(component),);
        componentMetrics.sort((a, b) => {
            if (a.level !== b.level) {
                return a.level - b.level;
            }
            return a.complexityScore - b.complexityScore;
        });

        const dependencyTreeText = this.renderDependencyTrees(foundComponents);
        return {
            dependencyTreeTruncated: this.treeTruncated,
            cyclicGroups: this.structure().cyclicGroups.filter(group => group.some(node => requiredComponents.includes(node))),
            requestedNames: componentNames,
            foundComponents,
            missingNames,
            requiredComponents: requiredComponentsDetailed,
            directDependencies,
            transitiveDependencies,
            sharedDependencies,
            maxDepth,
            complexityScore: this.computeComplexityScore(requiredComponents.length, maxDepth,),
            componentMetrics,
            dependencyTree,
            dependencyTreeText,
        };
    }
}
