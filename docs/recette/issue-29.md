# Issue #29 — quelle branche est réellement scannée ?

Configuration prête : `config/validation/issue-29.json`. Rien à modifier.
Le kit utilise `examples/validation-scan/repositories.json` et un serveur local.
Aucun accès GHES, token personnel ou `.env` n'est nécessaire.

Depuis la racine du dépôt :

```powershell
npm.cmd run validate:issue-29
```

Ouvrir `reports/validation/issue-29/recette-resultat.md`.

| Sous-dossier | Réglage SCAN_BRANCH | Branche attendue | React attendu |
| --- | --- | --- | --- |
| `absente/` | Variable supprimée | main | 18.2.0 |
| `vide/` | Chaîne vide | main | 18.2.0 |
| `espaces/` | Trois espaces | main | 18.2.0 |
| `explicite/` | release-test | release-test | 19.0.0 |

Chaque dossier contient `dependencies.json`, `projects.json`, `scan.xlsx`,
`terminal.txt` et `api-calls.json`. Ouvrir la feuille **Dependencies** de l'Excel :
la ligne React doit avoir les mêmes branche, version et SHA que le JSON.
Le SHA fictif de main contient 40 `a`, celui de release-test 40 `b`.

Le défaut connu peut donner FAIL pour les valeurs vide et espaces : le rapport
explique l'écart. Ne pas remplacer ces valeurs par main pour faire passer le test.
Après correction du scanner, relancer la même commande et attendre tous les
contrôles PASS. Le kit vérifie le comportement ; il ne corrige pas le scanner.
