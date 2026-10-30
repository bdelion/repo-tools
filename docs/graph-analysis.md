# Analyse de graphe

Les niveaux sont calculés sur les composantes fortement connexes ; les cycles
sont des groupes à traiter ensemble. Voir [la sémantique des métriques et la migration](reliability.md).

Cette fonctionnalité est issue de l'intégration de repo-tgf-analysis dans repo-tools.

L'objectif est d'analyser le graphe des dépendances des composants.

Les analyses actuellement disponibles sont :

- cycle detection
- orphan node detection
- dependency analysis
- depth analysis

Le format de travail principal reste le TGF.
