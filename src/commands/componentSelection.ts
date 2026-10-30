import fs from 'node:fs';
import { Graph } from '../graph/model/Graph';

/** Sélectionne les noms demandés, avec un seul mode de sélection par appel. */
export function selectComponentNames(args: string[], graph: Graph): string[] {
    let names: string[];

    if (args[0] === '--all' && args.length === 1) {
        names = graph.getNodes().map(node => graph.getLabel(node).split(/\s+/)[0]);
    } else if (args[0] === '--components-file' && args.length === 2 && !args[1].startsWith('--')) {
        names = fs.readFileSync(args[1], 'utf8')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));
        if (names.some(name => /\s/.test(name))) {
            throw new Error('Le fichier doit contenir un seul nom de composant par ligne.');
        }
    } else if (args.length > 0 && args.every(arg => !arg.startsWith('--'))) {
        names = args;
    } else {
        throw new Error('Choisir un seul mode : noms de composants, --all ou --components-file <chemin>.');
    }

    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length === 0) {
        throw new Error('La sélection ne contient aucun composant.');
    }
    return uniqueNames;
}
