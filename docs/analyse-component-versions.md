# 📦 Analyse des composants exportés

> Ce module analyse des dépôts Git (multi-repos possible), détecte les **composants exportés** (`export { default as ... }`), compare leur **évolution entre tags** et produit des **rapports** (Markdown / Excel). Il s’appuie notamment sur un **diff structurel AST** pour éviter les faux positifs liés au formatting.

## 🎯 Objectif

- Identifier les composants exportés (`export { default as ... }`)
- Comparer les composants entre versions Git (tags)
- Générer des rapports Markdown et Excel

## ✨ Fonctionnalités principales

- Analyse des composants dans les fichiers source
- Support multi-dépôts Git (`repo-react`, `enterprise-assets`, etc.)
- Scan par tag (tags SemVer stables, hors `-SNAPSHOT`, `-rc.*`, `-hc.*`, etc.)
- Analyse AST via Babel
- Extraction des exports et de **métadonnées** (ex. `@visibleName`, usage de `forwardRef`, `memo`, etc.)
- Détection des changements par **hash contenu**, **diff AST** et **diff GIT**
- Rapports : Markdown (tables compactes) + Excel (.xlsx)
- Caches (`sha_index.json` (tags/SHAs déjà analysés) & `git_diff_cache.json` (diffs mémorisés)) pour éviter les ré-analyses

## 🔧 Configuration

Même si le script fonctionne sans options, il est conseillé d’exposer (ou centraliser) la configuration via le fichier [config.analyse-component-versions.json] afin d'avoir d'avoir des runs reproductibles :

- `repos` : liste des dépôts à analyser `{ name, url }`.
- `githubBaseUrl` : base pour générer les liens.
- `tmpDir`, `analysisDir`, `reportsDir` : chemins de sortie.
- `includeExportAll` : inclure/exclure `export *`.
- `excludeDefaultNameEverywhere` : exclure `name === "default"`.
- `markdownCompactTables` : minifier les tableaux.
- `markdownDropEmptyColumns` : supprimer colonnes vides.
- et bien d'autres encore

## ▶️ Exécution

```bash
node analyse-component-versions.js
```
ou via npm :

```bash
npm run analyse-component-versions
```

### Recherche des exports via grep

```bash
grep -r "export { default as " . | sed -E 's|(.*):export \{ default as ([^ ]+) \} from '\''\.\/([^'\''/]+)'\''|\1\t\2\t\3|'
```

Exemple de résultats sur `repo-react-enterprise` :

```bash
./src/characters/characterCard/index.js CharacterCard   characterCard
./src/characters/profilBadge/index.js   ProfilBadge     profilBadge
./src/contacts/phoneFormFragment/index.js       PhoneFormFragment       phoneFormFragment
...
./src/offersSelection/offerSidebar/index.js     OfferSidebar    offerSidebar
./src/promises/index.js useAggregatedQueries    useAggregatedQueries
./src/promises/index.js usePromise      usePromise

```

## 📂 Sorties

Les résultats d'analyses sont enregistrés dans le dossier `analyses` :
- `./analyses/[repo]_[tag].json` : analyse par version, contient les infos sur les composants de la version ainsi que :
  - `sha` : pour avoir une trace et éviter les analyses de tags déjà réalisées-
  - `tag` : le tag de la version
  - `date` : la date/heure de l'analyse
- `./analyses/[repo]_[version - 1]_to_[version]_rapport.json` et `./analyses/[repo]_[version - 1]_to_[version]_rapport.md` : comparaison pair-à-pair, contient l'état de l'écart entre 2 versions : ajout, suppression, modifié et non modifié sur les composants

Les rapports/synthèses d'analyses sont enregistrés dans le dossier `reports` :
- `./reports/[repo]_component_comparison.md` et `./reports/[repo]_component_comparison.xlsx` : contient un tableau de tous les composants sur l'ensemble des versions avec le statut du composant dans chaque version
- `./reports/[repo]_summary.json` : contient un résumé par version du nombre de composant

## ✅ Bonnes pratiques

- Workspace propre (tags à jour)
- Activer markdownCompactTables pour des rapports légers
- Garder les caches pour accélérer les relances

## TODO Liste des évolutions possibles

### 📊 Visualisation graphique

La génération du graphique a échoué car le dossier `./analyses` n’est pas présent dans l'environnement d'exécution. Pour corriger cela :

- Assure-toi que les rapports JSON sont bien générés dans `./analyses`.
- Je peux te fournir un script Python autonome que tu peux exécuter localement pour générer un **diagramme en barres** ou une **heatmap** des changements entre versions.

Souhaites-tu :
1. Un script Python prêt à l’emploi pour visualiser les rapports ?
2. Que je t’aide à intégrer cette visualisation dans le rapport Markdown ou Excel ?

Je peux aussi te proposer une version interactive avec Plotly ou une image statique.

<!-- liens -->
[config.analyse-component-versions.json](../src/config.analyse-component-versions.json)
