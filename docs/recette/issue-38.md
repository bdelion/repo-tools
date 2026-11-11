# Issue #38 — suivre toutes les validations

Configuration prête : `config/validation/issue-38.json` donne les issues à rejouer.
Depuis la racine :

```powershell
npm.cmd run validate:issue-38
```

Cette commande fait la même chose que `npm.cmd run validate:all` : elle exécute
successivement #28 à #37 et continue après les échecs. Prévoir plusieurs minutes.
Elle ne lance pas l'option d'installation propre de #37.

Ouvrir dans cet ordre :

1. `reports/validation/index.md` : une ligne par issue avec statut et lien.
2. `reports/validation/issue-38/recette-resultat.md` : résultat agrégé.
3. Le rapport de chaque issue FAIL ou BLOCKED : attendu, observé et preuve.

Le résultat global est FAIL s'il reste un écart, sinon BLOCKED s'il manque un
prérequis ou une décision humaine, sinon PASS. Le code de retour vaut 1, 2 ou 0
respectivement. Le bilan peut contenir beaucoup de PASS sans que les tickets
soient terminés.

Pour agir progressivement, prendre la première issue en échec, joindre sa
preuve au développeur, puis relancer uniquement sa commande après correction.
Lancer ensuite `npm.cmd run validate:status` pour actualiser l'index avec les
derniers rapports, sans rejouer tous les tests. Les dates des preuves sont affichées.
Les prérequis métier, Python, Jenkins et GHES sont expliqués dans les guides
individuels de [l'index](README.md). Aucune issue n'est fermée automatiquement.
