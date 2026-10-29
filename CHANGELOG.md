# Changelog

> NOTE : Le format est basé sur [Keep a Changelog], et ce projet adhère à [Semantic Versioning].

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

## [Unreleased]
### Added

- Lockfile et chaîne `typecheck → lint → test` en CI ; correction des dépendances
  critiques et suppression de dagre-d3 inutilisé.
- Analyse des branches `release/<version>` et `hotfix/<version>` avec validation
  de `package.json`, tri SemVer et priorité tag > release > hotfix > develop (#2).
- Sélection de tous les composants avec `graph:required-by-name --all` ou d’une liste texte UTF-8 avec `--components-file <chemin>`.
- xxx
- xxx

### Changed

- Résolution AST/TypeScript partagée, identifiants par chemin/export et séparation
  des rapports de versions ; invalidation du cache par configuration et analyseur.
- Niveaux sur les composantes fortement connexes, cycles explicites, fermetures
  transitives itératives et arbres de détail bornés.
- Transmission de snapshots de version unifiés aux comparaisons et rapports,
  sans tables parallèles de libellés, résultats et références Git.
- xxx

### Fixed

- Liens des rapports de comparaison entre deux versions vers la référence cible
  (`tag2`) et ses chemins, sans lien lorsque le fichier n’y existe plus (#10).
- Historique conservé lors des migrations `.js`/`.jsx` vers `.ts`/`.tsx` au même
  chemin sans extension et pour le même symbole source, même sans renommage Git.
  Le rapport signale `typescriptMigration` et garde les changements de contenu visibles.
- Suivi des sources déplacées exportées à la fois directement et via des barrels :
  les déplacements Git des exports et les noms inchangés départagent les historiques,
  sans fusionner les alias ni résoudre arbitrairement les véritables ambiguïtés.
- Liens Markdown/Excel vers la référence nommée de plus haute version où le fichier
  existe encore, avec repli sur le dernier tag en cas de suppression (#7).
- Tri naturel des rapports sur le nom affiché des composants, en conservant les homonymes (#8).
- Historique commun pour les déplacements et renommages non ambigus, avec anciens
  noms/chemins et motif du rapprochement ; les cas ambigus restent séparés (#9).
- Prise en charge des branches hotfix descriptives via leur version package.json,
  avec erreur explicite si plusieurs hotfix se disputent une version (#5).
- Sélection du mode JSX selon l’extension : les assertions TypeScript dans un
  fichier `.ts` ne provoquent plus de faux « Unterminated JSX contents » (#6).
- Les erreurs de résolution locale, parsing et diff Git interrompent le dépôt
  concerné ; les exports homonymes et labels TGF identiques restent distincts.
- Préparation de toutes les sorties avant publication et restauration des fichiers
  et caches précédents en cas d’échec intercepté ; purge des sorties obsolètes
  différée jusqu’à la publication.
- Nettoyage des analyses, comparaisons et caches obsolètes lors des transitions
  de versions ou suppressions de branches candidates ; liens et diffs basés sur les SHA (#2).
- Correction du débordement de pile lors de la génération du graphe contenant des dépendances cycliques (#1) : parcours itératif et tests de non-régression.

## [1.0.0] - aaaa-mm-jj

### Added

- xxx
- xxx
- xxx
### Changed

- xxx

### Fixed

- xxx

<!-- liens -->
[Keep a Changelog]: https://keepachangelog.com/fr/1.0.0/ "CHANGELOG Template et bonnes pratiques"
[Semantic Versioning]: https://semver.org/lang/fr/ "Bonnes pratique de la Gestion de Version"
[Unreleased]: https://github.enterprise.io/bertrand-delion/repo-tools/compare/1.0.0...develop 'Comparaison de la dernière version avec la future'
[1.0.0]: https://github.enterprise.io/bertrand-delion/repo-tools/tree/1.0.0
