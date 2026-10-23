import { analyzeGraph } from '../graph/analyzeGraph';

const inputFile = process.argv[2];

if (!inputFile) {
    console.error('Usage: graph:analyze graph.tgf',);
    process.exit(1);
}

analyzeGraph(inputFile);