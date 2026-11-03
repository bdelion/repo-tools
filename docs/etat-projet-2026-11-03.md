# État du projet et priorités de consolidation — 3 novembre 2026

## Périmètre et niveau de confiance

Les commandes npm, leurs principaux points d'entrée et dépendances ont été
comparés à `logs/master-script`. Le graphe et l'analyse des versions ont fait
l'objet de tests lors des évolutions précédentes. Cela ne constitue pas une
validation exhaustive de chaque option ni de chaque environnement distant.

Pour ce contrôle complémentaire, `scan-ghe.js`, `generate_deps_report.py`, leur
guide, les configurations de validation et les sources actives ont été examinés.
Les fichiers `.env` n'ont pas été lus. Aucun scan n'a été lancé sur GitHub réel.
Les essais du scanner utilisent un serveur HTTP local et un jeton fictif.

## scan-ghe : fonctionnel sur un cas nominal, fiabilité à renforcer

Le diff avec la référence montre des nettoyages mineurs ; le scanner ne dépend
ni du moteur des graphes ni du moteur de comparaison des composants.

Contrôles effectués :

- `node --check src/scan-ghe.js` réussit.
- Simulation d'une organisation, d'un dépôt sur `main`, d'un package npm avec
  React et d'un package-lock v3 : le script termine avec le code 0, produit deux
  enregistrements de projet et une dépendance React déclarée `^18.2.0`, résolue
  `18.2.0`, avec SHA et branche attendus.
- Le classeur généré est relu avec ExcelJS : les feuilles Projects et
  Dependencies contiennent les lignes attendues.

Problèmes reproduits :

1. **Branche vide.** `SCAN_BRANCH=""` ne déclenche pas le repli sur la branche par
   défaut. La variable est lue sans normalisation, puis utilisée avec `??`.
   L'appel de branche devient invalide et le dépôt peut être ignoré. L'essai
   termine avec le code 0 et des JSON/Excel vides. La documentation recommande
   pourtant cette valeur vide.
2. **Erreur d'accès masquée.** Une réponse 403 pendant la découverte des dépôts
   peut être absorbée par le mécanisme de pagination. L'essai termine avec le
   code 0 et une liste vide. Un avertissement peut être émis, mais l'automatisation
   ne peut pas distinguer ce cas d'un inventaire réellement vide par le seul
   code de sortie.

Ces deux comportements existent déjà dans `master-script` : ce sont des défauts
préexistants, pas des conséquences démontrées des nouvelles vues de composants.

Les erreurs de scan par dépôt sont aussi journalisées sans faire échouer
systématiquement le traitement global. Les exports JSON sont écrits directement,
puis l'Excel : la publication n'est pas atomique sur l'ensemble des fichiers.

Restent à valider : authentification réelle, droits, pagination multi-pages,
limitations API, Code Search, préfiltrage tree, workspaces, Maven et Gradle sur
un jeu de cas représentatif. Le cas npm local ne garantit pas ces parcours.

## generate_deps_report.py : inchangé, exécution non validée ici

Le fichier est identique à celui de `master-script`. Il utilise la bibliothèque
standard Python et attend les champs émis par le scanner : org, repo,
package_path, package_name, dependency, declared_range, resolved_version,
lock_source et default_branch, notamment. Aucun changement de schéma incompatible
entre ces deux fichiers n'a été identifié lors de cette lecture.

L'exécution Python n'a pas pu être vérifiée : les commandes Python trouvées dans
cet environnement sont des alias WindowsApps non exécutables ; aucun lanceur
`py` n'a été trouvé. Ce constat ne prouve pas l'absence de Python sur d'autres
machines ni un défaut du script.

La lecture du code révèle un risque distinct : une erreur JSON peut être
journalisée puis convertir l'entrée en liste vide. `main` peut ensuite produire
un rapport vide avec un message de succès. Ce parcours n'a pas été exécuté ici.
Les erreurs JSONL peuvent aussi conduire à ignorer des lignes.

Le rapport devrait distinguer absence de résultats, filtres sans correspondance
et données invalides. Les options numériques et noms de sections méritent des
tests de validation. Le script Python ne fait pas partie des tests lancés par
`npm run check` ni des étapes Python dédiées de la CI actuelle.

