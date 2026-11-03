/**
 * Point d'entrée du script de génération du graphe de dépendances des composants.
 * Ce script scanne un répertoire source, extrait les composants et leurs dépendances,
 * puis génère un fichier TGF représentant le graphe.
 */

import { scanDirectory } from './scanner/scanDirectory';
import { createRecursivedTGF } from './graph/graphBuilder';
import { writeTgfFile } from './output/writeTgf';
import { nodesFiltered } from './graph/nodeManager';
import { dependenciesFiltered } from './graph/dependencyManager';
import { ORIGIN_PATH, SCAN_PATH, OUTPUT_TGF_PATH } from './config';
import { runLibraryGeneration } from './commands/library-generate';

const args = process.argv.slice(2);
if (args.includes('--detailed')) {
    if (args.length !== 1) throw new Error('--detailed est le mode historique ; utiliser seul ou choisir --view.');
    scanDirectory(SCAN_PATH, ORIGIN_PATH, 'detailed');
    createRecursivedTGF();
    writeTgfFile(nodesFiltered, dependenciesFiltered, OUTPUT_TGF_PATH);
    console.log(`✅ Fichier TGF généré : ${OUTPUT_TGF_PATH}`);
} else {
    runLibraryGeneration(args).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
