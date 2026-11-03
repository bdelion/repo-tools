# Premier passage des kits — 3 novembre 2026

Contrôle de la livraison : `npm.cmd run check` réussi, avec TypeScript, lint et
**69 tests sur 69**. Un premier passage simultané à l'installation propre avait
dépassé le délai du test Git existant ; la relance seule a réussi sans modifier
ce délai. Les défauts métier détectés par les kits ci-dessous restent ouverts.

Ces résultats décrivent le dépôt local au moment de la livraison des kits,
pas une recette de vos bibliothèques ou de votre GHES. Les rapports détaillés
se régénèrent sous `reports/validation/` et ne sont pas versionnés.

| Issue | Résultat observé | Explication |
| --- | --- | --- |
| #28 | PASS | Les 8 contrôles du démonstrateur mixte JS/TS passent. La bibliothèque réelle reste à valider. |
| #29 | FAIL | Variable absente et branche explicite correctes ; vide et espaces ne donnent pas les dépendances attendues. |
| #30 | FAIL | Plusieurs erreurs API finissent avec code 0 et remplacent les rapports précédents ; le bilan machine attendu est absent. |
| #31 | FAIL | npm, workspace, Gradle, pagination, filtre React et exclusions passent. Maven détecte le projet sans extraire la dépendance attendue. Des contrats complémentaires restent à livrer. |
| #32 | BLOCKED | Aucun Python >= 3.9 utilisable détecté sur ce poste ; entrées témoins préparées mais génération Python non validée. |
| #33 | FAIL | Références logs encore incluses dans le typage, variable Stage dupliquée et absence d'étape Python identifiée dans Jenkins. Les tests locaux associés passent. |
| #34 | BLOCKED | Aucun rapport GHES réel ni référence métier fournis ; aucune collecte réseau effectuée par le kit. |
| #35 | FAIL | npm start subsiste dans le guide graphe et npm init dans le guide scanner. Les liens locaux directs vérifiés existent. La lecture par une personne nouvelle reste à réaliser. |
| #36 | FAIL | Les 37 tests de référence passent ; un commentaire dans le graphe historique change encore l'empreinte des versions. Le contrat de métadonnées croisées reste à démontrer. |
| #37 | BLOCKED | Lockfile cohérent et installation propre réussie dans le dossier isolé. Les décisions de retrait et de sécurité restent à fournir. Aucun nettoyage effectué. |
| #38 | FAIL | Agrège les défauts et prérequis manquants ci-dessus ; aucune issue fermée. |

## Comment reproduire

```powershell
npm.cmd run validate:all
```

Pour vérifier aussi l'installation isolée :

```powershell
npm.cmd run validate:issue-37 -- --clean-install
npm.cmd run validate:status
```

L'installation a réussi avec `npm ci --ignore-scripts` : 505 packages installés.
Ce contrôle ne valide pas les scripts lifecycle. Un lancement global ultérieur
sans cette option indiquera que l'installation n'a pas été rejouée ; son ancien
terminal reste disponible mais n'est pas réutilisé comme une nouvelle preuve.

Pour les étapes détaillées et les fichiers précis, suivre [l'index des kits](README.md).
PASS porte sur les contrôles exécutés ; FAIL indique un écart ; BLOCKED indique
un prérequis ou une décision manquante. Ces résultats ne valent pas clôture des tickets.
