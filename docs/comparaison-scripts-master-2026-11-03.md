# Comparaison des scripts npm avec logs/master-script

Analyse du 3 novembre 2026. Référence : `logs/master-script/package.json` et ses
sources. Cible : `package.json` et les sources actuelles du dépôt. Les fichiers
`.env` n'ont pas été lus ni reproduits. Aucune commande métier accédant aux dépôts
distants n'a été exécutée. Le dossier de référence n'a pas été modifié.

## Conclusion

Les neuf commandes historiques existent toujours, mais leur nom ne garantit pas
la conservation de leur comportement. Cinq commandes ont été ajoutées.

Les ruptures principales concernent la chaîne complète du graphe : génération,
lecture TGF, identité des composants, métriques et rapports. L'analyse des versions
a également été réécrite en profondeur. En revanche, `scan-ghe` présente surtout
des modifications de nettoyage de code, sans changement métier identifié dans
le diff de son point d'entrée.

Deux problèmes sont reproduits dans l'état examiné : le lint parcourt les copies
de référence dans `logs`, et le second arbre affiché par `graph:required` utilise
encore les noms fournis plutôt que les identifiants résolus.

## Inventaire exhaustif

| Commande | Référence master-script | État actuel et impact |
| --- | --- | --- |
| `build` | Affiche `useless pipeline step` ; aucune compilation | Exécute `typecheck` ; peut maintenant échouer sur une erreur TypeScript ; ne produit toujours pas de JavaScript compilé |
| `lint` | `eslint .` | Même commande, configuration différente ; les copies de sources dans `logs` sont aussi inspectées |
| `lint:fix` | `eslint --fix .` | Même commande, mais nouvelles règles et même périmètre global ; peut modifier les copies de référence |
| `generate-component-dependency-graph` | Extraction par noms avec regex, graphe filtré | Résolution AST/TypeScript, identifiants fichier/export, vue composants par défaut et option `--detailed` ; résultats et format des identifiants changés |
| `analyse-component-versions` | Comparaisons de tags et develop dans un script monolithique | Références release/hotfix supplémentaires, résolution des sources, historique des symboles, rapports et cache remaniés ; résultats non équivalents |
| `scan-ghe` | Inventaire GitHub Enterprise, projets et dépendances, JSON/Excel | Même commande et logique métier essentiellement conservée dans le diff ; l'environnement et les dépendances installées restent à contrôler pour comparer des résultats réels |
| `graph:analyze` | Analyse TGF via labels et calculs récursifs | Point d'entrée identique, parseur et moteur remplacés ; identifiants stables, sous-graphe filtré et groupes cycliques modifient les sorties |
| `graph:required` | Rapport JSON et arbres sur la sortie standard | Point d'entrée identique, requêtes profondément modifiées ; second affichage d'arbre incohérent avec les nouveaux identifiants |
| `graph:required-by-name` | Liste explicite de noms et rapports JSON/Markdown | Liste, `--all`, fichier de sélection ; nouvelles métriques et validations, formats enrichis |
| `test` | Absente | Lance les tests TypeScript avec `node:test` et `ts-node` |
| `typecheck` | Absente | Vérification `tsc --noEmit` |
| `check` | Absente | Enchaîne typecheck, lint et tests ; s'arrête à la première étape en échec |
| `history:propose` | Absente | Propose des correspondances historiques ; `--apply` peut modifier la configuration avec sauvegarde |
| `history:export` | Absente | Exporte les classeurs de comparaison actuels en historiques YAML |

## 1. Génération du graphe

Fichiers principaux : `src/generate-component-dependency-graph.ts`,
`src/parser/extractMetadata.ts`, `src/scanner/scanDirectory.ts`,
`src/scanner/fileFilter.ts`, `src/sourceProject.cjs`, `src/graph/graphBuilder.ts`
et `src/output/writeTgf.ts`.

La référence associe les dépendances par noms extraits du texte. Elle ne suit pas
les imports pour vérifier les fichiers réellement ciblés et ne charge pas le
tsconfig du projet analysé pour cette opération. Le premier nœud rencontré sous
un nom donné est conservé ; des composants homonymes peuvent donc être fusionnés.
Les regex peuvent aussi mal identifier des déclarations : par exemple,
`export default function Button()` peut être enregistré sous le nom `function`.

