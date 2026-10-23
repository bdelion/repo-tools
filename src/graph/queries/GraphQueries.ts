import { Graph } from '../model/Graph';
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
    maxDepth: number;
    complexityScore: number;
    componentMetrics: ComponentMetrics[];
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

    public getTransitiveDependencies(component: string,): string[] {
        const result = new Set<string>();
        const visit = (node: string,): void => {
            const dependencies = this.graph.getDependencies(node,);
            dependencies.forEach(dependency => {
                if (result.has(dependency,)) {
                    return;
                }
                result.add(dependency,);
                visit(dependency,);
            },);
        };

        visit(component);

        return [...result];
    }

    public getTransitiveDependents(
        component: string,
    ): string[] {
        const result = new Set<string>();

        const visit = (
            node: string,
        ): void => {
            const dependents =
                this.graph.getDependents(
                    node,
                );

            dependents.forEach(
                dependent => {
                    if (
                        result.has(
                            dependent,
                        )
                    ) {
                        return;
                    }

                    result.add(
                        dependent,
                    );

                    visit(
                        dependent,
                    );
                },
            );
        };

        visit(component);

        return [...result];
    }

    public getRequiredComponents(
        components: string[],
    ): string[] {
        const result =
            new Set<string>();

        const visit = (
            component: string,
        ): void => {
            if (
                result.has(
                    component,
                )
            ) {
                return;
            }

            result.add(
                component,
            );

            this.graph
                .getDependencies(
                    component,
                )
                .forEach(
                    visit,
                );
        };

        components.forEach(
            visit,
        );

        return [
            ...result,
        ].sort();
    }

    public findByComponentName(
        componentName: string,
    ): string[] {
        return this.graph
            .getNodes()
            .filter(node => {
                const name =
                    node
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

    private buildTree(
        component: string,
        visited =
            new Set<string>(),
    ): Record<
        string,
        unknown
    > {
        if (
            visited.has(
                component,
            )
        ) {
            return {};
        }

        visited.add(
            component,
        );

        const tree:
            Record<
                string,
                unknown
            > = {};

        this.graph
            .getDependencies(
                component,
            )
            .forEach(
                dependency => {
                    tree[
                        dependency
                    ] =
                        this.buildTree(
                            dependency,
                            new Set(
                                visited,
                            ),
                        );
                },
            );

        return tree;
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

    private renderNode(
        node: string,
        prefix = '',
        isLast = true,
        visited =
            new Set<string>(),
    ): string[] {
        if (
            visited.has(node)
        ) {
            return [];
        }

        visited.add(
            node,
        );

        const lines: string[] =
            [];

        lines.push(
            prefix +
            (isLast
                ? '└── '
                : '├── ') +
            node,
        );

        const dependencies =
            this.graph.getDependencies(
                node,
            );

        dependencies.forEach(
            (
                dependency,
                index,
            ) => {
                const last =
                    index ===
                    dependencies.length -
                    1;

                const childPrefix =
                    prefix +
                    (isLast
                        ? '    '
                        : '│   ');

                lines.push(
                    ...this.renderNode(
                        dependency,
                        childPrefix,
                        last,
                        visited,
                    ),
                );
            },
        );

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

    private computeDepth(
        component: string,
        level = 0,
        visited =
            new Set<string>(),
    ): number {
        if (
            visited.has(
                component,
            )
        ) {
            return level;
        }

        visited.add(
            component,
        );

        const dependencies =
            this.graph.getDependencies(
                component,
            );

        if (
            dependencies.length ===
            0
        ) {
            return level;
        }

        return Math.max(
            ...dependencies.map(
                dependency =>
                    this.computeDepth(
                        dependency,
                        level + 1,
                        new Set(
                            visited,
                        ),
                    ),
            ),
        );
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

    private buildComponentMetrics(component: string, componentLevels: Record<string, any> = {},): ComponentMetrics {
        const level = componentLevels[component]?.level ?? -1;
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

    public getRequiredComponentsByNameDetailed(componentNames: string[], componentLevels: Record<string, any> = {},): ComponentDependencyReport {
        const foundComponents = this.findByComponentNames(componentNames,);
        const foundNames = foundComponents.map(component => component.split(/\s+/,)[0],);
        const missingNames = componentNames.filter(componentName => !foundNames.includes(componentName,),);
        const requiredComponents = this.getRequiredComponents(foundComponents,);
        const requiredComponentsDetailed = requiredComponents.map(component => {
            const metadata = componentLevels[component];
            return {
                component,
                name: metadata?.name ?? '',
                path: metadata?.path ?? '',
                level: metadata?.level ?? -1,
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

        const componentMetrics = foundComponents.map(component => this.buildComponentMetrics(component, componentLevels,),);
        componentMetrics.sort((a, b) => {
            if (a.level !== b.level) {
                return a.level - b.level;
            }
            return a.complexityScore - b.complexityScore;
        });

        return {
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
            dependencyTreeText: this.renderDependencyTrees(foundComponents,),
        };
    }
}