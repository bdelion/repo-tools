import path from 'node:path';
import fs from 'node:fs';

import { OUTPUT_GRAPHE_DIR } from '../config';

import { TgfParser } from '../graph/parsers/TgfParser';
import { GraphQueries } from '../graph/queries/GraphQueries';
import { RequiredComponentsReportWriter } from '../graph/reporters/RequiredComponentsReportWriter';
import { selectComponentNames } from './componentSelection';

const graphFile = process.argv[2];
const selectionArgs = process.argv.slice(3);
const usage = [
    'Usage: npm run graph:required-by-name -- <graph.tgf> <Component1 Component2... | --all | --components-file chemin.txt>',
    'Le séparateur -- après le nom du script est nécessaire pour transmettre les options au script.',
].join('\n');

if (graphFile === '--help') {
    console.log(usage);
    process.exit(0);
}

if (!graphFile || graphFile.startsWith('--') || selectionArgs.length === 0) {
    console.error(usage);
    process.exit(1);
}

try {
    const content = fs.readFileSync(graphFile, 'utf8');
    const graph = new TgfParser().parse(content);
    const componentNames = selectComponentNames(selectionArgs, graph);
    const queries = new GraphQueries(graph);
    const reportsDirectory = path.join('reports', OUTPUT_GRAPHE_DIR);
    const metadataFile = path.join(reportsDirectory, 'components.json');
    if (!fs.existsSync(metadataFile)) {
        throw new Error(`Métadonnées absentes : ${metadataFile}. Exécuter d'abord npm run graph:analyze -- "${graphFile}".`);
    }
    const componentsMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    const report = queries.getRequiredComponentsByNameDetailed(componentNames, componentsMetadata);

    const outputDirectory = path.join(reportsDirectory, 'required-components');
    new RequiredComponentsReportWriter().write(report, outputDirectory);

    console.log(`Reports generated in ${outputDirectory}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