Le moteur actuel résout les fichiers et les réexports avec TypeScript, charge la
configuration du projet analysé, distingue les symboles par fichier et export,
et rend bloquantes certaines erreurs auparavant journalisées. Les composants
isolés sont conservés. Les fichiers de code sous `assets` sont désormais inclus,
alors que la référence exclut ce dossier entier.

Les identifiants `CharacterCard` deviennent par exemple
`characters%2FcharacterCard%2FcharacterCard.jsx#default`. Le TGF reste lisible par
un parseur TGF, mais les identifiants enregistrés dans les sélections et les
métadonnées ne désignent plus les mêmes clés.

Le moteur introduit avait également relié chaque export d'un barrel à tous les
symboles réexportés par ce fichier. Le correctif actuel réduit ce produit
cartésien : chaque réexport ne pointe que vers le symbole qu'il expose. La vue
par défaut ramène les réexports aux implémentations ; `--detailed` conserve les
nœuds de réexport. Ces deux vues écrivent au même chemin configuré.

Ce correctif ne constitue pas un mode de compatibilité avec la référence : la
résolution, les identifiants et les règles d'inclusion restent différents.

Le constructeur historique parcourt récursivement les dépendances sans protection
contre les cycles. Le constructeur actuel utilise un parcours itératif et conserve
les cycles et dépendances partagées. Revenir intégralement au constructeur
historique réintroduirait les risques de dépassement de pile.

## 2. Analyse des versions

La commande reste `node src/analyse-component-versions.js`, mais le traitement
est désormais réparti entre `sourceProject.cjs`, `versionReferences.cjs`,
`publishOutputs.cjs` et les modules `src/reports`.

Changements qui modifient les résultats :

- Les références comparées ne sont plus seulement les tags et develop : les
  branches release et hotfix sont candidates. À version égale, la priorité est
  tag, release, hotfix, puis develop. Certaines ambiguïtés deviennent des erreurs.
- Les sources sont résolues à partir des imports/exports, plutôt que recherchées
  par correspondance approximative de noms de fichiers.
- Les analyses contiennent notamment des identifiants d'exports, `sourceExport`,
  les informations de référence Git et une empreinte de traitement.
- Les rapports regroupent les alias/réexports d'un même symbole source et suivent
  les renommages Git, migrations JS/TS et correspondances historiques configurées.
  Le nombre de lignes d'un rapport n'est donc pas directement comparable à celui
  de l'ancien rapport.
- Les liens Markdown/Excel, le choix des noms et la présentation des historiques
  ont changé. Des correspondances manuelles peuvent être marquées à vérifier.
- Les sorties sont préparées puis publiées avec restauration en cas d'échec,
  plutôt qu'écrites progressivement. Un échec peut ainsi conserver les anciens
  rapports ; il faut consulter le code de sortie et les messages d'erreur.
- Le cache inclut SHA, référence et empreinte. L'empreinte hache notamment tout
  `sourceProject.cjs` : une modification du graphe dans ce fichier peut invalider
  le cache de l'analyse des versions, même si sa sémantique n'a pas changé.
- Une erreur de diff Git n'est plus assimilée à une absence de modification.
  L'échec d'un dépôt produit un code d'échec, tout en permettant de traiter les
  autres dépôts.

La configuration actuelle contient aussi des correspondances historiques absentes
de la référence. Une comparaison de résultats exige donc les mêmes dépôts, les
mêmes SHA et des paramètres métier explicitement alignés, en plus du même code.

## 3. scan-ghe

La comparaison de `src/scan-ghe.js` relève essentiellement :

- simplification d'une regex d'échappement de motifs de bibliothèques ;
- retour explicite `null` après une erreur de parsing yarn.lock ;
- suppression du paramètre inutilisé `isKts` de l'extraction de version Gradle ;
- changement d'un exemple dans un commentaire.

Ces différences ne montrent pas de changement du périmètre de découverte,
des colonnes de rapport ou de la politique de sélection des dépôts. Le scanner
n'utilise pas `sourceProject.cjs` ni le moteur de graphe.

