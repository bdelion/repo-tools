# Audit technique de repo-tools — 23 octobre 2026

## Avis d’architecture

Le besoin métier est pertinent : comprendre les dépendances, comparer les exports
entre versions et préparer une migration de bibliothèque. Le découpage scanner /
parser / graphe / rapports constitue une bonne base. Le modèle `Graph` avec index
direct et inverse et la séparation `GraphQueries` / writers sont des choix utiles.
Les exports JSON facilitent la réutilisation des résultats ; conserver les SHA
des sources dans les inventaires est également une bonne pratique.

Le dépôt reste toutefois un outillage exploratoire. Avant d’utiliser ses rapports
pour dimensionner une migration, il faut garantir l’identité des composants,
la résolution des dépendances et la visibilité des analyses incomplètes. La
priorité est la justesse des données, avant la visualisation ou le découpage en
packages. Une réécriture globale ou des microservices ne sont pas nécessaires.

## Priorités et constats

### P0 — Débordement de pile dans la génération du graphe : corrigé localement

Issue : https://github.com/bdelion/repo-tools/issues/1.

`src/graph/graphBuilder.ts` parcourait récursivement les dépendances sans ensemble
de nœuds visités. `A → B → A` ou `A → A` provoquait une récursion sans fin. Une
chaîne profonde pouvait aussi saturer la pile ; les sous-graphes partagés étaient
retraversés inutilement. `isFilteredNode` apparaît dans la trace mais n’est pas la
cause du défaut.

Le correctif remplace cette récursion par un parcours itératif. Chaque composant
inclus conserve ses liens directs vers les autres composants inclus, y compris
les cycles. Les intermédiaires non inclus sont traversés avec un ensemble visité
propre à chaque source. Les fichiers exclus interrompent le parcours. Les
composants isolés sont conservés et une reconstruction purge les anciens résultats.
Pour un graphe dont tous les nœuds sont inclus, le travail est proportionnel au
nombre de nœuds et d’arêtes. Les intermédiaires peuvent être revisités depuis
plusieurs sources, ce qui évite de perdre les dépendances partagées.

Huit tests de non-régression couvrent cycles, auto-dépendance, diamant, chaîne de
20 000 nœuds, exclusions, composants isolés, intermédiaires cycliques et reconstruction.
Commande : `npm test` (sous PowerShell avec scripts désactivés : `npm.cmd test`).

### P1 — Identité des composants et résolution des imports

- `src/graph/nodeManager.ts` indexe les nœuds par nom d’export, et garde le premier.
  Deux fichiers exportant `Button` sont fusionnés silencieusement. Les objets
  ordinaires posent aussi problème avec des clés comme `constructor` ou `__proto__`.
- `src/parser/extractImports.ts` collecte des noms mais jette le chemin du module.
  Un import par défaut renommé ne peut pas être associé correctement à son export.
  `processFile` attribue tous les imports du fichier à chacun de ses exports :
  le graphe exprime une approximation au niveau fichier, pas l’usage réel de chaque symbole.
- Les regex d’import/export ne couvrent pas correctement la syntaxe JS/TS :
  `export interface Foo {}` peut être interprété comme un export nommé `interface` ;
  réexports, alias et imports de types nécessitent une sémantique explicite.
- `src/analyse-component-versions.js:295` choisit un fichier par basename dans
  tout le dépôt, sans résoudre le chemin relativement au fichier de réexport.
  Deux `index.ts` ou deux composants homonymes peuvent fausser les comparaisons.

Recommandation : identifiant stable `chemin relatif + nom exporté`, stockage en
`Map`, AST et résolution des modules par rapport au fichier appelant. Définir le
traitement des imports externes, des alias TS, des barrels et des dépendances de
types. Commencer par des fixtures à deux composants homonymes et imports renommés.
Réutiliser les briques de parsing existantes plutôt que maintenir deux définitions
incompatibles d’un composant.

### P1 — Des erreurs deviennent des résultats incomplets présentés comme valides

- `scanDirectory` et `processFile` interceptent leurs erreurs et poursuivent ;
  le point d’entrée peut annoncer un fichier généré après un scan raté.
