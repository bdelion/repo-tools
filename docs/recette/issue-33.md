# Issue #33 — vérifier le périmètre des contrôles et Jenkins

Configuration fournie : `config/validation/issue-33.json`. Aucun fichier à remplir
pour le diagnostic local. Depuis la racine :

```powershell
npm.cmd run validate:issue-33
```

Ouvrir `reports/validation/issue-33/recette-resultat.md`.

| Preuve | Attendu |
| --- | --- |
| typescript-files.txt | Des fichiers src/ et tests/ ; aucun fichier logs/. |
| Jenkinsfile, contrôle dans le rapport | Aucun nom de variable Stage déclaré deux fois ; une validation Python identifiable. |
| tests.txt | Tests de résolution des sources et de publication réussis. |

Le kit lit le vrai tsconfig et Jenkinsfile. Il ne les corrige pas et n'injecte
aucune erreur dans tes sources ou tes références. Les défauts déjà présents
apparaissent comme FAIL.

Le contrôle textuel de Jenkins ne prouve pas l'exécution du pipeline. Pour finir
le ticket, le responsable CI doit fournir les liens des exécutions Jenkins,
Node 22, Node 24 et Python à #33. Cette partie reste explicitement BLOCKED dans
le kit local. Les essais d'erreurs volontaires prévus par l'issue restent à
réaliser dans une copie jetable, après correction du périmètre des contrôles.