## Documentation : corrections nécessaires avant une refonte générale

- `docs/scan-ghe.md` recommande `npm init -y` et des installations ponctuelles
  alors que le dépôt possède un package.json et un lockfile : documenter `npm ci`.
- Plusieurs exemples appellent `python generate_deps_report.py` depuis la racine,
  alors que le script est sous `src`.
- Des blocs présentés comme des fichiers `.env` contiennent `unset` et des
  instructions shell : séparer configuration dotenv, Bash et PowerShell.
- La valeur vide de SCAN_BRANCH est documentée comme un défaut de branche alors
  que l'implémentation ne respecte pas ce contrat.
- Le guide historique du graphe contient encore `npm start`, absent des scripts
  npm, et des parcours D3/GraphML historiques. Un encadré de renvoi vers le nouveau
  guide ne suffit pas à supprimer cette ambiguïté.
- Les guides doivent distinguer clairement catalogue public, dépendances,
  inventaire GitHub et historique de versions, avec entrées/sorties et exemples
  exécutables pour chaque parcours.

## Code, structure et validation

- Deux moteurs du graphe coexistent : le moteur historique de `--detailed` et
  celui des vues publiques/dépendances. Leur compatibilité doit être explicitée
  et couverte par des cas d'usage avant de supprimer ou fusionner quoi que ce soit.
- L'ancien `sourceProject.cjs` reste utilisé par les versions et contient encore
  le constructeur historique du graphe. Son empreinte de cache hache le fichier
  entier. Une séparation physique reste à envisager pour les anciens parcours.
- `graph:required` et `graph:required-by-name` gardent des responsabilités proches.
  L'interface destinée aux utilisateurs doit être unifiée progressivement avec
  compatibilité des commandes existantes.
- Les caractères de dessin de l'ancien arbre dans GraphQueries sont encore
  remplacés par `???`/`?` dans le source.
- Le lint exclut désormais `logs`, mais TypeScript ne le fait pas : la lecture
  de la configuration trouve **48 fichiers sous logs sur 91 fichiers TypeScript**
  au moment de ce contrôle. Des modifications des références peuvent donc
  perturber la validation du code actif.
- Jenkinsfile déclare deux fois `Stage nodeLintStage` dans le même bloc et insère
  deux étapes proches. Corriger et vérifier ce pipeline dans son environnement ;
  la bibliothèque Jenkins externe n'a pas été exécutée ici.
- Aucun usage direct de madge, dagre, d3, graphlib ou ast-types n'a été trouvé
  dans les sources actives recherchées. Certaines bibliothèques peuvent servir
  à des commandes documentées : auditer les dépendances avant de les retirer.
- Les 66 tests Node réussis lors de la dernière évolution ne constituent ni un
  test Python, ni une validation de GHES réel, ni une preuve d'équivalence avec
  tous les résultats historiques.

## Ordre de travail recommandé

1. **Fiabilité des inventaires** : normaliser SCAN_BRANCH ; distinguer scan vide,
   incomplet et échoué ; produire un bilan d'erreurs et un code de sortie fiable.
2. **Tests de contrats** : automatiser la simulation API, couvrir npm/workspaces/
   Maven/Gradle et tester le chemin JSON du scanner vers le rapport Python sur
   un interpréteur installé. Inclure les entrées invalides et les filtres.
3. **Validation du dépôt** : exclure les références du typage, clarifier Jenkins
   et ajouter une validation Python distincte dans la CI.
4. **Documentation opérationnelle** : corriger les exemples et publier un seul
   parcours de référence par usage avec ses fichiers et ses options.
5. **Refonte progressive** : découper le scanner en accès API, extraction,
   filtrage et exports ; isoler les moteurs graphes/versions ; versionner les
   schémas et retirer les doublons seulement après validation de compatibilité.
6. **Ménage** : auditer les dépendances et les anciens fichiers/documents ; archiver
   les références comme fixtures plutôt que supprimer sans preuve d'inutilité.

Il ne faut pas commencer par une réécriture globale : les contrats et les tests
doivent précéder les changements de résultats. Ce contrôle n'applique pas ces
corrections ; seul le présent rapport est ajouté aux travaux précédents.
