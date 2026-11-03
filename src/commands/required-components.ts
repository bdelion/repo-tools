import fs from 'node:fs';

import { TgfParser } from '../graph/parsers/TgfParser';
import { GraphQueries } from '../graph/queries/GraphQueries';
import { runLibrarySelection } from './library-generate';

if (process.argv[2] === '--help') {
    console.log('Usage : npm run graph:required -- --analysis fichier.analysis.json NomOuIdentifiant... [--output rapport.json]\nCompatibilité TGF : npm run graph:required -- fichier.tgf Nom...');
} else if (process.argv[2] === '--analysis') {
    runLibrarySelection(process.argv.slice(3), 'required').catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
} else {
    const graphFile = process.argv[2];
    const componentNames = process.argv.slice(3);
    if (!graphFile || componentNames.length === 0) {
        console.error('Usage : npm run graph:required -- fichier.tgf Nom...\nOu : npm run graph:required -- --analysis fichier.analysis.json Nom...');
        process.exit(1);
    }
    const graph = new TgfParser().parse(fs.readFileSync(graphFile, 'utf8'));
    const queries = new GraphQueries(graph);
    const result = queries.getRequiredComponentsByNameDetailed(componentNames);
    console.log(JSON.stringify(result, null, 2));
    console.log(result.dependencyTreeText);
}
