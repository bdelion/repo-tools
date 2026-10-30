# Fiabilité, formats et validation

## Identité des composants et résolution

L’identifiant TGF est `encodeURIComponent(chemin relatif)#nomExporté`. Le label
conserve le nom lisible et le chemin. Deux fichiers exportant `Button` restent
distincts. Un export par défaut a l’identité `#default` et le nom de sa déclaration
comme label lorsqu’il existe.

Le scanner analyse l’AST ESM des fichiers JS/JSX/TS/TSX. Le résolveur TypeScript
prend en compte les chemins relatifs, les alias `baseUrl`/`paths`, les imports
renommés et les réexports/barrels. Les imports de types, assets et dépendances de
packages externes ne deviennent pas des dépendances entre composants locaux.
Les réexports ambigus, imports locaux introuvables et syntaxes invalides font
échouer le scan avant de remplacer le graphe en mémoire.

La granularité reste conservative : chaque export d’un fichier dépend des imports
runtime du fichier entier. Ce n’est pas une analyse d’usage de chaque symbole.
Les exports CommonJS et les imports calculés dynamiquement ne sont pas inventoriés.
Les liens symboliques de répertoires ne sont pas suivis pendant le scan.
Le mode du parseur suit l’extension : TypeScript sans JSX pour `.ts`/`.cts`/`.mts`,
TypeScript avec JSX pour `.tsx`, et JavaScript avec JSX pour `.js`/`.jsx`.
Les assertions `<Type>valeur` restent donc valides dans un fichier `.ts` sans
être interprétées comme des balises JSX. Une véritable erreur de syntaxe reste bloquante.
Une dépendance locale en dehors de la racine d’origine configurée est rejetée
explicitement ; élargir cette racine pour analyser plusieurs packages locaux.

Dans les JSON d’analyse, les exports sont identifiés par le fichier d’export et
le nom exporté. Les rapports regroupent ces exports par fichier source et symbole
source : un symbole exposé par plusieurs barrels ou sous plusieurs noms garde
une seule ligne, avec tous ses noms publics et fichiers d’export. Les homonymes
issus de sources ou symboles différents restent distincts.
Le fichier source est résolu relativement au fichier de réexport,
avec le même résolveur ; il n’y a plus de rapprochement par basename.
Pour suivre un renommage entre versions consécutives, le rapport rapproche les
identités uniquement sur une correspondance unique : déplacement Git, même symbole
source (`sourceExport`), ou contenu source strictement identique. Les empreintes
portant sur le fichier entier, deux symboles source connus et différents ne sont
pas fusionnés automatiquement, sauf le passage default → nommé lors d’une migration
TS au même chemin avec le même nom public. Les cas ambigus restent ajoutés/supprimés ; aucune similarité de noms
ne suffit. Les analyses gardent leurs identifiants d’origine. Le rapport indique
les anciens noms/chemins et le motif du rapprochement.
Les exports directs et leurs alias sont regroupés avant le rapprochement historique.
La disparition d’un seul barrel ne supprime pas le symbole s’il est encore exposé
ailleurs. Les modifications de noms publics et de fichiers d’export restent signalées.
Une migration `.js`/`.jsx` vers `.ts`/`.tsx` est également reconnue lorsque le
chemin sans extension et le symbole source restent identiques, avec une correspondance
unique dans les deux sens. Cette règle ne dépend ni d’un contenu identique ni d’un
renommage Git. Les variantes ambiguës (`Button.ts` et `Button.tsx`), les symboles
différents et les déplacements vers un autre répertoire ne sont pas rapprochés
par cette seule règle. `typescriptMigration` apparaît dans les motifs de modification ;
les différences de contenu restent signalées et les exports d’origine restent listés.
Les refontes sans preuve automatique peuvent être reliées par une correspondance
configurée, limitée à une paire de versions et marquée `⚠️ À vérifier` par défaut.
Voir [les règles de regroupement, noms métier et revue](report-component-history.md).
Les liens des rapports globaux utilisent la référence nommée de plus haute version analysée si le fichier
y existe encore, sinon le dernier tag analysé où il existe (ou, sans tag, la dernière
candidate connue). Cette vérification utilise les arbres Git et s’applique séparément
au fichier d’export et à sa source. Le tri porte sur le nom affiché, en ordre naturel.
Dans les rapports de comparaison entre deux versions, tous les liens pointent vers
la référence cible (`tag2`), avec les chemins de la comparaison. Un fichier absent
de la cible reste affiché sans lien, notamment pour les composants supprimés.
`includeExportAll` active l’expansion de `export *`, sans exporter `default`.
Les SVG déclarés dans `validAssetExtensions` restent inventoriés dans l’analyse
des versions lorsqu’ils sont réexportés par chemin relatif ; leur contenu est
comparé par hash et diff Git, sans parsing AST du XML. Ils restent hors du graphe
de composants runtime.