Ce constat est une comparaison statique, pas une validation en ligne de l'API.
Pour expliquer une différence d'inventaire, comparer les paramètres effectifs
`START_ORGS`, `INCLUDE_USER_REPOS`, `SCAN_BRANCH`, les listes d'exclusion et de
bibliothèques, ainsi que les branches/SHA scannés et les droits du compte.
Les valeurs des fichiers `.env` n'ont pas été comparées dans cet audit.

## 4. graph:analyze

`src/commands/analyze-graph.ts` est identique à la référence, mais ses dépendances
ne le sont pas : `TgfParser`, `Graph`, `analyzeGraph` et `GraphQueries` ont changé.

Le parseur historique utilise les labels complets comme clés internes. Le parseur
actuel utilise les identifiants TGF et conserve séparément les labels. Il rejette
les identifiants dupliqués, les arêtes vers des nœuds inconnus et l'absence de
séparateur `#`, alors que la référence pouvait accepter ou ignorer ces cas.

Les exclusions sont maintenant évaluées sur les labels. Le calcul travaille sur
le sous-graphe effectivement retenu. Les cycles sont des groupes fortement
connexes et les niveaux sont calculés sur le graphe de ces groupes. `cycleCount`
compte donc ces groupes, et `cycleGroups` est ajouté au rapport : ce n'est pas le
compte de tous les chemins cycliques possibles.

Les sorties gardent leurs noms sous `reports/<OUTPUT_GRAPHE_DIR>`, notamment
`analysis-report.json`, `components.json`, `orphans.json`, `cycles.json`,
`components.csv` et `dependency-matrix.csv`. En revanche, leurs clés, périmètres
et métriques peuvent changer. Il faut régénérer les métadonnées avec le TGF de
la même vue et de la même exécution.

## 5. graph:required et graph:required-by-name

Les deux commandes utilisent le même moteur de requêtes remanié :

- recherche par nom dans les labels, puis traitement par identifiants ;
- parcours itératifs pour les dépendances transitives et les dépendants ;
- exclusion du nœud de départ de sa propre fermeture transitive ;
- niveaux/profondeurs calculés à partir des groupes cycliques ;
- arbres bornés, avec références pour les nœuds déjà visités et indication de
  troncature ; le code borne notamment les parcours à 128 niveaux et 5 000 entrées ;
- ajout de `cyclicGroups` et `dependencyTreeTruncated` aux rapports.

Le score de complexité dépend de ces résultats : même si sa formule reste la même,
le score peut varier. Il ne s'agit pas d'une estimation de charge en jours.

### Problème confirmé dans graph:required

Le point d'entrée est resté identique. Il produit d'abord un rapport via
`getRequiredComponentsByNameDetailed(componentNames)`, puis appelle séparément
`renderDependencyTrees(componentNames)`. Ce dernier attend des identifiants,
pas des noms à résoudre.

Sur un TGF où A dépend de B et où les identifiants sont `src%2FA.tsx#default` et
`src%2FB.tsx#default`, le rapport retrouve A et B, mais le second arbre affiché
est seulement `A`. Le rapport contient également un arbre avec les identifiants
résolus ; les deux affichages peuvent donc se contredire. Sans métadonnées,
les champs `name` et `path` des composants nécessaires peuvent rester vides.

Autre régression de présentation constatée dans `GraphQueries.renderNode` : les
caractères `└──`, `├──` et `│` de la référence ont été remplacés dans le source
par `???` et `?`. Ces caractères sont effectivement présents dans la sortie
reproduite ; ce n'est pas uniquement un problème d'affichage du terminal.

### Particularités de graph:required-by-name

Les modes `--all` et `--components-file` ont été ajoutés à la liste explicite de
noms. Les doublons sont supprimés et les modes incompatibles sont rejetés.
Le séparateur npm `--` est nécessaire pour transmettre ces options.

La commande charge toujours `reports/<OUTPUT_GRAPHE_DIR>/components.json`.
L'absence du fichier déclenche maintenant un message explicite. Les rapports
JSON/Markdown restent dans `reports/<OUTPUT_GRAPHE_DIR>/required-components` ;
le chemin par défaut du writer était déjà celui-ci dans la référence. Le message
console et l'appel du writer ont été rendus explicites, mais ce dossier n'est
pas une nouvelle destination métier.

La présence du fichier de métadonnées ne garantit pas qu'il corresponde au TGF
fourni. La commande ne vérifie pas une empreinte commune entre les deux fichiers.