- `src/scan-ghe.js:523` transforme l’échec de pagination de secours en liste vide.
  Un échec après une page peut aussi mélanger résultats partiels et nouvelle pagination.
- `src/scan-ghe.js:608` ignore l’indicateur d’arbre Git tronqué : l’inventaire
  peut manquer des fichiers sans le signaler.
- Les erreurs par repository sont journalisées puis la génération des rapports
  continue, sans statut global explicite d’analyse partielle.

Recommandation : mode strict par défaut, mode partiel explicite, diagnostics
structurés et compteurs de fichiers/dépôts analysés, ignorés et échoués. Distinguer
« aucune dépendance » de « impossible à analyser ». Prévoir une récupération
non récursive des arbres tronqués et une politique claire pour les erreurs API.

### P1 — Versions résolues potentiellement erronées

Dans `src/scan-ghe.js:822` et la boucle de résolution vers la ligne 1150 : npm
cherche uniquement `node_modules/<nom>` au niveau racine ; Yarn prend la première
entrée commençant par le nom ; pnpm prend une première clé de package sans
consulter l’importer du workspace. Plusieurs versions d’une même dépendance
peuvent donc produire une mauvaise attribution ou une absence de résolution.
Les catégories dependencies/dev/peer/optional sont fusionnées, perdant leur nature.

Recommandation : résolution par package consommateur et intervalle, fixtures de
lockfiles réellement supportés, conservation de la catégorie. Signaler les formats
inconnus et les ambiguïtés plutôt que choisir arbitrairement une version.

### P1 — Installation et vérification non reproductibles

Le README prescrit `npm ci`, mais aucun lockfile n’est versionné. `build` exécute
uniquement un echo. Le Jenkinsfile ajoute le lint mais ne déclare pas de tests
ni de vérification TypeScript dans ce dépôt ; le comportement de la bibliothèque
Jenkins externe n’a pas été audité.

Recommandation : versionner un lockfile, déclarer les versions d’exécution prises
en charge dans `engines`, et définir une chaîne `npm ci → typecheck → lint → test`.
Le mélange CommonJS / ESM dans les fichiers `.js` repose actuellement sur un
comportement implicite du runtime : rendre les formats explicites et cohérents
avec TypeScript. Vérifier les scripts sur chaque version Node annoncée.

### P2 — Sémantique et coût des algorithmes du graphe

- Le correctif de génération ne rend pas tous les autres parcours itératifs :
  `GraphQueries` et `analyzeGraph` restent exposés aux chaînes très profondes.
- `getTransitiveDependencies(A)` peut inclure `A` dans un cycle, gonflant le
  décompte de dépendances si l’on attend une fermeture excluant le point de départ.
- `computeLevel` coupe un cycle en retournant zéro puis met en cache des niveaux
  dépendant du parcours. Ces niveaux ne constituent pas un ordre de migration valide.
- `cycleCount` compte les cycles rencontrés par la DFS, pas tous les cycles simples.
- `buildTree` duplique les chemins partagés, avec un volume potentiellement très
  important ; la matrice CSV impose un espace quadratique même pour un graphe creux.
- Avec `componentsOnly`, la liste analysée est filtrée mais les totaux viennent
  du graphe complet ; les métriques ne décrivent donc pas nécessairement le même périmètre.

Recommandation : composantes fortement connexes puis niveaux sur le graphe
condensé ; présenter un cycle comme un groupe à traiter ensemble. Définir les
métriques dans la documentation, borner l’arbre affiché et rendre la matrice
optionnelle. Le score de complexité est une heuristique : il ne suffit pas à
estimer une charge sans calibration avec des migrations réelles.

### P2 — Cache et configuration

`src/analyse-component-versions.js:1019` ne met pas la configuration ni la version
de l’analyseur dans la clé du cache. Changer les exclusions peut laisser des
résultats périmés. `sanitizeResult` exclut toujours `exportAll` et `default`,
même lorsque la configuration autorise ces exports. Les options CLI placées dans
les valeurs par défaut peuvent être écrasées par le JSON, malgré le commentaire
annonçant la priorité de la CLI. `Boolean('false')` active `debug`.

