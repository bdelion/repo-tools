import path from 'node:path';
import fs from 'node:fs';

import { OUTPUT_GRAPHE_DIR } from '../config';

import { TgfParser } from '../graph/parsers/TgfParser';
import { GraphQueries } from '../graph/queries/GraphQueries';
import { RequiredComponentsReportWriter } from '../graph/reporters/RequiredComponentsReportWriter';

const graphFile = process.argv[2];
const componentNames = process.argv.slice(3);

if (!graphFile || componentNames.length === 0) {
    console.error('Usage: required-components-by-name graph.tgf Component1 Component2',);
    process.exit(1);
}

const content = fs.readFileSync(graphFile, 'utf8',);
const graph = new TgfParser().parse(content,);
const queries = new GraphQueries(graph);
const componentsMetadata = JSON.parse(fs.readFileSync(`${path.join('reports', OUTPUT_GRAPHE_DIR)}/components.json`, 'utf8',),);
const report = queries.getRequiredComponentsByNameDetailed(componentNames, componentsMetadata,);

new RequiredComponentsReportWriter().write(report);

console.log('Reports generated in reports/required-components',);