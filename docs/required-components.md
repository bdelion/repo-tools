# Required Components Analysis

## Objective

Identify all dependencies required to move one or more
components into another library.

## Example

### Sélection des composants en ligne de commande

Générer d’abord les métadonnées associées au fichier TGF :

```bash
npm run graph:analyze -- graphe/repo-react-component-dependency-graph.tgf
```

Puis choisir un des trois modes :

```bash
# Liste explicite (comportement existant)
npm run graph:required-by-name -- graphe/repo-react-component-dependency-graph.tgf ComboBox Dialog

# Tous les composants présents dans le graphe, y compris les composants isolés
npm run graph:required-by-name -- graphe/repo-react-component-dependency-graph.tgf --all

# Liste depuis un fichier ; entourer le chemin de guillemets s’il contient des espaces
npm run graph:required-by-name -- graphe/repo-react-component-dependency-graph.tgf --components-file config/components.txt
```

Le fichier est un texte UTF-8, avec un nom de composant par ligne, par exemple :

```text
# Composants nécessaires à la migration
ComboBox
Dialog

Button
```

Les espaces en début/fin de ligne, lignes vides et lignes de commentaire `#`
sont ignorés. Les noms sont sensibles à la casse et correspondent au premier
élément du label TGF, comme pour les arguments explicites. Plusieurs noms sur
une même ligne ne sont pas acceptés. Les doublons sont supprimés ; les noms
absents du graphe apparaissent dans « Missing Components ».

Les modes ne se combinent pas. Un fichier vide, absent ou illisible, une option
inconnue ou un graphe vide avec `--all` provoquent un échec explicite.

Les trois modes utilisent le même graphe et les mêmes métadonnées
`reports/<OUTPUT_GRAPHE_DIR>/components.json`. Régénérer ces dernières après toute
modification du graphe. Le répertoire dépend de `src/config.ts` ; les rapports
JSON et Markdown sont écrits dans `reports/<OUTPUT_GRAPHE_DIR>/required-components/`.
Les rapports existants à cet emplacement sont remplacés à chaque exécution.

### Exemple de dépendances

Graph:

A -> B
B -> C
C -> D

G -> H

Request:

A
G

Result:

A
B
C
D
G
H

## Generated Reports

### JSON

Machine-readable report.

### Markdown

Developer-oriented report.

## Metrics

### Direct Dependencies

Immediate dependencies.

### Transitive Dependencies

Recursively discovered dependencies.

### Shared Dependencies

Dependencies used by several requested components.

### Max Depth

Deepest dependency level.

### Complexity Score

Migration effort estimation from 0 to 100.

## Dependency Tree

Example:

```text
A
└── B
    └── C
        └── D

G
└── H
```
