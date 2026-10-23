/**
 * Point d'entrée du script de génération du graphe de dépendances des composants.
 * Ce script scanne un répertoire source, extrait les composants et leurs dépendances,
 * puis génère un fichier TGF représentant le graphe.
 */

import { scanDirectory } from './scanner/scanDirectory';
import { createRecursivedTGF } from './graph/graphBuilder';
import { writeTgfFile } from './output/writeTgf';
import { nodes, nodesFiltered } from './graph/nodeManager';
import { dependencies, dependenciesFiltered } from './graph/dependencyManager';
import { ORIGIN_PATH, SCAN_PATH, OUTPUT_TGF_PATH } from './config';

scanDirectory(SCAN_PATH, ORIGIN_PATH);

createRecursivedTGF();

writeTgfFile(nodesFiltered, dependenciesFiltered, OUTPUT_TGF_PATH);
console.log(`✅ Fichier TGF généré : ${OUTPUT_TGF_PATH}`);
