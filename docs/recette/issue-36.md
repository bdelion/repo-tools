# Issue #36 — contrôler les versions et l'indépendance du cache

Configuration fournie : `config/validation/issue-36.json`. Aucun réglage personnel.
Git doit être installé, comme pour l'analyse des versions. Depuis la racine :

```powershell
npm.cmd run validate:issue-36
```

Ouvrir `reports/validation/issue-36/recette-resultat.md` :

| Preuve | Attendu |
| --- | --- |
| tests.txt | Résolution JS/TS, vues, rapports de versions, références, sélection et cycle Git local réussis. |
| cache-comparison.json | before et after identiques après un simple commentaire dans la fonction du graphe historique. |

Les tests créent de petits dépôts Git locaux et leurs versions connues ; ils ne
poussent rien. La sonde de cache copie les trois fichiers nécessaires dans
`reports/validation/issue-36/cache-sandbox`, puis modifie uniquement cette copie.
Elle ne touche jamais `src/sourceProject.cjs`.

Le moteur actuel hache tout sourceProject.cjs : un commentaire dans sa fonction
graphique peut donc changer le cache des versions. FAIL sur cette comparaison
est une preuve du couplage restant, pas une panne du kit. Après séparation du
code, adapter explicitement la sonde au nouveau module ; si son point d'injection
n'existe plus, elle signale BLOCKED au lieu de prétendre avoir testé le contrat.

Le rejet d'un TGF associé aux métadonnées d'une autre exécution n'est pas encore
démontré par ce kit et reste BLOCKED. Le développeur doit livrer ce test avant
fermeture de #36. Les tests de référence ne suffisent pas à eux seuls à accepter
toute la refonte.
