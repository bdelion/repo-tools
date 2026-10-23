import fs from 'node:fs';

import { TgfParser } from '../graph/parsers/TgfParser';
import { GraphQueries } from '../graph/queries/GraphQueries';

const graphFile = process.argv[2];
const componentNames = process.argv.slice(3);

if (!graphFile || componentNames.length === 0) {
    console.error('Usage: required-components-by-name graph.tgf Component1 Component2',);
    process.exit(1);
}

const graph = new TgfParser().parse(fs.readFileSync(graphFile, 'utf8',),);
const queries = new GraphQueries(graph);
//TODEL const result = queries.getRequiredComponentsByName(componentNames,);
const result = queries.getRequiredComponentsByNameDetailed(componentNames,);
console.log(JSON.stringify(result, null, 2,),);

console.log("=-=-=-");
const result1 = queries.renderDependencyTrees(componentNames,);
console.log(result1);