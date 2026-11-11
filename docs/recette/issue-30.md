# Issue #30 — distinguer vide, erreur et scan partiel

Configuration prête : `config/validation/issue-30.json`. Rien à modifier.
Les erreurs sont simulées localement ; aucun vrai accès n'est utilisé.

Depuis la racine :

```powershell
npm.cmd run validate:issue-30
```

Ouvrir `reports/validation/issue-30/recette-resultat.md`.

| Scénario / sous-dossier | Résultat attendu du scanner |
| --- | --- |
| nominal | Code 0 ; deux dépôts avec dépendances. |
| vide-legitime | Code 0 ; aucun dépôt avec dépendances, sans erreur d'accès. |
| filtre-sans-resultat | Code 0 ; aucune dépendance correspondant au filtre. |
| acces-401, acces-403, acces-404 | Code non nul ; les anciens rapports complets restent inchangés. |
| limitation-429, serveur-500 | Code non nul et fin bornée ; mêmes garanties de conservation. |
| partiel | Un dépôt lisible, un refusé : code non nul ; les anciens rapports restent inchangés. |

Dans chaque sous-dossier, `terminal.txt` contient les messages et `api-calls.json`
les appels simulés. `dependencies.json` et `scan.xlsx` sont les sorties observées.
Pour les cas d'erreur, le kit crée d'abord un rapport complet témoin puis compare
les deux fichiers octet par octet après le scan. Ce témoin décrit le dépôt
`previous-complete` avec React 17.0.2, branche main et SHA contenant 40 `c`.

Le kit propose un contrat concret pour le bilan machine : fichier
`scan-summary.json`, champ texte `status` et compteurs entiers `discovered`,
`scanned`, `ignored`, `failed`. Ce fichier est une **sortie attendue à développer**,
pas un fichier de configuration à créer manuellement. Si le développeur retient
un autre schéma, adapter ce contrat explicitement avec le référent avant recette.
Ce contrôle vérifie la présence et la structure ; les valeurs de tous les
compteurs restent à couvrir par les tests de la correction.

Des FAIL sont attendus tant que le scanner absorbe les erreurs ou remplace les
rapports. Joindre le rapport et les terminaux des cas échoués à #30 ; ne pas
considérer un fichier vide comme un résultat métier valide.
