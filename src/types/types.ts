/**
 * Définitions des types utilisés dans le graphe de dépendances.
 * Ces types permettent de structurer les données manipulées dans le script.
 */

/**
 * Représente un nœud du graphe, correspondant à un composant exporté.
 */
export type Node = {
    visibleName: string; // Nom visible du composant (annotation @visibleName)
    icone: string;          // Icône associée (extrait de @visibleName)
    fileName: string;    // Chemin relatif du fichier source
};

/**
 * Structure de stockage des nœuds, indexés par leur nom d’export.
 */
export type NodeMap = {
    [key: string]: Node;
};

/**
 * Structure de stockage des dépendances entre nœuds.
 * Chaque clé est un composant, et la valeur est un ensemble de dépendances.
 */
export type DependencyMap = {
    [key: string]: Set<string>;
};
