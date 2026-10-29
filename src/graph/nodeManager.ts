/**
 * Gère les nœuds du graphe (composants).
 * Fournit les structures de stockage et la fonction d’ajout de nœud.
 */

import { NodeMap } from '../types/types';

/** Nœuds complets extraits du scan */
export const nodes: NodeMap = {};

/** Nœuds filtrés pour le graphe final */
export const nodesFiltered: NodeMap = {};

/**
 * Ajoute un nœud dans l’objet cible si non déjà présent.
 *
 * @param {NodeMap} target - Objet dans lequel ajouter le nœud (nodes ou nodesFiltered)
 * @param {string} extractName - Nom du composant exporté
 * @param {string} visibleName - Nom visible (annotation @visibleName)
 * @param {string} icone - Icône associée (extrait de @visibleName)
 * @param {string} fileName - Chemin relatif du fichier source
 */
export function addNode(
    target: NodeMap,
    extractName: string,
    visibleName: string,
    icone: string,
    fileName: string
): void {
    if (!Object.prototype.hasOwnProperty.call(target, extractName)) {
        Object.defineProperty(target, extractName, { value: {
            visibleName: visibleName || extractName,
            icone,
            fileName
        }, enumerable: true, configurable: true, writable: true });
    }
}