## Migration des rapports

Régénérer le TGF, puis lancer `graph:analyze` avant `graph:required-by-name`.
Les anciens TGF restent lisibles mais leurs identifiants sont désormais conservés
indépendamment des labels. Les métadonnées calculées avec l’ancien parseur doivent
être régénérées. La sélection par nom lisible reste disponible et sélectionne
tous les composants homonymes ; les rapports gardent leurs identités distinctes.
Les TGF aux identifiants dupliqués, sans séparateur ou avec des arêtes vers des
nœuds inconnus sont rejetés.

## Cycles, niveaux et profondeur

Les niveaux sont calculés itérativement sur le graphe condensé des **composantes
fortement connexes**. Un groupe sans dépendance vers un autre groupe a le niveau
0 ; les autres ont le maximum des niveaux de leurs dépendances, plus 1.
Tous les membres d’un cycle ont le même niveau : ils doivent être migrés ensemble
ou leur cycle doit être rompu.

`cycleCount` compte les groupes cycliques, pas les chemins rencontrés par une DFS.
`cycleGroups`, `cyclicGroups` et `cycles.json` contiennent leurs membres. Une
auto-dépendance constitue aussi un groupe cyclique. Les métriques de
`componentsOnly` portent toutes sur le même sous-graphe induit.

La profondeur compte les transitions entre groupes, sans augmenter pour les
arêtes internes à un cycle. La fermeture transitive exclut le point de départ,
même si un cycle le rejoint.

Les arbres de détail utilisent des références pour les répétitions. Ils sont
bornés à 128 niveaux et 5 000 entrées par arbre rendu. Les marqueurs `$ref`,
`$truncated`, `[reference]`, `[truncated]` et le champ `dependencyTreeTruncated`
rendent ces limites explicites. Les ensembles requis et les métriques portent
sur le graphe complet indépendamment de la limite d’affichage. Le score de
complexité reste une heuristique, pas une estimation de charge calibrée.

## Erreurs, caches et architecture

Un échec de parsing, de lecture de source ou de `git diff` fait échouer le dépôt
concerné sans publier ses sorties préparées. Un échec de diff n’est plus assimilé
à « aucun changement ».

Le cache associe SHA, libellé et fingerprint. Ce dernier couvre les paramètres
d’analyse, le code de l’analyseur/résolveur et les versions Babel/TypeScript.
Il est stocké dans le JSON d’analyse. Un changement de configuration invalide
donc le cache même si le commit Git n’a pas changé. Les chemins de sortie et
paramètres d’affichage n’en font pas partie. Les anciens caches sont recalculés.

Les responsabilités sont séparées : orchestration dans
`analyse-component-versions.js`, syntaxe/résolution dans `sourceProject.cjs`,
rapports dans `reports/versionReports.cjs`, publication dans `publishOutputs.cjs`.

## Installation et sécurité

Node 22.16+ ou 24 est requis. Le lockfile est versionné. `npm ci --ignore-scripts`
installe les versions verrouillées sans lancer de scripts d’installation.
`npm run check` exécute typecheck, lint global et tests ; `build` n’est plus un echo.
Les workflows ciblent Node 22/24 et Jenkins utilise la même validation.

L’audit du 29 octobre 2026 a identifié deux alertes critiques sur simple-git,
une alerte haute via dagre-d3 et une modérée via ExcelJS/uuid.

- simple-git est mis à jour en 4.0.2 avec son import CommonJS nommé :
  [GHSA-x6jw-m9v5-85vh](https://github.com/advisories/GHSA-x6jw-m9v5-85vh),
  [GHSA-v5rq-49vh-5v5c](https://github.com/advisories/GHSA-v5rq-49vh-5v5c).
- dagre-d3, inutilisé dans les sources, est supprimé.
- L’override `exceljs → uuid ^11.1.1` couvre
  [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
  ExcelJS utilise `v4()` ; la compatibilité d’écriture des rapports est vérifiée
  par le cycle d’intégration Git et les cas d’échec de publication.

Après correction, npm audit ne signale aucune vulnérabilité connue. GitHub Actions
exécute également `npm audit --audit-level=high`. Les avis peuvent évoluer : le
résultat local ne garantit pas l’absence de vulnérabilités futures. La matrice
distante Node 22/24 et la bibliothèque Jenkins sont à exécuter dans leurs
environnements ; les vérifications locales utilisent Node 22.
