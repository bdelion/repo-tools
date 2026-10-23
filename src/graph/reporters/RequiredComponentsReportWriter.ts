import fs from 'node:fs';
import path from 'node:path';

import { OUTPUT_GRAPHE_DIR } from '../../config';

import { ComponentDependencyReport, } from '../queries/GraphQueries';

export class RequiredComponentsReportWriter {
    public write(report: ComponentDependencyReport, outputDirectory = `${path.join('reports', OUTPUT_GRAPHE_DIR)}/required-components`,): void {
        fs.mkdirSync(outputDirectory, { recursive: true },);
        this.writeJson(report, outputDirectory,);
        this.writeMarkdown(report, outputDirectory,);
    }

    private writeJson(report: ComponentDependencyReport, outputDirectory: string,): void {
        fs.writeFileSync(path.join(outputDirectory, 'required-components.json',), JSON.stringify(report, null, 2,), 'utf8',);
    }

    private writeMarkdown(report: ComponentDependencyReport, outputDirectory: string,): void {

        const markdown = [
            '# Required Components Report',
            '',
            '## Summary',
            '',
            '| Metric | Value |',
            '|----------|----------|',
            `| Requested components | ${report.requestedNames.length} |`,
            `| Required components | ${report.requiredComponents.length} |`,
            `| Direct dependencies | ${report.directDependencies.length} |`,
            `| Transitive dependencies | ${report.transitiveDependencies.length} |`,
            `| Shared dependencies | ${report.sharedDependencies.length} |`,
            `| Max depth | ${report.maxDepth} |`,
            `| Complexity score | ${report.complexityScore} |`,
            '',
            '## Component Metrics',
            '',
            '| Component | Direct | Transitive | Total | Depth | Score | Level |',
            '|------------|---------|---------|---------|---------|---------|---------|',
            ...report.componentMetrics.map(
                metric =>
                    `| ${metric.component} | ${metric.directDependencyCount} | ${metric.transitiveDependencyCount} | ${metric.requiredComponentCount} | ${metric.maxDepth} | ${metric.complexityScore} | ${metric.level} |`,
            ),
            '',
            '## Shared Dependencies',
            '',
            ...(report.sharedDependencies.length > 0
                ? report.sharedDependencies.map(
                    dependency =>
                        `- ${dependency}`,
                )
                : ['- None']),

            '',
            '## Requested Components',
            '',
            ...report.requestedNames.map(
                component =>
                    `- ${component}`,
            ),
            '',
            '## Missing Components',
            '',
            ...(report.missingNames.length > 0
                ? report.missingNames.map(
                    component =>
                        `- ${component}`,
                )
                : ['- None']),
            '',
            '## Required Components',
            '',
            '| Component | Level |',
            '|------------|---------|',
            ...report.requiredComponents.map(component => `| ${component.component} | ${component.level} |`,),
            '',
            '## Dependency Tree',
            '',
            '```text',
            report.dependencyTreeText,
            '```',
            '',
        ].join('\n');

        fs.writeFileSync(path.join(outputDirectory, 'required-components.md',), markdown, 'utf8',);
    }
}