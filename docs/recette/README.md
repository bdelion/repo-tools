# Kits de validation des issues #28 à #38

Depuis le terminal PowerShell ouvert à la racine de repo-tools :

```powershell
npm.cmd run validate:all
```

Si les dépendances ne sont pas encore installées, lancer d'abord `npm.cmd ci`.
Node 22.16+ (branche 22) ou Node 24 est nécessaire. Le lancement complet peut
prendre plusieurs minutes : il rejoue aussi les tests des versions avec Git local.
Il continue après un échec pour fournir un bilan de tous les kits.

Après avoir rejoué un kit individuel, `npm.cmd run validate:status` actualise
uniquement le bilan à partir des derniers rapports, sans relancer les tests.
L'index indique les dates pour distinguer les anciennes et nouvelles preuves.

Ouvrir **`reports/validation/index.md`**, puis le rapport du ticket concerné.
Les rapports sont générés localement et ne sont pas ajoutés à Git.
Le [premier bilan local](bilan-local-2026-11-03.md) explique les défauts et
prérequis constatés lors de la livraison ; il ne remplace pas une nouvelle exécution.

| Issue | Commande individuelle | Configuration fournie | Guide |
| --- | --- | --- | --- |
| #28 | `npm.cmd run validate:issue-28` | `config/validation/issue-28/` | [Vues de bibliothèque](issue-28.md) |
| #29 | `npm.cmd run validate:issue-29` | `config/validation/issue-29.json` | [Choix de branche](issue-29.md) |
| #30 | `npm.cmd run validate:issue-30` | `config/validation/issue-30.json` | [Erreurs et rapports précédents](issue-30.md) |
| #31 | `npm.cmd run validate:issue-31` | `config/validation/issue-31.json` | [Contrats du scanner](issue-31.md) |
| #32 | `npm.cmd run validate:issue-32` | `config/validation/issue-32.json` | [Rapport Python](issue-32.md) |
| #33 | `npm.cmd run validate:issue-33` | `config/validation/issue-33.json` | [Périmètre TypeScript et CI](issue-33.md) |
| #34 | `npm.cmd run validate:issue-34` | `config/validation/issue-34.json` | [Rapports GHES réels](issue-34.md) |
| #35 | `npm.cmd run validate:issue-35` | `config/validation/issue-35.json` | [Documentation](issue-35.md) |
| #36 | `npm.cmd run validate:issue-36` | `config/validation/issue-36.json` | [Versions et cache](issue-36.md) |
| #37 | `npm.cmd run validate:issue-37` | `config/validation/issue-37.json` | [Inventaire avant nettoyage](issue-37.md) |
| #38 | `npm.cmd run validate:issue-38` | `config/validation/issue-38.json` | [Bilan de tous les lots](issue-38.md) |

## Lire un résultat

Chaque kit produit `reports/validation/issue-N/recette-resultat.md` et `.json`.
Le tableau donne **attendu, observé, statut et chemin de la preuve** pour chaque
contrôle. Le code de retour PowerShell `$LASTEXITCODE` vaut :

| Statut | Code | Action |
| --- | --- | --- |
| PASS | 0 | Les contrôles exécutés correspondent aux attendus ; réaliser les éventuelles vérifications métier du guide. |
| FAIL | 1 | Un écart a été détecté. Joindre le rapport à l'issue ; le développeur corrige puis rejoue le kit. |
| BLOCKED | 2 | Il manque Python, des rapports réels ou une preuve humaine/externe. Suivre la préparation indiquée dans le guide. |

Un kit peut afficher des contrôles PASS, FAIL et BLOCKED : le résultat global
prend FAIL en priorité, puis BLOCKED. **Un kit disponible ne signifie pas que
l'issue est corrigée.** Plusieurs défauts connus sont volontairement détectés,
sans changer leurs valeurs attendues pour obtenir artificiellement PASS.

## Ce qui reste à fournir

- #28 : la validation sur votre bibliothèque réelle, après le démonstrateur.
- #32 : un interpréteur Python utilisable si la détection échoue.
- #33 : les résultats Jenkins et de la matrice Node, en plus du diagnostic local.
- #34 : les rapports réels autorisés et une référence métier validée. Le kit ne contacte aucun GHES.
- #35 : la lecture par une personne nouvelle.
- #36 : le contrat de rejet des métadonnées croisées reste à démontrer.
- #37 : les décisions de retrait et de sécurité ; l'installation propre est une option explicite.

Les kits scanner #29–#31 utilisent un serveur HTTP **local**, des données fictives
et un faux token. Leur environnement est isolé de la configuration du scanner
dans votre terminal et ils ne chargent pas le `.env` du dépôt. Les kits ne
suppriment aucune référence sous `logs`, ne modifient pas le code analysé et ne
ferment aucune issue. Aucun changement fonctionnel du scanner n'est inclus.

## Que transmettre au développeur ?

Joindre `recette-resultat.md` du ticket et le fichier indiqué dans sa colonne
Preuve. Pour #34, anonymiser les rapports avant partage. Ne jamais joindre le
`.env` ou un token. Indiquer la commande lancée et l'écart observé.
