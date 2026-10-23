/**
 * Gère les dépendances entre les composants.
 * Fournit les structures de stockage et la fonction d’ajout de dépendance.
 */

import { DependencyMap } from '../types/types';

/** Dépendances complètes extraites du scan */
export const dependencies: DependencyMap = {};

/** Dépendances filtrées pour le graphe final */
export const dependenciesFiltered: DependencyMap = {};

/**
 * Ajoute une dépendance dans l’objet cible.
 *
 * @param {DependencyMap} target - Objet dans lequel ajouter la dépendance (dependencies ou dependenciesFiltered)
 * @param {string} parent - Composant parent (source)
 * @param {string} child - Composant enfant (cible)
 */
export function addDependency(
    target: DependencyMap,
    parent: string,
    child: string
): void {
    if (!target[parent]) {
        target[parent] = new Set();
    }
    target[parent].add(child);
}