Les chemins de `src/config.ts` imposent de modifier les sources pour chaque scan.
Les rapports de composants requis dépendent d’un `components.json` préexistant,
sans vérifier qu’il correspond au graphe fourni. Le writer TGF ne crée pas son
répertoire parent. `prepareRepo` effectue un `reset --hard` sur un clone existant :
réserver ce comportement aux clones temporaires dont l’outil vérifie la propriété.

Recommandation : configuration validée, priorité défauts < fichier < environnement
< CLI, fingerprint des paramètres et du parseur dans les caches, SHA du graphe
dans les rapports liés. Passer chemins et options aux fonctions au lieu d’importer
une configuration globale dans le métier.

## Forme et maintenabilité

La séparation en modules est encourageante, mais les scripts de comparaison et
de scan dépassent respectivement 1 100 et 1 500 lignes. Extraire progressivement
adaptateurs Git/GitHub, parseurs, comparaison et writers, avec fonctions pures et
modèles communs. Le script Python autonome est raisonnable ; documenter sa version
minimale et le contrat JSON évitera un portage sans bénéfice métier.

Réduire les logs de débogage permanents (`extractImports`, analyse develop), les
commentaires qui paraphrasent le code, les blocs de configuration générés inutiles
et les retours à la ligne excessifs dans `GraphQueries`. Supprimer les doublons de
types et remplacer les `any` ciblés. ESLint déclare des globals navigateur pour
des CLI Node : définir des contextes par type de fichier. Ne pas désactiver en
bloc les règles pour obtenir artificiellement un pipeline vert.

La documentation promet `npm start`, D3, GraphML et des options qui n’existent pas
dans les points d’entrée actuels. Le README utilise `analyse-components`, absent
de `package.json`, et montre encore `analyse-exports.js`. Distinguer les fonctions
disponibles des idées futures, choisir une langue principale, remplacer les
placeholders du changelog et aligner les chemins de rapports documentés.
Les fichiers ont été lus en UTF-8 ; l’affichage erroné initial de PowerShell ne
constitue pas une preuve de corruption de leur encodage.

Les sorties CSV doivent échapper les guillemets et séparateurs, notamment pour
la matrice. Le parser TGF devrait valider doublons, séparateur et références
inconnues au lieu de perdre silencieusement des arêtes ; conserver l’ID comme
identité et le label comme métadonnée évite de fusionner des labels identiques.

## Séquence proposée

1. Livrer le correctif #1 et les tests associés.
2. Rétablir une installation reproductible et une chaîne de vérification réelle.
3. Corriger identité/résolution des composants et fiabiliser les diagnostics.
4. Fiabiliser les lockfiles et les caches avec fixtures représentatives.
5. Définir niveaux/cycles/métriques puis simplifier CLI, configuration et documentation.
6. Améliorer les visualisations une fois la fiabilité des données établie.

## Périmètre de l’audit

Vérifications exécutées sous Node 22.23.3 :

- Reproduction sur le code de `HEAD` : un cycle `A → B → A` déclenche bien
  `RangeError: Maximum call stack size exceeded`.
- `npm.cmd test` : 8 tests réussis, dont une chaîne de 20 000 nœuds.
- `node node_modules/typescript/bin/tsc --noEmit` : réussi.
- ESLint sur `graphBuilder.ts` et le fichier de tests : réussi.
- ESLint global : 88 erreurs et 1 avertissement dans les sources existantes.
- `git diff --check` : réussi.

Les dépendances ont été installées sans exécuter leurs scripts et sans créer de
lockfile, afin de ne pas mélanger le correctif avec une évolution des dépendances.
La génération et l’analyse complètes sur les dépôts métier restent à rejouer
dans l’environnement disposant de ces sources. La chaîne de 20 000 nœuds valide
le constructeur du graphe, pas les parcours récursifs de l’analyseur aval.

Lecture des sources versionnées, configurations, points d’entrée et documentation.
Aucun scan de l’instance GitHub Enterprise, clonage des dépôts métier ni appel à
Jenkins/Sonar n’a été effectué. Les constats de logique sont issus du code ; les
résultats d’exécution des vérifications locales sont rapportés séparément dans
le retour de livraison. Aucun engagement sur des vulnérabilités de dépendances
n’est déduit de cette revue.
