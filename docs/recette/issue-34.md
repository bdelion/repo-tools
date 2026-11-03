# Issue #34 — comparer les rapports issus du vrai GHES

Ce kit **ne lance pas de scan réseau**. Il compare des rapports réels déjà
collectés sur un périmètre autorisé à une liste attendue donnée par le référent.
Cela évite de confondre le simulateur des autres kits avec une preuve GHES.

Depuis la racine, commencer par :

```powershell
npm.cmd run validate:issue-34
```

Sans préparation, le résultat attendu est **BLOCKED**, avec les champs manquants.
Le responsable GHES doit d'abord livrer les résultats d'un scan contrôlé selon
[le guide scanner](../scan-ghe.md) ; le kit n'implémente pas encore le pilotage
d'un scan réel limité à une liste de dépôts. Ne pas lancer un scan global pour
remplir les cases. Les défauts #29/#30 doivent être corrigés avant cette recette.

Dans `config/validation/issue-34.json`, renseigner ensuite :

| Champ | Valeur à fournir |
| --- | --- |
| dependenciesJson | Chemin du dependencies.json réel. |
| workbook | Chemin du scan.xlsx de la même exécution. |
| markdown | Chemin du rapport Markdown généré à partir de ce JSON. |
| expected | Liste complète des lignes attendues, confirmée avec le responsable du dépôt. Copier la structure de expectedExample, pas ses valeurs fictives. |
| evidence.ghesVersion | Version réelle du serveur GHES. |
| evidence.prefilterComparisons | Chemin d'une note comparant off/tree/code sur le même périmètre et les SHA correspondants. |
| evidence.accessDeniedProof | Chemin de la preuve d'un refus de droits contrôlé, sans token. |

Les chemins sont absolus ou relatifs à la racine de repo-tools. Les champs de
chaque ligne attendue sont : org, repo, default_branch, package_path, dependency,
declared_range, resolved_version et commit_sha_scanned. Utiliser `null` pour une
version inconnue et le SHA Git réel de 40 caractères. Ne mettre aucun token ici.

Relancer la commande. Ouvrir `reports/validation/issue-34/recette-resultat.md` :

- le JSON doit correspondre exactement à expected, sans ligne manquante ou en plus ;
- l'Excel doit avoir les mêmes lignes et versions que le JSON ;
- le Markdown doit afficher le même nombre de lignes analysées.

La présence des notes ne vaut pas acceptation de leur contenu. Le référent doit
encore confirmer les SHA, la comparaison des modes et le refus de droits dans
l'issue. Le kit conserve BLOCKED pour cette décision humaine ; il ne peut pas
certifier l'origine réelle de fichiers qu'on lui fournit.