## 6. build, typecheck, lint, lint:fix, test et check

`build` passe d'une commande factice à une vérification de types. `typecheck` est
une nouvelle commande ; ni l'une ni l'autre ne produit de dossier compilé.
Le contenu de `tsconfig.json` est identique entre la référence et l'état examiné.

Les commandes ESLint sont textuellement identiques, mais la configuration actuelle
utilise les globals Node, les règles recommandées JS/TS, des exceptions CommonJS
et des exclusions de dossiers générés. Elle n'exclut pas `logs`.

Vérification effectuée pendant cet audit : `npm run typecheck` réussit. ESLint
sur `.` termine en échec avec 38 erreurs et 2 avertissements, tous dans des copies
sous `logs/master-script` et `logs/ecaille-react`. Aucun fichier actif hors de
`logs` n'est signalé par cette exécution. Ces chiffres décrivent les fichiers
présents au moment du contrôle et peuvent évoluer si ces copies changent.

Conséquences :

- `lint` peut échouer après l'ajout d'une copie de référence, sans modification
  des sources actives ;
- `lint:fix` peut modifier ces copies ; cette commande n'a pas été exécutée ;
- `check` s'arrêterait à l'étape lint dans cet état, avant les tests ;
- `test` est nouveau et lance les tests sous `tests`, pas une comparaison avec
  les résultats de référence sous `logs`.

La suite complète n'a pas été relancée pour cet audit de comparaison ; les succès
annoncés lors des corrections précédentes ne valident pas la compatibilité des
résultats historiques ni le périmètre ESLint après ajout des copies.

## 7. Nouveaux scripts d'historique

`history:propose` lit les rapports `*_rapport.json` actuels et produit des
propositions de correspondances ainsi que des diagnostics. Sans `--apply`, la
configuration est conservée. Avec `--apply`, il fusionne les correspondances,
sauvegarde la configuration et marque les nouvelles règles à vérifier. Il ne
faut pas supposer que d'anciens JSON ont le schéma requis.

`history:export` parcourt les rapports `*_component_comparison.xlsx` et produit
des fichiers `<repo>-historique-composants.yaml`. Par défaut, la sortie est placée
à côté du classeur ; `--output-dir` permet une autre destination. Il n'effectue
pas une nouvelle analyse des sources : il dépend du contenu des classeurs lus.

Ces deux scripts partagent notamment le mécanisme de publication des sorties
avec l'analyse des versions. Ils n'existaient pas dans la référence.

## 8. Environnement commun

Le nom npm est passé de `ecaille-tools` à `repo-tools`. Cela change les messages
de lancement npm, pas directement les algorithmes.

Le package actuel déclare Node 22.16+ dans la branche 22 ou Node 24. Il ajoute un
override de `uuid` sous ExcelJS, passe `simple-git` de la branche majeure 3 à 4,
supprime `dagre-d3` et place TypeScript parmi les dépendances de production.
La référence fournit déjà un lockfile ; il ne faut donc pas présenter son
existence comme une nouveauté. Les versions effectivement installées doivent
être comparées via les deux lockfiles pour une recherche de régression de
dépendance précise.

## Priorités proposées

1. Exclure explicitement les copies de référence du lint et protéger ainsi
   `lint:fix` contre leur modification.
2. Corriger le second arbre de `graph:required` et rétablir les caractères de
   dessin des arbres.
3. Définir le contrat attendu de la génération du graphe par rapport à la
   référence : identifiants, filtres, réexports, composants isolés et erreurs.
   Le vérifier par des comparaisons de résultats sur des sources fixes.
4. Séparer le moteur du graphe de l'analyse des versions et son empreinte de
   cache ; conserver un format intermédiaire explicitement versionné si un
   partage reste utile.
5. Associer le TGF et ses métadonnées par une empreinte, pour détecter un mélange
   d'exécutions ou de vues dans les rapports `graph:required-by-name`.
6. Valider séparément la compatibilité des JSON/Excel historiques des versions,
   puis des exports YAML, sans déduire cette compatibilité du seul succès des tests.

Ces recommandations ne sont pas des corrections déjà appliquées. Le seul fichier
ajouté pour cet audit est le présent rapport.
