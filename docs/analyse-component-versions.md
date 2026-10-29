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
- Analyse des branches distantes `develop`, `release/<version>` et `hotfix/*`.
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

Les fichiers source sont désormais résolus par chemin/AST, les exports homonymes
restent distincts et les caches sont invalidés par un fingerprint de l’analyseur
et de sa configuration. Voir [le détail des garanties et de la migration](reliability.md).

### Versions en préparation : develop, release et hotfix

À chaque exécution, les branches d’`origin` sont actualisées avec `fetch --all --prune`.
Les références sont triées par version **SemVer**, et non par nom ou par date :
`1.9.0` précède `1.10.0`. Les bornes `tagMin` et `tagMax` s’appliquent aussi aux branches.

| Source | Libellé dans les rapports |
|---|---|
| Tag `1.8.0` | `1.8.0` |
| Branche `develop`, package.json `1.9.0` | `1.9.0 (develop)` |
| Branche `release/1.8.0` | `1.8.0 (release candidate)` |
| Branche `hotfix/1.7.1` | `1.7.1 (hotfix candidate)` |
| Branche `hotfix/viewbox_svg`, package.json `0.14.1` | `0.14.1 (hotfix candidate)` |

Une seule référence est conservée pour une même version, avec cette priorité :
**tag publié > release > hotfix > develop**. Une branche release remplace donc
develop pour la même version ; un tag remplace ensuite les candidats correspondants.
Un dépôt sans tag ou sans develop peut être analysé s’il possède une branche candidate.

Pour release, la version du nom de branche doit être une version SemVer valide
et être **strictement identique** à `package.json.version` du commit analysé.
Pour `hotfix/<version>`, la même correspondance est exigée lorsque le suffixe est
une version SemVer canonique. Les hotfix descriptives (`hotfix/viewbox_svg`, par
exemple) prennent leur version dans le `package.json`, qui doit déclarer une
version SemVer valide. Le nom réel de la branche reste stocké dans `branch`.
Par exemple, `release/1.8.0` avec un package `1.8.0-rc.1` est une erreur.
Develop doit également déclarer une version SemVer valide. Toutes les branches
release/hotfix découvertes sont validées, même si leur version est hors bornes
ou masquée par un tag. Une incohérence arrête l’analyse de ce dépôt, avant toute
modification de ses rapports ; les autres dépôts sont traités et la commande se
termine avec un code d’erreur.

Si plusieurs hotfix portent la même version et que cette version n’est pas déjà
retenue par un tag ou une release, l’analyse du dépôt échoue avant publication
avec un message d’ambiguïté listant les branches. Aucun choix arbitraire n’est fait.

Les analyses JSON contiennent `version`, `kind`, `branch` et `sha`. Les comparaisons
utilisent les SHA afin qu’un nouveau commit sur une branche ne réutilise pas un ancien diff.
Les liens Markdown et Excel utilisent une référence nommée : la référence de plus
haute version analysée si le fichier y existe encore, sinon le dernier tag analysé
où il existe. Sans tag correspondant, la dernière branche candidate connue sert
de repli. L’existence des fichiers est vérifiée dans les arbres Git ; le fichier
d’export et le fichier source sont traités indépendamment. Une branche pouvant
évoluer après la génération, ses liens reflètent son état au moment de leur ouverture.

Les lignes sont triées naturellement sur le nom de composant affiché (`Component2`
avant `Component10`), avec l’identité comme critère secondaire déterministe.
Les homonymes restent distincts. Un renommage/déplacement partage une seule ligne
si une correspondance unique repose sur un déplacement Git, le même symbole source,
ou un contenu source strictement identique. `git diff --find-renames=50%` détecte
les déplacements de fichiers ; il s’agit d’une heuristique, pas d’une preuve métier.
Deux symboles source connus et différents ne sont pas fusionnés. Une ressemblance
de noms ou un AST identique seul ne suffit pas. Les cas ambigus restent ajoutés/supprimés.
Les comparaisons JSON et Markdown exposent `previous`, `changeReasons` et
`historyMatch` pour les composants modifiés ; la matrice conserve les anciens noms
et le motif du rapprochement. Les identifiants bruts des analyses restent inchangés.

Après une analyse réussie, les fichiers d’analyse et de comparaison devenus
obsolètes sont supprimés pour le seul dépôt concerné, puis les comparaisons
consécutives et rapports globaux sont régénérés. Cela couvre les changements de
version, les transitions develop → release → tag et la suppression des branches
release/hotfix distantes. Les clés de cache obsolètes sont également retirées.
Les fichiers d’autres dépôts et les fichiers non reconnus comme sorties de cet
analyseur sont conservés. Les répertoires configurés restent des répertoires de
sortie : les anciennes versions exclues par les bornes peuvent être nettoyées.

### Préparation et publication des sorties

Chaque version analysée est représentée par un snapshot associant sa référence
(`version`, `kind`, `label`, `branch`, `sha`) et son résultat. Ce même objet est
transmis aux comparaisons et générateurs de rapports : les SHA et les libellés
ne sont plus reconstruits à partir de tables parallèles.

Pour chaque dépôt, toutes les analyses, comparaisons, synthèses, sorties Excel et
caches sont préparés en mémoire avant publication. Si leur génération échoue,
les fichiers précédents et les fichiers devenus obsolètes restent en place.
Les modifications du cache en mémoire sont également annulées, afin qu’un autre
dépôt traité ensuite ne les persiste pas.

La publication prépare des fichiers temporaires voisins des destinations et
sauvegarde les fichiers existants. Elle remplace ensuite les sorties puis supprime
les fichiers obsolètes. Une erreur pendant cette phase déclenche une restauration
des fichiers remplacés ou supprimés et le retrait des nouveaux fichiers. Les
fichiers temporaires sont nettoyés ; si la restauration échoue elle aussi, les
sauvegardes correspondantes sont conservées et l’erreur est signalée.

Ce mécanisme protège contre les erreurs interceptées pendant une exécution.
Il ne constitue pas une transaction atomique entre plusieurs fichiers : un lecteur
concurrent peut voir un état intermédiaire, et un arrêt brutal du processus ou
de la machine ne déclenche pas la restauration. Éviter les exécutions simultanées
sur les mêmes répertoires. La préparation en mémoire augmente aussi la mémoire
nécessaire à hauteur des sorties générées.

Les noms de fichiers normalisent les caractères spéciaux en `_`, par exemple :

```text
analyses/repo-react_1.8.0__release_candidate_.json
analyses/repo-react_1.7.1_to_1.8.0__release_candidate__rapport.md
```

Les libellés lisibles dans les contenus restent inchangés. Les anciennes
comparaisons avec espaces et parenthèses dans leur nom sont nettoyées lors de la
régénération. La suppression de tags distants n’est pas répercutée automatiquement
sur les tags locaux ; cette évolution concerne le cycle de vie des branches.

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
