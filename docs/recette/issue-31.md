# Issue #31 — scanner des projets dont le contenu est connu

Configuration prête : `config/validation/issue-31.json`. Données :
`examples/validation-scan/repositories.json`. Aucun réglage personnel à fournir.

Depuis la racine :

```powershell
npm.cmd run validate:issue-31
```

Ouvrir `reports/validation/issue-31/recette-resultat.md` puis les sous-dossiers.

| Sous-dossier | Attendu |
| --- | --- |
| npm-lock | React déclaré ^18.2.0, résolu 18.2.0. |
| workspace | Deux packages, dépendances React et lodash. |
| maven | Projet org.validation:demo ; dépendance org.slf4j:slf4j-api attendue. |
| gradle | Dépendance org.slf4j:slf4j-api résolue 2.0.9. |
| pagination | Deux pages API effectivement lues ; npm et workspace présents. |
| filtre-react | Uniquement React dans les dépendances. |
| exclusion-dossier | packages/utils ignoré : lodash absent. |
| exclusion-fork | Le fork n'est pas scanné : seul npm contribue. |

Dans chaque dossier, comparer `dependencies.json` et la feuille **Dependencies**
de `scan.xlsx` : mêmes lignes, versions, branches et SHA. `projects.json` décrit
les projets trouvés. Le kit compare automatiquement les dépendances des deux
formats et les noms attendus ; les appels sont dans `api-calls.json`.

Le code actuel peut détecter le projet Maven sans extraire ses dépendances : le
kit affiche alors FAIL, ce qui révèle une limite de la promesse du scanner.
Le développement de cette extraction ou la réduction explicite du périmètre
doit être décidé dans l'issue, sans supprimer silencieusement l'attendu.

La recette complète reste BLOCKED pour les contrats non encore livrés :
préfiltrages tree/code, lockfiles Yarn/pnpm et intégration des tests scanner à
`npm test`. Pour tester les erreurs, exécuter aussi le kit #30. Ces éléments
restants sont du travail développeur, pas des configurations à deviner.
